// The adaptive resolution policy (src/world/resolution.mjs), driven with synthetic frame times.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolution, STALL } from '../src/world/resolution.mjs';

/** Run `seconds` of frames; `frameTime(scale)` models how long a frame takes at a render scale. */
function run(r, seconds, frameTime) { const changes = []; for (let t = 0; t < seconds;) { const dt = frameTime(r.scale); t += dt; const next = r.frame(dt); if (next != null) changes.push(next); } return changes; }

test('returning to a backgrounded tab does not lower the resolution', () => {
  const r = createResolution(1, .6);
  run(r, 5, () => 1 / 60);
  assert.equal(r.frame(12), null, 'a 12 s gap is a pause, not a frame');
  assert.equal(r.frame(STALL + .01), null);
  assert.deepEqual(run(r, 5, () => 1 / 60), []);
  assert.equal(r.scale, 1);
});

test('a fill-rate-limited device steps down until frames are fast enough, then holds', () => {
  const r = createResolution(1, .6);
  // Frame time proportional to the pixels drawn: 35 ms at full scale.
  const changes = run(r, 40, s => .035 * s * s);
  assert.ok(changes.length >= 2 && changes.every((c, i) => i === 0 || c < changes[i - 1]), `stepped down: ${changes}`);
  assert.ok(r.scale < .9 && r.scale >= .6);
  assert.ok(1 / (.035 * r.scale * r.scale) >= 50, "until the frame rate recovers");
  assert.deepEqual(run(r, 20, s => .035 * s * s), [], "and then it stays put (no hunting)");
});

test('a device that is not limited by resolution keeps it (a 30 FPS cap or a busy CPU)', () => {
  const r = createResolution(1, .6);
  const changes = run(r, 120, () => 1 / 30);
  assert.equal(r.scale, 1, 'back at full resolution');
  // One trial step down and its revert, then waits of 20 s, 40 s and 80 s between trials.
  assert.ok(changes.length <= 6, `at most a few trials in two minutes, got ${changes.length}`);
});

test('headroom brings the resolution back up', () => {
  const r = createResolution(1, .6);
  run(r, 40, s => .025 * s * s);
  const low = r.scale;
  run(r, 30, () => 1 / 60);
  assert.ok(r.scale > low && r.scale <= 1);
});

test('frames in the 50–59 FPS dead band change nothing', () => {
  const r = createResolution(1, .6);
  assert.deepEqual(run(r, 30, () => 1 / 55), []);
});
