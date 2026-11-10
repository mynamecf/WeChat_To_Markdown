/**
 * lib/defaults.js —— 全局默认配置（唯一数据源）
 * 由 popup.html / options.html 用 <script> 引入，
 * background.js 用 importScripts 引入，
 * content.js 通过 executeScript 注入时排在第一位。
 *
 * 用 var 声明，保证在 executeScript 多文件注入时挂到同一个 isolated world 的全局上。
 */
var WXMD_DEFAULTS = {
  // 行为开关
  imageMode: 'download',          // online | download
  folderMode: 'per-article',      // per-article | shared
  pinned: false,                  // 浮窗是否固定

  // 图片引用路径模式（Markdown 里图片链接怎么写）
  //   relative 相对库内模糊路径   2026/11/09/a.png
  //   note     相对当前笔记       ./2026/11/09/a.png
  //   custom   自定义前缀         <前缀>2026/11/09/a.png
  //
  // 逐篇 / 平铺各存一份、互不影响（在逐篇里点「恢复默认」不会改掉平铺的前缀），
  // 字段名见 lib/naming.js 的 IMAGE_REF_KEYS：
  //   perArticleImagePathMode / perArticleImageRefPrefix
  //   sharedImagePathMode     / sharedImageRefPrefix
  //
  // 下面这两项是 ≤v23 的单份旧配置，只作迁移时的兜底来源，
  // 故意不把逐篇 / 平铺字段写进本对象 —— 否则 get(DEFAULTS) 会把默认值当成
  // 「已存在」，旧配置永远迁移不过来。
  imagePathMode: 'note',
  // 自定义前缀（仅 custom 生效）原样拼在图片目录前，默认是「库内绝对路径」写法：
  //   /微信/{{noteFolder}}/（{{noteFolder}} = .md 所在文件夹）
  //   点「恢复默认」会回到这个值；「微信」是文章文件夹在笔记库里的那一层，换成自己的即可。
  //   ../   → 上一级；留空 → 等同 relative。
  imageRefPrefix: '/微信/{{noteFolder}}/',

  // 命名模板
  onlineFilename: '{{date:YYYYMMDD}}_{{title}}',
  downloadFolder: '{{date:YYYYMMDD}}_{{title}}',
  sharedFolder: '{{date:YYYYMMDD}}',
  sharedFilename: '{{date:YYYYMMDD}}_{{title}}',
  // 逐篇归档的图片规则
  imageFolder: '{{date:YYYY}}/{{date:MM}}/{{date:DD}}',
  imageFilename: 'IMG_{{date:YYYYMMDD}}{{time:HHmmssSSS}}_{{index1}}',
  // 平铺归档的图片规则（与逐篇互相独立）
  sharedImageFolder: '{{date:YYYY}}/{{date:MM}}/{{date:DD}}',
  sharedImageFilename: 'IMG_{{date:YYYYMMDD}}{{time:HHmmssSSS}}_{{index1}}'
};

/**
 * 判断主机名是否落在「本机 / 内网」范围。
 *
 * 为什么需要：文章里的 <img src> 完全由作者控制（公众号谁都能注册），
 * 不拦截的话，一篇恶意文章就能让扩展带着用户本人的身份去请求内网设备，
 * 属于典型的 blind SSRF；即使看不到响应，也能用来探测内网存活、打本机服务。
 *
 * 注意入参必须是 new URL(url).hostname 的规范化结果 ——
 * Chrome 会把 http://2130706433/ 这类十进制 IP 归一成 127.0.0.1，
 * 只要不自己手写 URL 解析，就绕不过去。
 */
function WXMD_isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;

  if (h === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(h)) return true;

  // IPv6 回环 / 未指定 / ULA(fc00::/7) / link-local(fe80::/10)
  if (h === '::1' || h === '::') return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(h)) return true;

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;          // 0.0.0.0/8, 10/8, 回环
    if (a === 192 && b === 168) return true;                     // 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16/12
    if (a === 169 && b === 254) return true;                     // link-local
    if (a === 100 && b >= 64 && b <= 127) return true;           // CGNAT
    return false;
  }

  // 不含点的主机名（http://router/、http://intranet-8080/）通常是内网短名
  if (!h.includes('.')) return true;

  return false;
}

/**
 * 是否为微信公众号文章页。
 *
 * 不能用 url.includes('mp.weixin.qq.com')：它只做子串匹配，
 * https://mp.weixin.qq.com.evil.example/ 这类域名同样能通过。
 * 而 popup 打开时 activeTab 已经授予，后续 executeScript 会真的注入进去。
 */
function WXMD_isWechatArticleUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'mp.weixin.qq.com';
  } catch (e) {
    return false;
  }
}

/* ============================================================================
 * 官网 / 问题反馈链接
 * ----------------------------------------------------------------------------
 * ★ 只需要改这里 ★
 *   弹窗（popup.html）和详细配置页（options.html）都从这两个字段取值渲染，
 *   改完重新加载扩展即生效，不用再去翻 HTML。
 *
 *   留空字符串 '' 或删掉某个字段，对应链接会自动隐藏（不会出现死链）。
 * ========================================================================== */
var WXMD_LINKS = {
  homepage: 'https://github.com/yourname/WeChat_To_Markdown',        // 官网 / 项目主页
  feedback: 'https://github.com/yourname/WeChat_To_Markdown/issues'  // 问题反馈
};

/**
 * 打开外部链接。
 *
 * 不用 <a target="_blank"> 直接跳：弹窗（popup）在当前标签页内导航会让弹窗
 * 自己变成网页，用户就回不去了。统一走 chrome.tabs.create 新开一个标签页。
 */
function WXMD_openLink(url) {
  if (!url || typeof url !== 'string') return false;

  // MV3 里 chrome.tabs.create 返回 Promise：即使同步不抛错，也可能异步失败
  // （比如被策略拦截）。这里一并兜住，失败再退回 window.open，
  // 避免「点了没反应」。
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
      const p = chrome.tabs.create({ url, active: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          try { window.open(url, '_blank', 'noopener'); } catch (e) {}
        });
      }
      return true;
    }
  } catch (e) {}

  try {
    window.open(url, '_blank', 'noopener');
    return true;
  } catch (e) {}

  return false;
}

/**
 * 把 WXMD_LINKS 里的地址挂到页面上指定的链接元素。
 * url 为空时把整条链接（连同可选的 .wx-md-link-sep 分隔符）一起隐藏。
 *
 * @param {string} id        链接元素的 id
 * @param {string} url       目标地址
 * @param {string} [sepId]   紧随其后的分隔符元素 id（可选）
 */
function WXMD_mountLink(id, url, sepId) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!el) return;
  const sep = sepId && document.getElementById(sepId);

  if (!url) {
    el.style.display = 'none';
    if (sep) sep.style.display = 'none';
    return;
  }
  el.setAttribute('href', url);
  el.setAttribute('title', url);
  el.addEventListener('click', e => {
    // 能新开标签就拦掉默认跳转（弹窗里就地导航会把弹窗顶掉）；
    // 两条路都失败时保留 <a> 本身的跳转，总比点了没反应强。
    if (WXMD_openLink(url)) e.preventDefault();
  });
  el.style.display = '';
  if (sep) sep.style.display = '';
}

/** 一次性挂载官网 / 反馈两个链接（各页面在初始化时调用一次即可） */
function WXMD_mountSiteLinks() {
  const links = (typeof WXMD_LINKS !== 'undefined' && WXMD_LINKS) || {};
  WXMD_mountLink('linkHomepage', links.homepage, 'linkHomepageSep');
  WXMD_mountLink('linkFeedback', links.feedback, null);
}
