// Metropolis's enterable towers (Lekan Court and Okun Trust, each side): reachable from the street to the top floor
// and the roof, by players (the shared physics) and by bots (navigation); every storey has room to move and is
// furnished; no tower window gives a line of sight onto the other team's spawns. Symmetry is covered by
// arena-metropolis.test.mjs (every box has its mirror).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_BY_ID } from '../shared/arena/maps.mjs';
import { TOWERS } from '../shared/arena/metropolis.mjs';
import { arenaWorld } from '../shared/arena/doors.mjs';
import { moveBody, lineOfSight } from '../shared/arena/physics.mjs';
import { navigation } from '../server/arena/bots.mjs';
import { towerWindows, seesEnemySpawn } from '../scripts/qa/metropolis-sightlines.mjs';

const map = MAP_BY_ID.get('metropolis'), nav = navigation(map);
const H = 3.5, STOREYS = { lekan: 7, trust: 4 };
const sides = t => [{ ...t, side: 'west' }, { ...t, side: 'east', x0: -t.x1, x1: -t.x0 }];
const inside = (t, n) => n.x > t.x0 && n.x < t.x1 && n.z > t.z0 && n.z < t.z1;

test('both teams can climb every tower from the street to the top floor and the roof (bots: navigation)', () => {
  for (const [team, sx] of [[0, -56.5], [1, 56.5]]) {
    const start = nav.near(sx, 5, -11), seen = new Set([start]), queue = [start];
    while (queue.length) for (const j of nav.nodes[queue.pop()].links) if (!seen.has(j)) { seen.add(j); queue.push(j); }
    const reached = [...seen].map(i => nav.nodes[i]);
    for (const base of TOWERS) for (const t of sides(base)) {
      const top = t.base + STOREYS[t.id] * H, ys = new Set(reached.filter(n => inside(t, n)).map(n => n.y));
      for (let k = 0; k < STOREYS[t.id]; k++) assert.ok(ys.has(t.base + k * H), `team ${team}: ${t.side} ${t.id} storey ${k} (y ${t.base + k * H})`);
      assert.ok(ys.has(top), `team ${team}: ${t.side} ${t.id} roof (y ${top})`);
    }
  }
});

test('a player climbs a stair core flight by flight (shared physics)', () => {
  const world = arenaWorld(map), out = {};
  // Okun Trust west: from the hall floor at the stair foot, up the first flight, round the landing, up to the first floor.
  const b = { x: -42.8, y: 5, z: -6 };
  for (let i = 0; i < 60; i++) moveBody(world, b, 0, -.1, .1, .3, 1.75, .35, out);
  assert.ok(b.y > 6.9 && b.y < 7.1, `half landing (${b.y.toFixed(2)})`);
  b.x = -41.2; for (let i = 0; i < 60; i++) moveBody(world, b, 0, -.1, -.1, .3, 1.75, .35, out);
  assert.ok(Math.abs(b.y - 9) < .01, `first office floor (${b.y.toFixed(2)})`);
});

test('every tower storey has floor to move on and furniture', () => {
  for (const base of TOWERS) for (const t of sides(base)) for (let k = 0; k < STOREYS[t.id]; k++) {
    const y = t.base + k * H, cells = nav.nodes.filter(n => inside(t, n) && n.y === y).length;
    assert.ok(cells >= 40, `${t.side} ${t.id} storey ${k}: ${cells} m² walkable`);
    const furniture = map.boxes.filter(b => ['desk', 'table', 'cabinet', 'sofa'].includes(b.mat) && b.min[1] === y && b.min[0] > t.x0 && b.max[0] < t.x1 && b.min[2] > t.z0 && b.max[2] < t.z1);
    assert.ok(furniture.length >= 3, `${t.side} ${t.id} storey ${k}: ${furniture.length} pieces`);
  }
});

test('no tower window looks onto the other team\'s spawns (and the check does find a sightline when there is one)', () => {
  const windows = towerWindows();
  assert.ok(windows.length > 100, `${windows.length} windows checked`);
  for (const w of windows) assert.equal(seesEnemySpawn(w), null, `${w.tower} ${w.face} storey ${w.storey} bay ${w.bay}`);
  // Control: 3 m in front of an exposed enemy spawn, the same test sees it.
  const s = map.spawns.find(p => p.team === 1 && p.x === 56.5 && p.z === -11);
  assert.ok(lineOfSight(arenaWorld(map), s.x - 3, s.y + 1.6, s.z, s.x, s.y + 1.6, s.z));
});

test('Okun Tower, on the axis: both teams reach all thirteen storeys and the roof from the same lobby; every floor has room', () => {
  const t = { x0: -4.6, z0: -43, x1: 4.6, z1: -37.4 }, base = 5, storeys = 13;
  for (const [team, sx] of [[0, -56.5], [1, 56.5]]) {
    const start = nav.near(sx, 5, -11), seen = new Set([start]), queue = [start];
    while (queue.length) for (const j of nav.nodes[queue.pop()].links) if (!seen.has(j)) { seen.add(j); queue.push(j); }
    const ys = new Set([...seen].map(i => nav.nodes[i]).filter(n => inside(t, n)).map(n => n.y));
    for (let k = 0; k <= storeys; k++) assert.ok(ys.has(base + k * H), `team ${team}: Okun Tower ${k === storeys ? 'roof' : 'storey ' + k}`);
  }
  for (let k = 0; k < storeys; k++) { const cells = nav.nodes.filter(n => inside(t, n) && n.y === base + k * H).length; assert.ok(cells >= 10, `storey ${k}: ${cells} m² walkable`); }
});
