import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleet, advance, VEHICLE_TYPES, localPoint } from '../shared/vehicles.mjs';
import { createDrivePrediction, validDrive, DRIVE_FIELDS } from '../shared/driving.mjs';

const actor = (id = 'driver') => ({ id, x: 0, z: 0, y: 0, yaw: 0, seat: null, ball: null, vehicle: null, vehicleSeat: null });
function seated(f, v, p, seat = 0) { const t = VEHICLE_TYPES[v.type]; Object.assign(p, localPoint(v, (t.seats[seat][0] < 0 ? -1 : 1) * (t.width / 2 + .65), t.seats[seat][1])); assert.equal(f.enter(p, v.id, seat).ok, true); }
// The browser's own copy of the fleet, as src/vehicles/client.ts keeps it.
function client(room, id) { const local = createFleet(), v = local.find(id); Object.assign(v, room.driveState(id)); return { local, v, prediction: createDrivePrediction((x, i, dt) => advance(x, i, dt, local.vehicles)) }; }
const pose = v => Object.fromEntries(DRIVE_FIELDS.map(k => [k, v[k]]));
const close = (a, b, eps = 1e-9) => DRIVE_FIELDS.every(k => Math.abs(a[k] - b[k]) <= eps);
// A pattern of controls over time: pull away, steer, brake a little.
const controls = t => [t < 3 ? 1 : .3, Math.sin(t * 1.3) * .8, t > 4.2 && t < 4.6];

test('the driver predicts exactly where the room puts the car after the same commands', () => {
  const room = createFleet(), car = room.find('courtyard-car'), p = actor(); seated(room, car, p);
  const c = client(room, car.id); assert.equal(c.prediction.receive(room.driveState(car.id), c.v), true);
  // Commands go out every other frame; the room's state comes back six messages (200 ms) later, as over a network.
  let now = Date.now() + 100; const states = [];
  for (let t = 0, frame = 0; t < 6; t += 1 / 60, frame++) {
    const [throttle, steer, brake] = controls(t); assert.equal(c.prediction.frame(c.v, 1 / 60, throttle, steer, brake), true); now += 1000 / 60;
    if (frame % 2 === 1) { const out = c.prediction.outbox(); assert.equal(room.drive(p, out, now, [p]).ok, true); states.push(room.driveState(car.id)); }
    if (states.length > 6) { const before = pose(c.v); assert.equal(c.prediction.receive(states.shift(), c.v), true); assert.ok(close(before, pose(c.v)), 'reconciling never moves the predicted car'); }
  }
  room.drive(p, c.prediction.outbox() ?? { epoch: 0, commands: [] }, now + 50, [p]);
  assert.ok(Math.hypot(car.x - 13.5, car.z - 63) > 20, 'the car really drove');
  assert.ok(close(pose(c.v), pose(car)), 'prediction and room agree to the nanometre');
});

test('reconciling replays only the commands the room has not applied yet', () => {
  const room = createFleet(), car = room.find('courtyard-car'), p = actor(); seated(room, car, p);
  const c = client(room, car.id); c.prediction.receive(room.driveState(car.id), c.v);
  // The room applies every message as it arrives, but its acknowledgements are held back.
  let now = Date.now() + 100; const states = [];
  for (let t = 0; t < 3; t += 1 / 60) { const [th, st, br] = controls(t); c.prediction.frame(c.v, 1 / 60, th, st, br); now += 1000 / 60; const out = c.prediction.outbox(); assert.equal(room.drive(p, out, now, [p]).ok, true); states.push(room.driveState(car.id)); }
  const before = pose(c.v), halfway = states[Math.floor(states.length / 2)];
  assert.ok(c.prediction.pending > 150, 'nothing acknowledged yet');
  assert.equal(c.prediction.receive(halfway, c.v), true);
  assert.ok(close(before, pose(c.v)), 'adopting a half-way state and replaying the rest changes nothing');
  assert.ok(c.prediction.pending > 0 && c.prediction.pending < states.length / 2 + 1, 'acknowledged commands are dropped');
  assert.equal(c.prediction.receive(states.at(-1), c.v), true); assert.equal(c.prediction.pending, 0);
  assert.ok(close(pose(c.v), pose(car)));
  assert.equal(c.prediction.receive(halfway, c.v), false, 'an older state arriving late is ignored');
});

