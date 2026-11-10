// background.js —— 集中处理所有 IO（提取调度 / 路径净化 / 下载）
importScripts('lib/defaults.js');
// 图片引用路径的拼装规则与配置页预览共用 lib/naming.js，
// 否则「预览显示的链接」和「md 里真实写的链接」迟早会漂移。
importScripts('lib/naming.js');

const IMG_CONCURRENCY = 4;          // 图片并发下载上限
// 必须小于 MV3 service worker 的 30 秒空闲回收阈值。
// 下载卡死（DNS 无响应 / CDN 不返回数据）时不会有任何 onChanged 事件，
// 超时设成 20s 才能保证定时器先于后台被回收触发；否则 Promise 永远悬空、
// sendResponse 永不回调，popup / 浮窗的导出按钮会永久停在 disabled。
const DOWNLOAD_TIMEOUT = 20000;     // 单个下载超时（ms）
const MAX_MARKDOWN_BYTES = 1400000; // data URL 上限保护（base64 后约 1.9MB）

// 首次安装时把默认配置落库，保证 popup / options / content 读到同一套值
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const cur = await chrome.storage.local.get(null);
    const patch = {};
    for (const key of Object.keys(WXMD_DEFAULTS)) {
      if (cur[key] === undefined) patch[key] = WXMD_DEFAULTS[key];
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  } catch (e) {
    console.warn('[wx-md] 初始化默认配置失败', e);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 只接受扩展自身（popup / content script）发来的消息。
  // 当前没有 externally_connectable，外部网页本来就发不进来；
  // 这一行是防止将来加了外部通道后，EXPORT_ARTICLE 的参数被任意构造。
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'EXPORT_ARTICLE') {
    handleExport(message.data)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'EXPORT_FROM_FLOATING') {
    handleExportFromFloating(sender, message.data)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_OPTIONS') {
    openOptions(sender, message)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ---------- 打开配置页（防多开） ----------

async function openOptions(sender, message) {
  const optionsUrl = chrome.runtime.getURL('options.html');

  // 来源页可能是浮窗（sender.tab）也可能是弹窗（需要 message.sourceTabId）
  let sourceTabId = (message && typeof message.sourceTabId === 'number')
    ? message.sourceTabId
    : null;
  if (sourceTabId === null && sender && sender.tab && typeof sender.tab.id === 'number') {
    sourceTabId = sender.tab.id;
  }

  if (typeof sourceTabId === 'number') {
    await chrome.storage.local.set({ optionsSourceTabId: sourceTabId });
  }

  // 需要 manifest 里的 "tabs" 权限，否则按 url 过滤会永远返回空数组
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: optionsUrl });
  } catch (e) {
    tabs = [];
  }

  if (tabs && tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    for (let i = 1; i < tabs.length; i++) {
      try { await chrome.tabs.remove(tabs[i].id); } catch (e) {}
    }
    return;
  }

  await chrome.tabs.create({
    url: optionsUrl,
    openerTabId: typeof sourceTabId === 'number' ? sourceTabId : undefined
  });
}

// ---------- 浮窗触发导出 ----------

async function handleExportFromFloating(sender, options) {
  if (!sender || !sender.tab || typeof sender.tab.id !== 'number') {
    throw new Error('无法定位当前标签页，请刷新页面后重试');
  }
  const tabId = sender.tab.id;
  const opts = options || {};

  try {
    // 把浮窗里的「本次选择」通过一次性全局变量传给 content.js，
    // 不再写入 chrome.storage.local（避免临时选择变成永久默认）。
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (o) => { globalThis.__WXMD_OVERRIDE__ = o; },
      args: [{
        imageMode: opts.imageMode || null,
        folderMode: opts.folderMode || null
      }]
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'lib/defaults.js',
        'lib/naming.js',
        'lib/turndown.js',
        'lib/turndown-plugin-gfm.js',
        'content.js'
      ]
    });

    const articleData = pickArticleData(results);
    if (!articleData || !articleData.success) {
      throw new Error((articleData && articleData.error) || '提取失败（未获取到页面返回数据）');
    }

    await handleExport(articleData);
  } finally {
    // 注入失败（页面跳转 / 标签页关闭 / 上下文失效）时全局变量会残留，
    // 下一次从 popup 导出就会误用上一次浮窗的选择。成功路径上 content.js 已删过，重复删无害。
    await clearOverride(tabId);
  }
}

