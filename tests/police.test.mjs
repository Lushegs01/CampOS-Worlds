import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolice, stepPolice, crime, alert, surrender, shootOfficers, vehicleInTheWay, viewPolice, WANTED } from '../server/mission/police.mjs';
import { createGetaway, missionStep, viewMission, combatInput } from '../server/mission/getaway.mjs';
import { O, VEHICLE_BAY } from '../shared/getaway.mjs';
import { POLICE_BAYS } from '../shared/metro.mjs';
import { raySphere } from '../shared/arena/physics.mjs';

const dt = 1 / 20;
const seeded = (s = 7) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function run(pd, p, from, to, ctx = {}) {
  const events = [];
  let t = from;
  for (; t < to; t += dt) stepPolice(pd, p, dt, t, { vehicle: null, moving: false, aiming: false, firedAt: -Infinity, vehicles: [], players: [p], hurt: () => {}, events, ...ctx });
  return events;
}

test('reports arrive after a dispatch delay with the incident location; reports alone cap at level 3', () => {
  const pd = createPolice({ now: 0, random: seeded(), los: () => false, patrols: false });
  const p = { x: 150, z: 1701.55 };
  crime(pd, 'gunfire', { x: 120, z: 1700 }, 0, 'civilian');
  assert.equal(pd.wanted, 0, 'no instant wanted level');
  const events = run(pd, p, 0, 12);
  assert.ok(pd.wanted >= 1, 'the report reached dispatch');
  assert.deepEqual([pd.lastKnown.x, pd.lastKnown.z], [120, 1700], 'police know where it happened, not where the player is');
  assert.ok(events.some(e => e.kind === 'radio' && e.code === 'shotsFired'));
  for (let k = 0; k < 6; k++) crime(pd, 'explosion', { x: 100 + k * 40, z: 1650 }, 12, 'civilian');
  run(pd, p, 12, 26);
  assert.equal(pd.wanted, 3, 'witness reports never reach tactical containment by themselves');
  crime(pd, 'officerKilled', p, 26, 'police');
  assert.equal(pd.wanted, 5);
});

test('responding units leave the Security District motor pool and drive with the shared physics', () => {
  const pd = createPolice({ now: 0, random: seeded(), los: () => false, patrols: false });
  const p = { x: 150, z: 1701.55 };
  alert(pd, 2, p, 0);
  run(pd, p, 0, 1);
  assert.ok(pd.units.length >= 1);
  const u = pd.units[0];
  assert.ok(POLICE_BAYS.some(b => dist(b, u) < 6), 'spawned at a police bay, not beside the player');
  const start = { x: u.x, z: u.z };
  run(pd, p, 1, 12);
  assert.ok(dist(u, start) > 20, 'the unit drove away from the station');
  assert.ok(Math.abs(u.speed) <= 23.01, 'within the cruiser’s top speed');
  assert.ok(pd.units.length <= WANTED[2].units + 1);
});

test('no line of sight means no visual: police do not track the player through walls', () => {
  const pd = createPolice({ now: 0, random: seeded(), los: () => false, patrols: true });
  const p = { x: pd.units[0].x + 8, z: pd.units[0].z };
  alert(pd, 2, { x: -400, z: 1600 }, 0);
  run(pd, p, 0, 3);
  assert.ok(pd.seenAt < 0 && !pd.identified);
  assert.equal(pd.lastKnown.x, -400, 'still searching the reported location');
});

test('containment: units box in a stopped car, officers dismount to cover, issue commands and hold fire', () => {
  const pd = createPolice({ now: 0, random: seeded(3), los: () => true, patrols: false });
  const car = { id: 'getaway-compact', type: 'car', x: 200, z: 1701.55 + 1.7, yaw: -Math.PI / 2, speed: 0, wheel: 0, steering: 0, occupants: ['p'] };
  const p = { x: car.x, z: car.z, vehicle: car.id };
  alert(pd, 2, p, 0);
  // A unit arriving along the street behind the car.
  pd.units.push(pdUnit(pd, 240, 1701.55 + 1.7, -Math.PI / 2));
  pd.dispatchAt = Infinity;
  const hurt = [];
  const events = run(pd, p, 0, 14, { vehicle: car, vehicles: [car], hurt: n => hurt.push(n) });
  assert.ok(pd.containment, 'contained');
  assert.ok(pd.wanted >= 4);
  const officers = pd.units.flatMap(u => u.officers);
  assert.ok(officers.length >= 2, 'officers got out');
  assert.ok(officers.every(o => ['cover', 'aim'].includes(o.mode)), 'officers took cover and drew weapons');
  assert.ok(events.some(e => e.kind === 'command' && ['stepOut', 'engineOff', 'handsOnWheel'].includes(e.code)), 'commands for a driver');
  assert.equal(hurt.length, 0, 'no shots at a compliant, stationary driver');
  assert.ok(!events.some(e => e.kind === 'enemyShot'));
  // The driver becomes a threat: officers return fire through actual cadence.
  pd.hostileAt = 14;
  const later = run(pd, p, 14, 20, { vehicle: car, vehicles: [car], hurt: n => hurt.push(n) });
  assert.ok(later.filter(e => e.kind === 'enemyShot').length >= 3);
  // Breaking out: the officers run back to their cars and the unit resumes.
  Object.assign(car, { x: 120, speed: 15 }); Object.assign(p, { x: 120 });
  run(pd, p, 20, 21, { vehicle: car, vehicles: [car], hurt: () => {} });
  assert.equal(pd.containment, null);
  assert.ok(pd.units.flatMap(u => u.officers).every(o => o.mode === 'board' || o.mode === 'seated' || o.hp <= 0));
  run(pd, p, 21, 30, { vehicle: car, vehicles: [car], hurt: () => {} });
  assert.ok(pd.units.some(u => !u.officers.length && Math.abs(u.speed) > 1), 'back aboard and moving');
});

