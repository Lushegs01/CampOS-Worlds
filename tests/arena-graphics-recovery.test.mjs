import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphicsLifecycle } from '../src/arena/scene/graphicsLifecycle.mjs';

test('only validation of the active generation can make graphics ready', () => {
  const g = createGraphicsLifecycle(), first = g.begin();
  assert.equal(g.getSnapshot().state, 'INITIALIZING');
  assert.ok(g.transition(first, 'READY'));
  assert.ok(g.transition(first, 'CONTEXT_LOST'));
  assert.equal(g.transition(first, 'READY'), false);
  assert.ok(g.restore(first));
  assert.equal(g.transition(first, 'READY'), false, 'restored resources need a new incarnation');
  const second = g.begin();
  assert.equal(g.getSnapshot().state, 'RECOVERING');
  assert.equal(g.transition(first, 'RECOVERY_FAILED', 'obsolete error'), false);
  g.retire(first);
  assert.ok(g.transition(second, 'READY'));
  assert.equal(g.getSnapshot().error, '');
});

test('failed recovery permits one retry and rejects retired renderer events', () => {
  const g = createGraphicsLifecycle(), id = g.begin();
  g.transition(id, 'RECOVERY_FAILED', 'shader failed');
  assert.equal(g.getSnapshot().error, 'shader failed');
  assert.ok(g.retry());
  assert.equal(g.retry(), false);
  assert.equal(g.transition(id, 'CONTEXT_LOST'), false);
  assert.equal(g.transition(id, 'READY'), false);
  const current = g.begin();
  assert.ok(g.transition(current, 'READY'));
  assert.equal(g.getSnapshot().error, '');
  g.retire(current);
  assert.equal(g.getSnapshot().state, 'DISPOSED');
  assert.equal(g.transition(current, 'CONTEXT_LOST'), false);
});

test('entry/exit cycles retire every listener generation', () => {
  const g = createGraphicsLifecycle();
  let notifications = 0;
  const off = g.subscribe(() => notifications++);
  for (let i = 0; i < 20; i++) {
    const id = g.begin();
    assert.ok(g.transition(id, 'READY'));
    g.retire(id);
    assert.equal(g.transition(id, 'RECOVERY_FAILED'), false);
  }
  off();
  const count = notifications;
  g.begin();
  assert.equal(notifications, count);
});
