// Repeatable phone-viewport benchmark. This is browser emulation, never a phone measurement.
//   TEST_URL=http://127.0.0.1:4173 PERF_LABEL=after node tests/browser-mobile-performance.mjs
// Options: PERF_BOTS=n      n simulated players walking near the spawn (needs the room behind TEST_URL)
//          PERF_SECONDS=s   seconds per sample (default 8)
//          PERF_OUT=path    report path (default docs/mobile-performance-<label>.json)
//          ASSERT_MOBILE_OPTIMIZED=1  production checks: Low skips high-detail downloads, versioned decoder
//          PERF_QUERY=?qa-npcs=0      appended to the page address (QA builds: e.g. leave the campus characters out)
// Without a GPU (Linux containers) Chromium renders with SwiftShader, so frame times there measure a CPU
// rasterizer: compare runs made on the same machine only. Draw calls, triangles, textures, transfer size
// and main-thread script time do not depend on the GPU.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { launch, gpu } from './support/browser.mjs';

const label = process.env.PERF_LABEL || 'after', base = process.env.TEST_URL || 'http://localhost:5173';
const seconds = Number(process.env.PERF_SECONDS) || 8, botCount = Number(process.env.PERF_BOTS) || 0;
const out = process.env.PERF_OUT || `docs/mobile-performance-${label}.json`, query = process.env.PERF_QUERY || '';
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
// A fresh profile on a phone starts on Low; make that explicit so runs are comparable.
await context.addInitScript(() => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Benchmark' }, version: 0 })); });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
page.setDefaultTimeout(180000);

/** Simulated players: real room clients that walk in circles near the spawn, as other people would. */
async function startBots(n) {
  const url = base.replace(/^http/, 'ws') + '/ws', origin = new URL(base).origin, bots = [];
  for (let i = 0; i < n; i++) {
    const ws = new WebSocket(url, { origin });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    ws.send(JSON.stringify({ type: 'join', name: `Bot ${i + 1}`, avatar: { model: ['tunde', 'amara', 'chidi', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada'][i % 8], accessory: ['backpack', 'headphones', 'glasses', 'none'][i % 4] } }));
    bots.push(ws);
  }
  const t0 = Date.now(), timer = setInterval(() => bots.forEach((ws, i) => {
    if (ws.readyState !== 1) return;
    const a = (Date.now() - t0) / 2600 + i * 2 * Math.PI / n;
    ws.send(JSON.stringify({ type: 'input', dx: Math.cos(a), dz: -Math.sin(a), yaw: Math.atan2(Math.cos(a), -Math.sin(a)), sprint: false, jump: false }));
  }), 100);
  return { stop: () => { clearInterval(timer); bots.forEach(ws => ws.close()); } };
}

const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async session => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const sample = name => sampleOn(page, cdp, name);
async function sampleOn(page, cdp, name) {
  const before = await metrics(cdp);
  const result = await page.evaluate(duration => new Promise(resolve => {
    const times = [], start = performance.now(); let last = start;
    function frame(now) {
      times.push(now - last); last = now;
      if (now - start < duration * 1000) return requestAnimationFrame(frame);
      const sorted = [...times].sort((a, b) => a - b), at = q => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1);
      const canvas = document.querySelector('canvas'), mem = performance.memory;
      resolve({ frames: times.length, fps: +(times.length * 1000 / (now - start)).toFixed(1), p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: +sorted[sorted.length - 1].toFixed(1),
        longFrames: times.filter(t => t > 50).length, longFrameMs: Math.round(times.filter(t => t > 50).reduce((a, b) => a + b, 0)),
        telemetry: window.__campus ?? null, dpr: +(canvas.width / canvas.clientWidth).toFixed(2), heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null });
    }
    requestAnimationFrame(frame);
  }), seconds);
  const after = await metrics(cdp), span = after.Timestamp - before.Timestamp;
  result.mainThread = { scriptMsPerSec: +((after.ScriptDuration - before.ScriptDuration) * 1000 / span).toFixed(1), taskMsPerSec: +((after.TaskDuration - before.TaskDuration) * 1000 / span).toFixed(1), layoutsPerSec: +((after.LayoutCount - before.LayoutCount) / span).toFixed(1), recalcStylesPerSec: +((after.RecalcStyleCount - before.RecalcStyleCount) / span).toFixed(1) };
  console.log(name, JSON.stringify(result)); return { name, ...result };
}
/** Hold the touch joystick in a direction for the whole sample while the camera turns (touch look). */
async function walkAndTurn(name) {
  const stick = await page.getByRole('group', { name: 'Movement joystick' }).boundingBox(), look = await page.locator('.touch-look').boundingBox();
  const sx = stick.x + stick.width / 2, sy = stick.y + stick.height / 2, lx = look.x + look.width / 2, ly = look.y + look.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 30, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy - 30, id: 1 }, { x: lx, y: ly, id: 2 }] });
  let turning = true; const turn = (async () => { for (let k = 0; turning; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 30, id: 1 }, { x: lx + Math.sin(k / 6) * 60, y: ly, id: 2 }] }); await new Promise(r => setTimeout(r, 50)); } })();
  try { return await sample(name); } finally { turning = false; await turn; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
}

