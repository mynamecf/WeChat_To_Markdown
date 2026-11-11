/**
 * lib/codeblock.js —— 代码块整理（唯一实现）
 *
 * 为什么单独抽出来：
 *   公众号正文里的「代码块」有三套完全不同的 DOM 形态，处理逻辑横跨伪 pre 拆分、
 *   编辑器结构归一、行还原、关键字粘连修复四件事，混在 content.js 那 800 行里
 *   很难单独看、单独测。这里收敛成一个模块，入口只有 normalizeCodeBlocks()。
 *
 * 覆盖的三种形态：
 *   1. 等宽 <p> 成组（微信用 <p style="font-family:monospace"> 逐行排版）
 *      → 多个 <p> 合成一个 <pre><code>，行内 <br> 当换行；
 *   2. 编辑器导出型 <pre>（mdnice 等：<pre><span 工具栏/><code><span>行</span><br>…</code></pre>）
 *      → normalizeEditorPres() 整理成标准 <pre><code>；
 *   3. 伪 pre（微信用 <pre> 包普通段落）
 *      → unwrapFakePre() 拆回 <div>，不能当代码块。
 *
 * 顺序敏感：normalizeEditorPres() 必须在 unwrapFakePre() 之前，
 *   否则「工具栏 span + code」这种两子节点的 pre 会被当成伪 pre 拆掉，
 *   代码退化成行内 code（整段粘一行、围栏消失）。
 *
 * 引入方式（两处都要加，缺一处导出时拿不到代码块整理）：
 *   - background.js : executeScript files 里，排在 content.js 之前
 *   - popup.js      : INJECT_FILES 里，同样位置
 *   用 var 声明，保证多文件 executeScript 注入时挂到同一个 isolated world 全局上。
 */
