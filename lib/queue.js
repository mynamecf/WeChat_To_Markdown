/**
 * lib/queue.js —— 链接队列的纯逻辑（不碰 chrome API，可在 Node 里直接测）
 *
 * 只有「该不该进队列」「下一条是谁」「这条失败了要不要重试」这三类判断，
 * 副作用（开标签页、下载、写 storage）全部留在 background.js。
 * 这样状态机可以脱离浏览器验证 —— 队列最怕的就是「状态卡在 running 再也动不了」。
 *
 * 引入方式：background.js 里 importScripts('lib/queue.js')
 * 用 var 声明，保证 worker 全局可见。
 */
var WXMD_QUEUE = (function () {
  'use strict';

  var STATUS = {
    QUEUED: 'queued',     // 等着被泵取走
    RUNNING: 'running',   // 正在导出（含开标签页、等加载、下载图片）
    DONE: 'done',
    FAILED: 'failed'
  };

  /**
   * 队列不设业务上限（用户要跑 300、500 条都行）。
   * 这个数是防误贴的硬顶：一次粘几万行会让 storage.local 的 10MB 配额写不进去，
   * 表现是队列凭空少一截，比直接拒绝更难查。正常批量导出碰不到它。
   */
  var MAX_ITEMS = 5000;
  /** 超过这个条数，下载前提示「可能触发微信风控」；界面也会常驻一条提醒 */
  var RISK_WARN_ITEMS = 200;
  var MAX_ATTEMPTS = 2;    // 首次 + 1 次重试。超时类错误重试一次够用，再多是浪费时间

  /**
   * 这些错误重试没有意义 —— 页面本身就不对，再开十次标签页也是同样的结果。
   * 判断用「包含」而不是相等：错误信息里常带回显的原文片段。
   */
  var NON_RETRYABLE = [
    '未找到文章正文',
    '文章已删除',
    '内容已删除',
    '该内容已被发布者删除',
    '只支持公众号',
    '不是文章页',
    '链接为空',
    '不是合法网址',
    '导出数据无效',
    '文章内容过大',
    '这篇文章正在导出中'
  ];

  /**
   * mp.weixin.qq.com 下不全是文章：首页、视频播放页（/mp/readtemplate）、
   * 合集页（/mp/appmsgalbum）、历史消息页都能打开，但都没有正文。
   * 只有 /s/xxx（短链）与 /s?__biz=…（标准参数）这两种是文章。
   */
  function isArticlePath(url) {
    try {
      var p = new URL(url).pathname;
      return p === '/s' || p.indexOf('/s/') === 0;
    } catch (e) {
      return false;
    }
  }

  /** 从整段分享文案里挑出链接：公众号「复制链接」经常连标题一起复制 */
  var URL_RE = /https?:\/\/[^\s<>"'`）。，、；！？：""'']+/;

  /**
   * 校验并规范化。
   * @returns {{ok:true, url:string} | {ok:false, error:string}}
   */
  function normalizeUrl(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, error: '链接为空' };

    if (!/^https?:\/\//i.test(s)) {
      var m = s.match(URL_RE);
      if (!m) return { ok: false, error: '不是合法网址' };
      s = m[0];
    }
    // 尾巴上粘了标点（中文逗号、右括号）时再剥一层
    s = s.replace(/[）】》，。；、！？"'`]+$/g, '');

    var parsed;
    try {
      parsed = new URL(s);
    } catch (e) {
      return { ok: false, error: '不是合法网址' };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: '只支持 http(s) 链接' };
    }

    var isWx = typeof WXMD_isWechatArticleUrl === 'function'
      ? WXMD_isWechatArticleUrl(parsed.href)
      : (parsed.protocol === 'https:' && parsed.hostname === 'mp.weixin.qq.com');
    if (!isWx) return { ok: false, error: '只支持公众号文章链接' };

    if (!isArticlePath(parsed.href)) {
      return { ok: false, error: '不是文章页（路径要以 /s/ 开头）' };
    }

    // #rd 之类的锚点不影响内容；query 必须保留（?wxmd_video=1 决定了视频定位）
    parsed.hash = '';
    return { ok: true, url: parsed.href };
  }

  /** 去重键：同一个 URL 只允许存在一条（含已完成），避免重复下载同一篇 */
  function urlKey(url) {
    return String(url || '').replace(/#.*$/, '');
  }

  var seq = 0;
  function newId(now) {
    seq++;
    return 'q' + (now || Date.now()).toString(36) + '_' + seq.toString(36)
      + Math.random().toString(36).slice(2, 6);
  }

  /**
   * 批量入队。
   * 不进队列的原因要逐条回给界面 —— 用户贴 10 行，静默吞掉 3 行比报错更难受。
   * @returns {{items:Array, added:Array, skipped:Array<{url,reason}>}}
   */
  function addItems(list, raws, now) {
    var items = Array.isArray(list) ? list.slice() : [];
    var added = [];
    var skipped = [];
    var seen = {};
    items.forEach(function (it) { seen[urlKey(it && it.url)] = true; });

    var arr = Array.isArray(raws) ? raws : [raws];
    arr.forEach(function (raw) {
      var n = normalizeUrl(raw);
      if (!n.ok) {
        skipped.push({ url: String(raw == null ? '' : raw).trim(), reason: n.error });
        return;
      }
      var k = urlKey(n.url);
      if (seen[k]) {
        skipped.push({ url: n.url, reason: '已在队列中' });
        return;
      }
      if (items.length >= MAX_ITEMS) {
        skipped.push({ url: n.url, reason: '一次最多 ' + MAX_ITEMS + ' 条，请先清空已完成的' });
        return;
      }
      seen[k] = true;
      var item = {
        id: newId(now),
        url: n.url,
        status: STATUS.QUEUED,
        title: '',
        error: '',
        attempts: 0,
        tabId: null,
        addedAt: now || Date.now(),
        finishedAt: 0
      };
      items.push(item);
      added.push(item);
    });

    return { items: items, added: added, skipped: skipped };
  }

  /** 泵取活：只取 queued，running 的不能被第二条抢占 */
  function nextQueued(list) {
    var items = Array.isArray(list) ? list : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].status === STATUS.QUEUED) return items[i];
    }
    return null;
  }

  /** 原地改一条，返回新数组（storage 里存的是快照，直接改对象会漏掉写入） */
  function patchItem(list, id, patch) {
    var items = Array.isArray(list) ? list : [];
    return items.map(function (it) {
      if (!it || it.id !== id) return it;
      var next = {};
      for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) next[k] = it[k];
      for (var p in patch) if (Object.prototype.hasOwnProperty.call(patch, p)) next[p] = patch[p];
      return next;
    });
  }

  function removeItem(list, id) {
    return (Array.isArray(list) ? list : []).filter(function (it) { return it && it.id !== id; });
  }

  /** 清掉已结束的（done / failed），running 与 queued 保留 */
  function clearFinished(list) {
    return (Array.isArray(list) ? list : []).filter(function (it) {
      return it && it.status !== STATUS.DONE && it.status !== STATUS.FAILED;
    });
  }

  function counts(list) {
    var out = { total: 0, queued: 0, running: 0, done: 0, failed: 0 };
    (Array.isArray(list) ? list : []).forEach(function (it) {
      if (!it) return;
      out.total++;
      if (out[it.status] !== undefined) out[it.status]++;
    });
    return out;
  }

  function isRetryableError(msg) {
    var s = String(msg || '');
    for (var i = 0; i < NON_RETRYABLE.length; i++) {
      if (s.indexOf(NON_RETRYABLE[i]) >= 0) return false;
    }
    return true;
  }

  /** 这条还能不能再试一次（attempts 已含本次） */
  function canRetry(item) {
    if (!item) return false;
    if (!isRetryableError(item.error)) return false;
    return (item.attempts || 0) < MAX_ATTEMPTS;
  }

  return {
    STATUS: STATUS,
    MAX_ITEMS: MAX_ITEMS,
    RISK_WARN_ITEMS: RISK_WARN_ITEMS,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    normalizeUrl: normalizeUrl,
    isArticlePath: isArticlePath,
    urlKey: urlKey,
    addItems: addItems,
    nextQueued: nextQueued,
    patchItem: patchItem,
    removeItem: removeItem,
    clearFinished: clearFinished,
    counts: counts,
    isRetryableError: isRetryableError,
    canRetry: canRetry
  };
})();
