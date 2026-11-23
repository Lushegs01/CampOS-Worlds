// Metropolitan City's traffic network: the lane-level description of the shared road graph that NPC drivers and
// pedestrians navigate. Derived once from ROADS (shared/expansion.mjs) and METRO_BUILDINGS (shared/metro.mjs), so
// it always matches the rendered carriageways, sidewalks and building footprints.
//
// Vehicles drive on the right. Every road between two nodes has two directed lanes, 2 m right of the centreline.
// A lane stops short of a junction at its stop line; turning movements through a junction are connectors (curves
// from an incoming lane's stop line to an outgoing lane's start). Junctions are signalised (two-phase, with amber
// and all-red clearance and coordinated offsets), priority-controlled (the side road yields) or plain corners.
//
// Pedestrians walk a sidewalk graph: a node at each corner of every junction, edges along both sides of every road,
// crosswalks across each arm of a junction (signal-gated where the junction has signals), and short access paths
// from the sidewalk to building doors, benches and bus stops.
//
// Pure data and pure functions: used by the simulations (shared/city/traffic.mjs, shared/city/pedestrians.mjs),
// the renderer (src/city) and the tests (tests/city-*.test.mjs).
import { ROADS, ROAD_WIDTH } from '../expansion.mjs';
import { METRO_BUILDINGS, METRO_PARKED, metroDistrictAt, inMetro, EXPRESSWAY, POLICE_BAYS } from '../metro.mjs';
import { blocked } from '../campus.mjs';

