/**
 * test/helpers.js —— 在 Node 里跑真实的 content.js
 *
 * 不复制业务逻辑、不 mock DOM：用 jsdom 造一个「公众号文章页」，
 * 按 lib/injectlist.js 的顺序注入真实的 lib 与 content.js，
 * 取回 { markdown, body, images, blockedImages }。
 *
 * 这样夹具测的就是浏览器里跑的同一份代码——否则测试全绿而线上照旧坏。
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 注入清单以 lib/injectlist.js 为唯一来源，避免测试和线上用两份清单 */
const INJECT_FILES = (() => {
  const box = {};
  new Function('box', read('lib/injectlist.js') + '\nbox.files = WXMD_INJECT_FILES;')(box);
  return box.files;
})();

/**
 * content.js 是一个立即执行的 async IIFE，返回值拿不到。
 * 把 `(async function () { ... })()` 改写成 `window.__wxmdRun = async function () { ... }`，
 * 再把尾部改成分号闭合。content.js 结构一变这里会立刻抛错（而不是静默失效）。
 */
const CONTENT_SRC = (() => {
  const src = read('content.js');
  const head = src.indexOf('(async function () {');
  const tail = src.lastIndexOf('})();');
  if (head < 0 || tail < 0) {
    throw new Error('content.js 的 IIFE 结构变了，test/helpers.js 的包装需要更新');
  }
  return src.slice(0, head)
    + 'window.__wxmdRun = async function () {'
    + src.slice(head + '(async function () {'.length, tail)
    + '};';
})();

/** 去掉 YAML frontmatter，只留正文，断言写起来更直观 */
function bodyOf(markdown) {
  const parts = String(markdown).split('---\n');
  return parts.length >= 3 ? parts.slice(2).join('---\n') : markdown;
}

/**
 * @param {string} inner        #js_content 里的 HTML
 * @param {object} [settings]   覆盖 chrome.storage.local 的返回值
 * @param {object} [opts]       { title, url, noContent, titleHtml, head }
 *   titleHtml   用来换掉默认的 `#activity-name`（还原「图片消息 / 新版分享页」那种模板）
 *   head        用来往 <head> 里塞 meta / title
 *   htmlAttrs   拼到 <html> 上，用来模拟 background 写进来的 data-wxmd-* 桥
 *   nameHtml    换掉默认的 `<span id="js_name">`（分享页不渲染公众号名，传空串）
 *   timeHtml    换掉默认的 `<em id="publish_time">`（分享页只给「1月21日」，不传年份）
 */
async function render(inner, settings = {}, opts = {}) {
  const url = opts.url || 'https://mp.weixin.qq.com/s/test';
  const title = opts.title || '测试文章';
  const titleHtml = opts.titleHtml !== undefined
    ? opts.titleHtml
    : `<h1 id="activity-name">${title}</h1>`;
  const nameHtml = opts.nameHtml !== undefined
    ? opts.nameHtml
    : '<span id="js_name">测试公众号</span>';
  const timeHtml = opts.timeHtml !== undefined
    ? opts.timeHtml
    : '<em id="publish_time">2026年11月16日 10:00</em>';
  const html = `<!DOCTYPE html><html${opts.htmlAttrs ? ' ' + opts.htmlAttrs : ''}><head>${opts.head || ''}</head><body>
    ${titleHtml}
    ${nameHtml}
    ${timeHtml}
    ${opts.noContent ? '' : `<div id="js_content">${inner}</div>`}
    ${opts.extra || ''}
  </body></html>`;

  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;

  w.chrome = {
    storage: {
      local: {
        // content.js 有时传默认值对象、有时传 key 数组
        get: async (d) => {
          const base = (!d || Array.isArray(d)) ? {} : { ...d };
          return { ...base, ...settings };
        }
      }
    },
    runtime: { getManifest: () => ({ version: 'test' }) }
  };
  // jsdom 没有 layout，innerText 退化成 textContent 就够了
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    configurable: true
  });

  for (const f of INJECT_FILES) {
    if (f === 'content.js') continue;
    w.eval(read(f));
  }
  w.eval(CONTENT_SRC);

  const result = await w.__wxmdRun();
  if (!result || !result.success) {
    throw new Error('导出失败: ' + (result && result.error));
  }
  return {
    result,
    markdown: result.markdown,
    body: bodyOf(result.markdown),
    images: result.images || [],
    blockedImages: result.blockedImages || 0,
    window: w
  };
}

module.exports = { render, read, ROOT, INJECT_FILES, bodyOf };
