/* ============================================================================
 * 链接导出（独立页面）
 * ----------------------------------------------------------------------------
 * 界面只负责「贴链接 / 看状态 / 点按钮」，真正的调度在 background 的队列泵里。
 * 所有状态都从 storage 读，所以关掉这个页面再打开，看到的还是同一份队列。
 * ========================================================================== */

const queueInputEl = document.getElementById('queueInput');
const queueStatusEl = document.getElementById('queueStatus');
const queueListEl = document.getElementById('queueList');
const queueBadgeEl = document.getElementById('queueBadge');
const queueRunBtn = document.getElementById('queueRunBtn');
const queuePauseBtn = document.getElementById('queuePauseBtn');
const queueClearBtn = document.getElementById('queueClearBtn');
const queueWarnEl = document.getElementById('queueWarn');

const QUEUE_STATUS_TEXT = { queued: '等待中', running: '导出中', done: '已完成', failed: '失败' };
// 排序权重：进行中 → 等待 → 失败 → 完成。用 1 起步，避免 0 被 `|| 9` 当成假值
const QUEUE_ORDER = { running: 1, queued: 2, failed: 3, done: 4 };
const QUEUE_MAX_RENDER = 30;
// 超过这个条数就提示微信风控（权威值在 lib/queue.js，这里兜底防脚本加载失败）
const QUEUE_RISK_LIMIT = (typeof WXMD_QUEUE !== 'undefined' && WXMD_QUEUE.RISK_WARN_ITEMS)
  || 200;

let queueSnap = {
  items: [],
  state: { paused: false, currentId: '' },
  counts: { total: 0, queued: 0, running: 0, done: 0, failed: 0 },
  max: 0
};
let queueImgProgress = null;   // 当前这一篇的图片进度 { done, total }

function sendBg(message) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, resp => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { success: false, error: '后台未响应' });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

function setQueueBadge(text, hot) {
  if (!queueBadgeEl) return;
  queueBadgeEl.textContent = text;
  queueBadgeEl.classList.toggle('hot', !!hot);
}

/** 列表里优先显示标题，拿不到标题时退化成短链尾段 */
function queueItemLabel(it) {
  if (it && it.title) return it.title;
  try {
    const u = new URL(it.url);
    const tail = u.pathname.replace(/^\/s\/?/, '');
    return tail || it.url;
  } catch (e) {
    return (it && it.url) || '(无效链接)';
  }
}

/** 单条一行。全部用 textContent 构建：URL 和标题都来自外部，拼 innerHTML 会留 XSS 口子 */
function buildQueueItem(it) {
  const row = document.createElement('div');
  row.className = 'queue-item ' + it.status;

  const dot = document.createElement('span');
  dot.className = 'queue-dot';
  row.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'queue-name';
  name.title = it.url + (it.error ? '\n' + it.error : '');

  const label = document.createElement('span');
  label.className = 'queue-label';
  label.textContent = queueItemLabel(it);
  name.appendChild(label);

  if (it.status === 'failed' && it.error) {
    const sub = document.createElement('span');
    sub.className = 'queue-sub';
    sub.textContent = it.error;
    name.appendChild(sub);
  }
  row.appendChild(name);

  const tag = document.createElement('span');
  tag.className = 'queue-tag';
  if (it.status === 'running' && queueImgProgress && queueImgProgress.total) {
    tag.textContent = queueImgProgress.done + '/' + queueImgProgress.total;
  } else {
    tag.textContent = QUEUE_STATUS_TEXT[it.status] || it.status;
  }
  row.appendChild(tag);

  if (it.status === 'failed') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'queue-op';
    retry.textContent = '重试';
    retry.addEventListener('click', () => queueAction({ type: 'QUEUE_RETRY', id: it.id }));
    row.appendChild(retry);
  }

  // running 的不给删除：正在下载，删了会留下半篇的图片目录
  if (it.status !== 'running') {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'queue-op del';
    del.textContent = '×';
    del.title = '从队列移除';
    del.addEventListener('click', () => queueAction({ type: 'QUEUE_REMOVE', id: it.id }));
    row.appendChild(del);
  }

  return row;
}

