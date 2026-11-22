// Full playthrough of The Getaway in the browser with normal player inputs (keyboard and mouse events through the
// game's own input handlers): from Òrìṣun University by car through the South Gate and the Gateway Expressway to
// Metropolitan City, the contact, the warehouse, the ambush, the pursuit and containment, the escape, the
// safehouse, the reward after a reload, and the drive back to the university.
// The room's state is read for assertions and to steer the scripted driver; nothing is teleported or forced.
// Usage: node tests/browser-getaway-city.mjs   (GETAWAY_EVIDENCE=dir for screenshots, PART=journey|full)
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { open, launch, account, signIn, roomPlayer } from './support/browser.mjs';
import { CONTACT, PACKAGE, SAFEHOUSE, BARREL, O, distance } from '../shared/getaway.mjs';
import { METRO_SHIFT, regionAt } from '../shared/metro.mjs';
import { roadRoute } from '../shared/expansion.mjs';
import { collidersIn } from '../shared/campus.mjs';
import { rayBox } from '../shared/arena/physics.mjs';
import { localPoint, VEHICLE_TYPES } from '../shared/vehicles.mjs';
/** The driver's door of a vehicle (left-hand drive: the seat's side, just outside the body). */
const door = v => localPoint(v, VEHICLE_TYPES[v.type].width / 2 + .65, VEHICLE_TYPES[v.type].seats[0][1]);

