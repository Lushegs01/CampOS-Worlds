import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/network/session.mjs';

test('denied browser storage cannot prevent joining or lose the reconnect token', () => {
  const denied = createSession(() => { throw new Error('SecurityError'); });
  assert.equal(denied.get(), null); denied.set('room-token'); assert.equal(denied.get(), 'room-token');
  let value = 'copied-tab-token'; const normal = createSession(() => ({ getItem: () => value, setItem: (_, token) => { value = token; } }));
  assert.equal(normal.get(), 'copied-tab-token'); normal.set('replacement'); assert.equal(value, 'replacement');
});