/**
 * 主按钮把「入队 + 开始」合成了一步，所以它可用的条件是
 * 「输入框里有待导出的链接」或「队列里还有没跑完的」。
 */
function updateQueueButtons() {
  if (!queueRunBtn) return;
  const c = queueSnap.counts || {};
  const active = !!(c.queued || c.running);
  const hasInput = !!String((queueInputEl && queueInputEl.value) || '').trim();
  queueRunBtn.disabled = !(active || hasInput);
  queuePauseBtn.disabled = !active;
  queueClearBtn.disabled = !(c.done || c.failed);
}

function renderQueue() {
  if (!queueListEl) return;

  const c = queueSnap.counts || { total: 0, queued: 0, running: 0, done: 0, failed: 0 };
  const items = Array.isArray(queueSnap.items) ? queueSnap.items : [];
  const paused = !!(queueSnap.state && queueSnap.state.paused);

  // 标题行角标：页面顶部的进度一眼可见
  if (c.running) {
    setQueueBadge('导出中 ' + (c.done + c.failed + c.running) + '/' + c.total, true);
  } else if (c.queued) {
    setQueueBadge('待导出 ' + c.queued + ' 条', false);
  } else if (c.failed) {
    setQueueBadge(c.failed + ' 条失败', false);
  } else if (c.done) {
    setQueueBadge('已完成 ' + c.done + ' 条', false);
  } else {
    setQueueBadge('未开始', false);
  }

  // 状态行
  let text = '';
  let kind = '';
  if (!c.total) {
    text = '队列为空';
  } else if (c.running) {
    const cur = items.find(i => i.id === (queueSnap.state || {}).currentId)
      || items.find(i => i.status === 'running');
    text = '正在导出（已完成 ' + (c.done + c.failed) + '/' + c.total + '）'
      + (cur ? '：' + queueItemLabel(cur) : '');
  } else if (c.queued && paused) {
    text = '已暂停，' + c.queued + ' 条等待导出，点「开始导出」继续';
  } else if (c.queued) {
    text = c.queued + ' 条待导出，点「开始导出」';
  } else if (c.failed) {
    text = c.done + ' 条完成，' + c.failed + ' 条失败';
    kind = 'err';
  } else {
    text = '全部完成（' + c.done + ' 条）';
    kind = 'ok';
  }
  queueStatusEl.textContent = text;
  queueStatusEl.className = 'queue-status' + (kind ? ' ' + kind : '');

  // 条数多到可能被微信限流时常驻提示一次，不用等到点按钮才看见
  if (queueWarnEl) {
    const over = c.total > QUEUE_RISK_LIMIT;
    queueWarnEl.hidden = !over;
    if (over) {
      queueWarnEl.textContent = '队列共 ' + c.total + ' 条，超过 ' + QUEUE_RISK_LIMIT
        + ' 条后微信可能限流（打开变慢、失败率升高）。建议分批跑，一批跑完再开始下一批。';
    }
  }

  updateQueueButtons();

  // 列表
  queueListEl.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'queue-empty';
    empty.textContent = '还没有链接';
    queueListEl.appendChild(empty);
    return;
  }

  const sorted = items.slice().sort((a, b) => {
    const oa = QUEUE_ORDER[a.status] || 9;
    const ob = QUEUE_ORDER[b.status] || 9;
    if (oa !== ob) return oa - ob;
    return (a.addedAt || 0) - (b.addedAt || 0);
  });
  sorted.slice(0, QUEUE_MAX_RENDER).forEach(it => {
    queueListEl.appendChild(buildQueueItem(it));
  });
  if (sorted.length > QUEUE_MAX_RENDER) {
    const more = document.createElement('div');
    more.className = 'queue-empty';
    more.textContent = '还有 ' + (sorted.length - QUEUE_MAX_RENDER) + ' 条未显示（先清空已完成的）';
    queueListEl.appendChild(more);
  }
}

async function loadQueue() {
  const r = await sendBg({ type: 'QUEUE_GET' });
  if (!r || !r.success) return;
  const prevId = (queueSnap.state || {}).currentId;
  queueSnap = r;
  // 换到下一篇就清掉上一篇的图片进度，否则会显示「5/5」挂在新一条上
  if ((r.state || {}).currentId !== prevId) queueImgProgress = null;
  renderQueue();
}

