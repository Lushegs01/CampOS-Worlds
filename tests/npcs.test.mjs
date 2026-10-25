import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NPCS, NPC_BY_ID, NPC_WALK_SPEED, TALK_SLACK, LEAVE_RANGE, ATTENTION_MS, GREET_RADIUS, GREET_REPEAT_MS, createNpcDirector, eligibility, lineClear, npcPose, onShift, routineOf, standable, validateNpc, validateNpcs } from '../shared/npcs.mjs';
import { CAMPUS_BUILDINGS, BUILDING_BY_ID, createBuildingState, isPlace, parseCompletionOverrides, validCompletion, validateBuildings } from '../shared/buildings.mjs';
import { CAFE_MENU, validateOrder } from '../shared/cafe.mjs';
import { SEATS, seatApproach, BALLS, DOORS } from '../shared/interactions.mjs';
import { setDoorOpen } from '../shared/campus.mjs';

const T = 1_800_000_000_000;
const at = t => () => t;
/** A director whose clock we set; every character starts its routine at T. */
function director(overrides = {}, t = T) { const clock = { t }; const d = createNpcDirector({ overrides, now: () => clock.t }); return Object.assign(d, { clock }); }
/** A room time when a character is waiting at `stop` (the middle of that wait), given its routine epoch. */
function whenAt(d, id, stop) {
  const r = routineOf(NPC_BY_ID.get(id)), s = d.npcs.get(id); let t = 0;
  for (const step of r.steps) { if (step.at === stop) return s.epoch + t + step.dwell / 2; t += step.dwell + step.walk; }
  throw Error(`${id} never waits at ${stop}`);
}

// ------------------------------------------------------------------ configuration
test('every character has a unique id, a real building and place, and a valid definition (deep, with reachability)', () => {
  const ids = NPCS.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.ok(ids.length >= 8 && ids.length <= 12, 'a purposeful cast, not a crowd');
  for (const core of ['teacher', 'vendor', 'librarian', 'services-officer', 'event-host', 'coach', 'residence-assistant', 'research-assistant']) assert.ok(NPC_BY_ID.has(core), `${core} is in the cast`);
  assert.deepEqual(validateNpcs(NPCS, { deep: true }), []);
  assert.deepEqual(validateBuildings(), []);
  for (const d of NPCS) { const b = BUILDING_BY_ID.get(d.building); assert.ok(b, `${d.id}: building exists`); assert.ok(isPlace(b.location), `${d.id}: ${b.location} is a real place`); }
});

test('completion percentages and thresholds are numbers from 0 to 100; overrides are validated', () => {
  for (const b of CAMPUS_BUILDINGS) assert.ok(typeof b.completion === 'number' && b.completion >= 0 && b.completion <= 100, b.id);
  for (const d of NPCS) assert.ok(Number.isFinite(d.threshold) && d.threshold >= 0 && d.threshold <= 100, d.id);
  for (const bad of [-1, 100.5, NaN, Infinity, null, undefined, {}, [], '1e3', 'abc', '', '-5', '101']) assert.equal(validCompletion(bad), null, JSON.stringify(bad));
  assert.equal(validCompletion(0), 0); assert.equal(validCompletion(100), 100); assert.equal(validCompletion(' 40 '), 40, 'configuration text is read as a number');
  assert.deepEqual(parseCompletionOverrides('studio-d1=70, courtyard-cafe=35'), { 'studio-d1': 70, 'courtyard-cafe': 35 });
  assert.deepEqual(parseCompletionOverrides(''), {});
  assert.throws(() => parseCompletionOverrides('studio-d1=101'), /0 to 100/);
  assert.throws(() => parseCompletionOverrides('narnia=50'), /unknown building/);
  assert.throws(() => parseCompletionOverrides('studio-d1=abc'), /0 to 100/);
  const state = createBuildingState({ 'studio-d1': 'garbage', 'no-such': 50 });
  assert.equal(state.get('studio-d1').completion, BUILDING_BY_ID.get('studio-d1').completion, 'invalid override ignored');
  for (const bad of [{ completion: -5 }, { completion: 101 }, { completion: '80' }, { completion: NaN }, { available: 'yes' }]) assert.equal(state.set('studio-d1', bad).ok, false, JSON.stringify(bad));
  assert.equal(state.set('../etc', { completion: 50 }).ok, false);
  assert.equal(state.revision, 0, 'refused changes change nothing');
  assert.equal(state.load([{ id: 'studio-d1', completion: 500, available: true }, { id: 'x', completion: 1, available: true }]), false);
});

