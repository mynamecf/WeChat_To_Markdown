// content.js —— 提取文章正文并转换为 Markdown
// 注入顺序：lib/defaults.js → lib/turndown.js → lib/turndown-plugin-gfm.js → content.js
(async function () {
  const VERSION = 'v23-2026-10-22';
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
  clone.querySelectorAll('script, style, iframe, .js_ad_link, .rich_media_tool').forEach(el => el.remove());

  normalizeCodeBlocks(clone);
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

  // 移除空的装饰性 span/div
  // 注意：textContent 不统计元素，<div style><img></div> 的 textContent 也是空。
  // 直接判空会把已渲染好的 {{IMG_n}} 一起丢掉（图片下载了却无人引用），
  // 因此必须先用 querySelector 兜住 void/媒体元素，与 Turndown 的 hasVoid 判定对齐。
  turndownService.addRule('removeEmptyInline', {
    filter: ['span', 'div'],
    replacement: (content, node) => {
      if (!node.getAttribute('style')) return content;
      if (content.trim()) return content;
      if (node.querySelector('img, br, svg, video, audio, iframe, canvas, input, picture')) {
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

  function normalizeCodeBlocks(root) {
    LOG('pre before:', root.querySelectorAll('pre').length);

    unwrapFakePre(root);

    LOG('pre after unwrap:', root.querySelectorAll('pre').length);

    root.querySelectorAll('pre').forEach(pre => {
      if (!pre.querySelector('code')) {
        const code = document.createElement('code');
        while (pre.firstChild) code.appendChild(pre.firstChild);
        pre.appendChild(code);
      }
    });

    const monoRe = /font-family[^;]*(monospace|consolas|courier|menlo|monaco|'sf mono'|'source code'|'fira code'|'jetbrains mono')/i;

    // 原实现只认 p 自身的 style 属性，所以这里先按 font-family 预筛，
    // 与后续 monoRe 判定完全等价，但候选集从「全部 p」降到「有字体的 p」。
    const allMonoPs = Array.from(root.querySelectorAll('p[style*="font-family" i]')).filter(p => {
      if (p.closest('pre')) return false;
      return monoRe.test(p.getAttribute('style') || '');
    });
    LOG('monospace p:', allMonoPs.length);

    if (allMonoPs.length === 0) return;

    const grouped = new Map();
    allMonoPs.forEach(p => {
      const parent = p.parentElement;
      if (!parent) return;
      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push(p);
    });

    const contentContainers = [];
    grouped.forEach((ps, parent) => {
      if (ps.length < 2) return;
      const direct = Array.from(parent.children);
      let monoPCount = 0;
      for (const child of direct) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'p') {
          if (!monoRe.test(child.getAttribute('style') || '')) return;
          monoPCount++;
        } else if (tag === 'span' || tag === 'section' || tag === 'div') {
          if (child.textContent.trim()) return;
          if (child.querySelector('p, img, h1, h2, h3, h4, h5, h6')) return;
        } else {
          return;
        }
      }
      if (monoPCount < 2) return;
      contentContainers.push({ parent, ps });
    });

    LOG('code containers:', contentContainers.length);

    contentContainers.forEach(({ parent, ps }) => {
      if (!parent.parentNode) return;

      let langHint = '';
      let headerEl = null;
      const wrapper = parent.parentElement;
      if (wrapper && (wrapper.tagName === 'SECTION' || wrapper.tagName === 'DIV')) {
        const siblings = Array.from(wrapper.children);
        const idx = siblings.indexOf(parent);
        if (idx > 0) {
          const info = analyzeHeader(siblings[idx - 1], monoRe);
          if (info.isHeader) {
            langHint = info.lang;
            headerEl = siblings[idx - 1];
          }
        }
      }

      // <br> 是 void 元素，不贡献任何文本：一个 p 内用 br 分行的代码，
      // 直接读 textContent 会三行粘成一行且毫无分隔。必须先转成 \n 再按行拆分，
      // 否则行尾空白清理（[ \t]+$ 只匹配整串结尾）也一并失效。
      const lines = [];
      ps.forEach(p => {
        p.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        String(p.textContent || '')
          .replace(/\u00a0/g, ' ')
          .split('\n')
          .forEach(line => lines.push(line.replace(/[ \t]+$/g, '')));
      });
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length === 0) return;

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (langHint && !/^(text|txt|plain|plaintext|code)$/i.test(langHint)) {
        code.setAttribute('class', 'language-' + langHint);
      }
      code.textContent = lines.join('\n');
      pre.appendChild(code);

      if (headerEl && headerEl.parentNode) headerEl.remove();
      parent.replaceWith(pre);
    });
  }

  function isRealCodeBlock(pre) {
    const kids = pre.children;
    return kids.length === 1 && kids[0].tagName === 'CODE';
  }

  /**
   * 剥离伪 pre（微信用 pre 包裹普通段落）。
   * 逆序遍历一遍即可：内层先处理完，外层再处理时结构已稳定，
   * 不需要原来的「最多 20 轮全树扫描」。
   */
  function unwrapFakePre(root) {
    const pres = Array.from(root.querySelectorAll('pre')).reverse();
    for (const pre of pres) {
      if (!pre.parentNode || isRealCodeBlock(pre)) continue;
      const div = document.createElement('div');
      while (pre.firstChild) div.appendChild(pre.firstChild);
      pre.parentNode.replaceChild(div, pre);
    }
  }

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

  function analyzeHeader(el, monoRe) {
    if (!el || (el.tagName !== 'SECTION' && el.tagName !== 'DIV')) {
      return { isHeader: false, lang: '' };
    }
    if (el.querySelector('p')) return { isHeader: false, lang: '' };
    if (el.textContent.trim().length > 40) return { isHeader: false, lang: '' };

    const hasDots = el.querySelector('span[style*="border-radius"]');
    let lang = '';
    const spans = el.querySelectorAll('span');
    for (const sp of spans) {
      const style = sp.getAttribute('style') || '';
      const t = (sp.textContent || '').trim();
      if (!t) continue;
      if (!monoRe.test(style)) continue;
      if (t.length > 20) continue;
      if (!/^[\w\-+#.]+$/.test(t)) continue;
      if (/^\.+$/.test(t)) continue;
      lang = t;
      break;
    }

    return (hasDots || lang) ? { isHeader: true, lang } : { isHeader: false, lang: '' };
  }
})();