function pdUnit(pd, x, z, yaw) {
  const tmp = createPolice({ now: 0, los: () => true, patrols: true });
  const u = tmp.units[0];
  return { ...u, id: 'getaway-unit-test', role: 'response', mode: 'respond', x, z, yaw, loop: null, officers: [], route: [], plan: 0 };
}

test('cover works both ways: a car body stops bullets below its roof line', () => {
  const car = { id: 'cover', type: 'car', x: 0, z: 0, yaw: 0 };
  assert.equal(vehicleInTheWay({ x: -4, z: 0 }, 1.0, { x: 4, z: 0 }, 1.0, [car]), true);
  assert.equal(vehicleInTheWay({ x: -4, z: 0 }, 1.9, { x: 4, z: 0 }, 1.9, [car]), false, 'over the roof');
  const pd = createPolice({ now: 0, los: () => true, patrols: false });
  pd.units.push({ ...pdUnit(pd, 0, 0, 0), officers: [{ id: 'o', x: 0, z: 1.8, hp: 100, mode: 'cover', yaw: 0 }] });
  const hidden = shootOfficers(pd, { x: 0, y: 1.5, z: -8 }, [0, -.04, 1], 40, 28, raySphere, 1, [{ id: 'shield', type: 'car', x: 0, z: 0, yaw: Math.PI / 2 }]);
  assert.ok(!hidden || hidden.blocked, 'a crouched officer behind a car is protected');
  pd.units[0].officers[0].mode = 'fire';
  const exposed = shootOfficers(pd, { x: 0, y: 1.65, z: -8 }, [0, 0, 1], 40, 28, raySphere, 2, []);
  assert.ok(exposed?.officer, 'an officer leaning out to fire can be hit');
  assert.ok(pd.wanted >= 4, 'shooting an officer is witnessed');
});

test('surrender: officers walk up and make the arrest', () => {
  const pd = createPolice({ now: 0, random: seeded(5), los: () => true, patrols: false });
  const p = { x: 200, z: 1705 };
  alert(pd, 2, p, 0); pd.dispatchAt = Infinity;
  pd.units.push(pdUnit(pd, 214, 1703.3, -Math.PI / 2));
  run(pd, p, 0, 8);
  assert.ok(surrender(pd, p, 8));
  run(pd, p, 8, 25);
  assert.equal(pd.arrested, true);
});

test('escape is not a timer: the search ends only out of sight AND outside the search area', () => {
  const pd = createPolice({ now: 0, random: seeded(9), los: () => false, patrols: false });
  const p = { x: 0, z: 1755.55 };
  alert(pd, 3, p, 0); pd.dispatchAt = Infinity;
  pd.seenAt = 0; pd.lastKnown = { x: 0, z: 1755.55, at: 0 };
  // Hiding right where they last saw you: never called off.
  run(pd, p, 0, 60);
  assert.ok(pd.wanted > 0, 'still searching the area');
  // Far outside the search area: called off once unseen long enough.
  Object.assign(p, { x: 400, z: 2020 });
  const events = run(pd, p, 60, 62);
  assert.equal(pd.wanted, 0);
  assert.ok(events.some(e => e.code === 'searchOver'));
  assert.equal(viewPolice(pd, 62).wanted, 0);
});

test('mission: leaving the motor pool puts out the vehicle, and the alarm unit finds the getaway car', () => {
  let s = 5; const random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const m = createGetaway({ now: 0, checkpoint: O.pursuit, random });
  const car = m.fleet.vehicles[0], p = { id: 'p', x: car.x + 1.6, z: car.z, y: 0, yaw: 0, vehicle: null, vehicleSeat: null };
  assert.ok(m.fleet.enter(p, car.id, 0).ok);
  assert.equal(m.pd.wanted, 2);
  let seen = false;
  for (let t = 0; t < 30 && !seen; t += dt) { car.input = { throttle: 0, steer: 0, brake: true }; car.inputAt = Date.now(); m.fleet.step(dt, [p], Date.now()); missionStep(m, p, dt, t); seen ||= m.spotted; }
  assert.ok(seen, 'the responding unit got a visual on the car');
  const view = viewMission(m, 30);
  assert.ok(view.vehicles.some(v => v.police && v.siren));
  assert.ok(Array.isArray(view.civilians));
  assert.ok(view.vehicles.some(v => v.traffic), 'traffic around the player');
  assert.ok(Math.hypot(VEHICLE_BAY.x - car.x, VEHICLE_BAY.z - car.z) < 20);
  void combatInput;
});
