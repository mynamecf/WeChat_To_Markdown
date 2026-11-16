/**
 * lib/tables.js —— 表格单元格摊平 + GFM 表格规则
 *
 * 背景：微信表格的单元格几乎都是 <td><section><span>文字</span></section></td>。
 * section 是块级元素，content.js 的 wechatSection 规则会给它前后补空行，
 * 单元格内容于是变成「\n\n卖点\n\n」。GFM 表格靠「一行一组 | 分隔」识别，
 * 单元格里一出现换行，整张表就退化成几个带竖线的普通段落——表现就是「表格没识别到」。
 *
 * 两步配合：
 *   1. normalizeTableCells()  结构层，在 Turndown 之前把单元格里的块级容器摊平；
 *   2. installRules()         规则层，兜住结构层跳过的复杂单元格，并压掉残余换行。
 *
 * 用 var 声明，保证多文件 executeScript 注入时挂到同一个 isolated world 全局上。
 */
var WXMD_TABLES = (function () {
  'use strict';

  // 单元格里算「块级」的标签（摊平时要断行的那一类）
  var CELL_BLOCK_RE = /^(P|DIV|SECTION|H[1-6]|LI|UL|OL|BLOCKQUOTE|FIGURE|FIGCAPTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|DL|DT|DD|CENTER|ADDRESS|FIELDSET|FORM)$/;

  // 单元格里出现这些内容就整格跳过：硬摊开会丢内容（svg 只留空壳）或撑坏列宽
  var CELL_SKIP_SEL = 'pre, img, video, audio, iframe, canvas, table, ul, ol, svg, math';

  function noop() {}

  /**
   * 把表格单元格里的块级结构摊平成一行。
   *
   * 单元格里全是块级容器时，把容器内容摊进单元格，块与块之间插 <br>
   * （<br> 由 wxmdCellBreak 规则写成字面 <br>，Markdown 表格里照样换行）。
   * 含图片/代码/嵌套表格/列表/svg 的单元格整格跳过，交给 wxmdTableCell 压平。
   */
  function normalizeTableCells(root, log) {
    var LOG = typeof log === 'function' ? log : noop;
    if (!root || !root.querySelectorAll) return;

    var cells = root.querySelectorAll('th, td');
    if (!cells.length) return;

    var doc = root.ownerDocument || document;
    var flattened = 0;
    var skipped = 0;

    Array.prototype.forEach.call(cells, function (cell) {
      if (cell.querySelector(CELL_SKIP_SEL)) {
        skipped++;
        return;
      }

      var blocks = Array.prototype.filter.call(cell.children, function (el) {
        return CELL_BLOCK_RE.test(el.tagName);
      });
      if (!blocks.length) return;   // 纯文字 / 行内元素：Turndown 本来就不插空行

      // 块级容器之外还有直接文字或行内元素（少见）：整格不动，宁可不美化也别丢字
      var hasStrayInline = Array.prototype.some.call(cell.childNodes, function (n) {
        return (n.nodeType === 3 && n.nodeValue.trim()) ||
          (n.nodeType === 1 && !CELL_BLOCK_RE.test(n.tagName));
      });
      if (hasStrayInline) {
        skipped++;
        return;
      }

      var frag = doc.createDocumentFragment();
      blocks.forEach(function (block, i) {
        if (i) frag.appendChild(doc.createElement('br'));
        flattenCellInto(block, frag, doc);
      });

      // 首尾只含空白的文本节点去掉，避免单元格里多出空格
      while (frag.firstChild && frag.firstChild.nodeType === 3 && !frag.firstChild.nodeValue.trim()) {
        frag.removeChild(frag.firstChild);
      }
      while (frag.lastChild && frag.lastChild.nodeType === 3 && !frag.lastChild.nodeValue.trim()) {
        frag.removeChild(frag.lastChild);
      }

      cell.textContent = '';
      cell.appendChild(frag);
      flattened++;
    });

    LOG('table cells flattened:', flattened, 'skipped:', skipped);
  }

  /**
   * 把块级元素的子节点摊到 target 上；嵌套块另起一行，行内元素保留原标签。
   * svg / math 这类「整块内容在子节点里」的标签必须整棵搬过去，否则只剩空壳。
   */
  function flattenCellInto(node, target, doc) {
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) {
        if (!n.nodeValue.trim()) {
          // 只保留「两侧都有内容」的空白，免得把 a b 粘成 ab
          if (n.nodeValue && target.childNodes.length) target.appendChild(doc.createTextNode(' '));
          return;
        }
        target.appendChild(doc.createTextNode(n.nodeValue));
        return;
      }
      if (n.nodeType !== 1) return;

      var tag = n.tagName.toLowerCase();
      if (tag === 'svg' || tag === 'math') {
        target.appendChild(n.cloneNode(true));
        return;
      }

      if (CELL_BLOCK_RE.test(n.tagName)) {
        if (target.childNodes.length) target.appendChild(doc.createElement('br'));
        flattenCellInto(n, target, doc);
        return;
      }
      if (n.tagName === 'BR') {
        target.appendChild(doc.createElement('br'));
        return;
      }

      var copy = n.cloneNode(false);
      flattenCellInto(n, copy, doc);
      target.appendChild(copy);
    });
  }

  /**
   * 注册两条 Turndown 规则（在 turndownService 建好之后、转换之前调用）：
   *   wxmdTableCell  单元格内容压成一行，裸「|」转义
   *   wxmdCellBreak  单元格内的 <br> 写成字面 <br>
   */
  function installRules(turndownService) {
    if (!turndownService || typeof turndownService.addRule !== 'function') return;

    // GFM 表格一行就是一行，单元格里任何换行（多段、列表、引用）都会把这一行从中间截断。
    // normalizeTableCells 已经把常见结构摊平了，这条规则兜住它跳过的复杂单元格，
    // 顺带把内容里的裸「|」转义掉——不转义会被当成列分隔符，多出一列。
    turndownService.addRule('wxmdTableCell', {
      filter: ['th', 'td'],
      replacement: function (content, node) {
        // 首列用「| 」开头。这里不能用 childNodes 的下标判断——单元格之间夹一个空白
        // 文本节点就会错位，行首少一根竖线，整张表照样散掉。
        var prefix = node.previousElementSibling ? ' ' : '| ';
        var text = String(content).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
        return prefix + text + ' |';
      }
    });

    // 默认规则输出「两空格 + 换行」，同样会截断表格行
    turndownService.addRule('wxmdCellBreak', {
      filter: function (node) {
        return node.nodeName === 'BR' && !!(node.closest && node.closest('th, td'));
      },
      replacement: function () { return '<br>'; }
    });
  }

  return {
    CELL_BLOCK_RE: CELL_BLOCK_RE,
    normalizeTableCells: normalizeTableCells,
    installRules: installRules
  };
})();
