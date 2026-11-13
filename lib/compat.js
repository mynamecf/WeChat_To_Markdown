/**
 * lib/compat.js —— 微信特殊排版兼容层
 *
 * 只放「这一篇/这一类文章用特殊 HTML 拼出来的、通用规则认不出来」的结构。
 * 通用的正文归一（段落、列表、引用块）留在 content.js，代码块在 lib/codeblock.js，
 * 这里专收零散的特殊形态，后续再遇到同类问题都往这里加，避免又散回 content.js。
 *
 * 目前包含：
 *   1. 手写序号（normalizeManualListNumbers）——「<li>1. 工具载体：…</li>」这种
 *      序号是作者手打进正文的，Turndown 还会再加一遍 → 「1.  1\. 工具载体」。
 *   2. 浮动编号（normalizeFloatingMarkers）——「1.多角色智能配音：」这种用
 *      float:left 的 section 当序号的伪列表，序号和内容会被拆成两段。
 *   3. 伪标题（normalizePseudoHeadings）——「一、背景」「3.1 开箱即用：…」这种
 *      只用字号/颜色/加粗装作标题，标签仍是 section / p 的段落。
 *
 * 引入方式（两处都要加，缺一处导出时特殊排版不会被兼容）：
 *   - background.js : executeScript files 里，排在 content.js 之前
 *   - popup.js      : INJECT_FILES 里，同样位置
 *   用 var 声明，保证多文件 executeScript 注入时挂到同一个 isolated world 全局上。
 */
