// Client prediction and the room's simulation must agree on where a walking player ends up, even
// when the client's frames are slow and uneven (a weak phone, a busy tab). Both sides use
// shared/movement.mjs; this replays a walk with the room's 30 Hz ticks and its input hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepWalker, MAX_STEP, INPUT_HOLD_MS, WALK_SPEED } from '../shared/movement.mjs';

/** A walk from (x0, z0) to the target, steered like a player releasing the key on arrival. */
function walk(frames, { from = { x: 0, z: 36 }, to = { x: 0, z: 14 }, cap = MAX_STEP } = {}) {
  const client = { ...from, y: 0, vx: 0, vz: 0, vy: 0 }, room = { ...from, y: 0, vx: 0, vz: 0, vy: 0 };
  let t = 0, nextTick = 0, input = { dx: 0, dz: 0 }, lastInput = -1e9, frame = 0;
  const tick = until => {
    // The room's simulation loop: every 1/30 s, the last input applies for INPUT_HOLD_MS.
    for (; nextTick <= until; nextTick += 1000 / 30) {
      const active = nextTick - lastInput < INPUT_HOLD_MS;
      stepWalker(room, active ? input.dx * WALK_SPEED : 0, active ? input.dz * WALK_SPEED : 0, 1 / 30);
    }
  };
  for (let n = 0; n < 400; n++) {
    const ms = frames[frame++ % frames.length]; t += ms; tick(t);
    // Client frame: steer towards the target, integrate the elapsed time (capped), send the input.
    const ex = to.x - client.x, ez = to.z - client.z, d = Math.hypot(ex, ez);
    const scale = d < .1 ? 0 : Math.min(WALK_SPEED, d * 4 + .3) / WALK_SPEED, dx = d < .1 ? 0 : ex / d * scale, dz = d < .1 ? 0 : ez / d * scale;
    stepWalker(client, dx * WALK_SPEED, dz * WALK_SPEED, Math.min(ms / 1000, cap));
    input = { dx, dz }; lastInput = t;
  }
  tick(t + 2000);
  return { client, room, gap: Math.hypot(client.x - room.x, client.z - room.z), arrived: Math.hypot(client.x - to.x, client.z - to.z) };
}

test('a 60 FPS walk: the room and the client stop at the same spot', () => {
  const r = walk([16.7]);
  assert.ok(r.arrived < .15, `client stopped ${r.arrived.toFixed(2)} m from the target`);
  assert.ok(r.gap < .3, `room and client disagree by ${r.gap.toFixed(2)} m`);
});

test('slow, uneven frames (including stalls longer than the input hold) do not let the room run ahead', () => {
  // 3–7 FPS with hitches: what software WebGL or a struggling phone produces.
  const frames = [180, 220, 310, 260, 330, 600, 190, 240, 280, 420, 205, 300];
  const r = walk(frames);
  assert.ok(r.arrived < .15, `client stopped ${r.arrived.toFixed(2)} m from the target`);
  // Under 0.9 m the standing client's settle request reconciles the room without any visible correction.
  assert.ok(r.gap < .6, `room and client disagree by ${r.gap.toFixed(2)} m after a slow-frame walk`);
});

test('the previous 250 ms client limit is what let them drift apart (guards the shared limit)', () => {
  const frames = [180, 220, 310, 260, 330, 600, 190, 240, 280, 420, 205, 300];
  assert.ok(walk(frames, { cap: .25 }).gap > 1, 'a lower client cap should reproduce the drift');
  assert.equal(MAX_STEP * 1000, INPUT_HOLD_MS);
});

test('a stalled frame never integrates more than the room would have moved', () => {
  const w = { x: 0, z: 36, y: 0, vx: 0, vz: -WALK_SPEED, vy: 0 };
  stepWalker(w, 0, -WALK_SPEED, Math.min(10, MAX_STEP));
  assert.ok(36 - w.z <= WALK_SPEED * MAX_STEP + 1e-9);
});

test('a room position along the path just walked is lag, not drift', async () => {
  const { createTrail } = await import('../shared/movement.mjs');
  const trail = createTrail(1.5);
  // Walked from z = 36 to z = 32.5 over the last 0.7 s, sampled at 5 FPS (0.9 m apart).
  for (let i = 0; i <= 4; i++) trail.push(0, 36 - i * .875, 1000 + i * 175);
  const now = 1700;
  assert.ok(trail.distance(0, 34.6, now) < 1e-9, 'a lagging room snapshot lies on the path');
  assert.ok(Math.abs(trail.distance(3, 34, now) - 3) < 1e-9, 'a snapshot 3 m to the side is real drift');
  assert.ok(Math.abs(trail.distance(0, 30, now) - 2.5) < 1e-9, 'a snapshot ahead of us is measured from where we are');
  assert.equal(trail.distance(0, 36, 1000 + 4 * 175 + 2000), Infinity, 'nothing recent: no evidence of lag');
  // Samples older than the window are ignored.
  assert.ok(Math.abs(trail.distance(0, 36, 1000 + 175 + 1501) - .875 * 2) < 1e-9);
  trail.clear(); assert.equal(trail.distance(0, 0, now), Infinity);
});

/**
 * Walk forward for `frames` frames, then let go of the key. Frame times cycle through `pattern` (ms).
 * `retroactive` is the old client: each frame applied the input it had just computed to the time that had
 * already passed, while the room applies an input from its arrival until the next one, so with uneven
 * frames the two weighted each input by different durations.
 */
function stopAfter(frames, pattern, retroactive) {
  const client = { x: 0, z: 36, y: 0, vx: 0, vz: 0, vy: 0 }, room = { ...client };
  let t = 0, nextTick = 0, sent = 0, lastInput = -1e9, applied = 0;
  for (let f = 0; f < frames + 6; f++) {
    const ms = pattern[f % pattern.length]; t += ms;
    for (; nextTick <= t; nextTick += 1000 / 30) { const active = nextTick - lastInput < INPUT_HOLD_MS; stepWalker(room, 0, active ? -sent * WALK_SPEED : 0, 1 / 30); }
    const want = f < frames ? 1 : 0; // the key is down for the first `frames` frames
    stepWalker(client, 0, -(retroactive ? want : applied) * WALK_SPEED, Math.min(ms / 1000, MAX_STEP));
    applied = want; sent = want; lastInput = t;
  }
  for (; nextTick <= t + 2000; nextTick += 1000 / 30) stepWalker(room, 0, 0, 1 / 30);
  for (let i = 0; i < 20; i++) stepWalker(client, 0, 0, .1);
  return Math.abs(client.z - room.z);
}

test('letting go of a key on uneven slow frames: the room stops where the client does', () => {
  // A slow start (a long frame as the key goes down) and quick frames at the end, as on a struggling phone.
  const uneven = [340, 120, 90, 330, 110, 300, 100, 320, 90, 80, 330, 60];
  const now = stopAfter(11, uneven, false), before = stopAfter(11, uneven, true);
  // The client now moves each frame with the input it sent for that interval, exactly as the room does.
  assert.ok(now < .1, `room and client stop ${now.toFixed(2)} m apart`);
  assert.ok(stopAfter(12, [16.7], false) < .1);
  // The old order left them apart by about a frame of walking (a glide or snap after stopping).
  assert.ok(before > .5, `old order: ${before.toFixed(2)} m`);
});
