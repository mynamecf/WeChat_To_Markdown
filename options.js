const FALLBACK_DEFAULTS = {
  folderMode: 'per-article',
  imagePathMode: 'note',
  imageRefPrefix: '/微信/{{noteFolder}}/',
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
      imagePathMode: WXMD_DEFAULTS.imagePathMode || 'note',
      imageRefPrefix: WXMD_DEFAULTS.imageRefPrefix || '/微信/{{noteFolder}}/',
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
const previewImageRef = document.getElementById('previewImageRef');
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
// 图片引用路径的三个选项：前两个是卡片，第三个是阴影块里的标题行
const refModeBtns = Array.from(document.querySelectorAll('#imagePathModeGroup [data-ref-mode]'));
// 自定义前缀阴影块（选项与输入框同块）
const imageRefPrefixGroup = document.getElementById('imageRefPrefixGroup');
const imageRefPrefixInput = document.getElementById('imageRefPrefix');

const ALL_INPUTS = [
  onlineFilenameInput,
  downloadFolderInput,
  sharedFolderInput,
  sharedFilenameInput,
  folderInput,
  filenameInput,
  sharedImageFolderInput,
  sharedImageFilenameInput,
  imageRefPrefixInput
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

// ---------- 图片引用配置：逐篇 / 平铺各一份 ----------

// 字段名与 lib/naming.js 的 IMAGE_REF_KEYS 同源，避免两边改名后对不上
const REF_KEYS = (NAMING && NAMING.IMAGE_REF_KEYS) || {
  'per-article': { mode: 'perArticleImagePathMode', prefix: 'perArticleImageRefPrefix' },
  shared: { mode: 'sharedImagePathMode', prefix: 'sharedImageRefPrefix' }
};

// 界面上只有一块「图片引用路径」，内容跟着当前归档方式走：
// 切换归档方式时先把这一块的当前值收进内存，再把目标方式存的那份铺回界面。
const refByMode = {
  'per-article': { mode: DEFAULTS.imagePathMode, prefix: DEFAULTS.imageRefPrefix },
  shared: { mode: DEFAULTS.imagePathMode, prefix: DEFAULTS.imageRefPrefix }
};

/** 取某个归档方式对应的存储字段名 */
function refKeysOf(folderMode) {
  return REF_KEYS[folderMode === 'shared' ? 'shared' : 'per-article'];
}

/** 按归档方式取一份归一后的 { mode, prefix }（含旧版单份配置的迁移兜底） */
function resolveRefFor(folderMode, cfg) {
  if (NAMING && typeof NAMING.resolveImageRefForFolder === 'function') {
    return NAMING.resolveImageRefForFolder(cfg || {}, folderMode);
  }
  return {
    mode: normalizeImagePathMode((cfg || {})[refKeysOf(folderMode).mode] ?? (cfg || {}).imagePathMode),
    prefix: (cfg || {})[refKeysOf(folderMode).prefix] ?? (cfg || {}).imageRefPrefix ?? ''
  };
}

/** 把界面上的引用配置记到当前归档方式名下（只进内存，保存时才落库） */
function stashRefState() {
  const cur = getSelectedFolderMode();
  refByMode[cur] = {
    mode: getImagePathMode(),
    prefix: imageRefPrefixInput ? imageRefPrefixInput.value : refByMode[cur].prefix
  };
}

/** 把某个归档方式存的那份引用配置铺到界面上 */
function applyRefForMode(folderMode) {
  const st = refByMode[folderMode === 'shared' ? 'shared' : 'per-article'];
  applyImagePathMode(st.mode);
  if (imageRefPrefixInput) imageRefPrefixInput.value = st.prefix;
}

/** 预览用：默认以第一张图片（index 0）为例；传 index 可看第 N 张的命名结果。 */
function parseTemplate(tplStr, isFirstImage = false, isPath = false, titleOverride = null, index = 0) {
  if (!tplStr) return '';
  const meta = titleOverride ? { ...PREVIEW_META, title: titleOverride } : PREVIEW_META;
  return NAMING.resolveTemplate(tplStr, index, PREVIEW_URL, meta, isPath);
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

// 预览里放几张图片：模板含 {{index1}} 时能看出连续编号，不含时也能看出撞名怎么被改名
const PREVIEW_IMAGE_COUNT = 3;

/**
 * 模板没用到 {{index1}} 时，三张图会得到同一个文件名。
 * Chrome 落盘时会把重复的改名成「a (1).png」，这里照同样规则推演，
 * 免得预览显示三个一样的名字，与真实结果不符。
 */
function uniquifyPreviewName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const m = /^(.*?)(\.[^./]+)?$/.exec(name);
  const base = m[1];
  const ext = m[2] || '';
  let n = 1;
  let candidate;
  do {
    candidate = `${base} (${n})${ext}`;
    n++;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function appendImageNodes(children, imgDirVal, names) {
  const dirs = imgDirVal ? imgDirVal.split('/').filter(Boolean) : [];
  let container = children;
  dirs.forEach(dir => {
    const folder = { type: 'folder', name: dir, icon: '📁', children: [] };
    container.push(folder);
    container = folder.children;
  });
  names.forEach(name => {
    container.push({ type: 'file', name: name + '.png', icon: '🖼️' });
  });
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
  syncImageRefPrefixVisibility();
}

// ---------- 图片引用路径 ----------

function normalizeImagePathMode(mode) {
  if (NAMING && typeof NAMING.normalizeImageRefMode === 'function') {
    return NAMING.normalizeImageRefMode(mode);
  }
  return (mode === 'relative' || mode === 'custom') ? mode : 'note';
}

function getImagePathMode() {
  const active = refModeBtns.find(b => b.classList.contains('active'));
  return normalizeImagePathMode(active ? active.dataset.refMode : 'note');
}

function applyImagePathMode(mode) {
  const target = normalizeImagePathMode(mode);
  refModeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.refMode === target);
  });
  syncImageRefPrefixVisibility();
}

/**
 * 自定义前缀块的状态：选中时高亮，其它模式只是「未启用」，
 * 不再整块隐藏 —— 少一次布局跳动，也少一行竖向占位。
 * 在线模式不下载图片，前缀无从生效，整块退成背景色。
 */
function syncImageRefPrefixVisibility() {
  if (!imageRefPrefixGroup) return;
  const isCustom = getImagePathMode() === 'custom';
  imageRefPrefixGroup.classList.toggle('active', isCustom);
  imageRefPrefixGroup.classList.toggle('idle', !isCustom);
  imageRefPrefixGroup.classList.toggle('muted', getImageMode() === 'online');
}

/** 走 lib/naming.js 的唯一实现，保证示例 / 预览 / 真实导出三处一致 */
function buildRefPath(mode, imgDirVal, fileName, noteFolderVal, prefixVal) {
  return (NAMING && typeof NAMING.buildImageRef === 'function')
    ? NAMING.buildImageRef(mode, imgDirVal, fileName, noteFolderVal, prefixVal)
    : '';
}

/**
 * 渲染「Markdown 中写作」这一行 —— 完整路径只在这里出现（选项只标差异，避免重复）。
 * 用的是 lib/naming.js 的 buildImageRef —— 与 background.js 真正落盘时同一个函数，
 * 所以这里看到什么，导出的 md 里就是什么。
 */
function renderImageRef(imgDirVal, fileName, noteFolderVal, prefixVal) {
  if (!previewImageRef) return;

  if (getImageMode() === 'online') {
    previewImageRef.innerHTML =
      '<span class="dim">在线模式不下载图片，图片直接引用原站地址</span>';
    return;
  }

  const refPath = buildRefPath(getImagePathMode(), imgDirVal, fileName, noteFolderVal, prefixVal);

  if (!refPath) {
    previewImageRef.textContent = '-';
    return;
  }
  previewImageRef.innerHTML =
    '<span class="dim">![](</span>' + esc(refPath) + '<span class="dim">)</span>';
}

function updatePreview() {
  const onlineVal = parseTemplate(onlineFilenameInput.value, false, false);
  previewOnline.innerHTML = `<span class="file">📄 ${esc(onlineVal || 'article')}.md</span>`;

  const mode = getSelectedFolderMode();
  // 逐篇 / 平铺各用自己那套图片规则
  const imgDirInput = mode === 'shared' ? sharedImageFolderInput : folderInput;
  const imgNameInput = mode === 'shared' ? sharedImageFilenameInput : filenameInput;
  const imgDirVal = parseTemplate(imgDirInput.value, false, true);

  // 三张图片的文件名：{{index1}} 会依次变成 1/2/3；模板不含索引时按 Chrome
  // 的撞名规则补「 (1)」「 (2)」，让预览与真实落盘一致。
  const used = new Set();
  const imgNames = [];
  for (let i = 0; i < PREVIEW_IMAGE_COUNT; i++) {
    const base = parseTemplate(imgNameInput.value, true, false, null, i) || ('IMG_' + (i + 1));
    imgNames.push(uniquifyPreviewName(base, used));
  }
  const firstImageFile = imgNames[0] + '.png';

  // .md 自己所在的文件夹（相对下载根目录）：自定义前缀里的 {{noteFolder}} 要用它
  let noteFolder = 'article';

  if (mode === 'shared') {
    const sharedVal = parseDateTemplate(sharedFolderInput.value) || 'article';
    noteFolder = sharedVal;
    // 与 content.js 的 md 命名逻辑保持一致：直接用模板结果，不再二次截取
    const mdNameA = parseTemplate(sharedFilenameInput.value, false, false, '微信文章标题A') || 'article';
    const mdNameB = parseTemplate(sharedFilenameInput.value, false, false, '微信文章标题B') || 'article';

    const children = [
      { type: 'file', name: mdNameA + '.md', icon: '📄' },
      { type: 'file', name: mdNameB + '.md', icon: '📄' }
    ];
    appendImageNodes(children, imgDirVal, imgNames);

    previewDownload.innerHTML = renderTree('📁', sharedVal, 'folder', children);
  } else {
    const folderVal = parseTemplate(downloadFolderInput.value, false, true) || 'article';
    noteFolder = folderVal;
    // 与 background.js 一致：md 文件名只取文件夹路径的最后一段
    const mdFileName = folderVal.split('/').pop() || folderVal;

    const children = [{ type: 'file', name: mdFileName + '.md', icon: '📄' }];
    appendImageNodes(children, imgDirVal, imgNames);

    previewDownload.innerHTML = renderTree('📁', folderVal, 'folder', children);
  }

  // 自定义前缀原样传下去：清洗（斜杠、空格编码）统一在 buildImageRef 里做，
  // 保证预览和真实导出走同一套规则
  renderImageRef(imgDirVal, firstImageFile, noteFolder, imageRefPrefixInput ? imageRefPrefixInput.value.trim() : '');
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

// 逐篇 / 平铺的引用配置单独读：DEFAULTS 里没有这两个分档字段，
// 给 null 默认值才能分出「没存过」和「存过空串」，旧版单份配置也能照旧迁移过来。
chrome.storage.local.get({
  ...DEFAULTS,
  imageMode: 'download',
  perArticleImagePathMode: null,
  perArticleImageRefPrefix: null,
  sharedImagePathMode: null,
  sharedImageRefPrefix: null
}, res => {
  onlineFilenameInput.value = res.onlineFilename;
  downloadFolderInput.value = res.downloadFolder;
  sharedFolderInput.value = res.sharedFolder;
  sharedFilenameInput.value = res.sharedFilename;
  folderInput.value = res.imageFolder;
  filenameInput.value = res.imageFilename;
  sharedImageFolderInput.value = res.sharedImageFolder;
  sharedImageFilenameInput.value = res.sharedImageFilename;

  // 旧版的「上一级 / 库内绝对路径」在这里一次性迁移成「自定义前缀」，
  // 用户不用重新选一遍；迁移只影响显示，保存时才写回 storage。
  ['per-article', 'shared'].forEach(m => {
    const cfg = resolveRefFor(m, res);
    refByMode[m] = { mode: cfg.mode, prefix: cfg.prefix };
  });

  const folderMode = res.folderMode === 'shared' ? 'shared' : 'per-article';
  modeCards.forEach(card => {
    card.classList.toggle('active', card.dataset.value === folderMode);
  });

  applyImageMode(res.imageMode);
  applyRefForMode(folderMode);
  updateFolderModeUI();
});

ALL_INPUTS.forEach(input => {
  input.addEventListener('input', () => {
    // 前缀输入框的内容也要同步进当前归档方式的内存副本，
    // 否则切到另一档再切回来会显示上一次铺进来的值
    if (input === imageRefPrefixInput) {
      refByMode[getSelectedFolderMode()].prefix = input.value;
    }
    markDirty();
    schedulePreview();
  });
});

// 选择项（图片处理方式 / 归档方式）点击即生效，与弹窗、浮窗共用同一份 storage
modeCards.forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('active')) return;
    switchFolderMode(card.dataset.value);
    chrome.storage.local.set({ folderMode: card.dataset.value }).catch(() => {});
  });
});

