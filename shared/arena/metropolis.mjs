// OPERATION: METROPOLIS — the Combat Arena's flagship map: a district of Okun Bay, a fictional contemporary
// West African coastal city. Five connected districts on one 120 × 88 m site:
//
//   DOWNTOWN (north)     Marina Avenue between the north block (Marina House, the Atlantic Grill, the arcade under
//                        Okun Tower) and the Balogun Arcade shops. Close to medium range.
//   ROOFTOPS             The north block's roofs at +7 m: water tanks, plant, stair heads, a fire escape in each alley,
//                        walkways across the alleys and the tower podium. Long range over the avenue only.
//   UNDERGROUND TRANSIT  Plaza Station beneath the plaza: two platforms either side of the track, corridors north to
//                        the avenue and south to the port road, a service corridor and a car park. Close quarters.
//   INDUSTRIAL (south)   Harbour Road, two warehouses with mezzanines, the container yard and the quay.
//   CENTRAL PLAZA        The Okun Spire, the ring fountain, kiosks, lawns and the station entrances; overlooked by
//                        the Balogun Arcade gallery and the bridge across the plaza gate.
//
// Like every arena map it is made of axis-aligned boxes shared by the server, the client's prediction and the
// renderer, and it is a mirror image across x = 0 (team 0 deploys west, team 1 east). The physics ground plane is
// y = 0, so the street is raised: street level is y = 5 (the tops of the ground boxes), station floors are y = 1
// and the track bed is y = 0.
//
// Three lanes run west–east (avenue, plaza, port road). The station is a fourth beneath the middle, and the
// roofs a fifth above the north. Domination's zones sit on the centre line, one per lane (A the tower arcade,
// B the fountain, C the container yard), so both teams are exactly as far from each.

export const STREET = 5, STATION = 1, SLAB = .6;
const L = STREET, U = STATION;
const X = 60, Z = 44;

const S = (x0, z0, x1, z1, y0, y1, mat, extra = {}) => ({ min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)], mat, ...extra });
/** A box by centre and size, standing on `y`. */
const B = (x, z, w, d, h, y, mat, extra = {}) => S(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y, y + h, mat, extra);
const mirror = b => ({ ...b, min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] });
const r3 = v => Math.round(v * 1000) / 1000;

/**
 * A straight wall along x at z = `at` (or along z at x = `at` with alongZ), standing on `y`, `h` tall. Openings are
 * [from, to, bottom, top, kind]: bottom/top are heights above `y` (a door starts at 0; a window leaves wall below
 * and above). kind: 'door' | 'window' | 'shop' (a display window) | 'roller' | 'open'. Windows and shop fronts are
 * glazed: their panes go to `glass` (render and server-side breaking; never collision).
 */
function wall(m, { a0, a1, at, y = L, h, t = .4, alongZ = false, gaps = [], mat }) {
  const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
  let cursor = a0;
  const piece = (p0, p1, b0, b1) => { if (p1 - p0 < 1e-3 || b1 - b0 < 1e-3) return; m.boxes.push(alongZ ? S(at - t / 2, p0, at + t / 2, p1, y + b0, y + b1, mat) : S(p0, at - t / 2, p1, at + t / 2, y + b0, y + b1, mat)); };
  for (const [g0, g1, gb = 0, gt = h, kind = gb > 0 ? 'window' : 'door'] of sorted) {
    const frame = alongZ ? S(at - t / 2, g0, at + t / 2, g1, y + gb, y + gt, 'frame') : S(g0, at - t / 2, g1, at + t / 2, y + gb, y + gt, 'frame');
    m.deco.push({ ...frame, kind, alongZ, wall: mat });
    if (kind === 'window' || kind === 'shop') m.glass.push({ min: frame.min, max: frame.max, alongZ });
    piece(cursor, g0, 0, h); piece(g0, g1, 0, gb); piece(g0, g1, gt, h);
    cursor = Math.max(cursor, g1);
  }
  piece(cursor, a1, 0, h);
}

/**
 * Stairs climbing from `from` to `to` (rise .25 m, run .5 m), starting at the foot (x, z) and heading `dir`.
 * Solid by default; `open` makes steel treads with space beneath. `rail` adds thin guard rails on one or both sides.
 */
function stairs(m, { x, z, dir, width, from, to, mat = 'stair', open = false, rail = '' }) {
  const n = Math.round((to - from) / .25), w = width / 2;
  for (let k = 1; k <= n; k++) {
    const a = (k - 1) * .5, top = from + k * .25, y0 = open ? top - .25 : from;
    const along = dir === '+x' ? [x + a, x + a + .5] : dir === '-x' ? [x - a - .5, x - a] : dir === '+z' ? [z + a, z + a + .5] : [z - a - .5, z - a];
    const alongX = dir.endsWith('x');
    m.boxes.push(alongX ? S(along[0], z - w, along[1], z + w, y0, top, mat, { stair: true }) : S(x - w, along[0], x + w, along[1], y0, top, mat, { stair: true }));
    if (rail && k % 2 === 0) for (const side of rail === 'both' ? [-1, 1] : [rail === 'left' ? -1 : 1]) {
      // One rail piece per two steps, on the outside edge. "left"/"right" are −/+ across the direction's axis.
      const c = (alongX ? z : x) + side * (w - .04), p0 = Math.min(along[0], along[1]) - (dir.startsWith('+') ? .5 : 0), p1 = p0 + 1;
      m.boxes.push(alongX ? S(p0, c - .04, p1, c + .04, top, top + 1, 'rail', { thin: true }) : S(c - .04, p0, c + .04, p1, top, top + 1, 'rail', { thin: true }));
    }
  }
}

/** A floor slab over a rectangle with rectangular holes (stairwells). */
function slab(m, x0, z0, x1, z1, y0, y1, mat, holes = []) {
  const xs = [...new Set([x0, x1, ...holes.flatMap(h => [h[0], h[2]])])].filter(v => v >= x0 && v <= x1).sort((a, b) => a - b);
  const zs = [...new Set([z0, z1, ...holes.flatMap(h => [h[1], h[3]])])].filter(v => v >= z0 && v <= z1).sort((a, b) => a - b);
  for (let j = 0; j < zs.length - 1; j++) {
    let run = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2, hole = holes.some(h => cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3]);
      if (hole) { if (run) { m.boxes.push(S(run[0], zs[j], run[1], zs[j + 1], y0, y1, mat)); run = null; } }
      else run = run ? [run[0], xs[i + 1]] : [xs[i], xs[i + 1]];
    }
    if (run) m.boxes.push(S(run[0], zs[j], run[1], zs[j + 1], y0, y1, mat));
  }
}