export const LANE_OFFSET = ROAD_WIDTH / 4;            // lane centre, metres right of the road centreline
export const STOP_BACK = 13.2;                        // stop line distance from a junction's centre
export const SIDEWALK_OFFSET = 5.35;                  // sidewalk walking line from the road centreline
export const CROSS_BACK = 10.8;                       // crosswalk distance from a junction's centre
const r2 = n => Math.round(n * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------ the area the city simulates
/** Roads of Metropolitan City and the Gateway Expressway (both ends south of the campus gate). */
export const CITY_ROADS = ROADS.filter(r => r.a.z >= EXPRESSWAY.z0 - 5 && r.b.z >= EXPRESSWAY.z0 - 5 && (inMetro(r.a.x, r.a.z, 12) || inMetro(r.b.x, r.b.z, 12) || Math.abs(r.a.x) < 1 && Math.abs(r.b.x) < 1));
const nodeMap = new Map();
for (const r of CITY_ROADS) for (const n of [r.a, r.b]) if (!nodeMap.has(n.id)) nodeMap.set(n.id, { id: n.id, x: n.x, z: n.z, arms: [] });
for (const r of CITY_ROADS) { nodeMap.get(r.a.id).arms.push(r); nodeMap.get(r.b.id).arms.push(r); }
/** Where traffic enters and leaves the simulated city (the expressway towards the university). */
export const PORTALS = [...nodeMap.values()].filter(n => n.arms.length === 1 && n.z < 1300).map(n => n.id);

// ------------------------------------------------------------------ districts, speed and density
/** Relative densities (0…1) and the posted speed (m/s) by district. */
export const DISTRICT_PROFILE = {
  downtown: { people: 1.0, traffic: .8, speed: 11.5, signals: true, label: 'Downtown' },
  commercial: { people: .85, traffic: .62, speed: 11, signals: true, label: 'Commercial District' },
  residential: { people: .45, traffic: .45, speed: 9.5, signals: false, label: 'Residential District' },
  industrial: { people: .15, traffic: .55, speed: 12.5, signals: false, label: 'Industrial District' },
  outskirts: { people: .06, traffic: .6, speed: 21, signals: false, label: 'Outskirts & Highways' },
  security: { people: .45, traffic: .5, speed: 11, signals: true, label: 'Security District' },
  entrance: { people: .3, traffic: .75, speed: 15, signals: true, label: 'Metropolitan Entrance' },
};
export function districtAt(x, z) { return metroDistrictAt(x, z)?.id ?? 'outskirts'; }
/** City-wide activity by hour (0–24): a morning and evening peak, a busy midday, a quiet night. */
export function activityAt(hour, kind) {
  const h = ((hour % 24) + 24) % 24, bump = (c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
  const base = kind === 'people' ? .12 + .55 * bump(13, 3.2) + .45 * bump(18, 2) + .25 * bump(8.5, 1.4) : .14 + .7 * bump(8, 1.5) + .45 * bump(13, 3) + .8 * bump(17.8, 1.8);
  return Math.min(1, base);
}

// ------------------------------------------------------------------ junctions
const axisOf = r => (r.a.z === r.b.z ? 'h' : 'v');
const otherEnd = (r, id) => (r.a.id === id ? r.b : r.a);
/** @typedef {{id:string,x:number,z:number,arms:any[],control:'signal'|'priority'|'none'|'end',offset:number,district:string}} Junction */
/** @type {Map<string, Junction>} */
export const JUNCTION = new Map();
for (const n of nodeMap.values()) {
  const district = districtAt(n.x, n.z), deg = n.arms.length;
  const control = deg === 1 ? 'end' : deg === 2 ? 'none' : DISTRICT_PROFILE[district].signals || (deg === 4 && district !== 'residential') ? 'signal' : 'priority';
  // Coordinated offsets: a green wave eastbound along the rows and southbound down the avenues at ~11 m/s.
  JUNCTION.set(n.id, { ...n, control, district, offset: ((n.x + 600) / 11 + (n.z - 1500) / 11) % 60 });
}
/** Signal plan: phase 'h' (east–west movements), then 'v'. Durations in seconds. */
export const SIGNAL = { green: 17, amber: 3, allRed: 2 };
export const SIGNAL_CYCLE = 2 * (SIGNAL.green + SIGNAL.amber + SIGNAL.allRed);
/** Aspect shown to traffic on an `axis` ('h'|'v') approach at time t (s): 'green' | 'amber' | 'red'. */
export function signalAspect(j, axis, t) {
  if (j.control !== 'signal') return 'green';
  const half = SIGNAL.green + SIGNAL.amber + SIGNAL.allRed, u = (((t + j.offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const mine = axis === 'h' ? u : (u + half) % SIGNAL_CYCLE;
  return mine < SIGNAL.green ? 'green' : mine < SIGNAL.green + SIGNAL.amber ? 'amber' : 'red';
}
/** Seconds until an approach's aspect changes (for drivers deciding whether to stop on amber). */
export function signalRemaining(j, axis, t) {
  const half = SIGNAL.green + SIGNAL.amber + SIGNAL.allRed, u = (((t + j.offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const mine = axis === 'h' ? u : (u + half) % SIGNAL_CYCLE;
  return mine < SIGNAL.green ? SIGNAL.green - mine : mine < SIGNAL.green + SIGNAL.amber ? SIGNAL.green + SIGNAL.amber - mine : SIGNAL_CYCLE - mine;
}
/** Pedestrians may start crossing an arm while traffic parallel to the crosswalk has green (with a flashing end). */
export function walkSignal(j, armAxis, t) {
  if (j.control !== 'signal') return 'free';
  // A crosswalk across a vertical arm runs east–west: it walks with the 'h' phase.
  const axis = armAxis === 'v' ? 'h' : 'v';
  const a = signalAspect(j, axis, t);
  if (a !== 'green') return 'dont';
  return signalRemaining(j, axis, t) > 6 ? 'walk' : 'flash';
}

// ------------------------------------------------------------------ lanes and connectors
/** @typedef {{id:number,kind:'lane'|'conn',pts:{x:number,z:number}[],cum:number[],len:number,next:number[],from:string,to:string,road?:any,axis?:string,speed:number,district:string,turn?:string,node?:string,inLane?:number,outLane?:number,conflicts?:number[],parking?:number[],dir?:any,road?:any,garages?:number[]}} Segment */
/** @type {Segment[]} */
export const SEGMENTS = [];
function polyline(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i])); return { pts, cum, len: cum.at(-1) }; }
const laneOf = new Map(); // `${roadId}:${fromNodeId}` -> lane index
for (const r of CITY_ROADS) {
  for (const [a, b] of [[r.a, r.b], [r.b, r.a]]) {
    const len = dist(a, b), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, rx = -uz, rz = ux; // right of travel
    const ja = JUNCTION.get(a.id), jb = JUNCTION.get(b.id);
    const back = j => (j.control === 'end' ? 2 : j.control === 'none' ? 6.5 : STOP_BACK);
    const s0 = back(ja), s1 = len - back(jb);
    const p = t => ({ x: r2(a.x + ux * t + rx * LANE_OFFSET), z: r2(a.z + uz * t + rz * LANE_OFFSET) });
    const n = Math.max(1, Math.ceil((s1 - s0) / 20)), pts = Array.from({ length: n + 1 }, (_, i) => p(s0 + (s1 - s0) * i / n));
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, district = districtAt(mid.x, mid.z);
    const expressway = Math.abs(a.x) < 1 && Math.abs(b.x) < 1 && Math.min(a.z, b.z) < 1545;
    SEGMENTS.push({ id: SEGMENTS.length, kind: 'lane', ...polyline(pts), next: [], from: a.id, to: b.id, road: r, axis: axisOf(r), dir: { x: ux, z: uz }, speed: expressway ? 22 : DISTRICT_PROFILE[district].speed, district });
    laneOf.set(r.id + ':' + a.id, SEGMENTS.length - 1);
  }
}
export const LANES = SEGMENTS.filter(s => s.kind === 'lane');
/** Quadratic Bézier through a junction: from the end of `inL` to the start of `outL`. */
function bezier(p0, c, p1, n) { return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return { x: r2(u * u * p0.x + 2 * u * t * c.x + t * t * p1.x), z: r2(u * u * p0.z + 2 * u * t * c.z + t * t * p1.z) }; }); }
function lineMeet(p, d, q, e) {
  const den = d.x * e.z - d.z * e.x; if (Math.abs(den) < 1e-6) return null;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den; return { x: p.x + d.x * t, z: p.z + d.z * t };
}
for (const inL of LANES) {
  const j = JUNCTION.get(inL.to);
  for (const r of j.arms) {
    const outIdx = laneOf.get(r.id + ':' + j.id), outL = SEGMENTS[outIdx];
    const uturn = r === inL.road;
    if (uturn && j.control !== 'end') continue;
    const p0 = inL.pts.at(-1), p1 = outL.pts[0], d = inL.dir, e = outL.dir;
    const cross = d.x * e.z - d.z * e.x, straight = Math.abs(cross) < 1e-6 && d.x * e.x + d.z * e.z > 0;
    // (+x east, +z south: travelling south (0,1) and turning to east (1,0) is a left turn; cross = -1.)
    const turn = uturn ? 'uturn' : straight ? 'straight' : cross < 0 ? 'left' : 'right';
    let pts;
    if (uturn) { const c = { x: j.x + d.x * 7, z: j.z + d.z * 7 }; pts = [...bezier(p0, { x: c.x + (p0.x - p1.x) / 2 * 1.6, z: c.z + (p0.z - p1.z) / 2 * 1.6 }, c, 6), ...bezier(c, { x: c.x + (p1.x - p0.x) / 2 * 1.6, z: c.z + (p1.z - p0.z) / 2 * 1.6 }, p1, 6).slice(1)]; }
    else pts = straight ? [p0, p1] : bezier(p0, lineMeet(p0, d, p1, e) ?? j, p1, 10);
    const seg = { id: SEGMENTS.length, kind: 'conn', ...polyline(pts), next: [outIdx], from: inL.from, to: outL.to, node: j.id, turn, inLane: inL.id, outLane: outIdx, axis: inL.axis, speed: turn === 'straight' ? inL.speed : turn === 'right' ? 5.2 : turn === 'uturn' ? 3.2 : 7, district: inL.district, conflicts: [] };
    SEGMENTS.push(seg); inL.next.push(seg.id);
  }
}
export const CONNECTORS = SEGMENTS.filter(s => s.kind === 'conn');
// Conflicts: connectors at the same junction whose paths cross or that merge into the same lane.
function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
for (const a of CONNECTORS) for (const b of CONNECTORS) {
  if (a === b || a.node !== b.node || a.inLane === b.inLane) continue;
  let hit = a.outLane === b.outLane;
  for (let i = 1; !hit && i < a.pts.length; i++) for (let k = 1; !hit && k < b.pts.length; k++) hit = segsCross(a.pts[i - 1], a.pts[i], b.pts[k - 1], b.pts[k]);
  // Close passes (two cars side by side through the middle of a junction) count as conflicts too.
  for (let i = 0; !hit && i < a.pts.length; i++) for (let k = 0; !hit && k < b.pts.length; k++) hit = dist(a.pts[i], b.pts[k]) < 2.1 && i > 0 && k > 0 && i < a.pts.length - 1 && k < b.pts.length - 1;
  if (hit) a.conflicts.push(b.id);
}
/** Point and heading `s` metres along a segment, with a lateral offset (metres to the right). */
export function pointAt(seg, s, lateral = 0) {
  const { pts, cum } = seg; s = Math.max(0, Math.min(seg.len, s));
  let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], l = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / l;
  const dx = (b.x - a.x) / l, dz = (b.z - a.z) / l;
  return { x: a.x + (b.x - a.x) * t - dz * lateral, z: a.z + (b.z - a.z) * t + dx * lateral, yaw: Math.atan2(dx, dz) };
}

// ------------------------------------------------------------------ routing
/** Shortest route (segment ids) from the end of segment `from` to the start of lane `goal`; avoids `avoid` lanes. */
export function route(from, goal, avoid = null, extra = null) {
  const start = SEGMENTS[from];
  const open = [{ id: from, g: 0, f: 0 }], came = new Map([[from, -1]]), cost = new Map([[from, 0]]);
  const target = SEGMENTS[goal].pts[0];
  let guard = 0;
  while (open.length && guard++ < 4000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.id === goal) { const path = []; for (let k = goal; k !== -1; k = came.get(k)) path.push(k); return path.reverse(); }
    for (const n of SEGMENTS[cur.id].next) {
      const seg = SEGMENTS[n];
      if (avoid?.has(n)) continue;
      const g = cur.g + seg.len / seg.speed + (seg.turn === 'uturn' ? 25 : seg.turn === 'left' ? 4 : seg.turn === 'right' ? 2 : 0) + (extra ? extra(n) : 0);
      if (g < (cost.get(n) ?? Infinity)) { cost.set(n, g); came.set(n, cur.id); const e = seg.pts.at(-1); open.push({ id: n, g, f: g + dist(e, target) / 14 }); }
    }
  }
  void start; return null;
}

// ------------------------------------------------------------------ parking bays (off-street, beside the frontage)
/** @typedef {{id:number,lane:number,s:number,x:number,z:number,yaw:number,district:string,kind:string}} Bay */
/** @type {Bay[]} */
export const BAYS = [];
const takenBay = (x, z) => BAYS.some(b => Math.hypot(b.x - x, b.z - z) < 2.95);
for (const b of METRO_BUILDINGS) {
  if (!['shed', 'apartment', 'fuel', 'mall', 'civic', 'police', 'security', 'tower', 'carpark', 'shop'].includes(b.kind)) continue;
  // Find the lane that runs past the building's frontage (the street it faces).
  const fz = b.z + b.front * b.d / 2;
  let best = null;
  for (const l of LANES) {
    if (l.axis !== 'h') continue;
    const z = l.road.a.z, gap = (z - fz) * b.front; // building front beyond the road centre, measured outwards
    const right = l.dir.x * b.front < 0; // the lane whose right side faces the building
    if (gap < 0 || gap > 60) continue;
    if (Math.min(l.road.a.x, l.road.b.x) > b.x - b.w / 2 - 2 || Math.max(l.road.a.x, l.road.b.x) < b.x + b.w / 2 + 2) continue;
    if (!right) continue;
    if (!best || gap < best.gap) best = { l, gap, z };
  }
  if (!best || best.gap < 14.5) continue;
  // Nose-in bays 2.7 m apart, centred 10.6 m out from the road centre (clear of the 6.6 m sidewalk edge).
  const out = best.z + Math.sign(fz - best.z) * 10.6, yaw = Math.sign(fz - best.z) > 0 ? 0 : Math.PI;
  const count = Math.min(b.kind === 'shop' ? 2 : 8, Math.floor((b.w - 4) / 3));
  for (let i = 0; i < count; i++) {
    const x = r2(b.x - (count - 1) * 1.5 + i * 3), z = r2(out);
    if (takenBay(x, z) || blocked(x, z, 1.1) || blocked(x, z + 2.1, .9) || blocked(x, z - 2.1, .9)) continue;
    if (METRO_PARKED.some(p => Math.hypot(p.x - x, p.z - z) < 4.5) || POLICE_BAYS.some(p => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
    const l = best.l, s = (x - l.pts[0].x) * l.dir.x + (x - l.pts[0].z * 0 - 0) * 0;
    const along = (x - l.pts[0].x) * l.dir.x + (z - l.pts[0].z) * l.dir.z;
    if (along < 6 || along > l.len - 6) continue;
    BAYS.push({ id: BAYS.length, lane: l.id, s: r2(along), x, z, yaw, district: districtAt(x, z), kind: b.kind });
    void s;
  }
}
for (const bay of BAYS) (SEGMENTS[bay.lane].parking ??= []).push(bay.id);
/** Garage and car-park entrances: vehicles turn in here and leave the street (and later come back out). */
export const GARAGES = [];
for (const b of METRO_BUILDINGS) {
  if (!['carpark', 'apartment', 'mall', 'police', 'shed', 'tower'].includes(b.kind)) continue;
  if (b.kind === 'tower' && b.h < 60) continue;
  const fz = b.z + b.front * b.d / 2;
  let best = null;
  for (const l of LANES) {
    if (l.axis !== 'h' || l.dir.x * b.front >= 0) continue;
    const z = l.road.a.z, gap = (z - fz) * b.front;
    if (gap < 6 || gap > 40 || Math.min(l.road.a.x, l.road.b.x) > b.x - 3 || Math.max(l.road.a.x, l.road.b.x) < b.x + 3) continue;
    if (!best || gap < best.gap) best = { l, gap };
  }
  if (!best) continue;
  const x = r2(b.x + b.w * .32), z = r2(fz + b.front * .9), l = best.l;
  const along = (x - l.pts[0].x) * l.dir.x + (z - l.pts[0].z) * l.dir.z;
  if (along < 8 || along > l.len - 8 || blocked(x, z + b.front * 2, .8)) continue;
  GARAGES.push({ id: GARAGES.length, lane: l.id, s: r2(along), x, z, yaw: b.front > 0 ? Math.PI : 0, district: b.district, building: b.id, kind: b.kind });
}
for (const g of GARAGES) (SEGMENTS[g.lane].garages ??= []).push(g.id);
// (A bay right beside a garage entrance would have cars pulling out across each other.)
const nearSegment = (p, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)); return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t); };
for (let i = BAYS.length - 1; i >= 0; i--) if (GARAGES.some(g => { const from = pointAt(SEGMENTS[g.lane], g.s - 7); return Math.hypot(g.x - BAYS[i].x, g.z - BAYS[i].z) < 11 || nearSegment(BAYS[i], from, g) < 5.5 || nearSegment(BAYS[i], pointAt(SEGMENTS[g.lane], g.s + 9), g) < 5.5; })) BAYS.splice(i, 1);
BAYS.forEach((b, i) => { b.id = i; });
for (const l of LANES) delete l.parking;
for (const bay of BAYS) (SEGMENTS[bay.lane].parking ??= []).push(bay.id);


