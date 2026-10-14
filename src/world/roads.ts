import { ROADS, ROAD_NODES, ROAD_WIDTH, JUNCTIONS, JUNCTION_RADIUS, TURNAROUNDS, DRIVEWAYS, PARKING, DISTRICTS, COURTYARD_ROAD, COURTYARD_PARKING, STOPS } from '../../shared/expansion.mjs';

// Plan of the open-world road network, derived from the shared road graph: carriageway pieces,
// kerbs, sidewalks, markings and street lights. Pure data (metres), used by the renderer and by
// surfaceHeight so feet rest on the sidewalks. Every road is axis-aligned.

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Strip extends Rect { kind: 'kerb' | 'sidewalk' | 'line' | 'dash' | 'zebra' | 'stop' }
export const KERB = .22, SIDEWALK = 2.4, KERB_TOP = .14, SIDEWALK_TOP = .1, ASPHALT_TOP = .03;
const W = ROAD_WIDTH / 2, R = JUNCTION_RADIUS;

type Span = [number, number];
function subtract(a: number, b: number, cuts: Span[]) {
  let spans: Span[] = [[a, b]];
  for (const [c0, c1] of cuts) spans = spans.flatMap(([s0, s1]) => c1 <= s0 || c0 >= s1 ? [[s0, s1] as Span] : ([[s0, Math.max(s0, c0)], [Math.min(s1, c1), s1]] as Span[]).filter(([p, q]) => q - p > .05));
  return spans;
}
const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
const centred = (c: { x: number; z: number; w: number; d: number }) => rect(c.x - c.w / 2, c.x + c.w / 2, c.z - c.d / 2, c.z + c.d / 2);

interface Road { id: string; horizontal: boolean; c: number; lo: number; hi: number }
const roads: Road[] = ROADS.map(r => { const horizontal = r.a.z === r.b.z; return { id: r.id, horizontal, c: horizontal ? r.a.z : r.a.x, lo: horizontal ? Math.min(r.a.x, r.b.x) - W : Math.min(r.a.z, r.b.z) - W, hi: horizontal ? Math.max(r.a.x, r.b.x) + W : Math.max(r.a.z, r.b.z) + W }; });
const roadRects = roads.map(r => r.horizontal ? rect(r.lo, r.hi, r.c - W, r.c + W) : rect(r.c - W, r.c + W, r.lo, r.hi));
/** The stretch the courtyard already paves (with its own kerbs, crossing and markings). */
const courtyard = rect(COURTYARD_ROAD.x0, COURTYARD_ROAD.x1, COURTYARD_ROAD.z0, COURTYARD_ROAD.z1);
const courtyardLot = centred(COURTYARD_PARKING);
/** Curb returns: the square between two perpendicular arms, rounded by a quarter circle. */
export const FILLETS = JUNCTIONS.flatMap(j => [-1, 1].flatMap(qx => [-1, 1].flatMap(qz => j.arms.some(([ax, az]) => ax === qx && az === 0) && j.arms.some(([ax, az]) => ax === 0 && az === qz) ? [{ x: j.x, z: j.z, qx, qz, r: R }] : [])));
const filletRects = FILLETS.map(f => rect(f.x + f.qx * W, f.x + f.qx * (W + R), f.z + f.qz * W, f.z + f.qz * (W + R)));
const drives = DRIVEWAYS.map(centred);
/** Zebra crossings in front of each district's first building, where its entrance walk meets the road. */
export const CROSSINGS = DISTRICTS.map(d => ({ x: d.x + 48, z: ROADS.find(r => r.a.z === r.b.z && Math.abs(r.a.z - d.z) < 1 && Math.min(r.a.x, r.b.x) <= d.x + 48 && Math.max(r.a.x, r.b.x) >= d.x + 48)!.a.z }));

function along(r: Road, other: Rect): Span { return r.horizontal ? [other.x0, other.x1] : [other.z0, other.z1]; }
function crosses(r: Road, line: number, o: Rect) { return r.horizontal ? line > o.z0 && line < o.z1 : line > o.x0 && line < o.x1; }