/** 清掉一次性传参，失败也不抛（标签页可能已经不在了） */
function clearOverride(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => { delete globalThis.__WXMD_OVERRIDE__; }
  }).catch(() => {});
}

/**
 * executeScript 多文件注入时，results 里只有 content.js 那一项带实际返回值。
 * 从后往前找第一个像样的结果，不依赖固定下标。
 */
function pickArticleData(results) {
  if (!Array.isArray(results)) return null;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i] && results[i].result;
    if (r && typeof r === 'object' && typeof r.success === 'boolean') return r;
  }
  return null;
}

// ---------- 图片引用路径 ----------

/**
 * 取值收敛到四种已知模式，其余一律回落到 note（相对当前笔记），
 * 保证任何脏数据都不会拼出诡异的链接。
 */
function normalizeImagePathMode(mode) {
  if (typeof WXMD_NAMING !== 'undefined' && typeof WXMD_NAMING.normalizeImageRefMode === 'function') {
    return WXMD_NAMING.normalizeImageRefMode(mode);
  }
  return (mode === 'relative' || mode === 'custom') ? mode : 'note';
}

/**
 * 归一成 { mode, prefix }（含旧版 parent / vault 的迁移）。
 * 有 naming 模块时以它为准，缺了就退回最基本的判断，保证导出不会因缺依赖崩掉。
 */
function resolveImageRefConfig(article) {
  if (typeof WXMD_NAMING !== 'undefined' && typeof WXMD_NAMING.resolveImageRefConfig === 'function') {
    return WXMD_NAMING.resolveImageRefConfig(article || {});
  }
  const src = article || {};
  return {
    mode: normalizeImagePathMode(src.imagePathMode),
    prefix: typeof src.imageRefPrefix === 'string' ? src.imageRefPrefix : ''
  };
}

/**
 * 生成 Markdown 里的图片路径。
 * 权威实现在 lib/naming.js（配置页预览用的是同一份），这里只做一层降级垫片，
 * 防止 service worker 里 importScripts 意外失败时整篇导出崩掉。
 */
function makeImageRef(mode, imgDir, filename, noteFolder, prefix) {
  if (typeof WXMD_NAMING !== 'undefined' && typeof WXMD_NAMING.buildImageRef === 'function') {
    return WXMD_NAMING.buildImageRef(mode, imgDir, filename, noteFolder, prefix);
  }
  const dir = String(imgDir || '').replace(/^\/+|\/+$/g, '');
  const rel = [dir, filename].filter(Boolean).join('/');
  if (!rel) return '';
  if (mode === 'relative') return rel;
  if (mode === 'custom') {
    let pre = String(prefix || '')
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/ /g, '%20')
      .replace(/\{\{noteFolder\}\}/gi, String(noteFolder || '').replace(/^\/+|\/+$/g, ''))
      .replace(/\/{2,}/g, '/');
    if (!pre) return rel;
    if (!/\/$/.test(pre)) pre += '/';
    return pre + rel;
  }
  return './' + rel;
}

// ---------- 核心导出 ----------

