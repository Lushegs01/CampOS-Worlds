// How driving looks over a real network, measured deterministically with the shared physics and the client's
// motion code: one-way latency 60–120 ms with jitter, the room ticking at ~30 Hz and sending 15 Hz state,
// the browser drawing at 60 FPS. Compares the previous presentation (the driver's car drawn from the room's
// snapshots, extrapolated from their arrival time and eased) with the current one (the driver's commands
// predicted locally and reconciled; other cars interpolated by the room's timestamps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleet, advance, VEHICLE_TYPES, localPoint } from '../shared/vehicles.mjs';
import { createDrivePrediction } from '../shared/driving.mjs';
import { createVehicleMotion, createVehicleTrack } from '../src/network/vehicle-motion.mjs';
import { createPlayback } from '../src/network/interpolation.mjs';

const FRAME = 1000 / 60, ID = 'courtyard-car';
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
// Ordered delivery (a WebSocket) with per-message latency 60–120 ms.
function link(random) { let last = 0; return t => (last = Math.max(last, t + 60 + random() * 60)); }
// Hold the throttle from 0.5 s and weave gently, driving east along the straight campus road.
const controls = t => t < .5 ? [0, 0, false] : [1, Math.sin(t * 1.4) * .05, false];

function simulate(mode, seed = 7) {
  const random = rng(seed), up = link(random), down = link(random), playback = createPlayback();
  const room = createFleet(), car = room.find(ID), p = { id: 'driver', x: 0, z: 0, y: 0, yaw: 0, seat: null, ball: null, vehicle: null, vehicleSeat: null };
  const t0 = Date.now(), wall = ms => t0 + ms;
  Object.assign(car, { x: 100, z: 55.5, yaw: Math.PI / 2 });
  const tp = VEHICLE_TYPES[car.type]; Object.assign(p, localPoint(car, tp.width / 2 + .65, tp.seats[0][1])); assert.equal(room.enter(p, ID, 0).ok, true);
  // Browser state: the driver's local fleet, plus what an onlooker in another browser draws.
  const local = createFleet(), mine = Object.assign(local.find(ID), { x: car.x, z: car.z, yaw: car.yaw }), prediction = createDrivePrediction((v, i, dt) => advance(v, i, dt, local.vehicles));
  const oldMotion = createVehicleMotion(), oldDriver = { ...mine }, oldViewer = { ...mine }, target = {};
  const track = createVehicleTrack(), viewer = { ...mine }, correction = { x: 0, z: 0 };
  const inbox = [], outbox = [], driverView = [], viewerView = [];
  let tick = 0, nextTick = 0, lastTick = 0, sent = -1e9, ackedOnce = false;
  for (let now = 0; now < 9000; now += FRAME) {
    // The room: deliver what has arrived, then step on its own jittered ~30 Hz timer.
    while (outbox.length && outbox[0].at <= now) { const m = outbox.shift().m; if (m.type === 'drive') room.drive(p, m, wall(now), [p]); else room.control(p, m, wall(now)); }
    while (nextTick <= now) {
      room.step((nextTick - lastTick) / 1000, [p], wall(nextTick)); lastTick = nextTick;
      if (++tick % 2 === 0) inbox.push({ at: down(nextTick), roomAt: nextTick, v: { ...car, ts: room.stateTime(ID, wall(nextTick)) - t0 }, drive: room.driveState(ID) });
      nextTick += 1000 / 30 + (random() - .5) * 6;
    }
    // The browser: messages that have arrived, then this frame.
    while (inbox.length && inbox[0].at <= now) {
      const m = inbox.shift();
      if (mode === 'previous') oldMotion.receive(m.v, now);
      else {
        playback.receive(m.roomAt, now); track.push(m.v.ts, m.v, m.roomAt);
        const was = { x: mine.x, z: mine.z }, fresh = !prediction.active;
        if (prediction.receive(m.drive, mine)) { ackedOnce = true; if (!fresh) { correction.x += was.x - mine.x; correction.z += was.z - mine.z; } }
      }
    }
    const [throttle, steer, brake] = controls(now / 1000), fade = Math.exp(-FRAME / 1000 * 10);
    if (mode === 'previous') {
      if (now - sent > 50) { sent = now; outbox.push({ at: up(now), m: { type: 'input', throttle, steer, brake } }); }
      for (const [view, store] of [[oldDriver, driverView], [oldViewer, viewerView]]) {
        if (oldMotion.sample(ID, now, target)) { const k = 1 - Math.exp(-FRAME / 1000 * 15); view.x += (target.x - view.x) * k; view.z += (target.z - view.z) * k; }
        store.push({ t: now, x: view.x, z: view.z });
      }
    } else {
      if (ackedOnce) prediction.frame(mine, FRAME / 1000, throttle, steer, brake);
      if (now - sent >= 33) { const out = prediction.outbox(); if (out) { sent = now; outbox.push({ at: up(now), m: { type: 'drive', ...out } }); } }
      correction.x *= fade; correction.z *= fade;
      driverView.push({ t: now, x: mine.x + correction.x, z: mine.z + correction.z });
      const at = playback.time(now); if (at !== null && track.sample(at, target)) { viewer.x = target.x; viewer.z = target.z; }
      viewerView.push({ t: now, x: viewer.x, z: viewer.z });
    }
  }
  return { driver: driverView, viewer: viewerView, roomCar: { ...car } };
}
/** Delay from pressing the throttle (0.5 s) until the drawn car starts to move (1 mm: about 20 ms of acceleration). */
const response = view => view.find(f => f.t >= 500 && Math.hypot(f.x - view[0].x, f.z - view[0].z) > .001).t - 500;
/** On-screen speed wobble while cruising: RMS frame-to-frame change in drawn speed ÷ mean drawn speed. */
function wobble(view, from = 3000, to = 8500) {
  const speeds = []; for (let i = 1; i < view.length; i++) if (view[i].t >= from && view[i].t <= to) speeds.push(Math.hypot(view[i].x - view[i - 1].x, view[i].z - view[i - 1].z) / (FRAME / 1000));
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length, changes = speeds.slice(1).map((s, i) => (s - speeds[i]) ** 2);
  return Math.sqrt(changes.reduce((a, b) => a + b, 0) / changes.length) / mean;
}

