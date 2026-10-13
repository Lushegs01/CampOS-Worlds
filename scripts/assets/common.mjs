// Shared helpers for the offline asset pipeline. Raw downloads live in
// .asset-cache/ (git-ignored); optimized runtime assets are written to public/assets/.
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE = path.join(ROOT, '.asset-cache');
export const OUT = path.join(ROOT, 'public', 'assets');

export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }

/** Download once into the cache. Every source URL is recorded for the licence ledger. */
export async function fetchCached(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  ensureDir(path.dirname(dest));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      fs.writeFileSync(dest + '.part', Buffer.from(await res.arrayBuffer()));
      fs.renameSync(dest + '.part', dest);
      return dest;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

export async function fetchJson(url, dest) { return JSON.parse(fs.readFileSync(await fetchCached(url, dest), 'utf8')); }

/** Minimal uncompressed / RLE TGA decoder (Rocketbox ships 24/32-bit TGAs). */
export function decodeTGA(buf) {
  const idLength = buf[0], imageType = buf[2], width = buf.readUInt16LE(12), height = buf.readUInt16LE(14), bpp = buf[16], descriptor = buf[17];
  const bytes = bpp / 8, topOrigin = (descriptor & 0x20) !== 0, out = new Uint8Array(width * height * 4);
  let p = 18 + idLength, i = 0;
  const put = (o) => { const b = buf[o], g = buf[o + 1], r = buf[o + 2], a = bytes === 4 ? buf[o + 3] : 255; out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a; i++; };
  if (imageType === 2) { for (let n = 0; n < width * height; n++) { put(p); p += bytes; } }
  else if (imageType === 10) {
    while (i < width * height) { const h = buf[p++], count = (h & 127) + 1; if (h & 128) { for (let k = 0; k < count; k++) put(p); p += bytes; } else { for (let k = 0; k < count; k++) { put(p); p += bytes; } } }
  } else throw new Error('Unsupported TGA type ' + imageType);
  if (!topOrigin) { const row = width * 4, tmp = new Uint8Array(row); for (let y = 0; y < height / 2; y++) { const a = y * row, b = (height - 1 - y) * row; tmp.set(out.subarray(a, a + row)); out.copyWithin(a, b, b + row); out.set(tmp, b); } }
  return { width, height, data: out };
}

/** Radiance .hdr (RGBE, RLE) decoder → Float32 RGB. */
export function decodeHDR(buf) {
  let p = 0; const line = () => { let s = ''; while (buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
  let l; while ((l = line()) !== '') { /* header */ }
  const [, hs, , ws] = line().trim().split(/\s+/); const height = +hs, width = +ws;
  const out = new Float32Array(width * height * 3), scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2) {
      p += 4;
      for (let c = 0; c < 4; c++) { let x = 0; while (x < width) { let n = buf[p++]; if (n > 128) { n -= 128; const v = buf[p++]; while (n--) scan[(x++) * 4 + c] = v; } else { while (n--) scan[(x++) * 4 + c] = buf[p++]; } } }
    } else { for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) scan[x * 4 + c] = buf[p++]; }
    for (let x = 0; x < width; x++) { const e = scan[x * 4 + 3], f = e ? Math.pow(2, e - 136) : 0, o = (y * width + x) * 3; out[o] = scan[x * 4] * f; out[o + 1] = scan[x * 4 + 1] * f; out[o + 2] = scan[x * 4 + 2] * f; }
  }
  return { width, height, data: out };
}

/** RGBE encoder with per-channel RLE scanlines (what THREE.HDRLoader expects). */
export function encodeHDR({ width, height, data }) {
  const chunks = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'ascii')];
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3, r = data[o], g = data[o + 1], b = data[o + 2], m = Math.max(r, g, b);
      if (m < 1e-32) { scan.fill(0, x * 4, x * 4 + 4); continue; }
      const e = Math.ceil(Math.log2(m)), s = 256 / Math.pow(2, e);
      scan[x * 4] = Math.min(255, r * s); scan[x * 4 + 1] = Math.min(255, g * s); scan[x * 4 + 2] = Math.min(255, b * s); scan[x * 4 + 3] = e + 128;
    }
    const row = [2, 2, width >> 8, width & 255];
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < width) {
        let run = 1; while (x + run < width && run < 127 && scan[(x + run) * 4 + c] === scan[x * 4 + c]) run++;
        if (run >= 3) { row.push(128 + run, scan[x * 4 + c]); x += run; continue; }
        let n = 0; const start = x; while (x < width && n < 128) { let r2 = 1; while (x + r2 < width && r2 < 3 && scan[(x + r2) * 4 + c] === scan[x * 4 + c]) r2++; if (r2 >= 3) break; x++; n++; }
        row.push(n); for (let k = 0; k < n; k++) row.push(scan[(start + k) * 4 + c]);
      }
    }
    chunks.push(Buffer.from(row));
  }
  return Buffer.concat(chunks);
}

/** Run KTX2 encodes on a worker pool (the Basis encoder is single-threaded WASM). */
export async function encodeKTX2Batch(jobs, threads = Math.max(2, os.cpus().length - 1)) {
  const worker = new URL('./ktx2-worker.mjs', import.meta.url);
  const queue = jobs.filter(j => j.force || !fs.existsSync(j.out));
  let index = 0, done = 0;
  const run = () => new Promise((resolve, reject) => {
    const w = new Worker(worker);
    const next = () => { if (index >= queue.length) { w.terminate(); resolve(); return; } const job = queue[index++]; w.postMessage(job); };
    w.on('message', (m) => { if (m.error) { reject(new Error(m.error)); return; } done++; process.stdout.write(`\r  ktx2 ${done}/${queue.length}   `); next(); });
    w.on('error', reject); next();
  });
  await Promise.all(Array.from({ length: Math.min(threads, queue.length) }, run));
  if (queue.length) process.stdout.write('\n');
}

export function writeJSON(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
export function kb(file) { return (fs.statSync(file).size / 1024).toFixed(0) + ' KB'; }
