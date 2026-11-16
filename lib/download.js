/**
 * lib/download.js —— 下载原语（等待真实终态 / 并发控制 / data URL）
 *
 * 从 background.js 抽出来：后台剩下「调度 + 路径 + 统计」，下载这些底层动作收在这里。
 * 只依赖 chrome.downloads，不碰 storage、不碰路径规则，方便单独推理和替换。
 *
 * 引入方式：background.js 里 importScripts('lib/download.js')
 * 用 var 声明，保证 worker 全局可见。
 */
var WXMD_DL = (function () {
  'use strict';

  /** 从绝对路径里取文件名，用于识别 Chrome 自动改名后的真实落盘名 */
  function baseName(p) {
    return String(p || '').split(/[\\/]/).pop() || '';
  }

  /** 是否绝对路径（Windows 盘符 / UNC / POSIX） */
  function isAbsolutePath(p) {
    return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(String(p || ''));
  }

  /**
   * 发起下载并等到真实终态。
   * resolve({ downloadId, filename, fullPath })，其中 filename 是磁盘上的真实名字
   * （uniquify 会把 a.webp 改成 "a (1).webp"，调用方要据此回写 markdown）。
   */
  function downloadFile(url, filename, timeoutMs, onProgress) {
    return new Promise(function (resolve, reject) {
      chrome.downloads.download(
        {
          url: url,
          filename: filename,
          // 不覆盖同名文件：同名时自动加 (1)(2)，避免静默删除用户已有文件
          conflictAction: 'uniquify',
          saveAs: false
        },
        function (downloadId) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (typeof downloadId !== 'number') {
            reject(new Error('下载任务创建失败'));
            return;
          }

          var settled = false;
          var timer = null;   // 必须先声明：finish 里要用，放后面会命中 TDZ
          var finalName = filename;
          var lastBytes = 0;

          var finish = function (err) {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            chrome.downloads.onChanged.removeListener(onChanged);
            if (err) {
              reject(err);
              return;
            }
            // 常规情况 filename 增量已经给了绝对路径，直接返回（不额外产生异步开销）。
            // 极少数拿不到的情况，用 search 补齐，保证 fullPath 一定是绝对路径。
            if (isAbsolutePath(finalName)) {
              resolve({ downloadId: downloadId, filename: baseName(finalName), fullPath: finalName });
              return;
            }
            chrome.downloads.search({ id: downloadId }, function (items) {
              var real = (items && items[0] && items[0].filename) || '';
              var p = real || finalName;
              resolve({ downloadId: downloadId, filename: baseName(p), fullPath: p });
            });
          };

          var onChanged = function (delta) {
            if (!delta || delta.id !== downloadId) return;
            // filename 增量可能先于 state 到达，这里累积而不要提前 return
            if (delta.filename && delta.filename.current) {
              finalName = delta.filename.current;
            }
            // 字节数增量只用于进度回调，不影响终态判断
            if (delta.bytesReceived && typeof delta.bytesReceived.current === 'number') {
              lastBytes = delta.bytesReceived.current;
              if (typeof onProgress === 'function') {
                try { onProgress(lastBytes, delta.totalBytes && delta.totalBytes.current); } catch (e) {}
              }
            }
            if (!delta.state) return;
            var state = delta.state.current;
            if (state === 'complete') {
              finish(null);
            } else if (state === 'interrupted') {
              finish(new Error((delta.error && delta.error.current) || '下载中断'));
            }
          };

          timer = setTimeout(function () { finish(new Error('下载超时')); }, timeoutMs);
          chrome.downloads.onChanged.addListener(onChanged);
        }
      );
    });
  }

  /** 并发上限内跑完 fn(items[i], i)，单项失败由 fn 自己兜住 */
  async function mapLimit(items, limit, fn) {
    var size = Math.min(limit, items.length);
    if (size <= 0) return;
    var cursor = 0;
    var workers = [];
    for (var w = 0; w < size; w++) {
      workers.push((async function () {
        for (;;) {
          var i = cursor++;
          if (i >= items.length) return;
          await fn(items[i], i);
        }
      })());
    }
    await Promise.all(workers);
  }

  /**
   * Markdown → data URL。
   * encodeURIComponent 会把每个中文字符编码成 9 个字符（%E4%B8%AD），
   * 相对原文膨胀约 3 倍，很容易撞上 Chromium 约 2MB 的 URL 长度上限；
   * base64 只膨胀 1.33 倍。
   */
  function toDataUrl(text, maxBytes) {
    var bytes = new TextEncoder().encode(text);
    if (bytes.length > maxBytes) {
      var err = new Error('内容过大 ' + bytes.length);
      err.wxmdTooLarge = bytes.length;
      throw err;
    }
    var bin = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return 'data:text/markdown;charset=utf-8;base64,' + btoa(bin);
  }

  /** 只测字节数，不发下载：用于「先把超限拦下来，别等图片全落盘才报错」 */
  function byteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  return {
    baseName: baseName,
    isAbsolutePath: isAbsolutePath,
    downloadFile: downloadFile,
    mapLimit: mapLimit,
    toDataUrl: toDataUrl,
    byteLength: byteLength
  };
})();
