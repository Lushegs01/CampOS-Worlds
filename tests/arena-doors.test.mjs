// Doors (shared/arena/doors.mjs): every door opening has a leaf; open doors leave the map exactly as designed; closed
// doors block movement and sight for the server and the client alike; only the server moves a door, never onto a
// player, never mid-swing; a rejoining client is told which doors are shut; a new round opens them all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MAP_BY_ID } from '../shared/arena/maps.mjs';
import { arenaWorld, doorsOf, setDoor, doorOpen, doorInReach, doorBlocked, closedDoors, DOOR_SWING_MS } from '../shared/arena/doors.mjs';
import { moveBody, raycast, lineOfSight } from '../shared/arena/physics.mjs';
import { spawnState, step, quantize, encodeCommand, decodeCommand, B, EYE } from '../shared/arena/sim.mjs';
import { PRESETS } from '../shared/arena/rules.mjs';
import { createMatch } from '../server/arena/match.mjs';

const map = MAP_BY_ID.get('metropolis');
/** A street-level door in a wall along x (a normal along z), and points 1 m either side of its middle. */
function streetDoor(world) {
  const d = world.doors.find(d => !d.alongZ && d.min[1] === 5 && d.w >= 1.6 && d.h >= 2.3);
  const cx = (d.min[0] + d.max[0]) / 2, cz = (d.min[2] + d.max[2]) / 2;
  return { d, cx, cz, a: { x: cx, y: 5, z: cz - 1 }, b: { x: cx, y: 5, z: cz + 1 } };
}

test('doorways get doors (bays and arcades do not); Metropolis doors are mirrored west to east like the rest of the map', () => {
  assert.equal(doorsOf(map).length, 36);
  for (const m of MAPS) for (const d of doorsOf(m)) assert.ok(d.w <= 2.2 && d.h <= 3.6, `${m.id} door ${d.i} is a doorway`);
  assert.equal(doorsOf(MAP_BY_ID.get('foundry')).length, 0, 'warehouse bays stay open');
  const doors = doorsOf(map), key = d => JSON.stringify([d.min.map(v => +v.toFixed(3)), d.max.map(v => +v.toFixed(3))]), all = new Set(doors.map(key));
  for (const d of doors) {
    assert.ok(d.max[0] > d.min[0] && d.max[1] > d.min[1] && d.max[2] > d.min[2], 'a real box');
    assert.ok(Math.min(d.max[0] - d.min[0], d.max[2] - d.min[2]) < .1, 'a thin leaf');
    assert.ok(all.has(key({ min: [-d.max[0], d.min[1], d.min[2]], max: [-d.min[0], d.max[1], d.max[2]] })), `mirror of ${key(d)}`);
  }
});

test('open doors are not there for movement or sight; closed doors block both', () => {
  const world = arenaWorld(map), { d, a, b } = streetDoor(world);
  const walk = () => { const body = { ...a }, out = {}; moveBody(world, body, 0, 0, 2, .3, 1.75, .35, out); return body.z; };
  assert.ok(doorOpen(world, d.i) && closedDoors(world).length === 0, 'every door starts open');
  assert.ok(walk() > b.z - .01, 'walks through an open doorway');
  assert.ok(lineOfSight(world, a.x, 6.5, a.z, b.x, 6.5, b.z), 'sees through an open doorway');
  setDoor(world, d.i, false);
  assert.ok(walk() < (d.min[2] + d.max[2]) / 2, 'stopped by the closed leaf');
  assert.equal(lineOfSight(world, a.x, 6.5, a.z, b.x, 6.5, b.z), false, 'a closed door blocks sight');
  const hit = raycast(world, a.x, 6.5, a.z, 0, 0, 1, 2);
  assert.ok(hit?.box?.door === d.i && hit.box.thin, 'a round strikes the door (thin cover: penetrating rounds go through)');
  setDoor(world, d.i, true); assert.ok(walk() > b.z - .01, 'open again');
});