test('the shipped defaults put the teacher and the vendor on duty from the start', () => {
  assert.ok(BUILDING_BY_ID.get('studio-d1').completion >= 80);
  assert.ok(BUILDING_BY_ID.get('courtyard-cafe').completion >= 40);
  assert.equal(NPC_BY_ID.get('teacher').threshold, 80);
  assert.equal(NPC_BY_ID.get('vendor').threshold, 40);
  assert.equal(NPC_BY_ID.get('librarian').threshold, 60);
  const d = director();
  for (const id of ['teacher', 'vendor', 'librarian']) assert.ok(d.npcs.has(id), `${id} on duty`);
});

test('invalid or missing configuration fails safely: the character stays off duty, nothing throws', () => {
  const good = NPC_BY_ID.get('teacher');
  const broken = [
    { ...good, id: 'x1', building: 'nowhere' }, { ...good, id: 'x2', threshold: 150 }, { ...good, id: 'x3', home: { x: 31.15, z: -39.7, yaw: 0 } },
    { ...good, id: 'x4', appearance: { ...good.appearance, model: '../../etc/passwd' } }, { ...good, id: 'x5', routine: [['board', 5, 'idle'], ['desk', 5, 'idle']] },
    { ...good, id: 'x6', waypoints: { ...good.waypoints, board: { x: 40, z: -42.4, yaw: 0 } } }, { ...good, id: 'x7', routine: [['home', 5, 'dance']] }, null,
  ];
  for (const d of broken) assert.ok(validateNpc(d).length > 0, `${d?.id} is rejected`);
  assert.match(validateNpc(broken[4]).join(), /start at home/);
  const dir = createNpcDirector({ definitions: broken.filter(Boolean), now: at(T) });
  assert.equal(dir.npcs.size, 0, 'no invalid character comes on duty');
  assert.equal(eligibility({ building: 'nowhere' }, dir.buildings, T).ok, false);
  assert.match(dir.talk({ id: 'p', x: 0, z: 0 }, 'x2').reason, /not available|complete/);
  assert.equal(dir.talk({ id: 'p', x: 0, z: 0 }, { toString: 1 }).ok, false, 'a non-string id is refused');
});

test('two directors started at the same moment agree exactly: nothing is random', () => {
  const a = createNpcDirector({ now: at(T) }), b = createNpcDirector({ now: at(T) });
  assert.deepEqual(a.snapshot(T), b.snapshot(T));
  for (const d of NPCS) assert.deepEqual(npcPose(d, a.npcs.get(d.id), T + 12345), npcPose(d, b.npcs.get(d.id), T + 12345));
});

