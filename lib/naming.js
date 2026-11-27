/**
 * lib/naming.js —— 命名模板解析（唯一实现）
 *
 * 为什么单独抽出来：
 *   原本 content.js（实际落盘）和 options.js（配置页预览）各有一套实现，
 *   清洗规则不一致（空白转下划线、连续点、首尾下划线、100 字符截断），
 *   导致预览显示的文件名和真实落盘的不是同一个 —— 预览在骗用户。
 *   这里收敛成一份，两边共用，永久消除漂移。
 *
 * 引入方式：
 *   - 注入顺序统一在 lib/injectlist.js 的 WXMD_INJECT_FILES 里定义（排在 defaults.js 之后）
 *   - background.js  : importScripts('lib/naming.js')
 *   - options.html   : 用 script 标签引入（排在 options.js 之前）
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

  /* ------------------------------------------------------------------------
   * 文章发布时间解析
   *
   * {{published}} 的值来自页面节点 #publish_time 的 innerText，原样保留 ——
   * 微信不同模板给出来的字符串完全不一样，实测见过的形态：
   *   2026年11月16日 10:00      普通图文（当前主模板）
   *   2026年11月16日            只有日期，没有时分
   *   2026-11-16 10:00          老版页面 / 部分分享页
   *   2026/11/16、2026.11.16    视频号与部分转载页
   *   2026年11月16日 10:00:00   带秒
   *   20261116                  少数页面把紧凑时间写进属性后被 innerText 带出来
   *   1月21日                   分享页 / 从聊天打开（当年省略年份）—— 见下面「无年份」
   * 所以不能只认一种：按「年月日分隔符」宽匹配，再回读校验。
   *
   * 解析不出来（「昨天」「3 天前」「发布于 广东」）就返回 null ——
   * 这类值没有确定的年月日，猜一个只会生成错误的文件夹名。
   * ---------------------------------------------------------------------- */

  function parsePublishedDate(input) {
    var s = String(input == null ? '' : input);
    if (!s) return null;

    // 全角数字转半角：个别页面把时间渲染成全角，直接匹配会漏
    s = s.replace(/[\uFF10-\uFF19]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).trim();

    var y, mo, d;
    var m = s.match(/(\d{4})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*日?/);
    if (m) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else {
      // 紧凑形式：必须左右都不是数字，避免从一串 id / 时间戳里截出 8 位
      m = s.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/);
      if (m) {
        y = +m[1]; mo = +m[2]; d = +m[3];
      } else {
        // 无年份：分享页 / 聊天内打开时，微信在「当年」的日期上省略年份，
        // #publish_time 只剩「1月21日」「01-21」。这类值按「最近一个已经过去的
        // 该月日」推断 —— 页面既然不写年份，说明它就在最近 12 个月内；
        // 算出来落在未来就退一年（12 月看到「1月5日」= 今年 1 月，
        // 1 月看到「12月30日」= 去年 12 月）。
        // 前面确实出现过 4 位数字就不能走这条路，否则 2026-01-21 会被
        // 二次匹配成「01-21」。
        if (/\d{4}/.test(s)) return null;
        m = s.match(/(?:^|\D)(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*日?(?:\D|$)/);
        if (!m) return null;
        mo = +m[1]; d = +m[2];
        var now = new Date();
        var guess = new Date(now.getFullYear(), mo - 1, d);
        // 留一天容差：跨零点导出时「今天」不该被当成未来而退一年
        if (guess.getTime() - now.getTime() > 86400000) {
          guess = new Date(now.getFullYear() - 1, mo - 1, d);
        }
        y = guess.getFullYear();
      }
    }

    var hh = 0, mm = 0, ss = 0;
    var t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (t) {
      hh = +t[1]; mm = +t[2]; ss = t[3] ? +t[3] : 0;
    }

    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (hh > 23 || mm > 59 || ss > 59) return null;

    var dt = new Date(y, mo - 1, d, hh, mm, ss);
    // 回读校验：2 月 30 日这类非法值会被 Date 静默进位成 3 月 2 日
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  /** Windows 保留设备名：CON / PRN / AUX / NUL / COM1-9 / LPT1-9（带扩展名同样非法） */
  var RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  // 单段长度上限：Windows 全路径 260 字符，留足目录与扩展名的余量
  var MAX_SEGMENT = 80;

  /**
   * 单段文件名/目录名清洗 —— 唯一实现。
   *
   * 原先有两条并行的规则：本文件里一套（sanitizeName / sanitizePathSegment），
   * background.js 里另一套（cleanSegment，额外处理 Windows 保留名和 80 字符截断）。
   * 同一份模板先后过两道规则，结果却不一致 —— 排查「预览的文件名为什么和落盘不一样」
   * 时非常难受。现在统一到这里，background 直接复用。
   */
  function sanitizeSegment(seg) {
    var s = String(seg == null ? '' : seg)
      // 路径分隔符、Windows 非法字符、C0 控制字符一律换下划线
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^[_\s]+/, '')
      .slice(0, MAX_SEGMENT)
      // 结尾清理必须在 slice 之后：截断本身可能把结尾落到点号或空格上，
      // 而 Windows 不允许文件名以 "." 或 " " 结尾（会直接报 Invalid filename）
      .replace(/[.\s]+$/, '')
      .replace(/_+$/, '');
    if (RESERVED_NAME.test(s)) s = '_' + s;
    return s;
  }

  /** 文件名（单段）：与目录段同一套规则，保留旧名字供调用方使用 */
  function sanitizeName(name) {
    return sanitizeSegment(name);
  }

  /** 多段相对路径：保留 /，逐段清洗后合并；过滤 . / .. 与空段 */
  function sanitizePath(p) {
    return String(p == null ? '' : p)
      .replace(/\\/g, '/')
      .split('/')
      .filter(function (seg) { return seg && seg !== '.' && seg !== '..'; })
      .map(sanitizeSegment)
      .filter(Boolean)
      .join('/');
  }

  /** 用作路径片段时禁止出现 / ，避免 {{title}} 意外制造子目录 */
  function sanitizePathSegment(name) {
    return sanitizeSegment(name);
  }

  function simpleHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
  }

  /* ------------------------------------------------------------------------
   * 图片扩展名推断（唯一实现）
   *
   * 微信图片 URL 里「存储格式」和「下发格式」是两件事：
   *   /mmbiz_png/xxx/640?wx_fmt=png&tp=webp
   * 存储是 png，但 tp=webp 要求 CDN 转码成 webp 下发。只取 wx_fmt 会把 webp
   * 字节存成 .png，编辑器按扩展名判断就预览不了。
   *
   * 信号按可靠性排序：tp > 路径 webp > wx_fmt > 路径前缀 > 文件后缀。
   * 原先只有 background.js 里一份（落盘后缀），content.js 拿不到，所以模板里
   * 没有「这张图是什么格式」可用。提到这里之后两边共用，规则不会漂移。
   * ---------------------------------------------------------------------- */

  var IMG_FMT_ALIASES = {
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
    var m = path.match(/(?:^|\/)(?:sz_)?mmbiz_([a-z]+)(?:\/|$)/);
    return m ? m[1] : '';
  }

  /**
   * 从图片 URL 推断落盘扩展名（不含点）。
   * 零网络请求：qpic 有 Referer 防盗链，HEAD/Range 探测只会换来 403 和限流。
   */
  function extFromUrl(url) {
    if (!url || typeof url !== 'string') return 'jpg';

    var u;
    try {
      u = new URL(url);
    } catch (e) {
      return 'jpg';
    }

    var path = u.pathname.toLowerCase();
    var params = u.searchParams;

    // 1. tp=webp —— 显式请求 CDN 转码，优先级最高
    if ((params.get('tp') || '').toLowerCase() === 'webp') return 'webp';

    // 2. 路径本身就是 webp 资源（用 pathname，避免查询参数里出现 mmbiz_webp 误命中）
    if (/(?:^|\/)(?:sz_)?mmbiz_webp(?:\/|$)/.test(path)) return 'webp';

    // 3. wx_fmt —— 请求参数，最贴近实际下发格式
    var byParam = normalizeImgFmt(params.get('wx_fmt'));
    if (byParam) return byParam;

    // 4. 路径前缀兜底（wx_fmt 缺失或为 other 时）
    var byPrefix = normalizeImgFmt(extractMmbizPrefix(path));
    if (byPrefix) return byPrefix;

    // 5. 文件名后缀
    var m = path.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/);
    if (m) return normalizeImgFmt(m[1]) || 'jpg';

    return 'jpg';
  }

  /**
   * 补上真实扩展名。
   *
   * 模板里可能自己写了后缀（Img_{{index1}}.{{ext}}），渲染后已经以 .png 结尾；
   * 这时再补一次会得到 1.png.png。只在这一种情况下跳过补全——
   * 后缀位置可以由用户决定，但「有没有后缀」不能交给模板猜（漏写就是打不开的文件）。
   */
  function withRealExt(base, ext) {
    var lower = String(base == null ? '' : base).toLowerCase();
    var suffix = '.' + String(ext == null ? '' : ext).toLowerCase();
    if (!ext) return String(base == null ? '' : base);
    return lower.slice(-suffix.length) === suffix ? String(base) : String(base) + '.' + ext;
  }


  /**
   * 解析命名模板。
   * @param {string} template 模板
   * @param {number} index    图片序号（0 起）
   * @param {string} targetUrl 用于生成 {{hash8}}
   * @param {object} meta     {title, author, published, url, domain, site, ext}
   *                          ext 只有图片命名与图片目录模板会传（这张图的真实格式）；
   *                          目录模板按张解析，所以混排文章会落到不同子目录
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

    // {{published}} 不带格式时保持「页面原文」，这是历史行为：
    // 改成默认 YYYY-MM-DD 会让老用户已建好的文件夹名整体变形。
    // 带 :格式 时才解析成日期，标记与 {{date:格式}} 完全同一套。
    // 原文解析不出来（「昨天」这类）时渲染成空串，宁可少一段也不要错的日期。
    result = result.replace(/\{\{published(?::([^}]+))?\}\}/g, function (_, fmt) {
      if (!fmt) return sanitizeName(m.published);
      var dt = parsePublishedDate(m.published);
      return dt ? formatMoment(dt, fmt) : '';
    });

    result = result
      .replace(/\{\{title\}\}/g, isPath ? sanitizePathSegment(m.title) : sanitizeName(m.title))
      .replace(/\{\{author\}\}/g, isPath ? sanitizePathSegment(m.author) : sanitizeName(m.author))
      .replace(/\{\{url\}\}/g, sanitizeName(m.url))
      .replace(/\{\{domain\}\}/g, sanitizeName(m.domain))
      .replace(/\{\{site\}\}/g, isPath ? sanitizePathSegment(m.site) : sanitizeName(m.site))
      .replace(/\{\{index1\}\}/g, String(index + 1))
      .replace(/\{\{index\}\}/g, String(index))
      .replace(/\{\{hash8\}\}/g, simpleHash(targetUrl || ''))
      // 图片真实格式，统一大写（PNG / JPG / WEBP / GIF / BMP / SVG），不含点。
      // 只有「图片文件命名」与「图片保存目录」会传 meta.ext（按张传，所以目录也能
      // 按格式分开）；其余模板（文章文件夹、Markdown 名称）里渲染成空串。
      .replace(/\{\{ext\}\}/g, sanitizeName(m.ext ? String(m.ext).toUpperCase() : ''));

    result = isPath ? sanitizePath(result) : sanitizeName(result);
    if (!result) result = isPath ? '' : 'image_' + index;
    // 单段结果再兜一次总长；路径不做整体截断——把路径从中间切断会悄悄丢掉最后一级目录，
    // 总长度由 background.js 的 limitPath 统一处理（它知道要和图片引用保持一致）。
    if (!isPath && result.length > 100) result = result.slice(0, 100);
    return result;
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
    parsePublishedDate: parsePublishedDate,
    getOrdinal: getOrdinal,
    RESERVED_NAME: RESERVED_NAME,
    MAX_SEGMENT: MAX_SEGMENT,
    sanitizeSegment: sanitizeSegment,
    sanitizeName: sanitizeName,
    sanitizePath: sanitizePath,
    sanitizePathSegment: sanitizePathSegment,
    simpleHash: simpleHash,
    extFromUrl: extFromUrl,
    withRealExt: withRealExt,
    normalizeImgFmt: normalizeImgFmt,
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
