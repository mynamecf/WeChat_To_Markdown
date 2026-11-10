/**
 * floating.js —— 页内可拖动浮窗（content script）
 * 绿色统一通过 CSS 变量控制（与 popup / options 一致）
 */
(async function () {
  'use strict';

  if (window.__wxMdFloatingInjected) return;
  window.__wxMdFloatingInjected = true;

  const DEFAULT_SETTINGS = {
    imageMode: 'download',
    folderMode: 'per-article',
    pinned: false
  };

  const POS_KEY = 'wxMdFloatPos';
  const DRAG_THRESHOLD = 5;
  // 导出等待上限（ms）。浮窗拿不到图片数量，用固定值：
  // 正常文章几秒就完，5 分钟足够覆盖慢网络下的多图长文；
  // 只用于放开按钮，不会中断后台已经发出的下载。
  const EXPORT_WATCHDOG_MS = 300000;

  // ---------- 挂载 DOM ----------

  const host = document.createElement('div');
  host.id = 'wx-md-floating-host';
  host.style.visibility = 'hidden'; // 读回位置前先别闪一下
  document.documentElement.appendChild(host);

  // closed：isolated world 只隔离 JS 环境，DOM 树是和页面共享的。
  // open 模式下页面脚本可以 host.shadowRoot.getElementById('wxMdExport').click()，
  // 直接驱动扩展导出、甚至改写浮窗文案做 UI 伪装。closed 让 shadowRoot 反查返回 null。
  // attachShadow 的返回值本身仍可用，所以下面两个 appendChild 不受影响。
  const shadow = host.attachShadow({ mode: 'closed' });

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      right: 20px;
      bottom: 20px;
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #1f2937;

      --ball-size: 52px;
      --ball-radius: 14px;
      --ball-gap: 68px;

      --brand-green: #07C160;
      --brand-green-dark: #06AD56;
      --brand-green-light: #E6F9F0;
      --brand-green-soft: #B7ECD1;
      --brand-green-text: #0A7A42;
      --brand-green-rgb: 7, 193, 96;
    }
    * { box-sizing: border-box; }

    .wx-md-ball {
      width: var(--ball-size);
      height: var(--ball-size);
      border-radius: var(--ball-radius);
      background: #ffffff;
      border: 1px solid #e5e7eb;
      box-shadow: 0 4px 16px rgba(var(--brand-green-rgb), 0.3);
      display: flex; align-items: center; justify-content: center;
      cursor: grab;
      transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
      user-select: none;
      touch-action: none;
      overflow: hidden;
    }
    .wx-md-ball:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 22px rgba(var(--brand-green-rgb), 0.42);
      border-color: rgba(var(--brand-green-rgb), 0.35);
    }
    .wx-md-ball.dragging {
      cursor: grabbing;
      transform: scale(1.02);
      transition: transform 0.1s ease;
    }
    .wx-md-ball img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    .wx-md-panel {
      position: absolute;
      bottom: var(--ball-gap); right: 0;
      width: 320px;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      overflow: hidden;
      display: none;
      animation: wxMdFadeIn 0.18s ease;
    }
    .wx-md-panel.open { display: block; }
    @keyframes wxMdFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .wx-md-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      cursor: move; user-select: none; background: #fff;
    }
    .wx-md-title {
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; font-size: 13px; color: #111827;
    }
    .wx-md-title img { width: 22px; height: 22px; border-radius: 6px; }
    .wx-md-head-right { display: flex; align-items: center; gap: 4px; }
    .wx-md-icon-btn {
      width: 24px; height: 24px;
      border-radius: 6px; border: none;
      background: #f3f4f6; color: #6b7280;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .wx-md-icon-btn:hover { background: #e5e7eb; color: #374151; }
    .wx-md-icon-btn.pinned { background: var(--brand-green); color: #fff; }
    .wx-md-icon-btn.pinned:hover { background: var(--brand-green-dark); }

    .wx-md-body { padding: 12px 14px; }

    .wx-md-article-box {
      background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 8px 10px; margin-bottom: 12px;
    }
    .wx-md-article-label { font-size: 11px; color: #9ca3af; margin-bottom: 2px; }
    .wx-md-article-name {
      font-size: 13px; font-weight: 500; color: #374151; line-height: 1.35;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; word-break: break-all;
    }

    .wx-md-section-title { font-size: 11px; color: #6b7280; margin-bottom: 8px; font-weight: 500; }

    .wx-md-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .wx-md-opt {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 9px 10px;
      border: 1px solid #e5e7eb; border-radius: 8px;
      cursor: pointer; background: #fff; transition: all 0.15s;
    }
    .wx-md-opt:hover { border-color: #d1d5db; }
    .wx-md-opt.active {
      border-color: var(--brand-green);
      background: var(--brand-green-light);
      box-shadow: 0 0 0 1px var(--brand-green);
    }
    .wx-md-radio {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid #d1d5db; flex-shrink: 0;
      margin-top: 1px; background: #fff; position: relative;
      transition: border-color 0.15s;
    }
    .wx-md-opt.active .wx-md-radio { border-color: var(--brand-green); }
    .wx-md-radio::after {
      content: ''; position: absolute; top: 50%; left: 50%;
      width: 6px; height: 6px; border-radius: 50%; background: var(--brand-green);
      transform: translate(-50%, -50%) scale(0); transition: transform 0.15s;
    }
    .wx-md-opt.active .wx-md-radio::after { transform: translate(-50%, -50%) scale(1); }

    .wx-md-opt-body { flex: 1; min-width: 0; }
    .wx-md-opt-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
    .wx-md-opt-name {
      font-weight: 600; font-size: 12px; color: #111827;
      display: flex; align-items: center; gap: 6px;
    }
    .wx-md-opt-name svg { color: #9ca3af; transition: color 0.15s; }
    .wx-md-opt.active .wx-md-opt-name svg { color: var(--brand-green); }
    .wx-md-tag {
      font-size: 10px; padding: 1px 6px; border-radius: 4px;
      background: #f3f4f6; color: #6b7280; transition: all 0.15s;
    }
    .wx-md-opt.active .wx-md-tag { background: var(--brand-green-soft); color: var(--brand-green-text); }
    .wx-md-opt-desc { font-size: 11px; color: #6b7280; line-height: 1.35; }

    .wx-md-archive {
      margin: -4px 0 10px; padding: 8px 10px;
      background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
    }
    .wx-md-archive-label {
      font-size: 10px; color: #9ca3af; margin-bottom: 6px;
      display: flex; align-items: center; gap: 4px;
    }
    .wx-md-archive-label::before {
      content: ''; width: 3px; height: 9px;
      background: var(--brand-green); border-radius: 2px;
    }
    .wx-md-archive-options { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .wx-md-archive-btn {
      display: flex; align-items: center; justify-content: center; gap: 5px;
      padding: 6px 4px; background: #fff;
      border: 1px solid #e5e7eb; border-radius: 6px;
      color: #6b7280; font-size: 11px; font-weight: 500;
      font-family: inherit; cursor: pointer; transition: all 0.15s;
    }
    .wx-md-archive-btn:hover { border-color: #d1d5db; color: #374151; }
    .wx-md-archive-btn.active {
      background: var(--brand-green-light);
      border-color: var(--brand-green);
      color: var(--brand-green);
    }

    .wx-md-actions { display: flex; flex-direction: column; gap: 6px; }

    .wx-md-export {
      width: 100%; padding: 9px;
      background: var(--brand-green); color: #fff; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 600; font-family: inherit;
      cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
      transition: background 0.15s;
    }
    .wx-md-export:hover { background: var(--brand-green-dark); }
    .wx-md-export:disabled { background: var(--brand-green-soft); cursor: not-allowed; }

    .wx-md-kbd {
      font-size: 10px;
      background: rgba(255, 255, 255, 0.25);
      padding: 2px 5px;
      border-radius: 4px;
      margin-left: 2px;
      font-family: ui-monospace, monospace;
      font-weight: normal;
      letter-spacing: 0.5px;
    }

    .wx-md-link {
      width: 100%; padding: 7px;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      color: #6b7280; font-size: 12px; font-family: inherit;
      cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;
      transition: all 0.15s;
    }
    .wx-md-link:hover { background: #f9fafb; color: #374151; }

    /* 官网 / 问题反馈：压在「详细配置」下面的一条窄行，不额外占高度。
       上间距 = .wx-md-actions 的 gap（6px）；下间距用负 margin 抵掉面板
       底部 padding 的一半，让这一行的上下空白都是 6px，不再一大一小。 */
    .wx-md-links {
      display: flex; align-items: center; justify-content: center; gap: 2px;
      margin: 0 0 -6px;
    }
    .wx-md-links[hidden] { display: none; }
    .wx-md-site-link {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 1px 7px; border-radius: 5px;
      color: #6b7280; font-size: 11.5px; line-height: 16px;
      text-decoration: none; cursor: pointer; transition: color 0.15s, background 0.15s;
    }
    .wx-md-site-link:hover { color: var(--brand-green-text); background: var(--brand-green-light); }
    .wx-md-links-sep { width: 1px; height: 9px; background: #e5e7eb; flex: 0 0 auto; }

    .wx-md-status {
      font-size: 11px;
      text-align: center;
      color: #6b7280;
    }
    .wx-md-status:not(:empty) {
      margin-top: 8px;
    }
    .wx-md-status.error { color: #ef4444; }
    .wx-md-status.success { color: var(--brand-green); }
  `;
  shadow.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = 'wx-md-root';
  root.innerHTML = `
    <div class="wx-md-ball" id="wxMdBall" title="按住可拖动 · 点击展开/收起">
      <img src="${chrome.runtime.getURL('icons/icon128.png')}" alt="">
    </div>

    <div class="wx-md-panel" id="wxMdPanel">
      <div class="wx-md-head" id="wxMdHead">
        <div class="wx-md-title">
          <img src="${chrome.runtime.getURL('icons/icon128.png')}" alt="">
          微信文章转 Markdown
        </div>
        <div class="wx-md-head-right">
          <button class="wx-md-icon-btn" id="wxMdPin" title="取消固定（关闭浮窗）">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 17v5"></path>
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path>
            </svg>
          </button>
          <button class="wx-md-icon-btn" id="wxMdClose" title="最小化">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>

      <div class="wx-md-body">
        <div class="wx-md-article-box">
          <div class="wx-md-article-label">当前文档</div>
          <div class="wx-md-article-name" id="wxMdArticleName">正在获取...</div>
        </div>

        <div class="wx-md-section-title">图片处理方式</div>

        <div class="wx-md-options">
          <div class="wx-md-opt" data-mode="online">
            <div class="wx-md-radio"></div>
            <div class="wx-md-opt-body">
              <div class="wx-md-opt-head">
                <div class="wx-md-opt-name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                  </svg>
                  保留在线链接
                </div>
                <span class="wx-md-tag">轻量</span>
              </div>
              <div class="wx-md-opt-desc">直接引用网络图片地址</div>
            </div>
          </div>

          <div class="wx-md-opt" data-mode="download">
            <div class="wx-md-radio"></div>
            <div class="wx-md-opt-body">
              <div class="wx-md-opt-head">
                <div class="wx-md-opt-name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  下载到本地
                </div>
                <span class="wx-md-tag">推荐</span>
              </div>
              <div class="wx-md-opt-desc">图片保存到本地，随文导出</div>
            </div>
          </div>
        </div>

        <div class="wx-md-archive" id="wxMdArchive">
          <div class="wx-md-archive-label">归档方式</div>
          <div class="wx-md-archive-options">
            <button class="wx-md-archive-btn" data-folder="per-article" type="button" title="每篇文章单独一个文件夹，附件随文归档。">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                <line x1="9" y1="13" x2="15" y2="13"></line>
                <line x1="9" y1="17" x2="13" y2="17"></line>
              </svg>
              逐篇归档
            </button>
            <button class="wx-md-archive-btn" data-folder="shared" type="button" title="所有文章与附件置于同一文件夹，文章平级，附件混排。">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                <rect x="3" y="14" width="7" height="7" rx="1"></rect>
              </svg>
              平铺归档
            </button>
          </div>
        </div>

        <div class="wx-md-actions">
          <button class="wx-md-export" id="wxMdExport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            导出当前文章
            <kbd class="wx-md-kbd" id="wxMdKbd">Ctrl S</kbd>
          </button>
          <button class="wx-md-link" id="wxMdOptions">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            详细配置
          </button>
          <!-- 官网 / 问题反馈：地址统一在 lib/defaults.js 的 WXMD_LINKS 里改 -->
          <div class="wx-md-links" id="wxMdSiteLinks" hidden>
            <a class="wx-md-site-link" id="wxMdLinkHome" target="_blank" rel="noopener noreferrer">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              官网
            </a>
            <span class="wx-md-links-sep" id="wxMdLinkHomeSep"></span>
            <a class="wx-md-site-link" id="wxMdLinkFeedback" target="_blank" rel="noopener noreferrer">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"></path></svg>
              问题反馈
            </a>
          </div>
        </div>

        <div class="wx-md-status" id="wxMdStatus"></div>
      </div>
    </div>
  `;
  shadow.appendChild(root);

  // closed 模式下不能用 shadow.getElementById 反查，统一走自己持有的 root 引用
  const $ = sel => root.querySelector(sel);
  const $$ = sel => root.querySelectorAll(sel);

  const ball = $('#wxMdBall');
  const panel = $('#wxMdPanel');
  const head = $('#wxMdHead');
  const closeBtn = $('#wxMdClose');
  const pinBtn = $('#wxMdPin');
  const archiveBox = $('#wxMdArchive');
  const exportBtn = $('#wxMdExport');
  const optionsBtn = $('#wxMdOptions');
  const statusEl = $('#wxMdStatus');
  const articleNameEl = $('#wxMdArticleName');
  const kbdEl = $('#wxMdKbd');
  const optCards = Array.from($$('.wx-md-opt'));
  const archiveBtns = Array.from($$('.wx-md-archive-btn'));

  // ---------- 官网 / 问题反馈 ----------
  // 地址只写在 lib/defaults.js 的 WXMD_LINKS 一处，与弹窗、配置页共用；
  // 这里挂的是普通 <a target="_blank">—— 内容脚本拿不到 chrome.tabs，锚点跳新标签最稳。
  (function mountSiteLinks() {
    const links = (typeof WXMD_LINKS !== 'undefined' && WXMD_LINKS) || {};
    const box = $('#wxMdSiteLinks');
    if (!box) return;

    const mount = (id, url) => {
      const el = $('#' + id);
      if (!el) return false;
      if (!url) {
        el.remove();
        return false;
      }
      el.setAttribute('href', url);
      el.setAttribute('title', url);
      return true;
    };

    const hasHome = mount('wxMdLinkHome', links.homepage);
    const hasFeedback = mount('wxMdLinkFeedback', links.feedback);
    const sep = $('#wxMdLinkHomeSep');
    if (sep && !(hasHome && hasFeedback)) sep.remove();

    // 两个地址都没配时整行不占位，不留下一条空行
    box.hidden = !(hasHome || hasFeedback);
  })();

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (kbdEl) kbdEl.textContent = isMac ? '⌘ S' : 'Ctrl S';

  let currentMode = DEFAULT_SETTINGS.imageMode;
  let currentFolder = DEFAULT_SETTINGS.folderMode;
  let currentPinned = DEFAULT_SETTINGS.pinned;

  // ---------- 标题 ----------

  function updateArticleTitle() {
    try {
      const titleEl = document.querySelector('#activity-name');
      let title = '';
      if (titleEl && titleEl.innerText.trim()) {
        title = titleEl.innerText.trim();
      } else {
        title = document.title.trim().replace(/\s*[-—|]\s*微信公众平台\s*$/, '').trim();
      }
      articleNameEl.textContent = title || '未能获取标题';
      articleNameEl.title = title || '';
    } catch (e) {
      articleNameEl.textContent = '获取标题失败';
    }
  }

  updateArticleTitle();
  setTimeout(updateArticleTitle, 800);
  setTimeout(updateArticleTitle, 2400);

  // ---------- 位置（存 chrome.storage，不碰页面 localStorage） ----------

  function readPos() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get({ [POS_KEY]: null }, res => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res[POS_KEY] || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function savePos(x, y) {
    try {
      chrome.storage.local.set({ [POS_KEY]: { x: Math.round(x), y: Math.round(y) } });
    } catch (e) {}
  }

  function clampPos(x, y, w, h) {
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY)
    };
  }

  function applyPos(x, y) {
    host.style.left = x + 'px';
    host.style.top = y + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }

  const savedPos = await readPos();
  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    const p = clampPos(savedPos.x, savedPos.y, 52, 52);
    applyPos(p.x, p.y);
  }

  function showHost() { host.style.display = 'block'; host.style.visibility = 'visible'; }
  function hideHost() { host.style.display = 'none'; }

  function openPanel() {
    showHost();
    updateArticleTitle();
    panel.classList.add('open');
    updateArchiveVisibility();
  }

  function closePanel() { panel.classList.remove('open'); }

  function togglePanel() {
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  }

  function updateArchiveVisibility() {
    archiveBox.style.display = currentMode === 'download' ? 'block' : 'none';
  }

  function updatePinUI() {
    pinBtn.classList.toggle('pinned', currentPinned);
    pinBtn.title = currentPinned ? '取消固定（关闭浮窗）' : '固定到页面';
  }

  // ---------- 拖拽（rAF 合并 + AbortController 收口） ----------

  let dragCtx = null;      // { startX, startY, left, top, w, h }
  let dragAbort = null;
  let rafId = 0;
  let pendingPoint = null;
  let ballMoved = false;

  function flushMove() {
    rafId = 0;
    if (!dragCtx || !pendingPoint) return;
    const dx = pendingPoint.x - dragCtx.startX;
    const dy = pendingPoint.y - dragCtx.startY;
    const p = clampPos(dragCtx.left + dx, dragCtx.top + dy, dragCtx.w, dragCtx.h);
    applyPos(p.x, p.y);
  }

  function onMove(e) {
    if (!dragCtx) return;
    if (!ballMoved) {
      const dx = Math.abs(e.clientX - dragCtx.startX);
      const dy = Math.abs(e.clientY - dragCtx.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      ballMoved = true;
      ball.classList.add('dragging');
    }
    pendingPoint = { x: e.clientX, y: e.clientY };
    if (rafId) return;
    rafId = requestAnimationFrame(flushMove);
  }

  function endDrag(shouldSave) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      flushMove();
      rafId = 0;
    }
    if (dragAbort) {
      dragAbort.abort();
      dragAbort = null;
    }
    const moved = ballMoved;
    dragCtx = null;
    pendingPoint = null;
    ball.classList.remove('dragging');

    if (shouldSave && moved) {
      const rect = host.getBoundingClientRect();
      savePos(rect.left, rect.top);
    }
  }

  function startDrag(e) {
    if (e.button !== 0) return;
    // 先清掉上一次可能残留的拖拽（mouseup 丢失时的兜底）
    if (dragCtx) endDrag(false);

    const rect = host.getBoundingClientRect();
    dragCtx = {
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left,
      top: rect.top,
      w: rect.width || 52,
      h: rect.height || 52
    };
    pendingPoint = { x: e.clientX, y: e.clientY };
    ballMoved = false;

    dragAbort = new AbortController();
    const { signal } = dragAbort;
    document.addEventListener('mousemove', onMove, { signal, passive: true });
    document.addEventListener('mouseup', () => endDrag(true), { signal });
    // 拖出窗口 / 切走标签页时 mouseup 可能收不到，用 blur 兜底
    window.addEventListener('blur', () => endDrag(true), { signal });
  }

  ball.addEventListener('mousedown', e => {
    e.preventDefault();
    startDrag(e);
  });

  ball.addEventListener('click', e => {
    if (ballMoved) {
      ballMoved = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    togglePanel();
  });

  head.addEventListener('mousedown', e => {
    if (e.target.closest('.wx-md-icon-btn')) return;
    e.preventDefault();
    startDrag(e);
  });

  window.addEventListener('resize', () => {
    if (!host.style.left) return;
    const rect = host.getBoundingClientRect();
    const p = clampPos(rect.left, rect.top, rect.width || 52, rect.height || 52);
    applyPos(p.x, p.y);
  }, { passive: true });

  // ---------- 交互 ----------

  pinBtn.addEventListener('click', e => {
    e.stopPropagation();
    currentPinned = !currentPinned;
    updatePinUI();
    chrome.storage.local.set({ pinned: currentPinned }).catch(() => {});
    if (currentPinned) {
      showHost();
      openPanel();
    } else {
      closePanel();
      hideHost();
    }
  });

  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    closePanel();
  });

  optCards.forEach(card => {
    card.addEventListener('click', () => {
      currentMode = card.dataset.mode;
      optCards.forEach(c => c.classList.toggle('active', c.dataset.mode === currentMode));
      updateArchiveVisibility();
      chrome.storage.local.set({ imageMode: currentMode }).catch(() => {});
    });
  });

  archiveBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentFolder = btn.dataset.folder;
      archiveBtns.forEach(b => b.classList.toggle('active', b.dataset.folder === currentFolder));
      chrome.storage.local.set({ folderMode: currentFolder }).catch(() => {});
    });
  });

  function applySettings(res) {
    currentMode = res.imageMode === 'online' ? 'online' : 'download';
    currentFolder = res.folderMode === 'shared' ? 'shared' : 'per-article';
    currentPinned = !!res.pinned;
    optCards.forEach(c => c.classList.toggle('active', c.dataset.mode === currentMode));
    archiveBtns.forEach(b => b.classList.toggle('active', b.dataset.folder === currentFolder));
    updateArchiveVisibility();
    updatePinUI();
    if (currentPinned) {
      showHost();
      openPanel();
    } else {
      hideHost();
    }
  }

  chrome.storage.local.get(DEFAULT_SETTINGS, applySettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.imageMode) {
      currentMode = changes.imageMode.newValue === 'online' ? 'online' : 'download';
      optCards.forEach(c => c.classList.toggle('active', c.dataset.mode === currentMode));
      updateArchiveVisibility();
    }
    if (changes.folderMode) {
      currentFolder = changes.folderMode.newValue === 'shared' ? 'shared' : 'per-article';
      archiveBtns.forEach(b => b.classList.toggle('active', b.dataset.folder === currentFolder));
    }
    if (changes.pinned) {
      currentPinned = !!changes.pinned.newValue;
      updatePinUI();
      if (currentPinned) {
        showHost();
        openPanel();
      } else {
        closePanel();
        hideHost();
      }
    }
  });

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    statusEl.textContent = '正在提取文章...';
    statusEl.className = 'wx-md-status';

    // 后台被浏览器强杀、或卡在某个 Promise 上不返回时，sendMessage 可能一直悬空，
    // 按钮会永久 disabled。浮窗拿不到图片数量，用一个固定的宽松上限兜底。
    let guardTimer = 0;
    const guard = new Promise((_, reject) => {
      guardTimer = setTimeout(() => {
        const e = new Error('后台长时间无响应，请先检查下载目录再重试');
        e.wxmdTimeout = true;
        reject(e);
      }, EXPORT_WATCHDOG_MS);
    });

    try {
      const resp = await Promise.race([
        chrome.runtime.sendMessage({
          type: 'EXPORT_FROM_FLOATING',
          data: { imageMode: currentMode, folderMode: currentFolder }
        }),
        guard
      ]);
      if (resp && resp.success) {
        statusEl.textContent = '导出成功！';
        statusEl.className = 'wx-md-status success';
      } else {
        statusEl.textContent = '失败：' + ((resp && resp.error) || '未知错误');
        statusEl.className = 'wx-md-status error';
      }
    } catch (err) {
      statusEl.textContent = err.wxmdTimeout
        ? '超时：' + err.message
        : '失败：' + (err.message || '请刷新页面后重试');
      statusEl.className = 'wx-md-status error';
    } finally {
      clearTimeout(guardTimer);
      exportBtn.disabled = false;
    }
  });

  optionsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (!msg) return;
    if (msg.type === 'SHOW_FLOATING') {
      showHost();
      openPanel();
    } else if (msg.type === 'HIDE_FLOATING') {
      closePanel();
      hideHost();
    } else if (msg.type === 'TOGGLE_FLOATING') {
      togglePanel();
    }
  });

  document.addEventListener('keydown', e => {
    if (typeof e.key !== 'string') return;

    const activeEl = document.activeElement;
    const isEditable = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );
    if (isEditable) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.shiftKey && !e.altKey) {
      if (host.style.display !== 'none' && panel.classList.contains('open')) {
        e.preventDefault();
        if (!exportBtn.disabled) exportBtn.click();
      }
    }
  });
})();
