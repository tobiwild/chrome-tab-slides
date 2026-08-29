const button = document.getElementById('capture');
const status = document.getElementById('status');

const targetWindowId = Number(new URLSearchParams(location.search).get('windowId'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function whenLoaded(tabId) {
  for (let i = 0; i < 50; i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(100);
  }
}

function slideFilename(index, hostname) {
  const safe = (hostname || '').toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'slide';
  return `${String(index).padStart(2, '0')}-${safe}.png`;
}

function pngBytes(dataUrl) {
  return Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
}

function localIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const entries = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const header = new Uint8Array(30);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(12, 0x21, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    chunks.push(header, nameBytes, data);
    entries.push({ nameBytes, crc, offset, size: data.length });
    offset += header.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const centralChunks = [];
  for (const e of entries) {
    const cd = new Uint8Array(46);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(14, 0x21, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.size, true);
    dv.setUint32(24, e.size, true);
    dv.setUint16(28, e.nameBytes.length, true);
    dv.setUint32(42, e.offset, true);
    centralChunks.push(cd, e.nameBytes);
  }

  const centralSize = centralChunks.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralOffset, true);

  const parts = [...chunks, ...centralChunks, eocd];
  const total = parts.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

async function captureAll() {
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const slides = [];
  const pngs = [];
  let index = 0;

  for (const tab of tabs) {
    let url;
    try {
      url = new URL(tab.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

    let dataUrl;
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await whenLoaded(tab.id);
      await sleep(300);
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch {
      continue;
    }

    index += 1;
    const image = slideFilename(index, url.hostname);
    pngs.push({ name: image, data: pngBytes(dataUrl) });
    slides.push({ index, title: tab.title || url.hostname, url: tab.url, image });
  }

  const manifest = { date: localIso(new Date()), slides };
  pngs.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return { files: pngs, count: index };
}

function zipName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `slides-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
}

function downloadZip(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Capturing tabs...';
  try {
    const { files, count } = await captureAll();
    downloadZip(buildZip(files), zipName());
    status.textContent = `Downloaded ${count} slide(s) + manifest.json as slides.zip.`;
  } catch (error) {
    status.textContent = `Failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