/**
 * 切换归档方式：把当前这块引用配置收进内存，再铺出目标方式存的那份。
 * 两边的引用配置互不影响，切回来还是原来的值。
 */
function switchFolderMode(mode) {
  const target = mode === 'shared' ? 'shared' : 'per-article';
  if (getSelectedFolderMode() === target) return;
  stashRefState();
  modeCards.forEach(c => c.classList.toggle('active', c.dataset.value === target));
  applyRefForMode(target);
  updateFolderModeUI();
}

// 整卡可点（表单控件除外），不必精确点到开关
imageModeCards.forEach(card => {
  card.addEventListener('click', e => {
    if (e.target.closest('input, textarea, select, button, a, label')) return;
    const mode = card.dataset.imageMode;
    if (getImageMode() === mode) return;
    applyImageMode(mode);
    chrome.storage.local.set({ imageMode: mode }).catch(() => {});
    // 在线模式下不下载图片，引用路径那一行要立刻改成提示文案
    updatePreview();
  });
});

// 图片引用路径：点一下即生效（和归档方式一样），不必等「保存」
// 只写当前归档方式这一份，另一份保持不动
function selectImagePathMode(mode) {
  const target = normalizeImagePathMode(mode);
  if (getImagePathMode() === target) return;
  const cur = getSelectedFolderMode();
  refByMode[cur].mode = target;
  applyImagePathMode(target);
  updatePreview();
  chrome.storage.local.set({ [refKeysOf(cur).mode]: target }).catch(() => {});
}

