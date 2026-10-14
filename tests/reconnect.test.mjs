// Room behaviour around reconnects and position corrections: a session that reconnects (a phone
// changing networks, a reload) must take its place back instead of being locked out or sent to the
// gate, and no client message may move a player through a wall or a closed door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { SPAWN, blocked, setDoorOpen } from '../shared/campus.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
function next(ws, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', handler); reject(Error('Message timeout')); }, timeout);
    const handler = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', handler); resolve(m); } };
    ws.on('message', handler);
  });
}
async function join(url, name, token) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const welcome = next(ws, m => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', name, avatar: {}, ...(token ? { token } : {}) }));
  return { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) };
}
async function withRoom(fn, options = {}) {
  const room = createRoom({ port: 0, ...options }), address = await room.start();
  const open = [];
  try { await fn(room, async (...a) => { const c = await join(`ws://127.0.0.1:${address.port}/ws`, ...a); open.push(c.ws); return c; }); }
  finally { open.forEach(ws => ws.close()); await room.close(); }
}

test('a session that reconnects before the room noticed its old connection drop takes over, where it stood', () => withRoom(async (room, connect) => {
  const first = await connect('Ada'), token = first.welcome.token;
  const friend = await connect('Tobi');
  // Ada and Tobi share a party; Ada walks away from the gate.
  first.send({ type: 'party', action: 'create' }); await next(first.ws, m => m.type === 'partyResult');
  Object.assign(room.clients.get(first.welcome.id), { x: -12, z: 20 });
  // The phone changes networks: the old socket is still open as far as the room knows, and the same
  // session joins again on a new one. It used to be refused ("session in use") and never retried.
  const replaced = new Promise(r => first.ws.once('close', code => r(code)));
  const left = next(friend.ws, m => m.type === 'left' && m.id === first.welcome.id);
  const again = await connect('Ada', token);
  assert.equal(again.welcome.type, 'welcome');
  assert.deepEqual([again.welcome.position.x, again.welcome.position.z], [-12, 20], 'resumes where the room last had the player');
  assert.equal(await replaced, 4004, 'the older connection is told it was replaced');
  await left;
  assert.equal([...room.clients.values()].filter(c => c.token === token).length, 1, 'one session, one player');
  const state = await next(friend.ws, m => m.type === 'state');
  assert.deepEqual(state.players.map(p => p.id).sort(), [again.welcome.id, friend.welcome.id].sort());
  // The party place carried over to the new connection.
  assert.ok(room.parties.partyOf(room.clients.get(again.welcome.id)), 'party membership survives the reconnect');
}));

test('messages still arriving on a replaced connection are ignored', () => withRoom(async (room, connect) => {
  const first = await connect('Ada'), other = await connect('Tobi');
  const again = await connect('Ada', first.welcome.token);
  let leaked = false; const watch = raw => { const m = JSON.parse(raw); if (m.type === 'chat' && m.text === 'from the old socket') leaked = true; };
  other.ws.on('message', watch);
  if (first.ws.readyState === WebSocket.OPEN) first.send({ type: 'chat', text: 'from the old socket' });
  again.send({ type: 'chat', text: 'from the new socket' });
  await next(other.ws, m => m.type === 'chat' && m.text === 'from the new socket');
  await delay(100);
  assert.equal(leaked, false);
}));

test('a reconnect after a clean disconnect resumes the position within the grace period, not later', () => withRoom(async (room, connect) => {
  const a = await connect('Ada'), token = a.welcome.token;
  Object.assign(room.clients.get(a.welcome.id), { x: 20, z: 10 });
  a.ws.close(); await delay(100);
  const back = await connect('Ada', token);
  assert.deepEqual([back.welcome.position.x, back.welcome.position.z], [20, 10]);
  back.ws.close(); await delay(700);
  const late = await connect('Ada', token);
  assert.deepEqual([late.welcome.position.x, late.welcome.position.z], [SPAWN.x, SPAWN.z]);
}, { partyLimits: { size: 6, inviteMs: 60_000, graceMs: 400, invitesPerTarget: 5 } }));

test('a new session, or one whose spot is no longer clear, starts at the gate', () => withRoom(async (room, connect) => {
  const a = await connect('Ada');
  assert.deepEqual([a.welcome.position.x, a.welcome.position.z], [SPAWN.x, SPAWN.z]);
  // Inside the library doorway when it was open; the door has closed since.
  setDoorOpen('library-main', true);
  Object.assign(room.clients.get(a.welcome.id), { x: -30, z: -4.3 });
  a.ws.close(); await delay(100);
  setDoorOpen('library-main', false);
  assert.equal(blocked(-30, -4.3), true);
  const back = await connect('Ada', a.welcome.token);
  assert.deepEqual([back.welcome.position.x, back.welcome.position.z], [SPAWN.x, SPAWN.z]);
}));

test('a settle request cannot move a player through a closed door or a wall', () => withRoom(async (room, connect) => {
  const a = await connect('Ada'), c = room.clients.get(a.welcome.id);
  // Outside Studio D1 with its door shut: the far side of the door is 0.9 m away.
  setDoorOpen('classroom-d1', false);
  Object.assign(c, { x: 32.7, z: -36.1 });
  a.send({ type: 'settle', x: 32.7, z: -37.0 }); await delay(150);
  assert.ok(c.z > -36.55, `settled through the closed door to z=${c.z}`);
  // Through the basketball cage's chain-link fence (0.2 m) from outside.
  Object.assign(c, { x: 44, z: 8.1 }); await delay(400);
  a.send({ type: 'settle', x: 44, z: 9.0 }); await delay(150);
  assert.ok(c.z < 8.6, `settled through the fence to z=${c.z}`);
  // A small correction in the open is still accepted.
  Object.assign(c, { x: 0, z: 30 }); await delay(400);
  a.send({ type: 'settle', x: .5, z: 30.4 }); await delay(150);
  assert.deepEqual([c.x, c.z], [.5, 30.4]);
}));