/** Carriageway pieces, minus what the courtyard road already covers. */
export const CARRIAGEWAY: Rect[] = roads.flatMap((r, i) => {
  const cuts: Span[] = crosses(r, r.c, courtyard) ? [along(r, courtyard)] : [];
  return subtract(r.lo, r.hi, cuts).map(([a, b]) => r.horizontal ? rect(a, b, roadRects[i].z0, roadRects[i].z1) : rect(roadRects[i].x0, roadRects[i].x1, a, b));
});

export const STRIPS: Strip[] = [];
export const LIGHTS: { x: number; z: number; yaw: number }[] = [];
for (const [i, r] of roads.entries()) {
  const others = roadRects.filter((_, k) => k !== i), surfaces = [...others, ...filletRects, ...drives, courtyardLot, courtyard];
  const push = (kind: Strip['kind'], a: number, b: number, c0: number, c1: number) => STRIPS.push({ kind, ...(r.horizontal ? rect(a, b, c0, c1) : rect(c0, c1, a, b)) });
  for (const side of [-1, 1]) {
    // Kerb and sidewalk: interrupted where another road, a corner, a driveway or a turning circle meets them.
    const kerbLine = r.c + side * (W + KERB / 2), walkLine = r.c + side * (W + KERB + SIDEWALK / 2);
    const cutsFor = (line: number, pad: number) => {
      const cuts = surfaces.filter(o => crosses(r, line, o)).map(o => along(r, o));
      for (const t of TURNAROUNDS) { const d = Math.abs(line - (r.horizontal ? t.z : t.x)); if (d < t.r + pad) { const h = Math.sqrt((t.r + pad) ** 2 - d * d), c = r.horizontal ? t.x : t.z; cuts.push([c - h, c + h]); } }
      return cuts;
    };
    for (const [a, b] of subtract(r.lo, r.hi, cutsFor(kerbLine, KERB))) push('kerb', a, b, r.c + side * W, r.c + side * (W + KERB));
    for (const [a, b] of subtract(r.lo, r.hi, cutsFor(walkLine, KERB + SIDEWALK).concat(filletRects.filter(o => crosses(r, kerbLine, o)).map(o => along(r, o))))) push('sidewalk', a, b, r.c + side * (W + KERB), r.c + side * (W + KERB + SIDEWALK));
    // Edge line 35 cm inside the kerb, broken at junctions, driveways and the courtyard lot.
    const edge = r.c + side * (W - .35), edgeCuts: Span[] = [];
    for (const o of others) if (crosses(r, edge, o)) { const [a, b] = along(r, o); edgeCuts.push([a - 1, b + 1]); }
    for (const o of [...filletRects, ...drives, courtyardLot]) if (crosses(r, r.c + side * (W + .1), o)) edgeCuts.push(along(r, o));
    for (const t of TURNAROUNDS) { const c = r.horizontal ? t.x : t.z; edgeCuts.push([c - t.r, c + t.r]); }
    if (crosses(r, r.c, courtyard)) edgeCuts.push(along(r, courtyard));
    for (const [a, b] of subtract(r.lo, r.hi, edgeCuts)) push('line', a, b, edge - .06, edge + .06);
  }
  // Centre line: 3 m dashes, 6 m gaps; none inside junctions, the courtyard stretch or crossings.
  const centreCuts: Span[] = others.filter(o => crosses(r, r.c, o)).map(o => along(r, o)).map(([a, b]) => [a - 3, b + 3]);
  if (crosses(r, r.c, courtyard)) centreCuts.push(along(r, courtyard));
  for (const t of TURNAROUNDS) { const c = r.horizontal ? t.x : t.z; centreCuts.push([c - t.r - 2, c + t.r + 2]); }
  for (const p of CROSSINGS) if (r.horizontal && Math.abs(p.z - r.c) < 1) centreCuts.push([p.x - 6, p.x + 6]);
  for (const [a, b] of subtract(r.lo + 2, r.hi - 2, centreCuts)) for (let s = a; s + 3 <= b; s += 9) push('dash', s, s + 3, r.c - .07, r.c + .07);
  // Street lights every 40 m, alternating sides, set back on the sidewalk and leaning over the road.
  let n = 0;
  for (let s = r.lo + 20; s < r.hi - 12; s += 40, n++) {
    const side = n % 2 ? 1 : -1, off = r.c + side * (W + KERB + .45);
    if (ROAD_NODES.some(p => Math.abs((r.horizontal ? p.x : p.z) - s) < W + R + 2 && Math.abs((r.horizontal ? p.z : p.x) - r.c) < 1)) continue;
    if (crosses(r, r.c, courtyard) && s > (r.horizontal ? courtyard.x0 : courtyard.z0) - 4 && s < (r.horizontal ? courtyard.x1 : courtyard.z1) + 4) continue;
    if ([...drives, courtyardLot].some(o => crosses(r, r.c + side * (W + 1), o) && s > along(r, o)[0] - 3 && s < along(r, o)[1] + 3)) continue;
    if (TURNAROUNDS.some(t => Math.hypot((r.horizontal ? s : off) - t.x, (r.horizontal ? off : s) - t.z) < t.r + 3)) continue;
    if (STOPS.some(p => Math.hypot((r.horizontal ? s : off) - p.x, (r.horizontal ? off : s) - p.z) < 8)) continue;
    LIGHTS.push(r.horizontal ? { x: s, z: off, yaw: side > 0 ? Math.PI : 0 } : { x: off, z: s, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
  }
}
// Zebra crossings: bars along the traffic direction, spaced across the carriageway.
for (const p of CROSSINGS) for (let z = p.z - W + .4; z < p.z + W - .3; z += 1) STRIPS.push({ kind: 'zebra', x0: p.x - 1.7, x1: p.x + 1.7, z0: z, z1: z + .5 });
// Courtyard lot: bays opening straight onto the road.
for (let x = courtyardLot.x0; x <= courtyardLot.x1 + .01; x += 3) STRIPS.push({ kind: 'line', x0: x - .05, x1: x + .05, z0: courtyardLot.z0 + 1.2, z1: courtyardLot.z1 - .3 });
STRIPS.push({ kind: 'kerb', x0: courtyardLot.x0 - KERB, x1: courtyardLot.x1 + KERB, z0: courtyardLot.z1, z1: courtyardLot.z1 + KERB });
for (const x of [courtyardLot.x0 - KERB, courtyardLot.x1]) STRIPS.push({ kind: 'kerb', x0: x, x1: x + KERB, z0: courtyardLot.z0, z1: courtyardLot.z1 });
/** District car parks: bays on the south half, an aisle to the driveway on the north half. */
export const LOT_BAYS = PARKING.map(p => ({ ...p, bays: Array.from({ length: 12 }, (_, k) => p.x - 16.5 + k * 3) }));
for (const p of LOT_BAYS) for (const x of p.bays) STRIPS.push({ kind: 'line', x0: x - .05, x1: x + .05, z0: p.z + .5, z1: p.z + p.d / 2 - .4 });

/** Raised surfaces (sidewalks and kerbs) for the walking height lookup, bucketed on a coarse grid. */
const GRID = 64, raised = new Map<string, Strip[]>();
for (const s of STRIPS) if (s.kind === 'sidewalk' || s.kind === 'kerb') for (let gx = Math.floor(s.x0 / GRID); gx <= Math.floor(s.x1 / GRID); gx++) for (let gz = Math.floor(s.z0 / GRID); gz <= Math.floor(s.z1 / GRID); gz++) { const k = gx + ',' + gz; if (!raised.has(k)) raised.set(k, []); raised.get(k)!.push(s); }
export function roadsideHeight(x: number, z: number) {
  const list = raised.get(Math.floor(x / GRID) + ',' + Math.floor(z / GRID)); if (!list) return 0;
  let y = 0; for (const s of list) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) y = Math.max(y, s.kind === 'kerb' ? KERB_TOP : SIDEWALK_TOP);
  return y;
}
export { roadRects, courtyardLot };
