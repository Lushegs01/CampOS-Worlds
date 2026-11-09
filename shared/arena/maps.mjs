// Combat Arena maps: original layouts built for competitive play, made of boxes so the server, the
// client's prediction and the renderer share one exact geometry. Both maps are mirror-symmetric
// across x = 0, with one team spawning west and the other east, so neither side has an advantage.
//
// Each is a clearly fictional training simulation (the "CampOS Combat Simulation"), never a real or
// ordinary campus space: Foundry Yard is an industrial training yard and Sim Quad a stylised
// simulation of a campus quadrangle, echoing the warm stone, timber and green of Òrìṣun Campus.
//
// Coordinates: x east, y up, z south, metres. yaw 0 faces north (−z); yaw −π/2 faces east.

const box = (x, z, w, d, h, y = 0, mat = 'concrete', extra = {}) => ({ min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], mat, ...extra });
const span = (x0, z0, x1, z1, y0, y1, mat, extra = {}) => ({ min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)], mat, ...extra });

/**
 * A straight wall from (x0,z) to (x1,z) (or along z when `alongZ`), with openings: each gap is
 * [from, to, bottom?, top?] along the wall. A gap with bottom/top leaves wall below and above (a window).
 */
function wall(out, { a0, a1, at, h, t = .5, alongZ = false, gaps = [], mat = 'concrete', y = 0 }) {
  const pieces = [];
  let cursor = a0;
  const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
  for (const [g0, g1, gb = 0, gt = h] of sorted) {
    if (g0 > cursor) pieces.push([cursor, g0, 0, h]);
    if (gb > 0) pieces.push([g0, g1, 0, gb]);
    if (gt < h) pieces.push([g0, g1, gt, h]);
    cursor = Math.max(cursor, g1);
  }
  if (cursor < a1) pieces.push([cursor, a1, 0, h]);
  for (const [p0, p1, b0, b1] of pieces) {
    if (p1 - p0 < 1e-3 || b1 - b0 < 1e-3) continue;
    out.push(alongZ ? span(at - t / 2, p0, at + t / 2, p1, y + b0, y + b1, mat) : span(p0, at - t / 2, p1, at + t / 2, y + b0, y + b1, mat));
  }
}

/** Stairs as solid steps (rise .25 m, run .5 m) from (x,z) climbing `height` toward `dir` ('+x','-x','+z','-z'). */
function stairs(out, { x, z, dir, width, height, y = 0, mat = 'metal' }) {
  const steps = Math.round(height / .25);
  for (let k = 1; k <= steps; k++) {
    const along = (k - 1) * .5;
    const top = y + k * .25;
    if (dir === '+x') out.push(span(x + along, z - width / 2, x + along + .5, z + width / 2, 0, top, mat));
    if (dir === '-x') out.push(span(x - along - .5, z - width / 2, x - along, z + width / 2, 0, top, mat));
    if (dir === '+z') out.push(span(x - width / 2, z + along, x + width / 2, z + along + .5, 0, top, mat));
    if (dir === '-z') out.push(span(x - width / 2, z - along - .5, x + width / 2, z - along, 0, top, mat));
  }
}

/** Mirror boxes across x = 0 (the other team's half). */
const mirrorX = b => ({ ...b, min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] });
/** Mirror boxes across z = 0. */
const mirrorZ = b => ({ ...b, min: [b.min[0], b.min[1], -b.max[2]], max: [b.max[0], b.max[1], -b.min[2]] });

