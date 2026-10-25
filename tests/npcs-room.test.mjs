import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { roomConfig } from '../server/config.mjs';
import { NPCS, NPC_BY_ID, routineOf } from '../shared/npcs.mjs';
import { ORDER_READY_S } from '../shared/cafe.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
function next(ws, predicate, timeout = 4000) { return new Promise((resolve, reject) => { const t = setTimeout(() => { ws.off('message', handler); reject(Error('Message timeout')); }, timeout); const handler = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', handler); resolve(m); } }; ws.on('message', handler); }); }
async function client(url, name, token) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const welcome = next(ws, m => m.type === 'welcome'); ws.send(JSON.stringify({ type: 'join', name, avatar: {}, ...(token ? { token } : {}) }));
  let ref = 100;
  const c = { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) };
  /** Send an NPC request and wait for its own reply. */
  c.ask = (type, m) => { const r = ++ref, reply = next(ws, x => x.ref === r && (x.type === 'npcResult' || x.type === 'cafeOrderResult')); c.send({ type, ref: r, ...m }); return reply; };
  return c;
}
/** Place a player where the room has them (as if they had walked there). */
const place = (room, c, x, z) => Object.assign(room.clients.get(c.welcome.id), { x, z, y: 0, vx: 0, vz: 0 });
/** Wait until a character is waiting at its home (so a player placed in front of it is in range). */
async function atHome(room, id) {
  const d = room.npcs.director;
  for (let i = 0; i < 400; i++) { const p = d.pose(id); if (p.state !== 'walking' && p.state !== 'returning' && Math.hypot(p.x - NPC_BY_ID.get(id).home.x, p.z - NPC_BY_ID.get(id).home.z) < .01) return; await delay(100); }
  // Restart its routine at home rather than wait out a long walk (the room's own state, as a restart would).
  d.npcs.get(id).epoch = Date.now(); d.npcs.get(id).from = null;
}

test('every player sees the same cast; characters are never players', async () => {
  const room = createRoom({ port: 0 }), address = await room.start(), url = `ws://127.0.0.1:${address.port}/ws`; let a, b;
  try {
    a = await client(url, 'Ada'); b = await client(url, 'Tobi');
    const ids = a.welcome.npcs.npcs.map(n => n.id);
    assert.deepEqual(ids, NPCS.map(d => d.id), 'the whole cast is on duty with the default buildings');
    assert.deepEqual(b.welcome.npcs.npcs.map(n => [n.id, n.epoch]), a.welcome.npcs.npcs.map(n => [n.id, n.epoch]), 'same identities, same routines');
    const state = await next(a.ws, m => m.type === 'state' && m.players.length === 2);
    assert.equal(state.players.length, 2, 'only the two human players are in the roster');
    assert.ok(state.players.every(p => !ids.includes(p.id) && !String(p.id).startsWith('npc')));
    const health = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();
    assert.equal(health.players, 2, 'the online count is people only');
    assert.equal(room.clients.size, 2, 'no character holds a connection');
  } finally { a?.ws.close(); b?.ws.close(); await room.close(); }
});

test('conversations are authoritative and shared: range, sight, fabricated ids and malformed requests are refused', async () => {
  const room = createRoom({ port: 0 }), address = await room.start(), url = `ws://127.0.0.1:${address.port}/ws`; let a, b;
  try {
    a = await client(url, 'Ada'); b = await client(url, 'Tobi');
    await atHome(room, 'librarian');
    place(room, a, -22.6, -6.6); place(room, b, -22.6, -6.2);
    assert.equal((await a.ask('npc', { action: 'talk', id: 'no-such-person' })).ok, false);
    assert.equal((await a.ask('npc', { action: 'talk', id: { toString: 1 } })).ok, false, 'a non-string id does not crash the room');
    assert.equal((await a.ask('npc', { action: 'promote', id: 'librarian' })).ok, false);
    place(room, b, -40, -20);
    assert.match((await b.ask('npc', { action: 'talk', id: 'librarian' })).reason, /closer/, 'too far away');
    place(room, b, -17.6, -8.65);
    assert.match((await b.ask('npc', { action: 'talk', id: 'librarian' })).reason, /closer|can’t reach/, 'outside the library wall');
    const seen = next(b.ws, m => m.type === 'npcState' && m.changes.some(c => c.id === 'librarian' && c.mode === 'engaged'));
    const talk = await a.ask('npc', { action: 'talk', id: 'librarian' });
    assert.equal(talk.ok, true); assert.equal(talk.first, true);
    const change = (await seen).changes.find(c => c.id === 'librarian');
    assert.deepEqual(change.by.map(x => x.id), [a.welcome.id], 'the other player sees who the librarian is talking to');
    assert.equal(change.gesture.kind, 'wave');
    assert.equal((await a.ask('npc', { action: 'talk', id: 'librarian' })).replayed, true, 'a repeated request is not a second conversation');
    place(room, b, -22.6, -6.2);
    assert.equal((await b.ask('npc', { action: 'talk', id: 'librarian' })).first, false, 'a second player joins the queue');
    const ended = next(b.ws, m => m.type === 'npcState' && m.changes.some(c => c.id === 'librarian' && c.by?.length === 1 && c.by[0].id === b.welcome.id));
    assert.equal((await a.ask('npc', { action: 'leave', id: 'librarian' })).ok, true); await ended;
    const back = next(a.ws, m => m.type === 'npcState' && m.changes.some(c => c.id === 'librarian' && c.mode === 'routine'));
    b.ws.close(); await back; // disconnecting ends the conversation for everyone
    place(room, a, -22.6, -6.6); room.clients.get(a.welcome.id).ball = 'ball-1';
    assert.match((await a.ask('npc', { action: 'talk', id: 'librarian' })).reason, /ball down/, 'holding a ball');
    room.clients.get(a.welcome.id).ball = null;
    let flood = 0; for (let i = 0; i < 12; i++) a.send({ type: 'npc', action: 'leave', id: 'librarian', ref: i });
    await next(a.ws, m => m.type === 'npcResult' && m.reason?.includes('Wait a moment') && ++flood, 3000);
  } finally { a?.ws.close(); b?.ws.close(); await room.close(); }
});

test('café orders: numbered once per request (also after reconnecting), called when ready, refused when out of reach', { timeout: 30000 }, async () => {
  const room = createRoom({ port: 0 }), address = await room.start(), url = `ws://127.0.0.1:${address.port}/ws`; let a, b;
  try {
    a = await client(url, 'Ada'); b = await client(url, 'Tobi');
    await atHome(room, 'vendor'); place(room, a, 26.5, -9.3); place(room, b, 26.5, 20);
    assert.match((await b.ask('cafeOrder', { items: ['zobo'], req: 'tobi-0001', via: 'counter' })).reason, /counter/);
    assert.match((await b.ask('cafeOrder', { items: ['zobo'], req: 'tobi-0002', via: 'vendor' })).reason, /closer/);
    place(room, b, 27, -9.3);
    assert.match((await b.ask('cafeOrder', { items: ['caviar', 'zobo'], req: 'tobi-0003', via: 'vendor' })).reason, /menu/, 'only items on the menu');
    const served = next(b.ws, m => m.type === 'npcState' && m.changes.some(c => c.id === 'vendor' && c.gesture?.kind === 'serve'));
    const first = await a.ask('cafeOrder', { items: ['jollof', 'zobo'], req: 'ada-order-1', via: 'vendor' });
    assert.equal(first.ok, true); assert.equal(first.total, 3200); assert.equal(first.served, true);
    await served; // the other player sees the vendor serve
    const again = await a.ask('cafeOrder', { items: ['jollof', 'zobo'], req: 'ada-order-1', via: 'vendor' });
    assert.equal(again.number, first.number); assert.equal(again.replayed, true);
    // The same session reconnects and retries: still one order, and its number is still called.
    const token = a.welcome.token; a.ws.close(); await delay(150);
    a = await client(url, 'Ada', token); place(room, a, 26.5, -9.3);
    const retried = await a.ask('cafeOrder', { items: ['jollof', 'zobo'], req: 'ada-order-1', via: 'vendor' });
    assert.equal(retried.number, first.number, 'no duplicate after reconnecting');
    const other = await b.ask('cafeOrder', { items: ['coffee'], req: 'tobi-0005', via: 'counter' });
    assert.equal(other.ok, true, other.reason); assert.notEqual(other.number, first.number);
    assert.match((await b.ask('cafeOrder', { items: ['coffee'], req: 'tobi-0006', via: 'counter' })).reason, /Wait a moment/, 'the room limits ordering bursts');
    const ready = await next(a.ws, m => m.type === 'cafeOrderReady', ORDER_READY_S * 1000 + 3000);
    assert.equal(ready.number, first.number);
    assert.equal(room.npcs.metrics.orders, 2, 'exactly two orders were placed');
  } finally { a?.ws.close(); b?.ws.close(); await room.close(); }
});

test('building completion: configured at start, changed live by an admin, one teacher however often it crosses 80%', async () => {
  assert.throws(() => roomConfig({ BUILDING_COMPLETION: 'studio-d1=180' }), /0 to 100/);
  assert.deepEqual(roomConfig({ BUILDING_COMPLETION: 'studio-d1=70' }).buildings, { 'studio-d1': 70 });
  const room = createRoom({ port: 0, adminToken: 'test-admin', buildings: { 'studio-d1': 70, 'courtyard-cafe': 39 } }), address = await room.start();
  const url = `ws://127.0.0.1:${address.port}/ws`, admin = (body, token = 'test-admin') => fetch(`http://127.0.0.1:${address.port}/admin/buildings`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  let a;
  try {
    a = await client(url, 'Ada');
    const ids = a.welcome.npcs.npcs.map(n => n.id);
    assert.ok(!ids.includes('teacher') && !ids.includes('vendor'), 'below their thresholds, neither is on duty');
    place(room, a, 35.5, -41);
    assert.match((await a.ask('npc', { action: 'talk', id: 'teacher' })).reason, /70% complete.*80%/);
    assert.equal((await admin({ building: 'studio-d1', completion: 80 }, 'wrong')).status, 403);
    assert.equal((await admin({ building: 'studio-d1', completion: 120 })).status, 400);
    assert.equal((await admin({ building: 'studio-d1', completion: '80' })).status, 400);
    assert.equal((await admin({ building: 'narnia', completion: 80 })).status, 400);
    for (let i = 0; i < 5; i++) {
      const arrived = next(a.ws, m => m.type === 'npcs' && m.npcs.some(n => n.id === 'teacher'));
      const r = await (await admin({ building: 'studio-d1', completion: 80 + i })).json();
      assert.deepEqual(r.arrived, ['teacher']); await arrived;
      const left = next(a.ws, m => m.type === 'npcs' && !m.npcs.some(n => n.id === 'teacher'));
      assert.deepEqual((await (await admin({ building: 'studio-d1', completion: 79.5 })).json()).left, ['teacher']); await left;
    }
    assert.equal(room.npcs.director.spawns.get('teacher'), 5);
    await admin({ building: 'studio-d1', completion: 80 });
    const listed = await (await admin()).json();
    assert.equal(listed.onDuty.filter(id => id === 'teacher').length, 1, 'exactly one teacher');
    assert.equal(listed.buildings.find(b => b.id === 'studio-d1').completion, 80);
    const vendor = next(a.ws, m => m.type === 'npcs' && m.npcs.some(n => n.id === 'vendor'));
    await admin({ building: 'courtyard-cafe', completion: 40 }); await vendor;
    await admin({ building: 'courtyard-cafe', available: false });
    assert.equal((await (await admin()).json()).onDuty.includes('vendor'), false, 'a closed building has no staff');
  } finally { a?.ws.close(); await room.close(); }
});

test('a room restart and reconnecting never duplicate the cast; routines restart at home', async () => {
  let room = createRoom({ port: 0 }), address = await room.start(), a;
  try {
    a = await client(`ws://127.0.0.1:${address.port}/ws`, 'Ada');
    const token = a.welcome.token; a.ws.close(); await delay(100);
    a = await client(`ws://127.0.0.1:${address.port}/ws`, 'Ada', token);
    assert.equal(a.welcome.npcs.npcs.length, NPCS.length, 'reconnecting: one of each');
    a.ws.close(); await room.close();
    room = createRoom({ port: 0 }); address = await room.start();
    a = await client(`ws://127.0.0.1:${address.port}/ws`, 'Ada', token);
    const ids = a.welcome.npcs.npcs.map(n => n.id);
    assert.equal(new Set(ids).size, ids.length); assert.equal(ids.length, NPCS.length);
    for (const n of a.welcome.npcs.npcs) {
      assert.equal(n.mode, 'routine');
      assert.ok(Date.now() - n.epoch < routineOf(NPC_BY_ID.get(n.id)).steps[0].dwell + 2000, `${n.id} starts its first wait at home`);
    }
    assert.ok([...room.npcs.director.spawns.values()].every(n => n === 1));
  } finally { a?.ws.close(); await room.close(); }
});
