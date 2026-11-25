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

// 注入清单与结果解析都在 lib/injectlist.js（与 background.js 共用一份）
const INJECT_FILES = (typeof WXMD_INJECT_FILES !== 'undefined') ? WXMD_INJECT_FILES : ['content.js'];
const pickArticleData = (typeof WXMD_pickArticleData === 'function')
  ? WXMD_pickArticleData
  : (results) => {
      if (!Array.isArray(results)) return null;
      for (let i = results.length - 1; i >= 0; i--) {
        const r = results[i] && results[i].result;
        if (r && typeof r === 'object' && typeof r.success === 'boolean') return r;
      }
      return null;
    };

/**
 * 探活：当前标签页是不是「文章正文页」。
 *
 * 只看域名不够：mp.weixin.qq.com 下还有首页、视频播放页（/mp/readtemplate?t=…）、
 * 历史消息页，这些页面里 floating.js 会自己 return，浮窗根本不会挂。
 * 不先探活就写 pinned=true 并提示成功，用户看到的是「成功但页面没反应」，
 * 而 pinned 已落库，下次打开任意文章页浮窗会自己冒出来——更像 bug。
 */
async function probeArticlePage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!document.querySelector('#js_content, .rich_media_content, #js_image_content, #activity-name')
    });
    return !!(res && res[0] && res[0].result);
  } catch (e) {
    return false;
  }
}

// 导出期间的看门狗续期函数，由 PROGRESS 消息触发；非导出期间为 null
let guardArm = null;
chrome.runtime.onMessage.addListener(msg => {
  if (!msg || msg.type !== 'EXPORT_PROGRESS') return;
  if (guardArm) guardArm();
});

/**
 * 状态提示统一出口。
 * 成功类提示 3 秒后自动消失——它只是「刚才那一下完成了」的回执，一直挂着反而
 * 会让人以为状态没更新；失败/进行中不自动消失（还没看到就没了比留着更糟）。
 */
const STATUS_HOLD_MS = 3200;
let statusTimer = 0;

function setStatus(text, kind, holdMs) {
  clearTimeout(statusTimer);

  // 整体覆盖 className：顺带清掉上一轮残留的 fading
  statusEl.textContent = text || '';
  statusEl.className = kind || '';

  const hold = typeof holdMs === 'number'
    ? holdMs
    : (kind === 'success' ? STATUS_HOLD_MS : 0);
  if (hold <= 0) return;

  statusTimer = setTimeout(() => {
    statusEl.classList.add('fading');
    statusTimer = setTimeout(() => {
      if (!statusEl.classList.contains('fading')) return;
      statusEl.textContent = '';
      statusEl.className = '';
    }, 260);
  }, hold);
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
            // 页面里已注入 lib/defaults.js（content_scripts），优先用统一实现：
            // 图片消息 / 新版分享页没有 #activity-name，标题只在 h1.rich_media_title 里
            if (typeof WXMD_pickTitle === 'function') return WXMD_pickTitle(document);
            const el = document.querySelector('#activity-name');
            return (el && el.innerText.trim()) || document.title.trim();
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

  if (newPinned) {
    // 先确认是文章页，避免「提示成功但浮窗不存在」
    if (!(await probeArticlePage(tab.id))) {
      setStatus('当前页面不是文章正文页，浮窗只在文章页显示', 'error');
      return;
    }
  }

  await chrome.storage.local.set({ pinned: newPinned });

  if (newPinned) {
    const revert = async (text) => {
      await chrome.storage.local.set({ pinned: false }).catch(() => {});
      setPinnedUI(false);
      setStatus(text, 'error');
    };

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_FLOATING' });
      if (resp && resp.ok === false) {
        await revert(resp.error || '浮窗未能显示');
        return;
      }
    } catch (e) {
      // 页面未注入浮窗脚本时手动注入一次
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['floating.js'] });
      } catch (err) {
        console.error('[wx-md] 注入浮窗失败', err);
        await revert('固定失败：' + err.message);
        return;
      }
      // 注入是异步 IIFE，监听器要等到下一拍才注册好
      await new Promise(resolve => setTimeout(resolve, 150));
      try {
        const resp2 = await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_FLOATING' });
        if (resp2 && resp2.ok === false) {
          await revert(resp2.error || '浮窗未能显示');
          return;
        }
      } catch (err2) {
        await revert('固定失败：' + err2.message);
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

/** 成功文案带上「有几张图没下来」——否则用户只会在下次打开笔记时看到裂图 */
function successText(stats) {
  const s = stats || {};
  const notes = [];
  if (s.failed) notes.push(`${s.failed} 张图片下载失败`);
  if (s.blocked) notes.push(`${s.blocked} 张图片未下载（非微信图床或内网地址）`);
  if (s.unresolved) notes.push(`${s.unresolved} 处图片链接未能替换`);
  return notes.length
    ? `导出成功，但${notes.join('，')}；这些位置保留为在线链接`
    : '导出成功！';
}

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
    guardArm = null;
    exportBtn.disabled = false;
    setStatus(text, kind);
  };

  // 看门狗只表示「后台多久没动静」，不是「总共最多等多久」。
  // 原来按 60s + 图片数×1.5s 一次算死：40 张图（并发 4、单张最多 20s ⇒ 最坏 200s）
  // 会在 120s 就报「超时」，而后台其实还在正常下载。
  const armGuard = ms => {
    clearTimeout(guard);
    guard = setTimeout(
      () => finish('超时：后台可能已中断，请先检查下载目录再重试', 'error'),
      ms
    );
  };
  // 每条 EXPORT_PROGRESS 都续期：只要还在动，就不该判超时
  guardArm = () => armGuard(60000);

  let tabId = null;
  try {
    const tab = await getActiveTab();
    if (!tab || !WXMD_isWechatArticleUrl(tab.url)) {
      throw new Error('请在微信公众号文章页面使用');
    }
    tabId = tab.id;

    const activeMode = (document.querySelector('.option-card.active') || {}).dataset?.mode || 'download';
    const activeArchiveMode = getSelectedArchiveMode();

    // 本次选择走「一次性 override」通道，与浮窗保持一致，不再写 storage。
    // 写 storage 的副作用：为这一篇临时切到「在线链接」导一次，之后所有导出都变在线，
    // 用户很难意识到是自己刚才那一下改的。（点卡片本身已按常规方式落库，
    // 这里只负责保证「界面上显示什么就导什么」。）
    await chrome.scripting.executeScript({
      target: { tabId },
      func: o => { globalThis.__WXMD_OVERRIDE__ = o; },
      args: [{ imageMode: activeMode, folderMode: activeArchiveMode }]
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: INJECT_FILES
    });

    const articleData = pickArticleData(results);
    if (!articleData || !articleData.success) {
      throw new Error((articleData && articleData.error) || '提取失败（未获取到页面返回数据）');
    }

    setStatus(activeMode === 'download' ? '正在下载...' : '正在生成...', '');
    armGuard(90000);

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'EXPORT_ARTICLE', data: articleData }, resp => {
        // 没有这个检查，background 不响应时按钮会永久卡在 disabled
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });

    if (settled) return;   // 看门狗已经先报过超时，不覆盖提示
    if (response && response.success) finish(successText(response.stats), 'success');
    else finish('失败：' + ((response && response.error) || '未知错误'), 'error');
  } catch (err) {
    finish(err.message, 'error');
  } finally {
    // 提取失败 / 注入失败时一次性 override 会残留，下次从浮窗导出会误用这次的选择
    if (tabId !== null) {
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => { delete globalThis.__WXMD_OVERRIDE__; }
      }).catch(() => {});
    }
  }
});