// ------------------------------------------------------------------ building thresholds
for (const [id, building, threshold] of [['teacher', 'studio-d1', 80], ['vendor', 'courtyard-cafe', 40]]) {
  test(`the ${id} appears at exactly ${threshold}% ${building} completion, stays above it, and never below`, () => {
    for (const c of [0, 25, threshold - 1, threshold - .01]) { const d = director({ [building]: c }); assert.equal(d.npcs.has(id), false, `${c}%`); assert.match(d.talk({ id: 'p', x: 0, z: 0 }, id).reason, new RegExp(`${Math.round(c)}% complete`)); }
    for (const c of [threshold, threshold + .01, 95, 100]) assert.equal(director({ [building]: c }).npcs.has(id), true, `${c}%`);
  });
}
test('crossing a threshold again and again keeps one instance with the same identity', () => {
  const d = director({ 'studio-d1': 50 });
  for (let i = 0; i < 10; i++) {
    assert.equal(d.setBuilding('studio-d1', { completion: 80 }).arrived.join(), 'teacher');
    assert.equal(d.setBuilding('studio-d1', { completion: 80 }).arrived.length, 0, 'already on duty: no second arrival');
    assert.equal(d.setBuilding('studio-d1', { completion: 90 }).arrived.length, 0);
    assert.equal(d.snapshot().npcs.filter(n => n.id === 'teacher').length, 1, 'one teacher');
    assert.equal(d.setBuilding('studio-d1', { completion: 79 }).left.join(), 'teacher');
    assert.equal(d.npcs.has('teacher'), false);
  }
  assert.equal(d.spawns.get('teacher'), 10, 'one arrival per crossing');
  assert.equal(new Set(d.snapshot().npcs.map(n => n.id)).size, d.snapshot().npcs.length);
});
test('every character respects its own threshold and its building being closed', () => {
  for (const def of NPCS) {
    assert.equal(director({ [def.building]: Math.max(0, def.threshold - .01) }).npcs.has(def.id), def.threshold === 0, `${def.id} below ${def.threshold}%`);
    assert.equal(director({ [def.building]: def.threshold }).npcs.has(def.id), true, `${def.id} at ${def.threshold}%`);
  }
  const d = director(); d.setBuilding('adunni-library', { available: false });
  assert.equal(d.npcs.has('librarian'), false); assert.match(d.talk({ id: 'p', x: -22.6, z: -6.6 }, 'librarian').reason, /closed/);
});
test('a character leaving duty mid-conversation ends it cleanly', () => {
  const d = director(), p = { id: 'p', x: 26.5, z: -9.3 };
  assert.equal(d.talk(p, 'vendor').ok, true);
  assert.deepEqual(d.setBuilding('courtyard-cafe', { completion: 10 }).left, ['vendor']);
  assert.equal(d.leave(p, 'vendor').ok, true, 'leaving afterwards is harmless');
  d.setBuilding('courtyard-cafe', { completion: 60 });
  assert.equal(d.npcs.get('vendor').mode, 'routine', 'back on duty without the old conversation');
});
test('working hours are optional and evaluated in campus time (UTC+1)', () => {
  const def = { ...NPC_BY_ID.get('coach'), hours: { from: '07:00', to: '21:00' } };
  assert.deepEqual(validateNpc(def), []);
  const utc = (h, m = 0) => Date.UTC(2026, 9, 25, h, m);
  assert.equal(onShift(def, utc(5, 59)), false, '06:59 campus time'); assert.equal(onShift(def, utc(6)), true, '07:00');
  assert.equal(onShift(def, utc(19, 59)), true); assert.equal(onShift(def, utc(20)), false, '21:00 campus time');
  const night = { ...def, hours: { from: '22:00', to: '06:00' } };
  assert.equal(onShift(night, utc(22)), true); assert.equal(onShift(night, utc(12)), false);
  assert.equal(onShift(NPC_BY_ID.get('coach'), utc(3)), true, 'no hours: always');
  const d = createNpcDirector({ definitions: [def], now: at(utc(12)) });
  assert.equal(d.npcs.has('coach'), true); d.step([], utc(21)); assert.equal(d.npcs.has('coach'), false, 'goes off shift');
  assert.match(eligibility(def, d.buildings, utc(21)).reason, /07:00–21:00/);
});

