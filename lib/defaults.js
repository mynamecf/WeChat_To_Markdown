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
