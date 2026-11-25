/**
 * test/queue.test.js —— 链接队列的纯逻辑
 *
 * 队列最怕的不是「导不出来」，而是「状态卡在 running 再也动不了」：
 * 那属于不报错、界面也不提示，只能靠重装扩展解决的问题。
 * 这里把状态迁移、去重、重试额度和 URL 校验全部钉住。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** lib 模块都用 var 挂全局；queue.js 里要用 defaults 的 URL 判断，所以拼在一起加载 */
function loadQueue() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/defaults.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(ROOT, 'lib/queue.js'), 'utf8');
  return new Function(src + '\nreturn WXMD_QUEUE;')();
}

const Q = loadQueue();
const URL_OK = 'https://mp.weixin.qq.com/s/hX_WmYpYDJAo3y5C-zQAAg';

// ---------- URL 校验 ----------

test('标准短链通过，并保留 query（?wxmd_video=1 决定视频定位）', () => {
  const a = Q.normalizeUrl(URL_OK);
  assert.equal(a.ok, true);
  assert.equal(a.url, URL_OK);

  const b = Q.normalizeUrl(URL_OK + '?wxmd_video=1');
  assert.equal(b.ok, true);
  assert.equal(b.url, URL_OK + '?wxmd_video=1');
});

test('带 __biz 参数的长链也认（pathname 是 /s）', () => {
  const u = 'https://mp.weixin.qq.com/s?__biz=MzA5&mid=265&idx=1&sn=abc';
  const r = Q.normalizeUrl(u);
  assert.equal(r.ok, true);
  assert.equal(r.url, u);
});

test('#rd 这种锚点被剥掉（同一篇文章不该算两条）', () => {
  const r = Q.normalizeUrl(URL_OK + '#rd');
  assert.equal(r.ok, true);
  assert.equal(r.url, URL_OK);
});

test('从整段分享文案里挑出链接', () => {
  const raw = '【标题】这是标题 ' + URL_OK + ' 点击查看全文';
  const r = Q.normalizeUrl(raw);
  assert.equal(r.ok, true);
  assert.equal(r.url, URL_OK);
});

test('分享文案里链接后面粘了中文标点也能剥干净', () => {
  const r = Q.normalizeUrl('看这个 ' + URL_OK + '，挺有意思的');
  assert.equal(r.ok, true);
  assert.equal(r.url, URL_OK);
});

test('非公众号域名被拒', () => {
  const r = Q.normalizeUrl('https://example.com/s/abc');
  assert.equal(r.ok, false);
  assert.match(r.error, /公众号/);
});

test('公众号下不是文章页的路径被拒（/mp/readtemplate 是视频页）', () => {
  const r = Q.normalizeUrl('https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl');
  assert.equal(r.ok, false);
  assert.match(r.error, /不是文章页/);
});

test('http 链接被拒（文章页只认 https）', () => {
  const r = Q.normalizeUrl('http://mp.weixin.qq.com/s/abc');
  assert.equal(r.ok, false);
});

test('空输入与乱输都被拒', () => {
  assert.equal(Q.normalizeUrl('').ok, false);
  assert.equal(Q.normalizeUrl('   ').ok, false);
  assert.match(Q.normalizeUrl('随便一段话').error, /不是合法网址/);
});

// ---------- 入队与去重 ----------

test('批量入队并保留加入顺序', () => {
  const r = Q.addItems([], [URL_OK, URL_OK + '2'], 1000);
  assert.equal(r.added.length, 2);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.items[0].status, 'queued');
  assert.equal(r.items[0].attempts, 0);
  assert.equal(r.items[0].tabId, null);
});

test('同一个 URL 重复加入被跳过，且带原因', () => {
  const first = Q.addItems([], [URL_OK], 1000);
  const second = Q.addItems(first.items, [URL_OK, URL_OK + '#rd'], 2000);
  assert.equal(second.added.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.match(second.skipped[0].reason, /已在队列中/);
});

test('非法链接逐条跳过，不影响同批里的合法链接', () => {
  const r = Q.addItems([], [URL_OK, 'https://example.com/x', '乱码'], 1000);
  assert.equal(r.added.length, 1);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.items.length, 1);
});