test('driving responds at once and moves steadily; other players see steady cars', () => {
  const rows = [];
  for (const seed of [7, 21, 99]) {
    const before = simulate('previous', seed), after = simulate('current', seed);
    const r = { seed, responseBefore: response(before.driver), responseAfter: response(after.driver),
      driverWobbleBefore: wobble(before.driver), driverWobbleAfter: wobble(after.driver), viewerWobbleBefore: wobble(before.viewer), viewerWobbleAfter: wobble(after.viewer) };
    rows.push(r);
    // Same physics, same inputs: both pipelines end with the room's car in the same place within a metre or so.
    assert.ok(before.roomCar.x > 200 && after.roomCar.x > 200, `both runs cruise down the road (${before.roomCar.x}, ${after.roomCar.x}; z ${before.roomCar.z}, ${after.roomCar.z})`);
    assert.ok(r.responseAfter <= 2 * FRAME + 1, `the car starts moving within the physics' own first frames (${r.responseAfter} ms)`);
    assert.ok(r.responseBefore >= 100, `previously it waited for the network round trip (${r.responseBefore} ms)`);
    assert.ok(r.driverWobbleAfter < r.driverWobbleBefore / 4, `the driver's car moves steadily (${r.driverWobbleAfter} vs ${r.driverWobbleBefore})`);
    assert.ok(r.viewerWobbleAfter < r.viewerWobbleBefore / 4, `an onlooker sees a steady car (${r.viewerWobbleAfter} vs ${r.viewerWobbleBefore})`);
  }
  console.log(JSON.stringify(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v.toFixed(4))]))), null, 1));
});
