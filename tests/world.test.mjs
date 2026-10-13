import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createWorld } from '../shared/world.mjs';
import { SEAT_BY_ID, SEATS, seatApproach, STAND_EXIT, BENCHES, HOOPS } from '../shared/interactions.mjs';
import { blocked, setDoorOpen, moveWithCollisions } from '../shared/campus.mjs';
import { createRoom } from '../server/room.mjs';

const player = (id, x, z) => ({ id, x, z, y: 0, yaw: 0, seat: null, ball: null });
const at = (p, x, z) => Object.assign(p, { x, z });

test('a single chair seats one player; standing frees it and lands somewhere walkable', () => {
  const w = createWorld(), seat = SEAT_BY_ID.get('lib-0-0--1'), a = player('a', 0, 0), b = player('b', 0, 0);
  const near = seatApproach(seat); at(a, near.x, near.z); at(b, near.x, near.z);
  assert.equal(w.sit(a, seat.id).ok, true);
  assert.equal(a.seat, seat.id);
  const denied = w.sit(b, seat.id); assert.equal(denied.ok, false); assert.match(denied.reason, /taken/);
  const stood = w.stand(a); assert.equal(stood.ok, true); assert.equal(a.seat, null); assert.equal(blocked(a.x, a.z), false);
  assert.equal(w.sit(b, seat.id).ok, true);
});

test('bench positions are independent seats and distant or airborne players are refused', () => {
  const w = createWorld(), i = BENCHES.findIndex(b => b.x === -22 && b.z === 13.6), l = SEAT_BY_ID.get(`bench-${i}-l`), r = SEAT_BY_ID.get(`bench-${i}-r`);
  const a = player('a', l.x, l.z + .5), b = player('b', r.x, r.z + .5), far = player('c', 0, 36);
  assert.equal(w.sit(a, l.id).ok, true); assert.equal(w.sit(b, r.id).ok, true);
  assert.equal(w.sit(far, l.id).ok, false);
  const jumper = player('d', l.x, l.z + .5); jumper.y = .4; w.stand(a);
  assert.match(w.sit(jumper, l.id).reason, /Land first/);
});

test('doors open, refuse to close on someone in the doorway, and locked doors stay shut', () => {
  const w = createWorld(), a = player('a', -30, -3.2), b = player('b', -30, -4.3);
  assert.equal(w.door(a, 'library-main', true).ok, true); assert.equal(blocked(-30, -4.3), false);
  const shut = w.door(a, 'library-main', false, [b]); assert.equal(shut.ok, false); assert.match(shut.reason, /doorway/);
  assert.equal(w.door(a, 'library-main', false, []).ok, true); assert.equal(blocked(-30, -4.3), true);
  const staff = player('s', -34.95, -27.2); const locked = w.door(staff, 'library-staff', true);
  assert.equal(locked.ok, false); assert.match(locked.reason, /Locked/);
  assert.equal(w.door(player('far', 0, 36), 'library-main', true).ok, false);
});

test('ball possession is exclusive, shots fly under physics, and a disconnect drops the ball', () => {
  const w = createWorld(), ball = w.balls[0], a = player('a', ball.x, ball.z + .6), b = player('b', ball.x, ball.z - .6);
  for (let i = 0; i < 60; i++) w.step(1 / 30, [a, b]); // let the ball settle on the rack
  assert.equal(w.pickup(a, ball.id).ok, true);
  assert.match(w.pickup(b, ball.id).reason, /Someone else/);
  assert.equal(w.shoot(b, 0, .5).ok, false, 'cannot shoot a ball you do not hold');
  const south = HOOPS.find(h => h.id === 'south'); at(a, south.x, south.z + 4.6);
  const shot = w.shoot(a, Math.PI, .5); assert.equal(shot.ok, true); assert.equal(ball.state, 'flight');
  const events = []; for (let i = 0; i < 120; i++) events.push(...w.step(1 / 30, [a, b]));
  assert.equal(events.filter(e => e.type === 'score').length, 1, 'one valid shot scores exactly once');
  at(b, ball.x, ball.z); assert.equal(w.pickup(b, ball.id).ok, true, 'the rebound can be recovered');
  w.release(b); assert.equal(ball.state, 'free'); assert.equal(b.ball, null);
});

