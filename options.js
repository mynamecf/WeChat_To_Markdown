const FALLBACK_DEFAULTS = {
  folderMode: 'per-article',
  onlineFilename: '{{date:YYYYMMDD}}_{{title}}',
  downloadFolder: '{{date:YYYYMMDD}}_{{title}}',
  sharedFolder: '{{date:YYYYMMDD}}',
  sharedFilename: '{{date:YYYYMMDD}}_{{title}}',
  imageFolder: '{{date:YYYY}}/{{date:MM}}/{{date:DD}}',
  imageFilename: 'IMG_{{date:YYYYMMDD}}{{time:HHmmssSSS}}_{{index1}}',
  sharedImageFolder: '{{date:YYYY}}/{{date:MM}}/{{date:DD}}',
  sharedImageFilename: 'IMG_{{date:YYYYMMDD}}{{time:HHmmssSSS}}_{{index1}}'
};

// 与 content.js / background.js 共用同一份默认值，避免预览和实际导出走两套规则
const DEFAULTS = (typeof WXMD_DEFAULTS !== 'undefined')
  ? {
      folderMode: WXMD_DEFAULTS.folderMode,
      onlineFilename: WXMD_DEFAULTS.onlineFilename,
      downloadFolder: WXMD_DEFAULTS.downloadFolder,
      sharedFolder: WXMD_DEFAULTS.sharedFolder,
      sharedFilename: WXMD_DEFAULTS.sharedFilename,
      imageFolder: WXMD_DEFAULTS.imageFolder,
      imageFilename: WXMD_DEFAULTS.imageFilename,
      sharedImageFolder: WXMD_DEFAULTS.sharedImageFolder,
      sharedImageFilename: WXMD_DEFAULTS.sharedImageFilename
    }
  : FALLBACK_DEFAULTS;

const onlineFilenameInput = document.getElementById('onlineFilename');
const downloadFolderInput = document.getElementById('downloadFolder');
const sharedFolderInput = document.getElementById('sharedFolder');
const sharedFilenameInput = document.getElementById('sharedFilename');
const folderInput = document.getElementById('imageFolder');
const filenameInput = document.getElementById('imageFilename');
const sharedImageFolderInput = document.getElementById('sharedImageFolder');
const sharedImageFilenameInput = document.getElementById('sharedImageFilename');
const previewOnline = document.getElementById('previewOnline');
const previewDownload = document.getElementById('previewDownload');
const saveBtn = document.getElementById('saveBtn');
const saveText = document.getElementById('saveText');
const saveKbd = document.getElementById('saveKbd');
const resetBtn = document.getElementById('resetBtn');
// 提前声明：clearResetFlash 在 markDirty / markSaved 里被调用，
// 而这两个函数可能早于文件末尾的 resetBtn 绑定逻辑执行到。
let resetFlashTimer = 0;
const mainContainer = document.getElementById('mainContainer');
const backToTopBtn = document.getElementById('backToTop');
const perArticleConfig = document.getElementById('perArticleConfig');
const sharedConfig = document.getElementById('sharedConfig');
const modeCards = Array.from(document.querySelectorAll('.mode-card'));
// 图片处理方式（online / download）由两张配置卡承担，点击标题切换
const imageModeCards = Array.from(document.querySelectorAll('.card.selectable'));

const ALL_INPUTS = [
  onlineFilenameInput,
  downloadFolderInput,
  sharedFolderInput,
  sharedFilenameInput,
  folderInput,
  filenameInput,
  sharedImageFolderInput,
  sharedImageFilenameInput
].filter(Boolean);

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
if (saveKbd) saveKbd.textContent = isMac ? '⌘ S' : 'Ctrl S';

let returnTimer = 0;
let forceCloseTimer = 0;

function cancelReturn() {
  clearTimeout(returnTimer);
  clearTimeout(forceCloseTimer);
  returnTimer = 0;
  forceCloseTimer = 0;
}

// ---------- 工具 ----------

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

// 命名规则统一由 lib/naming.js 提供（与 content.js 实际落盘共用同一份实现）。
// 配置页只负责填占位值做预览，不自己实现清洗逻辑 —— 否则两边规则一旦漂移，
// 预览显示的文件名就和真实落盘的不是同一个。
const PREVIEW_URL = 'https://mp.weixin.qq.com/s/xxx';
const PREVIEW_META = {
  title: '微信文章标题',
  author: '公众号名称',
  published: '2026-10-20',
  url: PREVIEW_URL,
  domain: 'mp.weixin.qq.com',
  site: '微信公众号'
};