test('the room never accepts more driving time than has passed, nor gaps, nor replays', () => {
  const room = createFleet(), car = room.find('courtyard-car'), p = actor(); seated(room, car, p);
  const epoch = room.driveState(car.id).epoch, cmd = (seq, dt = .1) => [seq, dt, 1, 0, 0];
  // Ten seconds of full throttle claimed in the first second: only the time budget is ever applied.
  let now = Date.now() + 100; room.drive(p, { epoch, commands: [cmd(1, .01)] }, now, [p]);
  const r = room.drive(p, { epoch, commands: Array.from({ length: 40 }, (_, i) => cmd(i + 2, .25)) }, now + 1000, [p]);
  assert.equal(r.ok, false, 'a burst beyond the budget is refused');
  assert.ok(room.driveState(car.id).epoch > epoch, 'and starts a new generation the client resynchronises from');
  assert.ok(Math.abs(car.speed) < VEHICLE_TYPES.car.accel * 1.1, `no more than about a second of acceleration (${car.speed})`);
  // Gaps and duplicates.
  const e2 = room.driveState(car.id).epoch;
  assert.equal(room.drive(p, { epoch: e2, commands: [cmd(1, .05)] }, now + 1100, [p]).ok, true);
  const after = pose(car);
  assert.equal(room.drive(p, { epoch: e2, commands: [cmd(1, .05)] }, now + 1200, [p]).ok, true);
  assert.deepEqual(pose(car), after, 'a repeated command does not move the car twice');
  assert.equal(room.drive(p, { epoch: e2, commands: [cmd(3, .05)] }, now + 1300, [p]).ok, false, 'a gap is refused');
  assert.equal(room.drive(p, { epoch: 999, commands: [cmd(1, .05)] }, now + 1400, [p]).ok, false, 'a stale generation is refused');
});

test('only the driver drives; malformed commands are refused', () => {
  const room = createFleet(), car = room.find('courtyard-car'), p = actor(), q = actor('passenger'); seated(room, car, p); seated(room, car, q, 1);
  const epoch = room.driveState(car.id).epoch;
  assert.equal(room.drive(q, { epoch, commands: [[1, .1, 1, 0, 0]] }, 1e6, [p, q]).ok, false);
  for (const bad of [[1, .5, 1, 0, 0], [1, 0, 1, 0, 0], [1, .1, 2, 0, 0], [1, .1, 1, -1.5, 0], [1, .1, 1, 0, 2], [1.5, .1, 1, 0, 0], [1, NaN, 1, 0, 0], [0, .1, 1, 0, 0], 'go'])
    assert.equal(validDrive(bad), false, JSON.stringify(bad));
  assert.equal(room.drive(p, { epoch, commands: [[1, .1, 2, 0, 0]] }, 1e6, [p, q]).ok, false);
  assert.equal(room.drive(p, { epoch, commands: Array.from({ length: 41 }, (_, i) => [i + 1, .001, 0, 0, 0]) }, 1e6, [p, q]).ok, false, 'batches are bounded');
});

test('a driver whose commands stop arriving is braked by the room; changing driver starts a new generation', () => {
  const room = createFleet(), car = room.find('courtyard-car'), p = actor(); seated(room, car, p);
  let epoch = room.driveState(car.id).epoch, now = Date.now() + 100;
  for (let i = 1; i <= 30; i++) { now += 50; assert.equal(room.drive(p, { epoch, commands: [[i, .05, 1, 0, 0]] }, now, [p]).ok, true); }
  const moving = car.speed; assert.ok(moving > 4);
  room.step(.1, [p], now + 100); assert.equal(car.speed, moving, 'while commands are fresh the timer leaves the car to them');
  for (let t = 0; t < 3; t += .1) room.step(.1, [p], now + 400 + t * 1000);
  assert.equal(car.speed, 0, 'stale commands: the room brakes the car to a stop');
  assert.equal(room.exit(p, [p]).ok, true); assert.ok(room.driveState(car.id).epoch > epoch, 'getting out invalidates in-flight commands');
  epoch = room.driveState(car.id).epoch; seated(room, car, p); assert.ok(room.driveState(car.id).epoch > epoch, 'and getting back in starts afresh');
});
