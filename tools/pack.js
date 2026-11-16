#!/usr/bin/env node
/**
 * tools/pack.js —— 打 crx 前先「挑出真正要发布的文件」
 *
 * 为什么需要：仓库里有 node_modules / test / .git，chrome --pack-extension
 * 会把整个目录原样打进去（3MB+ 的 crx，里面一半是 jsdom）。
 * 这个脚本只复制扩展运行必需的文件到临时目录，再对临时目录打包。
 *
 * 用法：npm run pack
 * 产物：项目根目录下的 WeChat_To_Markdown.crx（及 .pem，请自行保管）
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGE = path.join(os.tmpdir(), 'wxmd-pack');

// 只复制这些（目录则整棵复制）
const INCLUDE = ['manifest.json', 'background.js', 'content.js', 'floating.js',
  'popup.html', 'popup.js', 'options.html', 'options.js', 'lib', 'icons'];

function copyInto(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      copyInto(path.join(from, name), path.join(to, name));
    }
    return;
  }
  fs.copyFileSync(from, to);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) {
    console.error('缺少必需文件：' + item);
    process.exit(1);
  }
  copyInto(src, path.join(STAGE, item));
}

const chrome = findChrome();
if (!chrome) {
  console.log('未找到 Chrome / Edge 可执行文件。已把待打包文件整理到：\n  ' + STAGE);
  console.log('请手动执行：chrome --pack-extension="' + STAGE + '"');
  process.exit(0);
}

try {
  execFileSync(chrome, ['--pack-extension=' + STAGE, '--no-message-box'], { stdio: 'pipe' });
} catch (e) {
  // 打包成功的返回码在不同版本上不一致，以产物是否存在为准
}

const base = path.join(path.dirname(STAGE), path.basename(STAGE));
for (const ext of ['.crx', '.pem']) {
  const out = base + ext;
  if (!fs.existsSync(out)) continue;
  const target = path.join(ROOT, 'WeChat_To_Markdown' + ext);
  fs.copyFileSync(out, target);
  fs.rmSync(out, { force: true });
  console.log('已生成 ' + path.relative(ROOT, target) +
    '（' + (fs.statSync(target).size / 1024 / 1024).toFixed(2) + ' MB）');
}