const NAMING = (typeof WXMD_NAMING !== 'undefined')
  ? WXMD_NAMING
  : { resolveTemplate: () => '', resolveDateOnlyTemplate: () => '' };
if (typeof WXMD_NAMING === 'undefined') {
  console.error('[wx-md] lib/naming.js 未加载，预览不可用');
}

/** 预览用：统一以第一张图片（index 0）为例。isFirstImage 保留仅为兼容既有调用。 */
function parseTemplate(tplStr, isFirstImage = false, isPath = false, titleOverride = null) {
  if (!tplStr) return '';
  const meta = titleOverride ? { ...PREVIEW_META, title: titleOverride } : PREVIEW_META;
  return NAMING.resolveTemplate(tplStr, 0, PREVIEW_URL, meta, isPath);
}

function parseDateTemplate(tplStr) {
  if (!tplStr) return '';
  return NAMING.resolveDateOnlyTemplate(tplStr);
}

function validateSharedFolder(tpl) {
  if (!tpl) return true;
  const stripped = tpl
    .replace(/\{\{date(?::[^}]+)?\}\}/g, '')
    .replace(/\{\{time(?::[^}]+)?\}\}/g, '');
  return !/\{\{[^}]+\}\}/.test(stripped);
}

/**
 * 图片命名模板不含 {{time}} 时，重复导出同一篇文章必然撞名：
 * Chrome 会把新图改名成 "xxx (1).webp"，Markdown 虽已回填真实文件名，
 * 但图片目录会不断堆积重复副本。保存前提示一次，让用户知道代价。
 */
