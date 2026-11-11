// Combat Arena audio in a real browser (Chromium, Web Audio running headless), on the production bundle built with
// the QA hooks, as a phone (touch, Low profile: 20 voices, plain stereo panning):
//   * the player's own gunfire, reload and footsteps sound through the real game path (touch fire, the sim's events);
//   * a sustained 12-shooter firefight with explosions and impacts never clips the output (limiter), stays within the
//     voice budget (low-priority sounds give way), and each sound call is cheap;
//   * distance: near shots use the near layer and are louder; far shots only the distant layer;
//   * occlusion and roofs are detected from the collision world;
//   * category volumes apply (weapons at 0 → silence), and a suspended context recovers on the next touch.
// Results: docs/arena-audio-results.json. Usage: VITE_QA=1 npx vite build --outDir dist-qa && node tests/browser-arena-audio.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { startProduction } from './support/production.mjs';

const ROOT = process.env.ROOT || 'dist-qa';
if (!existsSync(`${ROOT}/index.html`)) execSync(`npx vite build --outDir ${ROOT}`, { stdio: 'inherit', env: { ...process.env, VITE_QA: '1' } });
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || [chromium.executablePath(), '/opt/pw-browsers/chromium'].find(p => existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const host = await startProduction({ root: ROOT, arena: { rules: { countdownMs: 1000 } } });
const results = { started: new Date().toISOString(), checks: [] }, errors = [];
const check = (name, detail = '') => { results.checks.push({ name, ok: true, detail }); console.log('✓', name, detail); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Ears', reducedMotion: true, volume: .8 }, version: 0 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false })); localStorage.setItem('campos-arena-qa-scale', '0.25'); });
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(host.url + '/?qa-scale=0.2', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).tap();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: /Combat Arena/ }).tap();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready', null, { timeout: 90000 });
  await page.getByRole('tab', { name: /Training/ }).tap();
  await page.getByRole('button', { name: /Open the firing range/ }).tap();
  await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 120000 });
  await page.waitForFunction(() => window.__arena.self()?.alive, null, { timeout: 30000 });
  const s0 = await page.evaluate(() => window.__arenaSound());
  assert.equal(s0.state, 'running'); assert.equal(s0.max, 20, 'phone voice budget'); assert.equal(s0.hrtf, false);
  check('phone profile: audio running with a 20-voice budget and stereo panning; the loadout’s sounds were rendered ahead of play', `${s0.rendered} sounds pre-rendered in ${s0.renderMs.toFixed(0)} ms`);

  // ---------------------------------------------------------------- the game's own path: fire, reload, footsteps
  const fire = await page.getByRole('button', { name: 'Fire', exact: true }).boundingBox();
  const ammo0 = (await page.evaluate(() => window.__arena.self())).ammo;
  for (let i = 0; i < 4; i++) { await page.touchscreen.tap(fire.x + fire.width / 2, fire.y + fire.height / 2); await sleep(150); }
  await page.waitForFunction(a => window.__arena.self().ammo < a, ammo0, { timeout: 10000 });
  let recent = (await page.evaluate(() => window.__arenaSound().recent)).join(' ');
  assert.match(recent, /gun:vanguard:near:\d@weapons/); assert.match(recent, /gun:vanguard:tail:\d@weapons/);
  check('own gunfire through the game: the Vanguard’s own near and tail layers play on the weapons bus');
  await page.getByRole('button', { name: 'Reload', exact: true }).tap();
  await page.waitForFunction(() => window.__arenaSound().recent.join(' ').includes('mech:rifle:magin'), null, { timeout: 8000 });
  recent = (await page.evaluate(() => window.__arenaSound().recent)).join(' ');
  assert.match(recent, /mech:rifle:magout/);
  check('reload: magazine out, then in, timed to the reload animation');
  await page.keyboard.down('KeyW'); await sleep(2200); await page.keyboard.up('KeyW');
  const steps = await page.evaluate(() => window.__campusSounds?.().played.filter(n => /^step-/.test(n)).length ?? 0);
  assert.ok(steps >= 1, 'footsteps while walking');
  check('footsteps while walking (recorded surface steps)', `${steps} steps`);

  // ---------------------------------------------------------------- a sustained firefight: no clipping, bounded voices
  await sleep(1500);
  const stress = await page.evaluate(async () => {
    const sfx = window.__arenaSfx, me = window.__arena.self(), y = me.y + 1.6, guns = ['vanguard', 'wasp', 'kestrel', 'anvil', 'halcyon', 'rampart', 'bastion', 'talon', 'longbow', 'sparrow', 'thorn', 'vanguard'];
    const before = window.__arenaSound();
    window.__arenaSoundTap.start();
    let calls = 0, cost = 0; const t0 = performance.now();
    await new Promise(resolve => {
      const shooters = guns.map((g, i) => ({ g, num: 100 + i, at: [me.x + Math.cos(i) * (3 + i * 11), y, me.z + Math.sin(i) * (3 + i * 11)], next: 0, every: g === 'longbow' ? 1300 : g === 'bastion' ? 830 : g === 'sparrow' || g === 'thorn' ? 300 : 65 + i * 3 }));
      let ownNext = 0, boomNext = 600;
      const timer = setInterval(() => {
        const t = performance.now() - t0;
        if (t > 3000) { clearInterval(timer); resolve(); return; }
        for (const s of shooters) while (s.next <= t) { const c0 = performance.now(); sfx.gun(s.g, s.at, s.num); sfx.impact(['concrete', 'metal', 'wood', 'dirt'][calls % 4], [s.at[0] * .5 + me.x * .5, me.y, s.at[2] * .5 + me.z * .5]); cost += performance.now() - c0; calls += 2; s.next += s.every; }
        while (ownNext <= t) { const c0 = performance.now(); sfx.gun('vanguard'); sfx.casing('concrete'); cost += performance.now() - c0; calls += 2; ownNext += 81; }
        if (t >= boomNext) { const c0 = performance.now(); sfx.boom([me.x + 15, me.y, me.z - 8]); cost += performance.now() - c0; calls++; boomNext += 900; }
      }, 10);
    });
    await new Promise(r => setTimeout(r, 1200));
    const out = window.__arenaSoundTap.stop(), after = window.__arenaSound();
    return { out, calls, msPerCall: cost / calls, played: after.played - before.played, skipped: after.skipped - before.skipped, stolen: after.stolen - before.stolen, deduped: after.deduped - before.deduped, peakVoices: after.peakVoices, rendered: after.rendered };
  });
  assert.ok(stress.out.clipped === 0, `no clipped samples (${stress.out.clipped})`); assert.ok(stress.out.peak < 1, `peak ${stress.out.peak}`);
  assert.ok(stress.peakVoices <= 20, `voices ${stress.peakVoices}`); assert.ok(stress.skipped + stress.stolen > 0, 'voice management engaged');
  assert.ok(stress.msPerCall < 2, `sound calls cost ${stress.msPerCall.toFixed(3)} ms each`);
  results.stress = stress;
  // Steady state (every sound already rendered): the cost of a sound call during a firefight.
  stress.steadyMsPerCall = await page.evaluate(() => { const me = window.__arena.self(), t0 = performance.now(); for (let i = 0; i < 200; i++) window.__arenaSfx.gun(['vanguard', 'wasp', 'anvil'][i % 3], [me.x + (i % 40), me.y + 1.6, me.z + 5], 500 + (i % 6)); return (performance.now() - t0) / 200; });
  assert.ok(stress.steadyMsPerCall < .5, `steady ${stress.steadyMsPerCall}`);
  check('3 s firefight (12 shooters, own automatic fire, explosions, impacts): no clipping, voices within budget', `peak ${stress.out.peakDb.toFixed(1)} dBFS, 0 clipped of ${stress.calls} calls, ${stress.played} played / ${stress.skipped} skipped / ${stress.stolen} stolen, ≤ ${stress.peakVoices} voices, ${stress.msPerCall.toFixed(3)} ms per call including first-time rendering of ${stress.rendered} sounds, ${stress.steadyMsPerCall.toFixed(3)} ms once rendered`);

  // ---------------------------------------------------------------- distance layering and level
  await sleep(2500);
  // Level: what the engine set for each layer (its distance curve and occlusion), along the player's open line of sight.
  const shot = async d => page.evaluate(async d => {
    const me = window.__arena.self(), at = [me.x + d, me.y + 1.6, me.z], played0 = window.__arenaSound().played;
    window.__arenaSfx.gun('talon', at, 999); await new Promise(r => setTimeout(r, 900));
    const s = window.__arenaSound(), mine = s.recent.slice(s.recent.length - (s.played - played0));
    const level = layer => { const e = mine.find(x => x.startsWith(`gun:talon:${layer}`)); return e ? Number(e.split('#')[1].split('~')[0]) : 0; };
    return { d, near: level('near'), far: level('far'), tail: level('tail'), occluded: mine.some(x => x.includes('~occluded')), played: mine };
  }, d);
  const near = await shot(4); await sleep(600); const mid = await shot(45); await sleep(900); const far = await shot(130);
  assert.ok(near.near > 0 && near.far === 0, `4 m: near layer only (${JSON.stringify(near)})`);
  assert.ok(mid.near > 0 && mid.far > 0, `45 m: both (${JSON.stringify(mid)})`);
  assert.ok(far.far > 0 && far.near === 0 && far.tail === 0, `130 m: distant layer only (${JSON.stringify(far)})`);
  assert.ok(near.near > mid.near * 4, `near layer falls with distance: ${near.near} → ${mid.near}`);
  assert.ok(mid.far > far.far, `distant layer falls with distance: ${mid.far} → ${far.far}`);
  results.distance = { near, mid, far };
  check('distance: 4 m plays the near layers loudest; 45 m blends near and distant; 130 m only the distant layer, quieter', `near-layer level ${near.near.toFixed(3)} → ${mid.near.toFixed(3)}; distant ${mid.far.toFixed(3)} → ${far.far.toFixed(3)}`);

  // ---------------------------------------------------------------- occlusion and roofs from the collision world
  const probes = await page.evaluate(() => { const me = window.__arena.self(), p = window.__arenaSoundProbe; return { front: p([me.x + 3, me.y + 1.4, me.z]), warehouse: [-3, 0, 3].map(z => p([0, 1.2, z])) }; });
  assert.equal(probes.front.occluded, false, 'a point 3 m from the spawn is in the open');
  assert.ok(probes.warehouse.filter(x => x.occluded).length >= 2, 'inside the central warehouse is behind its walls from a spawn');
  assert.ok(probes.warehouse.every(x => x.indoor === 1), 'inside the warehouse is under a roof');
  check('occlusion and roofs: open line → clear; the warehouse interior seen from a spawn → occluded, and under a roof (indoor reverb)', JSON.stringify(probes));

  // ---------------------------------------------------------------- category volume and context recovery
  await page.evaluate(() => window.__arena.settings({ volWeapons: 0 })); await sleep(300);
  const ownShot = () => page.evaluate(async () => { window.__arenaSoundTap.start('arena'); window.__arenaSfx.gun('vanguard'); await new Promise(r => setTimeout(r, 700)); return window.__arenaSoundTap.stop(); });
  const muted = await ownShot();
  await page.evaluate(() => window.__arena.settings({ volWeapons: 1 })); await sleep(300);
  const loud = await ownShot();
  assert.ok(muted.peakDb < -60 && loud.peakDb > -30, `weapons at 0: ${muted.peakDb.toFixed(1)} dBFS, at 1: ${loud.peakDb.toFixed(1)} dBFS`);
  check('category volume: weapons at 0 → the player’s own shot is silent in the arena mix; at 1 it is back', `${muted.peakDb.toFixed(0)} → ${loud.peakDb.toFixed(1)} dBFS`);
  // A phone interruption suspends the context: the next sound request or touch resumes it (no stuck silence), and
  // nothing is queued while it is suspended (sounds are skipped rather than released in a burst afterwards).
  const recovery = await page.evaluate(async () => {
    await window.__arenaSoundSuspend(); const suspended = window.__arenaSound().state, played0 = window.__arenaSound().played;
    const queued = window.__arenaSfx.gun('vanguard'); void queued;
    const t0 = performance.now(); while (window.__arenaSound().state !== 'running' && performance.now() - t0 < 3000) await new Promise(r => setTimeout(r, 50));
    return { suspended, recoveredMs: Math.round(performance.now() - t0), state: window.__arenaSound().state, playedWhileSuspended: window.__arenaSound().played - played0 };
  });
  await page.touchscreen.tap(422, 120);
  assert.equal(recovery.suspended, 'suspended'); assert.equal(recovery.state, 'running'); assert.equal(recovery.playedWhileSuspended, 0);
  check('a suspended audio context (phone interruption) is resumed by the next sound or touch; nothing queues up meanwhile', `back in ${recovery.recoveredMs} ms`);
  assert.deepEqual(errors, [], errors.join('\n'));
  await ctx.close();
} catch (e) { failed = true; console.error('✗', e.message); results.error = e.message; }
results.finished = new Date().toISOString(); results.passed = !failed;
await writeFile('docs/arena-audio-results.json', JSON.stringify(results, null, 2));
await browser.close(); await host.stop();
process.exit(failed ? 1 : 0);
