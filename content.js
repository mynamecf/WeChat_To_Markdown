// content.js —— 提取文章正文并转换为 Markdown
// 注入顺序（顺序不能乱，后面的依赖前面的全局变量）：
//   lib/defaults.js → lib/naming.js → lib/turndown.js → lib/turndown-plugin-gfm.js
//   → lib/codeblock.js → lib/compat.js → lib/attachment.js → content.js
// 分工：代码块 = lib/codeblock.js，特殊排版 = lib/compat.js，
//       视频/语音附件 = lib/attachment.js，其余（图片、引用、列表、段落、YAML）在本文件。
(async function () {
  const VERSION = 'v34-2026-11-13';
  const DEBUG = false;
  const LOG = DEBUG ? (...args) => console.log('[wechat-to-md ' + VERSION + ']', ...args) : () => {};

  const ARTICLE_SELECTOR = '#js_content';
  const TITLE_SELECTOR = '#activity-name';
  const AUTHOR_SELECTOR = '#js_name';
  const PUBLISH_TIME_SELECTOR = '#publish_time';

  // 播放器残留外壳：权威清单在 lib/attachment.js（与那边共用一份，避免两处各改各的），
  // 模块异常时才用这份精简兜底。
  const PLAYER_CHROME_SEL = (typeof WXMD_ATTACH !== 'undefined' && WXMD_ATTACH.PLAYER_CHROME_SEL)
    ? WXMD_ATTACH.PLAYER_CHROME_SEL
    : '.video_iframe, .appmsg_video, .feed-wrapper, .video_tail_module';

  // 浮窗传来的「本次选择」，用完即弃，不写回 storage
  const override = globalThis.__WXMD_OVERRIDE__ || {};
  try { delete globalThis.__WXMD_OVERRIDE__; } catch (e) {}

  const DEFAULTS = (typeof WXMD_DEFAULTS !== 'undefined')
    ? WXMD_DEFAULTS
    : {
        imageMode: 'download',
        folderMode: 'per-article',
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
        return !h.includes('.');
      };

  const settings = await chrome.storage.local.get(DEFAULTS);

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

  const titleEl = document.querySelector(TITLE_SELECTOR);
  const title = titleEl && titleEl.innerText.trim()
    ? titleEl.innerText.trim()
    : document.title.trim();

  const authorEl = document.querySelector(AUTHOR_SELECTOR);
  const author = authorEl ? authorEl.innerText.trim() : '';

  const timeEl = document.querySelector(PUBLISH_TIME_SELECTOR);
  const published = timeEl ? timeEl.innerText.trim() : '';

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
  const resolvedImageFolder = resolveTemplate(imageFolderTemplate, 0, url, articleMeta, true);

  LOG('resolved config', {
    imageMode, folderMode,
    onlineFilename: resolvedOnlineFilename,
    downloadFolder: resolvedDownloadFolder,
    sharedFolder: resolvedSharedFolder,
    sharedFilename: resolvedSharedFilename,
    imageFolder: resolvedImageFolder
  });

  // ---------- 正文提取 ----------

  const contentEl = document.querySelector(ARTICLE_SELECTOR);
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
      // 图片地址完全由文章作者控制：内网 / 本机地址一律不下载，否则恶意文章
      // 能让扩展带着用户身份去请求内网设备（blind SSRF）。这里只降级为在线链接，
      // 不删除节点，避免静默丢内容。
      if (!isDownloadableImageUrl(realSrc)) {
        blockedImages++;
        return;
      }
      const idx = imageList.length;
      const filenameBase = resolveTemplate(imageFilename, idx, realSrc, articleMeta, false);
      img.setAttribute('data-img-idx', String(idx));
      imageList.push({ url: realSrc, filenameBase });
    }
  });

  if (blockedImages > 0) {
    console.warn(
      `[wx-md] 已跳过 ${blockedImages} 张指向内网/本机地址的图片，仅保留在线链接`
    );
  }

  /** 可下载的图片地址：仅 http(s)，且不指向内网 / 本机（失败时按不可下载处理） */
  function isDownloadableImageUrl(u) {
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return !isPrivateHost(parsed.hostname);
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
  //   4. 嵌套列表归位——只动 ul/ol 的父子关系。
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

  normalizeQuotes(clone);

  // 特殊排版兼容（浮动序号、伪标题等）在 lib/compat.js，后续同类兼容都往那里加
  if (WXMD_COMPAT && typeof WXMD_COMPAT.normalizeCompat === 'function') {
    WXMD_COMPAT.normalizeCompat(clone, LOG);
  } else {
    console.error('[wx-md] lib/compat.js 未加载，个别特殊排版（如「一、背景」这类伪标题）可能失真');
  }

  normalizeNestedLists(clone);

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
      return '\n\n' + img + '\n\n';
    }
  });

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

  // 移除空的装饰性 span/div
  // 注意：textContent 不统计元素，<div style><img></div> 的 textContent 也是空。
  // 直接判空会把已渲染好的 {{IMG_n}} 一起丢掉（图片下载了却无人引用），
  // 因此必须先用 querySelector 兜住 void/媒体元素，与 Turndown 的 hasVoid 判定对齐。
  turndownService.addRule('removeEmptyInline', {
    filter: ['span', 'div'],
    replacement: (content, node) => {
      if (!node.getAttribute('style')) return content;
      if (content.trim()) return content;
      if (node.querySelector('img, br, svg, video, audio, iframe, canvas, input, picture, wxmd-link')) {
        return content;
      }
      return '';
    }
  });

  // 直接传 DOM 节点：这版 Turndown 的 RootNode 对非字符串入参走 input.cloneNode(true)，
  // 省掉「序列化成 innerHTML → DOMParser 重新解析」的一整圈往返。
  // 多出来的根节点是 <div>，前后空行会被下面的 ^\n+ / \n+$ 清理掉，输出不变。
  let markdown = turndownService.turndown(clone);
  markdown = markdown
    .replace(/^> +$/gm, '>')
    // 空段落里的 <br> 会留下一整行只有空格（"  "），markdown 里没有意义，
    // 渲染出来就是图片和正文之间多一行空白。先清掉再压缩空行。
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');

  // YAML 单引号风格：只需把 ' 转义成 ''，换行折叠为空格。
  // 单引号标量本身会把 \u2028/\u2029/\u0085 折叠成空格，不会破坏结构；
  // 真正非法的是 C0 控制字符（YAML 只允许 Tab），从 PDF/Word 复制时偶有残留。
  const yamlStr = s => "'" + String(s == null ? '' : s)
    .replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/'/g, "''") + "'";

  const frontmatter =
    '---\n' +
    `title: ${yamlStr(title)}\n` +
    `author: ${yamlStr(author)}\n` +
    `source: ${yamlStr(url)}\n` +
    `published: ${yamlStr(published)}\n` +
    `exported: ${yamlStr(new Date().toISOString())}\n` +
    '---\n\n';

  markdown = frontmatter + markdown + '\n';

  // ---------- 内部工具函数 ----------
  // 只在本文件用：模板解析在 lib/naming.js、代码块在 lib/codeblock.js、
  // 特殊排版兼容在 lib/compat.js、附件在 lib/attachment.js。
  // 下面两个是「结构归一」步骤里调用的，函数声明在这里、调用在不远处，改动时一起看。

  /** 带左右边框的 section/div → blockquote（微信里的引用块全靠样式画的） */
  function normalizeQuotes(root) {
    // 只处理 style 里带左右边框的元素：微信正文的 section/div 动辄几千个，
    // 而真正构成引用块的通常个位数，先让属性选择器筛一遍再逐条判定。
    // i 标志是 CSS4 大小写不敏感，覆盖 FONT-FAMILY / BORDER-LEFT 这类写法。
    const candidates = Array.from(
      root.querySelectorAll('[style*="border-left" i], [style*="border-right" i]')
    );
    let count = 0;

    // 逆序：内层先转，外层再判断时能通过 closest/querySelector 感知到已转换的 blockquote，
    // 避免产出 > > > 的多层嵌套。querySelectorAll 返回文档顺序，筛选后顺序不变。
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      if (!el.parentNode) continue;
      if (el.closest('pre') || el.closest('blockquote')) continue;
      // 真 <h1>~<h6> 是作者/Turndown 都认的结构，左边框只是装饰（「### 获取 Token」
      // 这种标题常配一条竖线），不能反过来把它拆成引用块——那是伪标题才有的猜测
      if (el.closest('h1, h2, h3, h4, h5, h6')) continue;

      const style = el.getAttribute('style') || '';
      if (/font-family[^;]*monospace/i.test(style)) continue;
      if (!/border-(left|right)\s*:\s*[1-9]\d*px\s+(solid|dashed|dotted)/i.test(style)) continue;
      if (!el.textContent.trim()) continue;

      // 不要把承载图片/表格/代码的容器整体变成引用块
      if (el.querySelector('img, table, pre, blockquote')) continue;

      const bq = document.createElement('blockquote');
      while (el.firstChild) bq.appendChild(el.firstChild);
      el.replaceWith(bq);
      count++;
    }

    LOG('blockquotes:', count);
  }

  // ---------- 列表 ----------

  /**
   * 修「子列表直接挂在列表容器下」的不规范结构。
   *
   * 微信 / 秀米导出的目录树常写成：
   *   <ul>
   *     <li>简单使用</li>
   *     <ul><li>引入依赖</li><li>requestBody 参数校验</li></ul>   ← 没包进 <li>
   *   </ul>
   *
   * Turndown 只认「<li> 内部的嵌套列表」这一种层级（rules.listItem 靠 li 深度缩进），
   * 子列表挂在 ul 下会被当成同级内容，所有子项拍平成一级——看起来就是「没有缩进」。
   * 这里把这类子列表挂回前一个 <li> 末尾，层级交给 Turndown 恢复正常。
   */
  function normalizeNestedLists(root) {
    // 逆序：内层先归位，外层处理时结构已稳定
    const nested = Array.from(root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol')).reverse();
    let moved = 0;

    for (const list of nested) {
      if (!list.parentNode) continue;
      // 只认「前面紧挨着的 li」；中间夹了有文字的其它节点就不动，
      // 免得把子列表挂到不相干的条目下面（宁可平铺也不要挂错父项）
      let prev = list.previousElementSibling;
      while (prev && prev.tagName !== 'LI' && !(prev.textContent || '').trim()) {
        prev = prev.previousElementSibling;
      }
      if (!prev || prev.tagName !== 'LI') continue;

      prev.appendChild(list);
      moved++;
    }

    LOG('nested lists moved:', moved);
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
    meta: articleMeta,
    url
  };

})();
