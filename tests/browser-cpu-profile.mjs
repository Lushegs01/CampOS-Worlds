// Main-thread cost per frame on a phone viewport (390 × 844, Low, touch): enter the campus, walk with the
// joystick for 10 s under the CPU profiler, and report script time per frame and the most expensive functions.
// Software WebGL frame rates mean nothing; script time per frame and its breakdown are comparable run to run.
// Usage: TEST_URL=http://127.0.0.1:4173 node tests/browser-cpu-profile.mjs   (a `VITE_QA=1` build, see docs/MOBILE-PERFORMANCE.md)
import { writeFile } from 'node:fs/promises';
import { launch, QUERY } from './support/browser.mjs';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
// Isolated local gameplay: no QA movement enters a shared room.
await ctx.addInitScript(() => { const Real = window.WebSocket; window.WebSocket = function (url, p) { if (!String(url).endsWith('/ws')) return new Real(url, p); const fake = { readyState: 3, send() {}, close() {} }; setTimeout(() => fake.onclose?.({ code: 1006 }), 0); return fake; }; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3 }); });
const page = await ctx.newPage(); page.setDefaultTimeout(180000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5173') + (QUERY || '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.waitForTimeout(8000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const script = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'ScriptDuration').value;
  const box = await page.getByRole('group', { name: 'Movement joystick' }).boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  const s0 = await script(); await cdp.send('Profiler.start');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 33, id: 1 }] });
  const frames = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 10000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const { profile } = await cdp.send('Profiler.stop'), s1 = await script();
  const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map();
  profile.samples.forEach((id, i) => { const f = byId.get(id).callFrame, k = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + profile.timeDeltas[i] / 1000); });
  const top = [...self].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms]) => `${ms.toFixed(1).padStart(7)} ms  ${k}`);
  const report = { date: new Date().toISOString(), label: process.env.PERF_LABEL || '', frames, scriptMsPerFrame: +((s1 - s0) * 1000 / frames).toFixed(2), campus: await page.evaluate(() => window.__campus), errors, top };
  if (process.env.PERF_OUT) await writeFile(process.env.PERF_OUT, JSON.stringify(report, null, 2));
  console.log(`${frames} frames, ${report.scriptMsPerFrame} ms of script per frame`); console.log(top.join('\n'));
} finally { await browser.close(); }