function warnIfImageNameMayCollide() {
  if (getImageMode() === 'online') return true;
  const tpl = getSelectedFolderMode() === 'shared'
    ? sharedImageFilenameInput.value
    : filenameInput.value;
  if (/\{\{time/.test(tpl)) return true;
  return confirm(
    '图片命名模板里没有 {{time}} 变量。\n\n' +
    '重复导出同一篇文章时，本地已有同名图片，Chrome 会把新图片自动改名成「xxx (1).webp」；' +
    'Markdown 会正确指向新文件，但图片目录会不断堆积重复副本。\n\n' +
    '建议保留默认的 {{time:HHmmssSSS}}。仍要保存吗？'
  );
}

// ---------- 状态 ----------

// 「恢复默认」按钮的 ✓ 已恢复 只是 1.4s 的瞬时反馈。
// 这段时间里用户很可能已经点了保存或改了输入，两个按钮同时挂着 ✓ 会像卡住了，
// 所以进入任何正式状态时都把它收回去。
function clearResetFlash() {
  clearTimeout(resetFlashTimer);
  if (resetBtn) resetBtn.textContent = '恢复默认';
}

function markDirty() {
  cancelReturn();
  clearResetFlash();
  if (!saveBtn) return;
  saveBtn.classList.remove('saved');
  if (saveText) saveText.textContent = '保存';
}

function markSaved() {
  clearResetFlash();
  if (!saveBtn) return;
  saveBtn.classList.add('saved');
  if (saveText) saveText.textContent = '✓ 已保存';
}

// ---------- 预览 ----------

function appendImageNode(children, imgDirVal, imgNameVal) {
  const dirs = imgDirVal ? imgDirVal.split('/').filter(Boolean) : [];
  if (dirs.length === 0) {
    children.push({ type: 'file', name: imgNameVal + '.png', icon: '🖼️' });
    return;
  }
  let current = { type: 'folder', name: dirs[0], icon: '📁', children: [] };
  children.push(current);
  for (let i = 1; i < dirs.length; i++) {
    const next = { type: 'folder', name: dirs[i], icon: '📁', children: [] };
    current.children.push(next);
    current = next;
  }
  current.children.push({ type: 'file', name: imgNameVal + '.png', icon: '🖼️' });
}

function renderTree(rootIcon, rootName, rootClass, children) {
  const lines = [`<span class="${rootClass}">${rootIcon} ${esc(rootName)}</span>`];

  function walk(items, prefix) {
    items.forEach((item, idx) => {
      const isLast = idx === items.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const cls = item.type === 'folder' ? 'folder' : 'file';
      lines.push(`${prefix}${connector}<span class="${cls}">${item.icon} ${esc(item.name)}</span>`);
      if (item.type === 'folder' && item.children && item.children.length) {
        walk(item.children, prefix + (isLast ? '    ' : '│   '));
      }
    });
  }

  walk(children, ' ');
  return lines.join('\n');
}

function getSelectedFolderMode() {
  const active = document.querySelector('.mode-card.active');
  return active ? active.dataset.value : 'per-article';
}

function getImageMode() {
  const active = imageModeCards.find(c => c.classList.contains('active'));
  return active ? active.dataset.imageMode : 'download';
}

function applyImageMode(mode) {
  const target = mode === 'online' ? 'online' : 'download';
  imageModeCards.forEach(card => {
    card.classList.toggle('active', card.dataset.imageMode === target);
  });
}

function updatePreview() {
  const onlineVal = parseTemplate(onlineFilenameInput.value, false, false);
  previewOnline.innerHTML = `<span class="file">📄 ${esc(onlineVal || 'article')}.md</span>`;

  const mode = getSelectedFolderMode();
  // 逐篇 / 平铺各用自己那套图片规则
  const imgDirInput = mode === 'shared' ? sharedImageFolderInput : folderInput;
  const imgNameInput = mode === 'shared' ? sharedImageFilenameInput : filenameInput;
  const imgDirVal = parseTemplate(imgDirInput.value, false, true);
  const imgNameVal = parseTemplate(imgNameInput.value, true, false);

  if (mode === 'shared') {
    const sharedVal = parseDateTemplate(sharedFolderInput.value) || 'article';
    // 与 content.js 的 md 命名逻辑保持一致：直接用模板结果，不再二次截取
    const mdNameA = parseTemplate(sharedFilenameInput.value, false, false, '微信文章标题A') || 'article';
    const mdNameB = parseTemplate(sharedFilenameInput.value, false, false, '微信文章标题B') || 'article';

    const children = [
      { type: 'file', name: mdNameA + '.md', icon: '📄' },
      { type: 'file', name: mdNameB + '.md', icon: '📄' }
    ];
    appendImageNode(children, imgDirVal, imgNameVal);

    previewDownload.innerHTML = renderTree('📁', sharedVal, 'folder', children);
  } else {
    const folderVal = parseTemplate(downloadFolderInput.value, false, true) || 'article';
    // 与 background.js 一致：md 文件名只取文件夹路径的最后一段
    const mdFileName = folderVal.split('/').pop() || folderVal;

    const children = [{ type: 'file', name: mdFileName + '.md', icon: '📄' }];
    appendImageNode(children, imgDirVal, imgNameVal);

    previewDownload.innerHTML = renderTree('📁', folderVal, 'folder', children);
  }
}

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 120);
}

function updateFolderModeUI() {
  const mode = getSelectedFolderMode();
  if (mode === 'shared') {
    perArticleConfig.style.display = 'none';
    sharedConfig.style.display = 'block';
  } else {
    perArticleConfig.style.display = 'block';
    sharedConfig.style.display = 'none';
  }
  updatePreview();
}

// ---------- 当前下载目录（由上一次导出的落盘路径反推，只读） ----------

const downloadRootPathEl = document.getElementById('downloadRootPath');

function renderDownloadRoot(root, failAt) {
  if (!downloadRootPathEl) return;
  if (root) {
    downloadRootPathEl.textContent = root;
    downloadRootPathEl.classList.remove('pending');
    downloadRootPathEl.title = '点击可整段选中，Ctrl/⌘+C 复制';
    return;
  }
  downloadRootPathEl.classList.add('pending');
  downloadRootPathEl.removeAttribute('title');
  // failAt 有值 = 导出过，但落盘位置对不上（多半开了「每次询问保存位置」）
  downloadRootPathEl.textContent = failAt
    ? '无法确定：上次导出保存到了你手动选择的目录。若想固定下来，请关掉 Chrome「设置 → 下载内容」里的「下载前询问每个文件的保存位置」'
    : '尚未导出过，导出一次后这里会显示实际路径';
}

chrome.storage.local.get({ lastDownloadRoot: '', lastDownloadRootFailAt: 0 }, res => {
  renderDownloadRoot(res.lastDownloadRoot, res.lastDownloadRootFailAt);
});

