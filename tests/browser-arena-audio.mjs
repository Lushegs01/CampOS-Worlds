// Combat Arena audio in a real browser (Chromium, Web Audio running headless), on the production bundle built with the
// QA hooks, as a phone (touch, Low profile: 20 voices, plain stereo panning, rumble filter), playing a Training match:
//   * sound banks: the player's weapons, the map's ground, movement and impacts load on their own at deployment (never
//     holding it up), each decoded at its own rate with the MP3 decoder's delay measured from the sprite's marker;
//   * the player's own gunfire, through the real game path (touch fire → the simulation's shot event): the weapon's
//     recorded body, its tail at the body's crossfade, the spent case landing;
//   * reloads: tactical and from empty, every part in order and on time against the reload's own clock (the same
//     plan the first-person animation draws), the empty magazine dropped, the action worked only from empty;
//     an interrupted reload stops its remaining parts;
//   * footsteps from the gait (cadence from speed, the surface the map says is underfoot), sprinting, stopping;
//   * hit reactions from validated damage (merged, never stammering, one death per life), helmet/armour/cloth impacts;
//   * another player's reload heard from where they are;
//   * a 3-second firefight never clips and stays within the voice budget; distance layering; occlusion; category
//     volumes; a suspended context recovers; decoded memory stays within the phone budget.
// Results: docs/arena-audio-results.json. Usage: VITE_QA=1 npx vite build --outDir dist-qa && node tests/browser-arena-audio.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { startProduction } from './support/production.mjs';
import { createWorld, raycast } from '../shared/arena/physics.mjs';
import { MAP_BY_ID } from '../shared/arena/maps.mjs';
import { WEAPON_BY_ID } from '../shared/arena/weapons.mjs';
import { reloadPlan } from '../src/arena/sound/reloads.mjs';

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
  page.on('console', m => { if (m.type() === 'warning' && /sound bank failed|sounds are unavailable/i.test(m.text())) errors.push(m.text()); });
  // qa-norender: the match runs (simulation, animation, sound) without drawing, so frames come at a realistic rate here.
  await page.goto(host.url + '/?qa-scale=0.2&qa-norender', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).tap();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: /Combat Arena/ }).tap();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready', null, { timeout: 90000 });
  // ---------------------------------------------------------------- interface sounds in the lobby
  await page.waitForFunction(() => window.__arenaSound?.().banks.some(b => b.name === 'ui' && b.state === 'ready'), null, { timeout: 30000 });
  const tUi = await page.evaluate(() => performance.now());
  await page.getByRole('tab', { name: /Training/ }).tap(); await sleep(300);
  const uiEv = await page.evaluate(t => window.__arenaSound().events.filter(e => e.t >= t && e.cat === 'ui').map(e => e.sound), tUi);
  assert.ok(uiEv.includes('ui/select'), `tab press: ${uiEv}`);
  check('interface: the arena’s interface bank loads with the lobby; a tab press plays its selection sound on the interface bus', uiEv.join(', '));

  const tDeploy = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: /Open the firing range/ }).tap();
  await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 120000 });
  await page.waitForFunction(() => window.__arena.self()?.alive, null, { timeout: 30000 });
  const tDeployed = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => window.__arena.state().match?.state === 'playing', null, { timeout: 30000 });
  // ---------------------------------------------------------------- banks
  const need = ['ui', 'w.vanguard', 'steps.concrete', 'movement', 'handling', 'impacts'];
  await page.waitForFunction(n => n.every(b => window.__arenaSound().banks.some(x => x.name === b && x.state === 'ready')), need, { timeout: 30000 });
  const s0 = await page.evaluate(() => ({ ...window.__arenaSound(), at: performance.now() }));
  assert.equal(s0.state, 'running'); assert.equal(s0.max, 20, 'phone voice budget'); assert.equal(s0.hrtf, false); assert.equal(s0.phone, true);
  assert.equal(s0.failures, 0, 'no bank failed');
  const rates = Object.fromEntries(s0.banks.filter(b => b.state === 'ready').map(b => [b.name, b.rate]));
  assert.equal(rates['steps.concrete'], 32000, 'footsteps decoded at their own 32 kHz'); assert.equal(rates['w.vanguard'], 32000);
  results.banks = { atDeployMs: Math.round(tDeployed - tDeploy), readyAfterDeployMs: Math.round(s0.at - tDeployed), loads: s0.loads, loadMs: Math.round(s0.loadMs), banks: s0.banks };
  check('banks: the loadout’s weapon, the ground’s footsteps, movement, handling and impacts load on their own while deploying (decoded at their own rates; decoder delay measured from the marker)',
    `${s0.banks.filter(b => b.state === 'ready').length} banks ready ${Math.max(0, Math.round(s0.at - tDeployed))} ms after deployment; delays ${[...new Set(s0.banks.map(b => b.delayMs))].join('/')} ms; ${(s0.bufferBytes / 1048576).toFixed(1)} MB decoded`);

  const events = since => page.evaluate(t => window.__arenaSound().events.filter(e => e.t >= t), since);
  const now = () => page.evaluate(() => performance.now());
  // (Looked up at each tap: the HUD layout can still settle after deployment.)
  const button = async name => async () => { const b = await page.getByRole('button', { name, exact: true }).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  const fire = await button('Fire'), reload = await button('Reload'), swap = await button('Switch weapon');

  // ---------------------------------------------------------------- the player's own gunfire
  await page.waitForFunction(() => !document.querySelector('[data-deploy-overlay]') && window.__arena.self()?.phase === 'ready', null, { timeout: 15000 });
  let t0 = await now();
  const ammo0 = (await page.evaluate(() => window.__arena.self())).ammo;
  for (let i = 0; i < 8 && (await page.evaluate(() => window.__arena.self().ammo)) > ammo0 - 3; i++) { await fire(); await sleep(180); }
  await page.waitForFunction(a => window.__arena.self().ammo < a, ammo0, { timeout: 10000 }).catch(async e => { console.log('diag', JSON.stringify(await page.evaluate(() => ({ self: window.__arena.self(), st: window.__arena.state().match?.state, hud: window.__arena.state().hud, menu: document.querySelector('.ar-modal')?.textContent?.slice(0, 200), fire: document.querySelector('[aria-label=Fire]')?.getBoundingClientRect() })))); throw e; }); await sleep(700);
  let ev = await events(t0);
  const shots = ev.filter(e => e.sound === 'w.vanguard/shot'), tails = ev.filter(e => e.sound === 'w.vanguard/tail'), cases = ev.filter(e => e.sound.startsWith('impacts/case'));
  assert.ok(shots.length >= 1 && tails.length >= 1 && cases.length >= 1, JSON.stringify(ev.map(e => e.sound)));
  const tailGap = tails[0].t - shots[0].t, caseGap = cases[0].t - shots[0].t;
  assert.ok(Math.abs(tailGap - 110) <= 20, `tail ${tailGap} ms after the body (the crossfade)`);
  assert.ok(caseGap >= 300 && caseGap <= 520, `case lands ${caseGap} ms after the shot`);
  assert.ok(shots.every(e => e.cat === 'weapons' && e.d === 0));
  check('own gunfire through the game: the Vanguard’s recorded body, its tail at the crossfade, and the spent 5.56 case landing', `tail +${tailGap} ms, case +${caseGap} ms`);

  // ---------------------------------------------------------------- tactical reload: every part, on time
  // The reload's own clock, frame by frame: the simulation's timer that the first-person animation draws. (On a slow
  // machine frames can exceed the simulation's catch-up limit, so the reload takes longer than its nominal time in
  // wall-clock terms; the sound must follow the animation, not the wall clock.)
  const trace = () => page.evaluate(() => { const tr = window.__trace = []; const loop = () => { const s = window.__arena.self(); if (s) tr.push({ t: performance.now(), phase: s.phase, pt: s.pt, total: s.reloadTotal }); if (window.__trace === tr) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  const reloadParts = async (empty, until) => {
    const t = await now(); await trace(); await reload();
    await page.waitForFunction(() => window.__arena.self().phase === 'reload', null, { timeout: 5000 });
    const me = await page.evaluate(() => window.__arena.self());
    await page.waitForFunction(() => window.__arena.self().phase !== 'reload', null, { timeout: 15000 }); await sleep(until ?? 500);
    const tr = (await page.evaluate(() => { const x = window.__trace; window.__trace = null; return x; })).filter(x => x.phase === 'reload');
    const list = (await events(t)).filter(e => e.tag === 'own-reload' || e.sound.startsWith('impacts/magDrop'));
    return { list, me, tr, plan: reloadPlan(me.weapon, me.reloadEmpty), total: me.reloadTotal / 60 * 1000 };
  };
  /** When the reload's progress reached k (interpolated between the frames that drew it). */
  const animAt = (tr, k) => { for (let i = 1; i < tr.length; i++) { const a = 1 - tr[i - 1].pt / tr[i - 1].total, b = 1 - tr[i].pt / tr[i].total; if (b >= k) return tr[i - 1].t + (tr[i].t - tr[i - 1].t) * Math.max(0, Math.min(1, (k - a) / Math.max(1e-6, b - a))); } return NaN; };
  const timing = ({ list, tr, plan }) => plan.cues.filter(([, c]) => c !== 'magDrop').map(([at, cue]) => {
    const e = list.find(x => x.sound.endsWith('/' + cue)); return { cue, at, offMs: e ? Math.round(e.peak - animAt(tr, at)) : null };
  });
  /** The tolerance: a frame (the animation is only drawn per frame), at least 80 ms. */
  const frameTol = tr => Math.max(60, 1.25 * Math.max(...tr.slice(1).map((x, i) => x.t - tr[i].t)));
  const tac = await reloadParts();
  assert.equal(tac.me.reloadEmpty, false);
  const tacT = timing(tac), tacNames = tac.list.map(e => e.sound.split('/')[1]);
  assert.deepEqual(tacNames, ['grab', 'magRelease', 'magOut', 'pouch', 'magIn', 'magSeat', 'settle'], `tactical order: ${tacNames}`);
  const tolT = frameTol(tac.tr);
  assert.ok(tacT.every(x => x.offMs != null && Math.abs(x.offMs) <= tolT), `tactical timing (±${tolT.toFixed(0)} ms) ${JSON.stringify(tacT)}`);
  results.reloadTactical = { timing: tacT, toleranceMs: Math.round(tolT), frames: tac.tr.length, wallMs: Math.round(tac.tr.at(-1).t - tac.tr[0].t), nominalMs: Math.round(tac.total) };
  check('tactical reload: grab, magazine release, out, a fresh one from the pouch, in, seated, settle — each part’s loudest moment at the moment the animation reaches it (within a frame); no bolt, no dropped magazine',
    tacT.map(x => `${x.cue} ${x.offMs >= 0 ? '+' : ''}${x.offMs}`).join(' · ') + ` ms (frame tolerance ${tolT.toFixed(0)} ms)`);

  // ---------------------------------------------------------------- reload from empty
  for (let i = 0; i < 40 && (await page.evaluate(() => window.__arena.self().ammo)) > 0; i++) { await fire(); await sleep(110); }
  assert.equal(await page.evaluate(() => window.__arena.self().ammo), 0, 'magazine emptied');
  const emp = await reloadParts(true, 800);
  assert.equal(emp.me.reloadEmpty, true);
  const empT = timing(emp), empNames = emp.list.map(e => e.sound.split('/')[1]);
  assert.ok(empNames.includes('boltRelease') && empNames.includes('magDrop'), `empty: ${empNames}`);
  assert.ok(empNames.indexOf('magDrop') > empNames.indexOf('magOut') && empNames.indexOf('boltRelease') > empNames.indexOf('magSeat'), `empty order: ${empNames}`);
  const tolE = frameTol(emp.tr);
  assert.ok(empT.every(x => x.offMs != null && Math.abs(x.offMs) <= tolE), `empty timing (±${tolE.toFixed(0)} ms) ${JSON.stringify(empT)}`);
  const drop = emp.list.find(e => e.sound.startsWith('impacts/magDrop'));
  results.reloadEmpty = { timing: empT, magDrop: drop?.sound };
  check('reload from empty: the empty magazine drops to the ground on what is underfoot, the new one goes in, and the bolt catch sends the bolt home — in time with the animation',
    `${empNames.join(' → ')}; bolt ${empT.find(x => x.cue === 'boltRelease').offMs} ms off`);

  // ---------------------------------------------------------------- an interrupted reload stops its remaining parts
  for (let i = 0; i < 4; i++) { await fire(); await sleep(130); }
  t0 = await now(); await reload();
  await page.waitForFunction(() => window.__arena.self().phase === 'reload', null, { timeout: 5000 });
  await page.waitForFunction(() => { const s = window.__arena.self(); return s.phase === 'reload' && 1 - s.pt / s.reloadTotal > .4; }, null, { timeout: 8000 }); await swap();
  await page.waitForFunction(() => window.__arena.self().phase === 'switch', null, { timeout: 4000 }); const tSwap = await now(); await sleep(2500);
  ev = await events(t0);
  const late = ev.filter(e => e.tag === 'own-reload' && e.t > tSwap + 30).map(e => e.sound), stopped = (await page.evaluate(() => window.__arenaSound().stopped)).filter(s => s.tag === 'own-reload' && s.t >= tSwap - 50);
  assert.deepEqual(late, [], `parts after the switch: ${late}`);
  assert.ok(stopped.length >= 1, 'the reload’s sounds were stopped');
  assert.ok(ev.some(e => e.sound === 'handling/swap') && ev.some(e => /\/raise$|drawBlade/.test(e.sound)), `the switch is heard: sling and the new weapon raised (${ev.filter(e => e.t > tSwap - 100).map(e => e.sound)})`);
  check('interrupted reload: switching weapons at 40 % stops the reload’s sounds; magazine-in and seat never play; the switch and the secondary’s draw are heard', `${stopped.reduce((a, s) => a + s.voices, 0)} voice(s) faded`);
  await swap(); await page.waitForFunction(() => window.__arena.self().weapon === 'vanguard' && window.__arena.self().phase === 'ready', null, { timeout: 5000 });

  // ---------------------------------------------------------------- footsteps from the gait, on the right surface
  // Face the longest open line from the spawn (from the collision world), so the walk is not stopped by a wall.
  {
    const p = await page.evaluate(() => window.__arena.self()), fw = createWorld(MAP_BY_ID.get('foundry').boxes, MAP_BY_ID.get('foundry').bounds), h = { t: 0, box: null, normal: [0, 0, 0], ground: false };
    let best = 0, bestYaw = 0;
    for (let k = 0; k < 32; k++) { const yaw = k / 32 * Math.PI * 2, dx = -Math.sin(yaw), dz = -Math.cos(yaw), r = raycast(fw, p.x, p.y + .6, p.z, dx, 0, dz, 30, null, h), free = r ? r.t : 30; if (free > best) { best = free; bestYaw = yaw; } }
    await page.evaluate(y => window.__arena.look(y, 0), bestYaw); await sleep(200);
    results.walkClearance = +best.toFixed(1);
  }
  t0 = await now();
  await page.keyboard.down('KeyW'); await sleep(2600); await page.keyboard.up('KeyW'); await sleep(400);
  ev = await events(t0);
  const walk = ev.filter(e => /^steps\.[a-z]+\/(walk|soft|run|stairs)$/.test(e.sound));
  const me = await page.evaluate(() => window.__arena.self()), groundNow = await page.evaluate(m => window.__arenaGround(m.x, m.y, m.z), me);
  assert.ok(walk.length >= 4, `steps ${walk.length}`);
  const gaps = walk.slice(1).map((e, i) => e.t - walk[i].t), mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(mean > 300 && mean < 600, `cadence ${mean.toFixed(0)} ms`);
  // The last step is on what the map says is underfoot (or concrete for the moment that surface's bank is still loading).
  assert.ok([groundNow.surface, 'concrete'].some(k => walk.at(-1).sound.startsWith(`steps.${k}/`)), `surface ${groundNow.surface} vs ${walk.at(-1).sound}`);
  const afterStop = walk.filter(e => e.t > t0 + 2600 + 250);
  assert.equal(afterStop.length, 0, 'no footsteps after stopping');
  results.footsteps = { count: walk.length, meanGapMs: Math.round(mean), surfaces: [...new Set(walk.map(e => e.sound.split('/')[0]))], foley: ev.filter(e => /movement\/(cloth|leather|gear)/.test(e.sound)).length };
  check('footsteps: from the gait while walking (cadence from speed), on the surface under the player, stopping when the player stops; quiet clothing under some steps',
    `${walk.length} steps every ${mean.toFixed(0)} ms on ${results.footsteps.surfaces.join(', ')}; ${results.footsteps.foley} clothing/equipment layers`);

  // ---------------------------------------------------------------- hit reactions, impacts, eliminations
  // Voices load as their soldiers appear in a match; here two soldiers are introduced first.
  await page.evaluate(() => { window.__arenaSfx.prepareVoice(901, 'soldier-m1'); window.__arenaSfx.prepareVoice(902, 'soldier-f1'); });
  await page.waitForFunction(() => ['voice.' + window.__arenaSfx.voiceFor(901, 'soldier-m1'), 'voice.fA'].every(n => window.__arenaSound().banks.some(b => b.name === n && b.state === 'ready')), null, { timeout: 15000 });
  const react = await page.evaluate(async () => {
    const sfx = window.__arenaSfx, me = window.__arena.self(), at = [me.x + 4, me.y + 1.5, me.z], t = performance.now();
    sfx.hurt(901, 22, 78, at, 'soldier-m1'); setTimeout(() => sfx.hurt(901, 22, 56, at, 'soldier-m1'), 40);
    await new Promise(r => setTimeout(r, 400));
    // Three separate hits (simultaneous pellets on one body are deliberately heard once).
    sfx.bodyHit('helmet', at); await new Promise(r => setTimeout(r, 80)); sfx.bodyHit('armour', [at[0], at[1] - .3, at[2] + .2]); await new Promise(r => setTimeout(r, 80)); sfx.bodyHit('flesh', [at[0], at[1] - .9, at[2] - .2]);
    sfx.death(902, [me.x - 5, me.y + 1.5, me.z], 'soldier-f1', 1); sfx.death(902, [me.x - 5, me.y + 1.5, me.z], 'soldier-f1', 1);
    sfx.hurt(null, 18, 82); sfx.bodyHit('armour', [me.x + 1.2, me.y + 1.3, me.z], true);
    await new Promise(r => setTimeout(r, 900));
    return window.__arenaSound().events.filter(e => e.t >= t).map(e => ({ s: e.sound, d: e.d, cat: e.cat }));
  });
  const voices901 = react.filter(e => /^voice\.m[A-D]\//.test(e.s) && e.d > 2 && e.d < 6);
  assert.equal(voices901.length, 1, `one reaction for two hits 40 ms apart: ${JSON.stringify(voices901)}`);
  assert.ok(voices901[0].s.endsWith('/heavy'), 'merged into a heavy reaction (44 damage)');
  assert.deepEqual(react.filter(e => /^impacts\/(helmet|armour|flesh)$/.test(e.s)).map(e => e.s).sort(), ['impacts/armour', 'impacts/armour', 'impacts/flesh', 'impacts/helmet']);
  assert.equal(react.filter(e => e.s === 'voice.fA/death').length, 1, 'one death reaction per life');
  assert.equal(react.filter(e => e.s === 'movement/bodyfall').length, 1);
  assert.ok(react.some(e => /^voice\.m[A-D]\/hurt$/.test(e.s) && e.d === 0), 'the player’s own grunt, restrained and centred');
  check('hit reactions: two hits 40 ms apart make one heavier grunt; helmet, plate carrier and cloth each sound different; an elimination plays once (a female soldier’s voice, then the body falling); the player’s own hit grunts quietly',
    react.map(e => e.s).join(', '));

  // ---------------------------------------------------------------- another player's reload, heard from where they are
  // (Another player's weapon bank loads when they are first seen carrying it.)
  await page.evaluate(() => window.__arenaSfx.prepareWeapon('halcyon'));
  await page.waitForFunction(() => window.__arenaSound().banks.some(b => b.name === 'w.halcyon' && b.state === 'ready'), null, { timeout: 15000 });
  const remote = await page.evaluate(async () => {
    const me = window.__arena.self(), at = [me.x + 6, me.y + 1.2, me.z + 2], t = performance.now();
    window.__arenaSfx.remoteActions.reload(950, 'halcyon', true, () => at);
    for (let i = 0; i < 220; i++) { window.__arenaSfx.remoteActions.frame(950, true, true); await new Promise(r => setTimeout(r, 16)); }
    return window.__arenaSound().events.filter(e => e.t >= t && e.tag === 'r950').map(e => ({ s: e.sound.split('/')[1], d: e.d }));
  });
  assert.ok(remote.length >= 6 && remote.every(e => e.d > 5), JSON.stringify(remote));
  assert.ok(remote.map(e => e.s).includes('chargeBack') && remote.map(e => e.s).includes('chargeFwd'), 'an AK-pattern reload from empty is charged');
  check('another player’s reload is heard from their position, part by part (an AK-pattern reload from empty ends with the charging handle)', remote.map(e => e.s).join(' → '));

  // ---------------------------------------------------------------- a sustained firefight: no clipping, bounded voices
  // Every weapon heard at once: their banks load as other players carrying them would be seen.
  await page.evaluate(() => { for (const id of ['wasp', 'kestrel', 'anvil', 'halcyon', 'rampart', 'bastion', 'talon', 'longbow', 'sparrow', 'thorn']) window.__arenaSfx.prepareWeapon(id); });
  await page.waitForFunction(() => window.__arenaSound().banks.filter(b => b.name.startsWith('w.') && b.state === 'ready').length >= 6 && window.__arenaSound().banks.some(b => b.name === 'explosives' && b.state === 'ready'), null, { timeout: 30000 });
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
        while (ownNext <= t) { const c0 = performance.now(); sfx.gun('vanguard'); sfx.ejected('vanguard'); cost += performance.now() - c0; calls += 2; ownNext += 81; }
        if (t >= boomNext) { const c0 = performance.now(); sfx.boom([me.x + 15, me.y, me.z - 8]); cost += performance.now() - c0; calls++; boomNext += 900; }
      }, 10);
    });
    await new Promise(r => setTimeout(r, 1200));
    const out = window.__arenaSoundTap.stop(), after = window.__arenaSound();
    return { out, calls, msPerCall: cost / calls, played: after.played - before.played, skipped: after.skipped - before.skipped, stolen: after.stolen - before.stolen, deduped: after.deduped - before.deduped, missing: after.missing - before.missing, peakVoices: after.peakVoices };
  });
  assert.ok(stress.out.clipped === 0, `no clipped samples (${stress.out.clipped})`); assert.ok(stress.out.peak < 1, `peak ${stress.out.peak}`);
  assert.ok(stress.out.coverage > .8, `the output tap inspected ${Math.round(stress.out.coverage * 100)} % of the audio`);
  assert.ok(stress.peakVoices <= 20, `voices ${stress.peakVoices}`); assert.ok(stress.skipped + stress.stolen > 0, 'voice management engaged');
  assert.ok(stress.msPerCall < 1, `sound calls cost ${stress.msPerCall.toFixed(3)} ms each`);
  results.stress = stress;
  check('3 s firefight (12 shooters of every weapon, own automatic fire, explosions, impacts): no clipping, voices within budget, cheap calls',
    `peak ${stress.out.peakDb.toFixed(1)} dBFS, 0 clipped samples (${Math.round(stress.out.coverage * 100)} % of the output inspected), ${stress.calls} calls, ${stress.played} played / ${stress.skipped} skipped / ${stress.stolen} stolen, ≤ ${stress.peakVoices} voices, ${stress.msPerCall.toFixed(3)} ms per call`);

  // ---------------------------------------------------------------- distance layering and level
  await sleep(2500);
  const shot = async d => page.evaluate(async d => {
    const me = window.__arena.self(), at = [me.x + d, me.y + 1.6, me.z], t = performance.now();
    window.__arenaSfx.gun('talon', at, 999 + d); await new Promise(r => setTimeout(r, 900));
    const mine = window.__arenaSound().events.filter(e => e.t >= t && e.sound.startsWith('w.talon/'));
    const level = layer => mine.find(e => e.sound === 'w.talon/' + layer)?.level ?? 0;
    return { d, shot: level('shot'), tail: level('tail'), mid: level('mid'), far: level('far') };
  }, d);
  const near = await shot(4); await sleep(600); const mid = await shot(45); await sleep(900); const far = await shot(130);
  assert.ok(near.shot > 0 && near.tail > 0 && near.mid === 0 && near.far === 0, `4 m: the weapon itself (${JSON.stringify(near)})`);
  assert.ok(mid.shot > 0 && mid.mid > 0 && mid.far === 0, `45 m: near fading, mid-distance microphone (${JSON.stringify(mid)})`);
  assert.ok(far.far > 0 && far.shot === 0 && far.tail === 0, `130 m: the far version only (${JSON.stringify(far)})`);
  assert.ok(near.shot > mid.shot * 4, `near layer falls with distance: ${near.shot} → ${mid.shot}`);
  results.distance = { near, mid, far };
  check('distance: 4 m plays the weapon’s near recording and tail; 45 m blends in the mid-distance microphone; 130 m only the far version', `near ${near.shot.toFixed(3)} → ${mid.shot.toFixed(3)}; mid ${mid.mid.toFixed(3)}; far ${far.far.toFixed(3)}`);

  // ---------------------------------------------------------------- occlusion and roofs from the collision world
  const ear = (await page.evaluate(() => window.__arenaSound().ear)), map = MAP_BY_ID.get('foundry'), w = createWorld(map.boxes, map.bounds), hit = { t: 0, box: null, normal: [0, 0, 0], ground: false };
  const losBlocked = at => { const dx = at[0] - ear.x, dy = at[1] + .2 - ear.y, dz = at[2] - ear.z, len = Math.hypot(dx, dy, dz) || 1; const b = raycast(w, ear.x, ear.y, ear.z, dx / len, dy / len, dz / len, len - .4, null, hit); return !!(b && b.box && b.t < len - .6); };
  const candidates = []; for (let k = 0; k < 24; k++) for (const r of [3, 8, 15, 25]) { const a = k / 24 * Math.PI * 2; candidates.push([ear.x + Math.cos(a) * r, 1.4, ear.z + Math.sin(a) * r]); }
  const clear = candidates.filter(c => !losBlocked(c)).slice(0, 4), blocked = candidates.filter(c => losBlocked(c)).slice(0, 4);
  assert.ok(clear.length && blocked.length, 'found both open and walled-off points around the spawn');
  const probes = await page.evaluate(([cl, bl]) => ({ clear: cl.map(p => window.__arenaSoundProbe(p)), blocked: bl.map(p => window.__arenaSoundProbe(p)), warehouse: [-3, 0, 3].map(z => window.__arenaSoundProbe([0, 1.2, z])) }), [clear, blocked]);
  assert.ok(probes.clear.every(x => !x.occluded), 'open points are heard directly');
  assert.ok(probes.blocked.every(x => x.occluded), 'points behind walls are occluded');
  assert.ok(probes.warehouse.every(x => x.indoor === 1), 'inside the warehouse is under a roof');
  check('occlusion and roofs: the engine agrees with an independent line-of-sight check on 8 points around the player; the warehouse interior is under a roof (indoor reverb)', `${clear.length} open, ${blocked.length} walled off`);

  // ---------------------------------------------------------------- ambience, announcer, category volumes
  const amb = await page.evaluate(() => ({ loops: window.__arenaSound().loops, beds: window.__arenaSound().recent.filter(x => x.startsWith('loop:amb.')) }));
  assert.ok(amb.loops >= 3, `ambience beds playing (${amb.loops} loops)`);
  check('ambience: the map’s wind, district and room-tone beds are looping (and the nearest machines)', `${amb.loops} loops`);
  const tVo = await now(); await page.evaluate(() => window.__arenaSfx.announcer.say('secured', { gap: 0 })); await sleep(500);
  assert.ok((await events(tVo)).some(e => e.sound === 'vo/secured' && e.cat === 'voice'), 'announcer on the voice bus');
  await sleep(2500); // (let the line finish before measuring silence)
  await page.evaluate(() => window.__arena.settings({ volWeapons: 0 })); await sleep(300);
  const ownShot = () => page.evaluate(async () => { window.__arenaSoundTap.start('arena'); window.__arenaSfx.gun('vanguard'); await new Promise(r => setTimeout(r, 700)); return window.__arenaSoundTap.stop(); });
  await page.evaluate(() => window.__arena.settings({ volEnvironment: 0 })); await sleep(400);
  const muted = await ownShot();
  await page.evaluate(() => window.__arena.settings({ volWeapons: 1 })); await sleep(300);
  const loud = await ownShot();
  await page.evaluate(() => window.__arena.settings({ volEnvironment: .85 }));
  assert.ok(muted.peakDb < -60 && loud.peakDb > muted.peakDb + 30, `weapons at 0: ${muted.peakDb.toFixed(1)} dBFS, at 1: ${loud.peakDb.toFixed(1)} dBFS`);
  check('category volumes: weapons at 0 → the player’s own shot is silent in the arena mix; at 1 it is back; the announcer plays on its own bus', `${muted.peakDb.toFixed(0)} → ${loud.peakDb.toFixed(1)} dBFS`);

  // ---------------------------------------------------------------- memory and recovery
  await sleep(9000); // (banks idle for 8 s can be let go)
  const mem = await page.evaluate(() => ({ bytes: window.__arenaSound().bufferBytes, banks: window.__arenaSound().banks.filter(b => b.state === 'ready').map(b => `${b.name} ${(b.bytes / 1048576).toFixed(1)}`), evicted: window.__arenaSound().evicted }));
  assert.ok(mem.bytes < 34 * 1048576, `decoded audio ${(mem.bytes / 1048576).toFixed(1)} MB: ${mem.banks.join(', ')}`);
  results.memory = { mb: +(mem.bytes / 1048576).toFixed(1), banks: mem.banks, evicted: mem.evicted };
  check('memory: after a firefight with every weapon in the game heard, decoded audio stays within the phone budget (least recently used banks let go; a weapon whose bank is reloading is stood in for by one of its class)', `${results.memory.mb} MB in ${mem.banks.length} banks (${mem.evicted} let go)`);
  const recovery = await page.evaluate(async () => {
    await window.__arenaSoundSuspend(); const suspended = window.__arenaSound().state, played0 = window.__arenaSound().played;
    window.__arenaSfx.gun('vanguard');
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
