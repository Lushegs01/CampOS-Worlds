// Client prediction and the room's simulation must agree on where a walking player ends up, even
// when the client's frames are slow and uneven (a weak phone, a busy tab). Both sides use
// shared/movement.mjs; these tests replay walks with the room's 30 Hz ticks and its input hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepWalker, stepFrame, advanceWalker, createTrail, MAX_STEP, INPUT_HOLD_MS, WALK_SPEED } from '../shared/movement.mjs';

const TICK = 1000 / 30;
/**
 * The room as server/room.mjs runs it: every 1/30 s each player is walked on (advanceWalker), and an
 * arriving input first walks the player on to its arrival with the previous input. Inputs are velocities
 * here (dx, dz in m/s at walking speed).
 */
function room(start) {
  const w = { ...start, simAt: 0 }; let next = TICK, input = { dx: 0, dz: 0 }, at = -1e9;
  return {
    w,
    receive(x, z, t) { advanceWalker(w, input, at, t); input = { dx: x / WALK_SPEED, dz: z / WALK_SPEED }; at = t; },
    until(t) { for (; next <= t; next += TICK) advanceWalker(w, input, at, next); },
  };
}
/**
 * A steered walk from `from` to `to` with frame times cycling through `frames` (ms).
 * model 'now': the client walks each frame with the input it last sent, coasting within long frames
 * (stepFrame), and steers so one slow frame cannot overshoot. model 'original': the first client, which
 * applied each new input to the time already passed and integrated at most 250 ms per frame.
 */
function walk(frames, { from = { x: 0, z: 36 }, to = { x: 0, z: 14 }, model = 'now' } = {}) {
  const start = { ...from, y: 0, vx: 0, vz: 0, vy: 0 }, client = { ...start }, r = room(start);
  let t = 0, sent = { x: 0, z: 0 };
  const steer = (f, coming) => { const ex = to.x - client.x, ez = to.z - client.z, d = Math.hypot(ex, ez); if (d < .1) return { x: 0, z: 0 }; let speed = Math.min(WALK_SPEED, d * 4 + .3); if (model === 'now') speed = Math.min(speed, Math.max(0, .8 * (d - coming * f) / f)); return { x: ex / d * speed, z: ez / d * speed }; };
  for (let n = 0; n < 400; n++) {
    const ms = frames[n % frames.length], f = Math.max(Math.min(ms / 1000, MAX_STEP), 1 / 60); t += ms; r.until(t);
    if (model === 'now') { stepFrame(client, sent.x, sent.z, ms / 1000); sent = steer(f, Math.hypot(sent.x, sent.z)); }
    else { const want = steer(f, 0); stepWalker(client, want.x, want.z, Math.min(ms / 1000, .25)); sent = want; }
    r.receive(sent.x, sent.z, t);
  }
  r.until(t + 3000);
  for (let i = 0; i < 30; i++) stepWalker(client, 0, 0, .1);
  return { gap: Math.hypot(client.x - r.w.x, client.z - r.w.z), arrived: Math.hypot(client.x - to.x, client.z - to.z) };
}

const SLOW = [180, 220, 310, 260, 330, 600, 190, 240, 280, 420, 205, 300];
// Frame times recorded in the interactions suite with two software-rendered browsers (about 2 FPS).
const TWO_FPS = [533, 533, 833, 450, 667, 550, 1083, 633, 533, 500, 550, 517];

test('a 60 FPS walk: the room and the client stop at the same spot', () => {
  const r = walk([16.7]);
  assert.ok(r.arrived < .15, `client stopped ${r.arrived.toFixed(2)} m from the target`);
  assert.ok(r.gap < .1, `room and client disagree by ${r.gap.toFixed(2)} m`);
});

test('slow, uneven frames, including stalls past the input hold: the room ends where the client does', () => {
  for (const frames of [SLOW, TWO_FPS]) {
    const r = walk(frames);
    assert.ok(r.arrived < .3, `client stopped ${r.arrived.toFixed(2)} m from the target`);
    assert.ok(r.gap < .1, `room and client disagree by ${r.gap.toFixed(2)} m (frames ${frames.slice(0, 3)}…)`);
  }
});