// ====================================================================================== the ground
// Street surfaces of the west half, later entries on top. Everything not listed is yard concrete.
const SURFACES = [
  [-60, -32, 0, -29, 'st-sidewalk'], [-60, -29, 0, -21, 'st-asphalt'], [-60, -21, 0, -18, 'st-sidewalk'],
  [-60, -18, -50, 17, 'st-sidewalk'], [-50, -18, -44, 11, 'st-asphalt'],
  [-60, 11, 0, 17, 'st-asphalt'], [-44, 17, -13, 21, 'st-sidewalk'],
  [-44, -11, -28, -7, 'st-pavers'], [-44, 7, -28, 11, 'st-pavers'], [-39, -18, -36, -11, 'st-pavers'],
  [-28, -11, 0, 11, 'st-plaza'], [-8, -18, 0, -11, 'st-plaza'], [-6, -38, 0, -32, 'st-plaza'],
  [-27, 3, -21.5, 9.5, 'st-grass'],
  [-26, -43, -22, -32, 'st-yard'],
  // Interiors (the finish of each building's ground floor).
  [-46, -43, -26, -32, 'st-tile'], [-22, -43, -6, -32, 'st-tile'], [-36, -18, -8, -11, 'st-tile'], [-44, -7, -28, 7, 'st-marble'],
  [-42, 21, -14, 39, 'st-screed'],
];
// Station spaces of the west half: [x0, z0, x1, z1, floor level, floor material, open to the sky?].
const STATION_SPACES = [
  [-34, -9, 0, 1.5, U, 'ug-tile', false],        // north platform and concourse
  [-46, 1.5, 0, 5.5, 0, 'ug-track', false],      // the track (and the tunnel beyond the platforms)
  [-34, 5.5, 0, 9, U, 'ug-tile', false],         // south platform
  [-34, -21.5, -30, -9, U, 'ug-concrete', false],// north corridor (to the avenue)
  [-34, 9, -30, 21.5, U, 'ug-concrete', false],  // south corridor (to the port road)
  [-48, 10, -34, 22, U, 'ug-concrete', false],   // car park
  [-30, -14.5, -14, -12.5, U, 'ug-concrete', false], [-16, -12.5, -14, -9, U, 'ug-concrete', false], // service corridor
  [-30, -20.7, -22, -18.3, U, 'ug-tile', true],  // avenue entrance
  [-30, 17, -22, 19.4, U, 'ug-tile', true],      // port road entrance
  [-20, -8.6, -12, -6.2, U, 'ug-tile', true],    // plaza entrance
];

/** Ground boxes for the west half: solid where there is no station, a slab over the station, floors below. */
function ground(m) {
  const xs = new Set([-X, 0]), zs = new Set([-Z, Z]);
  for (const r of [...SURFACES, ...STATION_SPACES]) { xs.add(Math.max(-X, r[0])); xs.add(Math.min(0, r[2])); zs.add(r[1]); zs.add(r[3]); }
  const ax = [...xs].sort((a, b) => a - b), az = [...zs].sort((a, b) => a - b);
  const keyAt = (cx, cz) => {
    let surface = 'st-yard', space = null;
    for (const r of SURFACES) if (cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) surface = r[4];
    for (const r of STATION_SPACES) if (cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) space = r;
    return space ? `${surface}|${space[4]}|${space[5]}|${space[6] ? 1 : 0}` : surface;
  };
  // Runs along x, then identical runs merged along z.
  let open = new Map();
  const emit = (x0, x1, z0, z1, key) => {
    const [surface, floor, floorMat, sky] = key.split('|');
    if (floor === undefined) { m.boxes.push(S(x0, z0, x1, z1, 0, L, surface)); return; }
    if (+floor > 0) m.boxes.push(S(x0, z0, x1, z1, 0, +floor, floorMat));
    if (sky !== '1') m.boxes.push(S(x0, z0, x1, z1, L - SLAB, L, surface));
  };
  for (let j = 0; j < az.length - 1; j++) {
    const runs = new Map();
    let cur = null;
    for (let i = 0; i < ax.length - 1; i++) {
      const key = keyAt((ax[i] + ax[i + 1]) / 2, (az[j] + az[j + 1]) / 2);
      if (cur && cur.key === key) cur.x1 = ax[i + 1]; else { if (cur) runs.set(`${cur.x0}|${cur.x1}|${cur.key}`, cur); cur = { x0: ax[i], x1: ax[i + 1], key }; }
    }
    if (cur) runs.set(`${cur.x0}|${cur.x1}|${cur.key}`, cur);
    const next = new Map();
    for (const [id, r] of runs) { const prev = open.get(id); if (prev) { prev.z1 = az[j + 1]; next.set(id, prev); open.delete(id); } else next.set(id, { ...r, z0: az[j], z1: az[j + 1] }); }
    for (const r of open.values()) emit(r.x0, r.x1, r.z0, r.z1, r.key);
    open = next;
  }
  for (const r of open.values()) emit(r.x0, r.x1, r.z0, r.z1, r.key);
}

