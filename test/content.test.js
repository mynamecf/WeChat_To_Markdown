/**
 * test/content.test.js —— 正文转换的回归夹具
 *
 * 这些用例都是「真实文章踩过的坑」，不是凭空构造的边界：
 *   div 段落粘连、表格退化成段落、代码块空行被压、非微信图床、图片消息。
 * 每个用例都写明「坏的时候是什么表现」，方便将来改坏时判断严重程度。
 */
const test = require('node:test');
const assert = require('node:assert');
const { render } = require('./helpers');

const S = t => `<section><span leaf="">${t}</span></section>`;
const cellTable = (head, rows) => `<table>
  <thead><tr>${head.map(h => `<th>${S(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`;

// ---------- 段落（P1：<div> 直装正文） ----------

test('div 直装正文：多段不能粘成一段', async () => {
  const { body } = await render('<div>第一段文字</div><div>第二段文字</div>');
  assert.match(body, /第一段文字\n\n第二段文字/);
});

test('div 带 style 也照样分段（旧实现只看 style 就 return content）', async () => {
  const { body } = await render('<div style="color:red">甲段</div><div style="color:blue">乙段</div>');
  assert.match(body, /甲段\n\n乙段/);
});

test('div 包图片：图片与前后正文各留一个空行', async () => {
  const { body } = await render(
    '<div>上文</div><div><img src="https://mmbiz.qpic.cn/a.png"></div><div>下文</div>'
  );
  assert.match(body, /上文\n\n!\[\]\(\{\{IMG_0\}\}\)\n\n下文/);
});

test('列表项里的 div 不把紧凑列表撑散', async () => {
  const { body } = await render('<ul><li><div>甲</div></li><li><div>乙</div></li></ul>');
  // 紧凑列表：两项之间不能有空行（撑散就成了松散列表，渲染成两个段落）
  assert.match(body, /-\s+甲\n-\s+乙/);
});

test('正文不会出现三连空行（收尾整理仍然生效）', async () => {
  const { body } = await render('<div>甲</div><div><br></div><div>乙</div>');
  assert.ok(!/\n{3,}/.test(body), '正文里出现了三连空行:\n' + JSON.stringify(body));
});

// ---------- 表格 ----------

test('表格：section 包裹的单元格仍输出 GFM 表格', async () => {
  const { body } = await render(cellTable(
    ['卖点', '口径'],
    [[S('永久免费'), S('5GB')], [S('不限流量'), S('不限量')]]
  ));
  assert.match(body, /\| 卖点 \| 口径 \|/);
  assert.match(body, /\| --- \| --- \|/);
  assert.match(body, /\| 永久免费 \| 5GB \|/);
});

test('表格：单元格里的裸竖线要转义，不能多出一列', async () => {
  const { body } = await render(cellTable(['符号'], [[S('A|B')]]));
  assert.match(body, /\| A\\\|B \|/);
});

test('表格：单元格多段改用 <br>，不能截断表格行', async () => {
  const { body } = await render(cellTable(['列'], [[`${S('第一段')}${S('第二段')}`]]));
  assert.match(body, /\| 第一段<br>第二段 \|/);
});

test('表格：单元格含 svg 图标时整格跳过，但文字不能丢', async () => {
  const { body } = await render(cellTable(['列'], [[
    '<section><svg width="16" height="16"><circle cx="8" cy="8" r="6"></circle></svg><span>图标说明</span></section>'
  ]]));
  assert.match(body, /\| 图标说明 \|/);
  assert.match(body, /\| --- \|/);
});

test('表格：单元格含图片时保持单行 {{IMG_n}}', async () => {
  const { body } = await render(cellTable(['图'], [[
    '<section><img src="https://mmbiz.qpic.cn/b.png"></section>'
  ]]));
  assert.match(body, /\| !\[\]\(\{\{IMG_0\}\}\) \|/);
});

// ---------- 代码块 ----------

test('代码块：连续空行与只含空格的行原样保留', async () => {
  const code = 'def f():\n    a = 1\n\n\n    b = 2\n    \n    return a';
  const { body } = await render(`<pre><code>${code}</code></pre>`);
  assert.ok(body.includes('a = 1\n\n\n    b = 2'), '代码块里的连续空行被压掉了:\n' + body);
  assert.ok(body.includes('\n    \n    return a'), '代码块里只含空格的行被清空了:\n' + body);
});

// ---------- 引用块 / 列表 ----------

test('引用块：带左边框的容器转成 blockquote', async () => {
  const { body } = await render(
    '<section style="border-left: 3px solid #ccc; padding-left: 8px;"><span>引用的一段话</span></section>'
  );
  assert.match(body, /^> 引用的一段话/m);
});

test('嵌套列表：ul > ul 的子项挂回上一项并保留缩进', async () => {
  const { body } = await render('<ul><li>父项</li><ul><li>子项</li></ul></ul>');
  // 子项必须缩进在父项之下（Turndown 用 4 空格层级缩进）
  assert.match(body, /-\s+父项\n\s+-\s+子项/);
});

// ---------- 图片：下载策略 ----------

test('图片：非微信图床默认不下载，保留在线链接', async () => {
  const { body, images, blockedImages } = await render(
    '<p><img src="https://evil.example/x.png"></p>'
  );
  assert.equal(images.length, 0, '默认策略不该下载第三方图床');
  assert.equal(blockedImages, 1);
  assert.match(body, /!\[\]\(https:\/\/evil\.example\/x\.png\)/);
});

test('图片：打开 allowExternalImages 后才下载第三方图床', async () => {
  const { body, images } = await render(
    '<p><img src="https://evil.example/x.png"></p>',
    { allowExternalImages: true }
  );
  assert.equal(images.length, 1);
  assert.match(body, /!\[\]\(\{\{IMG_0\}\}\)/);
});

test('图片：内网地址即使开了开关也不下载', async () => {
  const { images, blockedImages } = await render(
    '<p><img src="http://192.168.1.5/secret.png"></p>',
    { allowExternalImages: true }
  );
  assert.equal(images.length, 0);
  assert.equal(blockedImages, 1);
});

test('图片：data-src 优先，协议相对地址补成 https', async () => {
  const { images } = await render(
    '<p><img src="https://mmbiz.qpic.cn/thumb.png" data-src="//mmbiz.qpic.cn/real.png?wx_fmt=png"></p>'
  );
  assert.equal(images.length, 1);
  assert.equal(images[0].url, 'https://mmbiz.qpic.cn/real.png?wx_fmt=png');
});

// ---------- 图片消息（图文 / 小绿书） ----------

test('图片消息：正文外的轮播图补到描述文字之后', async () => {
  const inner = `<div id="js_image_content">
      <h1 class="rich_media_title">这是标题</h1>
      <p id="js_image_desc">一段描述文字</p>
    </div>`;
  const extra = `<div id="img_list">
      <div class="swiper_item share_media_swiper_size_placeholder"><img src="https://mmbiz.qpic.cn/preview1.png"></div>
      <div class="swiper_item" data-src="https://mmbiz.qpic.cn/1.png?wx_fmt=png"></div>
      <div class="swiper_item" data-src="https://mmbiz.qpic.cn/2.png?wx_fmt=png"></div>
    </div>`;

  const { body, images } = await render(inner, {}, { extra });
  assert.equal(images.length, 2, '空壳项不该被当正文图');
  assert.ok(body.indexOf('一段描述文字') < body.indexOf('{{IMG_0}}'), '图片必须在文字之后');
});

// ---------- 视频号卡片（mp-common-videosnap） ----------
// 这类卡片没有 <video>、没有 web 播放页：data-url 实测返回的是封面 JPEG，
// 页面里也没有 channels.weixin.qq.com / weixin:// 之类的可分享地址。
// 所以只能指回原文，并用 ?wxmd_video=N 让扩展在页面就绪后滚过去。

// 注意别用「默认属性 + 再拼一份覆盖」的写法：HTML 里同名属性取第一个，
// data-nickname 拼两次永远是新华社，测试会假绿。
const snapCard = ({ nick = '新华社', type = 'video', tail = '' } = {}) =>
  `<section class="channels_iframe_wrp" nodeleaf="">`
  + `<mp-common-videosnap class="js_uneditable channels_iframe videosnap_video_iframe js_wechannel_video_card"`
  + ` data-pluginname="mpvideosnap" data-nickname="${nick}" data-type="${type}"></mp-common-videosnap>`
  + `</section>${tail}`;

test('视频号卡片：没有播放页，指回原文并带定位参数', async () => {
  const { body } = await render(snapCard());
  assert.match(
    body,
    /\[视频（视频号 · 新华社）\]\(https:////mp/.weixin/.qq/.com//s//test/?wxmd_video=1/)/
  );
});

test('视频号卡片：多个按正文顺序编号', async () => {
  const { body } = await render(
    snapCard({ tail: '<p>中间一段</p>' })
    + snapCard({ nick: '央视新闻' })
  );
  const first = body.indexOf('wxmd_video=1');
  const second = body.indexOf('wxmd_video=2');
  assert.ok(first >= 0 && second > first, '两个卡片应分别拿到 1 和 2');
  assert.match(body, /视频号 · 央视新闻/);
});

test('视频号直播：标注为直播而不是视频', async () => {
  const { body } = await render(snapCard({ type: 'live' }));
  assert.match(body, /\[直播（视频号直播 · 新华社）\]/);
});

test('原文已带参数和 #wechat_redirect：定位参数追加在 hash 之前', async () => {
  const { body } = await render(
    snapCard(),
    {},
    { url: 'https://mp.weixin.qq.com/s?__biz=MzA4&mid=244&idx=1&sn=abc#wechat_redirect' }
  );
  assert.match(body, /__biz=MzA4&mid=244&idx=1&sn=abc&wxmd_video=1#wechat_redirect/);
});

test('视频号卡片：卡片里的 UI 文案不能当正文导出', async () => {
  const { body } = await render(
    '<section class="channels_iframe_wrp"><mp-common-videosnap data-nickname="新华社"'
    + ' data-type="video">已关注 重播 分享 2704</mp-common-videosnap></section>'
  );
  assert.ok(!/已关注|重播|2704/.test(body), '播放器 UI 文案漏进正文了');
});

test('微信自营视频（videosnippet）仍然给可播放页，不带定位参数', async () => {
  const { body } = await render(
    '<mp-common-videosnippet><iframe data-src="https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&action=mpvideo&vid=wxv_1234567890123456"></iframe></mp-common-videosnippet>'
  );
  assert.match(body, /readtemplate\?t=pages\/video_player_tmpl/);
  assert.ok(!/wxmd_video/.test(body), '自营视频不该带定位参数');
});