test('the original client drifted from the room on the same frames (guards the shared rules)', () => {
  assert.ok(walk(SLOW, { model: 'original' }).gap > 1, 'the original client should reproduce the drift');
  assert.equal(MAX_STEP * 1000, INPUT_HOLD_MS);
});

test('a long frame walks the held input, then coasts; a long pause adds nothing', () => {
  const w = { x: 0, z: 36, y: 0, vx: 0, vz: -WALK_SPEED, vy: 0 };
  const spent = stepFrame(w, 0, -WALK_SPEED, 10);
  assert.ok(Math.abs(spent - (MAX_STEP + 1)) < 1e-9);
  // The room, given the same input at the start of the same 10 s, ends in the same place.
  const r = { x: 0, z: 36, y: 0, vx: 0, vz: -WALK_SPEED, vy: 0, simAt: 0 };
  for (let t = 1000 / 30; t <= 10000; t += 1000 / 30) advanceWalker(r, { dx: 0, dz: -1 }, 0, t);
  assert.ok(Math.abs(w.z - r.z) < .01, `client ${w.z.toFixed(3)}, room ${r.z.toFixed(3)}`);
  assert.ok(36 - w.z > WALK_SPEED * MAX_STEP && 36 - w.z < WALK_SPEED * MAX_STEP + .4, 'held, then a short coast');
});

test('a room position along the path just walked is lag, not drift', () => {
  const trail = createTrail(1.5);
  // Walked from z = 36 to z = 32.5 over the last 0.7 s, sampled at 5 FPS (0.9 m apart).
  for (let i = 0; i <= 4; i++) trail.push(0, 36 - i * .875, 1000 + i * 175);
  const now = 1700;
  assert.ok(trail.distance(0, 34.6, now) < 1e-9, 'a lagging room snapshot lies on the path');
  assert.ok(Math.abs(trail.distance(3, 34, now) - 3) < 1e-9, 'a snapshot 3 m to the side is real drift');
  assert.ok(Math.abs(trail.distance(0, 30, now) - 2.5) < 1e-9, 'a snapshot ahead of us is measured from where we are');
  assert.equal(trail.distance(0, 36, 1000 + 4 * 175 + 2000), Infinity, 'nothing recent: no evidence of lag');
  assert.ok(Math.abs(trail.distance(0, 36, 1000 + 175 + 1501) - .875 * 2) < 1e-9, 'samples older than the window are ignored');
  trail.clear(); assert.equal(trail.distance(0, 0, now), Infinity);
});

/** Hold forward for `frames` frames, then let go; frame times cycle through `pattern`. */
function stopAfter(frames, pattern, model) {
  const start = { x: 0, z: 36, y: 0, vx: 0, vz: 0, vy: 0 }, client = { ...start }, r = room(start);
  let t = 0, sent = 0;
  for (let f = 0; f < frames + 6; f++) {
    const ms = pattern[f % pattern.length]; t += ms; r.until(t);
    const want = f < frames ? 1 : 0;
    if (model === 'now') stepFrame(client, 0, -sent * WALK_SPEED, ms / 1000); else stepWalker(client, 0, -want * WALK_SPEED, Math.min(ms / 1000, .25));
    sent = want; r.receive(0, -sent * WALK_SPEED, t);
  }
  r.until(t + 3000);
  for (let i = 0; i < 30; i++) stepWalker(client, 0, 0, .1);
  return Math.abs(client.z - r.w.z);
}

test('letting go of a key on uneven slow frames: the room stops where the client does', () => {
  const uneven = [340, 120, 90, 330, 110, 300, 100, 320, 90, 80, 330, 60];
  for (const pattern of [uneven, TWO_FPS, [16.7]]) {
    const gap = stopAfter(11, pattern, 'now');
    assert.ok(gap < .05, `room and client stop ${gap.toFixed(3)} m apart`);
  }
  // The original client ended 0.4 m (uneven frames) to 5 m (2 FPS) from the room after the same walk.
  assert.ok(stopAfter(11, uneven, 'original') > .3 && stopAfter(11, TWO_FPS, 'original') > 1, 'the original client stopped away from the room');
});
