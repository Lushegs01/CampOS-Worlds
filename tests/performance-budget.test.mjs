import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceBudget } from '../shared/arena/performance.mjs';
import { canPredict, MAX_PENDING_COMMANDS, MAX_BUFFERED_BYTES, createSnapshotOrder } from '../src/network/flow.mjs';

test('effect budgets change before pixels, preserve their floor and restore after sustained headroom', () => {
  const a = createPerformanceBudget({ min: .85 });
  const changes = [];
  for (let i = 0; i < 50; i++) { const r = a.sample(15); if (r.changed) changes.push(r); }
  assert.deepEqual(changes.slice(0, 2).map(r => [r.level, r.scale]), [[1, 1], [2, 1]]);
  assert.ok(changes.some(r => r.scale < 1));
  assert.ok(changes.every(r => r.scale >= .85));
  for (let i = 0; i < 120; i++) a.sample(60);
  assert.equal(a.scale, 1); assert.equal(a.level, 0);
});

test('CPU-bound frames restore sharpness, and jitter does not oscillate the budget', () => {
  const a = createPerformanceBudget();
  for (let i = 0; i < 40; i++) a.sample(20);
  assert.equal(a.scale, 1, 'pixel reduction without measurable gain is undone');
  const b = createPerformanceBudget();
  for (let i = 0; i < 120; i++) b.sample(i % 2 ? 25 : 32);
  assert.equal(b.level, 0); assert.equal(b.scale, 1);
  for (const fps of [NaN, Infinity, 0, -1]) assert.equal(b.sample(fps).changed, false);
});

test('snapshot order drops duplicates and reordered life/HUD snapshots; reconnect resets the clock', () => {
  const order = createSnapshotOrder();
  assert.equal(order.accept(100), true); assert.equal(order.accept(101), true);
  for (const at of [101, 99, NaN, Infinity, undefined]) assert.equal(order.accept(at), false);
  order.reset(); assert.equal(order.accept(1), true);
});

test('silent network loss bounds speculative commands and browser buffering independently of FPS', () => {
  let pending = 0;
  for (let tick = 0; tick < 10000; tick++) if (canPredict(pending, 0)) pending++;
  assert.equal(pending, MAX_PENDING_COMMANDS);
  assert.equal(canPredict(pending - 1, MAX_BUFFERED_BYTES + 1), false);
  assert.equal(canPredict(pending - 1, 0), true, 'an acknowledgement releases capacity');
});
