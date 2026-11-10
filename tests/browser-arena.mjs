// Combat Arena in real browsers against the full local stack (PostgreSQL, the Supabase stand-in, the
// room server with its arena, and the Vite app): two signed-in players enter the arena from the
// campus, equip a loadout (saved to their accounts), are matched into the same Quick Play match,
// see each other, one eliminates the other twice through the server, the match ends, the result and
// experience are saved and shown, and both return to campus. Then a phone plays Training with the
// touch controls. Screenshots go to docs/screenshots/arena; results to docs/arena-results.json.
// Usage: node tests/browser-arena.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { launch, account, open, signIn } from './support/browser.mjs';
import { EYE } from '../shared/arena/sim.mjs';

const SHOTS = 'docs/screenshots/arena/';
await mkdir(SHOTS, { recursive: true });
const RULES = { countdownMs: 1500, fillWaitMs: 0, spawnProtectMs: 0, regenDelayMs: 60000, mode: { scoreLimit: 2, respawnMs: 2500 } };
const stack = await startStack({ name: 'arena-browser', webPort: 5179, roomPort: 3209, supabasePort: 54329, arena: { rules: RULES, minRecordMs: 0, slowCloseMs: 30000 } });
const browser = await launch();
const errors = [], results = { started: new Date().toISOString(), checks: [] };
const check = (name, detail = '') => { results.checks.push({ name, ok: true, detail }); console.log('✓', name, detail); };
const arenaState = page => page.evaluate(() => window.__arena?.state());
// Software rendering (SwiftShader in CI) draws the arena's photoscanned scene at a few frames a second:
// render it small so the networking under test is not starved, and give slow clients longer.
const pinArena = async page => page.addInitScript(() => { localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', showFps: true })); localStorage.setItem('campos-arena-qa-scale', '0.3'); });
async function openArena(page) {
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.getByRole('heading', { name: 'Combat Arena' }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => window.__arena?.state().status === 'ready', null, { timeout: 30000 });
}
const matchOf = id => stack.room.arena.matches.get(id);
try {
  // ---------------------------------------------------------------- two signed-in players
  const ada = await account(stack, 'ada_arena', 'Ada'), tobi = await account(stack, 'tobi_arena', 'Tobi');
  const [pa, pb] = await Promise.all([open(browser, stack, 'Ada', errors), open(browser, stack, 'Tobi', errors)]);
  for (const p of [pa, pb]) await pinArena(p);
  await signIn(pa, ada); await signIn(pb, tobi);
  await openArena(pa); await openArena(pb);
  const lobby = await arenaState(pa);
  assert.equal(lobby.phase, 'lobby');
  assert.ok(await pa.getByText('Level 1').first().isVisible());
  await pa.screenshot({ path: SHOTS + 'lobby.png' });
  check('both players open Combat Arena from the campus dock, signed in with their campus accounts');

  // Loadout: Ada equips the Longbow; it is validated by the arena and saved to her account.
  await pa.getByRole('button', { name: 'Edit loadouts' }).click();
  await pa.getByRole('button', { name: /^Longbow SR/ }).click();
  await pa.getByRole('button', { name: 'Equip' }).click();
  await pa.getByText('Saved to your account and equipped.').waitFor();
  await pa.screenshot({ path: SHOTS + 'loadout.png' });
  const saved = await stack.db.pool.query(`select primary_weapon from public.arena_loadouts l join public.profiles p on p.id = l.user_id where p.handle = 'ada_arena'`);
  assert.equal(saved.rows[0]?.primary_weapon, 'longbow');
  await pa.getByRole('button', { name: 'Close loadouts' }).click();
  check('loadout editor equips a weapon and saves it to the account', 'arena_loadouts.primary_weapon = longbow');

  // ---------------------------------------------------------------- Quick Play: matched together
  await pa.getByRole('radio', { name: /Sim Quad/ }).click(); await pb.getByRole('radio', { name: /Sim Quad/ }).click();
  await pa.getByRole('button', { name: 'Quick Play' }).first().click();
  await pa.waitForFunction(() => window.__arena?.state().phase === 'match');
  await pb.getByRole('button', { name: 'Quick Play' }).first().click();
  await pb.waitForFunction(() => window.__arena?.state().phase === 'match');
  const [sa, sb] = [await arenaState(pa), await arenaState(pb)];
  assert.equal(sa.match.id, sb.match.id, 'matched into the same match'); assert.notEqual(sa.you.team, sb.you.team, 'on opposite teams');
  await pa.waitForFunction(() => window.__arena.state().hud.matchState === 'playing', null, { timeout: 30000 });
  check('Quick Play matches both players into one Team Deathmatch on opposite teams', sa.match.id);
  const m = matchOf(sa.match.id), A = m.players.find(p => p.num === sa.you.num), B = m.players.find(p => p.num === sb.you.num);

  // Put them in view of each other (server-side, as if they had walked) and check synchronisation.
  const place = (p, x, z, yaw) => { Object.assign(p.sim, { x, y: 0, z, vx: 0, vz: 0, yaw }); p.history = []; };
  place(A, -20, -6, -Math.PI / 2); place(B, -12, -6, Math.PI / 2);
  await pa.waitForFunction(n => window.__arena.remotes().some(r => r.num === n && Math.abs(r.x + 12) < .3), sb.you.num, { timeout: 20000 });
  await pb.waitForFunction(n => window.__arena.remotes().some(r => r.num === n && Math.abs(r.x + 20) < .3), sa.you.num, { timeout: 20000 });
  check('each browser renders the other player where the server has them');
  await pa.screenshot({ path: SHOTS + 'match-desktop.png' });

  // ---------------------------------------------------------------- shooting: two eliminations through the server
  const canvas = pa.locator('.ar-canvas canvas');
  await canvas.click({ position: { x: 400, y: 300 } }); // captures the pointer
  await pa.waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 5000 }).catch(() => {});
  for (let k = 0; k < 2; k++) {
    await pb.waitForFunction(() => window.__arena.state().hud.alive, null, { timeout: 20000 });
    place(A, -20, -6, -Math.PI / 2); place(B, -12, -6, Math.PI / 2);
    await pa.waitForFunction(() => Math.abs(window.__arena.self().x + 20) < .05, null, { timeout: 10000 });
    const yaw = Math.atan2(-(B.sim.x - A.sim.x), -(B.sim.z - A.sim.z)), pitch = Math.atan2(1.15 - EYE[0], Math.hypot(B.sim.x - A.sim.x, B.sim.z - A.sim.z));
    await pa.evaluate(([y, p]) => window.__arena.look(y, p), [yaw, pitch]);
    await pa.mouse.down({ button: 'right' }); await pa.waitForTimeout(2200); // raise and aim down sights (and rechamber)
    const before = B.stats.deaths;
    await pa.mouse.down({ button: 'left' }); await pa.waitForTimeout(120); await pa.mouse.up({ button: 'left' });
    await pa.mouse.up({ button: 'right' });
    await pb.waitForFunction(() => !window.__arena.state().hud.alive || window.__arena.state().phase !== 'match', null, { timeout: 10000 });
    assert.equal(B.stats.deaths, before + 1);
    if (k === 0) { await pb.waitForTimeout(250); await pb.screenshot({ path: SHOTS + 'eliminated.png' }); await pa.screenshot({ path: SHOTS + 'elimination-feed.png' }); }
  }
  check('the shooter eliminates the other player twice; the server applies damage, eliminations and the score');

  // ---------------------------------------------------------------- results and persistence
  await pa.getByRole('heading', { name: /Victory/ }).waitFor({ timeout: 20000 });
  await pb.getByRole('heading', { name: /Defeat/ }).waitFor({ timeout: 20000 });
  await pa.getByText('Saved to your account.').waitFor({ timeout: 20000 });
  await pa.screenshot({ path: SHOTS + 'results-victory.png' }); await pb.screenshot({ path: SHOTS + 'results-defeat.png' });
  const stats = (await stack.db.pool.query(`select s.* from public.arena_stats s join public.profiles p on p.id = s.user_id where p.handle = 'ada_arena'`)).rows[0];
  assert.equal(stats.kills, 2); assert.equal(stats.wins, 1); assert.equal(stats.matches, 1); assert.ok(Number(stats.xp) >= 800);
  const weapon = (await stack.db.pool.query(`select w.* from public.arena_weapon_stats w join public.profiles p on p.id = w.user_id where p.handle = 'ada_arena'`)).rows[0];
  assert.deepEqual([weapon.weapon, weapon.kills], ['longbow', 2]);
  check('victory and defeat screens; the result, experience and weapon statistics are saved', `xp ${stats.xp}, level ${stats.level}`);
  await pa.getByRole('button', { name: 'Lobby' }).click();
  await pa.getByRole('tab', { name: 'Rankings' }).click();
  await pa.getByRole('cell', { name: /Ada @ada_arena/ }).waitFor({ timeout: 15000 });
  await pa.getByRole('table', { name: 'Your recent matches' }).getByText('Victory').waitFor({ timeout: 15000 });
  await pa.screenshot({ path: SHOTS + 'rankings.png' });
  check('the rankings list the player with their level and record, and the match appears in their history');

  // ---------------------------------------------------------------- back to campus
  await pa.getByRole('button', { name: 'Return to campus' }).click();
  await pa.getByRole('button', { name: /online/ }).waitFor();
  assert.equal(await pa.locator('.ar-root').count(), 0);
  const pos = await pa.evaluate(() => window.__campusInspect().position);
  await pa.keyboard.down('KeyW'); await pa.waitForFunction(z => Math.abs(window.__campusInspect().position.z - z) > 1, pos.z, { timeout: 20000 }).finally(() => pa.keyboard.up('KeyW'));
  check('returning to campus restores normal campus play (walking works)');
  await pb.getByRole('button', { name: 'Return to campus' }).click();
  await pb.getByRole('button', { name: /online/ }).waitFor();
  // Software rendering is slow: close the desktop windows before the phone opens.
  await pa.context().close(); await pb.context().close();

  // ---------------------------------------------------------------- phone: training with touch controls
  // Open the campus in portrait (as the other phone suites do), then turn the phone to landscape for the arena.
  const phone = await open(browser, stack, 'Phone', errors, { viewport: { width: 390, height: 844 }, mobile: true });
  await pinArena(phone);
  await phone.setViewportSize({ width: 844, height: 390 });
  await openArena(phone);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow in the lobby');
  await phone.screenshot({ path: SHOTS + 'phone-lobby.png' });
  await phone.getByRole('tab', { name: 'Training' }).click();
  await phone.getByRole('button', { name: 'Start training' }).click();
  // This step is about touch controls: hold the bots still (software rendering makes each check slow
  // enough for them to win the short test match otherwise).
  await phone.waitForFunction(() => !!window.__arena?.state().match, null, { timeout: 60000 });
  const trainingId = (await arenaState(phone)).match.id, training = matchOf(trainingId);
  for (const b of training.players.filter(p => p.bot)) b.brain.think = () => null;
  await phone.waitForFunction(() => window.__arena?.state().hud.matchState === 'playing', null, { timeout: 60000 });
  await phone.waitForFunction(() => window.__arena.state().hud.alive && window.__arena.self()?.ammo > 0, null, { timeout: 20000 });
  // The match is playable once its loading screen (world, weapon, arms, soldiers) has gone.
  await phone.locator('.ar-scene-loading').waitFor({ state: 'detached', timeout: 90000 });
  const fire = phone.getByRole('button', { name: 'Fire', exact: true });
  await fire.waitFor();
  for (const name of ['Fire', 'Aim down sights', 'Jump', 'Reload', 'Switch weapon', 'Throw lethal']) {
    const box = await phone.getByRole('button', { name, exact: true }).boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 844 && box.y + box.height <= 390, `${name} is on screen`);
  }
  await phone.waitForTimeout(1500);
  const ammo0 = (await phone.evaluate(() => window.__arena.self())).ammo;
  const fb = await fire.boundingBox();
  await phone.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await phone.waitForFunction(a => window.__arena.self().ammo < a || window.__arena.self().pending === -1, ammo0, { timeout: 5000 });
  check('a phone plays Training with on-screen touch controls; the fire button fires', `ammo ${ammo0} → ${(await phone.evaluate(() => window.__arena.self())).ammo}`);
  // The movement stick (left half) moves the player.
  const start = await phone.evaluate(() => window.__arena.self());
  const cdp = await phone.context().newCDPSession(phone);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7 }] });
  await touch('touchStart', 150, 250); for (let i = 1; i <= 8; i++) await touch('touchMove', 150, 250 - i * 7); await phone.waitForTimeout(1200); await touch('touchEnd');
  const after = await phone.evaluate(() => window.__arena.self());
  assert.ok(Math.hypot(after.x - start.x, after.z - start.z) > .8, `moved ${Math.hypot(after.x - start.x, after.z - start.z).toFixed(2)} m`);
  check('the touch movement stick moves the player');
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: SHOTS + 'phone-training.png' });
  const fps = (await arenaState(phone)).hud.fps;
  results.phoneFpsSoftwareRendering = fps;
  check('phone layout keeps controls on screen without page scrolling', `${fps} fps on software (SwiftShader) rendering`);

  const unexpected = errors.filter(e => !/AudioContext|autoplay/i.test(e));
  assert.deepEqual(unexpected, [], 'no page errors');
  results.ok = true;
  console.log('All Combat Arena browser checks passed.');
} catch (e) {
  results.ok = false; results.error = String(e?.stack ?? e); results.pageErrors = errors;
  results.pageStates = [];
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) results.pageStates.push(await p.evaluate(() => { const a = window.__arena; return a && { status: a.state().status, phase: a.state().phase, match: a.state().hud.matchState, fps: a.state().hud.fps, self: a.self(), remotes: a.remotes() }; }).catch(err => String(err)));
  console.error('page states', JSON.stringify(results.pageStates));
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: `${SHOTS}failure-${browser.contexts().indexOf(ctx)}.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally {
  results.finished = new Date().toISOString();
  await writeFile('docs/arena-results.json', JSON.stringify(results, null, 2) + '\n');
  await browser.close(); await stack.stop();
}
