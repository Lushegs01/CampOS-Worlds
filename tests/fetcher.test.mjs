// The robust downloader behind every Combat Arena asset (src/world/fetcher.ts), against a real local HTTP server:
// priority order and strict gating, retries with backoff for transient failures, no retries for missing files,
// a stalled response aborted and retried, overall timeouts, cancellation, and honest progress counters.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchBytes, traffic, resetTraffic, backoff, endSession, deadline } from '../src/world/fetcher.ts';

let server, base;
const hits = new Map(), order = [];
const behaviour = new Map(); // path -> (n, req, res) => void
before(async () => {
  server = createServer((req, res) => {
    const path = req.url.split('?')[0], n = (hits.get(path) ?? 0) + 1; hits.set(path, n); order.push(path);
    const fn = behaviour.get(path);
    if (fn) return fn(n, req, res);
    res.setHeader('content-length', 1000); res.end(Buffer.alloc(1000, 7));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

test('a file downloads with byte progress counted once', async () => {
  resetTraffic();
  const b = await fetchBytes(`${base}/ok`, { priority: 1 });
  assert.equal(b.byteLength, 1000);
  assert.equal(traffic.bytes, 1000); assert.equal(traffic.critical.bytes, 1000); assert.equal(traffic.finished, 1); assert.equal(traffic.critical.finished, 1);
});

test('transient failures are retried with backoff; the retried bytes are not double counted', async () => {
  resetTraffic();
  behaviour.set('/flaky', (n, req, res) => { if (n < 3) { res.statusCode = 503; res.end(); } else { res.setHeader('content-length', 10); res.end(Buffer.alloc(10)); } });
  const b = await fetchBytes(`${base}/flaky`, { retries: 3 });
  assert.equal(b.byteLength, 10); assert.equal(hits.get('/flaky'), 3); assert.equal(traffic.retries, 2); assert.equal(traffic.bytes, 10);
  // Backoff grows and is jittered within ±50 %.
  assert.ok(backoff(0, () => 0) === 200 && backoff(0, () => 1) === 600 && backoff(3, () => .5) === 3200 && backoff(10, () => .5) === 6000);
});

test('a missing file is a permanent failure: not retried, reported with its path', async () => {
  resetTraffic();
  behaviour.set('/missing', (n, req, res) => { res.statusCode = 404; res.end(); });
  await assert.rejects(fetchBytes(`${base}/missing`, { retries: 3 }), e => e.permanent === true && e.status === 404 && /missing/.test(e.message));
  assert.equal(hits.get('/missing'), 1); assert.equal(traffic.failed, 1);
});

test('a response that stops sending is aborted after stallMs and retried', async () => {
  resetTraffic();
  behaviour.set('/stall', (n, req, res) => { res.setHeader('content-length', 100); res.write(Buffer.alloc(10)); if (n >= 2) res.end(Buffer.alloc(90)); /* first attempt: never finishes */ });
  const t0 = Date.now(), b = await fetchBytes(`${base}/stall`, { stallMs: 300, retries: 2 });
  assert.equal(b.byteLength, 100); assert.equal(hits.get('/stall'), 2); assert.ok(Date.now() - t0 >= 300);
  assert.equal(traffic.bytes, 100, 'the stalled attempt’s bytes were subtracted');
});

test('a request that never answers gives up after its retries (never hangs)', async () => {
  resetTraffic();
  behaviour.set('/hang', () => { /* no response at all */ });
  const t0 = Date.now();
  await assert.rejects(fetchBytes(`${base}/hang`, { stallMs: 200, timeoutMs: 400, retries: 1 }), e => /no data|timed out/.test(e.message));
  assert.ok(Date.now() - t0 < 4000);
});

test('priority: critical files start first, and nothing lower starts while one is downloading', async () => {
  order.length = 0; resetTraffic();
  let release; const gate = new Promise(r => { release = r; });
  behaviour.set('/p1-slow', async (n, req, res) => { await gate; res.end('x'); });
  const all = [fetchBytes(`${base}/p1-slow`, { priority: 1 }), fetchBytes(`${base}/p3-a`, { priority: 3 }), fetchBytes(`${base}/p2-a`, { priority: 2 }), fetchBytes(`${base}/p1-b`, { priority: 1 })];
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(order.slice().sort(), ['/p1-b', '/p1-slow'], 'only critical files while a critical one is in flight');
  release(); await Promise.all(all);
  assert.deepEqual(order.slice(2), ['/p2-a', '/p3-a'], 'then nearby detail, then optional files');
});

test('leaving cancels queued and running downloads', async () => {
  resetTraffic();
  behaviour.set('/long', () => { /* hold */ });
  const p = fetchBytes(`${base}/long`, { priority: 1, stallMs: 10000 }), q = fetchBytes(`${base}/queued`, { priority: 3 });
  await new Promise(r => setTimeout(r, 50));
  endSession();
  await assert.rejects(p, e => e.name === 'AbortError'); await assert.rejects(q, e => e.name === 'AbortError');
  assert.equal(traffic.active, 0);
});

test('deadline rejects a promise that never settles', async () => {
  await assert.rejects(deadline(new Promise(() => {}), 50, 'decode took too long'), /decode took too long/);
  assert.equal(await deadline(Promise.resolve(3), 50, 'x'), 3);
});