const PART = process.env.PART ?? 'full';
const stack = await startStack({ name: 'browser-getaway-city', webPort: 5186, roomPort: 3286, supabasePort: 54843 });
const browser = await launch(), errors = [];
const evidence = process.env.GETAWAY_EVIDENCE ?? 'docs/screenshots/getaway-city';
await mkdir(evidence, { recursive: true });
const view = { viewport: { width: 960, height: 560 }, query: '/?qa-scale=0.4&qa-norender' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const L = (x, z) => ({ x: x + METRO_SHIFT.x, z: z + METRO_SHIFT.z });
const log = [], bugs = [], shot = {};
const note = (what, data = {}) => { const line = { t: Math.round((Date.now() - t0) / 1000), what, ...data }; log.push(line); console.log(JSON.stringify(line)); };
const t0 = Date.now();
const until = async (fn, label, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(60); }
  const final = await fn(); if (final) return final;
  throw new Error('Timed out: ' + label);
};
let page, who;
const self = () => roomPlayer(stack, who.handle);
const mission = () => self()?.getaway;
const car = () => { const c = self(); return c?.vehicle ? (mission()?.fleet.find(c.vehicle) ?? stack.room.fleet?.find?.(c.vehicle) ?? null) : null; };
const snapshot = () => { const c = self(), m = mission(); return { at: [Math.round(c?.x), Math.round(c?.z)], region: c && regionAt(c.x, c.z), stage: m?.stage, hp: m?.health, vehicle: c?.vehicle, wanted: m?.pd?.wanted, units: m?.pd?.units.length, officers: m?.pd?.units.flatMap(u => u.officers.map(o => o.mode)).join(',') }; };
const render = async () => page.evaluate(() => { const gl = window.__campusGL, scene = window.__campusScene, camera = window.__campusCamera; if (gl && scene && camera) gl.render(scene, camera); });
const proof = async name => { await render().catch(() => {}); note('screenshot ' + name, snapshot()); await page.screenshot({ path: `${evidence}/${name}.jpg`, type: 'jpeg', quality: 82, timeout: 20000 }); };
const playerInput = async action => page.evaluate(async action => {
  const { input } = await import('/src/state.ts');
  const wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
  const canvas = document.querySelector('.world canvas');
  if (action.drag) canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 1, bubbles: true }));
  dispatchEvent(new MouseEvent('mousemove', { movementX: Math.round(wrap(input.yaw - action.yaw) / .0032), movementY: Math.round((action.pitch - input.pitch) / .0022) }));
  if (action.drag) dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', button: 1 }));
}, action);
const look = async (x, z, pitch = .1) => { const c = self(); return playerInput({ yaw: Math.atan2(x - c.x, z - c.z) - Math.PI, pitch, drag: true }); };
async function walk(x, z, { radius = 1.3, timeout = 30000, sprint = true } = {}) {
  if (distance(self(), { x, z }) < radius) return;
  if (sprint) await page.keyboard.down('Shift');
  try {
    await look(x, z, -.02); await page.keyboard.down('w');
    // Like a player: if something is in the way (a parked car, a bin), sidestep and carry on.
    let last = { x: self().x, z: self().z, at: Date.now() }, side = 'a';
    await until(async () => {
      const p = self();
      if (distance(p, { x, z }) < radius) return true; if (mission()?.failed) throw Error(mission().failed);
      if (distance(p, last) > .6) last = { x: p.x, z: p.z, at: Date.now() };
      else if (Date.now() - last.at > 1500) { await page.keyboard.down(side); await sleep(900); await page.keyboard.up(side); side = side === 'a' ? 'd' : 'a'; last.at = Date.now(); }
      await look(x, z, -.02); return false;
    }, `walk to ${x},${z} ${JSON.stringify(snapshot())}`, timeout);
  } finally { await page.keyboard.up('w'); if (sprint) await page.keyboard.up('Shift'); }
  await sleep(170);
}
const trigger = async () => page.keyboard.press('e');
/** Drives (W/A/S/D/Space) through a list of points; reverses out when stuck. Returns when within radius of the last. */
async function drive(points, { radius = 6, fast = 20, timeout = 240000, stopAtEnd = true, onTick = null } = {}) {
  let startAt = null, forward = false, steering = '', braking = false, back = false, i = 0, stuckSince = null, reverseUntil = 0, last = null;
  const set = async (key, on) => on ? page.keyboard.down(key) : page.keyboard.up(key);
  try {
    await until(async () => {
      const v = car(), m = mission();
      if (!v) throw Error('Not driving ' + JSON.stringify(snapshot()));
      if (m?.failed) throw Error(m.failed);
      if (onTick && await onTick(v)) return true;
      while (i < points.length - 1 && distance(v, points[i]) < 9) i++;
      const q = points[i], d = distance(v, q);
      if (i === points.length - 1 && d < radius) return true;
      // Follow the road line (pure pursuit, 14 m ahead), keeping 1.8 m right of the centre line as traffic does.
      const p0 = i > 0 ? points[i - 1] : (startAt ??= { x: v.x, z: v.z }), sx = q.x - p0.x, sz = q.z - p0.z, sl = Math.hypot(sx, sz) || 1;
      const ux = sx / sl, uz = sz / sl, along = Math.min(sl, Math.max(0, (v.x - p0.x) * ux + (v.z - p0.z) * uz) + 14);
      const aim = d > 16 ? { x: p0.x + ux * along - uz * 1.8, z: p0.z + uz * along + ux * 1.8 } : q;
      const err = angle(Math.atan2(aim.x - v.x, aim.z - v.z) - v.yaw);
      const end = i === points.length - 1 && stopAtEnd ? Math.max(3, d * .7) : fast;
      const max = Math.min(end, Math.abs(err) > .75 ? 4 : Math.abs(err) > .3 ? 8 : fast);
      if (Math.abs(v.speed) < .4) { stuckSince ??= Date.now(); if (Date.now() - stuckSince > 2200) { reverseUntil = Date.now() + 1500; stuckSince = null; } } else stuckSince = null;
      const reversing = Date.now() < reverseUntil;
      const next = reversing ? (err > 0 ? 'd' : 'a') : err > .035 ? 'a' : err < -.035 ? 'd' : '';
      const gas = !reversing && v.speed < max, slow = !reversing && v.speed > max + 1.5;
      if (next !== steering) { if (steering) await set(steering, false); steering = next; if (next) await set(next, true); }
      if (forward !== gas) { forward = gas; await set('w', gas); }
      if (back !== reversing) { back = reversing; await set('s', reversing); }
      if (braking !== slow) { braking = slow; await set('Space', slow); }
      if (!last || Date.now() - last > 15000) { last = Date.now(); note('driving', { ...snapshot(), speed: +v.speed.toFixed(1), waypoint: `${i + 1}/${points.length}` }); }
      return false;
    }, `drive ${JSON.stringify(points.at(-1))} ${JSON.stringify(snapshot())}`, timeout);
  } finally { if (forward) await set('w', false); if (steering) await set(steering, false); if (braking) await set('Space', false); if (back) await set('s', false); }
}
async function stop() { await page.keyboard.down('Space'); await until(() => Math.abs(car()?.speed ?? 0) < .3, 'stopped', 8000); await page.keyboard.up('Space'); }
const routeTo = (from, to) => roadRoute(from, to).points.map(p => ({ x: p.x, z: p.z })).concat([to]);
function visible(p, a) {
  const dx = a.x - p.x, dz = a.z - p.z, len = Math.hypot(dx, dz); if (len < .5) return false;
  return !collidersIn(Math.min(p.x, a.x), Math.min(p.z, a.z), Math.max(p.x, a.x), Math.max(p.z, a.z)).some(b => rayBox(p.x, 1.5, p.z, dx / len, 0, dz / len, b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, b.h, b.z + b.d / 2, len, null) >= 0);
}
async function shootAt(a, h = 1.15) {
  const m = mission(), p = self(), w = m.guns[m.arm];
  if (!w.mag) { await page.keyboard.press('r'); await until(() => m.guns[m.arm].mag, 'reload', 8000); }
  await look(a.x, a.z, -Math.atan2(h + .37 - (1.5 + p.y), distance(p, a)) + m.recoil);
  await page.evaluate(() => { const c = document.querySelector('.world canvas'); c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 2, bubbles: true })); c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, bubbles: true })); dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', button: 0 })); });
  await sleep(w.id === 'bastion' ? 870 : 240);
  return w.id;
}
async function sweep(points, stage) {
  const used = new Set();
  for (let round = 0; round < 3 && mission().stage === stage; round++) for (const p0 of points) {
    if (mission().stage !== stage) break;
    await walk(p0.x, p0.z, { sprint: false, radius: .85, timeout: 12000 }).catch(e => note('walk blocked', { error: e.message.slice(0, 80) }));
    for (let n = 0; n < 18 && mission().stage === stage; n++) {
      const m = mission(), p = self();
      const a = m.actors.filter(a => a.hp > 0 && visible(p, a)).sort((a, b) => distance(p, a) - distance(p, b))[0];
      if (!a) break;
      used.add(await shootAt(a, 1.15));
      if (used.size === 1 && m.defeated >= 1 && m.arm === 0) { await page.keyboard.press('2'); await sleep(440); }
      if (m.failed) throw Error(m.failed);
    }
  }
  return [...used];
}