// ---------- 新版本提醒条 ----------
// 只在「开关打开 + 确实有新版 + 该版本没被忽略」时出现。
// 版本高低按当前 manifest 现算，不能直接用 storage 里的 hasUpdate：
// 用户更新完扩展后，旧记录会一直挂着「有新版本」。
const updateBanner = document.getElementById('updateBanner');
const updateBannerVer = document.getElementById('updateBannerVer');

async function refreshUpdateBanner() {
  if (!updateBanner || typeof WXMD_UPDATE === 'undefined') return;
  const s = await chrome.storage.local.get({
    updateNotify: false,
    updateLatest: null,
    updateSkipVersion: ''
  });
  const p = s.updateLatest;
  const current = chrome.runtime.getManifest().version;
  const show = !!(s.updateNotify && p && p.ok
    && WXMD_UPDATE.compare(p.latest, current) > 0
    && p.latest !== s.updateSkipVersion);
  updateBanner.style.display = show ? 'flex' : 'none';
  if (show && updateBannerVer) updateBannerVer.textContent = 'v' + p.latest;
}

if (updateBanner) {
  refreshUpdateBanner().catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.updateLatest && !changes.updateNotify && !changes.updateSkipVersion) return;
    refreshUpdateBanner().catch(() => {});
  });

  document.getElementById('updateBannerGo').addEventListener('click', async () => {
    const s = await chrome.storage.local.get({ updateLatest: null });
    const url = (s.updateLatest && s.updateLatest.url)
      || (typeof WXMD_LINKS !== 'undefined' && WXMD_LINKS.homepage)
      || '';
    if (!url) return;
    chrome.tabs.create({ url });
    window.close();
  });

  document.getElementById('updateBannerSkip').addEventListener('click', async () => {
    const s = await chrome.storage.local.get({ updateLatest: null });
    const ver = s.updateLatest && s.updateLatest.latest;
    updateBanner.style.display = 'none';
    if (!ver) return;
    chrome.runtime.sendMessage({ type: 'SKIP_UPDATE', version: ver }).catch(() => {});
  });
}