test('reach: the door in front of the eye, not one behind the player; a doorway with someone in it cannot close', () => {
  const world = arenaWorld(map), { d, a } = streetDoor(world);
  assert.equal(doorInReach(world, a.x, 5 + EYE[0], a.z + .2, 0 + Math.PI), d.i, 'facing the door');
  assert.equal(doorInReach(world, a.x, 5 + EYE[0], a.z + .2, 0), -1, 'facing away');
  assert.equal(doorInReach(world, a.x, 5 + EYE[0], a.z - 3, Math.PI), -1, 'out of reach');
  assert.ok(doorBlocked(world, d.i, [{ x: a.x, y: 5, z: (d.min[2] + d.max[2]) / 2 }]));
  assert.equal(doorBlocked(world, d.i, [a]), false);
});

test('the Use button travels in commands and the simulation reports it', () => {
  const cmd = quantize({ seq: 1, b: B.USE | B.FIRE, mx: 0, mz: 0, yaw: 0, pitch: 0 });
  assert.equal(decodeCommand(encodeCommand(cmd)).b, B.USE | B.FIRE);
  const s = spawnState({ x: 0, z: 0 }, PRESETS[0]), world = arenaWorld(map);
  const ev = step(s, quantize({ seq: 1, b: B.USE, mx: 0, mz: 0, yaw: 0, pitch: 0 }), { world, seed: 1, num: 1, perks: new Set() });
  assert.ok(ev.some(e => e.kind === 'use'));
});

test('the server moves doors: closes and opens on Use, tells everyone, keeps it for rejoins, refuses mid-swing and onto a player, reopens all for a new round', () => {
  let now = 100000; const events = [];
  const m = createMatch({ id: 'doors', map, mode: 'tdm', kind: 'private', variant: 'night', autoTick: false, clock: () => now,
    rules: { countdownMs: 0, spawnProtectMs: 0, abandonMs: 1e7, mode: { scoreLimit: 10000, timeMs: 600000 } },
    send: (p, e) => { if (p.num === 1 && e.t === 'e') events.push(...e.l); }, sendRaw: () => {} });
  const p = m.join({ id: 'p', name: 'P' }), q = m.join({ id: 'q', name: 'Q' });
  const tick = (ms = 17) => { now += ms; m.tick(); };
  const { d, a } = streetDoor(m.world);
  // A door shut before the match starts (warm-up): the start of play opens it again.
  setDoor(m.world, d.i, false);
  m.hostStart(p); tick();
  assert.equal(doorOpen(m.world, d.i), true, 'the start of a round opens every door'); assert.ok(events.some(e => e.k === 'door' && e.reset === 1));
  const at = { ...a, z: a.z + .2 }, place = (who, pos) => { Object.assign(who.sim, { ...pos, vx: 0, vy: 0, vz: 0 }); who.history = []; };
  const use = () => { place(p, at); for (const b of [B.USE, 0]) m.commands(p, [encodeCommand(quantize({ seq: p.lastSeq + 1, b, mx: 0, mz: 0, yaw: Math.PI, pitch: 0 }))]); tick(); };
  const doorEvents = () => events.filter(e => e.k === 'door' && !e.reset);
  place(q, { x: 0, y: 5, z: 0 });
  use();
  assert.equal(doorOpen(m.world, d.i), false, 'closed by the server');
  assert.deepEqual(doorEvents().at(-1), { k: 'door', i: d.i, open: 0, num: p.num });
  assert.deepEqual(m.view().closed, [d.i], 'a joining or rejoining client is told');
  const before = doorEvents().length; now += 300; use();
  assert.equal(doorEvents().length, before, 'not again mid-swing'); assert.equal(doorOpen(m.world, d.i), false);
  now += DOOR_SWING_MS; use();
  assert.equal(doorOpen(m.world, d.i), true, 'opened after its swing');
  now += DOOR_SWING_MS; place(q, { x: (d.min[0] + d.max[0]) / 2, y: 5, z: (d.min[2] + d.max[2]) / 2 });
  const n = doorEvents().length; use();
  assert.equal(doorOpen(m.world, d.i), true, 'will not close on a player in the doorway'); assert.equal(doorEvents().length, n);
  m.close?.('test');
});
