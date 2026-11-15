// Competitive fairness of Metropolis's enterable towers: which tower windows give a line of sight onto the other
// team's spawns. A player stands just inside each window (standing and crouching eye heights, across its width) and
// looks for each enemy spawn's head and chest, through every door left open and through glass (glass never blocks
// sight). The map is mirror-symmetric, so the west towers against team 1's spawns covers both sides; the central tower's
// faces are checked against whichever team they face.
// Usage: node scripts/qa/metropolis-sightlines.mjs   → prints offending windows as [storey, bay] per face (for the
// *_SKIP tables in shared/arena/metropolis.mjs); exit code 1 when any remain.
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { arenaWorld } from '../../shared/arena/doors.mjs';
import { lineOfSight } from '../../shared/arena/physics.mjs';
import { TOWERS, UPPER_FLOORS } from '../../shared/arena/metropolis.mjs';

const map = MAP_BY_ID.get('metropolis'), world = arenaWorld(map);
/** Every window of a west tower, with its face, storey and bay. */
export function towerWindows() {
  const out = [];
  for (const t of [...TOWERS, ...UPPER_FLOORS]) for (const d of map.deco) {
    if (d.kind !== 'window' || d.east) continue;
    const cx = (d.min[0] + d.max[0]) / 2, cz = (d.min[2] + d.max[2]) / 2;
    if (cx < t.x0 - .1 || cx > t.x1 + .1 || cz < t.z0 - .1 || cz > t.z1 + .1 || d.min[1] < t.base - .1) continue;
    const face = d.alongZ ? (Math.abs(cx - t.x0) < .5 ? 'w' : 'e') : (Math.abs(cz - t.z0) < .5 ? 'n' : 's');
    const a0 = d.alongZ ? t.z0 + .4 : t.x0, a1 = d.alongZ ? t.z1 - .4 : t.x1, len = a1 - a0, n = Math.max(1, Math.floor((len - .6) / 2.6));
    const bay = Math.floor(((d.alongZ ? cz : cx) - a0) / (len / n)), storey = Math.round((d.min[1] - .9 - t.base) / 3.5);
    out.push({ tower: t.id, face, storey, bay, d });
  }
  return out;
}
/** Does window w see any of team 1's spawns? Returns the first spawn seen, or null. */
export function seesEnemySpawn(w) {
  const { d } = w, inward = d.alongZ ? (w.face === 'w' ? .6 : -.6) : (w.face === 'n' ? .6 : -.6), floor = d.min[1] - .9;
  // The other team's spawns: a window west of the centre line faces team 1; east of it (the central tower's east face)
  // team 0; on the line, both.
  const cx = (d.min[0] + d.max[0]) / 2, enemy = map.spawns.filter(s => (cx < -.5 ? s.team === 1 : cx > .5 ? s.team === 0 : true));
  for (let u = .15; u <= .85; u += .35) for (const eye of [1.6, 1.0]) {
    const ex = d.alongZ ? (d.min[0] + d.max[0]) / 2 + inward : d.min[0] + (d.max[0] - d.min[0]) * u;
    const ez = d.alongZ ? d.min[2] + (d.max[2] - d.min[2]) * u : (d.min[2] + d.max[2]) / 2 + inward;
    for (const s of enemy) for (const h of [1.6, 1.2]) if (lineOfSight(world, ex, floor + eye, ez, s.x, s.y + h, s.z)) return s;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = {};
  const all = towerWindows();
  for (const w of all) { const s = seesEnemySpawn(w); if (s) ((bad[w.tower] ??= {})[w.face] ??= []).push([w.storey, w.bay]); }
  console.log(`${all.length} tower windows checked;`, Object.keys(bad).length ? 'windows that see enemy spawns:' : 'none sees an enemy spawn.');
  for (const [t, faces] of Object.entries(bad)) for (const [f, list] of Object.entries(faces)) console.log(`  ${t} ${f}: ${JSON.stringify(list)}`);
  process.exit(Object.keys(bad).length ? 1 : 0);
}