// ====================================================================================== the west half
function westHalf() {
  const m = { boxes: [], deco: [], glass: [], lamps: [], arch: [] };
  const add = (...b) => m.boxes.push(...b);
  ground(m);

  // ---------------------------------------------------------------- edges of the site
  add(S(-60, -44, -59, 44, L, L + 12, 'bld-back'));                         // the street wall behind the west deployment
  add(S(-59, -43, -46, -32, L, L + 24, 'bld-tower'));                       // north-west corner block (Lekan Court)
  add(S(-59, 43, 0, 44, L, L + 1.1, 'quay'));                               // the quay wall: the sea is beyond it

  // ---------------------------------------------------------------- DOWNTOWN: the north block
  // Marina House (x −46…−26): shops below, offices above, stairs to the roof.
  const y1 = L + 3.5, roof = L + 7;
  wall(m, { a0: -46, a1: -26, at: -32.2, h: 3.5, mat: 'bld-render', gaps: [[-44.5, -42, .8, 2.8, 'shop'], [-41, -39], [-37.5, -33.5, .8, 2.8, 'shop'], [-31.5, -28, .8, 2.8, 'shop']] });
  wall(m, { a0: -46, a1: -26, at: -32.2, y: y1, h: 3.5, mat: 'bld-render', gaps: [[-44, -42, .9, 2.4], [-39.5, -36.5, .9, 2.4], [-34, -31, .9, 2.4], [-29.5, -27.5, .9, 2.4]] });
  wall(m, { a0: -43, a1: -32, at: -26.2, alongZ: true, h: 3.5, mat: 'bld-render', gaps: [[-37.5, -35.8]] });
  wall(m, { a0: -43, a1: -32, at: -26.2, alongZ: true, y: y1, h: 3.5, mat: 'bld-render', gaps: [[-39, -37, .9, 2.4]] });
  slab(m, -46, -43, -26.4, -32.4, y1 - .3, y1, 'floor-timber', [[-43, -43, -36, -41.2]]);
  stairs(m, { x: -36, z: -42, dir: '-x', width: 1.6, from: L, to: y1, mat: 'stair-concrete', rail: 'right' });
  slab(m, -46, -43, -26, -32, roof - .3, roof, 'roof-deck', [[-46, -40, -44.2, -33]]);
  stairs(m, { x: -45, z: -40, dir: '+z', width: 1.6, from: y1, to: roof, mat: 'stair-concrete' });
  // Stair head on the roof, parapets, plant.
  add(S(-44.2, -40.2, -44, -35, roof, roof + 2.4, 'bld-render'), S(-46, -40.4, -44, -40, roof, roof + 2.4, 'bld-render'), S(-46.2, -40.4, -43.8, -34.8, roof + 2.4, roof + 2.6, 'roof-deck'));
  add(S(-44, -32.4, -27.4, -32, roof, roof + 1.1, 'parapet'), S(-26.4, -43, -26, -34.6, roof, roof + 1.1, 'parapet'), S(-27.4, -32.1, -26, -32, roof, roof + 1, 'rail', { thin: true }));
  add(B(-40, -39.5, 1.7, 1.7, 2.5, roof, 'tank'), B(-37.6, -39.5, 1.7, 1.7, 2.5, roof, 'tank'), B(-33, -35, 1.4, 1, 1.15, roof, 'ac'), B(-30.5, -40.5, 2.2, 1.4, 1.5, roof, 'vent'), B(-29, -35.2, 1.4, 1, 1.15, roof, 'ac'));
  // Ground-floor shop, first-floor office.
  add(B(-35.5, -37, 4, .9, 1.1, L, 'counter'), B(-29, -40, .6, 3.2, 2.1, L, 'shelf'), B(-43, -36, .6, 3.2, 2.1, L, 'shelf'));
  add(B(-39, -36, 1.7, .85, .78, y1, 'desk'), B(-33, -38.5, 1.7, .85, .78, y1, 'desk'), B(-30, -34.5, .5, 2.4, 1.9, y1, 'cabinet'), B(-36, -34.2, 2.2, .5, 1.5, y1, 'partition', { thin: true }));

  // The alley (x −26…−22): a fire escape to the roofs and a walkway across at roof level.
  stairs(m, { x: -25.3, z: -33.5, dir: '-z', width: 1.4, from: L, to: y1, mat: 'stair-steel', open: true, rail: 'right' });
  add(S(-26, -42.6, -22, -40.5, y1 - .25, y1, 'grate'), S(-26, -42.7, -22, -42.6, y1, y1 + 1, 'rail', { thin: true }));
  stairs(m, { x: -22.7, z: -40.5, dir: '+z', width: 1.4, from: y1, to: roof, mat: 'stair-steel', open: true, rail: 'left' });
  add(S(-26, -33.5, -22, -32, roof - .25, roof, 'grate'), S(-26, -32.1, -22, -32, roof, roof + 1, 'rail', { thin: true }));
  add(B(-23.1, -41.9, 1.2, 1, 1.3, L, 'bin'), B(-24.6, -42.2, 1, .8, 1.2, L, 'bin'));

  // The Atlantic Grill (x −22…−6): a restaurant below; the floor above is closed.
  wall(m, { a0: -22, a1: -6, at: -32.2, h: 3.5, mat: 'bld-brick', gaps: [[-20.5, -16.5, .8, 2.8, 'shop'], [-15, -13], [-11.5, -7.5, .8, 2.8, 'shop']] });
  wall(m, { a0: -43, a1: -32, at: -21.8, alongZ: true, h: 3.5, mat: 'bld-brick', gaps: [[-37.5, -35.8]] });
  wall(m, { a0: -43, a1: -38, at: -6.2, alongZ: true, h: 3.5, mat: 'bld-brick' });
  wall(m, { a0: -38, a1: -32, at: -6.2, alongZ: true, h: 3.5, mat: 'bld-brick', gaps: [[-36.5, -34.6]] });
  add(S(-22, -43, -6, -32, y1 - .3, roof, 'bld-brick-upper'));
  add(S(-20.6, -32.4, -6, -32, roof, roof + 1.1, 'parapet'), S(-22, -43, -21.6, -34.6, roof, roof + 1.1, 'parapet'), S(-22, -32.1, -20.6, -32, roof, roof + 1, 'rail', { thin: true }));
  wall(m, { a0: -22, a1: -6, at: -39.2, h: 3.2, t: .25, mat: 'partition-wall', gaps: [[-12, -10.4, 0, 2.3]] });
  add(B(-18.5, -37, .8, 3, 1.1, L, 'counter'), B(-15, -35.3, 1.2, 1.2, .76, L, 'table'), B(-11, -36.6, 1.2, 1.2, .76, L, 'table'), B(-9.5, -33.8, 1.2, 1.2, .76, L, 'table'), B(-17, -41.2, 3, 1, .95, L, 'counter'), B(-8.4, -41.4, 1.6, .9, 1.9, L, 'cabinet'));
  add(B(-18, -39, 2.2, 1.4, 1.5, roof, 'vent'), B(-12, -36, 1.4, 1, 1.15, roof, 'ac'), B(-9, -40, 1.7, 1.7, 2.5, roof, 'tank'));

  // ---------------------------------------------------------------- DOWNTOWN: Marina Avenue
  add(B(-31.5, -27.72, 9.4, 2.55, 3.1, L, 'bus'));                           // a city bus at its stop
  add(B(-16.5, -22.15, 6.4, 2.3, 2.9, L, 'van'));                            // a delivery truck unloading
  add(B(-42, -22.7, 4.3, 1.8, 1.45, L, 'car'), B(-9.5, -27.4, 4.3, 1.8, 1.45, L, 'car'));
  add(S(-25, -25.35, -11.5, -24.65, L, L + .85, 'planter'));                   // the planted median
  add(B(-38, -30.4, 3.4, 1.3, 2.5, L, 'shelter'));                          // bus shelter
  add(B(-47.5, -30.5, 2.4, 2.2, 2.7, L, 'kiosk'), B(-19.5, -30.5, 2.4, 2.3, 2.7, L, 'kiosk'));                          // newsstand
  add(B(-21, -30.6, .5, .5, 1.1, L, 'bollard'), B(-6.8, -19.4, 1.1, .9, 1.25, L, 'utility'), B(-45.6, -19.6, 1, .8, 1.2, L, 'bin'));
  // The avenue entrance to Plaza Station: guard walls round the stairwell, steps down to the west.
  add(S(-30.25, -20.95, -22, -20.7, L, L + 1.05, 'stone-wall'), S(-30.25, -18.3, -22, -18.05, L, L + 1.05, 'stone-wall'), S(-30.25, -20.95, -30, -18.05, L, L + 2.8, 'headhouse'));
  stairs(m, { x: -30, z: -19.5, dir: '+x', width: 2.4, from: U, to: L, mat: 'stair-stone' });

  // ---------------------------------------------------------------- DOWNTOWN / PLAZA: the Balogun Arcade
  // Shops on the ground floor between the avenue and the plaza, a gallery above that continues across the plaza gate.
  const g1 = L + 3.5, gTop = L + 7.3;
  add(S(-44, -18, -39, -11, L, gTop, 'bld-panel'));                         // corner unit (closed)
  wall(m, { a0: -18, a1: -11, at: -35.8, alongZ: true, h: 3.2, mat: 'bld-panel' });
  wall(m, { a0: -36, a1: -8, at: -17.8, h: 3.2, mat: 'bld-panel', gaps: [[-27, -24, .8, 2.7, 'shop'], [-21, -19], [-17.5, -14.5, .8, 2.7, 'shop'], [-13, -11]] });
  wall(m, { a0: -36, a1: -8, at: -11.2, h: 3.2, mat: 'bld-panel', gaps: [[-34.5, -30.5, .8, 2.7, 'shop'], [-24.5, -22.5], [-19.5, -15.5, .8, 2.7, 'shop'], [-12.5, -9.5, .8, 2.7, 'shop']] });
  wall(m, { a0: -18, a1: -11, at: -8.2, alongZ: true, h: 3.2, mat: 'bld-panel', gaps: [[-15.6, -13.8]] });
  wall(m, { a0: -17.6, a1: -11.4, at: -22, alongZ: true, h: 3.2, t: .25, mat: 'partition-wall', gaps: [[-13.6, -11.9, 0, 2.3]] });
  slab(m, -39, -18, 0, -11, g1 - .3, g1, 'floor-timber', [[-35.5, -17.6, -28.5, -16]]);
  stairs(m, { x: -28.5, z: -16.8, dir: '-x', width: 1.6, from: L, to: g1, mat: 'stair-concrete', rail: 'right' });
  add(S(-34.5, -16, -28.5, -15.92, g1, g1 + 1, 'rail', { thin: true }), S(-28.5, -17.6, -28.42, -16, g1, g1 + 1, 'rail', { thin: true }));
  // The gallery (and the west half of the bridge over the gate).
  wall(m, { a0: -39, a1: 0, at: -17.8, y: g1, h: 3.5, mat: 'bld-panel', gaps: [[-33.5, -31.5, .9, 2.3], [-25, -22.5, .9, 2.3], [-17, -14.5, .9, 2.3], [-5.5, -2.5, .9, 2.3]] });
  wall(m, { a0: -39, a1: 0, at: -11.2, y: g1, h: 3.5, mat: 'bld-panel', gaps: [[-35, -32.5, .9, 2.3], [-27, -24.5, .9, 2.3], [-19, -16.5, .9, 2.3], [-12, -9.5, .9, 2.3], [-5.5, -2.5, .9, 2.3]] });
  wall(m, { a0: -18, a1: -11, at: -38.8, alongZ: true, y: g1, h: 3.5, mat: 'bld-panel' });
  add(S(-39, -18, 0, -11, gTop - .3, gTop, 'roof-deck'), S(-39, -18, 0, -17.6, gTop, gTop + .7, 'parapet'), S(-39, -11.4, 0, -11, gTop, gTop + .7, 'parapet'));
  add(B(-30.5, -13.2, 3.2, .8, 1.1, L, 'counter'), B(-25.5, -14.2, .6, 2.6, 2.1, L, 'shelf'), B(-17, -14.6, 2.6, .8, 1.1, L, 'counter'), B(-12.2, -16.6, 2.6, .6, 2.1, L, 'shelf'));
  add(B(-30, -13.4, 1.7, .85, .78, g1, 'desk'), B(-21.5, -15.4, .5, 2.2, 1.9, g1, 'cabinet'), B(-14.5, -13.2, 1.7, .85, .78, g1, 'desk'), B(-7.2, -14.5, 1.6, .7, .9, g1, 'bench'));

  // ---------------------------------------------------------------- PLAZA: Okun Trust (west flank), lanes either side
  wall(m, { a0: -7, a1: 7, at: -43.8, alongZ: true, h: 4, mat: 'bld-stone', gaps: [[3.2, 5.2, 0, 2.8]] });
  wall(m, { a0: -7, a1: 7, at: -28.2, alongZ: true, h: 4, mat: 'bld-stone', gaps: [[-4.8, -2.8, 0, 2.8], [1.6, 4.6, .6, 3.2, 'shop']] });
  wall(m, { a0: -44, a1: -28, at: -6.8, h: 4, mat: 'bld-stone', gaps: [[-35, -33, 0, 2.8], [-41.5, -38, .9, 2.8]] });
  wall(m, { a0: -44, a1: -28, at: 6.8, h: 4, mat: 'bld-stone', gaps: [[-40.5, -37, .9, 2.8], [-33.5, -30.5, .9, 2.8]] });
  add(S(-44, -7, -28, 7, L + 4, L + 18, 'bld-glass-tower'));
  add(S(-36.4, -5.4, -35.6, 2.6, L, L + 1.15, 'counter'), S(-41.5, 2.4, -41.2, 6.2, L, L + 4, 'partition-wall'), B(-39, -2.4, .7, .7, 4, L, 'column'), B(-32, 1.6, .7, .7, 4, L, 'column'), B(-31, -.8, 2, .8, .8, L, 'sofa'), B(-42.9, -5.6, 1, .8, 1.9, L, 'atm'));

  // ---------------------------------------------------------------- CENTRAL PLAZA
  // Station entrance: guard walls on three sides, steps down to the east.
  add(S(-20.25, -8.85, -12, -8.6, L, L + 1.05, 'stone-wall'), S(-20.25, -6.2, -12, -5.95, L, L + 1.05, 'stone-wall'), S(-12, -8.85, -11.75, -5.95, L, L + 2.8, 'headhouse'));
  stairs(m, { x: -12, z: -7.4, dir: '-x', width: 2.4, from: U, to: L, mat: 'stair-stone' });
  add(B(-26.2, -9.8, 2.4, 2.4, 2.8, L, 'kiosk'), B(-26.2, 9.8, 2.4, 2.4, 2.8, L, 'kiosk'), B(-23.5, .2, 2.6, 2.6, .9, L, 'planter'), B(-23.5, .2, .5, .5, 4.6, L + .9, 'tree'), B(-9.5, -4.4, 2.6, 2.4, 2.8, L, 'kiosk'), B(-15.5, 3.1, 2.6, 3.4, 2.8, L, 'kiosk'));
  add(S(-21.6, 6.2, -21.2, 9.4, L, L + 2.6, 'art-wall'), B(-24.2, 6, .5, .5, 5.5, L, 'tree'), B(-13, -1.2, 2.2, 2.2, .9, L, 'planter'), B(-13, -1.2, .5, .5, 4.6, L + .9, 'tree'));
  add(B(-18.5, -2.2, 2, .6, .5, L, 'bench'), B(-10.5, 8.6, 2, .6, .5, L, 'bench'), B(-6, -9.4, 2.4, .9, .9, L, 'planter'));
  // The south edge: a low wall to the port road with openings.
  add(S(-23.5, 10.3, -11, 11, L, L + 2.1, 'hedge'), S(-7.5, 10.3, -2.5, 11, L, L + 2.1, 'hedge'));
  // Lanes: a little cover at each mouth.
  add(B(-37, -10.3, 1.2, .9, 1.25, L, 'bin'), B(-33.5, 10.2, 1.1, .9, 1.25, L, 'utility'), B(-45.2, 9.4, 1.4, 1.1, 1, L, 'barrier'));

  // ---------------------------------------------------------------- INDUSTRIAL: Harbour Road
  add(B(-18.5, 13.3, 11.5, 2.6, 3.9, L, 'truck'));                          // a container lorry waiting at the gate
  add(B(-38.5, 15.6, 5.2, 1.95, 1.9, L, 'pickup'), B(-8.2, 16.1, 1.6, 1.6, 1.2, L, 'crate'));
  add(S(-30.25, 16.75, -22, 17, L, L + 1.05, 'stone-wall'), S(-30.25, 19.4, -22, 19.65, L, L + 1.05, 'stone-wall'), S(-30.25, 16.75, -30, 19.65, L, L + 2.8, 'headhouse'));
  stairs(m, { x: -30, z: 18.2, dir: '+x', width: 2.4, from: U, to: L, mat: 'stair-stone' });

  // ---------------------------------------------------------------- INDUSTRIAL: Warehouse 4 (x −42…−14, z 21…39)
  const wh = 7, mz = L + 3.5;
  wall(m, { a0: -42, a1: -14, at: 21.2, h: wh, mat: 'bld-sheet', gaps: [[-38.5, -33.5, 0, 4.2, 'roller'], [-21, -16, 0, 4.2, 'roller']] });
  wall(m, { a0: -42, a1: -14, at: 38.8, h: wh, mat: 'bld-sheet' });
  wall(m, { a0: 21, a1: 39, at: -41.8, alongZ: true, h: wh, mat: 'bld-sheet', gaps: [[29.5, 31.6, 0, 2.6]] });
  wall(m, { a0: 21, a1: 39, at: -14.2, alongZ: true, h: wh, mat: 'bld-sheet', gaps: [[25.5, 29.5, 0, 4.2, 'roller'], [36, 37.3, 4.4, 5.6]] });
  add(S(-42.3, 20.7, -13.7, 39.3, L + wh, L + wh + .35, 'roof-sheet'));
  // Mezzanine along the south wall with a stair at each end.
  add(S(-41.6, 34.5, -14.4, 38.6, mz - .25, mz, 'grate'), S(-41.6, 32.9, -40.5, 34.5, mz - .25, mz, 'grate'), S(-15.5, 32.9, -14.4, 34.5, mz - .25, mz, 'grate'));
  stairs(m, { x: -33.5, z: 33.7, dir: '-x', width: 1.6, from: L, to: mz, mat: 'stair-steel', open: true, rail: 'left' });
  stairs(m, { x: -22.5, z: 33.7, dir: '+x', width: 1.6, from: L, to: mz, mat: 'stair-steel', open: true, rail: 'left' });
  add(S(-33.5, 34.42, -22.5, 34.5, mz, mz + 1, 'rail', { thin: true }));
  add(B(-28, 37, 2.4, 1.2, 1.2, mz, 'crate'), B(-36.5, 37.4, .5, 2, 1.9, mz, 'cabinet'), B(-19, 36.4, 1.7, .85, .78, mz, 'desk'));
  // The floor: racking, pallets, a forklift.
  add(B(-37.5, 26.6, 1.3, 6.4, 3.4, L, 'rack'), B(-30, 25.6, 1.3, 5.6, 3.4, L, 'rack'), B(-24.5, 27.8, 1.3, 5.6, 3.4, L, 'rack'));
  add(B(-33.5, 30.8, 1.6, 1.6, 1.2, L, 'crate'), B(-18, 24, 2.4, 1.6, 1.2, L, 'crate'), B(-18.5, 31.4, 1.3, 2.5, 2.1, L, 'forklift'), B(-27.4, 22.8, 1.2, 1.2, 1.2, L, 'crate'));

  // ---------------------------------------------------------------- INDUSTRIAL: the container yard and the quay
  add(B(-10.8, 23, 2.44, 6.06, 2.6, L, 'container-blue'), B(-5, 22.2, 6.06, 2.44, 2.6, L, 'container-red'), B(-5, 22.2, 6.06, 2.44, 2.6, L + 2.6, 'container-yellow'));
  add(B(-7.3, 30.6, 2.44, 6.06, 2.6, L, 'container-green'), B(-9, 37.4, 6.06, 2.44, 2.6, L, 'container-red'), B(-9, 37.4, 6.06, 2.44, 2.6, L + 2.6, 'container-blue'), B(-4.3, 37.6, 2.44, 6.06, 2.6, L, 'container-yellow'));
  add(B(-3.2, 27.6, 1.6, 1.6, 1.2, L, 'crate'), B(-11.6, 31.5, 1.2, 1.2, 1.2, L, 'crate'), B(-12.6, 41, .9, .9, .9, L, 'bollard'));
  add(S(-13.3, 18.4, -12.9, 21, L, L + 2.6, 'yard-wall'));
  // The south-west yard: the substation, parked lorries, fencing.
  wall(m, { a0: -58, a1: -51, at: 35.2, h: 3.2, mat: 'bld-block', gaps: [[-55.5, -53.8, 0, 2.4]] });
  wall(m, { a0: 35, a1: 42, at: -51.2, alongZ: true, h: 3.2, mat: 'bld-block', gaps: [[37.4, 39.4, 1, 2.2]] });
  add(S(-59, 42, -51, 43, L, L + 3.2, 'bld-block'), S(-59, 35, -51, 43, L + 3.2, L + 3.5, 'roof-deck'), B(-56.6, 39.8, 1.4, 2.4, 1.9, L, 'switchgear'));
  add(B(-47, 26, 2.6, 8.5, 3.6, L, 'truck'), B(-46.5, 37.4, 2.44, 6.06, 2.6, L, 'container-green'), B(-52.6, 28.4, 1.6, 1.6, 1.2, L, 'crate'));
  add(S(-44.1, 40.6, -43.7, 43, L, L + 2.6, 'yard-wall'), B(-30, 41.4, 3, 1.2, 1.2, L, 'crate'), B(-20, 41.2, .9, .9, .9, L, 'bollard'), B(-36, 41.2, .9, .9, .9, L, 'bollard'));

  // ---------------------------------------------------------------- street lighting and palms (slim, but solid)
  for (const [x, z] of [[-42, -29.3], [-27, -29.3], [-12, -29.3], [-35, -20.7], [-10, -20.7], [-42, 17.3], [-16, 17.3], [-20.6, -4.6], [-7.5, 7.2], [-44.6, 0], [-47, 39.6], [-26, 40.4]]) add(B(x, z, .22, .22, 6, L, 'lamppost'));
  for (const x of [-22.5, -18, -13.5]) add(B(x, -25, .42, .42, 6.5, L + .85, 'palm'));
  add(B(-6, -9.4, .42, .42, 6.5, L + .9, 'palm'), B(-57.6, -13.5, .42, .42, 6.5, L, 'palm'), B(-57.6, 14, .42, .42, 6.5, L, 'palm'));

  // ---------------------------------------------------------------- the west deployment (walls that close the lanes' sightlines)
  add(S(-50.4, -29, -50, -18.2, L, L + 3, 'hoarding'));
  // Marina Interchange: the canopy over the avenue's west end (nobody on a roof can see under it).
  add(S(-59, -32, -44.5, -18.2, L + 3.5, L + 3.75, 'canopy'));
  wall(m, { a0: -32, a1: -18.2, at: -44.5, alongZ: true, h: 3.5, mat: 'bld-terminal', gaps: [[-31.6, -29.4, 0, 2.6, 'open'], [-26.6, -23.4, 0, 3.2, 'open']] });
  for (const [x, z] of [[-57, -29.4], [-57, -20.6]]) add(B(x, z, .45, .45, 3.5, L, 'column'));
  add(S(-51.2, -18, -50.8, -6.5, L, L + 3, 'hoarding'), S(-51.2, -1.5, -50.8, 1.5, L, L + 3, 'hoarding'), S(-51.2, 6.5, -50.8, 24.5, L, L + 3, 'hoarding'), S(-51.2, 28.5, -50.8, 35, L, L + 3, 'hoarding'), S(-54.2, -9.2, -53.8, 7.5, L, L + 3, 'hoarding'));
  add(S(-57.6, -9.2, -51.2, -8.8, L, L + 3, 'hoarding'), S(-55.6, 9.3, -51.2, 9.7, L, L + 3, 'hoarding'), S(-59, 18.8, -54.2, 19.2, L, L + 3, 'hoarding'), S(-55.4, -18.2, -50.4, -17.8, L, L + 3, 'hoarding'));
  add(B(-56.5, -7.6, 2.4, 1.6, 1.2, L, 'crate'), B(-52.5, 0, 1, 2.6, 1, L, 'barrier'), B(-55, 21.5, 3, 1, 1, L, 'barrier'), B(-54, -19.5, 1, 3, 1, L, 'barrier'));

  // ---------------------------------------------------------------- UNDERGROUND TRANSIT: Plaza Station
  const ceil = L - SLAB;
  for (const x of [-28, -20, -12, -4]) add(B(x, -2.6, .8, .8, ceil - U, U, 'ug-column'));
  for (const x of [-26, -14, -2.5]) add(B(x, 7.4, .6, .6, ceil - U, U, 'ug-column'));
  add(B(-24.5, -7.2, 3, 2, 2.5, U, 'kiosk'), B(-31.4, -5, .9, 1.1, 1.95, U, 'vending'), B(-7, -8.3, 1.1, .9, 1.95, U, 'vending'));
  for (const x of [-24, -16, -8]) add(B(x, .2, 2, .6, .5, U, 'bench'));
  add(B(-20, 8.2, 2, .6, .5, U, 'bench'), B(-8, 8.2, 2, .6, .5, U, 'bench'));
  // Fare gates between the concourse and the platform (low, with gaps).
  for (const x of [-10.2, -8.8, -7.4, -6]) add(B(x, -4.6, .3, 1.5, 1.05, U, 'faregate'));
  add(S(-12, -4.75, -10.5, -4.45, U, U + 1.05, 'rail', { thin: true }), S(-5.7, -4.75, -4.4, -4.45, U, U + 1.05, 'rail', { thin: true }));
  // Steps out of the track bed (north and south), so nobody is trapped down there.
  for (const x of [-30, -15]) { add(S(x - 1, 1.5, x + 1, 2.5, 0, .5, 'stair-concrete', { stair: true }), S(x - 1, 4.5, x + 1, 5.5, 0, .5, 'stair-concrete', { stair: true })); }
  // The tunnel is closed to people a little way in.
  add(S(-38.4, 1.5, -38, 5.5, 0, ceil, 'void'));
  // Service corridor: a door at each end.
  wall(m, { a0: -14.5, a1: -12.5, at: -29.8, alongZ: true, y: U, h: ceil - U, t: .3, mat: 'ug-wall', gaps: [[-14.2, -12.8, 0, 2.2]] });
  wall(m, { a0: -16, a1: -14, at: -9.2, y: U, h: ceil - U, t: .3, mat: 'ug-wall', gaps: [[-15.7, -14.3, 0, 2.2]] });
  add(B(-22, -13.1, 1.6, .8, 1.2, U, 'crate'));
  // Corridors and the car park.
  add(B(-33.2, -14, .9, 1.1, 1.95, U, 'vending'), B(-30.8, 13.5, .8, 2, 1.2, U, 'crate'));
  for (const [x, z] of [[-41, 13.5], [-41, 18.5]]) add(B(x, z, .7, .7, ceil - U, U, 'ug-column'));
  add(B(-44.6, 12.2, 1.85, 4.4, 1.45, U, 'car'), B(-37.6, 19.6, 1.85, 4.4, 1.45, U, 'car'), B(-45.4, 19, 4.6, 1.9, 1.9, U, 'pickup'), B(-37, 11.2, 1.2, .9, 1.2, U, 'utility'));

  return m;
}