// ====================================================================================== Foundry Yard
function foundry() {
  const half = []; // the west half (x <= 0); mirrored for the east
  const centre = []; // pieces spanning x = 0, already symmetric
  // Perimeter.
  centre.push(span(-41, -29, 41, -28, 0, 7, 'perimeter'), span(-41, 28, 41, 29, 0, 7, 'perimeter'));
  half.push(span(-41, -28, -40, 28, 0, 7, 'perimeter'));
  // ---------------- central warehouse (interior, upper catwalk, windows)
  wall(half, { a0: -9.25, a1: 9.25, at: -11, alongZ: true, h: 7, gaps: [[-2.5, 2.5, 0, 3.6], [-7.5, -5.5, 1.2, 2.4], [5.5, 7.5, 1.2, 2.4]], mat: 'brick' });
  wall(centre, { a0: -11.25, a1: 11.25, at: -9, h: 7, gaps: [[-7, -4], [4, 7], [-1.5, 1.5, 1.2, 2.4]], mat: 'brick' });
  wall(centre, { a0: -11.25, a1: 11.25, at: 9, h: 7, gaps: [[-7, -4], [4, 7], [-1.5, 1.5, 1.2, 2.4]], mat: 'brick' });
  // Door lintels sit above the openings (walls carry 0–7 m; door gaps leave 0–3.6 open).
  centre.push(span(-7, -9.25, -4, -8.75, 3.6, 7, 'brick'), span(4, -9.25, 7, -8.75, 3.6, 7, 'brick'));
  centre.push(span(-7, 8.75, -4, 9.25, 3.6, 7, 'brick'), span(4, 8.75, 7, 9.25, 3.6, 7, 'brick'));
  centre.push(span(-11.5, -9.5, 11.5, 9.5, 7, 7.35, 'roof'));
  // Catwalk along the north wall at 3.5 m, reached by stairs at either end.
  centre.push(span(-10.75, -8.75, 10.75, -6.4, 3.2, 3.5, 'grate'));
  half.push(span(-6.6, -6.45, -1.2, -6.35, 3.5, 4.5, 'rail', { thin: true }));
  stairs(half, { x: -1.4, z: -5.6, dir: '-x', width: 1.6, height: 3.5 });
  // Interior cover: crates, a press machine and pillars.
  half.push(box(-5, 2.5, 1.6, 1.6, 1.2, 0, 'crate'), box(-7.5, 5.5, 2.4, 1.2, 1.2, 0, 'crate'), box(-3, 6.5, 1.2, 1.2, 2.2, 0, 'crate'));
  half.push(box(-8.5, -2.8, .8, .8, 7, 0, 'pillar'));
  centre.push(box(0, -1, 3, 2, 1.5, 0, 'machine'), box(0, -1, 1.2, 1.2, 2.6, 1.5, 'machine'));
  // ---------------- west yard and lanes
  // North lane: containers and a raised gantry perch with stairs.
  half.push(box(-25, -20, 6, 2.5, 2.6, 0, 'container-red'), box(-15, -15.5, 2.5, 6, 2.6, 0, 'container-blue'));
  half.push(box(-30, -12, 2.5, 6, 2.6, 0, 'container-yellow'));
  centre.push(span(-4, -27.5, 4, -23, 0, 3.5, 'container-stack'));
  half.push(span(-4, -23.3, -1.5, -23.05, 3.5, 4.5, 'rail', { thin: true }));
  stairs(half, { x: -11, z: -25.25, dir: '+x', width: 1.6, height: 3.5, mat: 'metal' });
  half.push(box(-8, -17, 1.6, 1.6, 1.2, 0, 'crate'), box(-20, -24.5, 1.6, 1.6, 1.2, 0, 'crate'));
  // South lane: the pump house (a small interior) and low walls.
  half.push(span(-3.5, 16, -3, 23.5, 0, 3.4, 'brick'));
  half.push(span(-3.5, 16, -1, 16.5, 0, 3.4, 'brick'), span(-3.5, 23, -1, 23.5, 0, 3.4, 'brick'));
  centre.push(span(-3.5, 16, 3.5, 23.5, 3.4, 3.7, 'roof'));
  centre.push(box(0, 19.75, 1.2, 1.2, 1.1, 0, 'crate'));
  half.push(box(-12, 20, 5, .8, 1, 0, 'sandbag'), box(-20, 15, .8, 5, 1, 0, 'sandbag'), box(-26, 22, 2.5, 6, 2.6, 0, 'container-red'));
  half.push(box(-9, 12.5, 1.6, 1.6, 1.2, 0, 'crate'));
  // Mid-yard cover between the spawn and objective A.
  half.push(box(-18, -4.5, 3.2, .9, 1.2, 0, 'barrier'), box(-18, 5, 3.2, .9, 1.2, 0, 'barrier'), box(-27, 0, .9, 4, 1.2, 0, 'barrier'));
  half.push(box(-22, -9, 1.6, 1.6, 1.2, 0, 'crate'), box(-22, 9.5, 2.5, 2.5, 2.6, 0, 'container-blue'));
  half.push(box(-14, 0, .9, 2.4, 1.1, 0, 'sandbag', { thin: true }));
  // Spawn shelter walls (block the long sightline into each spawn).
  half.push(box(-33, -6, .9, 6, 2.2, 0, 'barrier'), box(-33, 7, .9, 6, 2.2, 0, 'barrier'));
  const boxes = [...centre, ...half, ...half.map(mirrorX)];
  return {
    id: 'foundry', name: 'Foundry Yard', blurb: 'An industrial training yard: a two-level warehouse at the centre, a container lane and gantry to the north, a pump house to the south.',
    bounds: [-40, -28, 40, 28], boxes,
    palette: { sky: '#9db7c9', horizon: '#e6d3b0', fog: '#c9c2b2', ground: '#7c776c', sun: '#ffe2b8', ambient: '#b8c4d2', sunDir: [-.45, .8, -.38] },
    objectives: [{ id: 'A', x: -22, y: 0, z: 0, r: 3.6 }, { id: 'B', x: 0, y: 0, z: 3.5, r: 3.6 }, { id: 'C', x: 22, y: 0, z: 0, r: 3.6 }],
    spawns: spawnSet([[-36.5, -22], [-36.5, -14], [-36.5, -3], [-36.5, 3], [-36.5, 14], [-36.5, 22], [-30, -24], [-31, 26.4]], [[-14, -24], [-26, -16], [-26, 16], [-14, 25], [-6.5, 12.5]]),
  };
}