async function handleExport(article) {
  if (!article || typeof article.markdown !== 'string') {
    throw new Error('导出数据无效（缺少 markdown 内容）');
  }

  const imageMode = article.imageMode === 'online' ? 'online' : 'download';
  const folderMode = article.folderMode === 'shared' ? 'shared' : 'per-article';
  const images = Array.isArray(article.images) ? article.images : [];

  // 图片链接在 md 里怎么写（相对笔记 / 库内模糊 / 自定义前缀）
  const imageRef = resolveImageRefConfig(article);

  let markdown = article.markdown;
  let targetFolder = '';
  let targetFile = '';

  if (imageMode === 'online') {
    const mdName = safePath(article.onlineFilename) || 'article';
    targetFile = `${mdName}.md`;
  } else if (folderMode === 'shared') {
    targetFolder = safePath(article.sharedFolder) || 'article';
    const mdName = safePath(article.sharedFilename || article.onlineFilename) || 'article';
    targetFile = `${targetFolder}/${mdName}.md`;
  } else {
    targetFolder = safePath(article.downloadFolder) || 'article';
    // 允许 downloadFolder 模板带子目录，但 md 文件名只用最后一段，
    // 避免出现 a/b/a/b.md 这种重复嵌套
    const mdName = targetFolder.split('/').pop() || 'article';
    targetFile = `${targetFolder}/${mdName}.md`;
  }

  if (imageMode === 'download' && images.length > 0) {
    const imgDir = safePath(article.imageFolder);

    const items = images.map(item => {
      const base = safePath(item && item.filenameBase) || 'image';
      return {
        url: (item && typeof item.url === 'string') ? item.url : '',
        filenameBase: base,
        realExt: extFromUrl(item && item.url)
      };
    });

    // 先算出预算路径：下载失败时仍要落到一个合理的相对路径上
    const pathByIndex = new Map();
    items.forEach((item, i) => {
      const filename = `${item.filenameBase}.${item.realExt}`;
      pathByIndex.set(i, makeImageRef(imageRef.mode, imgDir, filename, targetFolder, imageRef.prefix));
    });

    // Chrome 命中同名文件时会改名成 "xxx (1).webp"，与上面预算的名字不同。
    // 因此占位符替换推迟到下载结束：优先用真实文件名，取不到再回退预算值。
    const actualPath = new Map();

    let failed = 0;
    let blocked = 0;
    await mapLimit(items, IMG_CONCURRENCY, async (item, i) => {
      if (!/^https?:\/\//i.test(item.url)) return;
      if (!isDownloadableImageUrl(item.url)) {
        blocked++;
        // 不下载，但把原始地址写回去，避免 md 里留下未替换的 {{IMG_n}}
        actualPath.set(i, item.url);
        return;
      }
      const filename = `${item.filenameBase}.${item.realExt}`;
      const downloadPath = limitPath(
        imgDir ? `${targetFolder}/${imgDir}/${filename}` : `${targetFolder}/${filename}`
      );
      try {
        const res = await downloadFile(item.url, downloadPath);
        if (res && res.filename && res.filename !== filename) {
          // uniquify 产生的 "a (1).webp" 含空格与括号，直接塞进 markdown 会截断链接，
          // 只把空格编码掉（括号成对出现，CommonMark 可解析）
          const realName = res.filename.replace(/ /g, '%20');
          actualPath.set(i, makeImageRef(imageRef.mode, imgDir, realName, targetFolder, imageRef.prefix));
        }
      } catch (err) {
        failed++;
        console.warn('[wx-md] 图片下载失败:', item.url, err.message);
      }
    });

    // 一次性正则替换，避免 O(N × 文本长度) 的 split/join
    markdown = markdown.replace(/\{\{IMG_(\d+)\}\}/g, (match, idx) => {
      const i = Number(idx);
      const p = actualPath.get(i) ?? pathByIndex.get(i);
      return p === undefined ? match : p;
    });

    if (failed > 0) {
      console.warn(`[wx-md] 本次共 ${failed} / ${items.length} 张图片下载失败`);
    }
    if (blocked > 0) {
      console.warn(`[wx-md] 已跳过 ${blocked} 张指向内网/本机地址的图片，仅保留在线链接`);
    }
  }

  // Markdown 必须最后写：图片已经落盘，md 里的链接才会指向真实文件
  const mdTarget = limitPath(targetFile);
  const mdRes = await downloadFile(toDataUrl(markdown), mdTarget);
  // 顺手把浏览器下载根目录记下来，设置页要展示给用户看
  await rememberDownloadRoot(mdRes, mdTarget);
}

// ---------- 图片扩展名：从 URL 推断，零网络请求 ----------

/**
 * 微信图片 URL 通常带 wx_fmt 参数（png / jpeg / gif / webp），
 * 这是最准确的来源。原先用 HEAD / Range 请求探测 content-type，
 * 但 qpic 有 Referer 防盗链，扩展 SW 的 fetch 不带站内 Referer，
 * 结果是每张图 2 次必然失败的请求，还会触发限流。
 */
const IMG_FMT_ALIASES = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  svg: 'svg'
};

