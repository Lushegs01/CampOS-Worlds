// Real-browser test of the interaction system against the running app and room server.
// Usage: node tests/browser-interactions.mjs   (requires `npm run dev`; ONLY=seating,doors,... to select)
// Movement goes through the normal input path (a QA steering hook stands in for the keyboard), so the
// authoritative room server validates every seat, door and ball action exactly as it would in play.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.TEST_URL || 'http://localhost:5173', OUT = 'docs/screenshots/interactions';
const only = (process.env.ONLY || '').split(',').filter(Boolean), want = s => !only.length || only.includes(s);
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [], errors = [], timings = {};
const pass = label => { results.push(label); console.log('PASS', label); };

async function open(name, { viewport = { width: 1280, height: 800 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  await ctx.addInitScript(n => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n }, version: 0 })), name);
  const page = await ctx.newPage(); page.setDefaultTimeout(20000); page.label = name;
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 120000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}
const st = p => p.evaluate(() => window.__campusDebug.state());
const focus = p => p.evaluate(() => window.__campusDebug.focus());
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
async function walk(p, x, z, tolerance = .35) {
  await p.evaluate(([x, z]) => window.__campusDebug.walkTo(x, z), [x, z]);
  await p.waitForFunction(() => !window.__campusDebug.walking(), null, { timeout: 40000 });
  const s = await st(p); assert.ok(Math.hypot(s.x - x, s.z - z) < tolerance, `${p.label}: walk to ${x},${z} ended at ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
}
async function face(p, yaw) { await p.evaluate(y => window.__campusDebug.face(y), yaw); await p.waitForTimeout(450); }
const until = (p, fn, arg, timeout = 15000) => p.waitForFunction(fn, arg, { timeout });
const toast = p => p.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
async function pressE(p) { await p.keyboard.press('KeyE'); }
/** Open or close a door with E (the room keeps door state between runs, so check first). */
async function ensureDoor(p, door, open) {
  if (!!(await st(p)).world.doors[door] === open) return;
  await until(p, l => window.__campusDebug.focus()?.label === l, open ? 'Open door' : 'Close door'); await pressE(p);
  await until(p, ([d, o]) => !!window.__campusDebug.state().world.doors[d] === o, [door, open]); await p.waitForTimeout(900);
}

let A, B;
try {
  A = await open('Ada QA'); B = await open('Tobi QA', { viewport: { width: 900, height: 600 } });
  console.log('renderer', await A.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const ex = gl.getExtension('WEBGL_debug_renderer_info'); return ex ? gl.getParameter(ex.UNMASKED_RENDERER_WEBGL) : 'unavailable'; }));

  if (want('seating')) {
    // Bench by the courtyard (-22, 13.6): two independent seats facing +z.
    await walk(A, -22.45, 14.6); await face(A, Math.PI);
    await until(A, () => window.__campusDebug.focus()?.label === 'Sit');
    const t0 = Date.now(); await pressE(A);
    await until(A, () => window.__campusDebug.state().sit?.phase === 'down'); await A.waitForTimeout(700); await shot(A, 'seat-sitting-down');
    await until(A, () => window.__campusDebug.state().sit?.phase === 'seated'); timings.sitDown = Date.now() - t0;
    await A.waitForTimeout(900); await shot(A, 'seat-bench-seated');
    const seatA = (await st(A)).sit.seat; assert.match(seatA, /^bench-4-/);
    await until(B, s => window.__campusDebug.state().world.seats[s], seatA); pass('sit on a bench with the captured sit-down; the room records the occupant');
    // B tries the same seat, is refused, then takes the other half of the bench.
    await walk(B, -22.45, 14.5); await face(B, Math.PI);
    // The prompt skips the occupied half and offers the free one; asking for the occupied seat is refused.
    await until(B, () => window.__campusDebug.focus()?.label === 'Sit');
    assert.notEqual((await focus(B)).id, seatA, 'the occupied seat is not offered');
    await B.evaluate(s => window.__campusDebug.sit(s), seatA); await B.waitForTimeout(400); assert.match(await toast(B), /taken/);
    assert.equal((await st(B)).sit, null); pass('an occupied seat refuses a second player');
    await walk(B, -21.55, 14.6); await face(B, Math.PI); await until(B, () => window.__campusDebug.focus()?.label === 'Sit');
    await pressE(B); await until(B, () => window.__campusDebug.state().sit?.phase === 'seated');
    await A.waitForTimeout(500); await shot(B, 'seat-bench-two-players'); pass('a bench seats two players independently');
    // Walking is disabled while seated; a movement key stands the player up instead.
    const before = await st(A); await A.keyboard.down('KeyW'); await A.waitForTimeout(250); await A.keyboard.up('KeyW');
    await until(A, () => window.__campusDebug.state().sit?.phase === 'up'); await A.waitForTimeout(800); await shot(A, 'seat-standing-up');
    await until(A, () => !window.__campusDebug.state().sit);
    const after = await st(A); assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 1, 'stands up in front of the seat');
    await until(B, s => !window.__campusDebug.state().world.seats[s], seatA); pass('movement input stands up through the stand-up motion and frees the seat');
    await pressE(B); await until(B, () => !window.__campusDebug.state().sit); pass('E stands up');
  }

  if (want('doors')) {
    await walk(A, -30, -2.6); await face(A, Math.PI); await ensureDoor(A, 'library-main', false);
    await until(A, () => window.__campusDebug.focus()?.label === 'Open door');
    await pressE(A); await until(A, () => window.__campusDebug.state().world.doors['library-main'] === -1);
    await until(B, () => window.__campusDebug.state().world.doors['library-main'] === -1); await A.waitForTimeout(250); await shot(A, 'door-opening'); await A.waitForTimeout(900);
    pass('the library door opens inwards, away from the player, and the room shares it');
    await walk(A, -30, -9); pass('walk through the open doorway into the library');
    await shot(A, 'library-interior-open-door');
    // B stands in the doorway: the door refuses to close on them.
    await walk(B, -29.6, -4.2);
    await face(A, 0); await until(A, () => /Close door/.test(window.__campusDebug.focus()?.label ?? '')).catch(async () => { await walk(A, -30, -6.4); await face(A, 0); });
    await until(A, () => /Close door/.test(window.__campusDebug.focus()?.label ?? ''));
    await pressE(A); await A.waitForTimeout(900); assert.match(await toast(A), /doorway/); assert.equal((await st(A)).world.doors['library-main'], -1);
    pass('a door will not close on someone standing in the doorway');
    await walk(B, -29.6, -1.5); await pressE(A); await until(A, () => window.__campusDebug.state().world.doors['library-main'] === 0);
    await A.waitForTimeout(1500); await shot(A, 'door-closed-from-inside'); pass('the door closes once the doorway is clear');
    // The closed door blocks movement.
    await A.evaluate(() => window.__campusDebug.walkTo(-30, -1)); await A.waitForTimeout(2500);
    assert.ok((await st(A)).z < -4.2, 'a closed door blocks the doorway'); await A.evaluate(() => window.__campusDebug.walkTo(-30, -6.4)); await A.waitForTimeout(1200);
    pass('a closed door is solid');
    // Locked staff door.
    await walk(A, -31.5, -21); await walk(A, -34.95, -24.8); await face(A, Math.PI);
    await until(A, () => /Locked/.test(window.__campusDebug.focus()?.label ?? '')); await pressE(A); await A.waitForTimeout(600);
    assert.match(await toast(A), /Locked · Staff only/); await shot(A, 'door-locked'); pass('a locked door explains that it is locked');
  }

  if (want('library')) {
    if (!want('doors')) { await walk(A, -30, -2.6); await face(A, Math.PI); await ensureDoor(A, 'library-main', true); await walk(A, -30, -9); }
    // Table chair at the first reading table: approach from the table side, sit, scoot in.
    await walk(A, -31.5, -21); await walk(A, -34.2, -20.3); await face(A, 0);
    await until(A, () => window.__campusDebug.focus()?.label === 'Sit'); await pressE(A);
    await until(A, () => window.__campusDebug.state().sit?.phase === 'seated'); await A.waitForTimeout(1600);
    await shot(A, 'seat-library-table'); pass('sit at a library reading table (chair scoots in)');
    await pressE(A); await until(A, () => !window.__campusDebug.state().sit, null, 20000); pass('stand up from a table chair');
    // Catalogue computer: sit, then the catalogue opens.
    await walk(A, -36.5, -11); await walk(A, -40.5, -10.1); await face(A, -Math.PI / 2);
    await until(A, () => window.__campusDebug.focus()?.label === 'Sit at computer'); await pressE(A);
    await until(A, () => window.__campusInspect().panel === 'fixture:pc-1', null, 20000);
    await A.getByPlaceholder('Title, author or subject').fill('delta'); await A.getByText('Rivers of the Delta').waitFor();
    await shot(A, 'library-computer'); await A.getByRole('button', { name: 'Close panel' }).click();
    await A.keyboard.down('KeyD'); await A.waitForTimeout(200); await A.keyboard.up('KeyD'); await until(A, () => !window.__campusDebug.state().sit, null, 20000);
    pass('use a library computer from its chair');
    // New arrivals.
    await walk(A, -30, -21.9); await face(A, Math.PI); await until(A, () => window.__campusDebug.focus()?.label === 'Browse new arrivals');
    await pressE(A); await until(A, () => window.__campusInspect().panel === 'fixture:library-books'); await shot(A, 'library-new-arrivals');
    await A.getByRole('button', { name: 'Close panel' }).click(); pass('browse the new-arrivals display');
    await walk(A, -30, -6.4); await face(A, 0); await ensureDoor(A, 'library-main', true); await walk(A, -30, -2.4); await face(A, Math.PI); await ensureDoor(A, 'library-main', false);
  }

  if (want('cafe')) {
    await walk(A, 24, -2.2); await walk(A, 26.95, -2.8); await face(A, Math.PI);
    await ensureDoor(A, 'cafe-main', true);
    await walk(A, 26.95, -7); await walk(A, 26.5, -9.4); await face(A, Math.PI);
    await until(A, () => window.__campusDebug.focus()?.label === 'Order at the counter'); await pressE(A);
    await A.getByRole('button', { name: /Jollof rice bowl/ }).click(); await A.getByRole('button', { name: /Zobo/ }).click();
    await A.getByRole('button', { name: /Place demo order/ }).click(); await A.getByText(/is being prepared/).waitFor();
    await shot(A, 'cafe-counter-order'); await A.getByRole('button', { name: 'Close panel' }).click(); pass('place a demo order at the café counter (no payment)');
    await walk(A, 33.5, -10.4); await until(A, () => window.__campusDebug.focus()?.label === 'Read the menu'); await pressE(A); await A.getByText('Puff-puff (6)').waitFor(); await A.getByRole('button', { name: 'Close panel' }).click();
    // Interior table.
    await walk(A, 35, -8.6); await until(A, () => window.__campusDebug.focus()?.label === 'Sit'); await pressE(A);
    await until(A, () => window.__campusDebug.state().sit?.phase === 'seated', null, 20000); await A.waitForTimeout(1400); await shot(A, 'cafe-seated'); pass('sit at a café table');
    await pressE(A); await until(A, () => !window.__campusDebug.state().sit, null, 20000);
    await walk(A, 26.95, -6.2); await face(A, 0); await ensureDoor(A, 'cafe-main', false); pass('café door closed from inside');
    await ensureDoor(A, 'cafe-main', true); await walk(A, 26.95, -2.6); await face(A, Math.PI); await ensureDoor(A, 'cafe-main', false);
  }

  if (want('classroom')) {
    // Round the east side of the Student House to the School of Design gallery.
    if ((await st(A)).z > 0) { await walk(A, 20, 8); await walk(A, 45, 4); } else await walk(A, 45, -2.6);
    await walk(A, 45, -30); await walk(A, 32.7, -33); await walk(A, 32.7, -35.6); await face(A, Math.PI);
    await ensureDoor(A, 'classroom-d1', true);
    await walk(A, 32.7, -37.6); await walk(A, 33.5, -38.2); await face(A, 0);
    await until(A, () => window.__campusDebug.focus()?.label === 'Sit', null, 8000); await pressE(A);
    await until(A, () => window.__campusDebug.state().sit?.phase === 'seated', null, 20000); await A.waitForTimeout(1400); await shot(A, 'classroom-seated');
    await pressE(A); await until(A, () => !window.__campusDebug.state().sit, null, 20000);
    await walk(A, 35.05, -37.9); await walk(A, 35.05, -41.6); await walk(A, 34.4, -41.6); await face(A, Math.PI); await until(A, () => window.__campusDebug.focus()?.label === 'Read the whiteboard'); await pressE(A);
    await until(A, () => window.__campusInspect().panel === 'fixture:classroom-board'); await A.getByRole('button', { name: 'Close panel' }).click();
    pass('enter Studio D1, take a desk and read the whiteboard');
    await walk(A, 35.05, -41); await walk(A, 35.05, -37.9); await walk(A, 32.7, -37.4); await walk(A, 32.7, -35.6); await face(A, 0); await ensureDoor(A, 'classroom-d1', true);
    await walk(A, 32.7, -35.2); await face(A, Math.PI); await ensureDoor(A, 'classroom-d1', false); await walk(A, 32.7, -33.5); await walk(A, 45, -30); await walk(A, 45, 4);
  }

  if (want('basketball')) {
    const ball = async (p, bid) => (await st(p)).world.balls.find(b => b.id === bid);
    const fetchBall = async (p, bid) => {
      const b = await ball(p, bid); await walk(p, b.x + (b.x < 40 ? .9 : -.9), b.z, .5); await face(p, b.x < 40 ? -Math.PI / 2 : Math.PI / 2);
      await until(p, () => window.__campusDebug.focus()?.label === 'Pick up basketball'); await pressE(p);
      await until(p, () => window.__campusDebug.state().holding);
    };
    if ((await st(A)).x > 40) await walk(A, 31, 6);
    await walk(A, 31, 22.6); await fetchBall(A, 'ball-1'); await shot(A, 'ball-held');
    const aHolder = (await ball(B, 'ball-1')).holder; assert.ok(aHolder && aHolder !== 'local', 'the room assigns the ball to A');
    pass('pick up a basketball; possession is server-validated');
    await walk(B, 31, 25.4); await walk(B, 33.3, 25.4); const bTry = (await ball(B, 'ball-1')); void bTry;
    await fetchBall(B, 'ball-2'); pass('a second player takes the other ball');
    // Dribble across the court to the free-throw line of the south hoop.
    await A.evaluate(() => window.__campusDebug.walkTo(44, 16.2)); await A.waitForTimeout(1100); await shot(A, 'ball-dribble');
    await A.waitForFunction(() => !window.__campusDebug.walking(), null, { timeout: 30000 });
    let made = 0, attempts = 0;
    for (let i = 0; i < 5; i++) {
      if (!(await st(A)).holding) { await fetchBall(A, 'ball-1'); await walk(A, 44, 16.2, .5); }
      await face(A, Math.PI);
      const before = (await st(A)).ui.hoops;
      await A.keyboard.down('Space');
      await until(A, () => window.__campusDebug.state().ui.zone);
      // Release with the needle inside the gold band, as a player would.
      await A.waitForFunction(() => { const s = window.__campusDebug.state(), z = s.ui.zone; return z && s.charge != null && s.charge > z[0] + (z[1] - z[0]) * .3 && s.charge < z[1] - (z[1] - z[0]) * .3; }, null, { timeout: 6000, polling: 'raf' });
      if (i === 0) await shot(A, 'ball-charging');
      await A.keyboard.up('Space'); attempts++;
      if (i === 0) { await A.waitForTimeout(450); await shot(A, 'ball-in-flight'); }
      await until(A, b => window.__campusDebug.state().ui.hoops.shots > b, before.shots, 6000);
      const after = (await st(A)).ui.hoops; if (after.made > before.made) made++;
      console.log(`  shot ${i + 1}: ${after.last}`);
      await A.waitForTimeout(300);
    }
    assert.ok(made >= 3, `well-timed free throws should mostly score (made ${made}/${attempts})`);
    const hud = (await st(A)).ui.hoops; assert.equal(hud.round.length, 5); assert.equal(hud.points, hud.round.reduce((a, b) => a + b, 0));
    await shot(A, 'ball-round-complete'); pass(`five-shot round under real physics: ${made}/5 made, ${hud.points} points, each counted once`);
    // A badly under-charged shot falls short and does not score.
    if (!(await st(A)).holding) { await fetchBall(A, 'ball-1'); await walk(A, 44, 16.2, .5); }
    await face(A, Math.PI); const pre = (await st(A)).ui.hoops;
    await A.keyboard.down('Space'); await A.waitForTimeout(90); await A.keyboard.up('Space');
    await until(A, b => window.__campusDebug.state().ui.hoops.shots > b, pre.shots, 6000);
    const miss = (await st(A)).ui.hoops; assert.equal(miss.made, pre.made, 'an under-charged shot misses'); console.log('  weak shot:', miss.last); pass('a weak shot misses');
    // Drop with Q; B disconnects while holding: the room frees B's ball.
    if (!(await st(A)).holding) { await fetchBall(A, 'ball-1'); }
    await A.keyboard.press('KeyQ'); await until(A, () => !window.__campusDebug.state().holding); pass('Q drops the ball');
    assert.ok((await st(B)).holding, 'B still holds ball-2');
    await B.context().close(); B = null;
    await until(A, () => window.__campusDebug.state().world.balls.find(b => b.id === 'ball-2')?.holder === null, null, 10000).catch(async () => {
      const b2 = (await st(A)).world.balls.find(b => b.id === 'ball-2'); throw Error('ball-2 still held after disconnect: ' + JSON.stringify(b2));
    });
    pass('a disconnecting player releases their ball');
  }

  if (want('mobile')) {
    const M = await open('Mobile QA', { viewport: { width: 390, height: 844 }, mobile: true });
    await walk(M, -33.55, 14.6); await face(M, Math.PI);
    await M.getByRole('button', { name: 'Sit', exact: true }).waitFor(); await M.getByRole('button', { name: 'Sit', exact: true }).tap();
    await until(M, () => window.__campusDebug.state().sit?.phase === 'seated', null, 20000); await M.waitForTimeout(800); await shot(M, 'mobile-seated');
    await M.getByRole('button', { name: 'Stand up', exact: true }).tap(); await until(M, () => !window.__campusDebug.state().sit, null, 20000);
    pass('mobile: sit and stand with the touch action button');
    await walk(M, 31, 25); const b = (await st(M)).world.balls.find(x => x.state !== 'held');
    await walk(M, b.x + .9, b.z, .6); await face(M, -Math.PI / 2);
    await M.getByRole('button', { name: 'Pick up basketball', exact: true }).tap(); await until(M, () => window.__campusDebug.state().holding);
    await shot(M, 'mobile-holding-ball'); await M.getByRole('button', { name: 'Drop the ball', exact: true }).tap(); await until(M, () => !window.__campusDebug.state().holding);
    pass('mobile: pick up and drop a ball with touch buttons');
    timings.mobileFps = await M.evaluate(() => window.__campus?.fps);
    await M.context().close();
  }

  timings.fps = await A.evaluate(() => window.__campus?.fps);
  const relevant = errors.filter(e => !/Failed to load resource.*favicon/.test(e));
  await writeFile('docs/interaction-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors: relevant, timings }, null, 2));
  assert.deepEqual(relevant, [], 'no page errors'); console.log('ALL PASSED', results.length, timings);
} catch (e) {
  console.error('FAILED', e);
  for (const p of [A, B]) if (p && !p.isClosed()) { console.log(p.label, JSON.stringify(await st(p).catch(() => null))?.slice(0, 1500)); await p.screenshot({ path: `${OUT}/failure-${p.label.replace(/\W/g, '')}.png` }).catch(() => {}); }
  await writeFile('docs/interaction-results.json', JSON.stringify({ results, errors, failure: String(e) }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
