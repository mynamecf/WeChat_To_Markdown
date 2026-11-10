const DEFAULTS = (typeof WXMD_DEFAULTS !== 'undefined')
  ? WXMD_DEFAULTS
  : { imageMode: 'download', folderMode: 'per-article', pinned: false };

const exportBtn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');
const cards = Array.from(document.querySelectorAll('.option-card'));
const articleTitleEl = document.getElementById('articleTitle');
const archiveModeBox = document.getElementById('archiveModeBox');
const archiveModeBtns = Array.from(document.querySelectorAll('.archive-mode-btn'));
const pinBtn = document.getElementById('pinBtn');

const INJECT_FILES = [
  'lib/defaults.js',
  'lib/naming.js',
  'lib/turndown.js',
  'lib/turndown-plugin-gfm.js',
  'content.js'
];

/** 从 executeScript 结果里取出 content.js 的返回值，不依赖固定下标 */
function pickArticleData(results) {
  if (!Array.isArray(results)) return null;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i] && results[i].result;
    if (r && typeof r === 'object' && typeof r.success === 'boolean') return r;
  }
  return null;
}

function setStatus(text, kind) {
  statusEl.textContent = text || '';
  statusEl.className = kind || '';
}

function updateArchiveModeVisibility() {
  const activeCard = document.querySelector('.option-card.active');
  const isDownload = activeCard && activeCard.dataset.mode === 'download';
  archiveModeBox.style.display = isDownload ? 'block' : 'none';
}

function setArchiveMode(mode) {
  archiveModeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
}

function getSelectedArchiveMode() {
  const active = document.querySelector('.archive-mode-btn.active');
  return active ? active.dataset.mode : 'per-article';
}

function setPinnedUI(pinned) {
  pinBtn.classList.toggle('pinned', !!pinned);
  pinBtn.title = pinned ? '取消固定悬浮窗' : '固定悬浮窗（在页面上常驻）';
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return (tabs && tabs[0]) || null;
}

async function init() {
  try {
    const tab = await getActiveTab();
    if (tab && WXMD_isWechatArticleUrl(tab.url)) {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => {
            const el = document.querySelector('#activity-name');
            return el ? el.innerText.trim() : document.title.trim();
          }
        },
        results => {
          if (chrome.runtime.lastError) {
            articleTitleEl.textContent = '未能获取标题';
            return;
          }
          const title = results && results[0] && results[0].result;
          if (title) {
            articleTitleEl.textContent = title;
            articleTitleEl.title = title;
          } else {
            articleTitleEl.textContent = '未能获取标题';
          }
        }
      );
    } else {
      articleTitleEl.textContent = '当前非微信文章页面';
    }
  } catch (e) {
    articleTitleEl.textContent = '获取标题失败';
  }

  chrome.storage.local.get(DEFAULTS, res => {
    cards.forEach(card => {
      card.classList.toggle('active', card.dataset.mode === res.imageMode);
    });
    setArchiveMode(res.folderMode);
    updateArchiveModeVisibility();
    setPinnedUI(res.pinned);
  });
}

init();

// 官网 / 问题反馈链接：地址只写在 lib/defaults.js 的 WXMD_LINKS 里，
// 留空则对应链接自动隐藏。
if (typeof WXMD_mountSiteLinks === 'function') WXMD_mountSiteLinks();

// 反向同步：详细配置页 / 浮窗改了设置，弹窗实时跟上
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.imageMode) {
    const mode = changes.imageMode.newValue === 'online' ? 'online' : 'download';
    cards.forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    updateArchiveModeVisibility();
  }
  if (changes.folderMode) {
    setArchiveMode(changes.folderMode.newValue);
  }
  if (changes.pinned) {
    setPinnedUI(changes.pinned.newValue);
  }
});

cards.forEach(card => {
  card.addEventListener('click', () => {
    cards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    chrome.storage.local.set({ imageMode: card.dataset.mode }).catch(() => {});
    updateArchiveModeVisibility();
  });
});

archiveModeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    setArchiveMode(btn.dataset.mode);
    chrome.storage.local.set({ folderMode: btn.dataset.mode }).catch(() => {});
  });
});

pinBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab || !WXMD_isWechatArticleUrl(tab.url)) {
    setStatus('请在微信文章页面使用', 'error');
    return;
  }

  const { pinned } = await chrome.storage.local.get({ pinned: false });
  const newPinned = !pinned;
  await chrome.storage.local.set({ pinned: newPinned });

  if (newPinned) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_FLOATING' });
    } catch (e) {
      // 页面未注入浮窗脚本时手动注入一次
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['floating.js'] });
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { type: 'SHOW_FLOATING' }).catch(() => {});
        }, 150);
      } catch (err) {
        console.error('[wx-md] 注入浮窗失败', err);
        setStatus('固定失败：' + err.message, 'error');
        return;
      }
    }
    setTimeout(() => window.close(), 100);
  } else {
    chrome.tabs.sendMessage(tab.id, { type: 'HIDE_FLOATING' }).catch(() => {});
    setPinnedUI(false);
    setStatus('已取消固定', 'success');
  }
});

document.getElementById('openOptions').addEventListener('click', async () => {
  // 把当前文章页作为「来源页」传过去，保存后才能跳回来
  const tab = await getActiveTab();
  const isArticle = tab && typeof tab.id === 'number' && WXMD_isWechatArticleUrl(tab.url);

  chrome.runtime.sendMessage({
    type: 'OPEN_OPTIONS',
    sourceTabId: isArticle ? tab.id : null
  }).catch(() => {}).finally(() => window.close());
});

document.getElementById('closeBtn').addEventListener('click', () => window.close());

exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  setStatus('正在提取文章...', '');

  // 兜底状态放在 try 外面：catch 分支也要能把它关掉，
  // 否则同步异常之后，定时器仍会在几十秒后把错误提示覆盖成「超时」。
  let settled = false;
  let guard = 0;
  const finish = (text, kind) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    exportBtn.disabled = false;
    setStatus(text, kind);
  };

  try {
    const tab = await getActiveTab();
    if (!tab || !WXMD_isWechatArticleUrl(tab.url)) {
      throw new Error('请在微信公众号文章页面使用');
    }

    const activeMode = (document.querySelector('.option-card.active') || {}).dataset?.mode || 'download';
    const activeArchiveMode = getSelectedArchiveMode();
    await chrome.storage.local.set({
      imageMode: activeMode,
      folderMode: activeArchiveMode
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: INJECT_FILES
    });

    const articleData = pickArticleData(results);
    if (!articleData || !articleData.success) {
      throw new Error((articleData && articleData.error) || '提取失败（未获取到页面返回数据）');
    }

    setStatus(activeMode === 'download' ? '正在下载...' : '正在生成...', '');

    // 后台被浏览器强杀、或卡在某个 Promise 上不返回时，消息通道可能一直悬空，
    // 按钮就会永久 disabled。这里加一个宽松上限做 UI 兜底：
    // 只放开按钮并如实提示，不谎报成功、也不中断后台可能仍在进行的任务。
    const imageCount = Array.isArray(articleData.images) ? articleData.images.length : 0;
    guard = setTimeout(
      () => finish('超时：后台可能已中断，请先检查下载目录再重试', 'error'),
      Math.min(600000, 60000 + imageCount * 1500)
    );

    chrome.runtime.sendMessage({ type: 'EXPORT_ARTICLE', data: articleData }, response => {
      // 没有这个检查，background 不响应时按钮会永久卡在 disabled
      if (chrome.runtime.lastError) {
        finish('失败：' + chrome.runtime.lastError.message, 'error');
        return;
      }
      if (response && response.success) finish('导出成功！', 'success');
      else finish('失败：' + ((response && response.error) || '未知错误'), 'error');
    });
  } catch (err) {
    finish(err.message, 'error');
  }
});
