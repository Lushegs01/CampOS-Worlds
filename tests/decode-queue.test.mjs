// The decode queue (src/world/decodeQueue.ts): files the player is waiting for decode before background files queued
// earlier; at most two decode at once; a time limit counts from the start of a decode, not while it waits; a decode
// that throws frees its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSlot, decodeState } from '../src/world/decodeQueue.ts';

const later = ms => new Promise(r => setTimeout(r, ms));
test('priority 1 overtakes queued background decodes; two at a time', async () => {
  const order = []; let peak = 0;
  const job = (name, ms) => async () => { order.push(name); peak = Math.max(peak, decodeState().running); await later(ms); return name; };
  const all = [decodeSlot({ priority: 3 }, 'a', job('bg1', 30)), decodeSlot({ priority: 3 }, 'b', job('bg2', 30)), decodeSlot({ priority: 2 }, 'c', job('bg3', 5)), decodeSlot({ priority: 3 }, 'd', job('bg4', 5)), decodeSlot({ priority: 1 }, 'e', job('needed', 5))];
  await Promise.all(all);
  assert.deepEqual(order, ['bg1', 'bg2', 'needed', 'bg3', 'bg4']);
  assert.equal(peak, 2);
});
test('a decode that throws frees its place, and the queue carries on', async () => {
  await assert.rejects(decodeSlot({ priority: 1 }, 'bad', () => { throw new Error('corrupt file'); }), /corrupt/);
  assert.equal(await decodeSlot({ priority: 1 }, 'good', async () => 'ok'), 'ok');
  assert.deepEqual(decodeState(), { running: 0, queued: 0 });
});