async function queueAction(msg) {
  const r = await sendBg(msg);
  if (r && r.success === false) {
    queueStatusEl.textContent = '操作失败：' + (r.error || '未知错误');
    queueStatusEl.className = 'queue-status err';
    return;
  }
  await loadQueue();
}

/** 输入框 → 逐行清理后的链接数组 */
function queueInputLines() {
  return String((queueInputEl && queueInputEl.value) || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 一个按钮做完「入队 + 开始」。
 * 原来分成「加入队列」「开始导出」两步，但实际使用里没有人会只入队不导出，
 * 那一步只是让用户多点一次。现在：有粘贴内容就先入队再开跑，没有就直接续跑。
 */
async function queueRun() {
  const lines = queueInputLines();
  const active = !!(queueSnap.counts || {}).queued || !!(queueSnap.counts || {}).running;

  if (!lines.length && !active) {
    queueStatusEl.textContent = '请先粘贴至少一条链接';
    queueStatusEl.className = 'queue-status err';
    return;
  }

  // 风控提示只拦「这一轮要连续跑很多篇」的情况：已完成的历史条目不算，
  // 否则清空前的队列会让每一次续跑都弹一次确认。
  const pendingNow = (queueSnap.counts.queued || 0) + (queueSnap.counts.running || 0);
  const willRun = pendingNow + lines.length;
  if (willRun > QUEUE_RISK_LIMIT) {
    const ok = window.confirm(
      '本次将连续导出约 ' + willRun + ' 篇（已超过 ' + QUEUE_RISK_LIMIT + ' 条）。\n\n'
      + '短时间内大量打开公众号文章，微信可能触发风控：页面打开变慢、出现验证页、'
      + '图片返回 403，失败率会明显升高。\n\n'
      + '建议每批不超过 ' + QUEUE_RISK_LIMIT + ' 条，跑完一批再点一次「开始导出」。\n\n'
      + '仍要继续吗？'
    );
    if (!ok) {
      queueStatusEl.textContent = '已取消，可减少链接后重试';
      queueStatusEl.className = 'queue-status';
      return;
    }
  }

  let addRes = null;
  if (lines.length) {
    addRes = await sendBg({ type: 'QUEUE_ADD', urls: lines });
    if (!addRes || !addRes.success) {
      queueStatusEl.textContent = '加入失败：' + ((addRes && addRes.error) || '后台未响应');
      queueStatusEl.className = 'queue-status err';
      return;
    }
    queueInputEl.value = '';
  }

  const startRes = await sendBg({ type: 'QUEUE_START' });
  if (!startRes || !startRes.success) {
    queueStatusEl.textContent = '启动失败：' + ((startRes && startRes.error) || '后台未响应');
    queueStatusEl.className = 'queue-status err';
    return;
  }

  await loadQueue();

  // 逐条说明被跳过的原因：贴 10 行静默吞掉 3 行比报错更让人困惑
  const parts = [];
  if (addRes && addRes.added) parts.push('已加入 ' + addRes.added + ' 条');
  if (addRes && addRes.skipped && addRes.skipped.length) {
    parts.push('跳过 ' + addRes.skipped.length + ' 条（' + addRes.skipped[0].reason
      + (addRes.skipped.length > 1 ? ' 等' : '') + '）');
  }
  if (!parts.length) parts.push('已开始导出');
  queueStatusEl.textContent = parts.join('，');
  queueStatusEl.className = 'queue-status ' + (addRes && addRes.skipped && addRes.skipped.length ? 'err' : 'ok');
  updateQueueButtons();
}

if (queueRunBtn) {
  queueRunBtn.addEventListener('click', () => { queueRun().catch(() => {}); });
}

if (queueInputEl) {
  // 输入/粘贴后主按钮要立刻变成可用，不用等下一次队列刷新
  queueInputEl.addEventListener('input', updateQueueButtons);
  queueInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      queueRun().catch(() => {});
    }
  });
}

if (queuePauseBtn) {
  queuePauseBtn.addEventListener('click', () => queueAction({ type: 'QUEUE_PAUSE' }));
}