function normalizeImgFmt(v) {
  return IMG_FMT_ALIASES[String(v || '').trim().toLowerCase()] || '';
}

/** 从 /mmbiz_png/、/sz_mmbiz_jpg/ 这类路径段里取原始存储格式 */
function extractMmbizPrefix(path) {
  const m = path.match(/(?:^|\/)(?:sz_)?mmbiz_([a-z]+)(?:\/|$)/);
  return m ? m[1] : '';
}

/**
 * 微信图片 URL 里「存储格式」和「下发格式」是两件事：
 *   /mmbiz_png/xxx/640?wx_fmt=png&tp=webp
 * 存储是 png，但 tp=webp 要求 CDN 转码成 webp 下发。
 * 只取 wx_fmt 会把 webp 字节存成 .png，部分编辑器按扩展名判断就预览不了。
 *
 * 信号按可靠性排序：tp > 路径 webp > wx_fmt > 路径前缀 > 文件后缀。
 * 注意 tp=webp 是否真的生效取决于 CDN 对 UA/Accept 的判断，
 * 这里按 Chrome 客户端（downloads API 走 Chrome UA）会拿到 webp 处理。
 */
function extFromUrl(url) {
  if (!url || typeof url !== 'string') return 'jpg';

  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return 'jpg';
  }

  const path = u.pathname.toLowerCase();
  const params = u.searchParams;

  // 1. tp=webp —— 显式请求 CDN 转码，优先级最高
  if ((params.get('tp') || '').toLowerCase() === 'webp') return 'webp';

  // 2. 路径本身就是 webp 资源（用 pathname，避免查询参数里出现 mmbiz_webp 误命中）
  if (/(?:^|\/)(?:sz_)?mmbiz_webp(?:\/|$)/.test(path)) return 'webp';

  // 3. wx_fmt —— 请求参数，最贴近实际下发格式
  const byParam = normalizeImgFmt(params.get('wx_fmt'));
  if (byParam) return byParam;

  // 4. 路径前缀兜底（wx_fmt 缺失或为 other 时）
  const byPrefix = normalizeImgFmt(extractMmbizPrefix(path));
  if (byPrefix) return byPrefix;

  // 5. 文件名后缀
  const m = path.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/);
  if (m) return normalizeImgFmt(m[1]) || 'jpg';

  return 'jpg';
}

// ---------- 图片地址安全校验 ----------

/**
 * 第二道校验（content.js 已经过滤过一次）。
 * 保留它的原因：EXPORT_ARTICLE 的 data 是外部传入的，不能假设它一定来过 content.js。
 * 内网 / 本机地址一律不下载，只回退成在线链接。
 */
function isDownloadableImageUrl(u) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !WXMD_isPrivateHost(parsed.hostname);
  } catch (e) {
    return false;
  }
}

// ---------- Markdown 转 data URL ----------
/**
 * encodeURIComponent 会把每个中文字符编码成 9 个字符（%E4%B8%AD），
 * 相对原文膨胀约 3 倍，很容易撞上 Chromium 约 2MB 的 URL 长度上限。
 * 改用 base64（只膨胀 1.33 倍）。
 */
