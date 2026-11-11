// content.js —— 提取文章正文并转换为 Markdown
// 注入顺序：lib/defaults.js → lib/naming.js → lib/turndown.js → lib/turndown-plugin-gfm.js → lib/codeblock.js → content.js
(async function () {
  const VERSION = 'v26-2026-11-11';
  const DEBUG = false;
  const LOG = DEBUG ? (...args) => console.log('[wechat-to-md ' + VERSION + ']', ...args) : () => {};

  const ARTICLE_SELECTOR = '#js_content';
  const TITLE_SELECTOR = '#activity-name';
  const AUTHOR_SELECTOR = '#js_name';
  const PUBLISH_TIME_SELECTOR = '#publish_time';

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
  // 图片以外的附件一律不下载。视频在公众号里有四种形态（微信播放器 iframe、
  // mp-common-videosnippet 自定义标签、腾讯视频、视频号），直链带 auth_key 签名会过期，
  // 视频号的内容又是分片加密的，下下来大概率是坏文件或很快失效。
  // 所以这里统一把载体换成 <wxmd-link> 占位，只写「能点开看」的在线地址。
  //
  // 放在图片统计之前：播放器里常包着封面图，外层被换掉后那张图不在正文里了，
  // 先换成链接可以让它不被计入图片列表（否则会白下一张没人引用的封面）。
  const attachments = collectAttachments(clone);
  if (attachments.length > 0) LOG('attachments', attachments);

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
  // 附件载体已经换成占位；这里顺带清掉没被识别出来的残留（读不出地址的播放器），
  // 否则 Turndown 会把整个播放器 DOM 当正文输出。
  clone.querySelectorAll(
    'script, style, iframe, video, audio, mp-common-videosnippet, mp-common-videochannels, .js_ad_link, .rich_media_tool'
  ).forEach(el => el.remove());

  // ---------- 附件提取（视频 / 语音）----------

  /**
   * 收集正文里的视频 / 语音，返回 [{ kind, source, href }]，并把载体节点换成
   * <wxmd-link> 占位（带 data-href / data-label），交给 Turndown 输出成链接。
   */
  function collectAttachments(root) {
    const found = [];
    const taken = new Set();
    const nodes = Array.from(root.querySelectorAll(
      'video, audio, iframe, mp-common-videosnippet, mp-common-videochannels'
    ));

    for (const el of nodes) {
      if (!root.contains(el)) continue;
      const holder = el.closest('mp-common-videosnippet, mp-common-videochannels') || el;
      // 同一段视频会被「自定义标签 + 内层 iframe」命中两次，按最外层载体去重，
      // 否则会多占一个编号、还会在 md 里留下指向已分离节点的空洞
      if (taken.has(holder)) continue;
      const info = readAttachment(holder);
      if (!info) continue;
      taken.add(holder);
      found.push({ holder, kind: info.kind, source: info.source, href: info.href });
    }

    // 编号按类别各算一套：视频 1/2/3、语音 1/2，不会出现「语音 5」这种串号
    const totals = found.reduce((m, it) => {
      m[it.kind] = (m[it.kind] || 0) + 1;
      return m;
    }, {});
    const seen = {};
    found.forEach(item => {
      if (!root.contains(item.holder)) return;
      const n = (seen[item.kind] = (seen[item.kind] || 0) + 1);
      const label = item.kind
        + (totals[item.kind] > 1 ? ' ' + n : '')
        + (item.source ? '（' + item.source + '）' : '');

      const ph = document.createElement('wxmd-link');
      ph.setAttribute('data-href', item.href);
      ph.setAttribute('data-label', label);
      // Turndown 对「没有文本内容」的元素直接走 blankReplacement，不会调用自定义规则，
      // 所以塞一段占位文本让它按有内容的节点处理（replacement 里不会用到 content）。
      ph.textContent = item.kind;
      item.holder.replaceWith(ph);
    });

    return found.map(it => ({ kind: it.kind, source: it.source, href: it.href }));
  }

  /** 读出一个附件节点能点开的在线地址；不是附件（普通 iframe 等）返回 null */
  function readAttachment(holder) {
    const tag = holder.tagName;

    if (tag === 'VIDEO' || tag === 'AUDIO') {
      const href = firstHttpUrl([
        holder.getAttribute('src'),
        holder.getAttribute('data-src'),
        attrOf(holder.querySelector('source'), 'src')
      ]);
      if (!href) return null;
      return { kind: tag === 'AUDIO' ? '语音' : '视频', source: '', href };
    }

    if (tag !== 'IFRAME'
      && tag !== 'MP-COMMON-VIDEOSNIPPET'
      && tag !== 'MP-COMMON-VIDEOCHANNELS') {
      return null;
    }

    const frame = tag === 'IFRAME' ? holder : holder.querySelector('iframe');
    if (!frame) {
      // 少数页面把 <video> 直接塞进自定义标签里，退回按普通 video 处理
      const inner = holder.querySelector('video, audio');
      return inner ? readAttachment(inner) : null;
    }

    const playUrl = firstHttpUrl([
      attrOf(frame, 'data-src'),
      attrOf(frame, 'src'),
      holder.getAttribute('data-src')
    ]);
    const vid = pickVideoId(holder, frame, playUrl);

    // 视频号：分片加密、没有公开可分享地址，只能指回原文
    if (tag === 'MP-COMMON-VIDEOCHANNELS' || /channels|finder/i.test(playUrl)) {
      return { kind: '视频', source: '视频号', href: location.href };
    }

    // 腾讯视频：播放页固定是这个形状，vid 拿不到就退回原始 iframe 地址
    if (/v\.qq\.com/i.test(playUrl)) {
      return {
        kind: '视频',
        source: '腾讯视频',
        href: vid ? 'https://v.qq.com/x/page/' + encodeURIComponent(vid) + '.html' : playUrl
      };
    }

    if (!playUrl && !vid) return null;

    // 微信自己的播放器：data-src 就是播放页（readtemplate?t=pages/video_player_tmpl…），
    // 浏览器里打开能直接播，优先复用；只有拿到 JSON 接口地址时才按 vid 重新拼播放页。
    const isPlayerPage = /video_player_tmpl|action=mpvideo/i.test(playUrl)
      && !/get_mp_video_play_url|f=json/i.test(playUrl);
    const href = isPlayerPage ? playUrl : (vid ? buildPlayerUrl(vid) : '');
    if (!href) return null;
    return { kind: '视频', source: '微信视频', href };
  }

  /** 微信视频播放页（就是文章里 iframe 的原始地址） */
  function buildPlayerUrl(vid) {
    return 'https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl'
      + '&action=mpvideo&auto=0&vid=' + encodeURIComponent(vid);
  }

  function pickVideoId(holder, frame, playUrl) {
    const fromAttr = String(
      holder.getAttribute('data-mpvid') || attrOf(frame, 'data-mpvid') || ''
    ).trim();
    if (fromAttr) return fromAttr;

    const m = String(playUrl || '').match(/[?&]vid=([^&#]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    const m2 = String(playUrl || '').match(/wxv_[A-Za-z0-9_-]{10,}/);
    return m2 ? m2[0] : '';
  }

  function attrOf(el, name) {
    return el ? el.getAttribute(name) : null;
  }

  function firstHttpUrl(list) {
    for (let i = 0; i < list.length; i++) {
      const raw = String(list[i] || '').trim();
      if (!raw) continue;
      const abs = raw.startsWith('//') ? 'https:' + raw : raw;
      if (/^https?:\/\//i.test(abs)) return abs;
    }
    return '';
  }

  // 代码块整理在 lib/codeblock.js（等宽 <p> / 编辑器 pre / 伪 pre 三条路径都收在那里）
  if (WXMD_CODE && typeof WXMD_CODE.normalizeCodeBlocks === 'function') {
    WXMD_CODE.normalizeCodeBlocks(clone, LOG);
  } else {
    // 缺这个模块不阻断导出，但代码块会退化成行内 code（整段粘一行、没有围栏），
    // 必须明确报出来，否则会被当成「代码块适配又失效了」去查错方向。
    console.error('[wx-md] lib/codeblock.js 未加载，本次导出的代码块可能失真');
  }
  normalizeQuotes(clone);

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
  turndownService.addRule('wechatSection', {
    filter: ['section'],
    replacement: (content, node) => {
      const trimmed = content.replace(/^\n+|\n+$/g, '');
      if (!trimmed) return '';
      let p = node.parentNode;
      let inBlockquote = false;
      while (p) {
        if (p.nodeName === 'BLOCKQUOTE') { inBlockquote = true; break; }
        p = p.parentNode;
      }
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

  // ---------- 模板 ----------
  // resolveTemplate / resolveDateOnlyTemplate / sanitize* / formatMoment 已抽到
  // lib/naming.js，配置页预览与实际导出共用同一份实现，避免两套规则漂移。
  // 引用在文件顶部（WXMD_NAMING）。

  // ---------- 代码块 ----------
  // 实现已整体迁到 lib/codeblock.js（入口 WXMD_CODE.normalizeCodeBlocks）。
  // 这里只保留调用点（见 clone 之后），避免两套逻辑各改各的。

  // ---------- 引用块 ----------

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

})();
