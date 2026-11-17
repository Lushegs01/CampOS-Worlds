// The decode queue (src/world/decodeQueue.ts): files the player is waiting for decode before background files queued
// earlier; at most two decode at once; a time limit counts from the start of a decode, not while it waits; a decode
// that throws frees its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSlot, decodeState } from '../src/world/decodeQueue.ts';
import { traffic, endSession } from '../src/world/fetcher.ts';

const later = ms => new Promise(r => setTimeout(r, ms));
test('priority 1 overtakes queued background decodes; two at a time', async () => {
  const order = []; let peak = 0;
  const job = (name, ms) => async () => { order.push(name); peak = Math.max(peak, decodeState().running); await later(ms); return name; };
  const all = [decodeSlot({ priority: 3 }, 'a', job('bg1', 30)), decodeSlot({ priority: 3 }, 'b', job('bg2', 30)), decodeSlot({ priority: 2 }, 'c', job('bg3', 5)), decodeSlot({ priority: 3 }, 'd', job('bg4', 5)), decodeSlot({ priority: 1 }, 'e', job('needed', 5))];
  await Promise.all(all);
  // One slot is kept for priority 1: bg1 starts, bg2 waits; 'needed' (queued last) starts at once beside bg1.
  assert.deepEqual(order, ['bg1', 'needed', 'bg3', 'bg2', 'bg4']);
  assert.equal(peak, 2);
});
test('a long background decode never holds up a priority-1 decode', async () => {
  let release; const stuck = decodeSlot({ priority: 2 }, 'slow', () => new Promise(r => { release = r; }));
  const started = []; const bg = decodeSlot({ priority: 3 }, 'queued', async () => { started.push('bg'); });
  const t0 = Date.now(); await decodeSlot({ priority: 1 }, 'needed', async () => { started.push('needed'); });
  assert.ok(Date.now() - t0 < 50, 'started at once'); assert.deepEqual(started, ['needed'], 'the background one still waits');
  release(); await Promise.all([stuck, bg]); assert.deepEqual(started, ['needed', 'bg']);
});
test('a decode that throws frees its place, and the queue carries on', async () => {
  await assert.rejects(decodeSlot({ priority: 1 }, 'bad', () => { throw new Error('corrupt file'); }), /corrupt/);
  assert.equal(await decodeSlot({ priority: 1 }, 'good', async () => 'ok'), 'ok');
  assert.deepEqual(decodeState(), { running: 0, background: 0, queued: 0 });
});

test('each finished decode counts as progress for the deployment watchdog (no false "connection dropped")', async () => {
  traffic.lastByteAt = 0;
  await decodeSlot({ priority: 1 }, 'model', async () => 'ok');
  assert.ok(traffic.lastByteAt > 0, 'progress recorded');
});

test('leaving the Arena cancels queued decodes without starting them or losing running slots', async () => {
  let finish;
  const running = decodeSlot({ priority: 2 }, 'running', () => new Promise(r => { finish = r; }));
  await Promise.resolve();
  let started = false;
  const queued = decodeSlot({ priority: 3 }, 'not-needed', async () => { started = true; });
  const rejected = assert.rejects(queued, { name: 'AbortError' });
  endSession(); await rejected;
  assert.equal(started, false);
  assert.deepEqual(decodeState(), { running: 1, background: 1, queued: 0 });
  finish(); await running;
  assert.deepEqual(decodeState(), { running: 0, background: 0, queued: 0 });
  assert.equal(await decodeSlot({ priority: 1 }, 'next-match', async () => 'ready'), 'ready');
});

test('an individually aborted queued decode never runs', async () => {
  let finish;
  const running = decodeSlot({ priority: 2 }, 'running', () => new Promise(r => { finish = r; }));
  await Promise.resolve();
  const ctrl = new AbortController();
  const queued = decodeSlot({ priority: 3, signal: ctrl.signal }, 'cancelled', () => { throw Error('must not run'); });
  const rejected = assert.rejects(queued, { name: 'AbortError' });
  ctrl.abort(); await rejected; finish(); await running;
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(decodeSlot({ signal: aborted.signal }, 'already-cancelled', async () => 1), { name: 'AbortError' });
});
