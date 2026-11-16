// Every intended space can be reached: no door opens onto a wall, a stair's side or a drop, and no enclosed floor
// (under a ceiling) is cut off from both teams' spawns. Reachability is measured on the bots' navigation graph (the
// map's real collision boxes, every door open, open leaves as obstacles). Areas under a ceiling that stand on
// furniture or props (counters, racks, cars …) are tops of things, not rooms, and are ignored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/arena/maps.mjs';
import { arenaWorld } from '../shared/arena/doors.mjs';
import { overlaps, groundBelow, createWorld, raycast } from '../shared/arena/physics.mjs';
import { navigation } from '../server/arena/bots.mjs';

const PROP = /^(machine|rail|car|rack|barrier|table|counter|crate|desk|shelf|cabinet|sofa|bench|bin|planter|kiosk|tank|ac|vent|sandbag|container|faregate|vending|bollard|partition)/;
/**
 * Floor areas players reach but the bots' 1 m grid cannot (checked with the player simulation): Okun Tower's stair
 * core is 1.4 m wide, and the bus platform is a 0.3 m step between a screen and the kerb. Bots do not path there.
 */
const GRID_ONLY = [
  { map: 'metropolis', why: "Okun Tower's stair core landings", x: [2, 4], z: [-42, -38] },
  { map: 'metropolis', why: 'the bus rapid transit platform', x: [-9, 9], z: [-26.3, -23.7], y: [5.2, 5.4] },
];

test('every door opens onto floor with room to stand, on both sides', () => {
  for (const m of MAPS) {
    const world = arenaWorld(m);
    for (const d of world.doors) {
      const cx = (d.min[0] + d.max[0]) / 2, cz = (d.min[2] + d.max[2]) / 2, sill = d.min[1];
      for (const s of [-1, 1]) {
        const off = (d.t ?? .3) / 2 + .4, x = d.alongZ ? cx + s * off : cx, z = d.alongZ ? cz : cz + s * off;
        const floor = groundBelow(world, x, sill + .4, z, .25, .8);
        assert.ok(Math.abs(floor - sill) <= .36, `${m.id} door ${d.i}, side ${s}: floor at ${floor} against a sill at ${sill}`);
        assert.ok(!overlaps(world, x, sill + .36, z, .28, 1.4), `${m.id} door ${d.i}, side ${s}: something solid right outside it`);
      }
    }
  }
});

test('no enclosed floor is cut off from the spawns', () => {
  for (const m of MAPS) {
    const nav = navigation(m), w = createWorld(m.boxes, m.bounds), hit = { normal: [0, 0, 0] };
    const comp = new Array(nav.nodes.length).fill(-1); let c = 0;
    for (let s = 0; s < nav.nodes.length; s++) { if (comp[s] >= 0) continue; const q = [s]; comp[s] = c; while (q.length) { const n = q.pop(); for (const k of nav.nodes[n].links) if (comp[k] < 0) { comp[k] = c; q.push(k); } } c++; }
    const reached = new Set(m.spawns.map(s => comp[nav.near(s.x, 0, s.z)]));
    const bad = [];
    for (const n of nav.nodes) {
      if (reached.has(comp[n.id])) continue;
      const up = raycast(w, n.x, n.y + .2, n.z, 0, 1, 0, 4, null, hit); if (!up || !up.box) continue; // open sky: a roof or a prop top
      // What it stands on: a box under its footprint whose top is at its height.
      const under = w.query(n.x - .3, n.z - .3, n.x + .3, n.z + .3).find(b => Math.abs(b.y1 - n.y) < 1e-3), box = under ? m.boxes[under.i] : null, mat = box?.mat ?? 'ground';
      if (PROP.test(mat)) continue;
      // The top of a free-standing thing (0.45–3.5 m tall, under 12 m² of footprint) is furniture, not a floor.
      if (box) { const h = box.max[1] - box.min[1], area = (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]); if (h >= .45 && h <= 3.5 && area < 12) continue; }
      if (GRID_ONLY.some(g => g.map === m.id && n.x >= g.x[0] - .5 && n.x <= g.x[1] + .5 && n.z >= g.z[0] - .5 && n.z <= g.z[1] + .5 && (!g.y || (n.y >= g.y[0] && n.y <= g.y[1])))) continue;
      bad.push(`${m.id} (${n.x}, ${n.y.toFixed(1)}, ${n.z}) on ${mat}`);
    }
    assert.deepEqual(bad.slice(0, 8), [], `${bad.length} enclosed spots cut off`);
  }
});
