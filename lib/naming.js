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

  /* ------------------------------------------------------------------------
   * 图片引用路径（Markdown 里 ![](这里) 写什么）
   *
   * 三种形态：
   *   relative  2026/11/09/a.png             相对库内模糊路径（无前缀）
   *   note      ./2026/11/09/a.png           相对当前笔记所在文件夹（默认）
   *   custom    <前缀>2026/11/09/a.png        自定义前缀，原样拼在图片目录前
   *
   * 说明：
   *   - 三者的路径主体相同（相对 .md 所在文件夹），区别只在前缀，
   *     所以改变模式不会影响图片实际落盘位置。
   *   - custom 的前缀里可用 {{noteFolder}} 代表 .md 所在文件夹，
   *     因此「上一级」写 ../ 、「库内绝对路径」写 /微信/{{noteFolder}}/ 即可，
   *     不再单独占两个选项。
   *   - 旧版（≤v16.6）的 parent / vault 在 resolveImageRefConfig 里
   *     等价迁移成 custom，用户已选的行为不会凭空丢失。
   *   - 这个函数是「唯一实现」：background.js（真实写盘）和 options.js（预览）
   *     都调它，避免预览和实际导出又不一致。
   * ---------------------------------------------------------------------- */

  var IMAGE_REF_MODES = ['relative', 'note', 'custom'];

  function normalizeImageRefMode(mode) {
    return IMAGE_REF_MODES.indexOf(mode) >= 0 ? mode : 'note';
  }

  function trimSlashes(p) {
    return String(p == null ? '' : p).replace(/^\/+|\/+$/g, '');
  }

  /**
   * 自定义前缀清洗：统一成 / 分隔、合并重复斜杠、空格编码成 %20。
   * 保留开头的 /（库内绝对路径就要用它），所以不做首尾 trim。
   * 空格必须编码：Markdown 链接目标里裸空格会把后面整段截成 title，图片直接失效。
   */
  function normalizeRefPrefix(prefix) {
    return String(prefix == null ? '' : prefix)
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/ /g, '%20');
  }

  /**
   * 把存储里的配置归一成 { mode, prefix }，顺带做旧版迁移：
   *   parent → custom('../')
   *   vault  → custom('/{{noteFolder}}/'，若存过 vaultPrefix 则拼在中间)
   */
  function resolveImageRefConfig(cfg) {
    cfg = cfg || {};
    var rawMode = cfg.imagePathMode;
    var prefix = cfg.imageRefPrefix == null ? '' : String(cfg.imageRefPrefix);

    if (rawMode === 'parent') {
      return { mode: 'custom', prefix: prefix || '../' };
    }
    if (rawMode === 'vault') {
      if (!prefix) {
        var legacy = trimSlashes(cfg.vaultPrefix);
        prefix = '/' + (legacy ? legacy + '/' : '') + '{{noteFolder}}/';
      }
      return { mode: 'custom', prefix: prefix };
    }
    return { mode: normalizeImageRefMode(rawMode), prefix: prefix };
  }

  /**
   * @param {string} mode        relative | note | custom
   * @param {string} imgDir      图片目录（相对 .md 所在文件夹，可为空）
   * @param {string} filename    图片文件名（含扩展名）
   * @param {string} noteFolder  .md 所在文件夹（相对下载根目录，供 {{noteFolder}} 用；可为空）
   * @param {string} prefix      自定义前缀（仅 custom 用）
   */
  function buildImageRef(mode, imgDir, filename, noteFolder, prefix) {
    var m = normalizeImageRefMode(mode);
    var dir = trimSlashes(imgDir);
    var name = trimSlashes(filename);
    var rel = [dir, name].filter(Boolean).join('/');
    if (!rel) return '';

    if (m === 'relative') return rel;
    if (m === 'custom') {
      // 先替换 {{noteFolder}}，再合并因它为空而产生的重复斜杠
      var pre = normalizeRefPrefix(prefix)
        .replace(/\{\{noteFolder\}\}/gi, trimSlashes(noteFolder))
        .replace(/\/{2,}/g, '/');
      if (!pre) return rel;
      if (!/\/$/.test(pre)) pre += '/';
      return pre + rel;
    }
    return './' + rel;
  }

  /**
   * 逐篇 / 平铺各存一份图片引用配置的字段名。
   * 两套归档方式的前缀互不影响 —— 在逐篇里点「恢复默认」不该把平铺的前缀改掉。
   */
  var IMAGE_REF_KEYS = {
    'per-article': { mode: 'perArticleImagePathMode', prefix: 'perArticleImageRefPrefix' },
    shared: { mode: 'sharedImagePathMode', prefix: 'sharedImageRefPrefix' }
  };

  function imageRefKeys(folderMode) {
    return IMAGE_REF_KEYS[folderMode === 'shared' ? 'shared' : 'per-article'];
  }

  /**
   * 按当前归档方式取图片引用配置，归一成 { mode, prefix }。
   *
   * 分档字段缺失时回落到 ≤v23 的单份旧配置（imagePathMode / imageRefPrefix），
   * 老用户升级后不用重新选一遍；一旦写入过新字段就以新字段为准。
   */
  function resolveImageRefForFolder(cfg, folderMode) {
    cfg = cfg || {};
    var keys = imageRefKeys(folderMode);
    return resolveImageRefConfig({
      imagePathMode: typeof cfg[keys.mode] === 'string' ? cfg[keys.mode] : cfg.imagePathMode,
      imageRefPrefix: typeof cfg[keys.prefix] === 'string' ? cfg[keys.prefix] : cfg.imageRefPrefix
    });
  }

  return {
    formatMoment: formatMoment,
    getOrdinal: getOrdinal,
    sanitizeName: sanitizeName,
    sanitizePath: sanitizePath,
    sanitizePathSegment: sanitizePathSegment,
    simpleHash: simpleHash,
    resolveTemplate: resolveTemplate,
    resolveDateOnlyTemplate: resolveDateOnlyTemplate,
    IMAGE_REF_MODES: IMAGE_REF_MODES,
    IMAGE_REF_KEYS: IMAGE_REF_KEYS,
    imageRefKeys: imageRefKeys,
    normalizeImageRefMode: normalizeImageRefMode,
    normalizeRefPrefix: normalizeRefPrefix,
    resolveImageRefConfig: resolveImageRefConfig,
    resolveImageRefForFolder: resolveImageRefForFolder,
    buildImageRef: buildImageRef
  };
})();