function toDataUrl(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_MARKDOWN_BYTES) {
    throw new Error(
      `文章内容过大（${(bytes.length / 1024).toFixed(0)}KB），` +
      '请改用「保留在线链接」模式后再导出'
    );
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return 'data:text/markdown;charset=utf-8;base64,' + btoa(bin);
}

// ---------- 路径净化 ----------

/** 收敛成安全的相对路径；过滤 ..、绝对路径、非法字符与超长片段 */
function safePath(p) {
  return String(p == null ? '' : p)
    .replace(/\\/g, '/')
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .map(cleanSegment)
    .filter(Boolean)
    .join('/');
}

/** Windows 保留设备名：CON / PRN / AUX / NUL / COM1-9 / LPT1-9（带扩展名同样非法） */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function cleanSegment(seg) {
  let s = String(seg)
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^[_\s]+/, '')
    .slice(0, 80)
    // 结尾清理必须在 slice 之后：截断本身可能把结尾落到点号或空格上，
    // 而 Windows 不允许文件名以 "." 或 " " 结尾（会直接报 Invalid filename）
    .replace(/[.\s]+$/, '')
    .replace(/_+$/, '');
  if (RESERVED_NAME.test(s)) s = '_' + s;
  return s;
}

/**
 * Windows 路径长度保护（含 Downloads 前缀约 260 上限，这里按相对路径 200 留余量）。
 *
 * 注意：不能只裁一轮。旧实现是「每段切 40、文件名切 60」的固定裁剪，
 * 段数一多结果仍可能超过 max（5 段长名 → 233），等于没兜住。
 * 这里改成「先压、再检查、还不够继续压」，保证返回值始终 ≤ max。
 */
function limitPath(p, max = 200) {
  if (!p || p.length <= max) return p;

  const parts = p.split('/');
  const file = parts.pop() || '';
  const dot = file.lastIndexOf('.');
  const ext = dot > 0 ? file.slice(dot) : '';
  let name = dot > 0 ? file.slice(0, dot) : file;
  const build = () => (parts.length ? parts.join('/') + '/' : '') + name + ext;

  // 1) 先压文件名主干，给目录留空间（保留至少 12 字符可读性）
  while (build().length > max && name.length > 12) {
    name = name.slice(0, Math.max(12, name.length - 8));
  }

  // 2) 再逐个压缩最长的目录段
  while (build().length > max && parts.length) {
    let li = 0;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].length > parts[li].length) li = i;
    }
    if (parts[li].length <= 4) break;
    parts[li] = parts[li].slice(0, Math.max(4, parts[li].length - 8));
  }

  // 3) 还不够就丢掉最外层目录
  while (build().length > max && parts.length > 1) parts.shift();

  // 4) 极端兜底：只剩一层目录仍超长，硬截文件名
  if (build().length > max) {
    name = name.slice(0, Math.max(1, name.length - (build().length - max)));
  }
  return build();
}

// ---------- 下载（等待真实终态） ----------

/** 从绝对路径里取文件名，用于识别 Chrome 自动改名后的真实落盘名 */
function baseName(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}

/** 是否绝对路径（Windows 盘符 / UNC / POSIX） */
function isAbsolutePath(p) {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(String(p || ''));
}

/**
 * Chrome 没有「读取默认下载目录」的 API。
 * 唯一可靠的办法是反推：拿一次真实落盘的绝对路径，扣掉我们传进去的相对路径，
 * 剩下的前缀就是浏览器的下载根目录。纯展示用途，任何异常都静默忽略。
 */