if (queueClearBtn) {
  queueClearBtn.addEventListener('click', async () => {
    const r = await sendBg({ type: 'QUEUE_CLEAR' });
    await loadQueue();
    if (r && r.success && r.removed) {
      queueStatusEl.textContent = '已清掉 ' + r.removed + ' 条记录';
      queueStatusEl.className = 'queue-status ok';
    }
  });
}

// 队列状态由后台写 storage，这里跟着重绘；节流避免每条 item 的多次更新引起连发
let queueReloadTimer = 0;
function scheduleQueueReload() {
  clearTimeout(queueReloadTimer);
  queueReloadTimer = setTimeout(() => { loadQueue(); }, 120);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.urlQueue && !changes.queueState) return;
  scheduleQueueReload();
});

// 图片下载进度：只有队列正在跑时才拿来用
chrome.runtime.onMessage.addListener(msg => {
  if (!msg || msg.type !== 'EXPORT_PROGRESS') return;
  const running = (queueSnap.items || []).some(i => i.status === 'running');
  if (!running) return;
  queueImgProgress = { done: Number(msg.done) || 0, total: Number(msg.total) || 0 };
  renderQueue();
});

/* ============================================================================
 * 返回配置
 * ----------------------------------------------------------------------------
 * 这个页面是从配置页用新标签打开的。单纯 <a href="options.html"> 会把当前标签
 * 导航成配置页，原来那个还躺在后台——点了「返回」却回不到原处。
 * 做法：优先切回「打开这个页面的那个标签」（配置页打开时带了 openerTabId），
 * 找不到再退而求其次找任意一个开着的配置页；切过去之后把当前标签关掉。
 * 两个都找不到（比如手输地址打开）才在原地跳转。
 * ========================================================================== */

const backToOptionsEl = document.getElementById('backToOptions');

function isPageUrl(url, target) {
  return String(url || '').split('#')[0].split('?')[0] === target;
}

/** 开了好几个配置页时挑「最该回去」的那个：当前可见的优先，其次最近用过的 */
function pickOptionsTab(tabs, me, optionsUrl) {
  const list = (tabs || []).filter(t => t && t.id !== (me && me.id) && isPageUrl(t.url, optionsUrl));
  list.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0)
    || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return list[0] || null;
}

if (backToOptionsEl) {
  backToOptionsEl.addEventListener('click', async e => {
    if (!chrome.tabs || typeof chrome.tabs.query !== 'function'
      || typeof chrome.tabs.getCurrent !== 'function') return;
    e.preventDefault();

    const optionsUrl = chrome.runtime.getURL('options.html');

    try {
      const me = await chrome.tabs.getCurrent();
      let target = null;

      // 1) 谁打开的，就回谁那儿去
      if (me && typeof me.openerTabId === 'number' && typeof chrome.tabs.get === 'function') {
        try {
          const opener = await chrome.tabs.get(me.openerTabId);
          if (opener && isPageUrl(opener.url, optionsUrl)) target = opener;
        } catch (err) {
          // 原标签已经被关掉，往下找
        }
      }

      // 2) 退而求其次：任意一个开着的配置页
      if (!target) {
        const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('') + '*' });
        target = pickOptionsTab(tabs, me, optionsUrl);
      }

      if (target) {
        await chrome.tabs.update(target.id, { active: true });
        // 配置页可能在另一个窗口，焦点也要跟过去，否则只是切了标签没切窗口
        if (typeof target.windowId === 'number' && chrome.windows && chrome.windows.update) {
          await chrome.windows.update(target.windowId, { focused: true });
        }
        if (me && typeof me.id === 'number') {
          await chrome.tabs.remove(me.id);
        } else {
          window.close();
        }
        return;
      }
    } catch (err) {
      // 拿不到标签信息就走下面的原地跳转，不让「返回」变成死按钮
    }

    location.href = 'options.html';
  });
}

// 官网 / 问题反馈：地址统一在 lib/defaults.js 里维护，留空自动隐藏
if (typeof WXMD_mountSiteLinks === 'function') WXMD_mountSiteLinks();

loadQueue();