// ====================================================================================== pieces on the centre line
function centre() {
  const m = { boxes: [], deco: [], glass: [], lamps: [], arch: [] };
  const add = (...b) => m.boxes.push(...b);
  add(S(-60, -44, 60, -43, L, L + 14, 'bld-back'));                         // the north street wall (rear of the block)
  // Okun Tower: an arcade under the podium, the shaft above (the landmark of the avenue).
  add(S(-6, -43, 6, -38, L, L + 7, 'bld-tower-base'), S(-6, -38, 6, -32, L + 4, L + 7, 'bld-tower-base'), S(-4.6, -43, 4.6, -37.4, L + 7, L + 46, 'bld-tower-shaft'));
  for (const x of [-5.5, 5.5]) add(B(x, -32.5, .9, .9, 4, L, 'column'));
  add(B(0, -32.5, .9, .9, 4, L, 'column'), S(-6, -32.4, 6, -32, L + 7, L + 8.1, 'parapet'));
  add(B(0, -36.15, 3, 2.5, 2.6, L + 7, 'plant'), B(-5, -33.85, 1.6, 2.9, 2.6, L + 7, 'plant'), B(5, -33.85, 1.6, 2.9, 2.6, L + 7, 'plant'));
  // The avenue's median bus station (in front of the arcade): a low platform, screens at both ends, a canopy.
  add(S(-9, -26.3, 9, -23.7, L, L + .3, 'brt-platform'), S(-9.2, -26.6, -8.8, -23.2, L, L + 2.9, 'brt-screen'), S(8.8, -26.6, 9.2, -23.2, L, L + 2.9, 'brt-screen'), S(-9.4, -26.7, 9.4, -23.3, L + 2.9, L + 3.1, 'brt-roof'));
  add(S(-3, -25.15, 3, -24.85, L + .3, L + 2.2, 'brt-screen'), B(-6, -25, 1.8, .5, .5, L + .3, 'bench'), B(6, -25, 1.8, .5, .5, L + .3, 'bench'));
  // The Okun Spire and the ring fountain.
  add(B(0, -7.2, 4.4, 4.4, .5, L, 'plinth'), B(0, -7.2, 1.9, 1.9, 17, L + .5, 'spire'));
  for (let k = 0; k < 8; k++) { const a = (k + .5) / 8 * Math.PI * 2; add(B(r3(Math.cos(a) * 5.4), r3(2.4 + Math.sin(a) * 5.4), 2.3, 2.3, .9, L, 'fountain-wall')); }
  // Port gate on Harbour Road, and the centre of the container yard.
  add(B(0, 11.9, 2.6, 1.8, 2.8, L, 'guardhouse'), B(0, 15.8, 11.5, 2.4, 3.9, L, 'truck'));
  add(B(0, 25.4, 6.06, 2.44, 2.6, L, 'container-green'), B(0, 36.6, 6.06, 2.44, 2.6, L, 'container-blue'), B(0, 41.6, 6.06, 2.44, 2.6, L, 'container-red'));
  // The station on the centre line.
  add(B(0, -6.2, 5, 3, L - SLAB - U, U, 'ug-room'));
  add(S(-1, 1.5, 1, 2.5, 0, .5, 'stair-concrete', { stair: true }), S(-1, 4.5, 1, 5.5, 0, .5, 'stair-concrete', { stair: true }));
  return m;
}

