/**
 * lib/update.js —— 版本检查内核（取 version.json、比版本号、判节流）
 *
 * 由 background.js 用 importScripts 引入，options / popup 用 script 标签引入。
 * 只做三件纯逻辑的事：发请求、比版本、算「该不该再查」。
 * 角标、存储、开关状态都在 background.js —— 那里是唯一写入方，避免多处各写一份。
 *
 * ★ 更新信息地址只改这里 ★
 *   指向你自己托管的 version.json。留空字符串则整个检查功能静默失效。
 *   要求：必须是 https，且响应头带 Access-Control-Allow-Origin: *
 *   （没加 host_permissions，靠 CORS 放行，免得商店多一条权限弹窗）。
 */
var WXMD_UPDATE_URL = 'https://raw.githubusercontent.com/yourname/WeChat_To_Markdown/main/version.json';

var WXMD_UPDATE = (function () {
  'use strict';

  var CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 正常结果 24 小时后再查
  var RETRY_INTERVAL_MS = 60 * 60 * 1000;      // 失败后 1 小时再试，别把断网当常态
  var TIMEOUT_MS = 8000;

  /** 去掉前缀 v、首尾空白，防止手写 version.json 时多打一个 v 就永远「有新版本」 */
  function normalize(v) {
    return String(v == null ? '' : v).trim().replace(/^v/i, '');
  }

  /**
   * 拆版本号：主段按 . 切数字，后缀（-beta.1 / +build）单独留作比较依据。
   * 不能用字符串比较：'1.16.9' > '1.16.28' 在字典序下成立，会误判成有新版本。
   */
  function parse(v) {
    var s = normalize(v);
    var cut = s.search(/[-+]/);
    var main = cut >= 0 ? s.slice(0, cut) : s;
    var pre = cut >= 0 ? s.slice(cut) : '';
    var parts = main.split('.').map(function (x) {
      var n = parseInt(x, 10);
      return isNaN(n) ? 0 : n;
    });
    return { parts: parts.length ? parts : [0], pre: pre };
  }

  /** 返回 1 / 0 / -1。1.16.29 与 1.16.29.0 视为相同；带预发布后缀的更低。 */
  function compare(a, b) {
    var A = parse(a);
    var B = parse(b);
    var n = Math.max(A.parts.length, B.parts.length);
    for (var i = 0; i < n; i++) {
      var x = A.parts[i] || 0;
      var y = B.parts[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    if (A.pre === B.pre) return 0;
    if (!A.pre) return 1;
    if (!B.pre) return -1;
    return A.pre > B.pre ? 1 : -1;
  }

  /** 加时间戳绕开 CDN 缓存：改了 version.json 立刻生效，不用等 TTL */
  function withCacheBust(url, now) {
    var s = String(url || '');
    var at = s.indexOf('#');
    var hash = at >= 0 ? s.slice(at) : '';
    var body = at >= 0 ? s.slice(0, at) : s;
    var sep = body.indexOf('?') >= 0 ? '&' : '?';
    return body + sep + 't=' + now + hash;
  }

  function currentVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (e) {
      return '';
    }
  }

  function isFirefox() {
    try {
      return /firefox/i.test(navigator.userAgent || '');
    } catch (e) {
      return false;
    }
  }

  /**
   * 从 payload 里挑下载地址。
   * 支持两种写法：顶层 url（只有一种发行方式时最省事），
   * 或 downloads 对象（chrome / firefox / default / offline）。
   */
  function pickUrl(data) {
    if (!data || typeof data !== 'object') return '';
    if (typeof data.url === 'string' && data.url) return data.url;

    var d = data.downloads;
    if (!d || typeof d !== 'object') return '';
    var keys = isFirefox() ? ['firefox', 'default', 'chrome'] : ['chrome', 'default', 'firefox'];
    for (var i = 0; i < keys.length; i++) {
      var v = d[keys[i]];
      if (typeof v === 'string' && v) return v;
    }
    return '';
  }

  /**
   * 拉取并解析更新信息。
   * 永不 reject —— 检查更新失败不该影响任何主流程，调用方只看 ok。
   *
   * @returns {Promise<{ok:boolean, error?:string, current?:string, latest?:string,
   *                    hasUpdate?:boolean, notes?:string, published?:string, url?:string}>}
   */
  async function check(opts) {
    var o = opts || {};
    var url = o.url !== undefined ? o.url : WXMD_UPDATE_URL;
    if (!url) return { ok: false, error: '未配置更新地址' };

    var f = o.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) return { ok: false, error: '当前环境不支持网络请求' };

    var current = normalize(o.current || currentVersion());
    var now = typeof o.now === 'number' ? o.now : Date.now();
    var ctrl = null;
    var timer = 0;

    try {
      if (typeof AbortController === 'function') {
        ctrl = new AbortController();
        timer = setTimeout(function () { ctrl.abort(); }, o.timeoutMs || TIMEOUT_MS);
      }

      var res = await f(withCacheBust(url, now), {
        cache: 'no-store',
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined
      });

      if (!res || !res.ok) {
        return { ok: false, error: 'HTTP ' + ((res && res.status) || '失败') };
      }

      var text = await res.text();
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { ok: false, error: '更新信息不是合法 JSON' };
      }

      var latest = normalize(data && (data.version || data.latest));
      if (!latest || !/^\d+\.\d+/.test(latest)) {
        return { ok: false, error: '更新信息里没有可用的版本号' };
      }

      return {
        ok: true,
        current: current,
        latest: latest,
        hasUpdate: compare(latest, current) > 0,
        notes: typeof data.notes === 'string' ? data.notes : '',
        published: typeof data.published === 'string' ? data.published : '',
        url: pickUrl(data)
      };
    } catch (e) {
      var msg = (e && e.name === 'AbortError') ? '请求超时' : ((e && e.message) || '网络错误');
      return { ok: false, error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 距离上次检查够不够久；失败后更保守，1 小时内不重试 */
  function shouldCheck(state, now) {
    var s = state || {};
    var t = typeof now === 'number' ? now : Date.now();
    if (s.lastFailAt && t - s.lastFailAt < RETRY_INTERVAL_MS) return false;
    if (!s.lastCheckAt) return true;
    return t - s.lastCheckAt >= CHECK_INTERVAL_MS;
  }

  return {
    url: WXMD_UPDATE_URL,
    normalize: normalize,
    compare: compare,
    check: check,
    shouldCheck: shouldCheck,
    currentVersion: currentVersion,
    pickUrl: pickUrl,
    CHECK_INTERVAL_MS: CHECK_INTERVAL_MS,
    RETRY_INTERVAL_MS: RETRY_INTERVAL_MS
  };
})();