try {
  who = await account(stack, 'cityqa', 'City QA');
  page = await open(browser, stack, 'City QA', errors, view);
  await signIn(page, who);
  await until(self, 'room verified account');
  note('on campus', snapshot());
  // ACT 1: the briefing arrives on campus and sets the route.
  await page.getByRole('button', { name: 'Set route to Sade' }).first().click({ timeout: 20000 });
  await proof('01-campus-briefing');
  const campusCar = stack.room.fleet.find('courtyard-car');
  // Out through the courtyard gateway (the boundary wall has one opening, between the pylons).
  await walk(0, 46, { radius: 1.2 }); await walk(0, 56, { radius: 1.2 });
  { const d = door(campusCar); await walk(d.x, d.z, { radius: 1.2 }); }
  await trigger();
  await until(() => self().vehicle === 'courtyard-car', 'in the campus car');
  note('took the courtyard car');
  const toGate = routeTo(campusCar, { x: 0, z: 1240 });
  await drive(toGate, { radius: 10, fast: 21, stopAtEnd: false, onTick: v => { if (!shot.campus && v.z > 300) { shot.campus = true; return false; } return false; } });
  await proof('02-south-gate');
  await drive(routeTo(car(), { x: 0, z: 1480 }), { radius: 10, fast: 23, stopAtEnd: false });
  await proof('03-gateway-expressway');
  await drive(routeTo(car(), { x: CONTACT.x - 6, z: CONTACT.z + 4.5 }), { radius: 5, fast: 18 });
  await stop();
  await proof('04-metropolitan-city');
  assert.equal(regionAt(self().x, self().z), 'metro');
  note('arrived in Metropolitan City', snapshot());
  await trigger(); await until(() => !self().vehicle, 'out of the car');
  // ACT 2: Sade. (Round the front of the parked car to the sidewalk.)
  { const v = stack.room.fleet.find('courtyard-car'), front = localPoint(v, 0, VEHICLE_TYPES[v.type].length / 2 + 1.6); await walk(front.x, front.z, { radius: 1, sprint: false }); }
  await walk(CONTACT.x, CONTACT.z + .9, { radius: 1.4, sprint: false });
  await page.getByRole('button', { name: 'Talk to Sade', exact: true }).waitFor({ timeout: 8000 });
  await trigger();
  await page.getByRole('button', { name: 'Accept assignment' }).waitFor();
  await proof('05-contact-sade');
  await page.getByRole('button', { name: 'Accept assignment' }).click();
  await until(() => mission()?.stage === O.warehouse, 'mission accepted');
  note('assignment accepted');
  if (PART === 'journey') { await writeFile(`${evidence}/playthrough.json`, JSON.stringify({ part: PART, log, errors, bugs }, null, 2)); process.exit(0); }
  // ACT 3: to the Industrial District on foot along the streets (300 m; the drive in was the journey above).
  for (const q of routeTo(self(), L(162, 50)).slice(1)) await walk(q.x, q.z, { radius: 2.5, timeout: 60000 });
  await proof('06-industrial-district');
  // ACT 4: the warehouse.
  await walk(...Object.values(L(171, 42)));
  await walk(...Object.values(L(191, 29)), { timeout: 20000 });
  await walk(...Object.values(L(191, 21)), { radius: 1.1 });
  await until(() => mission()?.stage === O.combat, 'combat starts');
  note('warehouse encounter');
  const used = await sweep([L(191, 20), L(190, 16), L(189, 11), L(192, 6), L(199, 5), L(200, 13), L(194, 14), L(187, 13)], O.combat);
  assert.equal(mission().stage, O.package, JSON.stringify(snapshot()));
  assert.ok(used.length >= 2, 'two weapons used: ' + used.join(','));
  note('warehouse cleared', { weapons: used });
  await proof('07-warehouse-cleared');
  // ACT 5: the package.
  await walk(PACKAGE.x, PACKAGE.z, { radius: 1.4 }); await trigger();
  await until(() => mission().carried, 'picked up the case');
  note('case secured');
  // ACT 6: the ambush and the fuel drum.
  await walk(...Object.values(L(191, 28.5)), { radius: 1.1 });
  await until(() => mission().ambushed, 'ambush');
  await page.keyboard.press('3'); await sleep(330);
  await look(BARREL.x, BARREL.z, Math.atan2(.82, distance(self(), BARREL)));
  await page.evaluate(() => { document.querySelector('.world canvas').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0 })); dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', button: 0 })); });
  await until(() => mission().exploded, 'fuel drum explodes', 15000);
  await proof('08-ambush-explosion');
  await page.keyboard.press('2'); await sleep(300);
  await sweep([L(191, 33), L(191, 39), L(204, 39), L(216, 40), L(187, 36.5), L(175, 37)], O.ambush);
  assert.equal(mission().stage, O.vehicle, JSON.stringify(snapshot()));
  // ACT 7: the getaway vehicle and the police.
  const compact = mission().fleet.find('getaway-compact');
  await walk(...Object.values(L(211, 40)));
  { const d = door(compact); await walk(d.x, d.z, { radius: 1.1 }); } await trigger();
  await until(() => mission()?.stage === O.pursuit, 'getaway car taken');
  note('pursuit begins', snapshot());
  await drive(routeTo(car(), L(265, 55.55)), { radius: 8, fast: 16, stopAtEnd: false });
  // Let the police catch up: stop and wait to be contained, then watch the officers.
  await stop();
  const contained = await until(() => mission().pd.containment && mission().pd.units.some(u => u.officers.some(o => o.mode === 'cover' || o.mode === 'aim')), 'officers out of their cars, in cover', 90000).catch(e => { bugs.push({ what: 'no containment', detail: e.message }); return false; });
  if (contained) {
    const officers = mission().pd.units.flatMap(u => u.officers);
    note('contained: officers deployed', { officers: officers.map(o => `${o.mode}@${Math.round(distance(o, self()))}m`) });
    await sleep(4500);
    await proof('09-police-containment');
  }
  // Break out and evade.
  const far = SAFEHOUSE.x > 0 ? { x: 450, z: 2020 } : { x: 300, z: 2020 };
  await page.keyboard.down('s'); await sleep(1200); await page.keyboard.up('s');
  await drive(routeTo(car(), far), { radius: 15, fast: 23, stopAtEnd: false, timeout: 200000, onTick: () => mission().stage >= O.safehouse });
  if (mission().stage === O.pursuit) await drive(routeTo(car(), { x: -470, z: 2020 }), { radius: 15, fast: 23, stopAtEnd: false, timeout: 200000, onTick: () => mission().stage >= O.safehouse });
  await until(() => mission().stage >= O.safehouse, 'police lost', 120000);
  note('police evaded', snapshot());
  await proof('10-evaded');
  await drive(routeTo(car(), { x: SAFEHOUSE.x + 6, z: SAFEHOUSE.z + 4 }), { radius: 4, fast: 16 });
  await stop(); await trigger(); await until(() => !self().vehicle, 'out at the safehouse');
  await walk(SAFEHOUSE.x, SAFEHOUSE.z, { radius: 1.7, sprint: false });
  await trigger();
  await page.getByText(/\+500 campaign XP/).waitFor({ timeout: 15000 });
  await proof('11-debrief');
  await page.getByRole('button', { name: 'Return to free roam' }).click();
  // Persistence: reload the game and check the receipt.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click({ timeout: 120000 });
  await page.getByRole('button', { name: 'Your profile, @cityqa' }).waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await page.getByText('Completed · 500 campaign XP · 250 credits · Loose ends', { exact: true }).waitFor();
  await proof('12-saved-after-reload');
  await page.keyboard.press('Escape');
  note('reward persisted after reload', snapshot());
  // Return journey: the courtyard car is still in the city; drive it back through the South Gate.
  const back = stack.room.fleet.find('courtyard-car');
  note('return journey from', { car: [Math.round(back.x), Math.round(back.z)], player: snapshot().at });
  { const d = door(back); await walk(d.x, d.z, { radius: 1.2, timeout: 120000 }); }
  await trigger(); await until(() => self().vehicle === 'courtyard-car', 'in the car again');
  await drive(routeTo(car(), { x: 0, z: 80 }), { radius: 10, fast: 23, timeout: 260000 });
  assert.equal(regionAt(self().x, self().z), 'campus');
  await proof('13-back-on-campus');
  note('back at the university', snapshot());
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify(snapshot()), errors);
  console.error('diagnostics', await page?.evaluate(() => ({ url: location.href, canvases: document.querySelectorAll('canvas').length, panel: document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null, text: document.body.innerText.slice(0, 300) })).catch(e => String(e)));
  await render().catch(() => {});
  await page?.screenshot({ path: `${evidence}/failure.jpg`, type: 'jpeg', timeout: 15000 }).catch(() => {});
  bugs.push({ what: 'playthrough stopped', detail: String(error.message).slice(0, 400), at: snapshot() });
  process.exitCode = 1;
} finally {
  await writeFile(`${evidence}/playthrough.json`, JSON.stringify({ part: PART, log, errors, bugs }, null, 2)).catch(() => {});
  await browser.close(); await stack.stop();
}