// ------------------------------------------------------------------ pedestrian network
/** @typedef {{id:number,x:number,z:number,edges:{to:number,len:number,cross?:{node:string,axis:string}}[],kind:string,district:string}} WalkNode */
/** @type {WalkNode[]} */
export const WALK = [];
const walkKey = new Map();
function walkNode(x, z, kind = 'path') {
  const k = Math.round(x * 10) + ':' + Math.round(z * 10);
  if (walkKey.has(k)) return walkKey.get(k);
  WALK.push({ id: WALK.length, x: r2(x), z: r2(z), edges: [], kind, district: districtAt(x, z) });
  walkKey.set(k, WALK.length - 1); return WALK.length - 1;
}
function walkEdge(a, b, cross = null) {
  if (a === b || WALK[a].edges.some(e => e.to === b)) return;
  const len = dist(WALK[a], WALK[b]);
  WALK[a].edges.push({ to: b, len, cross }); WALK[b].edges.push({ to: a, len, cross });
}
const walkable = (a, b) => { for (let i = 0; i <= 12; i++) { const t = i / 12, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; if (blocked(x, z, .32)) return false; } return true; };
// At each junction: the sidewalk points either side of every arm's crosswalk, joined round the junction in a ring
// (round the kerb return where two arms meet, straight past where an arm is missing). The crosswalks themselves
// are separate edges, gated by the walk signal.
const O = SIDEWALK_OFFSET;
/** Crosswalks: {node, axis (of the arm crossed), a, b (walk node ids), x, z (centre)} */
export const CROSSWALKS = [];
for (const j of JUNCTION.values()) {
  if (j.control === 'end') continue;
  const ring = [];
  const dirs = j.arms.map(r => { const o = otherEnd(r, j.id), len = dist(j, o); return { r, ux: (o.x - j.x) / len, uz: (o.z - j.z) / len, len }; });
  for (const { r, ux, uz } of dirs) {
    const ends = [-1, 1].map(side => walkNode(j.x + ux * CROSS_BACK - uz * O * side, j.z + uz * CROSS_BACK + ux * O * side, 'curb'));
    for (const id of ends) ring.push({ id, arm: r.id });
    if (j.control !== 'none') { walkEdge(ends[0], ends[1], { node: j.id, axis: axisOf(r) }); CROSSWALKS.push({ node: j.id, axis: axisOf(r), a: ends[0], b: ends[1], x: r2(j.x + ux * CROSS_BACK), z: r2(j.z + uz * CROSS_BACK) }); }
  }
  const has = (x, z) => dirs.some(d => Math.round(d.ux) === x && Math.round(d.uz) === z);
  for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
    const fillet = has(qx, 0) && has(0, qz), k = fillet ? 6.4 : O;
    ring.push({ id: walkNode(j.x + qx * k, j.z + qz * k, 'corner'), arm: null });
  }
  ring.sort((a, b) => Math.atan2(WALK[a.id].z - j.z, WALK[a.id].x - j.x) - Math.atan2(WALK[b.id].z - j.z, WALK[b.id].x - j.x));
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a.arm && a.arm === b.arm) continue; // across an arm: that is the crosswalk
    if (walkable(WALK[a.id], WALK[b.id])) walkEdge(a.id, b.id);
  }
}
for (const r of CITY_ROADS) {
  const ja = JUNCTION.get(r.a.id), jb = JUNCTION.get(r.b.id), len = dist(r.a, r.b), ux = (r.b.x - r.a.x) / len, uz = (r.b.z - r.a.z) / len;
  if (len < 30) continue;
  const atA = ja.control === 'end' ? 3 : CROSS_BACK, atB = jb.control === 'end' ? 3 : CROSS_BACK;
  for (const side of [-1, 1]) {
    const p = t => walkNode(r.a.x + ux * t - uz * O * side, r.a.z + uz * t + ux * O * side, t === atA || t === len - atB ? 'curb' : 'path');
    // Intermediate nodes every ~25 m so pedestrians can join and leave along the block.
    const n = Math.max(1, Math.round((len - atA - atB) / 25)), ids = Array.from({ length: n + 1 }, (_, i) => p(i === 0 ? atA : i === n ? len - atB : atA + (len - atA - atB) * i / n));
    for (let i = 1; i < ids.length; i++) if (walkable(WALK[ids[i - 1]], WALK[ids[i]])) walkEdge(ids[i - 1], ids[i]);
  }
}
/** Places people walk to: building doors, benches and bus stops (with the sidewalk node that reaches them). */
export const PLACES = [];
const nearestWalk = (x, z, max = 30) => { let best = -1, bd = max; for (const w of WALK) { if (!w.edges.length) continue; const d = Math.hypot(w.x - x, w.z - z); if (d < bd) { bd = d; best = w.id; } } return best; };
for (const b of METRO_BUILDINGS) {
  const door = { x: b.x, z: b.z + b.front * (b.d / 2 + .7) };
  if (blocked(door.x, door.z, .3)) continue;
  const w = nearestWalk(door.x, door.z, 40); if (w < 0) continue;
  if (!walkable(door, WALK[w])) continue;
  const busy = b.kind === 'shop' || b.kind === 'mall' || b.kind === 'tower' || b.kind === 'fuel' ? 1 : b.kind === 'house' || b.kind === 'apartment' ? .6 : .35;
  PLACES.push({ id: PLACES.length, kind: 'door', building: b.id, buildingKind: b.kind, x: r2(door.x), z: r2(door.z), yaw: b.front > 0 ? Math.PI : 0, walk: w, weight: busy, district: b.district });
}
// Benches and bus stops: every ~110 m along busy sidewalks, on the kerb side facing the road.
export const FURNITURE = [];
{
  let i = 0;
  for (const r of CITY_ROADS) {
    const district = districtAt((r.a.x + r.b.x) / 2, (r.a.z + r.b.z) / 2), len = dist(r.a, r.b);
    if (len < 60 || district === 'outskirts' || (Math.abs(r.a.x) < 1 && Math.abs(r.b.x) < 1 && Math.min(r.a.z, r.b.z) < 1545)) continue;
    const ux = (r.b.x - r.a.x) / len, uz = (r.b.z - r.a.z) / len;
    for (let t = 34; t < len - 30; t += 110) for (const side of [-1, 1]) {
      i++;
      const kind = i % 3 === 0 && (district === 'downtown' || district === 'commercial' || district === 'residential' || district === 'entrance') ? 'busstop' : district === 'industrial' ? null : 'bench';
      if (!kind) continue;
      const x = r2(r.a.x + ux * t - uz * (O - 1.25) * side), z = r2(r.a.z + uz * t + ux * (O - 1.25) * side);
      if (blocked(x, z, .5)) continue;
      const yaw = Math.atan2(uz * side, -ux * side); // facing the road
      const w = nearestWalk(x, z, 20); if (w < 0) continue;
      FURNITURE.push({ id: FURNITURE.length, kind, x, z, yaw, district, along: axisOf(r) });
      PLACES.push({ id: PLACES.length, kind, x: r2(x - Math.sin(yaw) * .45), z: r2(z - Math.cos(yaw) * .45), yaw, walk: w, weight: kind === 'busstop' ? .9 : .5, district, seats: kind === 'busstop' ? 3 : 2 });
    }
  }
}
/** Shortest walk (node ids) between two sidewalk nodes. */
export function walkRoute(from, to) {
  const goal = WALK[to], open = [from], came = new Map([[from, -1]]), g = new Map([[from, 0]]), f = new Map([[from, dist(WALK[from], goal)]]);
  let guard = 0;
  while (open.length && guard++ < 6000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (f.get(open[i]) < f.get(open[bi])) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) { const path = []; for (let k = to; k !== -1; k = came.get(k)) path.push(k); return path.reverse(); }
    for (const e of WALK[cur].edges) {
      const ng = g.get(cur) + e.len + (e.cross ? 6 : 0);
      if (ng < (g.get(e.to) ?? Infinity)) { g.set(e.to, ng); came.set(e.to, cur); f.set(e.to, ng + dist(WALK[e.to], goal)); if (!open.includes(e.to)) open.push(e.to); }
    }
  }
  return null;
}
/** Signal heads: one per signalised approach, on the right-hand kerb at the stop line, facing oncoming traffic. */
export const SIGNAL_HEADS = LANES.filter(l => JUNCTION.get(l.to).control === 'signal').map(l => {
  const e = l.pts.at(-1); return { node: l.to, axis: l.axis, x: r2(e.x - l.dir.z * 2.6 + l.dir.x * 1.2), z: r2(e.z + l.dir.x * 2.6 + l.dir.z * 1.2), yaw: Math.atan2(-l.dir.x, -l.dir.z) };
});
/** Give-way signs on the side roads of priority junctions. */
export const GIVE_WAY = LANES.filter(l => JUNCTION.get(l.to).control === 'priority' && l.axis === 'v').map(l => {
  const e = l.pts.at(-1); return { node: l.to, x: r2(e.x - l.dir.z * 2.6), z: r2(e.z + l.dir.x * 2.6), yaw: Math.atan2(-l.dir.x, -l.dir.z) };
});
export const NETWORK_STATS = { lanes: LANES.length, connectors: CONNECTORS.length, junctions: JUNCTION.size, signals: [...JUNCTION.values()].filter(j => j.control === 'signal').length, bays: BAYS.length, garages: GARAGES.length, walkNodes: WALK.length, crosswalks: CROSSWALKS.length, places: PLACES.length, furniture: FURNITURE.length, portals: PORTALS.length };