test('over the network: seat contention, results and disconnect cleanup', async () => {
  const room = createRoom({ port: 0 }), address = await room.start(), url = `ws://127.0.0.1:${address.port}/ws`;
  const next = (ws, pred, timeout = 3000) => new Promise((res, rej) => { const t = setTimeout(() => rej(Error('timeout')), timeout); const h = raw => { const m = JSON.parse(raw); if (pred(m)) { clearTimeout(t); ws.off('message', h); res(m); } }; ws.on('message', h); });
  const join = async name => { const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise(r => ws.once('open', r)); const welcome = next(ws, m => m.type === 'welcome'); ws.send(JSON.stringify({ type: 'join', name, avatar: {} })); return { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) }; };
  let a, b;
  try {
    a = await join('Ada'); b = await join('Tobi');
    assert.ok(a.welcome.world && 'seats' in a.welcome.world, 'welcome carries the world state');
    const seat = SEAT_BY_ID.get('bench-0-l'), spot = seatApproach(seat);
    for (const c of [a, b]) Object.assign(room.clients.get(c.welcome.id), { x: spot.x, z: spot.z });
    const ra = next(a.ws, m => m.type === 'result'); a.send({ type: 'sit', seat: seat.id }); assert.equal((await ra).ok, true);
    const rb = next(b.ws, m => m.type === 'result'); b.send({ type: 'sit', seat: seat.id }); const denied = await rb; assert.equal(denied.ok, false); assert.match(denied.reason, /taken/);
    const seen = await next(b.ws, m => m.type === 'state' && m.players.some(p => p.id === a.welcome.id && p.seat === seat.id)); assert.ok(seen);
    const freed = next(b.ws, m => m.type === 'world' && !Object.keys(m.seats).includes(seat.id)); a.ws.close(); await freed;
  } finally { a?.ws.close(); b?.ws.close(); await room.close(); setDoorOpen('library-main', false); }
});

test('double-acting doors swing away from the opener and never through someone on the far side', () => {
  const w = createWorld(), outside = player('o', -30, -2.9), inside = player('i', -30.6, -5.2);
  assert.match(w.door(outside, 'library-main', true, [inside]).reason, /other side/);
  assert.equal(w.door(outside, 'library-main', true, []).ok, true);
  assert.equal(w.doors['library-main'], -1, 'opened from outside (+z), the leaves swing inwards (-z)');
  assert.equal(w.door(outside, 'library-main', false, []).ok, true);
  assert.equal(w.door(player('j', -30, -6), 'library-main', true, []).ok, true);
  assert.equal(w.doors['library-main'], 1, 'opened from inside, the leaves swing outwards');
  assert.equal(w.door(player('j', -30, -6), 'library-main', false, []).ok, true);
});

test('every seat can be approached and left on foot', () => {
  for (const s of SEATS) {
    const a = seatApproach(s), e = seatApproach(s, STAND_EXIT);
    assert.equal(blocked(a.x, a.z, .3), false, `${s.id}: approach point is inside a collider`);
    assert.equal(blocked(e.x, e.z), false, `${s.id}: stand-up point is inside a collider`);
  }
});

test('players fit through a 1 m doorway even when slightly off-centre', () => {
  setDoorOpen('classroom-d1', -1);
  try {
    for (const x0 of [32.42, 32.7, 32.98]) {
      let p = { x: x0, z: -35.4 };
      for (let i = 0; i < 60; i++) p = moveWithCollisions(p.x, p.z, 0, -4.5 / 30);
      assert.ok(p.z < -37.5, `from x=${x0} the walk stopped at z=${p.z.toFixed(2)}`);
    }
  } finally { setDoorOpen('classroom-d1', 0); }
});

test('a standing player may settle their server position by a small, walkable amount only', async () => {
  const room = createRoom({ port: 0 }), address = await room.start(), url = `ws://127.0.0.1:${address.port}/ws`;
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise(r => ws.once('open', r));
  const welcome = new Promise(r => ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'welcome') r(m); }));
  ws.send(JSON.stringify({ type: 'join', name: 'Settle', avatar: {} }));
  try {
    const c = room.clients.get((await welcome).id), wait = () => new Promise(r => setTimeout(r, 120));
    ws.send(JSON.stringify({ type: 'settle', x: c.x + .5, z: c.z })); await wait(); assert.equal(c.x, .5, 'a half-metre correction is accepted');
    ws.send(JSON.stringify({ type: 'settle', x: c.x + 3, z: c.z })); await wait(); assert.equal(c.x, .5, 'a large jump is refused');
    Object.assign(c, { x: 13, z: 21.2 }); ws.send(JSON.stringify({ type: 'settle', x: 13, z: 20.4 })); await wait(); assert.equal(c.z, 21.2, 'settling into a wall is refused');
  } finally { ws.close(); await room.close(); }
});
