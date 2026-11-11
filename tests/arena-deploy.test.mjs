// Combat Arena deployment on the server: players are never left waiting at the door and never put into live combat
// while their scene is still loading. Real WebSockets against the real room server (server/room.mjs + server/arena).
//   * A slow or failing account service: the arena still says `ready` (as a guest, with a notice) within its deadline,
//     and a socket that has said hello is not closed for being slow to identify.
//   * Load gating: a client that reports when its scene has loaded (caps 'loadgate') and joins a match in progress is
//     held out of combat until it does, then spawned at once; if it never does, it is spawned at the cap.
//   * Clients without the capability (older builds, these tests' raw sockets) keep the previous behaviour.
//   * Correlation: a request's `cid` is traced (assigned, loaded) and clients' own timings aggregate into percentiles.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { createDeployTraces } from '../server/arena/service.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RULES = { countdownMs: 100, fillWaitMs: 0, spawnProtectMs: 0, loadWaitMs: 1500, reconnectMs: 4000, abandonMs: 3000, resultsMs: 300, mode: { respawnMs: 300, scoreLimit: 50 } };
const rooms = [];
async function start(accounts = { enabled: false }, extra = {}) {
  const room = createRoom({ port: 0, accounts, arena: { rules: RULES, minRecordMs: 0, ...extra } }); rooms.push(room);
  return { room, url: `ws://127.0.0.1:${(await room.start()).port}/arena` };
}
after(async () => { for (const r of rooms) await r.close(); });
afterEach(() => { for (const r of rooms) for (const m of [...r.arena.matches.values()]) m.close('test'); });

async function client(url, name, { access, caps, hello = true } = {}) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const c = { ws, name, msgs: [], events: [], ref: 0, waiters: new Set() };
  ws.on('message', raw => {
    const m = JSON.parse(raw); c.msgs.push(m); if (m.t === 'e') c.events.push(...m.l); if (m.t === 's') c.snap = m;
    for (const w of [...c.waiters]) { const hit = w.pred(m); if (hit) { c.waiters.delete(w); w.resolve(hit === true ? m : hit); } }
  });
  c.closed = new Promise(r => ws.once('close', code => r(code)));
  c.send = m => ws.send(JSON.stringify(m));
  c.wait = (pred, timeout = 4000, what = 'message') => new Promise((resolve, reject) => {
    const w = { pred, resolve }; c.waiters.add(w);
    setTimeout(() => { if (c.waiters.delete(w)) reject(new Error(`${name}: timed out waiting for ${what}`)); }, timeout);
  });
  c.request = data => { const ref = ++c.ref; const r = c.wait(m => m.t === 'reply' && m.ref === ref, 4000, data.t); c.send({ ...data, ref }); return r; };
  if (hello) { const ready = c.wait(m => m.t === 'ready', 12000, 'ready'); c.send({ t: 'hello', name, ...(access ? { access } : {}), ...(caps ? { caps } : {}) }); c.ready = await ready; }
  return c;
}
async function join(c, data) {
  const joined = c.wait(m => m.t === 'match', 4000, 'match');
  const r = await c.request(data); assert.equal(r.ok, true, r.reason);
  const m = await joined; c.matchId = m.match.id; c.num = m.you.num; c.key = m.you.key;
  return m;
}
const spawned = c => c.events.some(e => e.k === 'spawn');
/** Wait until `c` has received a spawn event (it can arrive right behind the match message). */
async function spawnedWithin(c, ms) { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(20)) if (spawned(c)) return true; return false; }

test('identify: a hanging account service still lets the player in (as a guest, told why) within the deadline', async () => {
  const hang = () => new Promise(() => {});
  const { room, url } = await start({ enabled: true, verify: hang, snapshot: hang, arenaSnapshot: hang }, { identifyMs: 600 });
  const t0 = Date.now(), c = await client(url, 'Slow', { access: 'aaa.bbb.ccc', caps: ['loadgate'] });
  const took = Date.now() - t0;
  assert.equal(c.ready.verified, false); assert.equal(c.ready.notice, 'accounts-unavailable');
  assert.ok(took < 3000, `ready after ${took} ms`);
  assert.equal(room.arena.status().identifyDegraded, 1);
  // A profile lookup that hangs after a valid token: same.
  const { url: url2 } = await start({ enabled: true, verify: async () => ({ id: 'u1' }), snapshot: hang, arenaSnapshot: hang }, { identifyMs: 500 });
  const d = await client(url2, 'Slow2', { access: 'aaa.bbb.ccc' });
  assert.equal(d.ready.verified, false); assert.equal(d.ready.notice, 'accounts-unavailable');
  // An exception while identifying (previously: no reply at all, a client stuck on "Connecting…").
  const { url: url3 } = await start({ enabled: true, verify: async () => { throw new Error('boom'); }, snapshot: hang, arenaSnapshot: hang });
  const e = await client(url3, 'Broken', { access: 'aaa.bbb.ccc' });
  assert.equal(e.ready.verified, false); assert.equal(e.ready.notice, 'accounts-unavailable');
  for (const x of [c, d, e]) x.ws.close();
});

