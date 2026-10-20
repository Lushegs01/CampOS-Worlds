// Remote player motion (src/network/interpolation.mjs): steady speed from 15 Hz snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, createClock, INTERP_DELAY } from '../src/network/interpolation.mjs';

/** A player walking at 4.5 m/s along +x; snapshots every 66.7 ms of room time, arriving with jitter. */
function walkSnapshots(seconds, jitter = 25) {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = []; for (let t = 0; t <= seconds * 1000; t += 1000 / 15) out.push({ room: t, arrive: t + 40 + rnd() * jitter, x: 4.5 * t / 1000 });
  return out.sort((a, b) => a.arrive - b.arrive);
}
/** Per-frame speeds when rendering at 60 FPS with snapshot interpolation. */
function interpolatedSpeeds(snaps) {
  const track = createTrack(), clock = createClock(), pos = {}, speeds = []; let i = 0, last = null;
  for (let now = 0; now < 4000; now += 1000 / 60) {
    while (i < snaps.length && snaps[i].arrive <= now) { const s = snaps[i++]; track.push(clock.receive(s.room, s.arrive), s.x, 0, 0, 0); }
    if (!track.sample(now - INTERP_DELAY, pos)) continue;
    if (last != null && now > 1000) speeds.push((pos.x - last) * 60); last = pos.x;
  }
  return speeds;
}
/** The previous approach: ease towards the newest snapshot at 12/s. */
function easedSpeeds(snaps) {
  let i = 0, x = 0, latest = 0, last = null; const speeds = [];
  for (let now = 0; now < 4000; now += 1000 / 60) {
    while (i < snaps.length && snaps[i].arrive <= now) latest = snaps[i++].x;
    x += (latest - x) * (1 - Math.exp(-12 / 60));
    if (last != null && now > 1000) speeds.push((x - last) * 60); last = x;
  }
  return speeds;
}
const spread = v => Math.max(...v) - Math.min(...v);

test('remote players walk at a steady speed between snapshots, despite network jitter', () => {
  const snaps = walkSnapshots(4), steady = interpolatedSpeeds(snaps), eased = easedSpeeds(snaps);
  const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
  assert.ok(Math.abs(mean - 4.5) < .1, `mean speed ${mean.toFixed(2)} m/s`);
  assert.ok(spread(steady) < 1, `speed varies by ${spread(steady).toFixed(2)} m/s per frame`);
  assert.ok(spread(eased) > 2 * spread(steady), `easing pulsed by ${spread(eased).toFixed(2)} m/s, interpolation by ${spread(steady).toFixed(2)}`);
});

test('a late packet extrapolates briefly, then holds; a teleport jumps rather than sliding', () => {
  const track = createTrack(), pos = {};
  track.push(0, 0, 0, 0, 0); track.push(100, .45, 0, 0, 0);
  track.sample(150, pos); assert.ok(Math.abs(pos.x - .675) < 1e-9, 'continues at the last velocity');
  track.sample(5000, pos); assert.ok(Math.abs(pos.x - (.45 + .45 * 2.5)) < 1e-9, 'for at most 250 ms');
  track.push(200, 40, 0, 0, 0); assert.equal(track.length, 1, 'history cleared by a teleport');
  track.sample(150, pos); assert.equal(pos.x, 40);
});

test('late or duplicated snapshots are ignored, and turning takes the short way round', () => {
  const track = createTrack(), pos = {};
  track.push(0, 0, 0, 0, 3.1); track.push(100, 0, 0, 0, -3.1); track.push(50, 9, 0, 0, 0);
  assert.equal(track.length, 2);
  track.sample(50, pos); assert.ok(Math.abs(Math.abs(pos.yaw) - Math.PI) < .01, `yaw ${pos.yaw}`);
});

test('the room clock offset follows the least-delayed message', () => {
  const clock = createClock();
  assert.equal(clock.receive(1000, 5100), 5100);
  assert.equal(clock.receive(1100, 5150), 5150, 'a faster message lowers the offset');
  assert.ok(clock.receive(1200, 5400) < 5400, 'a slow one barely moves it');
  clock.reset(); assert.equal(clock.receive(100, 9000), 9000, 'a new server connection starts with a fresh offset');
});
