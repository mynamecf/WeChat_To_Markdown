#!/usr/bin/env node
/**
 * tools/build.js —— 生成「Chromium 全系」通用安装包
 *
 * 为什么需要：npm run pack 出的是 crx（给本机双击安装用），
 * 而 Chrome Web Store / Edge Add-ons / Opera Add-ons 都只收 zip。
 * 同一份代码在 Chromium 内核的浏览器里行为一致，所以只需要一个产物。
 *
 * 用法：npm run build
 * 产物：dist/chromium/                  干净的扩展目录（离线安装：加载已解压的扩展程序）
 *      dist/wxmd-<version>.zip         商店上传 / 分发用
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'chromium');

// 只打扩展运行必需的文件；version.json / test / tools / node_modules 都不能进包
const INCLUDE = ['manifest.json', 'background.js', 'content.js', 'floating.js',
  'popup.html', 'popup.js', 'options.html', 'options.js', 'lib', 'icons'];

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

// ---------- 收集文件 ----------

function collect(dir, prefix, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) collect(abs, rel, out);
    else out.push({ name: rel, data: fs.readFileSync(abs), date: st.mtime });
  }
  return out;
}

// ---------- 最小 zip 写入器（store 上传只接受 zip，Node 没有内置实现） ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosStamp(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosStamp(e.date || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);   // 文件名按 UTF-8 解释
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------- 主流程 ----------

// 先做几项装包前的守卫：这几处配错，装到别的浏览器里就是「装上没反应」
const manifestPath = path.join(ROOT, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('缺少 manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) fail('manifest_version 必须是 3');
if (!manifest.version) fail('manifest 里没有 version');
if (!manifest.background || !manifest.background.service_worker) fail('缺少 background.service_worker');
if (!manifest.minimum_chrome_version) {
  console.warn('! 未声明 minimum_chrome_version，旧内核（<100）装上去会静默报错');
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) fail('缺少必需文件：' + item);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    collect(src, item, []).forEach(e => {
      const to = path.join(STAGE, e.name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, e.data);
    });
  } else {
    fs.copyFileSync(src, path.join(STAGE, item));
  }
}

const entries = collect(STAGE, '', []);
if (!entries.length) fail('暂存目录为空');

const zipName = 'wxmd-' + manifest.version + '-chromium.zip';
const zipPath = path.join(DIST, zipName);
fs.writeFileSync(zipPath, makeZip(entries));

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('✓ 扩展目录：' + path.relative(ROOT, STAGE) + '（' + entries.length + ' 个文件）');
console.log('✓ 商店安装包：' + path.relative(ROOT, zipPath) + '（' + kb(fs.statSync(zipPath).size) + '）');

// ---------- 发布前自检：占位符没改会直接影响更新检查 ----------

const defaults = fs.readFileSync(path.join(ROOT, 'lib', 'defaults.js'), 'utf8');
const updateSrc = fs.readFileSync(path.join(ROOT, 'lib', 'update.js'), 'utf8');
if (/yourname/.test(defaults) || /yourname/.test(updateSrc)) {
  console.log('! 仍在使用占位地址（yourname）：官网/反馈/version.json 都要换成真实地址才能发布');
}

console.log('');
console.log('安装方式：');
console.log('  Chrome / Edge / 360 / QQ：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 dist/chromium');
console.log('  商店提交：上传 ' + zipName + '（Chrome Web Store / Edge Add-ons / Opera Add-ons 通用）');
