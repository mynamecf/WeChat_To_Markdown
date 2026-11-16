/**
 * lib/injectlist.js —— 注入清单与 executeScript 结果解析（单一来源）
 *
 * 为什么单独一个文件：
 *   这份 lib 清单原先在 background.js 和 popup.js 里各写一遍，新增一个模块要改两处，
 *   漏改任意一处就是「模块未加载」的静默降级（导出结果对、但某类排版失真）。
 *   现在两处都引用本文件，加模块只改这里一个数组。
 *
 * 引入方式：
 *   - background.js  : importScripts('lib/injectlist.js')
 *   - popup.html     : 用 script 标签引入（排在 popup.js 之前）
 * 故意不放进 WXMD_INJECT_FILES：它只在扩展页/后台用，页面里用不到。
 * 注意：注释里不要出现 script 标签的字面闭合串，否则内联时会被 HTML 解析器截断。
 *
 * 顺序不能乱，后面的依赖前面的全局变量：
 *   defaults → naming → turndown → gfm → codeblock → compat → blocks → tables
 *   → attachment → imagepost → content
 */
var WXMD_INJECT_FILES = [
  'lib/defaults.js',
  'lib/naming.js',
  'lib/turndown.js',
  'lib/turndown-plugin-gfm.js',
  'lib/codeblock.js',
  'lib/compat.js',
  'lib/blocks.js',
  'lib/tables.js',
  'lib/attachment.js',
  'lib/imagepost.js',
  'content.js'
];

/**
 * executeScript 多文件注入时，results 里只有 content.js 那一项带实际返回值。
 * 从后往前找第一个像样的结果，不依赖固定下标。
 */
function WXMD_pickArticleData(results) {
  if (!Array.isArray(results)) return null;
  for (var i = results.length - 1; i >= 0; i--) {
    var r = results[i] && results[i].result;
    if (r && typeof r === 'object' && typeof r.success === 'boolean') return r;
  }
  return null;
}