test('identify: a healthy account service answers without a notice', async () => {
  const { url } = await start({ enabled: true, verify: async () => ({ id: 'u2' }), snapshot: async () => ({ handle: 'ok', display_name: 'Okay', owned: [] }), arenaSnapshot: async () => ({ xp: 900, loadouts: [] }) });
  const c = await client(url, 'Fine', { access: 'aaa.bbb.ccc' });
  assert.equal(c.ready.verified, true); assert.equal(c.ready.notice, undefined); assert.equal(c.ready.name, 'Okay');
  c.ws.close();
});

test('load gating: joining a match in progress, a loading player is held out of combat until loaded, then spawned at once', async () => {
  const { room, url } = await start();
  const a = await client(url, 'A'), b = await client(url, 'B');
  await join(a, { t: 'queue', mode: 'tdm', map: 'foundry' }); await join(b, { t: 'queue', mode: 'tdm', map: 'foundry' });
  const match = room.arena.matches.get(a.matchId);
  for (let i = 0; i < 40 && match.state !== 'playing'; i++) await sleep(50);
  assert.equal(match.state, 'playing');
  // C reports scene loading: it is in the match (roster, snapshots) but not spawned.
  const c = await client(url, 'C', { caps: ['loadgate'] });
  await join(c, { t: 'queue', mode: 'tdm', map: 'foundry', cid: 'abc123def456' });
  assert.equal(c.matchId, a.matchId);
  await sleep(300);
  const pc = match.players.find(p => p.num === c.num);
  assert.equal(pc.alive, false, 'not alive while loading'); assert.equal(pc.sim, null, 'not in the world while loading'); assert.equal(spawned(c), false);
  assert.ok(c.snap && c.snap.me === null, 'snapshots carry no own state yet');
  const t0 = Date.now(), spawn = c.wait(m => m.t === 'e' && m.l.find(e => e.k === 'spawn'), 2000, 'spawn');
  c.send({ t: 'loaded' });
  await spawn;
  assert.ok(Date.now() - t0 < 500, 'spawned as soon as it reported loaded');
  assert.equal(pc.alive, true);
  // The trace for this deployment carries the correlation id: assigned, then loaded (spawned).
  const trace = room.arena.deploys.recent.find(d => d.cid === 'abc123def456');
  assert.ok(trace, 'deployment traced'); assert.deepEqual(trace.steps.map(s => s.s), ['assigned', 'loaded']);
  assert.equal(trace.steps[0].held, true); assert.equal(trace.steps[1].spawned, true);
  assert.ok(!JSON.stringify(trace).includes('C"'), 'no player names in traces');
  for (const x of [a, b, c]) x.ws.close();
});

test('load gating: a player who never reports loaded is spawned at the cap (never held forever)', async () => {
  const { room, url } = await start();
  const a = await client(url, 'A'), b = await client(url, 'B');
  await join(a, { t: 'queue', mode: 'tdm', map: 'quad' }); await join(b, { t: 'queue', mode: 'tdm', map: 'quad' });
  const match = room.arena.matches.get(a.matchId);
  for (let i = 0; i < 40 && match.state !== 'playing'; i++) await sleep(50);
  const c = await client(url, 'C', { caps: ['loadgate'] });
  const t0 = Date.now(); await join(c, { t: 'queue', mode: 'tdm', map: 'quad' });
  await c.wait(m => m.t === 'e' && m.l.find(e => e.k === 'spawn'), 4000, 'spawn at the cap');
  const waited = Date.now() - t0;
  assert.ok(waited >= RULES.loadWaitMs - 150 && waited < RULES.loadWaitMs + 1200, `spawned after ${waited} ms`);
  for (const x of [a, b, c]) x.ws.close();
});

