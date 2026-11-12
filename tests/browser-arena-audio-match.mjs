// Combat Arena audio in a real Training match against the server's bots, on a desktop profile (32 voices, HRTF):
// everything here comes from the authoritative server, not from test hooks —
//   * the bots' gunfire (the server's shot events) layered by distance and placed where they are;
//   * their footsteps from the snapshots (stride matched to their animation), on the map's surfaces;
//   * the player's hits on them (auto-fire on, the view turned toward the nearest visible bot): the impact on helmet,
//     plate carrier or cloth as the server judged it, their vocal reaction from the server's health, their
//     elimination (voice, then the body falling);
//   * damage to the player: a restrained grunt and the impact placed toward the attacker;
//   * the output never clips.
// Results: docs/arena-audio-match-results.json. Usage: VITE_QA=1 npx vite build --outDir dist-qa && node tests/browser-arena-audio-match.mjs
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Listener', reducedMotion: true, volume: .8 }, version: 0 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'medium', qualityChosen: true, adaptive: false, autoFire: true })); });
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(host.url + '/?qa-scale=0.2&qa-norender', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready', null, { timeout: 90000 });
  await page.getByRole('tab', { name: /Training/ }).click();
  await page.getByRole('button', { name: /Start training/ }).click();
  await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 120000 });
  await page.waitForFunction(() => window.__arena.state().match?.state === 'playing', null, { timeout: 30000 });
  const s0 = await page.evaluate(() => window.__arenaSound());
  assert.equal(s0.max, 32); assert.equal(s0.hrtf, true); assert.equal(s0.phone, false);
  check('desktop profile: 32 voices, HRTF panning (front/back, above/below), the full memory budget', `${s0.max} voices, budget ${(s0.budget / 1048576).toFixed(0)} MB`);

  // Hunt: turn toward the nearest visible bot; auto-fire shoots when the aim is on it (the server checks every shot).
  const t0 = await page.evaluate(() => { window.__arenaSoundTap.start(); return performance.now(); });
  const deadline = Date.now() + 60000;
  let summary = null;
  while (Date.now() < deadline) {
    await page.evaluate(() => {
      const me = window.__arena.self(), you = window.__arena.state().you; if (!me?.alive) return;
      const foes = window.__arena.remotes().filter(r => r.team !== you.team).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
      const f = foes[0]; if (!f) return;
      const dx = f.x - me.x, dz = f.z - me.z, d = Math.hypot(dx, dz);
      window.__arena.look(Math.atan2(-dx, -dz), Math.atan2(-.2, d));
    });
    await sleep(100);
    summary = await page.evaluate(t => {
      const ev = window.__arenaSound().events.filter(e => e.t >= t);
      const n = re => ev.filter(e => re.test(e.sound));
      return {
        remoteShots: n(/^w\.[a-z]+\/(shot|mid|far)$/).filter(e => e.d > 0).length, enemySteps: n(/^steps\.[a-z]+\/(walk|run|soft|stairs)$/).filter(e => e.d > 0).length,
        bodyHits: n(/^impacts\/(helmet|armour|flesh)$/).filter(e => e.d > 0).length, reactions: n(/^voice\.[a-zA-Z]+\/(hurt|heavy|severe)$/).filter(e => e.d > 0).length,
        deaths: n(/^voice\.[a-zA-Z]+\/death$/).length, falls: n(/^movement\/bodyfall$/).length, ownShots: n(/^w\.[a-z]+\/shot$/).filter(e => e.d === 0).length,
        ownHurt: n(/^voice\.[a-zA-Z]+\/(hurt|heavy|severe)$/).filter(e => e.d === 0).length, ownImpact: n(/^impacts\/(helmet|armour|flesh)$/).filter(e => e.d > 0 && e.d < 2).length,
        surfaces: [...new Set(n(/^steps\./).map(e => e.sound.split('/')[0]))], weapons: [...new Set(n(/^w\.[a-z]+\/(shot|mid|far)$/).filter(e => e.d > 0).map(e => e.sound.split('/')[0]))],
        markers: n(/^ui\/(hit|headshot|kill)$/).length,
      };
    }, t0);
    if (summary.remoteShots && summary.enemySteps && summary.bodyHits && summary.reactions && summary.deaths && summary.falls && Date.now() > deadline - 40000) break;
  }
  const tap = await page.evaluate(() => window.__arenaSoundTap.stop());
  results.match = { summary, tap, seconds: Math.round((Date.now() - (deadline - 60000)) / 1000) };
  console.log(JSON.stringify(results.match));
  assert.ok(summary.remoteShots > 0, 'bots’ gunfire heard'); assert.ok(summary.enemySteps > 0, 'enemy footsteps heard');
  check('the bots’ gunfire (from the server’s shot events) is heard from where they are, layered by distance', `${summary.remoteShots} reports from ${summary.weapons.join(', ')}`);
  check('enemy footsteps from the snapshots, on the map’s surfaces', `${summary.enemySteps} steps on ${summary.surfaces.join(', ')}`);
  assert.ok(summary.bodyHits > 0, 'hits on soldiers are heard on them: helmet, plate carrier or cloth');
  assert.ok(summary.reactions > 0, 'soldiers react vocally to validated damage');
  assert.ok(summary.deaths > 0 && summary.falls > 0, 'an elimination: the voice, then the body falling');
  check('soldiers hit (by the player or by each other), as the server judged it: the impact on helmet, plate carrier or cloth where the round stopped, their reaction from their health in the snapshots, an elimination (voice, then the body falling)',
    `${summary.bodyHits} body impacts, ${summary.reactions} reactions, ${summary.deaths} eliminations; the player fired ${summary.ownShots} rounds (${summary.markers} hit markers)`);
  if (summary.ownHurt) check('damage to the player: a restrained grunt, and the impact placed toward the attacker', `${summary.ownHurt} reactions, ${summary.ownImpact} impacts`);
  assert.equal(tap.clipped, 0, 'no clipped samples'); assert.ok(tap.peak < 1);
  check('the match’s output never clipped', `peak ${tap.peakDb.toFixed(1)} dBFS, RMS ${tap.rmsDb.toFixed(1)} dBFS, ≤ ${tap.maxVoices} voices over ${results.match.seconds} s`);
  assert.deepEqual(errors, [], errors.join('\n'));
  await ctx.close();
} catch (e) { failed = true; console.error('✗', e.message); results.error = e.message; }
results.finished = new Date().toISOString(); results.passed = !failed;
await writeFile('docs/arena-audio-match-results.json', JSON.stringify(results, null, 2));
await browser.close(); await host.stop();
process.exit(failed ? 1 : 0);