test('业务上不设 50 条上限：300 条全部入队', () => {
  const urls = [];
  for (let i = 0; i < 300; i++) urls.push(URL_OK + '_' + i);
  const r = Q.addItems([], urls, 1000);
  assert.equal(r.items.length, 300);
  assert.equal(r.added.length, 300);
  assert.equal(r.skipped.length, 0);
  // 风控提示阈值单独存在，且低于常见批量（200）
  assert.equal(Q.RISK_WARN_ITEMS, 200);
});

test('防误贴硬顶：超过 MAX_ITEMS 的部分被拒，并给出可执行的原因', () => {
  const urls = [];
  for (let i = 0; i < Q.MAX_ITEMS + 5; i++) urls.push(URL_OK + '_' + i);
  const r = Q.addItems([], urls, 1000);
  assert.equal(r.items.length, Q.MAX_ITEMS);
  assert.equal(r.skipped.length, 5);
  assert.match(r.skipped[0].reason, /清空已完成/);
});

// ---------- 取活与状态迁移 ----------

test('取活只取 queued，running 不被抢占', () => {
  const r = Q.addItems([], [URL_OK, URL_OK + '2'], 1000);
  const moved = Q.patchItem(r.items, r.items[0].id, { status: 'running' });
  const next = Q.nextQueued(moved);
  assert.equal(next.id, r.items[1].id);
});

test('全部处理完时取不到活（泵必须能退出）', () => {
  const r = Q.addItems([], [URL_OK], 1000);
  const done = Q.patchItem(r.items, r.items[0].id, { status: 'done' });
  assert.equal(Q.nextQueued(done), null);
});

test('patchItem 返回新数组，不改原对象（storage 存的是快照）', () => {
  const r = Q.addItems([], [URL_OK], 1000);
  const next = Q.patchItem(r.items, r.items[0].id, { status: 'done', title: '改过了' });
  assert.equal(r.items[0].status, 'queued');
  assert.equal(r.items[0].title, '');
  assert.equal(next[0].status, 'done');
  assert.equal(next[0].title, '改过了');
});

test('patchItem 遇到不存在的 id 原样返回', () => {
  const r = Q.addItems([], [URL_OK], 1000);
  const next = Q.patchItem(r.items, 'nope', { status: 'done' });
  assert.equal(next.length, 1);
  assert.equal(next[0].status, 'queued');
});

test('removeItem / clearFinished 只清该清的', () => {
  const r = Q.addItems([], [URL_OK, URL_OK + '2', URL_OK + '3'], 1000);
  let items = Q.patchItem(r.items, r.items[0].id, { status: 'done' });
  items = Q.patchItem(items, r.items[1].id, { status: 'failed' });

  assert.equal(Q.clearFinished(items).length, 1);
  assert.equal(Q.clearFinished(items)[0].status, 'queued');

  const removed = Q.removeItem(items, r.items[2].id);
  assert.equal(removed.length, 2);
  assert.ok(!removed.some(i => i.id === r.items[2].id));
});

// ---------- 统计 ----------

test('counts 按状态汇总', () => {
  const r = Q.addItems([], [URL_OK, URL_OK + '2', URL_OK + '3'], 1000);
  let items = Q.patchItem(r.items, r.items[0].id, { status: 'done' });
  items = Q.patchItem(items, r.items[1].id, { status: 'failed' });
  const c = Q.counts(items);
  assert.deepEqual(c, { total: 3, queued: 1, running: 0, done: 1, failed: 1 });
});

// ---------- 重试策略 ----------

test('超时 / 注入失败算可重试', () => {
  assert.equal(Q.isRetryableError('页面加载超时（20 秒）'), true);
  assert.equal(Q.isRetryableError('标签页被关闭'), true);
  assert.equal(Q.isRetryableError('提取失败（未获取到页面返回数据）'), true);
});

test('正文不存在 / 链接不对不重试（重试只是浪费时间）', () => {
  assert.equal(Q.isRetryableError('未找到文章正文'), false);
  assert.equal(Q.isRetryableError('只支持公众号文章链接'), false);
  assert.equal(Q.isRetryableError('这篇文章正在导出中，请等上一次完成后再试'), false);
});

test('重试额度：attempts 已达上限就不能再试', () => {
  const base = { attempts: 0, error: '页面加载超时（20 秒）' };
  assert.equal(Q.canRetry(base), true);
  assert.equal(Q.canRetry({ ...base, attempts: Q.MAX_ATTEMPTS }), false);
  assert.equal(Q.canRetry({ ...base, attempts: 1, error: '未找到文章正文' }), false);
});