// ====================================================================================== assembly
/**
 * Buildings (west half and centre line; the east half mirrors them): footprint, floor and roof levels, the look of
 * the outside and whether people can go in. Render and sound only: collision is the boxes above.
 */
const BUILDINGS = [
  { id: 'marina', name: 'Marina House', x0: -46, z0: -43, x1: -26, z1: -32, y0: L, y1: L + 7, enter: true, fill: '#ffe9cf' },
  { id: 'grill', name: 'The Atlantic Grill', x0: -22, z0: -43, x1: -6, z1: -32, y0: L, y1: L + 3.2, enter: true, fill: '#ffd9a8' },
  { id: 'arcade', name: 'Balogun Arcade', x0: -39, z0: -18, x1: 0, z1: -11, y0: L, y1: L + 7, enter: true, fill: '#fff1dc' },
  { id: 'trust', name: 'Okun Trust', x0: -44, z0: -7, x1: -28, z1: 7, y0: L, y1: L + 4, enter: true, fill: '#f4efe4' },
  { id: 'warehouse', name: 'Warehouse 4', x0: -42, z0: 21, x1: -14, z1: 39, y0: L, y1: L + 7, enter: true, fill: '#dfe6ea' },
  { id: 'substation', name: 'Substation', x0: -59, z0: 35, x1: -51, z1: 43, y0: L, y1: L + 3.2, enter: true, fill: '#e8e2d2' },
  { id: 'terminal', name: 'Marina Interchange', x0: -59, z0: -32, x1: -44.5, z1: -18.2, y0: L, y1: L + 3.5, enter: true, fill: '#e6ecef' },
];

