import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrediction, createMotionAuthority } from '../shared/prediction.mjs';

const body = () => ({ x: -300, z: 300, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// An ordered, delayed TCP connection, including bursts of buffered messages, turns, jump and release.
function replay({ delay = 0, jitter = 0, frames = [1000 / 60] } = {}) {
  const client = body(), server = body(), p = createPrediction(client), a = createMotionAuthority(server);
  p.receive(a.snapshot('', 0)); p.frame(0, 0, 0, false, false, 0);
  const events = []; let t = 0, inbound = 0, outbound = 0, peak = 0, rejected = 0;
  for (let i = 0; t < 16000; i++) { t += frames[i % frames.length]; events.push({ t, type: 'frame', dt: frames[i % frames.length] / 1000 }); }
  for (let t = 0; t < 21000; t += 1000 / 15) events.push({ t, type: 'tick' });
  while (events.length) {
    events.sort((a, b) => a.t - b.t); const e = events.shift(), t = e.t;
    if (e.type === 'frame') {
      p.frame(e.dt, t < 5000 ? 1 : t < 10000 ? 0 : t < 14000 ? -1 : 0, t >= 5000 && t < 10000 ? 1 : 0, true, t > 6000 && t - e.dt * 1000 <= 6000, 0);
      const batch = p.batch(); p.didSend(batch);
      inbound = Math.max(inbound + .001, t + delay + jitter * Math.sin(t * .009));
      if (batch.commands.length) events.push({ t: inbound, type: 'input', batch });
    } else if (e.type === 'input') {
      if (!a.receive(e.batch, '', t)) rejected++;
    } else if (e.type === 'tick') {
      const snapshot = a.snapshot('', t);
      outbound = Math.max(outbound + .001, t + delay + jitter * Math.sin(t * .007));
      events.push({ t: outbound, type: 'snapshot', snapshot });
    } else {
      const before = { ...client }; p.receive(e.snapshot); peak = Math.max(peak, distance(client, before));
    }
  }
  return { gap: distance(client, server), peak, pending: p.pending, rejected };
}

test('delayed and bursty acknowledgements replay pending movement without backward jumps', () => {
  for (const [delay, jitter] of [[0, 0], [150, 120], [350, 250], [1000, 600]]) {
    const r = replay({ delay, jitter });
    assert.equal(r.rejected, 0, JSON.stringify({ delay, jitter, ...r }));
    assert.ok(r.peak < 1e-8, `snapshot moved the predicted player ${r.peak} m (delay ${delay})`);
    assert.ok(r.gap < 1e-8); assert.equal(r.pending, 0);
  }
});

test('uneven 2 FPS frames, jump and key release remain identical across delayed peers', () => {
  const r = replay({ delay: 150, jitter: 120, frames: [533, 833, 450, 1083, 633, 517] });
  assert.equal(r.rejected, 0); assert.ok(r.peak < 1e-8); assert.ok(r.gap < 1e-8);
});

test('duplicates, forged durations and invalid commands cannot create movement time', () => {
  const w = body(), a = createMotionAuthority(w), command = [1, .1, 1, 0, 1, 0, 0];
  const send = commands => a.receive({ epoch: a.snapshot('', 0).epoch, commands }, '', 0);
  assert.equal(send([command]), true); const once = w.x;
  assert.equal(send([command]), true); assert.equal(w.x, once);
  for (const bad of [[2, 1.36, 1, 0, 1, 0, 0], [2, .1, 9, 0, 1, 0, 0], [2, NaN, 1, 0, 1, 0, 0], [4, .1, 1, 0, 1, 0, 0]]) {
    assert.equal(send([bad]), false); assert.equal(w.x, once);
  }
  assert.equal(send([[2, .2, 1, 0, 1, 0, 0]]), false, 'server clock bounds total simulated time');
  assert.equal(w.x, once);
  // Repeated invalid generations must not replenish the time allowance.
  for (let i = 0; i < 100; i++) send([[1, .2, 1, 0, 1, 0, 0]]);
  assert.equal(w.x, once);
});

test('teleports invalidate in-flight commands and reset velocity; old snapshots stay ignored', () => {
  const w = body(), c = body(), a = createMotionAuthority(w), p = createPrediction(c);
  const original = a.snapshot('', 0); p.receive(original); p.frame(0, 0, 0, false, false, 0);
  p.frame(.1, 1, 0, true, false, 0); const old = p.batch();
  Object.assign(w, { x: -280, z: 320, vx: 0, vz: 0, vy: 0 });
  const teleported = a.snapshot('dorm', 200);
  assert.equal(a.receive(old, 'dorm', 200), false);
  p.receive(teleported); assert.equal(p.pending, 0); assert.equal(distance(c, w), 0);
  p.receive(original); assert.equal(distance(c, w), 0);
  p.stop(); assert.equal(c.vx, 0); assert.equal(c.vz, 0); assert.equal(p.active, false);
});

test('authoritative collision corrections are replayed rather than hidden by a path tolerance', () => {
  const w = body(), c = body(), a = createMotionAuthority(w), p = createPrediction(c);
  p.receive(a.snapshot('', 0)); p.frame(0, 0, 0, false, false, 0);
  p.frame(.1, 1, 0, true, false, 0); const batch = p.batch(); p.didSend(batch);
  a.receive(batch, '', 100, () => false); p.receive(a.snapshot('', 100));
  assert.equal(c.x, w.x); assert.equal(p.pending, 0);
});

test('high-refresh input batches stay within the message limit, and a silent loss bounds history', () => {
  const w = body(), p = createPrediction(w), a = createMotionAuthority(body()); p.receive(a.snapshot('', 0));
  p.frame(0, 0, 0, false, false, 0);
  for (let i = 0; i < 2000; i++) p.frame(1 / 240, Math.SQRT1_2, Math.SQRT1_2, true, false, Math.PI);
  assert.equal(p.pending, 1024);
  assert.ok(JSON.stringify(p.batch()).length < 2048);
});

test('a jump shot between frames survives pre-shot acknowledgements without losing or doubling the impulse', () => {
  const w = body(), c = body(), a = createMotionAuthority(w), p = createPrediction(c);
  p.receive(a.snapshot('', 0)); p.frame(0, 0, 0, false, false, 0);
  p.frame(.1, 0, 0, false, false, 0); a.receive(p.batch(), '', 100);
  assert.equal(p.hop(), true); p.frame(.1, 0, 0, false, false, 0);
  const height = c.y, velocity = c.vy; assert.ok(height > .2);
  p.receive(a.snapshot('', 100)); assert.equal(c.y, height); assert.equal(c.vy, velocity);
  a.receive(p.batch(), '', 200); p.receive(a.snapshot('', 200));
  assert.equal(c.y, height); assert.equal(c.vy, velocity); assert.equal(p.pending, 0);
});

test('changing authoritative context cannot replenish movement time', () => {
  const w = body(), a = createMotionAuthority(w);
  a.snapshot('', 0); a.receive({ epoch: 1, commands: [[1, .1, 1, 0, 1, 0, 0]] }, '', 0);
  for (let i = 0; i < 20; i++) {
    const context = `seat-${i}`, s = a.snapshot(context, 0), x = w.x;
    assert.equal(a.receive({ epoch: s.epoch, commands: [[1, .15, 1, 0, 1, 0, 0]] }, context, 0), false);
    assert.equal(w.x, x);
  }
});
