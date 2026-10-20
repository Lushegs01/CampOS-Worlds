// Personal rooms in the room server, over real WebSockets: entering at the residents' door, each
// resident in their own space, saving furniture (validated by the room), furniture collision, leaving,
// reconnecting and meet-up. Guests here; signed-in persistence is in tests/dorm-accounts.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { DEFAULT_LAYOUT, DORM_INSIDE, DORM_OUTSIDE, DORM_ROOM, footprint, inDormRoom } from '../shared/dorm.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
function next(ws, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(Error('Message timeout')); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
async function withRoom(fn) {
  const room = createRoom({ port: 0 }), url = `ws://127.0.0.1:${(await room.start()).port}/ws`, open = [];
  const join = async (name, token) => {
    const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); open.push(ws);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const welcome = next(ws, m => m.type === 'welcome');
    ws.send(JSON.stringify({ type: 'join', name, avatar: {}, ...(token ? { token } : {}) }));
    const c = { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) };
    c.id = c.welcome.id; c.server = () => room.clients.get(c.id);
    let ref = 0;
    c.dorm = (action, extra = {}) => { const id = ++ref, r = next(ws, m => m.type === 'dormResult' && m.ref === id); c.send({ type: 'dorm', ref: id, action, ...extra }); return r; };
    c.state = () => next(ws, m => m.type === 'state');
    return c;
  };
  try { await fn(room, join); } finally { open.forEach(ws => ws.close()); await room.close(); }
}
const atDoor = c => Object.assign(c.server(), { x: DORM_OUTSIDE.x, z: DORM_OUTSIDE.z, vx: 0, vz: 0 });

test('residents go in at the door and each is alone in their own room', () => withRoom(async (room, join) => {
  const ada = await join('Ada'), tobi = await join('Tobi');
  assert.match((await ada.dorm('enter')).reason, /residents’ door/, 'only from the door at the back of Palm House');
  atDoor(ada);
  const entered = await ada.dorm('enter');
  assert.equal(entered.ok, true, entered.reason);
  assert.deepEqual(entered.layout, DEFAULT_LAYOUT, 'a new resident gets the furnished default room');
  assert.equal(entered.keeps, 'session', 'a guest’s room lasts for the session');
  assert.deepEqual([entered.x, entered.z], [DORM_INSIDE.x, DORM_INSIDE.z]);
  assert.ok(inDormRoom(ada.server().x, ada.server().z));
  // Everyone still knows Ada is here (people list, parties), with her own space: clients draw only their space.
  let s = await tobi.state();
  assert.equal(s.players.find(p => p.id === ada.id).space, ada.id);
  assert.equal(s.players.find(p => p.id === tobi.id).space, undefined, 'out on campus there is no space field');
  atDoor(tobi); assert.equal((await tobi.dorm('enter')).ok, true);
  s = await tobi.state();
  assert.notEqual(s.players.find(p => p.id === tobi.id).space, s.players.find(p => p.id === ada.id).space, 'two residents, two rooms');
  assert.match((await ada.dorm('enter')).reason, /already/);
}));

test('arranging furniture: the room validates it, it blocks walking, and a guest keeps it for the session', () => withRoom(async (room, join) => {
  const ada = await join('Ada'), token = ada.welcome.token;
  assert.match((await ada.dorm('save', { layout: DEFAULT_LAYOUT })).reason, /Go to your room/);
  atDoor(ada); await ada.dorm('enter');
  for (const layout of [null, { items: [{ t: 'piano', x: 1, z: 1 }] }, { items: [{ t: { toString: 1 }, x: 1, z: 1 }] }, { items: [{ t: 'bed', x: 1, z: 1 }, { t: 'bed', x: 4, z: 1 }] }]) {
    const r = await ada.dorm('save', { layout });
    assert.equal(r.ok, false, `refused: ${JSON.stringify(layout)}`); assert.ok(r.reason);
  }
  await delay(5100); // room actions are limited to six in five seconds
  // A wardrobe 1.6 m ahead of where she stands: walking north stops in front of it.
  const cm = v => Math.round(v * 100) / 100, ahead = { t: 'wardrobe', x: cm(DORM_INSIDE.x - DORM_ROOM.x0), z: cm(DORM_INSIDE.z - DORM_ROOM.z0 - 1.6), r: 0, c: 0 };
  const saved = await ada.dorm('save', { layout: { items: [ahead, { t: 'rug', x: 1.5, z: 1.5, r: 1, c: 2 }] } });
  assert.equal(saved.ok, true, saved.reason); assert.equal(saved.saved, 'session');
  for (let i = 0; i < 20; i++) { ada.send({ type: 'input', dx: 0, dz: -1, yaw: Math.PI, sprint: false, jump: false }); await delay(50); }
  await delay(500);
  const front = DORM_ROOM.z0 + footprint(ahead).z1, z = ada.server().z;
  assert.ok(z > front + .2 && z < front + .5, `stopped in front of the wardrobe (${(z - front).toFixed(2)} m)`);
  assert.equal((await ada.dorm('leave')).ok, true);
  assert.ok(!inDormRoom(ada.server().x, ada.server().z));
  atDoor(ada); assert.deepEqual((await ada.dorm('enter')).layout.items[0], ahead, 'the same session finds its room as it left it');
  // Reconnecting from inside the room: back outside its door, never shut inside the wing.
  const closed = new Promise(r => ada.ws.once('close', r)); ada.ws.close(); await closed; await delay(100);
  const again = await join('Ada', token);
  assert.deepEqual([again.welcome.position.x, again.welcome.position.z], [DORM_OUTSIDE.x, DORM_OUTSIDE.z]);
  assert.equal(again.server().dorm, null);
  atDoor(again); assert.equal((await again.dorm('enter')).layout.items.length, 2);
}));

test('a resident in their room cannot be travelled to; travelling out of your room leaves it', () => withRoom(async (room, join) => {
  const ada = await join('Ada'), tobi = await join('Tobi');
  const party = (c, action, args = {}) => { const r = next(c.ws, m => m.type === 'partyResult' && m.action === action); c.send({ type: 'party', action, ...args }); return r; };
  const invited = next(tobi.ws, m => m.type === 'partyInvite');
  await party(ada, 'invite', { id: tobi.id });
  assert.equal((await party(tobi, 'respond', { party: (await invited).invite.party, accept: true })).ok, true);
  atDoor(tobi); await tobi.dorm('enter');
  const meet = (c, to) => { const r = next(c.ws, m => m.type === 'meetUpResult'); c.send({ type: 'meetUp', id: to }); return r; };
  assert.match((await meet(ada, tobi.id)).reason, /in their room/);
  Object.assign(ada.server(), { x: -12, z: 20 });
  const out = await meet(tobi, ada.id);
  assert.equal(out.ok, true, out.reason);
  assert.equal(tobi.server().dorm, null);
  assert.equal((await tobi.state()).players.find(p => p.id === tobi.id).space, undefined);
}));
