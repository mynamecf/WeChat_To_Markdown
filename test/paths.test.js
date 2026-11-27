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

test('parsePublishedDate：认微信给出的几种原文形态', () => {
  const ymd = d => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
  assert.equal(ymd(N.parsePublishedDate('2026年11月16日 10:00')), '2026-11-16');
  assert.equal(ymd(N.parsePublishedDate('2026年11月16日')), '2026-11-16');
  assert.equal(ymd(N.parsePublishedDate('2026-11-16 10:00')), '2026-11-16');
  assert.equal(ymd(N.parsePublishedDate('2026/11/16')), '2026-11-16');
  assert.equal(ymd(N.parsePublishedDate('2026.11.16 08:05:09')), '2026-11-16');
  assert.equal(ymd(N.parsePublishedDate('20261116')), '2026-11-16');
  // 全角数字
  assert.equal(ymd(N.parsePublishedDate('２０２６年１１月１６日 10:00')), '2026-11-16');
  // 时分秒也带出来（格式里有 HH:mm 时才看得出来）
  const t = N.parsePublishedDate('2026年11月16日 10:05:09');
  assert.equal(t.getHours() * 10000 + t.getMinutes() * 100 + t.getSeconds(), 100509);
});

test('parsePublishedDate：非法与解析不出的值一律 null，不静默进位', () => {
  assert.equal(N.parsePublishedDate('2026年2月30日'), null);   // 会被 Date 进位成 3-2
  assert.equal(N.parsePublishedDate('2026年13月1日'), null);
  assert.equal(N.parsePublishedDate('昨天'), null);
  assert.equal(N.parsePublishedDate(''), null);
  assert.equal(N.parsePublishedDate(null), null);
});

test('{{published}}：不带格式时保持页面原文（历史行为不变）', () => {
  const meta = { published: '2026年11月16日 10:00' };
  assert.equal(N.resolveTemplate('{{published}}', 0, 'u', meta), '2026年11月16日_10_00');
  // 没取到发布时间就是空，不留字面量
  assert.equal(N.resolveTemplate('A{{published}}B', 0, 'u', {}), 'AB');
});

test('{{published:格式}}：YYYYMMDD / YY / MM / DD 都支持', () => {
  const meta = { published: '2026年11月16日 10:05' };
  assert.equal(N.resolveTemplate('{{published:YYYYMMDD}}', 0, 'u', meta), '20261116');
  assert.equal(N.resolveTemplate('{{published:YYMMDD}}', 0, 'u', meta), '261116');
  assert.equal(N.resolveTemplate('{{published:YYYY-MM-DD}}', 0, 'u', meta), '2026-11-16');
  assert.equal(N.resolveTemplate('{{published:YY}}', 0, 'u', meta), '26');
  assert.equal(N.resolveTemplate('{{published:MM}}', 0, 'u', meta), '11');
  assert.equal(N.resolveTemplate('{{published:DD}}', 0, 'u', meta), '16');
});

test('{{published:格式}}：原文解析不出时渲染成空串', () => {
  assert.equal(N.resolveTemplate('前{{published:YYYYMMDD}}后', 0, 'u', { published: '昨天' }), '前后');
  // 整段只剩空串时走的是 resolveTemplate 既有的兜底（image_N），
  // 关键是别把 {{published:…}} 当字面量留在名字里
  assert.equal(N.resolveTemplate('{{published:YYYYMMDD}}', 0, 'u', {}), 'image_0');
});

