/**
 * lib/blocks.js —— 引用块与列表的结构归一
 *
 * 从 content.js 抽出来的两个函数（原先和 Turndown 规则、YAML 混在一个文件里）：
 *   normalizeQuotes       带左右边框的 section/div → blockquote
 *   normalizeNestedLists  子列表直接挂在 ul 下的不规范结构 → 挂回前一个 li
 *
 * 只做 DOM 结构改写，不依赖 Turndown，也不读写 storage；传入的 root 是正文克隆节点。
 * 用 var 声明，保证多文件 executeScript 注入时挂到同一个 isolated world 全局上。
 */
var WXMD_BLOCKS = (function () {
  'use strict';

  function noop() {}

  /** 带左右边框的 section/div → blockquote（微信里的引用块全靠样式画的） */
  function normalizeQuotes(root, log) {
    var LOG = typeof log === 'function' ? log : noop;
    if (!root || !root.querySelectorAll) return;

    // 只处理 style 里带左右边框的元素：微信正文的 section/div 动辄几千个，
    // 而真正构成引用块的通常个位数，先让属性选择器筛一遍再逐条判定。
    // i 标志是 CSS4 大小写不敏感，覆盖 FONT-FAMILY / BORDER-LEFT 这类写法。
    var candidates = Array.prototype.slice.call(
      root.querySelectorAll('[style*="border-left" i], [style*="border-right" i]')
    );
    var count = 0;

    // 逆序：内层先转，外层再判断时能通过 closest/querySelector 感知到已转换的 blockquote，
    // 避免产出 > > > 的多层嵌套。querySelectorAll 返回文档顺序，筛选后顺序不变。
    for (var i = candidates.length - 1; i >= 0; i--) {
      var el = candidates[i];
      if (!el.parentNode) continue;
      if (el.closest('pre') || el.closest('blockquote')) continue;
      // 真 <h1>~<h6> 是作者/Turndown 都认的结构，左边框只是装饰（「### 获取 Token」
      // 这种标题常配一条竖线），不能反过来把它拆成引用块——那是伪标题才有的猜测
      if (el.closest('h1, h2, h3, h4, h5, h6')) continue;

      var style = el.getAttribute('style') || '';
      if (/font-family[^;]*monospace/i.test(style)) continue;
      if (!/border-(left|right)\s*:\s*[1-9]\d*px\s+(solid|dashed|dotted)/i.test(style)) continue;
      if (!el.textContent.trim()) continue;

      // 不要把承载图片/表格/代码的容器整体变成引用块
      if (el.querySelector('img, table, pre, blockquote')) continue;

      // 用节点所属文档建元素，而不是全局 document：抽成模块后 root 可能来自别的文档
      var doc = root.ownerDocument || document;
      var bq = doc.createElement('blockquote');
      while (el.firstChild) bq.appendChild(el.firstChild);
      el.replaceWith(bq);
      count++;
    }

    LOG('blockquotes:', count);
  }

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
  function normalizeNestedLists(root, log) {
    var LOG = typeof log === 'function' ? log : noop;
    if (!root || !root.querySelectorAll) return;

    // 逆序：内层先归位，外层处理时结构已稳定
    var nested = Array.prototype.slice
      .call(root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol'))
      .reverse();
    var moved = 0;

    for (var i = 0; i < nested.length; i++) {
      var list = nested[i];
      if (!list.parentNode) continue;
      // 只认「前面紧挨着的 li」；中间夹了有文字的其它节点就不动，
      // 免得把子列表挂到不相干的条目下面（宁可平铺也不要挂错父项）
      var prev = list.previousElementSibling;
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
    normalizeQuotes: normalizeQuotes,
    normalizeNestedLists: normalizeNestedLists
  };
})();
