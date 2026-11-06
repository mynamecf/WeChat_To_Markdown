/**
 * lib/naming.js —— 命名模板解析（唯一实现）
 *
 * 为什么单独抽出来：
 *   原本 content.js（实际落盘）和 options.js（配置页预览）各有一套实现，
 *   清洗规则不一致（空白转下划线、连续点、首尾下划线、100 字符截断），
 *   导致预览显示的文件名和真实落盘的不是同一个 —— 预览在骗用户。
 *   这里收敛成一份，两边共用，永久消除漂移。
 *
 * 引入方式（四处都要加，缺一处会导致导出失败）：
 *   - background.js  : importScripts 之后，content.js 注入列表里排在 defaults.js 之后
 *   - popup.js       : INJECT_FILES 里同样位置
 *   - options.html   : <script src="lib/naming.js"></script>
 *   - content.js     : 通过 executeScript 注入，使用前检查 WXMD_NAMING 是否存在
 *
 * 用 var 声明，保证多文件 executeScript 注入时挂到同一个 isolated world 全局上。
 */
var WXMD_NAMING = (function () {
  'use strict';

  // 顺序敏感：长标记必须排在短标记前面（MMMM 先于 MMM，DD 先于 D）
  var DATE_TOKENS = [
    'YYYY', 'MMMM', 'dddd', 'MMM', 'ddd', 'SSS', 'YY', 'MM', 'DD', 'Do', 'dd',
    'HH', 'hh', 'mm', 'ss', 'M', 'D', 'H', 'h', 'm', 's', 'A', 'a'
  ];

  var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAYS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  function getOrdinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function formatMoment(date, format) {
    var map = {
      YYYY: date.getFullYear(),
      YY: String(date.getFullYear()).slice(-2),
      MMMM: MONTHS_FULL[date.getMonth()],
      MMM: MONTHS_SHORT[date.getMonth()],
      MM: String(date.getMonth() + 1).padStart(2, '0'),
      M: date.getMonth() + 1,
      DD: String(date.getDate()).padStart(2, '0'),
      D: date.getDate(),
      Do: getOrdinal(date.getDate()),
      dddd: DAYS_FULL[date.getDay()],
      ddd: DAYS_SHORT[date.getDay()],
      dd: DAYS_MIN[date.getDay()],
      HH: String(date.getHours()).padStart(2, '0'),
      H: date.getHours(),
      hh: String(date.getHours() % 12 || 12).padStart(2, '0'),
      h: date.getHours() % 12 || 12,
      mm: String(date.getMinutes()).padStart(2, '0'),
      m: date.getMinutes(),
      ss: String(date.getSeconds()).padStart(2, '0'),
      s: date.getSeconds(),
      SSS: String(date.getMilliseconds()).padStart(3, '0'),
      A: date.getHours() >= 12 ? 'PM' : 'AM',
      a: date.getHours() >= 12 ? 'pm' : 'am'
    };

    var result = '';
    var i = 0;
    while (i < format.length) {
      // [原样输出] 转义
      if (format[i] === '[') {
        var end = format.indexOf(']', i);
        if (end !== -1) {
          result += format.slice(i + 1, end);
          i = end + 1;
          continue;
        }
      }
      var matched = false;
      for (var t = 0; t < DATE_TOKENS.length; t++) {
        var token = DATE_TOKENS[t];
        if (format.slice(i, i + token.length) === token) {
          result += map[token];
          i += token.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        result += format[i];
        i++;
      }
    }
    return result;
  }

  /** 单段文件名：禁止路径分隔符与 Windows 非法字符 */
  function sanitizeName(name) {
    return String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /** 多段相对路径：保留 /，逐段清洗后合并 */
  function sanitizePath(p) {
    return String(p == null ? '' : p)
      .replace(/[\\:*?"<>|\r\n\t]/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\s+/g, '_');
  }

  /** 用作路径片段时禁止出现 / ，避免 {{title}} 意外制造子目录 */
  function sanitizePathSegment(name) {
    return String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function simpleHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
  }

  /**
   * 解析命名模板。
   * @param {string} template 模板
   * @param {number} index    图片序号（0 起）
   * @param {string} targetUrl 用于生成 {{hash8}}
   * @param {object} meta     {title, author, published, url, domain, site}
   * @param {boolean} isPath  按路径规则清洗（保留 /）还是按单段文件名清洗
   */
  function resolveTemplate(template, index, targetUrl, meta, isPath) {
    var tpl = String(template == null ? '' : template).trim();
    if (!tpl) return '';
    var now = new Date();
    var m = meta || {};
    var result = tpl;

    result = result.replace(/\{\{date(?::([^}]+))?\}\}/g, function (_, fmt) {
      return formatMoment(now, fmt || 'YYYY-MM-DD');
    });
    result = result.replace(/\{\{time(?::([^}]+))?\}\}/g, function (_, fmt) {
      return formatMoment(now, fmt || 'HH:mm');
    });

    result = result
      .replace(/\{\{title\}\}/g, isPath ? sanitizePathSegment(m.title) : sanitizeName(m.title))
      .replace(/\{\{author\}\}/g, isPath ? sanitizePathSegment(m.author) : sanitizeName(m.author))
      .replace(/\{\{published\}\}/g, sanitizeName(m.published))
      .replace(/\{\{url\}\}/g, sanitizeName(m.url))
      .replace(/\{\{domain\}\}/g, sanitizeName(m.domain))
      .replace(/\{\{site\}\}/g, isPath ? sanitizePathSegment(m.site) : sanitizeName(m.site))
      .replace(/\{\{index1\}\}/g, String(index + 1))
      .replace(/\{\{index\}\}/g, String(index))
      .replace(/\{\{hash8\}\}/g, simpleHash(targetUrl || ''));

    result = isPath ? sanitizePath(result) : sanitizeName(result);
    if (!result) result = isPath ? '' : 'image_' + index;
    return result.length > 100 ? result.slice(0, 100) : result;
  }

  /** 共享文件夹只允许日期/时间变量，其余变量一律抹掉 */
  function resolveDateOnlyTemplate(template) {
    var tpl = String(template == null ? '' : template).trim();
    if (!tpl) return '';
    var now = new Date();
    var result = tpl;

    result = result.replace(/\{\{date(?::([^}]+))?\}\}/g, function (_, fmt) {
      return formatMoment(now, fmt || 'YYYY-MM-DD');
    });
    result = result.replace(/\{\{time(?::([^}]+))?\}\}/g, function (_, fmt) {
      return formatMoment(now, fmt || 'HH:mm');
    });
    result = result.replace(/\{\{[^}]+\}\}/g, '');

    return sanitizePath(result);
  }

  return {
    formatMoment: formatMoment,
    getOrdinal: getOrdinal,
    sanitizeName: sanitizeName,
    sanitizePath: sanitizePath,
    sanitizePathSegment: sanitizePathSegment,
    simpleHash: simpleHash,
    resolveTemplate: resolveTemplate,
    resolveDateOnlyTemplate: resolveDateOnlyTemplate
  };
})();
