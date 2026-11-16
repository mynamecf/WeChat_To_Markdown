/**
 * test/paths.test.js —— 命名、路径清洗、安全判断、data URL
 *
 * 这些是 background / content / options 三处共用的「规则层」，
 * 一旦漂移，表现是「预览的文件名和落盘的不一样」「图片链接指向不存在的文件」
 * ——都属于不报错但结果错的类型，最值得用测试钉住。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** lib 里的模块都用 var 挂全局，这里用 Function 作用域把它们取出来 */
function load(rel, tail) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return new Function(src + '\n' + tail)();
}

const D = load('lib/defaults.js', 'return { DEFAULTS: WXMD_DEFAULTS, isPrivate: WXMD_isPrivateHost, isWxImg: WXMD_isWechatImageHost, isArticle: WXMD_isWechatArticleUrl };');
const N = load('lib/naming.js', 'return WXMD_NAMING;');
const DL = load('lib/download.js', 'return WXMD_DL;');

// ---------- 路径清洗 ----------

test('sanitizePath：过滤 .. 与绝对路径，非法字符换下划线', () => {
  assert.equal(N.sanitizePath('a/../b'), 'a/b');
  assert.equal(N.sanitizePath('/etc/passwd'), 'etc/passwd');
  assert.equal(N.sanitizePath('a/b:c*d?'), 'a/b_c_d');   // 尾部下划线会被收掉
});

test('sanitizePath：Windows 保留名加前缀，避免 Invalid filename', () => {
  assert.equal(N.sanitizeSegment('CON'), '_CON');
  assert.equal(N.sanitizeSegment('com1.md'), '_com1.md');
});

test('sanitizePath：单段截到 80 字符，且不以点/空格结尾', () => {
  const long = N.sanitizeSegment('x'.repeat(200));
  assert.equal(long.length, 80);
  assert.ok(!/[.\s]$/.test(N.sanitizeSegment('abc.')));
});

test('resolveTemplate：路径模板不再被 100 字符整体截断（会把目录截丢）', () => {
  const tpl = '微信文章/' + 'y'.repeat(60) + '/{{title}}';
  const out = N.resolveTemplate(tpl, 0, '', { title: '标题' }, true);
  assert.ok(out.includes('/标题'), '最后一级目录被截掉了: ' + out);
  assert.ok(out.startsWith('微信文章/'));
});

test('buildImageRef：三种模式的写法', () => {
  assert.equal(N.buildImageRef('relative', 'img', 'a.png', 'note', ''), 'img/a.png');
  assert.equal(N.buildImageRef('note', 'img', 'a.png', 'note', ''), './img/a.png');
  assert.equal(
    N.buildImageRef('custom', 'img', 'a.png', 'note', '/微信/{{noteFolder}}/'),
    '/微信/note/img/a.png'
  );
});

// ---------- 安全判断 ----------

test('isPrivateHost：内网 / 本机 / 短名命中，公网 IPv6 放行', () => {
  ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', 'localhost', 'router', '::1', 'fd00::1'].forEach(h => {
    assert.equal(D.isPrivate(h), true, h + ' 应该判为内网');
  });
  ['mmbiz.qpic.cn', '2606:4700::1111', '8.8.8.8'].forEach(h => {
    assert.equal(D.isPrivate(h), false, h + ' 不该判为内网');
  });
});

test('isWxImg：只认微信图床，后缀匹配不能被子域前缀骗过', () => {
  assert.equal(D.isWxImg('mmbiz.qpic.cn'), true);
  assert.equal(D.isWxImg('qpic.cn'), true);
  assert.equal(D.isWxImg('res.wx.qq.com'), true);
  assert.equal(D.isWxImg('evil.qpic.cn.attacker.com'), false);
  assert.equal(D.isWxImg('qpic.cn.attacker.com'), false);
  assert.equal(D.isWxImg('evil.example'), false);
});

test('isArticleUrl：只认 https + 精确 hostname', () => {
  assert.equal(D.isArticle('https://mp.weixin.qq.com/s/abc'), true);
  assert.equal(D.isArticle('https://mp.weixin.qq.com.evil.example/s/abc'), false);
  assert.equal(D.isArticle('http://mp.weixin.qq.com/s/abc'), false);
});

test('默认配置：第三方图床默认关闭', () => {
  assert.equal(D.DEFAULTS.allowExternalImages, false);
});

// ---------- data URL ----------

test('toDataUrl：超限抛 wxmdTooLarge，带上真实字节数', () => {
  let err = null;
  try {
    DL.toDataUrl('中'.repeat(100), 10);
  } catch (e) {
    err = e;
  }
  assert.ok(err, '超限没有抛错');
  assert.equal(err.wxmdTooLarge, 300);   // 中文 3 字节 × 100
});

test('toDataUrl：中文按 base64 编码，膨胀约 1.33 倍（不是 encodeURIComponent 的 9 倍）', () => {
  const text = '中文内容';
  const url = DL.toDataUrl(text, 1024);
  assert.ok(url.startsWith('data:text/markdown;charset=utf-8;base64,'));
  const b64 = url.split(',')[1];
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), text);
  // 只比 base64 载荷与原始字节：base64 是 4/3 倍，encodeURIComponent 会是 3 倍原文
  const bytes = DL.byteLength(text);
  assert.ok(b64.length < bytes * 1.4, 'base64 载荷膨胀异常: ' + b64.length + ' vs ' + bytes);
});

test('byteLength 与 toDataUrl 的上限判断口径一致', () => {
  const text = 'a'.repeat(100);
  assert.equal(DL.byteLength(text), 100);
  assert.doesNotThrow(() => DL.toDataUrl(text, 100));
});