test('{{published:格式}}：路径模板里 YYYY/MM 照常分子目录', () => {
  const out = N.resolveTemplate('{{published:YYYY/MM}}/{{title}}', 0, 'u',
    { published: '2026-11-16', title: 'T' }, true);
  assert.equal(out, '2026/11/T');
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

// ---------- 文件后缀变量 {{ext}} ----------

test('resolveTemplate：{{ext}} 取图片真实格式，统一大写', () => {
  assert.equal(N.resolveTemplate('{{index1}}.{{ext}}', 0, 'u', { ext: 'webp' }), '1.WEBP');
  assert.equal(N.resolveTemplate('{{index1}}.{{ext}}', 4, 'u', { ext: 'png' }), '5.PNG');
  assert.equal(N.resolveTemplate('IMG_{{ext}}_{{index1}}', 0, 'u', { ext: 'gif' }), 'IMG_GIF_1');
});

test('resolveTemplate：非图片模板里 {{ext}} 渲染成空串，不留字面量', () => {
  assert.equal(N.resolveTemplate('{{title}}.{{ext}}', 0, 'u', { title: 'T' }), 'T');
  assert.equal(N.resolveTemplate('IMG-{{ext}}-{{index1}}', 0, 'u', {}), 'IMG--1');
  // 文件夹/路径模板同样没有值
  assert.equal(N.resolveTemplate('{{ext}}/{{index1}}', 0, 'u', {}, true), '1');
});

test('withRealExt：模板自带后缀时不重复补', () => {
  assert.equal(N.withRealExt('1', 'png'), '1.png');
  assert.equal(N.withRealExt('1.png', 'png'), '1.png');
  assert.equal(N.withRealExt('1.PNG', 'png'), '1.PNG');
  assert.equal(N.withRealExt('1.png', 'webp'), '1.png.webp');
  // Markdown 名称写了 {{ext}} 后不要再拼一次 .md
  assert.equal(N.withRealExt('文章.MD', 'md'), '文章.MD');
  assert.equal(N.withRealExt('文章', 'md'), '文章.md');
});

test('extFromUrl：tp > 路径 webp > wx_fmt > 前缀 > 文件后缀', () => {
  assert.equal(N.extFromUrl('https://mmbiz.qpic.cn/mmbiz_png/a/640?wx_fmt=png&tp=webp'), 'webp');
  assert.equal(N.extFromUrl('https://mmbiz.qpic.cn/mmbiz_png/a/640?wx_fmt=png'), 'png');
  assert.equal(N.extFromUrl('https://mmbiz.qpic.cn/sz_mmbiz_jpg/a/640'), 'jpg');
  assert.equal(N.extFromUrl('https://example.com/a/b.gif'), 'gif');
  assert.equal(N.extFromUrl(''), 'jpg');
});

test('parsePublishedDate：无年份的「1月21日」按最近一个已过去的该月日推断', () => {
  // 分享页 / 从聊天点开的模板只在「当年」省略年份，所以月日一定在最近 12 个月内
  const d = N.parsePublishedDate('1月21日');
  assert.ok(d, '无年份日期解析不出:' + d);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 21);

  const now = new Date();
  const thisYear = new Date(now.getFullYear(), 0, 21);
  // 未来的月日要退一年，否则会生成一个「还没到」的日期
  const expected = thisYear.getTime() - now.getTime() > 86400000
    ? now.getFullYear() - 1
    : now.getFullYear();
  assert.equal(d.getFullYear(), expected);

  // 带时分、横杠分隔、全角数字都要认
  const t = N.parsePublishedDate('1月21日 23:25');
  assert.equal(t.getHours(), 23);
  assert.equal(t.getMinutes(), 25);
  assert.ok(N.parsePublishedDate('01-21'));
  assert.ok(N.parsePublishedDate('１月２１日'));
});

test('parsePublishedDate：跨年与非法值', () => {
  const now = new Date();
  // 「12月30日」在当前日期之前就是今年，之后就是去年 —— 两种情况都不该落到明年
  const dec = N.parsePublishedDate('12月30日');
  assert.ok(dec);
  assert.ok(dec.getFullYear() === now.getFullYear() || dec.getFullYear() === now.getFullYear() - 1);
  assert.ok(dec.getTime() <= now.getTime() + 86400000);

  assert.equal(N.parsePublishedDate('1月32日'), null);
  assert.equal(N.parsePublishedDate('13月1日'), null);
  // 已经带 4 位年份的不能被「无年份」分支二次匹配成 01-21
  const full = N.parsePublishedDate('2026-01-21 23:25');
  assert.equal(full.getFullYear(), 2026);

  assert.equal(N.parsePublishedDate('昨天'), null);
  assert.equal(N.parsePublishedDate('3 天前'), null);
});

test('{{published:格式}}：原文缺年份时仍能输出完整日期', () => {
  const meta = { published: '1月21日', title: '文笔不好' };
  const out = N.resolveTemplate('{{published:YYYYMMDD}}_{{title}}', 0, 'u', meta);
  assert.match(out, /^\d{8}_文笔不好$/, '日期段没渲染出来: ' + out);
  assert.ok(out.slice(4, 6) === '01', '月份不对: ' + out);
  assert.ok(out.slice(6, 8) === '21', '日不对: ' + out);
  assert.match(N.resolveTemplate('{{published:YYYY/MM}}', 0, 'u', meta, true), /^\d{4}\/01$/);
});
