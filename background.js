// background.js —— 导出调度、路径规划与下载编排（下载原语在 lib/download.js）
importScripts('lib/defaults.js');
// 图片引用路径的拼装规则与配置页预览共用 lib/naming.js，
// 否则「预览显示的链接」和「md 里真实写的链接」迟早会漂移。
importScripts('lib/naming.js');
// 注入清单与 executeScript 结果解析（唯一来源，popup 也引用同一份）
importScripts('lib/injectlist.js');
importScripts('lib/download.js');
// 版本检查内核（取 version.json / 比版本号 / 算节流），角标与存储在本文件底部
importScripts('lib/update.js');

const IMG_CONCURRENCY = 4;          // 图片并发下载上限
// 必须小于 MV3 service worker 的 30 秒空闲回收阈值。
// 下载卡死（DNS 无响应 / CDN 不返回数据）时不会有任何 onChanged 事件，
// 超时设成 20s 才能保证定时器先于后台被回收触发；否则 Promise 永远悬空、
// sendResponse 永不回调，popup / 浮窗的导出按钮会永久停在 disabled。
const DOWNLOAD_TIMEOUT = 20000;     // 单个下载超时（ms）
const MAX_MARKDOWN_BYTES = 1400000; // data URL 上限保护（base64 后约 1.9MB）
const PROGRESS_MIN_INTERVAL = 500;  // 进度消息节流（ms）

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
      .then(stats => sendResponse({ success: true, stats }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'EXPORT_FROM_FLOATING') {
    handleExportFromFloating(sender, message.data)
      .then(stats => sendResponse({ success: true, stats }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_OPTIONS') {
    openOptions(sender, message)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 检查更新：每次都是「读开关 → 节流判断 → 必要时联网」，开关关着直接返回，不发请求。
  if (message.type === 'CHECK_UPDATE') {
    checkUpdate({ force: !!message.force })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // 忽略某个版本：只是把角标压下去，不影响是否继续检查更新的版本
  if (message.type === 'SKIP_UPDATE') {
    skipUpdateVersion(message.version)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
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
      files: WXMD_INJECT_FILES
    });

    const articleData = WXMD_pickArticleData(results);
    if (!articleData || !articleData.success) {
      throw new Error((articleData && articleData.error) || '提取失败（未获取到页面返回数据）');
    }

    return await handleExport(articleData);
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

// ---------- 导出锁（同一篇文章不允许并行导出） ----------

// 浮窗按钮有 disabled，popup 按钮也有，但两个入口可以同时触发
// （浮窗点一次、立刻开弹窗再点一次），两套下载并发 8 路、conflictAction 互相改名，
// 结果是图片目录堆副本、md 指向不确定的那一份。
// 按「文章 URL」加锁而不是全局锁：不同文章同时导出是合理需求。
const EXPORT_LOCK_TTL = 10 * 60 * 1000;
const exportLocks = new Map();   // key -> 开始时间戳

function lockKeyOf(article) {
  const url = article && typeof article.url === 'string' ? article.url : '';
  const title = article && typeof article.title === 'string' ? article.title : '';
  return url || title || 'unknown';
}

function acquireExportLock(key) {
  const now = Date.now();
  // 过期锁自愈：SW 被回收、异常退出时 finally 不会执行，留着会永久卡死这篇
  for (const [k, at] of exportLocks) {
    if (now - at > EXPORT_LOCK_TTL) exportLocks.delete(k);
  }
  if (exportLocks.has(key)) return false;
  exportLocks.set(key, now);
  return true;
}

function releaseExportLock(key) {
  exportLocks.delete(key);
}

// ---------- 进度上报 ----------

/**
 * 让前端知道「还在动」，用于看门狗续期。
 *
 * 前端算不出真实耗时（图片数 × 单张超时），原先固定 60s + N×1.5s 的看门狗
 * 会在 20 张以上图片时提前报「超时」，而后台其实还在下载。
 * 这里每完成一张图（节流 500ms）发一条进度，前端收到就续期。
 * 没有接收方时 sendMessage 会 reject，必须吞掉，否则会打断导出。
 */
function createProgressReporter(total) {
  let done = 0;
  let lastAt = 0;
  return function tick() {
    done++;
    const now = Date.now();
    if (now - lastAt < PROGRESS_MIN_INTERVAL && done < total) return;
    lastAt = now;
    try {
      const p = chrome.runtime.sendMessage({ type: 'EXPORT_PROGRESS', done, total });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      // 没有接收方（popup 已关、浮窗已卸载）时忽略
    }
  };
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

/** 归一成 { mode, prefix }（含旧版 parent / vault 的迁移） */
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

/** 生成 Markdown 里的图片路径（权威实现在 lib/naming.js，配置页预览用的是同一份） */
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

/**
 * @returns {Promise<{total:number, failed:number, blocked:number, unresolved:number}>}
 *          统计回传前端：只显示「导出成功」而不说有几张图没下来，
 *          用户下次打开笔记看到裂图才发现，已经不知道该找什么了。
 */
async function handleExport(article) {
  if (!article || typeof article.markdown !== 'string' || !article.markdown.trim()) {
    throw new Error('导出数据无效（缺少 markdown 内容）');
  }

  const key = lockKeyOf(article);
  if (!acquireExportLock(key)) {
    throw new Error('这篇文章正在导出中，请等上一次完成后再试');
  }
  try {
    return await doExport(article);
  } finally {
    releaseExportLock(key);
  }
}

async function doExport(article) {
  const imageMode = article.imageMode === 'online' ? 'online' : 'download';
  const folderMode = article.folderMode === 'shared' ? 'shared' : 'per-article';
  const images = Array.isArray(article.images) ? article.images : [];
  const stats = { total: 0, failed: 0, blocked: 0, unresolved: 0 };
  // content.js 在收集阶段就已经拦掉一批（内网地址 / 非微信图床），它们根本没进 images 列表，
  // 但用户同样需要知道「这几张没下载」——从提取结果里接过来一起报。
  stats.blocked += Number(article.blockedImages) || 0;

  // 图片链接在 md 里怎么写（相对笔记 / 库内模糊 / 自定义前缀）
  const imageRef = resolveImageRefConfig(article);

  const { allowExternalImages } = await chrome.storage.local.get({ allowExternalImages: false });

  let markdown = article.markdown;
  let targetFolder = '';
  let mdName = '';

  if (imageMode === 'online') {
    // 在线模式不建目录，md 直接落在下载根目录
    mdName = safePath(article.onlineFilename) || 'article';
  } else if (folderMode === 'shared') {
    targetFolder = safePath(article.sharedFolder) || 'article';
    mdName = safePath(article.sharedFilename || article.onlineFilename) || 'article';
  } else {
    targetFolder = safePath(article.downloadFolder) || 'article';
    // 允许 downloadFolder 模板带子目录，但 md 文件名只用最后一段，
    // 避免出现 a/b/a/b.md 这种重复嵌套
    mdName = targetFolder.split('/').pop() || 'article';
  }

  // 目录过长时先统一压一次：md 与图片必须落在同一棵「压缩后」的树下，
  // 否则 limitPath 只裁了图片路径、md 里的引用还是完整目录，链接必然对不上。
  if (targetFolder) targetFolder = limitPath(targetFolder, 160);

  const targetFile = targetFolder ? `${targetFolder}/${mdName}.md` : `${mdName}.md`;

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
    stats.total = items.length;

    // 图片目录与文件名一起按「剩余预算」压：保证「实际落盘路径」和「md 引用」
    // 用的是同一组 imgDir / filename，不会一个裁了一个没裁。
    const budget = Math.max(20, 200 - (targetFolder ? targetFolder.length + 1 : 0));
    const planned = items.map(item => {
      const fit = fitImageRel(imgDir, `${item.filenameBase}.${item.realExt}`, budget);
      return fit;
    });

    // 先算出预算路径：下载失败时仍要落到一个合理的相对路径上
    const pathByIndex = new Map();
    planned.forEach((fit, i) => {
      pathByIndex.set(i, makeImageRef(imageRef.mode, fit.imgDir, fit.filename, targetFolder, imageRef.prefix));
    });

    // 体积预检：在线/本地两种模式的 md 体积都能在下载前估出来。
    // 原来要等所有图片落盘才在 toDataUrl 里撞上限，此时磁盘上已是一堆没人引用的孤儿图片。
    assertMarkdownSize(estimateMarkdownBytes(markdown, pathByIndex), 'download');

    // Chrome 命中同名文件时会改名成 "xxx (1).webp"，与上面预算的名字不同。
    // 因此占位符替换推迟到下载结束：优先用真实文件名，取不到再回退预算值。
    const actualPath = new Map();
    const reportProgress = createProgressReporter(items.length);

    await WXMD_DL.mapLimit(items, IMG_CONCURRENCY, async (item, i) => {
      try {
        if (!/^https?:\/\//i.test(item.url)) return;
        if (!isDownloadableImageUrl(item.url, allowExternalImages)) {
          stats.blocked++;
          // 不下载，但把原始地址写回去，避免 md 里留下未替换的 {{IMG_n}}
          actualPath.set(i, item.url);
          return;
        }
        const fit = planned[i];
        const downloadPath = targetFolder
          ? `${targetFolder}/${fit.imgDir ? fit.imgDir + '/' : ''}${fit.filename}`
          : (fit.imgDir ? fit.imgDir + '/' : '') + fit.filename;
        const res = await WXMD_DL.downloadFile(item.url, downloadPath, DOWNLOAD_TIMEOUT);
        if (res && res.filename && res.filename !== fit.filename) {
          // uniquify 产生的 "a (1).webp" 含空格与括号，直接塞进 markdown 会截断链接，
          // 只把空格编码掉（括号成对出现，CommonMark 可解析）
          const realName = res.filename.replace(/ /g, '%20');
          actualPath.set(i, makeImageRef(imageRef.mode, fit.imgDir, realName, targetFolder, imageRef.prefix));
        }
      } catch (err) {
        stats.failed++;
        // 失败时也要写一个真实可达的地址：回落到「按命名模板预算的路径」会指向
        // 一个并不存在的文件，md 里就是一张裂图；回写原始 URL 至少还能点开看。
        actualPath.set(i, item.url);
        console.warn('[wx-md] 图片下载失败:', item.url, err.message);
      } finally {
        reportProgress();
      }
    });

    // 一次性正则替换，避免 O(N × 文本长度) 的 split/join
    let replaced = 0;
    markdown = markdown.replace(/\{\{IMG_(\d+)\}\}/g, (match, idx) => {
      const i = Number(idx);
      const p = actualPath.get(i) ?? pathByIndex.get(i);
      if (p === undefined) return match;
      replaced++;
      return p;
    });
    // 占位符残留（理论上 content.js 已过滤非 http 图）：如实计数上报，
    // 否则用户只会在 md 里看到一行字面量 {{IMG_3}}，不知道发生了什么。
    const leftover = markdown.match(/\{\{IMG_\d+\}\}/g);
    stats.unresolved = leftover ? leftover.length : 0;
    if (stats.unresolved > 0) {
      console.warn(`[wx-md] ${stats.unresolved} 个图片占位符没有对应文件，保留原样`);
    }
    if (replaced === 0 && items.length > 0) {
      console.warn('[wx-md] md 里没有找到图片占位符，图片可能未被引用');
    }

    if (stats.failed > 0) {
      console.warn(`[wx-md] 本次共 ${stats.failed} / ${items.length} 张图片下载失败`);
    }
    if (stats.blocked > 0) {
      console.warn(`[wx-md] ${stats.blocked} 张图片未下载（内网地址或非微信图床），已保留在线链接`);
    }
  } else if (imageMode === 'online') {
    assertMarkdownSize(WXMD_DL.byteLength(markdown), 'online');
  }

  // Markdown 必须最后写：图片已经落盘，md 里的链接才会指向真实文件
  const mdTarget = limitPath(targetFile);
  const dataUrl = toMarkdownDataUrl(markdown, imageMode);
  const mdRes = await WXMD_DL.downloadFile(dataUrl, mdTarget, DOWNLOAD_TIMEOUT);
  // 顺手把浏览器下载根目录记下来，设置页要展示给用户看
  await rememberDownloadRoot(mdRes, mdTarget);

  return stats;
}

// ---------- 体积上限 ----------

/** 把超限错误统一成一句能指导操作的话 */
function assertMarkdownSize(bytes, mode) {
  if (bytes <= MAX_MARKDOWN_BYTES) return;
  const size = (bytes / 1024).toFixed(0);
  const limit = (MAX_MARKDOWN_BYTES / 1024).toFixed(0);
  const hint = mode === 'online'
    ? '请改用「下载到本地」模式后再导出'   // 本地模式把长 URL 换成短相对路径，体积更小
    : '请缩短「导出文件夹 / 图片命名」模板里的目录层级后再试';
  throw new Error(`文章内容过大（约 ${size}KB，上限 ${limit}KB），${hint}`);
}

/**
 * 估算替换占位符之后的 md 字节数。
 * 不精确但足够用来「提前拦住明显超限的导出」：最终写入前还会再校验一次真实字节数。
 */
function estimateMarkdownBytes(markdown, pathByIndex) {
  let bytes = WXMD_DL.byteLength(markdown);
  markdown.replace(/\{\{IMG_(\d+)\}\}/g, (match, idx) => {
    const p = pathByIndex.get(Number(idx));
    if (typeof p === 'string' && p.length > match.length) bytes += p.length - match.length;
    return match;
  });
  return bytes;
}

function toMarkdownDataUrl(markdown, mode) {
  try {
    return WXMD_DL.toDataUrl(markdown, MAX_MARKDOWN_BYTES);
  } catch (err) {
    // 预检已经拦过一次，走到这里说明估算偏低（例如 URL 里编码后的中文），
    // 用真实字节数与对应模式的建议重报一次
    if (err && err.wxmdTooLarge) assertMarkdownSize(err.wxmdTooLarge, mode);
    throw err;
  }
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
 * 内网 / 本机地址一律不下载；默认还要求命中微信图床白名单——
 * 只看 hostname 挡不住「域名解析到内网」的盲 SSRF，白名单才是真正的解法。
 */
function isDownloadableImageUrl(u, allowExternalImages) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (WXMD_isPrivateHost(parsed.hostname)) return false;
    if (!allowExternalImages && !WXMD_isWechatImageHost(parsed.hostname)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 路径净化 ----------

/**
 * 收敛成安全的相对路径；过滤 ..、绝对路径、非法字符、Windows 保留名与超长片段。
 * 权威实现在 lib/naming.js（配置页预览也用同一份），这里只保留一层降级垫片。
 */
function safePath(p) {
  if (typeof WXMD_NAMING !== 'undefined' && typeof WXMD_NAMING.sanitizePath === 'function') {
    return WXMD_NAMING.sanitizePath(p);
  }
  return String(p == null ? '' : p)
    .replace(/\\/g, '/')
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .map(seg => String(seg)
      .replace(/[<>:"|?*\x00-\x1f]/g, '_')
      .replace(/^[_\s]+/, '')
      .slice(0, 80)
      .replace(/[.\s]+$/, '')
      .replace(/_+$/, ''))
    .filter(Boolean)
    .join('/');
}

/**
 * 把「图片目录 + 文件名」压进 budget 字符内，返回压缩后的两段。
 *
 * 为什么不能只压整条路径：图片实际落盘路径和 md 里的引用是两处生成的，
 * 只有「先压好 imgDir/filename、再用同一组值生成引用」才能保证两者一致。
 * 压缩顺序：文件名主干 → 逐层去掉图片目录最外层 → 极端情况硬截文件名。
 */
function fitImageRel(imgDir, filename, budget) {
  const segs = String(imgDir || '').split('/').filter(Boolean);
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot) : '';
  let stem = dot > 0 ? filename.slice(0, dot) : filename;

  const build = () => (segs.length ? segs.join('/') + '/' : '') + stem + ext;

  while (build().length > budget && stem.length > 8) {
    stem = stem.slice(0, Math.max(8, stem.length - 4));
  }
  while (build().length > budget && segs.length > 1) {
    segs.shift();
  }
  if (build().length > budget) {
    const room = budget - (segs.length ? segs.join('/').length + 1 : 0) - ext.length;
    stem = stem.slice(0, Math.max(4, room));
  }
  return { imgDir: segs.join('/'), filename: stem + ext };
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

// ---------- 下载根目录反推 ----------

/**
 * Chrome 没有「读取默认下载目录」的 API。
 * 唯一可靠的办法是反推：拿一次真实落盘的绝对路径，扣掉我们传进去的相对路径，
 * 剩下的前缀就是浏览器的下载根目录。纯展示用途，任何异常都静默忽略。
 */
async function rememberDownloadRoot(res, relPath) {
  try {
    const full = String((res && res.fullPath) || '');
    if (!WXMD_DL.isAbsolutePath(full)) return;

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

/* ============================================================================
 * 版本更新提醒
 * ----------------------------------------------------------------------------
 * 策略：默认关闭（updateNotify: false），关着时一次网络请求都不发。
 *   打开后：装/启动时查一次 + 每 24 小时一次（alarms 是 MV3 后台唯一能存活的定时器，
 *   setTimeout 在 worker 被回收后必然丢失）。
 *   有新版 → 工具栏角标 NEW + 配置页/弹窗提示。
 * 边界：从不自动安装。Chrome/Edge 的扩展没有自我安装能力，
 *   商店版的更新由浏览器自己完成，这里只负责「让人知道」。
 * ========================================================================== */
const UPDATE_ALARM = 'wxmd-update-check';
const UPDATE_CHECK_MINUTES = 24 * 60;
const UPDATE_STATE_DEFAULTS = {
  updateNotify: false,
  updateLastCheckAt: 0,
  updateLastFailAt: 0,
  updateLastError: '',
  updateSkipVersion: '',
  updateLatest: null
};

function readUpdateState() {
  return chrome.storage.local.get(UPDATE_STATE_DEFAULTS);
}

function setBadge(text) {
  try {
    chrome.action.setBadgeText({ text: text || '' });
    if (text) chrome.action.setBadgeBackgroundColor({ color: '#07C160' });
  } catch (e) {}
}

/** 角标只反映「开关开着 + 确实有新版 + 这个版本没被忽略」 */
async function refreshUpdateBadge() {
  const s = await readUpdateState();
  const p = s.updateLatest;
  const show = !!(s.updateNotify && p && p.ok && p.hasUpdate && p.latest !== s.updateSkipVersion);
  setBadge(show ? 'NEW' : '');
}

function ensureUpdateAlarm(enabled) {
  try {
    if (enabled) {
      chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
    } else {
      chrome.alarms.clear(UPDATE_ALARM);
    }
  } catch (e) {}
}

/**
 * 检查一次（可能被节流跳过）。
 * force=true 用于用户点「检查更新」——绕过 24 小时节流，但仍然要求开关是开着的，
 * 否则会出现「开关关着却发了请求」这种和文案矛盾的行为。
 */
async function checkUpdate(opts) {
  const force = !!(opts && opts.force);
  const s = await readUpdateState();
  const current = WXMD_UPDATE.currentVersion();

  if (!s.updateNotify) {
    setBadge('');
    return { ok: true, disabled: true, current, hasUpdate: false };
  }

  if (!force && !WXMD_UPDATE.shouldCheck({ lastCheckAt: s.updateLastCheckAt, lastFailAt: s.updateLastFailAt })) {
    const p = s.updateLatest;
    return p && p.ok
      ? { ...p, cached: true }
      : { ok: true, cached: true, current, hasUpdate: false };
  }

  const res = await WXMD_UPDATE.check({ current });
  if (res.ok) {
    await chrome.storage.local.set({
      updateLastCheckAt: Date.now(),
      updateLastFailAt: 0,
      updateLastError: '',
      updateLatest: res
    });
  } else {
    // 失败只记时间戳与原因，保留上一次的成功结果：断网时不该把已知的新版本信息抹掉
    await chrome.storage.local.set({
      updateLastFailAt: Date.now(),
      updateLastError: res.error || '未知错误'
    });
  }
  await refreshUpdateBadge();
  return res;
}

async function skipUpdateVersion(version) {
  const v = String(version || '').trim();
  if (!v) return;
  await chrome.storage.local.set({ updateSkipVersion: v });
  setBadge('');
}

/** 装好 / 每次启动浏览器都走一遍：补上定时器，并按开关决定要不要立刻查一次 */
async function bootstrapUpdate() {
  try {
    const s = await readUpdateState();
    ensureUpdateAlarm(s.updateNotify);
    if (!s.updateNotify) {
      setBadge('');
      return;
    }
    await checkUpdate({ force: false });
    await refreshUpdateBadge();
  } catch (e) {
    // 更新提醒坏了不能影响导出
  }
}

chrome.runtime.onInstalled.addListener(() => { bootstrapUpdate(); });
chrome.runtime.onStartup.addListener(() => { bootstrapUpdate(); });

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm && alarm.name === UPDATE_ALARM) {
    checkUpdate({ force: false }).catch(() => {});
  }
});

// 用户在配置页开了/关了开关：立刻生效，不用等下一次 alarms 周期
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.updateNotify) return;
  const on = !!changes.updateNotify.newValue;
  ensureUpdateAlarm(on);
  if (on) checkUpdate({ force: true }).catch(() => {});
  else setBadge('');
});
