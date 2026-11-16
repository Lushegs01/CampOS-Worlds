// Open door leaves are solid (shared/arena/doors.mjs openLeafBoxes): the box stands exactly where the renderer draws
// the open leaf; it is on only while the door is open; it never narrows its own doorway, never closes off any walkable
// area (bot navigation compared with and without leaves, every map, both teams' spawns), and mirrored doors open in
// mirror. The server never swings a door open into a player.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS, MAP_BY_ID } from '../shared/arena/maps.mjs';
import { arenaWorld, doorsOf, openLeafBoxes, openLeafBoxesOf, setDoor, doorBlocked } from '../shared/arena/doors.mjs';
import { moveBody } from '../shared/arena/physics.mjs';
import { navigation } from '../server/arena/bots.mjs';
import { CENTRAL_INTERIOR } from '../shared/arena/metropolis.mjs';

const map = MAP_BY_ID.get('metropolis');
/** The renderer's open-leaf placement (src/arena/scene/doorLeaves.ts): basis · T(hinge, y0, 0) · RY(−swing·dir·angle). */
function drawnPoints(d, l) {
  const basis = new THREE.Matrix4();
  if (d.alongZ) basis.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)).setPosition((d.min[0] + d.max[0]) / 2, 0, 0);
  else basis.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)).setPosition(0, 0, (d.min[2] + d.max[2]) / 2);
  const H = basis.multiply(new THREE.Matrix4().makeTranslation(l.hinge, l.y0, 0)).multiply(new THREE.Matrix4().makeRotationY(-l.swing * l.dir * l.angle));
  const pts = []; for (const x of [.1, .25, .5, .75, 1]) for (const y of [.05, .5, .95]) pts.push(new THREE.Vector3(l.dir * l.w * x, l.h * y, 0).applyMatrix4(H));
  return pts;
}

test('each open leaf is solid exactly where it is drawn', () => {
  for (const d of doorsOf(map)) {
    const boxes = openLeafBoxes(d);
    d.leaves.forEach((l, k) => { const b = boxes[k];
      for (const p of drawnPoints(d, l)) assert.ok(p.x > b.min[0] - .01 && p.x < b.max[0] + .01 && p.y > b.min[1] - .01 && p.y < b.max[1] + .01 && p.z > b.min[2] - .01 && p.z < b.max[2] + .01, `door ${d.i} leaf ${k}: drawn point ${p.toArray().map(v => v.toFixed(2))} outside its box`); });
  }
});

test('an open door blocks where its leaf stands and its doorway stays clear; shut, the reverse', () => {
  const world = arenaWorld(map), d = world.doors.find(d => !d.alongZ && d.min[1] === 5 && d.w >= 1.6 && d.leaves[0].angle < 2);
  const leaf = openLeafBoxes(d)[0], lx = (leaf.min[0] + leaf.max[0]) / 2, mid = (d.min[2] + d.max[2]) / 2, side = Math.sign((leaf.min[2] + leaf.max[2]) / 2 - mid), lz = mid + side * .65;
  // Walk along the wall, clear of its face, across where the leaf stands on its swing side.
  const across = () => { const body = { x: lx - 1.2, y: 5, z: lz }, out = {}; moveBody(world, body, 2.4, 0, 0, .3, 1.75, .35, out); return body.x; };
  assert.ok(across() < lx, 'open: the leaf stops a player walking into it');
  setDoor(world, d.i, false); assert.ok(across() > lx + 1, 'shut: nothing stands there');
  setDoor(world, d.i, true);
  const cx = (d.min[0] + d.max[0]) / 2, through = { x: cx, y: 5, z: (d.min[2] + d.max[2]) / 2 - side }, out = {};
  moveBody(world, through, 0, 0, 2 * side, .3, 1.75, .35, out);
  assert.ok(Math.abs(through.z - ((d.min[2] + d.max[2]) / 2 + side)) < .05, 'open: straight through the middle of the doorway');
});

test('mirrored doors open in mirror (the map stays symmetric)', () => {
  const key = b => JSON.stringify([b.min.map(v => +v.toFixed(3)), b.max.map(v => +v.toFixed(3))]), all = new Set(openLeafBoxesOf(map).map(key));
  const c = CENTRAL_INTERIOR;
  for (const d of doorsOf(map)) {
    const cx = (d.min[0] + d.max[0]) / 2, cz = (d.min[2] + d.max[2]) / 2;
    if (cx > c.x0 && cx < c.x1 && cz > c.z0 && cz < c.z1) continue; // Okun Tower's stair head is on the axis
    for (const b of openLeafBoxes(d)) assert.ok(all.has(key({ min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] })), `door ${d.i}: no mirror for ${key(b)}`);
  }
});

test('open leaves close off no walkable area, on any map, from either side\'s spawns', () => {
  const reach = (nav, from) => { const seen = new Set([from]), q = [from]; while (q.length) { const n = q.pop(); for (const m of nav.nodes[n].links) if (!seen.has(m)) { seen.add(m); q.push(m); } } return seen; };
  const key = n => `${n.x},${n.y.toFixed(2)},${n.z}`;
  for (const m of MAPS) {
    const leaves = openLeafBoxesOf(m), base = navigation(m, [], false), lv = navigation(m, leaves, false);
    const under = n => leaves.some(b => n.x > b.min[0] - .75 && n.x < b.max[0] + .75 && n.z > b.min[2] - .75 && n.z < b.max[2] + .75 && n.y > b.min[1] - 1 && n.y < b.max[1]);
    for (const team of [0, 1]) {
      const sp = m.spawns.find(s => s.team === team), rb = reach(base, base.near(sp.x, 0, sp.z)), rl = new Set([...reach(lv, lv.near(sp.x, 0, sp.z))].map(i => key(lv.nodes[i])));
      const lost = [...rb].map(i => base.nodes[i]).filter(n => !rl.has(key(n)) && !under(n));
      assert.deepEqual(lost.slice(0, 5).map(key), [], `${m.id} team ${team}: ${lost.length} places no longer reachable`);
    }
  }
});

test('no leaf opens onto a spawn, and the server will not swing a door open into a player', () => {
  for (const s of map.spawns) for (const b of openLeafBoxesOf(map)) assert.ok(!(s.x > b.min[0] - .5 && s.x < b.max[0] + .5 && s.z > b.min[2] - .5 && s.z < b.max[2] + .5 && b.min[1] < 1), `spawn ${s.x},${s.z}`);
  const world = arenaWorld(map), d = world.doors[0], leaf = openLeafBoxes(d)[0];
  const there = { x: (leaf.min[0] + leaf.max[0]) / 2, y: leaf.min[1], z: (leaf.min[2] + leaf.max[2]) / 2 };
  assert.equal(doorBlocked(world, d.i, [there], true), true, 'standing where the leaf will swing');
  assert.equal(doorBlocked(world, d.i, [there], false), false, 'but not in the doorway');
});