// ====================================================================================== Sim Quad
function quad() {
  const north = []; // the north block (x-symmetric itself), mirrored to the south
  const half = [];  // west-half pieces, mirrored to the east
  const centre = [];
  centre.push(span(-37, -35, 37, -34, 0, 9, 'perimeter'), span(-37, 34, 37, 35, 0, 9, 'perimeter'));
  half.push(span(-37, -34, -36, 34, 0, 9, 'perimeter'));
  // ---------------- north teaching block: two floors, a balcony over the quad, stairwells at both ends
  const H = 8;
  wall(north, { a0: -20.25, a1: 20.25, at: -30, h: H, mat: 'stone' });
  // South façade: ground-floor doors and arcade openings, an open balcony above.
  wall(north, { a0: -20.25, a1: 20.25, at: -20, h: 3.7, mat: 'stone', gaps: [[-15, -12], [-2, 2], [12, 15], [-8, -5, .9, 2.6], [5, 8, .9, 2.6]] });
  wall(north, { a0: -30.25, a1: -19.75, at: -20, alongZ: true, h: H, mat: 'stone', gaps: [[-28.5, -25.5, 0, 3.2]] });
  wall(north, { a0: -30.25, a1: -19.75, at: 20, alongZ: true, h: H, mat: 'stone', gaps: [[-28.5, -25.5, 0, 3.2]] });
  // Upper floor slab with stairwell openings at x ∈ [−18.5, −11] and [11, 18.5], z ∈ [−24.2, −22.6].
  north.push(span(-19.75, -29.75, 19.75, -24.2, 3.7, 4, 'timber'));
  north.push(span(-11, -24.2, 11, -20.25, 3.7, 4, 'timber'));
  north.push(span(-19.75, -24.2, -18.5, -20.25, 3.7, 4, 'timber'), span(18.5, -24.2, 19.75, -20.25, 3.7, 4, 'timber'));
  north.push(span(-18.5, -22.6, -11, -20.25, 3.7, 4, 'timber'), span(11, -22.6, 18.5, -20.25, 3.7, 4, 'timber'));
  stairs(north, { x: -11, z: -23.4, dir: '-x', width: 1.6, height: 4, mat: 'timber' });
  stairs(north, { x: 11, z: -23.4, dir: '+x', width: 1.6, height: 4, mat: 'timber' });
  // Railings around each stairwell, open at the top of the stairs.
  for (const m of [1, -1]) north.push(span(-17 * m, -22.6, -11 * m, -22.45, 4, 5, 'rail', { thin: true }), span(-17 * m, -24.35, -11 * m, -24.2, 4, 5, 'rail', { thin: true }), span(-11.15 * m, -24.2, -11 * m, -22.6, 4, 5, 'rail', { thin: true }));
  // Balcony railing with a gap in the middle and pillars carrying the roof.
  north.push(span(-19.75, -20.2, -3, -19.9, 4, 5, 'rail', { thin: true }), span(3, -20.2, 19.75, -19.9, 4, 5, 'rail', { thin: true }));
  for (const x of [-19.5, -10, 10, 19.5]) north.push(box(x, -20.05, .6, .6, 4, 4, 'stone'));
  north.push(span(-20.5, -30.5, 20.5, -19.5, 8, 8.4, 'roof'));
  // Upper-floor interior: classroom desks as cover, lower ground-floor desks too.
  for (const x of [-15, -7, 7, 15]) north.push(box(x, -27, 2.4, .8, .8, 4, 'timber'));
  for (const x of [-9, 0, 9]) north.push(box(x, -26.5, 2.4, .9, 1, 0, 'timber'));
  north.push(box(-3.5, -23, .8, .8, 3.7, 0, 'stone'), box(3.5, -23, .8, .8, 3.7, 0, 'stone'));
  // ---------------- the quad: fountain, hedges, benches, lawn walls
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, x = Math.cos(a) * 4.2, z = Math.sin(a) * 4.2;
    centre.push(box(x, z, 2.2, 2.2, .9, 0, 'stone'));
  }
  centre.push(box(0, 0, 1.6, 1.6, 2.2, 0, 'bronze'));
  half.push(box(-12, -10, 6, .8, 1.1, 0, 'hedge'), box(-12, 10, 6, .8, 1.1, 0, 'hedge'), box(-8, -4, .8, 4, 1.1, 0, 'hedge'), box(-8, 5, .8, 3, 1.1, 0, 'hedge'));
  half.push(box(-16, 0, 2, .6, .55, 0, 'timber'), box(-5, -14, 2, .6, .55, 0, 'timber'), box(-5, 14, 2, .6, .55, 0, 'timber'));
  half.push(box(-14, -16, 1.4, 1.4, 1.4, 0, 'stone'), box(-14, 16, 1.4, 1.4, 1.4, 0, 'stone'));
  // ---------------- west arcade (objective A sits under it) and the west gate
  for (const z of [-14, -9, -4, 4, 9, 14]) half.push(box(-24, z, .8, .8, 4.2, 0, 'stone'));
  half.push(span(-26, -15, -22, 15, 4.2, 4.5, 'roof'));
  half.push(span(-26.2, -15, -25.8, -5, 0, 1, 'stone'), span(-26.2, 5, -25.8, 15, 0, 1, 'stone'));
  wall(half, { a0: -34, a1: 34, at: -30, alongZ: true, h: 3, mat: 'stone', gaps: [[-18, -12], [-3, 3], [12, 18]] });
  half.push(box(-32.5, -9, 2.4, 2.4, 1.3, 0, 'crate'), box(-32.5, 9, 2.4, 2.4, 1.3, 0, 'crate'));
  half.push(box(-20, -17.5, 1.2, 1.2, 1.2, 0, 'crate'), box(-20, 17.5, 1.2, 1.2, 1.2, 0, 'crate'));
  const northAll = [...north];
  const boxes = [...centre, ...northAll, ...northAll.map(mirrorZ), ...half, ...half.map(mirrorX)];
  return {
    id: 'quad', name: 'Sim Quad', blurb: 'A simulated campus quadrangle: two-storey teaching blocks with balconies, a fountain court and shaded arcades.',
    bounds: [-36, -34, 36, 34], boxes,
    palette: { sky: '#86a9c9', horizon: '#f2d9a6', fog: '#d8cdb6', ground: '#6f8a5c', sun: '#ffd9a0', ambient: '#c6c2b4', sunDir: [.5, .75, .42] },
    objectives: [{ id: 'A', x: -24, y: 0, z: 0, r: 3.6 }, { id: 'B', x: 0, y: 0, z: 9, r: 3.6 }, { id: 'C', x: 24, y: 0, z: 0, r: 3.6 }],
    spawns: spawnSet([[-33.5, -24], [-33.5, -15], [-33.5, -5], [-33.5, 5], [-33.5, 15], [-33.5, 24], [-28, -31], [-28, 31]], [[-26, -24], [-20, -12], [-20, 12], [-26, 24], [-10, 0]]),
  };
}

/** Team 0 spawns west facing east; team 1 gets the mirrored points facing west. `forward` points are used in Domination when the team holds the nearby objective. */
function spawnSet(base, forward) {
  const out = [];
  for (const [x, z] of base) { out.push({ x, z, yaw: -Math.PI / 2, team: 0, forward: false }, { x: -x, z, yaw: Math.PI / 2, team: 1, forward: false }); }
  for (const [x, z] of forward) { out.push({ x, z, yaw: -Math.PI / 2, team: 0, forward: true }, { x: -x, z, yaw: Math.PI / 2, team: 1, forward: true }); }
  return out;
}

export const MAPS = [foundry(), quad()];
export const MAP_BY_ID = new Map(MAPS.map(m => [m.id, m]));
