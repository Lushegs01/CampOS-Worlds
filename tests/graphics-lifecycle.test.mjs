import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphicsLifecycle } from '../src/graphics/lifecycle.ts';

test('READY requires the current renderer, essential resources and a successful frame', () => {
  const states = [], g = createGraphicsLifecycle((_, next) => states.push(next.phase));
  assert.equal(g.getSnapshot().phase, 'INITIALIZING');
  assert.equal(g.frameRendered(1, 10), false);
  assert.equal(g.attach(1, 10), true);
  assert.equal(g.frameRendered(1, 10), false, 'mount does not prove scene readiness');
  assert.equal(g.resourcesReady(1, 9), false);
  assert.equal(g.resourcesReady(1, 10), true);
  assert.equal(g.getSnapshot().phase, 'INITIALIZING', 'downloads/compilation alone are not READY');
  assert.equal(g.frameRendered(1, 10), true);
  assert.equal(g.getSnapshot().phase, 'READY');
  g.preparing(1, 10);
  assert.equal(g.frameRendered(1, 10), false, 'changed resources must be revalidated');
  g.resourcesReady(1, 10); g.frameRendered(1, 10);
  assert.equal(g.getSnapshot().phase, 'READY');
});

test('context loss suspends readiness; recovery is single-flight and old callbacks cannot change the replacement', () => {
  const g = createGraphicsLifecycle(); g.attach(1, 10); g.resourcesReady(1, 10); g.frameRendered(1, 10);
  g.lost(1, 10, 'lost');
  assert.equal(g.getSnapshot().phase, 'CONTEXT_LOST');
  assert.equal(g.resourcesReady(1, 10), false); assert.equal(g.frameRendered(1, 10), false);
  assert.equal(g.recover(1), true);
  for (let i = 0; i < 10; i++) assert.equal(g.recover(1), false, 'duplicate clicks do not start more attempts');
  assert.equal(g.getSnapshot().generation, 2);
  g.attach(2, 11); g.resourcesReady(2, 11); g.frameRendered(2, 11);
  const ready = g.getSnapshot();
  for (const callback of [() => g.attach(1, 12), () => g.lost(1, 10, 'late lost'), () => g.fail(1, 'late error', 10),
    () => g.recover(1), () => g.preparing(1, 10), () => g.resourcesReady(1, 10), () => g.frameRendered(1, 10)]) assert.equal(callback(), false);
  assert.equal(g.getSnapshot(), ready);
});

test('failed initialization/recovery stays visible until a validated retry; disposal rejects every callback', () => {
  const g = createGraphicsLifecycle();
  g.fail(1, 'creation failed');
  assert.equal(g.getSnapshot().phase, 'RECOVERY_FAILED'); assert.equal(g.getSnapshot().error, 'creation failed');
  assert.equal(g.attach(1, 10), false);
  g.recover(1); g.attach(2, 11); g.resourcesReady(2, 11);
  assert.equal(g.getSnapshot().phase, 'RECOVERING');
  g.fail(2, 'draw failed', 11);
  assert.equal(g.frameRendered(2, 11), false);
  g.recover(2); g.attach(3, 12); g.resourcesReady(3, 12); g.frameRendered(3, 12);
  assert.equal(g.getSnapshot().phase, 'READY'); assert.equal(g.getSnapshot().error, '');
  g.dispose();
  for (const callback of [() => g.attach(3, 20), () => g.lost(3, 12, 'late'), () => g.fail(3, 'late'), () => g.recover(3), () => g.frameRendered(3, 12)]) assert.equal(callback(), false);
  assert.equal(g.getSnapshot().phase, 'DISPOSED');
});
