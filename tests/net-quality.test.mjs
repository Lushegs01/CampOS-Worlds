// Connection grading and jitter-adaptive interpolation (src/network/netQuality.mjs), on synthetic links with the
// timing of real ones; and the separation of networking from graphics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createNetMonitor, DELAY } from '../src/network/netQuality.mjs';
import { createPlayback } from '../src/network/interpolation.mjs';

/** Drive a monitor: pings every 2 s with round trips `rtt(i)`, snapshots every `snap(i)` ms, pings lost per `lose(i)`. */
function link({ rtt, snap, lose = () => false, seconds = 30 }) {
  const m = createNetMonitor(); let t = 1000, nextPing = 1000, i = 0, j = 0;
  while (t < 1000 + seconds * 1000) {
    if (t >= nextPing) { m.ping(t, t); if (!lose(j)) m.pong(t, t + rtt(j)); nextPing += 2000; j++; }
    m.snapshot(t); t += snap(i++);
  }
  return m.report(t);
}
const rand = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);

test('a clean link is good and keeps the default delay', () => {
  const r = link({ rtt: () => 40, snap: () => 50 });
  assert.equal(r.grade, 'good'); assert.equal(r.rtt, 40); assert.equal(r.delayMs, DELAY.min);
});
test('150 ms with mild jitter is fair; 300 ms or heavy jitter is poor', () => {
  assert.equal(link({ rtt: () => 150 + rand() * 20, snap: () => 50 + rand() * 20 }).grade, 'fair');
  assert.equal(link({ rtt: () => 300 + rand() * 30, snap: () => 50 }).grade, 'poor');
  const j = link({ rtt: () => 80 + rand() * 160, snap: () => 50 + rand() * 200 });
  assert.equal(j.grade, 'poor'); assert.ok(j.delayMs > DELAY.min && j.delayMs <= DELAY.max, `delay ${j.delayMs}`);
});
test('lost pings and a long silence are critical', () => {
  assert.equal(link({ rtt: () => 60, snap: () => 50, lose: i => i % 2 === 0 }).grade, 'critical');
  const m = createNetMonitor(); m.snapshot(1000); assert.equal(m.report(3000).grade, 'critical');
});
test('frequent server corrections degrade the grade', () => {
  const m = createNetMonitor(); for (let t = 0; t < 2000; t += 50) m.snapshot(t);
  for (let k = 0; k < 15; k++) m.correction(.4, 1000 + k * 100);
  const r = m.report(2000); assert.notEqual(r.grade, 'good'); assert.equal(r.worstCorrection, .4);
});
test('the interpolation delay eases to its new value instead of jumping', () => {
  const p = createPlayback(100); p.receive(10000, 0);
  const t0 = p.time(16); p.setDelay(200);
  const t1 = p.time(32); assert.ok(t1 - t0 > 0, 'drawn time keeps moving forward');
  for (let t = 48; t < 4000; t += 16) p.time(t);
  assert.ok(Math.abs(p.delay - 200) < 3, `settled at ${p.delay}`);
});
test('graphics and networking are independent', () => {
  // Nothing under the graphics settings or adaptive rendering reads connection quality, and the monitor never
  // touches graphics settings.
  for (const f of ['shared/arena/adaptive.mjs', 'shared/arena/settings.mjs', 'src/arena/scene/world.ts']) assert.doesNotMatch(readFileSync(f, 'utf8'), /netQuality|netMonitor|\brtt\b|hud\.net/, f);
  assert.doesNotMatch(readFileSync('src/network/netQuality.mjs', 'utf8'), /^import/m);
  void readdirSync;
});
