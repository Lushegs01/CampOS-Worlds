// Combat Arena deployment benchmark: how long from pressing "Start training" until the player can actually
// play, on a real production bundle (built with the QA inspection hooks) served exactly like production, with
// the room server and its arena. Each run is a fresh browser context (empty HTTP cache), so every asset is
// downloaded as a first-time player would.
//
// Scenarios (SCENARIOS="name:runs,..."):
//   normal         no throttling (loopback)
//   4g             9 Mbit/s down, 70 ms latency (Chrome DevTools-style emulation, applied after the lobby is ready)
//   3g             1.6 Mbit/s down, 300 ms latency
//   abort-texture  one environment normal map fails to download (connection error): optional, falls back
//   abort-essential one environment colour map fails: the deployment must stop with a reason and Retry; the file
//                  then becomes available again and Retry must reach a playable match
//   stall-prop     one decorative prop model never answers (request hangs)
//   stall-soldier  one soldier model never answers
//   drop-ws        the arena WebSocket is closed by the server while deploying
//   repeat         three consecutive deployments in one page (leave → deploy again), timings for each
//
// A run that has not become playable after STUCK_MS (default 120 s) is recorded as stuck.
// Usage: VITE_QA=1 npx vite build --outDir dist-qa && ROOT=dist-qa LABEL=after node scripts/qa/arena-deploy.mjs
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { startProduction } from '../../tests/support/production.mjs';