async function rememberDownloadRoot(res, relPath) {
  try {
    const full = String((res && res.fullPath) || '');
    if (!isAbsolutePath(full)) return;

    const norm = p => String(p).replace(/\\/g, '/');
    const fullNorm = norm(full);
    const relNorm = norm(relPath || '');

    // 只比较目录部分：文件名可能被 uniquify 改成 "xxx (1).md"
    const fullDir = fullNorm.slice(0, fullNorm.lastIndexOf('/') + 1);
    const relDir = relNorm.slice(0, relNorm.lastIndexOf('/') + 1);

    let root;
    if (!relDir) {
      root = fullDir;
    } else if (fullDir.toLowerCase().endsWith(relDir.toLowerCase())) {
      root = fullDir.slice(0, fullDir.length - relDir.length);
    } else {
      // 结构对不上：多半是开了「每次询问保存位置」，落盘到了用户手选的目录。
      // 宁可标记「猜不出来」也不显示一个错的路径
      await chrome.storage.local.set({ lastDownloadRootFailAt: Date.now() });
      return;
    }

    root = root.replace(/\/+$/, '');
    if (!root) return;
    // Windows 下还原反斜杠，跟资源管理器里看到的一致
    if (/^[a-zA-Z]:\//.test(root) || /^\/\//.test(root)) {
      root = root.replace(/\//g, '\\');
    }
    // "D:/" 去尾斜杠会变成 "D:"，那是「D 盘当前目录」而不是根目录，必须补回
    if (/^[a-zA-Z]:$/.test(root)) root += '\\';

    const prev = await chrome.storage.local.get({
      lastDownloadRoot: '',
      lastDownloadRootFailAt: 0
    });
    if (prev.lastDownloadRoot === root) {
      // 路径没变，但要清掉可能残留的「猜不出来」标记
      if (prev.lastDownloadRootFailAt) await chrome.storage.local.set({ lastDownloadRootFailAt: 0 });
      return;
    }
    await chrome.storage.local.set({
      lastDownloadRoot: root,
      lastDownloadRootAt: Date.now(),
      lastDownloadRootFailAt: 0
    });
  } catch (e) {
    // 纯展示，失败不影响导出
  }
}

function downloadFile(url, filename, timeoutMs = DOWNLOAD_TIMEOUT) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        // 不再覆盖同名文件：同名时自动加 (1)(2)，避免静默删除用户已有文件
        conflictAction: 'uniquify',
        saveAs: false
      },
      downloadId => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (typeof downloadId !== 'number') {
          reject(new Error('下载任务创建失败'));
          return;
        }

        let settled = false;
        let timer = null;   // 必须先声明：finish 里要用，放后面会命中 TDZ
        // uniquify 会把 "a.webp" 改成 "a (1).webp"，这里记录磁盘上真正的名字，
        // 供调用方回写 markdown，否则 md 里的图片链接会指向不存在的文件。
        let finalName = filename;
        const finish = err => {
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
            resolve({ downloadId, filename: baseName(finalName), fullPath: finalName });
            return;
          }
          chrome.downloads.search({ id: downloadId }, items => {
            const real = (items && items[0] && items[0].filename) || '';
            const path = real || finalName;
            resolve({ downloadId, filename: baseName(path), fullPath: path });
          });
        };

        const onChanged = delta => {
          if (!delta || delta.id !== downloadId) return;
          // filename 增量可能先于 state 到达，这里累积而不要提前 return
          if (delta.filename && delta.filename.current) {
            finalName = delta.filename.current;
          }
          if (!delta.state) return;
          const state = delta.state.current;
          if (state === 'complete') {
            finish(null);
          } else if (state === 'interrupted') {
            finish(new Error((delta.error && delta.error.current) || '下载中断'));
          }
        };

        timer = setTimeout(() => finish(new Error('下载超时')), timeoutMs);
        chrome.downloads.onChanged.addListener(onChanged);
      }
    );
  });
}

// ---------- 并发控制 ----------

async function mapLimit(items, limit, fn) {
  const size = Math.min(limit, items.length);
  if (size <= 0) return;
  let cursor = 0;
  const workers = [];
  for (let w = 0; w < size; w++) {
    workers.push((async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    })());
  }
  await Promise.all(workers);
}
