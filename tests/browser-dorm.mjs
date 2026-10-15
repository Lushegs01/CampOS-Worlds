// Your room in Palm House, in real browsers: walk from the gate to Palm House, go through the residents'
// door, arrange and save furniture, walk into it, check that another player neither sees you in your
// room nor is seen from it, leave, and use the room on a phone (the phone resumes the same session).
// Usage: TEST_URL=http://localhost:5173 node tests/browser-dorm.mjs   (needs `npm run dev`)
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch, QUERY } from './support/browser.mjs';
import { DORM_INSIDE, DORM_OUTSIDE, DORM_ROOM, inDormRoom } from '../shared/dorm.mjs';

const base = process.env.TEST_URL || 'http://localhost:5173', shots = 'docs/screenshots/dorm';
await mkdir(shots, { recursive: true });
const browser = await launch(), results = [], errors = [];
const pass = label => { results.push(label); console.log('PASS', label); };
async function open(name, { phone = false, token } = {}) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1100, height: 720 } });
  await ctx.addInitScript(([n, t]) => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n }, version: 0 })); if (t && !sessionStorage.getItem('campus-session')) sessionStorage.setItem('campus-session', t); }, [name, token]);
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(base + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.waitForFunction(() => window.__campusInspect?.().status === 'connected', null, { timeout: 60000 });
  return page;
}
const state = p => p.evaluate(() => window.__campusDebug.state());
/** Walk with the QA steering hook (the normal input path), then wait until the room agrees where we are. */
async function walk(p, x, z) {
  await p.evaluate(([x, z]) => window.__campusDebug.walkTo(x, z), [x, z]);
  await p.waitForFunction(() => !window.__campusDebug.walking(), null, { timeout: 130000 });
  await p.waitForFunction(() => { const s = window.__campusDebug.state(); return Math.hypot(s.room.x - s.x, s.room.z - s.z) < 1; }, null, { timeout: 60000 });
  const s = await state(p); assert.ok(Math.hypot(s.x - x, s.z - z) < 1.5, `reached (${x}, ${z}): at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
}
const focus = p => p.evaluate(() => window.__campusDebug.focus()?.label ?? null);
/** Is this player's avatar drawn in that page (their group visible)? */
const drawn = (p, id) => p.evaluate(id => { const tag = window.__campusScene.getObjectByName(`tag:${id}`); return !!tag && tag.parent.visible; }, id);

try {
  const ada = await open('Ada Resident'), adaId = await ada.evaluate(() => window.__campusNet.id());
  // ---- 1. From the gate to the residents' door at the back of Palm House's common room.
  for (const [x, z] of [[0, 57], [200, 57], [420, 57], [648, 57], [648, 30], [648, 20], [651, 17], [651, 1.6], [DORM_OUTSIDE.x, DORM_OUTSIDE.z]]) await walk(ada, x, z);
  await ada.evaluate(() => window.__campusDebug.face(Math.PI));
  await ada.waitForFunction(() => window.__campusDebug.focus()?.label === 'Go to your room', null, { timeout: 20000 });
  await ada.waitForTimeout(3000); await ada.screenshot({ path: `${shots}/1-residents-door.png` });
  pass('the residents’ door in Palm House’s common room offers “Go to your room”');

  // ---- 2. In: the room server moves us into the wing; our room, our card, our label.
  await ada.keyboard.press('KeyE');
  await ada.locator('.dorm-hud').waitFor({ timeout: 30000 });
  let s = await state(ada);
  assert.ok(inDormRoom(s.x, s.z) && Math.hypot(s.x - DORM_INSIDE.x, s.z - DORM_INSIDE.z) < .5, `inside the room at (${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
  assert.equal(await ada.locator('.location-hud h3').textContent(), 'Your room');
  assert.ok(await ada.evaluate(() => (window.__campusScene.getObjectByName('dorm-furniture')?.children.length ?? 0) > 3), 'the default furniture is drawn');
  await ada.waitForTimeout(4000); await ada.screenshot({ path: `${shots}/2-room.png` });
  pass('going through the door opens a furnished room, with its card and “Your room” label');

  // ---- 3. Another player: does not see Ada while she is in her room, and she does not see them.
  const tobi = await open('Tobi Outside'), tobiId = await tobi.evaluate(() => window.__campusNet.id());
  await tobi.waitForFunction(id => !!window.__campusScene.getObjectByName(`tag:${id}`), adaId, { timeout: 30000 });
  await ada.waitForFunction(id => !!window.__campusScene.getObjectByName(`tag:${id}`), tobiId, { timeout: 30000 });
  await tobi.waitForTimeout(1500);
  assert.equal(await drawn(tobi, adaId), false, 'Ada, in her room, is not drawn on campus');
  assert.equal(await drawn(ada, tobiId), false, 'nobody from outside is drawn in Ada’s room');
  assert.ok(await tobi.evaluate(() => document.body.textContent.includes('2 online')), 'Ada is still online for everyone');
  pass('a player in their room is private: not drawn for others, and others not drawn in it');

  // ---- 4. Arrange: add a floor lamp on the plan, try an overlap (refused before saving), save.
  await ada.getByRole('button', { name: 'Arrange room' }).click();
  await ada.locator('.dorm-plan').waitFor();
  await ada.getByRole('button', { name: /^Floor lamp/ }).click();
  // Tap a room-relative point (metres) on the plan, through the plan's own screen transform.
  const tap = async (x, z) => { const p = await ada.evaluate(([x, z]) => { const q = new DOMPoint(x, z).matrixTransform(document.querySelector('.dorm-plan').getScreenCTM()); return { x: q.x, y: q.y }; }, [x, z]); await ada.mouse.click(p.x, p.y); };
  await tap(.5, 4.8); // south-west corner
  await ada.getByText(/10 of 16 pieces/).waitFor();
  await ada.getByRole('button', { name: /^Turn$/ }).waitFor();
  // Moving the lamp onto the bed is refused by the shared rules, and Save is disabled.
  for (let i = 0; i < 17; i++) await ada.getByRole('button', { name: 'Move north' }).click();
  await ada.getByText(/overlaps the bed/).waitFor();
  assert.equal(await ada.getByRole('button', { name: 'Save room' }).isDisabled(), true);
  for (let i = 0; i < 17; i++) await ada.getByRole('button', { name: 'Move south' }).click();
  await ada.screenshot({ path: `${shots}/3-arrange.png` });
  await ada.getByRole('button', { name: 'Save room' }).click();
  await ada.getByText('Saved for this visit.').waitFor({ timeout: 30000 });
  await ada.getByRole('button', { name: 'Close panel' }).click();
  assert.ok(await ada.evaluate(async () => (await import('/src/dorm/client.ts')).useDorm.getState().layout.items.some(i => i.t === 'lamp' && Math.abs(i.x - .5) < .01)), 'the saved layout has the lamp');
  pass('arranging: a new piece placed on the plan, an overlap refused before saving, the room saved');

  // ---- 5. Furniture is solid, and the client and the room agree about it (no snap back).
  await ada.evaluate(([x, z]) => window.__campusDebug.walkTo(x, z), [DORM_ROOM.x0 + 5.6, DORM_ROOM.z0 + .3]); // into the wardrobe (0.6 m deep) on the north wall
  await ada.waitForTimeout(12000); await ada.evaluate(() => window.__campusDebug.walkTo(NaN, NaN));
  await ada.waitForFunction(() => { const s = window.__campusDebug.state(); return Math.hypot(s.room.x - s.x, s.room.z - s.z) < .3; }, null, { timeout: 30000 });
  s = await state(ada);
  assert.ok(s.z > DORM_ROOM.z0 + .75 && Math.abs(s.x - DORM_ROOM.x0 - 5.6) < .6, `stopped by the wardrobe (${(s.z - DORM_ROOM.z0).toFixed(2)} m from the north wall)`);
  pass('furniture blocks walking, and the room server agrees with the client');

  // ---- 6. Leave from the card: back by the door in the common room, and visible to others again.
  await ada.getByRole('button', { name: 'Leave room' }).click();
  await ada.locator('.dorm-hud').waitFor({ state: 'detached', timeout: 30000 });
  s = await state(ada);
  assert.ok(!inDormRoom(s.x, s.z) && Math.hypot(s.x - DORM_OUTSIDE.x, s.z - DORM_OUTSIDE.z) < .6, 'back in the common room by the door');
  await tobi.waitForFunction(id => window.__campusScene.getObjectByName(`tag:${id}`)?.parent.visible === true, adaId, { timeout: 20000 });
  assert.equal(await drawn(ada, tobiId), true);
  pass('leaving returns to the common room door, and Ada is drawn for others again');
  await tobi.context().close();

  // ---- 7. On a phone, resuming the same session: the door, the room, the card and the editor fit.
  const token = await ada.evaluate(() => sessionStorage.getItem('campus-session'));
  await ada.context().close();
  const phone = await open('Ada Resident', { phone: true, token });
  s = await state(phone);
  assert.ok(Math.hypot(s.x - DORM_OUTSIDE.x, s.z - DORM_OUTSIDE.z) < 1, `the phone resumes by the door (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
  await phone.evaluate(() => window.__campusDebug.face(Math.PI));
  await phone.waitForFunction(() => window.__campusDebug.focus()?.label === 'Go to your room', null, { timeout: 20000 });
  await phone.locator('.touch-action').click();
  await phone.locator('.dorm-hud').waitFor({ timeout: 30000 });
  assert.ok(await phone.evaluate(async () => (await import('/src/dorm/client.ts')).useDorm.getState().layout.items.some(i => i.t === 'lamp')), 'the same session finds its arranged room');
  await phone.waitForTimeout(4000); await phone.screenshot({ path: `${shots}/4-phone-room.png` });
  await phone.getByRole('button', { name: 'Arrange room' }).click();
  await phone.locator('.dorm-plan').waitFor();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || [...document.querySelectorAll('.dorm-editor button')].some(b => { const r = b.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.width < 32 || r.height < 32; }));
  assert.equal(overflow, false, 'the editor fits a 390 px phone and its buttons are tappable');
  await phone.screenshot({ path: `${shots}/5-phone-arrange.png` });
  pass('on a phone the session resumes by the door; the room, card and editor fit and work by touch');
  await phone.context().close();

  await writeFile('docs/dorm-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log('ALL PASSED', results.length);
} catch (e) {
  console.error('FAILED', e); await writeFile('docs/dorm-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors, failure: String(e) }, null, 2)); process.exitCode = 1;
} finally { await browser.close(); }