/** Team 0 deploys west facing east; team 1 gets the mirrored points. `forward` points serve a held Domination zone. */
function spawnSet(base, forward) {
  const out = [];
  for (const [list, fwd] of [[base, false], [forward, true]]) for (const [x, z, y = L] of list)
    out.push({ x, y, z, yaw: -Math.PI / 2, team: 0, forward: fwd }, { x: -x, y, z, yaw: Math.PI / 2, team: 1, forward: fwd });
  return out;
}

/** Lighting and weather variants. Competitive play always uses `day`; the others are chosen by a host. */
export const METROPOLIS_VARIANTS = [
  { id: 'day', name: 'Harmattan Noon', text: 'Clear daylight with a light dust haze.', competitive: true },
  { id: 'overcast', name: 'Rainy Season', text: 'Low cloud and steady rain. Softer light, wet streets.', competitive: false },
  { id: 'sunset', name: 'Lagoon Sunset', text: 'Low warm sun from the west, long shadows.', competitive: false },
  { id: 'night', name: 'Blue Hour', text: 'After dark: street lighting, shop fronts and signs.', competitive: false },
];

/** Districts, for the HUD callout, ambience and region streaming. */
export const DISTRICTS = [
  { id: 'downtown', name: 'Downtown', sub: 'Marina Avenue' },
  { id: 'rooftops', name: 'Rooftops', sub: 'North block roofs' },
  { id: 'underground', name: 'Underground Transit', sub: 'Plaza Station' },
  { id: 'industrial', name: 'Industrial Zone', sub: 'Port of Okun Bay' },
  { id: 'plaza', name: 'Central Plaza', sub: 'Okun Spire' },
];
/** The district a position is in. */
export function districtAt(x, y, z) {
  if (y < STREET - .8) return 'underground';
  if (z < -31 && y > STREET + 6) return 'rooftops';
  if (z < -18) return 'downtown';
  if (z > 11) return 'industrial';
  return Math.abs(x) < 44 ? (z < -11 && Math.abs(x) > 8 ? 'downtown' : 'plaza') : 'downtown';
}

