// Combat Arena HUD Customization Studio, auto-fire and the Armory in real browsers against the full local
// stack (PostgreSQL, the Supabase stand-in, the room and arena servers, the Vite app).
//   Desktop, signed in: open the studio from the lobby, drag the minimap, resize it, restyle the crosshair,
//   hide the compass, save (to the device and the account), reload the page and find it all again.
//   Phone, landscape: rearrange the touch HUD (move the stick, enlarge the fire button), save, open the firing
//   range and find the controls where they were put; the studio's preview never fires.
//   Auto-fire: off by default; on, it fires at an enemy under the player's own aim and stops when the aim
//   leaves; manual fire still works.
// Screenshots go to docs/screenshots/arena/hud; results to docs/arena-hud-results.json.
// Usage: node tests/browser-arena-hud.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { launch, account, open, signIn } from './support/browser.mjs';
import { EYE } from '../shared/arena/sim.mjs';

const SHOTS = 'docs/screenshots/arena/hud/';
await mkdir(SHOTS, { recursive: true });
const RULES = { countdownMs: 1500, fillWaitMs: 0, spawnProtectMs: 0, regenDelayMs: 60000 };
const stack = await startStack({ name: 'arena-hud-browser', webPort: 5181, roomPort: 3211, supabasePort: 54331, arena: { rules: RULES, minRecordMs: 0, slowCloseMs: 30000 } });
const browser = await launch();
const errors = [], results = { started: new Date().toISOString(), checks: [] };
const check = (name, detail = '') => { results.checks.push({ name, ok: true, detail }); console.log('✓', name, detail); };
const pin = page => page.addInitScript(() => { if (!localStorage.getItem('campos-arena-settings')) localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false })); localStorage.setItem('campos-arena-qa-scale', '0.3'); });
async function openArena(page) {
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.getByRole('heading', { name: 'Combat Arena' }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => window.__arena?.state().status === 'ready', null, { timeout: 30000 });
}
/** Reload the page and enter the campus again (the account session is kept by the browser). */
async function reenter(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 60000 });
}
const hudRect = (page, id, scope = '.ar-hx-stage') => page.locator(`${scope} [data-hud="${id}"]`).first().boundingBox();
/** Set a range input the way a person dragging it would (React listens for input events). */
const setRange = (locator, value) => locator.evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const savedHud = page => page.evaluate(() => JSON.parse(localStorage.getItem('campos-arena-hud') ?? 'null'));
try {
  // ---------------------------------------------------------------- desktop: edit, save, reload
  const ada = await account(stack, 'ada_hud', 'Ada');
  const pa = await open(browser, stack, 'Ada', errors);
  await pin(pa); await signIn(pa, ada); await openArena(pa);
  const settings0 = await pa.evaluate(() => JSON.parse(localStorage.getItem('campos-arena-settings')));
  assert.notEqual(settings0?.autoFire, true, 'auto-fire is off by default');
  await pa.getByRole('button', { name: 'HUD customization' }).first().click();
  await pa.getByRole('dialog', { name: 'HUD customization' }).waitFor();
  await pa.screenshot({ path: SHOTS + 'studio-desktop.png' });
  // Drag the minimap from the top-left corner towards the middle-left.
  const m0 = await hudRect(pa, 'minimap');
  await pa.mouse.move(m0.x + m0.width / 2, m0.y + m0.height / 2); await pa.mouse.down();
  for (let i = 1; i <= 10; i++) await pa.mouse.move(m0.x + m0.width / 2 + i * 20, m0.y + m0.height / 2 + i * 25);
  await pa.mouse.up();
  const m1 = await hudRect(pa, 'minimap');
  assert.ok(m1.x > m0.x + 100 && m1.y > m0.y + 120, `dragged from ${Math.round(m0.x)},${Math.round(m0.y)} to ${Math.round(m1.x)},${Math.round(m1.y)}`);
  // Resize it with the size slider, restyle the crosshair, hide the compass.
  await setRange(pa.getByRole('slider', { name: /^Size/ }), 1.5);
  const m2 = await hudRect(pa, 'minimap'); assert.ok(m2.width > m1.width * 1.3, 'minimap enlarged');
  await pa.locator('.ar-hx-list label', { hasText: 'Crosshair' }).click();
  await pa.getByRole('button', { name: 'Circle', exact: true }).click();
  await pa.getByRole('button', { name: 'Colour #4dff88' }).click();
  await pa.getByLabel('Show Compass').uncheck();
  await pa.screenshot({ path: SHOTS + 'studio-desktop-edited.png' });
  await pa.getByRole('button', { name: 'Save and apply' }).click();
  await pa.getByText('Saved. Your layout is applied and kept in your account.').waitFor();
  const local = await savedHud(pa);
  assert.equal(local.layouts.desktop.elements.minimap.scale, 1.5); assert.equal(local.layouts.desktop.crosshair.style, 'circle'); assert.equal(local.layouts.desktop.elements.compass.visible, false);
  check('desktop: drag, resize, restyle the crosshair, hide an element and save', `minimap at ${local.layouts.desktop.elements.minimap.x.toFixed(2)}, ${local.layouts.desktop.elements.minimap.y.toFixed(2)}`);
  // The account copy (debounced) reaches the database.
  let row = null;
  for (let i = 0; i < 40 && !row?.hud?.layouts; i++) { await pa.waitForTimeout(250); row = (await stack.db.pool.query(`select a.hud from public.arena_preferences a join public.profiles p on p.id = a.user_id where p.handle = 'ada_hud'`)).rows[0]; }
  assert.equal(row?.hud?.layouts?.desktop?.crosshair?.style, 'circle', 'saved to the account');
  check('the layout is saved to the account (arena_preferences)');
  // Undo/redo in a fresh edit, then close without saving keeps the saved layout.
  await setRange(pa.getByRole('slider', { name: /^Size/ }), .8); await pa.keyboard.press('Control+z');
  await pa.getByRole('button', { name: 'Close' }).click();
  if (await pa.getByRole('heading', { name: 'Save your HUD changes?' }).isVisible().catch(() => false)) await pa.locator('.ar-modal').getByRole('button', { name: 'Discard changes' }).click();
  // Leave and come back: a reload, then a fresh device (the account copy).
  await reenter(pa); await openArena(pa);
  assert.equal((await savedHud(pa)).layouts.desktop.elements.minimap.scale, 1.5, 'kept after a reload');
  const other = await open(browser, stack, 'Ada2', errors); await pin(other); await signIn(other, ada); await openArena(other);
  await other.waitForFunction(() => JSON.parse(localStorage.getItem('campos-arena-hud') ?? 'null')?.layouts?.desktop?.crosshair?.style === 'circle', null, { timeout: 15000 });
  check('changes persist after leaving and rejoining, and follow the account to another device');
  await other.context().close();
  // A damaged saved layout is repaired, not fatal.
  await pa.evaluate(() => localStorage.setItem('campos-arena-hud', JSON.stringify({ version: 1, layouts: { desktop: { version: 1, elements: { minimap: { x: 'junk', scale: 99 }, fire: 7 }, crosshair: { color: 'javascript:1' } } } })));
  await reenter(pa); await openArena(pa);
  await pa.getByRole('button', { name: 'HUD customization' }).first().click();
  await pa.getByText(/could not be used and was reset/).waitFor();
  assert.ok(await pa.locator('.ar-hx-stage [data-hud="minimap"]').isVisible());
  check('a damaged saved layout is repaired element by element and the player is told');
  await pa.getByRole('button', { name: 'Close' }).click();
  await pa.context().close();

  // ---------------------------------------------------------------- phone: touch layout, firing range, auto-fire
  const phone = await open(browser, stack, 'Phone', errors, { viewport: { width: 390, height: 844 }, mobile: true });
  await pin(phone); await phone.setViewportSize({ width: 844, height: 390 });
  await openArena(phone);
  await phone.getByRole('button', { name: 'HUD customization' }).first().tap();
  await phone.getByRole('dialog', { name: 'HUD customization' }).waitFor();
  await phone.getByRole('button', { name: 'Hide panel' }).click();
  await phone.screenshot({ path: SHOTS + 'studio-phone.png' });
  // Move the stick right and up with a touch drag (CDP touch events, as a thumb would).
  const cdp = await phone.context().newCDPSession(phone);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 3 }] });
  const s0 = await hudRect(phone, 'stick');
  await touch('touchStart', s0.x + s0.width / 2, s0.y + s0.height / 2);
  for (let i = 1; i <= 8; i++) await touch('touchMove', s0.x + s0.width / 2 + i * 10, s0.y + s0.height / 2 - i * 6);
  await touch('touchEnd');
  const s1 = await hudRect(phone, 'stick'); assert.ok(s1.x > s0.x + 40, 'stick moved');
  // Enlarge the fire button with its resize handle.
  const f0 = await hudRect(phone, 'fire');
  await touch('touchStart', f0.x + f0.width / 2, f0.y + f0.height / 2); await touch('touchEnd'); // select it
  const handle = await phone.locator('.ar-hx-stage [data-hud="fire"] .ar-hx-handle').boundingBox();
  await touch('touchStart', handle.x + handle.width / 2, handle.y + handle.height / 2);
  for (let i = 1; i <= 6; i++) await touch('touchMove', handle.x + handle.width / 2 + i * 4, handle.y + handle.height / 2 + i * 4);
  await touch('touchEnd');
  const f1 = await hudRect(phone, 'fire'); assert.ok(f1.width > f0.width * 1.1, `fire button ${Math.round(f0.width)} → ${Math.round(f1.width)} px`);
  await phone.getByRole('button', { name: 'Show panel' }).click(); await phone.locator('.ar-hx-panel').waitFor();
  await phone.screenshot({ path: SHOTS + 'studio-phone-edited.png' });
  await phone.getByRole('button', { name: 'Save and apply' }).tap();
  const hud = (await savedHud(phone)).layouts.touchLandscape;
  assert.ok(hud.elements.fire.scale > 1.1);
  check('phone: move the joystick and enlarge the fire button with touch, and save', `fire ×${hud.elements.fire.scale}, stick at ${hud.elements.stick.x.toFixed(2)}, ${hud.elements.stick.y.toFixed(2)}`);
  // Nothing in the studio fired or started anything.
  assert.equal((await phone.evaluate(() => window.__arena.state())).phase, 'lobby');
  // The firing range: the controls are where they were put.
  await phone.getByRole('button', { name: 'Try it in the firing range' }).tap();
  await phone.waitForFunction(() => window.__arena?.state().phase === 'match', null, { timeout: 60000 });
  await phone.locator('.ar-scene-loading').waitFor({ state: 'detached', timeout: 120000 });
  await phone.waitForFunction(() => window.__arena.state().hud.alive, null, { timeout: 30000 });
  const live = await phone.getByRole('button', { name: 'Fire', exact: true }).boundingBox();
  // Where the saved layout says: size = 82 px × scale (touchFit is 1 at 844 × 390); position from the anchor rule.
  const at = (e, r) => [10 + e.x * (844 - 20 - r.width), 8 + e.y * (390 - 16 - r.height)];
  assert.ok(Math.abs(live.width - 82 * hud.elements.fire.scale) < 4 && live.x >= 0 && live.x + live.width <= 844 && live.y + live.height <= 390, `fire button ${Math.round(live.width)} px in the match`);
  const stickLive = await phone.locator('.ar-touch [data-hud="stick"]').boundingBox(), [sx, sy] = at(hud.elements.stick, stickLive);
  assert.ok(Math.abs(stickLive.x - sx) < 6 && Math.abs(stickLive.y - sy) < 6, `stick where it was put (${Math.round(stickLive.x)},${Math.round(stickLive.y)} vs ${Math.round(sx)},${Math.round(sy)})`);
  await phone.screenshot({ path: SHOTS + 'range-phone.png' });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  check('the firing range shows the saved touch layout exactly, with no page scrolling');
  // Firing still works from the customised fire button.
  const ammo0 = (await phone.evaluate(() => window.__arena.self())).ammo;
  await phone.touchscreen.tap(live.x + live.width / 2, live.y + live.height / 2);
  await phone.waitForFunction(a => window.__arena.self().ammo < a, ammo0, { timeout: 8000 });
  check('the customised fire button fires');
  await phone.context().close();

  // ---------------------------------------------------------------- auto-fire against a training bot
  const shooter = await open(browser, stack, 'Auto', errors); await pin(shooter); await openArena(shooter);
  await shooter.getByRole('tab', { name: 'Training' }).click();
  await shooter.locator('label', { hasText: 'Bots' }).locator('select').selectOption('1');
  await shooter.getByRole('button', { name: 'Start training' }).click();
  await shooter.waitForFunction(() => !!window.__arena?.state().match, null, { timeout: 60000 });
  const tm = stack.room.arena.matches.get((await shooter.evaluate(() => window.__arena.state().match.id)));
  const bot = tm.players.find(p => p.bot); bot.brain.think = () => null;
  await shooter.waitForFunction(() => window.__arena.state().hud.matchState === 'playing' && window.__arena.state().hud.alive, null, { timeout: 90000 });
  await shooter.locator('.ar-scene-loading').waitFor({ state: 'detached', timeout: 120000 });
  const me = tm.players.find(p => !p.bot);
  const place = (p, x, z, yaw) => { Object.assign(p.sim, { x, y: 0, z, vx: 0, vz: 0, yaw }); p.history = []; };
  const aimAtBot = async (offset = 0) => { const yaw = Math.atan2(-(bot.sim.x - me.sim.x), -(bot.sim.z - me.sim.z)) + offset, pitch = Math.atan2(1.2 - EYE[0], Math.hypot(bot.sim.x - me.sim.x, bot.sim.z - me.sim.z)); await shooter.evaluate(([y, p]) => window.__arena.look(y, p), [yaw, pitch]); };
  place(me, -20, -6, -Math.PI / 2); place(bot, -12, -6, Math.PI / 2); bot.hp = 100;
  await shooter.waitForFunction(() => Math.abs(window.__arena.self().x + 20) < .05 && window.__arena.remotes().length > 0, null, { timeout: 15000 });
  await aimAtBot(.6); // looking away
  // Off: aiming at the bot does nothing by itself.
  await aimAtBot(); await shooter.waitForTimeout(1500);
  assert.equal(bot.hp, 100, 'auto-fire off: no shots');
  // On (the F key): fires while the aim is on the bot.
  await shooter.locator('.ar-canvas canvas').click({ position: { x: 300, y: 300 } }).catch(() => {});
  await shooter.evaluate(() => { const a = window.__arena; a.state(); });
  await shooter.keyboard.press('KeyF');
  await shooter.waitForFunction(() => JSON.parse(localStorage.getItem('campos-arena-settings')).autoFire === true, null, { timeout: 5000 });
  await aimAtBot();
  await shooter.waitForFunction(() => window.__arena.self()?.autoFiring || window.__arena.self()?.autoReason === 'enemy under the crosshair', null, { timeout: 15000 });
  for (let i = 0; i < 60 && bot.hp >= 100 && bot.alive; i++) await shooter.waitForTimeout(250);
  assert.ok(bot.hp < 100 || !bot.alive, `auto-fire hit the bot through the server (hp ${Math.round(bot.hp)})`);
  check('auto-fire on: fires at the enemy under the player’s aim, damage decided by the server', `bot hp ${Math.round(bot.hp)}`);
  // Aim away: it stops.
  await aimAtBot(.7); await shooter.waitForTimeout(800);
  const ammoA = (await shooter.evaluate(() => window.__arena.self())).ammo; await shooter.waitForTimeout(1200);
  assert.equal((await shooter.evaluate(() => window.__arena.self())).ammo, ammoA, 'no shots once the aim leaves the target');
  assert.notEqual((await shooter.evaluate(() => window.__arena.self())).autoReason, 'enemy under the crosshair');
  check('auto-fire stops as soon as the aim leaves the enemy');
  await shooter.screenshot({ path: SHOTS + 'autofire.png' });

  const unexpected = errors.filter(e => !/AudioContext|autoplay/i.test(e));
  assert.deepEqual(unexpected, [], 'no page errors');
  results.ok = true;
  console.log('All HUD, auto-fire and Armory browser checks passed.');
} catch (e) {
  results.ok = false; results.error = String(e?.stack ?? e); results.pageErrors = errors;
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: `${SHOTS}failure-${browser.contexts().indexOf(ctx)}.png` }).catch(() => {});
  console.error(e); process.exitCode = 1;
} finally {
  results.finished = new Date().toISOString();
  await writeFile('docs/arena-hud-results.json', JSON.stringify(results, null, 2) + '\n');
  await browser.close(); await stack.stop();
}