const ROOT = process.env.ROOT || 'dist-qa', LABEL = process.env.LABEL || 'run', STUCK_MS = Number(process.env.STUCK_MS || 120000);
const OUT = process.env.OUT || `docs/performance/arena-deploy-${LABEL}.json`;
const SCENARIOS = (process.env.SCENARIOS || 'normal:5,4g:2,3g:1,abort-texture:1,abort-essential:1,stall-prop:1,stall-soldier:1,drop-ws:1,repeat:1').split(',').map(s => { const [name, n] = s.split(':'); return { name, runs: Number(n || 1) }; });
const NET = { '4g': { latency: 70, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 }, '3g': { latency: 300, downloadThroughput: 1.6e6 / 8, uploadThroughput: .75e6 / 8 } };
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || [chromium.executablePath(), '/opt/pw-browsers/chromium'].find(p => existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const host = await startProduction({ root: ROOT, arena: { rules: { countdownMs: 1500 } } });
const results = { label: LABEL, root: ROOT, started: new Date().toISOString(), renderer: 'SwiftShader (software WebGL, no GPU)', stuckMs: STUCK_MS, runs: [], summary: {} };

const OVERLAY = '.ar-scene-loading, [data-deploy-overlay]';
async function lobby(ctx) {
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const logs = []; page.on('console', m => { const t = m.text(); if (/\[arena-deploy\]|error/i.test(t)) logs.push(t.slice(0, 400)); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto(host.url + '/?qa-scale=0.2', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready', null, { timeout: 90000 });
  return { page, logs };
}
/** Press Start training (3 easy bots on Foundry Yard) and time each step until the player can move. */
async function deploy(page, cdp) {
  const bytes = { n: 0, b: 0 }, onDone = e => { bytes.n++; bytes.b += e.encodedDataLength || 0; };
  cdp.on('Network.loadingFinished', onDone);
  await page.getByRole('tab', { name: /Training/ }).click();
  await page.getByLabel('Bots').selectOption('3'); await page.getByLabel('Difficulty').selectOption('easy');
  const t0 = Date.now(), marks = {}; page.__t0?.(t0);
  await page.getByRole('button', { name: /Start training/ }).click();
  const deadline = t0 + STUCK_MS;
  let stuck = false, last = null;
  while (true) {
    const s = await page.evaluate(sel => ({ phase: window.__arena?.state().phase, overlay: !!document.querySelector(sel), self: window.__arena?.self?.() ?? null, deploy: window.__arenaDeploy?.() ?? null, dbg: (() => { try { const d = window.__arenaDebug?.(); return d && { lib: d.lib, kits: d.kits, gun: !!d.vm?.gun, arms: d.vm?.arms }; } catch { return null; } })(), text: document.querySelector(sel)?.textContent?.slice(0, 160) ?? '' }), OVERLAY).catch(() => null);
    const t = Date.now() - t0; last = s;
    if (s) {
      if (s.phase === 'match' && marks.match == null) marks.match = t;
      for (const k of ['lib', 'kits', 'gun', 'arms']) if (s.dbg?.[k] && marks[k] == null) marks[k] = t;
      if (s.phase === 'match' && !s.overlay && marks.ready == null) marks.ready = t;
      if (marks.ready != null && s.self?.alive && marks.playable == null) {
        // Playable = the player's own simulation moves when they press forward.
        const before = s.self; await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
        const after = await page.evaluate(() => window.__arena.self());
        if (after && Math.hypot(after.x - before.x, after.z - before.z) > .05) marks.playable = Date.now() - t0;
      }
      if (marks.playable != null) break;
    }
    if (Date.now() > deadline) { stuck = true; break; }
    await page.waitForTimeout(100);
  }
  cdp.off('Network.loadingFinished', onDone);
  return { ...marks, stuck, bytes: bytes.b, requests: bytes.n, lastOverlay: last?.text ?? '', deploy: last?.deploy ?? null };
}

for (const sc of SCENARIOS) for (let i = 0; i < sc.runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Bench', reducedMotion: true }, version: 0 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false })); localStorage.setItem('campos-arena-qa-scale', '0.25'); });
  const run = { scenario: sc.name, i };
  try {
    const { page, logs } = await lobby(ctx);
    const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
    page.__t0 = t => { run.t0 = t; };
    if (NET[sc.name]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET[sc.name] });
    if (sc.name === 'abort-texture') await ctx.route('**/textures/brick/normal.ktx2*', r => r.abort('failed'));
    if (sc.name === 'stall-prop') await ctx.route('**/props/generator.glb*', () => { /* never answers */ });
    if (sc.name === 'stall-soldier') await ctx.route('**/characters/soldier-m2.glb*', () => { /* never answers */ });
    if (sc.name === 'abort-essential') {
      await ctx.route('**/textures/brick/color.ktx2*', r => r.abort('failed'));
      // When the failure screen appears, make the file available again and press Retry.
      run.recovery = page.waitForSelector('[data-deploy-overlay][data-stage="failed"]', { timeout: STUCK_MS }).then(async () => {
        run.failedAt = Date.now() - run.t0; run.failureText = (await page.locator('.ar-deploy-error').textContent().catch(() => '')).slice(0, 200);
        await ctx.unroute('**/textures/brick/color.ktx2*'); await page.getByRole('button', { name: 'Retry' }).click(); run.retriedAt = Date.now() - run.t0;
      }).catch(e => { run.recoveryError = String(e.message).slice(0, 120); });
    }
    if (sc.name === 'drop-ws') setTimeout(() => { for (const c of host.room.arena.connections.values()) c.ws.terminate(); }, 400);
    if (sc.name === 'repeat') {
      run.attempts = [];
      for (let k = 0; k < 3; k++) {
        const r = await deploy(page, cdp); run.attempts.push(r);
        if (r.stuck) break;
        await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Leave match' }).click();
        await page.waitForFunction(() => window.__arena?.state().phase === 'lobby');
      }
      Object.assign(run, run.attempts.at(-1));
    } else Object.assign(run, await deploy(page, cdp));
    if (run.recovery) { await run.recovery; delete run.recovery; }
    run.logs = logs.slice(-40);
  } catch (e) { run.error = String(e?.message ?? e).slice(0, 300); run.stuck = true; }
  results.runs.push(run);
  console.log(JSON.stringify({ scenario: run.scenario, i, failedAt: run.failedAt, failure: run.failureText, retriedAt: run.retriedAt, lib: run.lib, kits: run.kits, gun: run.gun, arms: run.arms, match: run.match, ready: run.ready, playable: run.playable, stuck: run.stuck, MB: run.bytes ? +(run.bytes / 1e6).toFixed(1) : null, requests: run.requests, attempts: run.attempts?.map(a => a.playable ?? 'stuck'), overlay: run.lastOverlay, error: run.error }));
  await ctx.close();
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : null; };
for (const name of new Set(results.runs.map(r => r.scenario))) {
  const rs = results.runs.filter(r => r.scenario === name), ok = rs.filter(r => !r.stuck).map(r => r.playable);
  results.summary[name] = { runs: rs.length, stuck: rs.length - ok.length, p50: pct(ok, 50), p95: pct(ok, 95), p99: pct(ok, 99), meanMB: +(rs.reduce((a, r) => a + (r.bytes || 0), 0) / rs.length / 1e6).toFixed(1) };
}
results.finished = new Date().toISOString();
await mkdir('docs/performance', { recursive: true }); await writeFile(OUT, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.summary, null, 2));
await browser.close(); await host.stop();
process.exit(0);