let bots = null;
try {
  await page.goto(base + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 300000 });
  const readyMs = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  if (botCount) bots = await startBots(botCount);
  await page.waitForTimeout(10000);
  const renderer = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  const samples = [await sample('entry'), await walkAndTurn('walk-and-turn'), await sample('after-walk')];
  const scene = await page.evaluate(() => window.__campusStats?.() ?? null);
  await mkdir('docs/screenshots/performance', { recursive: true });
  await page.screenshot({ path: `docs/screenshots/performance/mobile-${label}.png` });
  const resources = await page.evaluate(() => { const r = performance.getEntriesByType('resource'), characters = r.filter(x => /\/characters\/[^/]+\.glb/.test(x.name)); return { requests: r.length, transferredBytes: r.reduce((n, x) => n + x.transferSize, 0), decodedBytes: r.reduce((n, x) => n + x.decodedBodySize, 0), characterModels: characters.map(x => x.name.replace(/^.*\/characters\//, '').replace(/\?.*$/, '')), characterBytes: characters.reduce((n, x) => n + x.decodedBodySize, 0) }; });
  if (process.env.ASSERT_MOBILE_OPTIMIZED === '1') {
    const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name));
    assert.ok(!urls.some(u => /textures\/[^/]+\/(normal|arm)\.ktx2|\/PostFX-/.test(u)), 'Low fetched high-detail maps or post-processing');
    assert.ok(urls.some(u => /basis_transcoder\.wasm\?v=/.test(u)), 'Decoder cache URL is not versioned');
    console.log('PASS production mobile downloads and versioned decoder');
  }
  // QA builds (VITE_QA=1 or development) also sample the interiors and the court, offline: teleporting
  // while connected would be corrected back by the room.
  if (await page.evaluate(() => !!window.__campusDebug)) {
    bots?.stop(); bots = null; await page.close();
    const offline = await context.newPage(); offline.setDefaultTimeout(180000); offline.on('pageerror', e => errors.push(e.message));
    await offline.addInitScript(() => { const Real = window.WebSocket; window.WebSocket = function (url, p) { if (!String(url).endsWith('/ws')) return new Real(url, p); const fake = { readyState: 3, send() {}, close() {} }; setTimeout(() => fake.onclose?.({ code: 1006 }), 0); return fake; }; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3 }); });
    await offline.goto(base + query, { waitUntil: 'domcontentloaded' });
    await offline.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 300000 });
    await offline.getByRole('button', { name: 'Enter campus', exact: true }).click(); await offline.waitForTimeout(8000);
    const cdpOffline = await context.newCDPSession(offline); await cdpOffline.send('Performance.enable');
    for (const [name, at] of [['library', [-30, -14, 0]], ['cafe', [30, -8, 0]], ['court', [44, 20, 0]]]) {
      await offline.evaluate(p => window.__campusDebug.teleport(...p), at); await offline.waitForTimeout(5000);
      samples.push(await sampleOn(offline, cdpOffline, name));
    }
  }
  const report = { date: new Date().toISOString(), label, url: base, browser: browser.version(), renderer, hardwareGpu: gpu, viewport: { width: 390, height: 844, deviceScaleFactor: 3 }, bots: botCount, secondsPerSample: seconds,
    environment: gpu ? 'Desktop Chrome, mobile viewport and touch emulation; no CPU or network throttling. Not a phone measurement.' : 'Linux container without a GPU: Chromium with SwiftShader (software WebGL), mobile viewport and touch emulation. Frame times measure a CPU rasterizer; not a phone measurement.',
    query, readyMs: Math.round(readyMs), resources, samples, scene, errors };
  await mkdir(out.replace(/\/[^/]+$/, ''), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { bots?.stop(); await browser.close(); }