// 导出时后台会写入这个值；页面开着的话实时刷新
if (chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.lastDownloadRoot && !changes.lastDownloadRootFailAt) return;
    chrome.storage.local.get({ lastDownloadRoot: '', lastDownloadRootFailAt: 0 }, res => {
      renderDownloadRoot(res.lastDownloadRoot, res.lastDownloadRootFailAt);
    });
  });
}

// ---------- 初始化 ----------

chrome.storage.local.get({ ...DEFAULTS, imageMode: 'download' }, res => {
  onlineFilenameInput.value = res.onlineFilename;
  downloadFolderInput.value = res.downloadFolder;
  sharedFolderInput.value = res.sharedFolder;
  sharedFilenameInput.value = res.sharedFilename;
  folderInput.value = res.imageFolder;
  filenameInput.value = res.imageFilename;
  sharedImageFolderInput.value = res.sharedImageFolder;
  sharedImageFilenameInput.value = res.sharedImageFilename;

  applyImageMode(res.imageMode);
  modeCards.forEach(card => {
    card.classList.toggle('active', card.dataset.value === res.folderMode);
  });

  updateFolderModeUI();
});

ALL_INPUTS.forEach(input => {
  input.addEventListener('input', () => {
    markDirty();
    schedulePreview();
  });
});

// 选择项（图片处理方式 / 归档方式）点击即生效，与弹窗、浮窗共用同一份 storage
modeCards.forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('active')) return;
    modeCards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    updateFolderModeUI();
    chrome.storage.local.set({ folderMode: card.dataset.value }).catch(() => {});
  });
});

// 整卡可点（表单控件除外），不必精确点到开关
imageModeCards.forEach(card => {
  card.addEventListener('click', e => {
    if (e.target.closest('input, textarea, select, button, a, label')) return;
    const mode = card.dataset.imageMode;
    if (getImageMode() === mode) return;
    applyImageMode(mode);
    chrome.storage.local.set({ imageMode: mode }).catch(() => {});
  });
});

// 反向同步：弹窗 / 浮窗改了选择，这里实时跟上
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.imageMode) {
    applyImageMode(changes.imageMode.newValue);
  }

  if (changes.folderMode) {
    const mode = changes.folderMode.newValue === 'shared' ? 'shared' : 'per-article';
    const changed = modeCards.some(c => c.classList.contains('active') !== (c.dataset.value === mode));
    modeCards.forEach(c => c.classList.toggle('active', c.dataset.value === mode));
    if (changed) updateFolderModeUI();
  }
});

