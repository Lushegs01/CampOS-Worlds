// Long-session check: players keep joining and leaving around you while you walk. GPU textures and
// geometries and the JS heap are sampled; they should level off rather than climb with every visitor.
//   TEST_URL=http://127.0.0.1:4173 SOAK_SECONDS=300 SOAK_LABEL=after node tests/browser-soak.mjs
// SOAK_ASSERT=1 fails the run when GPU textures keep growing after the warm-up (2 minutes: a character's
// textures are uploaded the first time it is drawn, and players behind the camera are not drawn, so the
// working set of eight characters takes a while to fill; a leak keeps adding about one per visitor).
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { launch } from './support/browser.mjs';

const base = process.env.TEST_URL || 'http://localhost:5173', seconds = Number(process.env.SOAK_SECONDS) || 300, label = process.env.SOAK_LABEL || 'after';
const browser = await launch(), errors = [];
const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
await context.addInitScript(() => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Soak' }, version: 0 })); });
const page = await context.newPage(); page.setDefaultTimeout(180000);
page.on('pageerror', e => errors.push(e.message));
const MODELS = ['tunde', 'amara', 'chidi', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada'], bots = new Set();
async function bot(n) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { origin: new URL(base).origin });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  ws.send(JSON.stringify({ type: 'join', name: `Visitor ${n}`, avatar: { model: MODELS[n % 8], accessory: ['backpack', 'headphones', 'glasses', 'none'][n % 4] } }));
  const t0 = Date.now(), timer = setInterval(() => { const a = (Date.now() - t0) / 2000 + n; ws.send(JSON.stringify({ type: 'input', dx: Math.cos(a), dz: -Math.sin(a), yaw: 0, sprint: false, jump: false })); }, 100);
  const b = { ws, stop: () => { clearInterval(timer); ws.terminate(); bots.delete(b); } }; bots.add(b); return b;
}
const series = [];
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 300000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor();
  let n = 0; const queue = [];
  for (let i = 0; i < 6; i++) queue.push(await bot(n++));
  const start = Date.now(); let lastSample = -1e9, lastChurn = Date.now(), key = 'KeyW';
  await page.keyboard.down(key);
  while (Date.now() - start < seconds * 1000) {
    // Every 8 s one visitor leaves and a new one arrives (a different character each time); the player turns round.
    if (Date.now() - lastChurn > 8000) { lastChurn = Date.now(); queue.shift()?.stop(); queue.push(await bot(n++)); await page.keyboard.up(key); key = key === 'KeyW' ? 'KeyS' : 'KeyW'; await page.keyboard.down(key); }
    if (Date.now() - lastSample > 15000) {
      lastSample = Date.now();
      const s = await page.evaluate(() => ({ textures: window.__campus?.textures, geometries: window.__campus?.geometries, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, peers: window.__campus?.peers?.length }));
      series.push({ t: Math.round((Date.now() - start) / 1000), visitorsSoFar: n, ...s }); console.log(JSON.stringify(series.at(-1)));
    }
    await page.waitForTimeout(500);
  }
  await page.keyboard.up(key);
  const warm = series.find(s => s.t >= 120) ?? series[0], end = series.at(-1);
  const report = { date: new Date().toISOString(), label, url: base, seconds, visitors: n, environment: 'Linux container, Chromium with SwiftShader (software WebGL), Low quality, 800x600. Not a phone.', series, growthAfterWarmup: { textures: end.textures - warm.textures, geometries: end.geometries - warm.geometries, heapMB: +(end.heapMB - warm.heapMB).toFixed(1) }, errors };
  await writeFile(`docs/performance/soak-${label}.json`, JSON.stringify(report, null, 2));
  console.log('growth after warm-up', JSON.stringify(report.growthAfterWarmup));
  if (process.env.SOAK_ASSERT === '1') assert.ok(report.growthAfterWarmup.textures <= 8, `GPU textures kept growing: +${report.growthAfterWarmup.textures}`);
  assert.deepEqual(errors, []);
} finally { for (const b of [...bots]) b.stop(); await browser.close(); }
