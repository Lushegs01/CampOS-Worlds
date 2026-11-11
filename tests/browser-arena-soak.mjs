// Combat Arena across repeated matches without reloading the page (production QA bundle, Chromium): deploy into
// Training, play a few seconds (bots fight, sounds play), leave, and again — then leave the arena for the campus and
// come back. After each cycle (and a forced garbage collection) it records the JavaScript heap, DOM size, window
// event listeners, the arena's live sound voices and how long the deployment took, and checks that nothing
// accumulates from match to match. Results: docs/performance/arena-soak.json.
// Usage: VITE_QA=1 npx vite build --outDir dist-qa && node tests/browser-arena-soak.mjs   (CYCLES=5)
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { startProduction } from './support/production.mjs';

const ROOT = process.env.ROOT || 'dist-qa', CYCLES = Number(process.env.CYCLES || 5);
if (!existsSync(`${ROOT}/index.html`)) execSync(`npx vite build --outDir ${ROOT}`, { stdio: 'inherit', env: { ...process.env, VITE_QA: '1' } });
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || [chromium.executablePath(), '/opt/pw-browsers/chromium'].find(p => existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc'] });
const host = await startProduction({ root: ROOT, arena: { rules: { countdownMs: 800 } } });
const out = { started: new Date().toISOString(), cycles: [], renderer: 'SwiftShader (software WebGL)' };
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Soak', reducedMotion: true, volume: .6 }, version: 0 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false })); localStorage.setItem('campos-arena-qa-scale', '0.25'); });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
  const sample = async label => {
    await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(400); await cdp.send('HeapProfiler.collectGarbage');
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' }); const listeners = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
    const page_ = await page.evaluate(() => ({ voices: window.__arenaSound?.().voices ?? 0, bufferKB: Math.round((window.__arenaSound?.().bufferBytes ?? 0) / 1024) }));
    return { label, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners, jsListeners: m.JSEventListeners, ...page_ };
  };
  await page.goto(host.url + '/?qa-scale=0.2', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor();
  const openArena = async () => { await page.getByRole('button', { name: /Combat Arena/ }).click(); await page.waitForFunction(() => window.__arena?.state().status === 'ready'); };
  await openArena();
  out.cycles.push(await sample('lobby, before any match'));
  for (let i = 0; i < CYCLES; i++) {
    await page.getByRole('tab', { name: 'Training' }).click();
    await page.getByLabel('Bots').selectOption('3');
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Start training' }).click();
    await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 180000 });
    const deployMs = Date.now() - t0;
    await page.waitForTimeout(6000); // bots move and fire; sounds, effects and soldiers run
    const inMatch = await page.evaluate(() => ({ voices: window.__arenaSound().voices, gl: window.__arenaStats ? { calls: window.__arenaStats.calls, textures: window.__arenaStats.textures, geometries: window.__arenaStats.geometries } : null }));
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Leave match' }).click();
    await page.waitForFunction(() => window.__arena.state().phase === 'lobby');
    out.cycles.push({ ...(await sample(`after match ${i + 1}`)), deployMs, inMatch });
    console.log(JSON.stringify(out.cycles.at(-1)));
  }
  // Leaving the arena entirely releases its caches; coming back works and deploys again.
  await page.getByRole('button', { name: 'Return to campus' }).click();
  await page.getByRole('button', { name: /online/ }).waitFor();
  out.cycles.push(await sample('campus, after leaving the arena'));
  await openArena();
  await page.getByRole('tab', { name: 'Training' }).click();
  const t0 = Date.now(); await page.getByRole('button', { name: 'Open the firing range' }).click();
  await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 180000 });
  out.reentryDeployMs = Date.now() - t0;
  console.log(JSON.stringify(out.cycles.at(-1)), 're-entry', out.reentryDeployMs);
  // Checks: from the second match on, the heap does not keep growing, and the DOM and listeners return to the lobby's.
  const after = out.cycles.filter(c => c.label.startsWith('after match'));
  const growth = after.at(-1).heapMB - after[0].heapMB;
  out.heapGrowthMB = +growth.toFixed(1);
  assert.ok(growth < 12, `heap grew ${growth.toFixed(1)} MB from match 1 to match ${after.length}`);
  assert.ok(Math.max(...after.map(c => c.nodes)) - Math.min(...after.map(c => c.nodes)) < 400, 'DOM size stable across matches');
  assert.ok(Math.max(...after.map(c => c.listeners)) - Math.min(...after.map(c => c.listeners)) <= 2, 'window listeners do not accumulate');
  assert.ok(after.every(c => c.voices === 0), `no match sounds follow the player into the lobby (${after.map(c => c.voices)})`);
  assert.ok(out.cycles.at(-1).bufferKB === 0, 'leaving the arena released the rendered sounds');
  assert.deepEqual(errors, [], errors.join('\n'));
  await ctx.close();
} catch (e) { failed = true; console.error('✗', e.message); out.error = e.message; }
out.finished = new Date().toISOString(); out.passed = !failed;
await writeFile('docs/performance/arena-soak.json', JSON.stringify(out, null, 2));
console.log(failed ? 'FAILED' : `passed: heap growth ${out.heapGrowthMB} MB over ${CYCLES} matches`);
await browser.close(); await host.stop();
process.exit(failed ? 1 : 0);