var WXMD_CODE = (function () {
  'use strict';

  // 等宽字体识别：命中即认为这段是代码（用于等宽 <p> 路径和代码块头部判定）
  var MONO_FONT_RE = /font-family[^;]*(monospace|consolas|courier|menlo|monaco|'sf mono'|'source code'|'fira code'|'jetbrains mono')/i;

  // 围栏语言里没有高亮意义的写法：不写 ```lang
  var NO_LANG_RE = /^(text|txt|plain|plaintext|code|none)$/i;

  /**
   * 代码块整理总入口。
   * @param {Element} root 正文克隆节点（会被就地修改）
   * @param {Function} [log] 调试输出，缺省不打印
   */
  function normalizeCodeBlocks(root, log) {
    if (typeof log !== 'function') log = function () {};
    if (!root) return;

    log('pre before:', root.querySelectorAll('pre').length);

    // 先整理编辑器导出的 <pre>（mdnice 这类），必须在 unwrapFakePre 之前：
    // 它们的子节点是「工具栏 span + code」，两个子节点会被判成伪 pre 直接拆成 div，
    // 代码就退化成行内 `code`，换行和缩进全丢。
    var editorPres = normalizeEditorPres(root);
    log('editor pre normalized:', editorPres);

    unwrapFakePre(root);

    log('pre after unwrap:', root.querySelectorAll('pre').length);

    var doc = root.ownerDocument || document;
    root.querySelectorAll('pre').forEach(function (pre) {
      if (!pre.querySelector('code')) {
        var code = doc.createElement('code');
        while (pre.firstChild) code.appendChild(pre.firstChild);
        pre.appendChild(code);
      }
    });

    // 原实现只认 p 自身的 style 属性，所以这里先按 font-family 预筛，
    // 与后续 monoRe 判定完全等价，但候选集从「全部 p」降到「有字体的 p」。
    var allMonoPs = Array.prototype.filter.call(
      root.querySelectorAll('p[style*="font-family" i]'),
      function (p) {
        if (p.closest('pre')) return false;
        return MONO_FONT_RE.test(p.getAttribute('style') || '');
      }
    );
    log('monospace p:', allMonoPs.length);

    if (allMonoPs.length === 0) return;

    var grouped = new Map();
    allMonoPs.forEach(function (p) {
      var parent = p.parentElement;
      if (!parent) return;
      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push(p);
    });

    var contentContainers = [];
    grouped.forEach(function (ps, parent) {
      if (ps.length < 2) return;
      var direct = Array.from(parent.children);
      var monoPCount = 0;
      for (var i = 0; i < direct.length; i++) {
        var child = direct[i];
        var tag = child.tagName.toLowerCase();
        if (tag === 'p') {
          if (!MONO_FONT_RE.test(child.getAttribute('style') || '')) return;
          monoPCount++;
        } else if (tag === 'span' || tag === 'section' || tag === 'div') {
          if (child.textContent.trim()) return;
          if (child.querySelector('p, img, h1, h2, h3, h4, h5, h6')) return;
        } else {
          return;
        }
      }
      if (monoPCount < 2) return;
      contentContainers.push({ parent: parent, ps: ps });
    });

    log('code containers:', contentContainers.length);

    contentContainers.forEach(function (item) {
      var parent = item.parent;
      var ps = item.ps;
      if (!parent.parentNode) return;

      var langHint = '';
      var headerEl = null;
      var wrapper = parent.parentElement;
      if (wrapper && (wrapper.tagName === 'SECTION' || wrapper.tagName === 'DIV')) {
        var siblings = Array.from(wrapper.children);
        var idx = siblings.indexOf(parent);
        if (idx > 0) {
          var info = analyzeHeader(siblings[idx - 1], MONO_FONT_RE);
          if (info.isHeader) {
            langHint = info.lang;
            headerEl = siblings[idx - 1];
          }
        }
      }

      // <br> 是 void 元素，不贡献任何文本：一个 p 内用 br 分行的代码，
      // 直接读 textContent 会三行粘成一行且毫无分隔。必须先转成 \n 再按行拆分，
      // 否则行尾空白清理（[ \t]+$ 只匹配整串结尾）也一并失效。
      var lines = [];
      ps.forEach(function (p) {
        p.querySelectorAll('br').forEach(function (br) { br.replaceWith('\n'); });
        String(p.textContent || '')
          .replace(/\u00a0/g, ' ')
          .split('\n')
          .forEach(function (line) {
            lines.push(repairGluedKeywords(line.replace(/[ \t]+$/g, '')));
          });
      });
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length === 0) return;

      var pre = doc.createElement('pre');
      var code = doc.createElement('code');
      if (langHint && !NO_LANG_RE.test(langHint)) {
        code.setAttribute('class', 'language-' + langHint);
      }
      code.textContent = lines.join('\n');
      pre.appendChild(code);

      if (headerEl && headerEl.parentNode) headerEl.remove();
      parent.replaceWith(pre);
    });
  }

  function isRealCodeBlock(pre) {
    var kids = pre.children;
    return kids.length === 1 && kids[0].tagName === 'CODE';
  }

  /**
   * 整理「编辑器导出型」<pre>。
   *
   * mdnice 一类编辑器导出的代码块长这样：
   *   <pre data-tool="mdnice编辑器">
   *     <span class="wx_imgbc_placeholder" style="height:30px;background-image:..."></span>  ← 工具栏
   *     <code><span>行1</span><span><br></span><span>行2</span>…</code>
   *   </pre>
   *
   * 三个坑，都会让代码块完全失真：
   *   1. 工具栏 span 排在 code 前面：Turndown 取 node.firstChild.textContent 当代码，
   *      只能拿到空串，于是输出一个空代码块；
   *   2. pre 有两个子元素，isRealCodeBlock 判为 false，会被 unwrapFakePre 拆成 div，
   *      代码退化成行内 `code`（整段粘成一行，围栏也没了）；
   *   3. 换行靠 <br>、缩进靠 &nbsp;（\u00a0）：textContent 既不认 br 也不认缩进。
   *
   * 所以这里把 code 内部按行重建成纯文本、删掉工具栏等一切非 code 子节点，
   * 让它变成一个标准的 <pre><code>，后面的围栏输出就走通用逻辑。
   *
   * @returns {number} 整理了多少个 pre（便于排查）
   */
  function normalizeEditorPres(root) {
    // 工具栏上的复制按钮文案（直接丢掉）/ 语言名（当围栏语言）/ 没有高亮意义的「语言」
    var COPY_LABEL_RE = /^(复制|复制代码|代码复制|拷贝|copy|copy code|copie|code)$/i;
    var LANG_LABEL_RE = /^[A-Za-z][\w+#.\-]{0,19}$/;

    var count = 0;
    Array.from(root.querySelectorAll('pre')).forEach(function (pre) {
      var code = pre.querySelector('code');
      // 只处理「code 是 pre 的直接子节点」：更深的嵌套（pre > p > code）说明这里面
      // 混了正文，硬拆会把父节点里的文字一起删掉，交给后面的通用逻辑处理
      if (!code || code.parentNode !== pre) return;

      // 同级子节点：工具栏（有的只放背景图，有的写着「复制代码」，有的干脆是语言名）。
      // 只允许「空文字 / 复制类按钮 / 语言名」这三种，出现别的内容就说明这里混了正文，
      // 不做整理，免得把正文一起删掉。
      var extras = Array.from(pre.children).filter(function (el) { return el !== code; });
      var labels = [];
      for (var i = 0; i < extras.length; i++) {
        var t = (extras[i].textContent || '').trim();
        if (!t) continue;
        if (COPY_LABEL_RE.test(t)) continue;
        if (!LANG_LABEL_RE.test(t)) return;
        labels.push(t);
      }

      var lines = extractCodeLines(code);
      if (lines.length === 0) return;

      // 工具栏写了语言名（Java / Python…）就顺手当围栏语言，txt/text/plain 不算
      var lang = null;
      for (var j = 0; j < labels.length; j++) {
        if (!NO_LANG_RE.test(labels[j])) { lang = labels[j]; break; }
      }
      if (lang) code.setAttribute('class', 'language-' + lang.toLowerCase());
      else if (code.getAttribute('class')) code.removeAttribute('class');

      pre.textContent = '';          // 清掉工具栏、背景图等装饰节点
      code.textContent = lines.join('\n');
      pre.appendChild(code);         // 重新挂回，pre 只剩一个 code 子节点
      count++;
    });
    return count;
  }

  /**
   * 把一个代码容器（<code> / <pre> / <p>）的结构还原成「一行一条」的纯文本：
   * <br> 与块级子元素都算换行，&nbsp; 还原成普通空格，行尾空白去掉。
   */
  function extractCodeLines(root) {
    var lines = [];
    var buf = '';

    var pushLine = function () {
      lines.push(repairGluedKeywords(
        buf.replace(/\u00a0/g, ' ').replace(/[ \t]+$/g, '')
      ));
      buf = '';
    };

    (function walk(node) {
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var child = kids[i];
        if (child.nodeType === 3) {
          buf += child.nodeValue;
          continue;
        }
        if (child.nodeType !== 1) continue;
        var tag = child.tagName;
        if (tag === 'BR') { pushLine(); continue; }
        if (tag === 'IMG' || tag === 'SVG' || tag === 'SCRIPT' || tag === 'STYLE') continue;
        if (/^(P|DIV|SECTION|LI|TR|H[1-6]|BLOCKQUOTE)$/.test(tag)) {
          // 少数编辑器用块级元素分行，前后都要断开
          if (buf) pushLine();
          walk(child);
          if (buf) pushLine();
          continue;
        }
        walk(child);   // 行内 span 等：继续往下找 <br>
      }
    })(root);

    if (buf) pushLine();

    // 首尾空行去掉；中间的空行保留（代码里的空行有意义）
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines;
  }

  // 部分编辑器导出时会把「关键字 + 关键字」之间的空格吃掉（publicclass / publicinterface，
  // 以及类名后直接接 implements / extends），源码层面已经丢了，只能按组合补回来。
  // 只认「两个保留字相邻」和「字母 + implements/extends + 空格」这两种：
  // 不动「关键字 + 标识符」（staticMap / publicKey 可能是正常变量名）。
  function repairGluedKeywords(line) {
    return line
      .replace(/(public|private|protected|static|final|abstract)(class|interface|enum|void)\b/g, '$1 $2')
      .replace(/([A-Za-z])(implements|extends)(?=\s)/g, '$1 $2');
  }

  /**
   * 剥离伪 pre（微信用 pre 包裹普通段落）。
   * 逆序遍历一遍即可：内层先处理完，外层再处理时结构已稳定，
   * 不需要原来的「最多 20 轮全树扫描」。
   */
  function unwrapFakePre(root) {
    var pres = Array.from(root.querySelectorAll('pre')).reverse();
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (!pre.parentNode || isRealCodeBlock(pre)) continue;
      var doc = pre.ownerDocument || document;
      var div = doc.createElement('div');
      while (pre.firstChild) div.appendChild(pre.firstChild);
      pre.parentNode.replaceChild(div, pre);
    }
  }

  /**
   * 判断等宽 <p> 代码块上方的「头部条」是否是语言标签行。
   * 用来给围栏补 language-xxx；不是头部就返回 false，不会误删正文。
   */
  function analyzeHeader(el, monoRe) {
    if (!el || (el.tagName !== 'SECTION' && el.tagName !== 'DIV')) {
      return { isHeader: false, lang: '' };
    }
    if (el.querySelector('p')) return { isHeader: false, lang: '' };
    if (el.textContent.trim().length > 40) return { isHeader: false, lang: '' };

    var hasDots = el.querySelector('span[style*="border-radius"]');
    var lang = '';
    var spans = el.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      var style = sp.getAttribute('style') || '';
      var t = (sp.textContent || '').trim();
      if (!t) continue;
      if (!monoRe.test(style)) continue;
      if (t.length > 20) continue;
      if (!/^[\w\-+#.]+$/.test(t)) continue;
      if (/^\.+$/.test(t)) continue;
      lang = t;
      break;
    }

    return (hasDots || lang) ? { isHeader: true, lang: lang } : { isHeader: false, lang: '' };
  }

  return {
    // 唯一入口
    normalizeCodeBlocks: normalizeCodeBlocks,
    // 以下单独暴露，便于排查问题、写单测
    isRealCodeBlock: isRealCodeBlock,
    normalizeEditorPres: normalizeEditorPres,
    extractCodeLines: extractCodeLines,
    repairGluedKeywords: repairGluedKeywords,
    unwrapFakePre: unwrapFakePre,
    analyzeHeader: analyzeHeader
  };
})();