test('load gating: warm-up spawns at once; clients without the capability keep the previous behaviour', async () => {
  const { room, url } = await start();
  // Before the match starts there is no damage: a gated player spawns immediately to warm up.
  const g = await client(url, 'G', { caps: ['loadgate'] });
  await join(g, { t: 'private', action: 'create', mode: 'tdm', map: 'foundry', size: 2 });
  assert.ok(await spawnedWithin(g, 500), 'warm-up spawn');
  // Mid-match, an older client (no caps) is spawned at once, as before.
  const a = await client(url, 'A'), b = await client(url, 'B');
  await join(a, { t: 'queue', mode: 'tdm', map: 'foundry' }); await join(b, { t: 'queue', mode: 'tdm', map: 'foundry' });
  const match = room.arena.matches.get(a.matchId);
  for (let i = 0; i < 40 && match.state !== 'playing'; i++) await sleep(50);
  const old = await client(url, 'Old');
  await join(old, { t: 'queue', mode: 'tdm', map: 'foundry' });
  assert.ok(await spawnedWithin(old, 500), 'immediate spawn');
  for (const x of [g, a, b, old]) x.ws.close();
});

test('load gating: a gated player who reconnects mid-match is held until its scene reports loaded again', async () => {
  const { room, url } = await start();
  const a = await client(url, 'A'), b = await client(url, 'B', { caps: ['loadgate'] });
  await join(a, { t: 'queue', mode: 'tdm', map: 'foundry' }); await join(b, { t: 'queue', mode: 'tdm', map: 'foundry' });
  b.send({ t: 'loaded' });
  const match = room.arena.matches.get(a.matchId);
  for (let i = 0; i < 40 && match.state !== 'playing'; i++) await sleep(50);
  assert.equal(match.players.find(p => p.num === b.num).alive, true);
  b.ws.close(); await b.closed; await sleep(100);
  const b2 = await client(url, 'B', { caps: ['loadgate'] });
  const back = b2.wait(m => m.t === 'match', 3000, 'rejoined match');
  assert.equal((await b2.request({ t: 'rejoin', match: a.matchId, key: b.key, cid: 'rejoin00aa11' })).ok, true);
  await back; await sleep(800);
  const pb = match.players.find(p => p.num === b.num);
  assert.equal(pb.alive, false, 'held after reconnecting (it may have reloaded the page)');
  const spawn = b2.wait(m => m.t === 'e' && m.l.find(e => e.k === 'spawn'), 1500, 'spawn after loaded');
  b2.send({ t: 'loaded' }); await spawn;
  assert.equal(pb.alive, true);
  for (const x of [a, b2]) x.ws.close();
});

test('a socket that has said hello is not closed while it is being identified; one that never says hello is', async () => {
  const { room, url } = await start();
  const silent = await client(url, 'Silent', { hello: false });
  assert.equal(room.arena.connections.size, 1);
  silent.ws.close();
  // (The 15 s hello deadline itself is exercised by the heartbeat; here: the guard only applies before hello.)
  const src = (await import('node:fs')).readFileSync('server/arena/service.mjs', 'utf8');
  assert.match(src, /!c\.ready && !c\.helloSent && Date\.now\(\) - c\.openedAt > 15000/);
});

test('deployment diagnostics: client timings aggregate into percentiles, malformed reports are ignored', async () => {
  const t = createDeployTraces({ clock: () => 0, log: { info() {} } });
  const c = { id: 'conn-1234567890' };
  for (let i = 1; i <= 20; i++) t.report(c, { cid: `cid${String(i).padStart(6, '0')}`, ok: true, total: i * 1000, bytes: 5e6, retries: 0, tier: 'mobile', stages: { preparing: i * 500, synchronizing: i * 900 } });
  t.report(c, { cid: 'x', ok: false, total: -5, stages: { 'bad key!': 1, preparing: 'nope' } });
  t.report(c, null); t.report(c, [1, 2]);
  const s = t.summary();
  assert.equal(s.samples, 20); assert.equal(s.failures, 1);
  assert.equal(s.totalMs.p50, 10000); assert.equal(s.totalMs.p95, 19000); assert.equal(s.totalMs.p99, 20000);
  assert.equal(s.stagesP50.preparing, 5000);
  assert.deepEqual(t.client.at(-1).stages, {}, 'invalid stage entries dropped'); assert.equal(t.client.at(-1).total, null);
});
