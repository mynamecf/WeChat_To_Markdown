/**
 * test/update.test.js —— 版本检查内核
 *
 * 只测 lib/update.js：比版本号、解析 version.json、节流判断。
 * 不发真实网络请求，fetch 全部用桩函数。
 */
const test = require('node:test');
const assert = require('node:assert');
const { read } = require('./helpers');

/** 按浏览器里的方式加载：顶层 var 挂到一个盒子上 */
function loadUpdate() {
  const box = {};
  new Function('box', read('lib/update.js') + '\nbox.U = WXMD_UPDATE;')(box);
  return box.U;
}

const U = loadUpdate();

/** 造一个 fetch：payload 为对象/字符串，status 可指定，throw 可模拟断网 */
function fakeFetch(payload, opts = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (opts.throw) throw new Error('boom');
    if (opts.status && opts.status !== 200) {
      return { ok: false, status: opts.status, text: async () => '' };
    }
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return { ok: true, status: 200, text: async () => text };
  };
  fn.calls = calls;
  return fn;
}

test('版本号比较：数字段按数值比，不看字典序', () => {
  assert.strictEqual(U.compare('1.16.9', '1.16.28'), -1, '1.16.9 应该小于 1.16.28');
  assert.strictEqual(U.compare('1.16.28', '1.16.9'), 1);
  assert.strictEqual(U.compare('2.0', '1.99.99'), 1);
  assert.strictEqual(U.compare('1.16.28', '1.16.28'), 0);
});

test('版本号比较：位数不齐时按 0 补齐', () => {
  assert.strictEqual(U.compare('1.16.29', '1.16.29.0'), 0);
  assert.strictEqual(U.compare('1.16.29.0', '1.16.29'), 0);
  assert.strictEqual(U.compare('1.16.29.1', '1.16.29'), 1);
});

test('版本号比较：预发布后缀低于同号正式版', () => {
  assert.strictEqual(U.compare('1.16.29-beta', '1.16.29'), -1);
  assert.strictEqual(U.compare('1.16.29', '1.16.29-beta'), 1);
  assert.strictEqual(U.compare('1.16.29-beta.2', '1.16.29-beta.1'), 1);
});

test('normalize 去掉前缀 v 与空白', () => {
  assert.strictEqual(U.normalize(' v1.16.29.0 '), '1.16.29.0');
  assert.strictEqual(U.normalize(null), '');
});

test('有新版本：hasUpdate=true，并按平台取下载地址', async () => {
  const f = fakeFetch({
    version: '1.16.30',
    published: '2026-12-01',
    notes: '修了一堆',
    downloads: { chrome: 'https://example.com/chrome', firefox: 'https://example.com/ff' }
  });
  const r = await U.check({ url: 'https://example.com/version.json', current: '1.16.29.0', fetch: f, now: 1000 });

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.latest, '1.16.30');
  assert.strictEqual(r.current, '1.16.29.0');
  assert.strictEqual(r.hasUpdate, true);
  assert.strictEqual(r.notes, '修了一堆');
  assert.strictEqual(r.published, '2026-12-01');
  assert.strictEqual(r.url, 'https://example.com/chrome', '非 Firefox 应优先取 chrome 地址');
});

test('版本相同或更旧都不算更新', async () => {
  const same = await U.check({
    url: 'https://e.com/v.json', current: '1.16.29.0', fetch: fakeFetch({ version: '1.16.29' })
  });
  assert.strictEqual(same.hasUpdate, false);

  const older = await U.check({
    url: 'https://e.com/v.json', current: '1.16.29.0', fetch: fakeFetch({ version: '1.16.28.9' })
  });
  assert.strictEqual(older.hasUpdate, false);
});

test('请求带时间戳绕缓存，且不会破坏已有 query', async () => {
  const f = fakeFetch({ version: '1.16.30' });
  await U.check({ url: 'https://e.com/v.json?channel=stable', current: '1', fetch: f, now: 12345 });
  assert.match(f.calls[0], /^https:\/\/e\.com\/v\.json\?channel=stable&t=12345$/);
});

test('HTTP 失败 / 非法 JSON / 缺版本号都返回 ok:false，不抛异常', async () => {
  const r404 = await U.check({ url: 'https://e.com/v.json', current: '1', fetch: fakeFetch(null, { status: 404 }) });
  assert.strictEqual(r404.ok, false);
  assert.match(r404.error, /404/);

  const rBad = await U.check({ url: 'https://e.com/v.json', current: '1', fetch: fakeFetch('<html>') });
  assert.strictEqual(rBad.ok, false);
  assert.match(rBad.error, /JSON/);

  const rNoVer = await U.check({ url: 'https://e.com/v.json', current: '1', fetch: fakeFetch({ notes: 'x' }) });
  assert.strictEqual(rNoVer.ok, false);
  assert.match(rNoVer.error, /版本号/);

  const rThrow = await U.check({ url: 'https://e.com/v.json', current: '1', fetch: fakeFetch(null, { throw: true }) });
  assert.strictEqual(rThrow.ok, false);
  assert.match(rThrow.error, /boom/);
});

test('未配置地址时直接返回，不发请求', async () => {
  const f = fakeFetch({ version: '9.9.9' });
  const r = await U.check({ url: '', current: '1.0', fetch: f });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(f.calls.length, 0);
});

test('顶层 url 写法也认', async () => {
  const r = await U.check({
    url: 'https://e.com/v.json', current: '1.0', fetch: fakeFetch({ version: '1.1', url: 'https://e.com/a.zip' })
  });
  assert.strictEqual(r.url, 'https://e.com/a.zip');
});

test('节流：从没查过就查，24 小时内不查，过了 24 小时再查', () => {
  const H = 3600 * 1000;
  const now = 100 * 24 * H;

  assert.strictEqual(U.shouldCheck({ lastCheckAt: 0 }, now), true);
  assert.strictEqual(U.shouldCheck({ lastCheckAt: now - 1 * H }, now), false);
  assert.strictEqual(U.shouldCheck({ lastCheckAt: now - 23 * H }, now), false);
  assert.strictEqual(U.shouldCheck({ lastCheckAt: now - 25 * H }, now), true);
});

test('节流：失败后 1 小时内不重试，避免断网时刷屏', () => {
  const M = 60 * 1000;
  const now = 1000 * M;
  assert.strictEqual(U.shouldCheck({ lastCheckAt: 0, lastFailAt: now - 10 * M }, now), false);
  assert.strictEqual(U.shouldCheck({ lastCheckAt: 0, lastFailAt: now - 61 * M }, now), true);
});