if (mainContainer && backToTopBtn) {
  mainContainer.addEventListener('scroll', () => {
    backToTopBtn.classList.toggle('show', mainContainer.scrollTop > 200);
  }, { passive: true });

  backToTopBtn.addEventListener('click', () => {
    mainContainer.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

const varToggle = document.getElementById('varToggle');
const varBody = document.getElementById('varBody');
if (varToggle && varBody) {
  varToggle.addEventListener('click', () => {
    const isOpen = varBody.style.display !== 'none';
    varBody.style.display = isOpen ? 'none' : 'block';
    varToggle.classList.toggle('open', !isOpen);
  });
}

// ---------- 保存 ----------

saveBtn.addEventListener('click', () => {
  const mode = getSelectedFolderMode();

  if (mode === 'shared') {
    if (!sharedFolderInput.value.trim()) {
      alert('共享文件夹名称不能为空。');
      return;
    }
    if (!validateSharedFolder(sharedFolderInput.value)) {
      alert('共享文件夹名称只能使用 {{date}}、{{date:x}}、{{time}}、{{time:x}} 变量，请修改后再保存。');
      return;
    }
    if (!sharedFilenameInput.value.trim()) {
      alert('平铺归档模式下的 Markdown 文件名不能为空。');
      return;
    }
  }

  if (!warnIfImageNameMayCollide()) return;

  chrome.storage.local.set({
    folderMode: mode,
    onlineFilename: onlineFilenameInput.value.trim(),
    downloadFolder: downloadFolderInput.value.trim(),
    sharedFolder: sharedFolderInput.value.trim(),
    sharedFilename: sharedFilenameInput.value.trim(),
    imageFolder: folderInput.value.trim(),
    imageFilename: filenameInput.value.trim(),
    sharedImageFolder: sharedImageFolderInput.value.trim(),
    sharedImageFilename: sharedImageFilenameInput.value.trim()
  }).then(() => {
    markSaved();
    scheduleReturnToSource();
  }).catch(err => {
    alert('保存失败：' + err.message);
  });
});

/**
 * 保存后返回来源页。
 * 不再用 document.activeElement 判断（用 Ctrl+S 保存时焦点仍在输入框，
 * 会导致永远不跳转）；用户在 700ms 内真的改了内容时 markDirty 会清掉定时器。
 */
function scheduleReturnToSource() {
  cancelReturn();
  returnTimer = setTimeout(() => {
    goBackToSource();
    // 兜底：tabs API 被环境吞掉时，再主动关一次自己
    forceCloseTimer = setTimeout(() => window.close(), 2000);
  }, 700);
}

function closeSelf(currentTab) {
  if (currentTab && typeof currentTab.id === 'number') {
    chrome.tabs.remove(currentTab.id).catch(() => window.close());
  } else {
    // options 不是以 tab 形式打开时（getCurrent 返回 null），直接关窗口
    window.close();
  }
}

function goBackToSource() {
  chrome.tabs.getCurrent(currentTab => {
    chrome.storage.local.get({ optionsSourceTabId: null }, res => {
      const sourceTabId = res.optionsSourceTabId;
      // 先读后清，避免残留旧 tabId 让下次跳错页面
      Promise.resolve(chrome.storage.local.remove('optionsSourceTabId')).catch(() => {});

      const finish = () => closeSelf(currentTab);

      if (typeof sourceTabId === 'number') {
        chrome.tabs.get(sourceTabId, tab => {
          if (!chrome.runtime.lastError && tab) {
            Promise.resolve(chrome.tabs.update(sourceTabId, { active: true }))
              .then(() => Promise.resolve(chrome.windows.update(tab.windowId, { focused: true })))
              .catch(() => {})
              .then(finish, finish);
            return;
          }
          fallbackToWechatTab(currentTab);
        });
        return;
      }
      fallbackToWechatTab(currentTab);
    });
  });
}

function fallbackToWechatTab(currentTab) {
  chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' }, tabs => {
    if (chrome.runtime.lastError) {
      closeSelf(currentTab);
      return;
    }
    if (!tabs || tabs.length === 0) {
      closeSelf(currentTab);
      return;
    }
    const target = tabs.find(t => t.active) || tabs[0];
    chrome.tabs.update(target.id, { active: true })
      .then(() => chrome.windows.update(target.windowId, { focused: true }))
      .catch(() => {})
      .finally(() => closeSelf(currentTab));
  });
}

// ---------- 恢复默认 ----------

// 每套配置各自的默认值：恢复默认只作用于「当前选中」的那一套，未选中的保持不动
const RESET_BY_MODE = {
  online: {
    onlineFilename: DEFAULTS.onlineFilename
  },
  'per-article': {
    downloadFolder: DEFAULTS.downloadFolder,
    imageFolder: DEFAULTS.imageFolder,
    imageFilename: DEFAULTS.imageFilename
  },
  shared: {
    sharedFolder: DEFAULTS.sharedFolder,
    sharedFilename: DEFAULTS.sharedFilename,
    sharedImageFolder: DEFAULTS.sharedImageFolder,
    sharedImageFilename: DEFAULTS.sharedImageFilename
  }
};

const RESET_INPUT_MAP = {
  onlineFilename: onlineFilenameInput,
  downloadFolder: downloadFolderInput,
  sharedFolder: sharedFolderInput,
  sharedFilename: sharedFilenameInput,
  imageFolder: folderInput,
  imageFilename: filenameInput,
  sharedImageFolder: sharedImageFolderInput,
  sharedImageFilename: sharedImageFilenameInput
};

resetBtn.addEventListener('click', () => {
  const key = getImageMode() === 'online' ? 'online' : getSelectedFolderMode();
  const patch = RESET_BY_MODE[key];
  if (!patch) return;

  Object.keys(patch).forEach(name => {
    const input = RESET_INPUT_MAP[name];
    if (input) input.value = patch[name];
  });

  updatePreview();
  chrome.storage.local.set(patch).catch(() => {});

  clearTimeout(resetFlashTimer);
  resetBtn.textContent = '✓ 已恢复';
  resetFlashTimer = setTimeout(() => { resetBtn.textContent = '恢复默认'; }, 1400);
});

// ---------- 快捷键 ----------

document.addEventListener('keydown', e => {
  if (typeof e.key !== 'string') return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;

  e.preventDefault();
  if (!saveBtn.classList.contains('saved')) saveBtn.click();
});