/**
 * The train: it runs through Plaza Station on a fixed timetable (the same in every match, so it can be learned).
 * `at(ms since the match started)` gives the train's nose and tail along x, or null when it is away.
 */
export const TRAIN = {
  periodMs: 80000, firstMs: 45000, warnMs: 7000, speed: 17, length: 44, z0: 1.9, z1: 5.1, top: 3.6, from: -110, to: 110,
};
export function trainAt(ms, t = TRAIN) {
  if (ms < t.firstMs - t.warnMs) return null;
  const n = Math.floor((ms - (t.firstMs - t.warnMs)) / t.periodMs), start = t.firstMs + n * t.periodMs, since = ms - start;
  const dir = n % 2 === 0 ? 1 : -1, travel = (t.to - t.from + t.length) / t.speed * 1000;
  if (since < -t.warnMs || since > travel) return null;
  if (since < 0) return { n, dir, warning: true, inMs: -since, x0: 0, x1: 0 };
  const nose = dir > 0 ? t.from + since / 1000 * t.speed : t.to - since / 1000 * t.speed;
  return { n, dir, warning: false, inMs: 0, x0: dir > 0 ? nose - t.length : nose, x1: dir > 0 ? nose : nose + t.length };
}

export function metropolis() {
  const w = westHalf(), c = centre();
  const boxes = [...c.boxes, ...w.boxes, ...w.boxes.map(mirror)];
  const mirrorDeco = d => ({ ...mirror(d), east: true });
  const deco = [...c.deco, ...w.deco, ...w.deco.map(mirrorDeco)];
  const glass = [...c.glass, ...w.glass, ...w.glass.map(mirror)].map((g, i) => ({ ...g, i }));
  return {
    id: 'metropolis', name: 'Operation: Metropolis', short: 'Metropolis', flagship: true,
    blurb: 'Okun Bay: Marina Avenue and its rooftops, Plaza Station beneath the Okun Spire, and the port. Five districts, three lanes, 6 v 6.',
    city: 'Okun Bay', bounds: [-X, -Z, X, Z], boxes, deco, glass,
    street: STREET, districts: DISTRICTS, variants: METROPOLIS_VARIANTS, train: TRAIN,
    station: { spaces: [...STATION_SPACES, ...STATION_SPACES.filter(r => r[2] <= 0).map(r => [-r[2], r[1], -r[0], r[3], r[4], r[5], r[6]])] },
    buildings: [...BUILDINGS, ...BUILDINGS.filter(b => b.x1 <= 0).map(b => ({ ...b, id: b.id + '-e', x0: -b.x1, x1: -b.x0, east: true }))],
    palette: { sky: '#a9c4d6', horizon: '#e9dcc0', fog: '#cfd3cf', ground: '#77746c', sun: '#ffe9c4', ambient: '#bcc8d4', sunDir: [-.38, .82, .42] },
    objectives: [{ id: 'A', x: 0, y: L, z: -34.4, r: 3.6, name: 'Tower Arcade' }, { id: 'B', x: 0, y: L, z: 2.4, r: 3.6, name: 'Fountain' }, { id: 'C', x: 0, y: L, z: 31, r: 3.6, name: 'Container Yard' }],
    spawns: spawnSet(
      [[-56.5, -27], [-56.5, -23], [-55, -15], [-56.5, -11], [-56.5, -5], [-56.5, 0], [-56.5, 5], [-56.5, 11], [-55, 15], [-56.5, 24], [-56.5, 31], [-57.5, -30.8]],
      [[-41, -30.5], [-37.5, -14.5], [-42.6, 4.2], [-39.5, 36.5], [-53.5, 40.5]]),
  };
}