refModeBtns.forEach(btn => {
  btn.addEventListener('click', () => selectImagePathMode(btn.dataset.refMode));
});

// 「自定义前缀」整块可点：原来只有标题那一小行能点，点到块内留白、示例路径、
// 说明文字都毫无反应，看着像「选不中」。除输入框（自身有 focus）和链接外都算点击。
if (imageRefPrefixGroup) {
  imageRefPrefixGroup.addEventListener('click', e => {
    if (e.target.closest('input, textarea, select, a')) return;
    selectImagePathMode('custom');
  });
}

// 前缀输入框和选项同处一块：直接点进输入框开始填，就等于选了「自定义前缀」，
// 不用先点一下标题再点输入框。focus 与 click 都挂上——输入框已聚焦时再点，
// 不会再触发 focus，只靠 focus 会漏掉一次。
if (imageRefPrefixInput) {
  const pickCustom = () => selectImagePathMode('custom');
  imageRefPrefixInput.addEventListener('focus', pickCustom);
  imageRefPrefixInput.addEventListener('click', pickCustom);
}

// 反向同步：弹窗 / 浮窗改了选择，这里实时跟上
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.imageMode) {
    applyImageMode(changes.imageMode.newValue);
    // 在线 / 本地切换会影响「Markdown 中写作」那一行，需要重算
    updatePreview();
  }

  // 逐篇 / 平铺的引用配置各监听各的；只有当前正在显示的那一份需要重绘界面
  Object.keys(REF_KEYS).forEach(m => {
    const keys = REF_KEYS[m];
    const modeCh = changes[keys.mode];
    const prefixCh = changes[keys.prefix];
    if (!modeCh && !prefixCh) return;

    const st = refByMode[m];
    if (modeCh && typeof modeCh.newValue === 'string') st.mode = normalizeImagePathMode(modeCh.newValue);
    if (prefixCh && typeof prefixCh.newValue === 'string') st.prefix = prefixCh.newValue;

    if (getSelectedFolderMode() === m) {
      applyRefForMode(m);
      updatePreview();
    }
  });

  if (changes.folderMode) {
    const mode = changes.folderMode.newValue === 'shared' ? 'shared' : 'per-article';
    const changed = modeCards.some(c => c.classList.contains('active') !== (c.dataset.value === mode));
    if (changed) switchFolderMode(mode);
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

// ---------- 可折叠区块（默认收起） ----------

// 「可用变量」「导出位置说明」共用同一套折叠行为，避免两处各写一遍
[['varToggle', 'varBody'], ['noticeToggle', 'noticeBody']].forEach(pair => {
  const head = document.getElementById(pair[0]);
  const body = document.getElementById(pair[1]);
  if (!head || !body) return;
  head.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    head.classList.toggle('open', !isOpen);
  });
});

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

  // 先把界面上的引用配置收进当前归档方式，再连同另一档一起写回
  stashRefState();

  const refPatch = {};
  Object.keys(REF_KEYS).forEach(m => {
    refPatch[REF_KEYS[m].mode] = refByMode[m].mode;
    refPatch[REF_KEYS[m].prefix] = String(refByMode[m].prefix || '').trim();
  });

  chrome.storage.local.set({
    folderMode: mode,
    ...refPatch,
    // 旧单份字段跟着当前归档方式走，旧版本或兜底代码读到的仍是「正在用的那套」
    imagePathMode: refByMode[mode].mode,
    imageRefPrefix: String(refByMode[mode].prefix || '').trim(),
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

// 每套配置各自的默认值：恢复默认只作用于「当前选中」的那一套，未选中的保持不动。
// 图片引用配置不写在这里 —— 它按归档方式分出两份，字段名是动态的，见下方处理器。
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
  sharedImageFilename: sharedImageFilenameInput,
  imageRefPrefix: imageRefPrefixInput
};

resetBtn.addEventListener('click', () => {
  const folderMode = getSelectedFolderMode();
  const key = getImageMode() === 'online' ? 'online' : folderMode;
  if (!RESET_BY_MODE[key]) return;
  const patch = Object.assign({}, RESET_BY_MODE[key]);

  // 引用配置只重置当前归档方式这一份，另一档的前缀原样保留
  if (key !== 'online') {
    const keys = refKeysOf(folderMode);
    refByMode[folderMode] = { mode: DEFAULTS.imagePathMode, prefix: DEFAULTS.imageRefPrefix };
    patch[keys.mode] = DEFAULTS.imagePathMode;
    patch[keys.prefix] = DEFAULTS.imageRefPrefix;
  }

  Object.keys(patch).forEach(name => {
    const input = RESET_INPUT_MAP[name];
    if (input) input.value = patch[name];
  });
  // 图片引用路径不是输入框，单独回填到按钮选中态
  if (key !== 'online') applyRefForMode(folderMode);

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

// ---------- 官网 / 问题反馈 ----------
// 地址只写在 lib/defaults.js 的 WXMD_LINKS 里，这里负责挂到顶栏上。
// 地址留空时链接会自动隐藏，不会留下点不开的死链。
if (typeof WXMD_mountSiteLinks === 'function') WXMD_mountSiteLinks();