// ------------------------------------------------------------------ movement
test('routines stay inside each building, off walls, fixtures and doorways, at walking pace, with no jumps', () => {
  for (const def of NPCS) {
    const r = routineOf(def), region = BUILDING_BY_ID.get(def.building).region, state = { mode: 'routine', epoch: 0 };
    let prev = null;
    for (let t = 0; t <= r.cycle + 100; t += 50) {
      const p = npcPose(def, state, t);
      assert.ok(standable(p.x, p.z), `${def.id} at ${t} ms is clear of colliders (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      assert.ok(p.x >= region.x0 && p.x <= region.x1 && p.z >= region.z0 && p.z <= region.z1, `${def.id} stays in ${def.building}`);
      assert.ok(p.speed <= NPC_WALK_SPEED + 1e-9, `${def.id} speed ${p.speed}`);
      if (prev) assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) <= NPC_WALK_SPEED * .05 + 1e-6, `${def.id} moves smoothly at ${t} ms`);
      prev = p;
    }
  }
});
test('characters keep clear of seats, where people stand to sit, door swings and the ball rack', () => {
  for (const def of NPCS) {
    const r = routineOf(def), state = { mode: 'routine', epoch: 0 };
    for (let t = 0; t <= r.cycle; t += 100) {
      const p = npcPose(def, state, t);
      for (const s of SEATS) if (Math.abs(s.x - p.x) < 2 && Math.abs(s.z - p.z) < 2) { const a = seatApproach(s); assert.ok(Math.hypot(s.x - p.x, s.z - p.z) >= .75 && Math.hypot(a.x - p.x, a.z - p.z) >= .75, `${def.id} near seat ${s.id}`); }
      for (const b of BALLS) assert.ok(Math.hypot(b.x - p.x, b.z - p.z) >= 1.8, `${def.id} near ${b.id}`);
      for (const d of DOORS) for (const l of d.leaves) assert.ok(Math.hypot(l.hx - p.x, l.hz - p.z) >= l.len + .6, `${def.id} in ${d.id}'s swing`);
    }
  }
});
test('after a conversation anywhere along the routine, the walk home is clear and then the routine resumes at home', () => {
  for (const def of NPCS) {
    const r = routineOf(def), d = createNpcDirector({ definitions: [def], now: at(0) }); d.npcs.get(def.id).epoch = 0;
    let talks = 0;
    for (let t = 0; t < r.cycle; t += 700) {
      d.npcs.set(def.id, { mode: 'routine', epoch: 0, gesture: null });
      const here = npcPose(def, d.npcs.get(def.id), t), p = { id: 'p', x: here.x + .5, z: here.z };
      if (!lineClear(p.x, p.z, here.x, here.z) || !d.talk(p, def.id, t).ok) continue;
      talks++;
      d.leave(p, def.id, t + 1000);
      let last = null;
      for (let u = t + 1000; u < t + 1000 + 30000; u += 100) {
        const q = npcPose(def, d.npcs.get(def.id), u);
        assert.ok(standable(q.x, q.z), `${def.id} walking home from ${t} ms`);
        if (q.state !== 'returning') { last = q; break; }
      }
      assert.ok(last && Math.hypot(last.x - def.home.x, last.z - def.home.z) < .01, `${def.id} is back at home`);
    }
    assert.ok(talks >= r.cycle / 700 * .8, `${def.id}: conversations tried all along the routine (${talks})`);
  }
});

// ------------------------------------------------------------------ interaction rules
test('talking needs the right range and a clear line: across a counter yes, through a wall or a closed door no', () => {
  const d = director();
  d.clock.t = whenAt(d, 'vendor', 'home');
  assert.equal(d.talk({ id: 'a', x: 26.5, z: -9.3 }, 'vendor').ok, true, 'across the counter');
  d.clock.t = whenAt(d, 'teacher', 'desk');
  const desk = NPC_BY_ID.get('teacher').waypoints.desk;
  assert.match(d.talk({ id: 'b', x: 30.6, z: desk.z }, 'teacher').reason, /can’t reach/, 'through the classroom wall');
  assert.match(d.talk({ id: 'c', x: 33.5, z: -42.55 + NPC_BY_ID.get('teacher').talk.range + TALK_SLACK + .2 }, 'teacher').reason, /closer/);
  setDoorOpen('classroom-d1', false);
  assert.equal(lineClear(32.7, -35.8, 32.7, -37.4), false, 'a closed door blocks sight'); setDoorOpen('classroom-d1', true);
  assert.equal(lineClear(32.7, -35.8, 32.7, -37.4), true, 'an open one does not'); setDoorOpen('classroom-d1', false);
});
test('busy players are asked to finish first; repeated requests change nothing', () => {
  const d = director(); d.clock.t = whenAt(d, 'vendor', 'home');
  const base = { x: 26.5, z: -9.3 };
  assert.match(d.talk({ id: 'a', ...base, ball: 'ball-1' }, 'vendor').reason, /ball down/);
  assert.match(d.talk({ id: 'a', ...base, seat: 'cafe-0-0' }, 'vendor').reason, /Stand up/);
  assert.match(d.talk({ id: 'a', ...base, vehicle: 'cart-1' }, 'vendor').reason, /vehicle/);
  assert.match(d.talk({ id: 'a', ...base, space: 'room' }, 'vendor').reason, /common room/);
  assert.equal(d.talk({ id: 'a', ...base }, 'vendor').first, true);
  const before = JSON.stringify(d.snapshot(d.clock.t));
  for (let i = 0; i < 5; i++) assert.equal(d.talk({ id: 'a', ...base }, 'vendor').replayed, true);
  assert.equal(JSON.stringify(d.snapshot(d.clock.t)), before, 'a repeated talk does not duplicate the conversation');
  assert.equal(d.talk({ id: 'b', ...base }, 'vendor').first, false, 'a second customer queues, still answered');
  assert.deepEqual(d.npcs.get('vendor').by.map(b => b.id), ['a', 'b']);
  for (const id of ['c', 'd', 'e']) d.talk({ id, ...base }, 'vendor');
  assert.match(d.talk({ id: 'f', ...base }, 'vendor').reason, /helping other people/);
});
test('demo café orders: validated, numbered once per request, never charged, and the counter still works without the vendor', () => {
  assert.equal(validateOrder([]).ok, false); assert.equal(validateOrder(['caviar']).ok, false); assert.equal(validateOrder(Array(13).fill('zobo')).ok, false);
  assert.equal(validateOrder(['jollof', 'zobo']).total, CAFE_MENU.find(i => i.id === 'jollof').price + CAFE_MENU.find(i => i.id === 'zobo').price);
  const d = director(); d.clock.t = whenAt(d, 'vendor', 'home');
  const p = { id: 'a', key: 'session-1', x: 26.5, z: -9.3 }, order = { items: ['jollof'], req: 'attempt-001', via: 'vendor' };
  const first = d.order(p, order);
  assert.equal(first.ok, true); assert.equal(first.served, true); assert.equal(d.npcs.get('vendor').gesture.kind, 'serve');
  assert.deepEqual(d.order({ ...p, id: 'reconnected' }, order), { ...first, replayed: true }, 'a retry (even after reconnecting) returns the same order');
  assert.notEqual(d.order(p, { ...order, req: 'attempt-002' }).number, first.number, 'a new attempt is a new order');
  assert.match(d.order(p, { ...order, req: 'x' }).reason, /could not be read/);
  assert.match(d.order({ ...p, z: 5 }, { ...order, req: 'attempt-003' }).reason, /closer/);
  assert.match(d.order({ ...p, z: 5 }, { ...order, req: 'attempt-004', via: 'counter' }).reason, /counter/);
  assert.equal(d.order(p, { ...order, req: 'attempt-005', via: 'teleport' }).ok, false);
  d.setBuilding('courtyard-cafe', { completion: 39 });
  assert.match(d.order(p, { ...order, req: 'attempt-006' }).reason, /39% complete/, 'no vendor below 40%');
  const counter = d.order(p, { ...order, req: 'attempt-007', via: 'counter' });
  assert.equal(counter.ok, true, 'the counter fixture still takes demo orders'); assert.equal(counter.served, false);
});
test('conversations end when the player walks away, leaves the room or after the attention limit', () => {
  const d = director(); d.clock.t = whenAt(d, 'librarian', 'home');
  const t = d.clock.t, p = { id: 'a', x: -22.6, z: -6.6 };
  d.talk(p, 'librarian'); d.step([p], t + 500); assert.equal(d.npcs.get('librarian').mode, 'engaged');
  d.step([{ ...p, z: -6.6 + LEAVE_RANGE + 1 }], t + 1000); assert.equal(d.npcs.get('librarian').mode, 'routine', 'walked away');
  d.talk(p, 'librarian', t + 2000); d.step([], t + 2500); assert.equal(d.npcs.get('librarian').mode, 'routine', 'left the room');
  d.talk(p, 'librarian', t + 3000); d.step([p], t + 3000 + ATTENTION_MS + 1); assert.equal(d.npcs.get('librarian').mode, 'routine', 'attention limit');
  d.talk(p, 'librarian', t + 400000); assert.equal(d.release(p, t + 400001), true); assert.equal(d.npcs.get('librarian').mode, 'routine', 'disconnect');
});
test('greetings: one wave for someone arriving in sight, not repeated, never through walls', () => {
  const d = director(); d.clock.t = whenAt(d, 'services-officer', 'home');
  const t = d.clock.t, home = NPC_BY_ID.get('services-officer').home, p = { id: 'a', x: home.x + 1, z: home.z + 2 };
  assert.ok(Math.hypot(1, 2) < GREET_RADIUS);
  d.step([p], t); assert.deepEqual([d.npcs.get('services-officer').gesture.kind, d.npcs.get('services-officer').gesture.to], ['wave', 'a']);
  const g = d.npcs.get('services-officer').gesture.at; d.step([p], t + 30000); assert.equal(d.npcs.get('services-officer').gesture.at, g, 'not again so soon');
  d.step([p], t + GREET_REPEAT_MS + 1); assert.notEqual(d.npcs.get('services-officer').gesture.at, g, 'again after a while');
  const lib = director(); lib.clock.t = whenAt(lib, 'librarian', 'home');
  lib.step([{ id: 'out', x: -17.6, z: -8.65 }], lib.clock.t); assert.equal(lib.npcs.get('librarian').gesture, null, 'no wave through the library wall');
});
test('the coach cheers a basket; scores are never changed by a character', () => {
  const d = director();
  assert.equal(d.react({ type: 'score', points: 2 }), true);
  assert.equal(d.npcs.get('coach').gesture.kind, 'cheer');
  assert.equal(d.react({ type: 'bounce' }), false);
});