var WXMD_COMPAT = (function () {
  'use strict';

  // 中文序号：一、背景 / 二、What is Zvec? / 十、附录
  var CN_HEADING_RE = /^[一二三四五六七八九十百]+、\s*\S/;
  // 多级数字：3.1 开箱即用 / 3.1.2 细节
  // 必须带空格，避免把「3.14 是圆周率」这类正文当成标题
  var NUM_HEADING_RE = /^\d+(?:\.\d+)+\s+\S/;
  // 标题里不该有句末标点：出现就说明这是正文句子，不是标题
  var SENTENCE_RE = /[。！？；]/;
  // 标题长度上限（字符）
  var MAX_LEN = 40;

  // 序号形态：1. / 1、 / (1) / a) / - / • / ① / 一、
  // 只认「纯序号」，长度也卡在 4 个字符，正文句子基本撞不上
  var MARKER_RE = /^(?:\d{1,2}[.、)）]|[（(]\d{1,2}[)）]|[A-Za-z][.、)）]|[-–—•·▪◦◆◇●○*]|[①-⑳]|[一二三四五六七八九十]{1,3}[、.])$/;
  var MARKER_MAX_LEN = 4;

  // 列表项开头的手写序号：1. / 1、 / 1) / 1）、 / （1） / (1)
  // 末尾的 (?!\d) 是拦「1.5 版本」——「一点五」不是「第 1 条」；
  // 西文括号常和顿号连写成「1）、」，所以允许再跟一个顿号/句点。
  var MANUAL_NUM_RE = /^\s*(?:(\d{1,2})\s*(?:[.、．]|[)）][、.．]?)\s*(?!\d)|[（(]\s*(\d{1,2})\s*[）)]\s*[.、．]?\s*)/;
  // 找「这一项的第一段文字」时要跳过的子树：子列表、代码、引用、表格、媒体
  var SKIP_TEXT_RE = /^(UL|OL|PRE|BLOCKQUOTE|TABLE|FIGURE|IMG|SVG|VIDEO|AUDIO|IFRAME|CANVAS|BR|HR|WXMD-LINK)$/;
  // 摘掉序号后可能变空的行内壳子（<span>1.</span> 这类）
  var INLINE_SHELL_RE = /^(SPAN|SECTION|P|DIV|STRONG|B|EM|I|FONT)$/;

  /**
   * 兼容层统一入口。
   * @param {Element} root 正文克隆节点（会被就地修改）
   * @param {Function} [log] 调试输出
   * @returns {number} 一共处理了多少处
   */
  function normalizeCompat(root, log) {
    if (!root) return 0;
    // 先处理列表项里的手写序号：这一步只摘序号、调 <ol start>，
    // 和其它两步互不影响，放在最前面是为了让后面的规则看到的都是「干净的正文」
    var manual = normalizeManualListNumbers(root);
    if (typeof log === 'function') log('manual list numbers:', manual);

    // 再合并序号：合并后的文字变长，不会再有被误判成标题的机会
    var markers = normalizeFloatingMarkers(root);
    if (typeof log === 'function') log('floating markers:', markers);

    var count = normalizePseudoHeadings(root);
    if (typeof log === 'function') log('pseudo headings:', count);
    return count + markers + manual;
  }

  /**
   * 列表项里的手写序号 → 真列表序号。
   *
   * 有些编辑器（mdnice / Doocs 那套）导出的「有序列表」，编号是作者手打进正文的：
   *   <ol><li><section><span>1. 工具载体：VS Code…</span></section></li></ol>
   * Turndown 会给每个 <li> 自动补一个「1.  」，于是导出成「1.  1\. 工具载体」——序号出现两遍。
   *
   * 更麻烦的是这类文章「每一步」都单独包一个 <ol>（中间夹着截图），自动编号每段都从头数：
   * 第 2~14 步的手写序号明明是 2~14，导出来全是「1.」，序号彻底乱掉。
   *
   * 处理办法：<li> 开头的手写序号认定是作者意图 —— 从正文里摘掉，改成所在 <ol> 的
   * start 属性，让 Turndown 用它来编号（它读 start 再按位置递增）。
   * <ul> 里如果「每一项」都手写了序号，说明本来就是有序列表，直接换成 <ol>；
   * 只写了一部分的没把握（可能是正文里恰好以数字开头的条目），一律不动。
   */
  function normalizeManualListNumbers(root) {
    var doc = root.ownerDocument || document;
    var lists = root.querySelectorAll('ol, ul');
    var total = 0;

    for (var i = 0; i < lists.length; i++) {
      var list = lists[i];
      if (!list.parentNode) continue;

      // 只看直接子项：嵌套列表有它自己的父级，各自处理
      var items = [];
      for (var c = 0; c < list.children.length; c++) {
        if (list.children[c].tagName === 'LI') items.push(list.children[c]);
      }
      if (!items.length) continue;

      var marks = [];
      var found = 0;
      var first = 0;
      for (var j = 0; j < items.length; j++) {
        var mark = readManualNumber(items[j]);
        marks.push(mark);
        if (mark) {
          found++;
          if (!first) first = mark.num;
        }
      }
      if (!found) continue;

      if (list.tagName === 'OL') {
        // start 是「第一项的编号」，后面的 Turndown 会按位置 +1
        if (first && !list.hasAttribute('start')) list.setAttribute('start', String(first));
        for (j = 0; j < marks.length; j++) if (marks[j]) takeManualNumber(marks[j]);
        total += found;
        continue;
      }

      // <ul>：全项带号才认成有序列表
      if (found !== items.length) continue;
      var ol = doc.createElement('ol');
      if (first) ol.setAttribute('start', String(first));
      var style = list.getAttribute('style');
      if (style) ol.setAttribute('style', style);
      for (j = 0; j < marks.length; j++) takeManualNumber(marks[j]);
      while (list.firstChild) ol.appendChild(list.firstChild);
      list.parentNode.replaceChild(ol, list);
      total += found;
    }

    return total;
  }

  /** 读出这一项开头的手写序号（读不到返回 null，不做任何修改） */
  function readManualNumber(li) {
    var node = firstTextNode(li);
    if (!node) return null;

    var m = MANUAL_NUM_RE.exec(node.nodeValue);
    if (!m) return null;
    var num = Number(m[1] || m[2]);
    if (!(num >= 0 && num <= 99)) return null;

    // 整项只剩一个序号（没有正文）就不摘：摘完会变成一个空的列表项，
    // 保留原样至少还能看出编号
    if (!otherTextLen(li, node, m[0].length)) return null;

    return { node: node, len: m[0].length, num: num };
  }

  /** 把序号从正文里摘掉，顺手清掉被摘空的行内壳 */
  function takeManualNumber(mark) {
    var node = mark.node;
    node.nodeValue = node.nodeValue.slice(mark.len);
    pruneEmptyShell(node);
  }

  /**
   * 这一项里「第一段有字的文本」，跳过子列表/代码/引用/媒体。
   * 必须按文档顺序找：序号总是在最前面那个 span 里，
   * 不能拿 textContent 一刀切（那会把子列表的文字也算进来）。
   */
  function firstTextNode(el) {
    for (var k = el.firstChild; k; k = k.nextSibling) {
      if (k.nodeType === 3) {
        if (k.nodeValue && k.nodeValue.trim()) return k;
        continue;
      }
      if (k.nodeType !== 1) continue;
      if (SKIP_TEXT_RE.test(k.tagName)) continue;
      var found = firstTextNode(k);
      if (found) return found;
    }
    return null;
  }

  /** 除「被摘掉序号的那段文字」之外，这一项还有多少文字（子列表不算本项正文） */
  function otherTextLen(el, skipNode, skipLen) {
    var len = 0;
    for (var k = el.firstChild; k; k = k.nextSibling) {
      if (k === skipNode) {
        // 只算「摘掉序号之后」剩下的部分
        len += (k.nodeValue || '').slice(skipLen).replace(/\s+/g, ' ').trim().length;
        continue;
      }
      if (k.nodeType === 3) {
        len += k.nodeValue.replace(/\s+/g, ' ').trim().length;
        continue;
      }
      if (k.nodeType !== 1) continue;
      if (/^(UL|OL)$/.test(k.tagName)) continue;
      len += otherTextLen(k, skipNode, skipLen);
    }
    return len;
  }

  /**
   * 摘掉序号后变空的行内壳子一起删掉：<li><span>1.</span><span>正文</span></li> 里
   * 那个空 span 留着没有意义，还会在层层 section 里多出一个空段落。
   * 只删「没有文字也没有媒体」的 span/section/p/div 这几类纯容器。
   */
  function pruneEmptyShell(node) {
    var el = node.parentNode;
    if (!el || el.nodeType !== 1) return;
    if ((node.nodeValue || '').trim()) return;
    if (!INLINE_SHELL_RE.test(el.tagName)) return;
    if ((el.textContent || '').trim()) return;
    if (el.querySelector('img, svg, video, audio, iframe, canvas, br, wxmd-link')) return;
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  /**
   * 浮动序号 → 并回后面的正文。
   *
   * 有些排版器（秀米一类）的「有序列表」不是 <ul>/<ol>，而是：
   *   <section style="display:block;clear:both;margin-bottom:12px">   ← 一项
   *     <section style="float:left;width:24px">1.</section>           ← 序号
   *     <section style="margin-left:24px"><strong>多角色智能配音</strong>：…</section>
   *   </section>
   *
   * 序号和内容是并列的两个块级 section，转换后各自成为一段，于是变成
   * 「1.」单独一行、正文另起一行。这里把序号并进后面的内容开头，
   * 恢复成「1. **多角色智能配音**：…」这样的一行。
   *
   * 只处理「纯序号 + 写了 float 的叶子节点」，其它浮动元素（图标、色块）不动。
   */
  function normalizeFloatingMarkers(root) {
    var doc = root.ownerDocument || document;
    var nodes = root.querySelectorAll('section, p, div, span');
    var count = 0;

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.parentNode) continue;
      // 序号本身常被好几层 section 包着（<section float><section><section>1.</section>），
      // 所以不限制嵌套层数——文本总量只有 4 个字符，里面不可能藏着正文；
      // 只排除混了媒体 / 结构元素的情况
      if (el.querySelector('img, svg, br, ul, ol, table, pre, blockquote, video, audio, iframe')) continue;

      var text = normalizeSpace(el.textContent);
      if (!text || text.length > MARKER_MAX_LEN) continue;
      if (!MARKER_RE.test(text)) continue;
      // 真列表项、引用、代码、表格里的序号由原结构负责，不在这里改
      if (el.closest('li, pre, blockquote, table')) continue;
      if (!isFloated(el)) continue;

      var next = nextContentSibling(el);
      if (!next) continue;

      // 内容块外面还套着几层纯布局 section：直接把文本插在外层，Turndown 会让它
      // 单独成段（外层的块级子元素各自带空行）。要钻到真正承载文字的那一层，
      // 序号才和正文待在同一段里。
      var target = inlineTarget(next);

      // 中文序号「1、」后面不加空格；「1.」「•」加一个，读起来才不粘
      var sep = (/[.)）]$/.test(text) || /^[-–—•·▪◦◆◇●○*]$/.test(text)) ? ' ' : '';
      target.insertBefore(doc.createTextNode(text + sep), target.firstChild);
      el.parentNode.removeChild(el);
      count++;
    }

    return count;
  }

  /** 后面第一个「有内容」的兄弟块（跳过清除浮动用的空 section） */
  function nextContentSibling(el) {
    var next = el.nextElementSibling;
    while (next) {
      var tag = next.tagName;
      var usable = /^(SECTION|P|DIV|SPAN)$/.test(tag) && normalizeSpace(next.textContent);
      if (usable) return next;
      // 遇到图片 / 表格 / 列表就停手：序号并进这些块里只会添乱
      if (/^(IMG|UL|OL|TABLE|PRE|BLOCKQUOTE|H[1-6]|FIGURE|HR)$/.test(tag)) return null;
      next = next.nextElementSibling;
    }
    return null;
  }

  /**
   * 沿「唯一子元素」一路钻到承载文字的那一层。
   * 例：<section margin-left><section display:block><strong>标题</strong>：正文</section></section>
   * 外层有两个 section 会被当成布局容器，文本插进去就单独成段；钻到里层才是段落。
   */
  function inlineTarget(el) {
    var node = el;
    while (node.children.length === 1) {
      var only = node.children[0];
      if (!/^(SECTION|P|DIV|SPAN)$/.test(only.tagName)) break;
      if (node.querySelector('img, svg, video, audio, iframe, br')) break;
      node = only;
    }
    return node;
  }

  /** style 里写了 float 的才算「排版用的浮动序号」 */
  function isFloated(el) {
    var style = el.getAttribute && el.getAttribute('style');
    return !!style && /float\s*:\s*(left|right)/i.test(style);
  }

  function normalizeSpace(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * 伪标题 → 真 <h2>/<h3>。
   *
   * 公众号里常见的两种写法：
   *   一级：<section style="display:inline-block;font-size:17px;color:rgb(255,129,36);
   *                 border-bottom:5px solid rgb(255,129,36)">
   *           <p><span>一、背景</span></p>
   *         </section>
   *   二级：<section style="display:flex">…图标…
   *           <section><p><span><strong>3.1 开箱即用：…</strong></span></p></section>
   *         </section>
   *
   * 两者都没有 <h*> 标签，转换后只会是一段普通文字，层级全丢。
   * 这里按「文本形态 + 结构」判定，换成 h2 / h3，交给 Turndown 的 heading 规则。
   */
  function normalizePseudoHeadings(root) {
    var doc = root.ownerDocument || document;
    var nodes = root.querySelectorAll('section, p');
    var hits = [];

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = (el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text || text.length > MAX_LEN) continue;
      if (SENTENCE_RE.test(text)) continue;

      var level = 0;
      if (CN_HEADING_RE.test(text)) level = 2;
      else if (NUM_HEADING_RE.test(text)) level = 3;
      if (!level) continue;

      // 列表项、引用、代码、表格里的文字不是标题；
      // 已经是 h* 的也不再处理（避免重复包装）
      if (el.closest('li, pre, blockquote, table, h1, h2, h3, h4, h5, h6')) continue;
      // 结构必须干净：没有图片/换行/列表/表格混在里面
      if (!isSimpleBlock(el)) continue;
      // 「标题 + 配图」的组合容器（比如带小图标的标题行、图注）不当标题：
      // 否则会把整块里的图片一起抬成小节，图片位置也会跟着乱
      if (hasMediaInHolder(el, text)) continue;
      // 数字小节要求加粗：正文里「3.1 版本」这种句子通常不加粗，
      // 中文序号本身就是强信号，不再强制
      if (level === 3 && !isBold(el)) continue;

      hits.push({ el: el, text: text, level: level });
    }

    // 同一处标题常有多层 section 包着（布局壳 + 真正带样式的那个），
    // 只保留最内层，否则外层替换后还会再命中一次，输出两个标题。
    var leaves = hits.filter(function (hit) {
      return !hits.some(function (other) {
        return other.el !== hit.el && hit.el.contains(other.el);
      });
    });

    var count = 0;
    for (var j = 0; j < leaves.length; j++) {
      var hit = leaves[j];
      if (!hit.el.parentNode) continue;
      var h = doc.createElement('h' + hit.level);
      h.textContent = hit.text;
      hit.el.replaceWith(h);
      count++;
    }
    return count;
  }

  /** 只允许「行内文字 + 至多两层容器」的结构，混了媒体/分隔/嵌套列表就不动 */
  function isSimpleBlock(el) {
    if (el.querySelector('img, video, audio, iframe, svg, br, ul, ol, table, pre, blockquote, hr, wxmd-link')) {
      return false;
    }
    return el.querySelectorAll('section, p, div').length <= 2;
  }

  /** 加粗判定：<strong>/<b>，或自身/子孙 style 里写了 font-weight:bold / 600~900 */
  function isBold(el) {
    if (el.querySelector('strong, b')) return true;
    var nodes = [el].concat(Array.prototype.slice.call(el.querySelectorAll('span, p, section, div')));
    for (var i = 0; i < nodes.length; i++) {
      var style = nodes[i].getAttribute && nodes[i].getAttribute('style');
      if (style && /font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) return true;
    }
    return false;
  }

  /**
   * 承载元素的容器里是否还混着图片/图标。
   * 只在该容器「除了这段标题没有别的文字」时才算命中——这种多半是
   * 「标题 + 小图标」的排版件或图注，抬成 h2/h3 反而把图片位置弄乱。
   */
  function hasMediaInHolder(el, text) {
    var holder = el.closest('section') || el;
    if (holder === el) return false;
    if (!holder.querySelector('img, svg, video, audio, iframe, canvas, wxmd-link')) return false;
    var holderText = (holder.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return holderText === text;
  }

  return {
    // 唯一入口
    normalizeCompat: normalizeCompat,
    // 单独暴露便于排查/单测
    normalizeManualListNumbers: normalizeManualListNumbers,
    normalizeFloatingMarkers: normalizeFloatingMarkers,
    normalizePseudoHeadings: normalizePseudoHeadings,
    isSimpleBlock: isSimpleBlock,
    isBold: isBold
  };
})();
