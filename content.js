// content.js —— 提取文章正文并转换为 Markdown
// 注入顺序（顺序不能乱，后面的依赖前面的全局变量）：
//   见 lib/injectlist.js 的 WXMD_INJECT_FILES（唯一来源，background / popup 都引用它）
// 分工：代码块 = lib/codeblock.js，特殊排版 = lib/compat.js，
//       引用块/列表 = lib/blocks.js，表格 = lib/tables.js，
//       视频/语音附件 = lib/attachment.js，图片消息（图文/小绿书）= lib/imagepost.js，
//       其余（图片、段落、YAML）在本文件。
(async function () {
  // 版本号只有 manifest 一个来源，避免「manifest 升了、日志里还是旧版本」查错方向
  const VERSION = (function () {
    try { return 'v' + chrome.runtime.getManifest().version; } catch (e) { return 'unknown'; }
  })();
  const DEBUG = false;
  const LOG = DEBUG ? (...args) => console.log('[wechat-to-md ' + VERSION + ']', ...args) : () => {};

  // 正文根节点候选，按顺序命中第一个。
  //   1. #js_content：普通图文的正式容器；
  //   2. .rich_media_content：#js_content 的 class，个别模板只留 class；
  //   3. #js_image_content：图片消息（图文/小绿书），某些版本不套 #js_content，
  //      这时正文（标题 + 描述）就在它里面，图片由 lib/imagepost.js 从轮播区补。
  // 只认第一个的话，第 3 种模板会直接报「未找到文章正文」。
  const ARTICLE_SELECTOR = '#js_content';
  const ARTICLE_ROOT_SELECTORS = [ARTICLE_SELECTOR, '.rich_media_content', '#js_image_content'];
  const TITLE_SELECTOR = '#activity-name';
  const AUTHOR_SELECTOR = '#js_name';
  const PUBLISH_TIME_SELECTOR = '#publish_time';
  // background 的 bridgePageData() 写进来的完整发布时间（分享页只有「1月21日」时用）
  const PUB_BRIDGE_ATTR = 'data-wxmd-published';
  // 同上，公众号名（分享页不渲染 #js_name）
  const AUTHOR_BRIDGE_ATTR = 'data-wxmd-author';

  // 播放器残留外壳：权威清单在 lib/attachment.js（与那边共用一份，避免两处各改各的），
  // 模块异常时才用这份精简兜底。
  const PLAYER_CHROME_SEL = (typeof WXMD_ATTACH !== 'undefined' && WXMD_ATTACH.PLAYER_CHROME_SEL)
    ? WXMD_ATTACH.PLAYER_CHROME_SEL
    : '.video_iframe, .appmsg_video, .feed-wrapper, .video_tail_module';

  // 围栏代码块整体跳过，细节见 tidyMarkdown
  const FENCE_RE = /(^|\n)(```[^\n]*\n[\s\S]*?\n```[ \t]*(?=\n|$))/g;

  // 浮窗传来的「本次选择」，用完即弃，不写回 storage
  const override = globalThis.__WXMD_OVERRIDE__ || {};
  try { delete globalThis.__WXMD_OVERRIDE__; } catch (e) {}

  const DEFAULTS = (typeof WXMD_DEFAULTS !== 'undefined')
    ? WXMD_DEFAULTS
    : {
        imageMode: 'download',
        folderMode: 'per-article',
        allowExternalImages: false,
        imagePathMode: 'note',
        imageRefPrefix: '/微信/{{noteFolder}}/',
        onlineFilename: '{{date:YYYYMMDD}}_{{title}}',
        downloadFolder: '{{date:YYYYMMDD}}_{{title}}',
        sharedFolder: '{{date:YYYYMMDD}}',
        sharedFilename: '{{date:YYYYMMDD}}_{{title}}',
        imageFolder: '{{date:YYYY}}/{{date:MM}}/{{date:DD}}',
        imageFilename: 'IMG_{{date:YYYYMMDD}}{{time:HHmmssSSS}}_{{index1}}',
        sharedImageFolder: '{{date:YYYY}}/{{date:MM}}/{{date:DD}}',
        sharedImageFilename: 'IMG_{{date:YYYYMMDD}}{{time:HHmmssSSS}}_{{index1}}'
      };

  // ---------- 依赖检查（lib/defaults.js、lib/naming.js 由 executeScript 先行注入）----------

  // 命名规则缺失就没有任何可用的文件名，属于不可降级的硬依赖，直接返回结构化错误。
  if (typeof WXMD_NAMING === 'undefined' || typeof WXMD_NAMING.resolveTemplate !== 'function') {
    return { success: false, error: '命名模块未加载（lib/naming.js），请重新加载扩展后重试' };
  }
  const resolveTemplate = WXMD_NAMING.resolveTemplate;
  const resolveDateOnlyTemplate = WXMD_NAMING.resolveDateOnlyTemplate;
  // {{ext}} 用这张图的真实格式。与 background.js 落盘补后缀调的是同一个函数，
  // 所以模板里写 {{ext}}、和最终落盘的 .png / .webp 不会各说一套。
  const imgExtFromUrl = (typeof WXMD_NAMING.extFromUrl === 'function')
    ? WXMD_NAMING.extFromUrl
    : function fallbackExt() { return 'jpg'; };

  // 私有地址判断缺失时可以降级，但不能「静默失效」——否则每张图都会因
  // ReferenceError 被 isDownloadableImageUrl 的 catch 吞掉，整篇文章的图片全变成在线链接。
  // 下面这份内置实现与 lib/defaults.js 的规则保持一致（权威实现在那边），
  // 只在注入异常时兜底，保证功能不中断、SSRF 防护也不至于关掉。
  if (typeof WXMD_isPrivateHost !== 'function') {
    console.warn('[wx-md] lib/defaults.js 未加载，已启用内置的简化内网地址判断');
  }
  const isPrivateHost = (typeof WXMD_isPrivateHost === 'function')
    ? WXMD_isPrivateHost
    : function fallbackIsPrivateHost(hostname) {
        const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
        if (!h) return true;
        if (h === 'localhost' || h === '::1' || h === '::') return true;
        if (/\.(localhost|local|internal|home\.arpa)$/.test(h)) return true;
        if (/^(fc|fd|fe8|fe9|fea|feb)/.test(h)) return true;
        const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (m) {
          const a = Number(m[1]);
          const b = Number(m[2]);
          return a === 0 || a === 10 || a === 127
            || (a === 192 && b === 168)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 169 && b === 254)
            || (a === 100 && b >= 64 && b <= 127);
        }
        return !h.includes('.') && !h.includes(':');
      };

  const settings = await chrome.storage.local.get(DEFAULTS);

  // 是否下载「非微信图床」的图片，见 lib/defaults.js 的 WXMD_DEFAULTS.allowExternalImages
  const allowExternalImages = !!settings.allowExternalImages;

  const imageMode = (override.imageMode === 'online' || override.imageMode === 'download')
    ? override.imageMode
    : (settings.imageMode === 'online' ? 'online' : 'download');
  const folderMode = (override.folderMode === 'shared' || override.folderMode === 'per-article')
    ? override.folderMode
    : (settings.folderMode === 'shared' ? 'shared' : 'per-article');

  // 图片引用路径只影响 md 里的链接写法，不影响落盘位置。
  // 逐篇 / 平铺各存一份配置，按本次的归档方式取用；旧版 parent / vault 照旧迁移。
  // 键单独读一遍：DEFAULTS 里不含分档字段，get(DEFAULTS) 拿不到它们。
  const rawRefCfg = await chrome.storage.local.get([
    'perArticleImagePathMode',
    'perArticleImageRefPrefix',
    'sharedImagePathMode',
    'sharedImageRefPrefix',
    'imagePathMode',
    'imageRefPrefix'
  ]);
  const imageRef = (typeof WXMD_NAMING.resolveImageRefForFolder === 'function')
    ? WXMD_NAMING.resolveImageRefForFolder(rawRefCfg, folderMode)
    : WXMD_NAMING.resolveImageRefConfig(rawRefCfg);

  // 逐篇 / 平铺各有一套图片规则，按当前归档方式取用
  const useSharedImageRule = folderMode === 'shared';
  const imageFolderTemplate = String(
    (useSharedImageRule
      ? (settings.sharedImageFolder ?? settings.imageFolder)
      : settings.imageFolder) ?? ''
  );
  const imageFilename = String(
    (useSharedImageRule
      ? (settings.sharedImageFilename ?? settings.imageFilename)
      : settings.imageFilename) || 'IMG_{{index1}}'
  );

  // ---------- 文章元数据 ----------

  // 标题来源不止 #activity-name：图片消息 / 新版分享页只有 h1.rich_media_title，
  // 视频号 / 文字消息又各有一套节点，统一交给 lib/defaults.js 的 WXMD_pickTitle。
  const title = (typeof WXMD_pickTitle === 'function')
    ? WXMD_pickTitle(document)
    : (() => {
        const el = document.querySelector(TITLE_SELECTOR);
        return (el && el.innerText.trim()) || document.title.trim();
      })();

  const authorEl = document.querySelector(AUTHOR_SELECTOR);
  let author = authorEl ? authorEl.innerText.trim() : '';

  // 取完整发布时间，读完立即删掉桥属性（不留在页面上）。
  const takeBridgedPublished = () => {
    try {
      const root = document.documentElement;
      const v = root.getAttribute(PUB_BRIDGE_ATTR) || '';
      if (v) root.removeAttribute(PUB_BRIDGE_ATTR);
      return v.trim();
    } catch (e) {
      return '';
    }
  };

  // 分享页的头部不渲染公众号名：正文里找不到 #js_name，但页面数据里是有的。
  // 只在 DOM 取不到时才采用；不论用不用都读走即删，避免属性残留在页面上。
  const bridgedAuthor = (() => {
    try {
      const root = document.documentElement;
      const v = (root.getAttribute(AUTHOR_BRIDGE_ATTR) || '').trim();
      if (v) root.removeAttribute(AUTHOR_BRIDGE_ATTR);
      return v;
    } catch (e) {
      return '';
    }
  })();
  if (!author && bridgedAuthor) author = bridgedAuthor;

  // 分享页 / 从聊天点开的模板里，#publish_time 只渲染「1月21日」，年份被省掉，
  // 完整值（2026-01-21 23:25）只在页面全局变量里，由背景脚本提前搬到 DOM。
  // 只在 DOM 缺年份时才用桥数据 —— 普通图文 DOM 已带年份，行为完全不变。
  let published = '';
  const timeEl = document.querySelector(PUBLISH_TIME_SELECTOR);
  const domPublished = timeEl ? timeEl.innerText.trim() : '';
  const bridgedPublished = takeBridgedPublished();
  if (domPublished && /\d{4}/.test(domPublished)) {
    published = domPublished;
  } else {
    published = bridgedPublished || domPublished;
  }

  // 桥也没拿到（老浏览器 / 注入被拒）时，DOM 里的「1月21日」仍是残值：
  // 补成推断出来的完整日期，让 frontmatter 和 {{published}} 至少能排序。
  // 推断规则见 lib/naming.js 的 parsePublishedDate（最近一个已过去的该月日）。
  if (published && !/\d{4}/.test(published)
    && typeof WXMD_NAMING !== 'undefined' && WXMD_NAMING.parsePublishedDate) {
    const guess = WXMD_NAMING.parsePublishedDate(published);
    if (guess) {
      const p = n => String(n).padStart(2, '0');
      const day = `${guess.getFullYear()}-${p(guess.getMonth() + 1)}-${p(guess.getDate())}`;
      // 原文没写时分时不要补 00:00 —— 那等于编了一个「凌晨发布」
      published = /\d{1,2}:\d{2}/.test(published)
        ? `${day} ${p(guess.getHours())}:${p(guess.getMinutes())}`
        : day;
    }
  }

  const url = location.href;
  const articleMeta = {
    title,
    author,
    published,
    url,
    domain: 'mp.weixin.qq.com',
    site: '微信公众号'
  };

  // ---------- 模板解析 ----------

  const resolvedOnlineFilename = resolveTemplate(settings.onlineFilename, 0, url, articleMeta, false);
  const resolvedDownloadFolder = resolveTemplate(settings.downloadFolder, 0, url, articleMeta, true);
  const resolvedSharedFolder = resolveDateOnlyTemplate(settings.sharedFolder);
  const resolvedSharedFilename = resolveTemplate(settings.sharedFilename, 0, url, articleMeta, false);
  // 图片目录在图片收集时按张解析（模板里的 {{ext}} 用每张图自己的格式），
  // 所以这里只记「文章级兜底目录」，见下面 resolvedImageFolder

  LOG('resolved config', {
    imageMode, folderMode,
    onlineFilename: resolvedOnlineFilename,
    downloadFolder: resolvedDownloadFolder,
    sharedFolder: resolvedSharedFolder,
    sharedFilename: resolvedSharedFilename
  });

  // ---------- 正文提取 ----------

  let contentEl = null;
  for (const sel of ARTICLE_ROOT_SELECTORS) {
    contentEl = document.querySelector(sel);
    if (contentEl) {
      if (sel !== ARTICLE_SELECTOR) LOG('article root fallback:', sel);
      break;
    }
  }
  if (!contentEl) {
    return { success: false, error: '未找到文章正文' };
  }

  const clone = contentEl.cloneNode(true);

  // ---------- 视频 / 语音等附件：只留在线链接 ----------
  // 图片以外的附件一律不下载（直链带 auth_key 会过期、视频号分片加密），
  // 统一换成 <wxmd-link> 占位，只写「能点开看」的在线地址。
  // 实现见 lib/attachment.js，这里只负责调用与降级。
  //
  // 放在图片统计之前：播放器里常包着封面图，播放器整块被替换后那张图不在正文里了，
  // 先换掉可以让它不被计入图片列表（否则会白下一张没人引用的封面）。
  // 缺模块不阻断导出时 video/iframe 会在下面统一清掉，只是少了链接与编号
  if (typeof WXMD_ATTACH !== 'undefined' && typeof WXMD_ATTACH.collect === 'function') {
    WXMD_ATTACH.collect(clone, LOG);   // 内部会 LOG('attachments', n)
  } else {
    console.error('[wx-md] lib/attachment.js 未加载，本次导出的视频/语音不会生成链接');
  }

  // ---------- 图片消息（图文/小绿书）：图片在正文容器之外 ----------
  // 这种模板下 #js_content 里只有文字，图片全在 #img_list 轮播区，
  // 所以 clone 里一张 <img> 都没有。模块把图按顺序补进 clone、删掉 UI 噪音，
  // 之后就与普通图文完全同构，下面的图片统计与下载链路原样复用。
  // 实现见 lib/imagepost.js；不是图片消息时内部直接返回，普通图文零影响。
  if (typeof WXMD_IMAGEPOST !== 'undefined' && typeof WXMD_IMAGEPOST.prepare === 'function') {
    WXMD_IMAGEPOST.prepare(clone, document, LOG);   // 内部会 LOG('image post', n)
  } else {
    console.error('[wx-md] lib/imagepost.js 未加载，图片消息类文章可能导出 0 张图');
  }

  // ---------- 图片：唯一会下载的附件 ----------
  const images = clone.querySelectorAll('img');
  const imageList = [];
  let blockedImages = 0;

  images.forEach(img => {
    let realSrc = img.getAttribute('data-src') || img.getAttribute('src') || '';
    realSrc = realSrc.trim();

    // 协议相对 URL（//mmbiz.qpic.cn/...）不能直接判为无效，否则图片会被静默删除
    if (realSrc.startsWith('//')) realSrc = 'https:' + realSrc;

    if (!/^https?:\/\//i.test(realSrc)) {
      img.remove();
      return;
    }

    img.setAttribute('src', realSrc);
    img.removeAttribute('data-src');

    if (imageMode === 'download') {
      // 图片地址完全由文章作者控制：内网 / 本机地址，以及（默认）非微信图床的地址
      // 一律不下载，否则恶意文章能让扩展带着用户身份去请求内网设备（blind SSRF）。
      // 这里只降级为在线链接，不删除节点，避免静默丢内容。
      if (!isDownloadableImageUrl(realSrc)) {
        blockedImages++;
        return;
      }
      const idx = imageList.length;
      // ext 是这张图自己的真实格式（渲染成大写 PNG / JPG / WEBP）：
      // 图片命名各用各的，图片目录也各用各的 —— 目录模板里写了 {{ext}}，
      // 一篇 png/jpg 混排的文章就会分别落到 PNG/ 与 JPG/ 两个子目录。
      const imgMeta = { ...articleMeta, ext: imgExtFromUrl(realSrc) };
      const filenameBase = resolveTemplate(imageFilename, idx, realSrc, imgMeta, false);
      // 目录的 index 固定传 0：目录不该跟着图片序号变，否则一张图一个目录。
      // 只有 ext 按张取，其余变量（标题 / 日期 / 序号）全篇一致。
      const folder = resolveTemplate(imageFolderTemplate, 0, url, imgMeta, true);
      img.setAttribute('data-img-idx', String(idx));
      imageList.push({ url: realSrc, filenameBase, folder });
    }
  });

  if (blockedImages > 0) {
    console.warn(
      `[wx-md] ${blockedImages} 张图片未下载（内网地址或非微信图床），已保留在线链接`
    );
  }

  // 文章级图片目录：与「按张目录」保持同一份兜底值，取第一张图那一段。
  // 真正落盘用的是每张图自己的 folder（见上面 imageList.push），这里只用于
  // 统计、日志与老载荷兼容；没有可下载图片时 {{ext}} 为空，目录名少这一段
  // 而不是留 {{ext}} 字面量。
  const resolvedImageFolder = imageList.length
    ? imageList[0].folder
    : resolveTemplate(imageFolderTemplate, 0, url, articleMeta, true);
  LOG('resolved image folder', resolvedImageFolder,
    imageList.length ? imgExtFromUrl(imageList[0].url) : '(无图片)');

  /** 可下载的图片地址：仅 http(s)、不指向内网，且（默认）命中微信图床白名单 */
  function isDownloadableImageUrl(u) {
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (isPrivateHost(parsed.hostname)) return false;
      // 字面 hostname 判断挡不住「域名解析到内网」的 SSRF（扩展里没有 DNS 能力），
      // 所以默认只下载已知图床；确有可信第三方图床时在配置页打开 allowExternalImages。
      if (!allowExternalImages) {
        const isWxHost = typeof WXMD_isWechatImageHost === 'function'
          ? WXMD_isWechatImageHost(parsed.hostname)
          : true;   // 兜底模块缺失时不误杀，宁可少一层防护也不要整篇图变在线链接
        if (!isWxHost) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // 清理脚本、样式、广告等无关节点
  clone.querySelectorAll(
    'script, style, iframe, video, audio, mp-common-videosnippet, mp-common-videochannels, .js_ad_link, .rich_media_tool'
  ).forEach(el => el.remove());

  // 播放器外壳：能读出地址的已经在上面整块换成占位，这里清的是「读不出地址」的残留。
  // 留着的话「已关注关注重播 分享 赞 / 关闭观看更多 / 倍速播放中…」会被当正文导出。
  clone.querySelectorAll(PLAYER_CHROME_SEL).forEach(el => el.remove());

  // 空标题：排版件常拿 <h1><br></h1> 撑间距，导出后会留一行孤零零的「#」。
  // 只删「既没有文字也没有媒体」的，带图片/链接的标题容器不动。
  clone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    if (h.textContent.trim()) return;
    if (h.querySelector('img, svg, video, audio, iframe, canvas, wxmd-link')) return;
    h.remove();
  });

  // ---------- 结构归一（模块 + 本文件规则）----------
  // 顺序是固定的，四条规则互不重叠：
  //   1. 代码块（lib/codeblock.js）——先把 <pre>/等宽 <p> 认成标准 code，
  //      否则后面的段落规则会把代码行当正文；
  //   2. 引用块——带左右边框的容器算引用（微信里的引用几乎都靠边框画），
  //      先定归属，引用块内部不再做任何结构改写；
  //   3. 特殊排版（lib/compat.js）——手写序号改写成 <ol start>、浮动序号并回正文、
  //      伪标题换成 h2/h3，内部会跳过 blockquote / li / pre / table；
  //   4. 嵌套列表归位——只动 ul/ol 的父子关系；
  //   5. 表格单元格摊平——把单元格里的块级容器压成一行，否则整张表退化成普通段落。
  // 2 在 3 前面是有意的：宁可把「带左边框的标题」当引用块，也不要把引用块
  // 拆成标题——引用块的边框是作者明确的排版意图，标题只是我们的猜测。

  // 代码块整理在 lib/codeblock.js（等宽 <p> / 编辑器 pre / 伪 pre 三条路径都收在那里）
  if (WXMD_CODE && typeof WXMD_CODE.normalizeCodeBlocks === 'function') {
    WXMD_CODE.normalizeCodeBlocks(clone, LOG);
  } else {
    // 缺这个模块不阻断导出，但代码块会退化成行内 code（整段粘一行、没有围栏），
    // 必须明确报出来，否则会被当成「代码块适配又失效了」去查错方向。
    console.error('[wx-md] lib/codeblock.js 未加载，本次导出的代码块可能失真');
  }

  if (WXMD_BLOCKS && typeof WXMD_BLOCKS.normalizeQuotes === 'function') {
    WXMD_BLOCKS.normalizeQuotes(clone, LOG);
  } else {
    console.error('[wx-md] lib/blocks.js 未加载，本次导出的引用块可能失真');
  }

  // 特殊排版兼容（浮动序号、伪标题等）在 lib/compat.js，后续同类兼容都往那里加
  if (WXMD_COMPAT && typeof WXMD_COMPAT.normalizeCompat === 'function') {
    WXMD_COMPAT.normalizeCompat(clone, LOG);
  } else {
    console.error('[wx-md] lib/compat.js 未加载，个别特殊排版（如「一、背景」这类伪标题）可能失真');
  }

  if (WXMD_BLOCKS && typeof WXMD_BLOCKS.normalizeNestedLists === 'function') {
    WXMD_BLOCKS.normalizeNestedLists(clone, LOG);
  } else {
    console.error('[wx-md] lib/blocks.js 未加载，嵌套列表可能被拍平成一级');
  }

  // 表格单元格：把单元格里的块级结构（section / p / div）摊平成一行。
  // 不做这一步的话，wechatSection 规则会在每个单元格内部补空行，
  // GFM 表格一行就是一行，空行会把整张表拆成一堆带「|」的普通段落。
  if (WXMD_TABLES && typeof WXMD_TABLES.normalizeTableCells === 'function') {
    WXMD_TABLES.normalizeTableCells(clone, LOG);
  } else {
    console.error('[wx-md] lib/tables.js 未加载，本次导出的表格可能退化成普通段落');
  }

  // 修复真 <pre> 里的 <br>：用 DOM 操作，避免 innerHTML 重建整棵子树
  clone.querySelectorAll('pre br').forEach(br => br.replaceWith('\n'));

  if (typeof TurndownService === 'undefined') {
    return { success: false, error: 'Turndown 库未加载' };
  }

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  });
  if (typeof turndownPluginGfm !== 'undefined') {
    turndownService.use(turndownPluginGfm.gfm);
  }

  // 微信特有的 <section>
  // 这个标签身兼两职：既当布局容器（包图片卡片、卡片组），又当段落本身
  // （部分排版器导出的是 <section><span>正文</span></section>，里面没有 <p>）。
  // 早先一律不加换行，结果纯文本段落的 section 会整篇粘成一段——
  // 表现就是「图片后面的正文接在图注上、没有换行」。
  // 现在按内容判定：只有行内内容的叶子 section 当段落处理，含块级子元素的仍是容器。
  const BLOCK_KID_RE = /^(P|DIV|SECTION|ARTICLE|ASIDE|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|PRE|BLOCKQUOTE|H[1-6]|FIGURE|FIGCAPTION|HR|FORM|FIELDSET|DL|DT|DD|ADDRESS|CENTER|HEADER|FOOTER|MAIN|NAV|VIDEO|AUDIO|IFRAME)$/;

  turndownService.addRule('wechatSection', {
    filter: ['section'],
    replacement: (content, node) => {
      const trimmed = content.replace(/^\n+|\n+$/g, '');
      if (!trimmed) return '';
      // 表格单元格里不能有空行：GFM 表格一行就是一行，单元格内换行会把这一行拆散
      if (node.closest('th, td')) return trimmed;
      const inBlockquote = !!node.closest('blockquote');
      // 列表项里的 section 只是那一项的内容，多补空行会把紧凑列表撑成松散列表
      if (node.closest('li')) return inBlockquote ? '\n\n' + trimmed + '\n\n' : content;
      const hasBlockKid = Array.prototype.some.call(
        node.children,
        el => BLOCK_KID_RE.test(el.tagName)
      );
      if (!hasBlockKid) return '\n\n' + trimmed + '\n\n';
      return inBlockquote ? '\n\n' + trimmed + '\n\n' : content;
    }
  });

  // 图片：下载模式用占位符，在线模式保留原始链接
  turndownService.addRule('wechatImage', {
    filter: 'img',
    replacement: (content, node) => {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (!src) return '';
      const idx = node.getAttribute('data-img-idx');
      const img = (imageMode === 'download' && idx !== null)
        ? `![${alt}]({{IMG_${idx}}})`
        : `![${alt}](${src})`;
      // 表格单元格里的图片不能带空行，否则整行被拆散
      return node.closest('th, td') ? img : '\n\n' + img + '\n\n';
    }
  });

  // 表格的两条规则（单元格压成一行、单元格内 <br> 写字面 <br>）在 lib/tables.js。
  // 必须排在 gfm 的 tableCell 之后注册：Turndown 后注册的规则优先，否则被 gfm 覆盖回旧行为。
  if (WXMD_TABLES && typeof WXMD_TABLES.installRules === 'function') {
    WXMD_TABLES.installRules(turndownService);
  }

  // 视频 / 语音：不下载本体，只写在线链接；label 里带来源，点开前就知道是什么
  turndownService.addRule('wxmdAttachmentLink', {
    filter: node => node.nodeName && node.nodeName.toLowerCase() === 'wxmd-link',
    replacement: (content, node) => {
      const href = node.getAttribute('data-href') || '';
      const label = node.getAttribute('data-label') || '附件';
      if (!href) return '';
      return '\n\n[' + label + '](' + href + ')\n\n';
    }
  });

  // 装饰性的空 span/div 清掉，同时保住 div 的块级间距。
  // 注意：textContent 不统计元素，<div style><img></div> 的 textContent 也是空。
  // 直接判空会把已渲染好的 {{IMG_n}} 一起丢掉（图片下载了却无人引用），
  // 因此必须先用 querySelector 兜住 void/媒体元素，与 Turndown 的 hasVoid 判定对齐。
  turndownService.addRule('removeEmptyInline', {
    filter: ['span', 'div'],
    replacement: (content, node) => {
      const trimmed = content.replace(/^\n+|\n+$/g, '');
      if (!trimmed) {
        if (node.querySelector('img, br, svg, video, audio, iframe, canvas, input, picture, wxmd-link')) {
          return content;
        }
        return '';
      }
      // span 是行内元素：原样返回
      if (node.nodeName !== 'DIV') return content;
      // div 是块级元素：必须自己补空行。早先这里统一 return content，
      // Turndown 默认规则给的块级间距被吞掉 —— 用 <div> 直装正文段落的文章
      // （转载模板、部分第三方编辑器）整篇会粘成一段，不报错、不告警。
      if (node.closest('th, td')) return trimmed;        // 表格单元格里不能有换行
      if (node.closest('li')) return content;            // 列表项里补空行会把紧凑列表撑散
      return '\n\n' + trimmed + '\n\n';
    }
  });

  // 直接传 DOM 节点：这版 Turndown 的 RootNode 对非字符串入参走 input.cloneNode(true)，
  // 省掉「序列化成 innerHTML → DOMParser 重新解析」的一整圈往返。
  // 多出来的根节点是 <div>，前后空行会被 tidyMarkdown 的清尾清理掉，输出不变。
  let markdown = turndownService.turndown(clone);
  markdown = tidyMarkdown(markdown);

  // YAML 单引号风格：只需把 ' 转义成 ''，换行折叠为空格。
  // 单引号标量本身会把 \u2028/\u2029/\u0085 折叠成空格，不会破坏结构；
  // 真正非法的是 C0 控制字符（YAML 只允许 Tab），从 PDF/Word 复制时偶有残留。
  const yamlStr = s => "'" + String(s == null ? '' : s)
    .replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/'/g, "''") + "'";

  /**
   * 本地时区的 ISO 8601 时间戳（带偏移，如 2026-11-27T01:19:18.123+08:00）。
   *
   * 为什么不用 toISOString()：它固定输出 UTC，末尾是 Z。东八区凌晨 0–8 点导出的
   * 文件，日期会退回前一天（01:19 写成前一天 17:19），按日期排序直接错位，
   * 看上去像「时间不是实时的」——其实时刻没错，只是换了参照系。
   *
   * 这里用系统时区偏移拼出 +08:00 / -05:00，日期与本地一致，仍是合法 ISO 8601，
   * Dataview、dayjs 都能直接解析，调用方不用再补时区。跨时区导出时偏移跟随系统，
   * 所以不同机器上仍能还原出各自的真实时刻。
   */
  const toLocalIso = d => {
    const p = (n, w) => String(n).padStart(w || 2, '0');
    const off = -d.getTimezoneOffset();          // 分钟；东八区是 480
    const abs = Math.abs(off);
    return p(d.getFullYear(), 4) + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      + '.' + p(d.getMilliseconds(), 3)
      + (off >= 0 ? '+' : '-') + p(Math.floor(abs / 60)) + ':' + p(abs % 60);
  };

  const frontmatter =
    '---\n' +
    `title: ${yamlStr(title)}\n` +
    `author: ${yamlStr(author)}\n` +
    `source: ${yamlStr(url)}\n` +
    `published: ${yamlStr(published)}\n` +
    `exported: ${yamlStr(toLocalIso(new Date()))}\n` +
    '---\n\n';

  markdown = frontmatter + markdown + '\n';

  // ---------- 内部工具函数 ----------
  // 只在本文件用：模板解析 lib/naming.js、代码块 lib/codeblock.js、特殊排版 lib/compat.js、
  // 引用块/列表 lib/blocks.js、表格 lib/tables.js、附件 lib/attachment.js。
  // 本文件只剩「收尾整理」这一件事。

  /** 段内整理：清掉只含空格的空段落、压缩三连以上空行 */
  function tidyText(seg) {
    return seg
      .replace(/^> +$/gm, '>')
      // 空段落里的 <br> 会留下一整行只有空格（"  "），markdown 里没有意义，
      // 渲染出来就是图片和正文之间多一行空白。先清掉再压缩空行。
      .replace(/^[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  /**
   * 收尾整理。
   *
   * 必须跳过围栏代码块：整篇替换会把代码里的两个连续空行压成一个、
   * 把「只含空格的缩进行」清成空行。对多数语言无害，但对
   * 「代码块里嵌 Markdown 示例」「Makefile 的 tab 行」这类内容会直接失真。
   * 已知限制：代码块内部本身若含一行 ```，会被当成分隔符提前切断（极罕见）。
   */
  function tidyMarkdown(md) {
    const trimEdges = s => s.replace(/^\n+/, '').replace(/\n+$/, '');
    if (md.indexOf('```') < 0) return trimEdges(tidyText(md));

    let out = '';
    let last = 0;
    let m;
    FENCE_RE.lastIndex = 0;
    while ((m = FENCE_RE.exec(md)) !== null) {
      const start = m.index + m[1].length;
      out += tidyText(md.slice(last, start));
      out += m[2];
      last = start + m[2].length;
    }
    out += tidyText(md.slice(last));
    return trimEdges(out);
  }

  return {
    success: true,
    version: VERSION,
    title,
    markdown,
    imageMode,
    folderMode,
    imagePathMode: imageRef.mode,
    imageRefPrefix: imageRef.prefix,
    onlineFilename: resolvedOnlineFilename,
    downloadFolder: resolvedDownloadFolder,
    sharedFolder: resolvedSharedFolder,
    sharedFilename: resolvedSharedFilename,
    imageFolder: resolvedImageFolder,
    images: imageList,
    blockedImages,
    meta: articleMeta,
    url
  };

})();
