// Metropolitan City's autonomous traffic: NPC drivers that choose destinations, route over the lane network
// (shared/city/network.mjs), follow their lane with an Intelligent Driver Model, obey signals and give-way rules,
// avoid one another through junctions, yield to pedestrians, park, use garages, leave the city by the expressway,
// pull over for sirens, overtake or turn round at obstructions, and react to crashes, gunfire and explosions.
//
// The whole city is simulated, not only a ring around the player: distant vehicles update less often (tiered
// simulation) and are drawn with cheaper representations by the renderer. Population follows each district's
// density and the hour of day, inside a total budget set by the graphics profile. New vehicles only appear out of
// sight: from garages, parking bays, the expressway, or mid-block far from every player.
//
// The simulation runs wherever it is stepped (each browser runs its own city around its player; see
// docs/METROPOLITAN-LIFE.md for the multiplayer trade-off). It is deterministic for a given seed and inputs.
import { SEGMENTS, LANES, JUNCTION, BAYS, GARAGES, PORTALS, FURNITURE, CROSSWALKS, DISTRICT_PROFILE, activityAt, route, pointAt, signalAspect, signalRemaining, LANE_OFFSET } from './network.mjs';
import { CITY_CLASSES, CLASS_MIX, PAINTS, PAINT_WEIGHTS, LIVERY } from './vehicles.mjs';

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, weights) => { const keys = Object.keys(weights); let total = 0; for (const k of keys) total += weights[k]; let u = r() * total; for (const k of keys) { u -= weights[k]; if (u <= 0) return k; } return keys[0]; };
const pickIndex = (r, w) => { let t = 0; for (const x of w) t += x; let u = r() * t; for (let i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0) return i; } return 0; };

/** Total ambient vehicles by graphics profile (a ceiling; the hour and districts decide how much of it is used). */
export const TRAFFIC_BUDGET = { low: 70, medium: 130, high: 190, ultra: 240 };
export const TIER = { near: 150, mid: 340 };
const IDM = { b: 2.6, s0: 2.4, T: 1.25 };
const LANE_BY_ROAD = new Map(); for (const l of LANES) LANE_BY_ROAD.set(l.road.id + ':' + l.from, l.id);
const reverseLane = l => SEGMENTS[LANE_BY_ROAD.get(l.road.id + ':' + l.to)];
// Bus stops on the right of a lane (buses pull in and wait).
const STOPS_BY_LANE = new Map();
for (const f of FURNITURE) if (f.kind === 'busstop') {
  let best = null, bd = 3.2;
  for (const l of LANES) {
    const p0 = l.pts[0], s = (f.x - p0.x) * l.dir.x + (f.z - p0.z) * l.dir.z; if (s < 14 || s > l.len - 14) continue;
    const lat = -(f.x - p0.x) * l.dir.z + (f.z - p0.z) * l.dir.x; // metres right of the lane centre
    const d = Math.abs(lat - 2.1); if (d < bd) { bd = d; best = { lane: l.id, s: s + 3, stop: f.id }; }
  }
  if (best) { if (!STOPS_BY_LANE.has(best.lane)) STOPS_BY_LANE.set(best.lane, []); STOPS_BY_LANE.get(best.lane).push(best); }
}
const CONN_TO = new Map(); for (const sg of SEGMENTS) if (sg.kind === 'conn') { if (!CONN_TO.has(sg.outLane)) CONN_TO.set(sg.outLane, []); CONN_TO.get(sg.outLane).push(sg.id); }
const crossingsAt = new Map(); for (const c of CROSSWALKS) { if (!crossingsAt.has(c.node)) crossingsAt.set(c.node, []); crossingsAt.get(c.node).push(c); }

function polyline(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i])); return { pts, cum, len: cum.at(-1) }; }
function bez(p0, c, p1, n = 10) { return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, z: u * u * p0.z + 2 * u * t * c.z + t * t * p1.z }; }); }
function along(poly, s) { return pointAt(poly, s, 0); }

export function createTraffic({ seed = 1, quality = 'medium', hour = 17.5 } = {}) {
  const t = { r: mulberry(seed), list: /** @type {any[]} */ ([]), nextId: 1, time: 0, frame: 0, hour, quality, events: /** @type {any[]} */ ([]), bayTaken: new Map(), garageStock: GARAGES.map(() => 2), blockedLanes: new Map(), reserved: new Map(), load: new Map(), stats: { spawned: 0, despawned: 0, parkings: 0, junctionEntries: 0, redRuns: 0, amberClears: 0, crashes: 0, overtakes: 0, uturns: 0, redStops: 0 }, frozen: false };
  // Start with the city already running: parked cars in about half the bays, moving traffic spread over the lanes.
  for (const bay of BAYS) if (t.r() < .55) spawnParked(t, bay);
  fill(t, null, true);
  return t;
}
function budget(t) { return TRAFFIC_BUDGET[t.quality] ?? TRAFFIC_BUDGET.medium; }
/** Target moving vehicles per district for the current hour. */
function targets(t) {
  const out = {}, act = activityAt(t.hour, 'traffic');
  let total = 0; const lenBy = {};
  for (const l of LANES) { const w = DISTRICT_PROFILE[l.district].traffic * l.len; lenBy[l.district] = (lenBy[l.district] ?? 0) + w; total += w; }
  for (const d in lenBy) out[d] = Math.round(budget(t) * act * lenBy[d] / total);
  return out;
}
function paintFor(t, cls) { return LIVERY[cls] ?? PAINTS[pickIndex(t.r, PAINT_WEIGHTS)]; }
function make(t, cls, district) {
  const c = CITY_CLASSES[cls];
  return { id: 'cv' + t.nextId++, cls, district, len: c.length, wid: c.width, wb: c.wheelbase, a: c.accel * (.85 + t.r() * .3), vmax: c.max, drive: .88 + t.r() * .22, paint: paintFor(t, cls),
    seg: 0, s: 0, prev: -1, path: [], pi: 0, v: 0, lat: 0, latT: 0, state: 'drive', until: 0, goal: null, x: 0, z: 0, yaw: 0, steer: 0, pitch: 0, roll: 0, brake: false, ind: 0, hazard: false, horn: 0, honkAt: 0, siren: false, blockedT: 0, free: null, freeS: 0, reverse: false, tierAcc: 0, lastV: 0, accel: 0, committed: -1, impact: 0, flee: false, stopAt: -1, wait: 0, seed: t.r() };
}
function chooseClass(t, district) { return pick(t.r, CLASS_MIX[district] ?? CLASS_MIX.downtown); }

function spawnParked(t, bay) {
  const cls = pick(t.r, { sedan: 4, hatch: 4, suv: 3, pickup: bay.district === 'industrial' ? 2 : 1, police: bay.kind === 'police' ? 8 : 0, taxi: 1, sports: 1 });
  const v = make(t, cls, bay.district);
  v.state = 'parked'; v.until = 20 + t.r() * 260; v.bay = bay.id; t.bayTaken.set(bay.id, v.id);
  v.x = bay.x; v.z = bay.z; v.yaw = bay.yaw; v.seg = bay.lane; v.s = bay.s;
  t.list.push(v); t.stats.spawned++;
  return v;
}
/** Out of every player's view: far away, or behind them and not too close. */
function hidden(p, players, min = 150) {
  for (const q of players) {
    const d = dist(p, q); if (d < 45) return false;
    if (d < min) { const ahead = Math.abs(wrap(Math.atan2(p.x - q.x, p.z - q.z) - (q.view ?? q.yaw ?? 0))) < 1.25; if (ahead) return false; }
  }
  return true;
}
/** Pulling out but not yet on the carriageway (does not block the lane yet). */
const pending = o => (o.state === 'unpark' || o.state === 'exit' || o.state === 'unpark-rev') && (o.state === 'unpark-rev' || o.freeS < 1.5);
function laneClear(t, lane, s, before = 14, after = 10) {
  for (const o of t.list) if (o.state !== 'parked' && !pending(o) && o.seg === lane && o.s > s - before && o.s < s + after) return false;
  return true;
}
function spawnMoving(t, district, players, initial) {
  for (let k = 0; k < 14; k++) {
    const lanes = LANES.filter(l => l.district === district && l.len > 30);
    if (!lanes.length) return null;
    const lane = lanes[Math.floor(t.r() * lanes.length)], s = 8 + t.r() * (lane.len - 16), p = pointAt(lane, s);
    if (!initial && !hidden(p, players, 230)) continue;
    if (!laneClear(t, lane.id, s, 18, 14)) continue;
    const cls = chooseClass(t, district), v = make(t, cls, district);
    v.seg = lane.id; v.s = s; v.v = lane.speed * .6; v.path = [lane.id]; v.pi = 0;
    newGoal(t, v);
    pose(v); t.list.push(v); t.stats.spawned++;
    return v;
  }
  return null;
}
function spawnFromGarage(t, players) {
  const g = GARAGES[Math.floor(t.r() * GARAGES.length)]; if (!g || t.garageStock[g.id] <= 0) return null;
  if (!hidden(g, players, 90)) return null;
  if (!laneClear(t, g.lane, g.s, 30, 12) || t.list.some(o => o.state !== 'parked' && Math.hypot(o.x - g.x, o.z - g.z) < 10)) return null;
  const v = make(t, chooseClass(t, g.district), g.district);
  t.garageStock[g.id]--;
  const lane = SEGMENTS[g.lane], out = pointAt(lane, g.s + 9), inside = { x: g.x + Math.sin(g.yaw + Math.PI) * 4, z: g.z + Math.cos(g.yaw + Math.PI) * 4 };
  v.free = polyline([inside, ...bez({ x: g.x, z: g.z }, { x: g.x + Math.sin(g.yaw) * 6, z: g.z + Math.cos(g.yaw) * 6 }, out, 10)]); v.freeS = 0;
  v.state = 'exit'; v.seg = g.lane; v.s = g.s + 9; v.exitS = g.s + 9; v.ind = -1; v.garageFrom = g.id;
  pose(v); t.list.push(v); t.stats.spawned++; return v;
}
function spawnFromPortal(t, players) {
  const node = PORTALS[Math.floor(t.r() * PORTALS.length)]; if (!node) return null;
  const lane = LANES.find(l => l.from === node); if (!lane) return null;
  if (!hidden(lane.pts[0], players, 120) || !laneClear(t, lane.id, 0, 0, 30)) return null;
  const district = 'outskirts', v = make(t, chooseClass(t, district), district);
  v.seg = lane.id; v.s = 2; v.v = 12; v.path = [lane.id]; newGoal(t, v); pose(v); t.list.push(v); t.stats.spawned++; return v;
}
function fill(t, players, initial = false) {
  const want = targets(t), have = {};
  let moving = 0;
  for (const v of t.list) if (v.state !== 'parked') { have[v.district] = (have[v.district] ?? 0) + 1; moving++; }
  // Never beyond the profile's budget for this hour, whatever the districts ask for.
  let room = Math.round(budget(t) * activityAt(t.hour, 'traffic')) - moving;
  if (room <= 0 && !initial) return;
  let n = 0;
  for (const d in want) {
    let missing = want[d] - (have[d] ?? 0);
    while (missing-- > 0 && n < (initial ? 999 : 2)) {
      let v = null;
      if (!initial) {
        const u = t.r();
        v = u < .25 ? spawnFromGarage(t, players) : u < .4 ? spawnFromPortal(t, players) : null;
        // Or a parked car in this district sets off a little earlier than planned.
        if (!v && u < .6) { const parked = t.list.find(o => o.state === 'parked' && o.district === d && o.until > t.time + 20); if (parked) parked.until = t.time; }
      }
      v ??= spawnMoving(t, d, players ?? [], initial);
      if (v) { n++; if (--room <= 0) return; } else break;
    }
  }
}

// ------------------------------------------------------------------ goals and routing
/** Bays are car-sized: vans, trucks, buses and motorcycles do not use them. */
const BAY_CLASSES = new Set(['sedan', 'hatch', 'suv', 'sports', 'taxi', 'pickup', 'police']);
function newGoal(t, v) {
  const u = t.r(), here = v.seg;
  let goal = null;
  if (v.cls === 'bus' || v.cls === 'police' || v.cls === 'taxi' && u < .5) goal = { type: 'cruise' };
  else if (u < .38) {
    const free = BAY_CLASSES.has(v.cls) ? BAYS.filter(b => !t.bayTaken.has(b.id)) : [];
    if (free.length) { const b = free[Math.floor(t.r() * free.length)]; goal = { type: 'bay', id: b.id, lane: b.lane }; t.bayTaken.set(b.id, v.id); }
  } else if (u < .6 && GARAGES.length) { const g = GARAGES[Math.floor(t.r() * GARAGES.length)]; goal = { type: 'garage', id: g.id, lane: g.lane }; }
  else if (u < .72 && PORTALS.length) { const node = PORTALS[0]; const lane = LANES.find(l => l.to === node); if (lane) goal = { type: 'portal', lane: lane.id }; }
  goal ??= { type: 'cruise' };
  if (goal.type === 'cruise') {
    // Police patrol their own districts; others drive somewhere a few blocks away.
    const pool = LANES.filter(l => (v.cls !== 'police' || l.district === 'security' || l.district === 'downtown') && dist(l.pts[0], SEGMENTS[here].pts[0]) > 120 && dist(l.pts[0], SEGMENTS[here].pts[0]) < 520);
    const l = pool[Math.floor(t.r() * pool.length)] ?? LANES[Math.floor(t.r() * LANES.length)]; goal.lane = l.id;
  }
  v.goal = goal;
  replan(t, v);
}
function avoidSet(t) { const s = new Set(); for (const [id, until] of t.blockedLanes) { if (t.time > until) t.blockedLanes.delete(id); else s.add(id); } return s; }
function replan(t, v) {
  const avoid = avoidSet(t); avoid.delete(v.seg);
  const busy = id => (t.load.get(id) ?? 0) * 2.8;
  let p = v.goal.lane === v.seg ? [v.seg] : route(v.seg, v.goal.lane, avoid.size ? avoid : null, busy) ?? route(v.seg, v.goal.lane);
  if (!p) { // Unreachable: just keep driving and pick again later.
    const next = SEGMENTS[v.seg].next; p = [v.seg, ...(next.length ? [next[Math.floor(t.r() * next.length)]] : [])];
    if (v.goal.type === 'bay') t.bayTaken.delete(v.goal.id);
    v.goal = { type: 'cruise', lane: p.at(-1) };
  }
  v.path = p; v.pi = 0;
}
/** The segment after the path's end (continue somewhere sensible while a new goal is chosen). */
function ensurePath(t, v) {
  if (v.pi < v.path.length - 1) return;
  const seg = SEGMENTS[v.seg];
  if (seg.kind === 'lane' && v.goal && v.goal.lane === seg.id && v.goal.type === 'cruise') newGoal(t, v);
  if (v.pi >= v.path.length - 1 && seg.next.length) { const next = seg.next.filter(n => SEGMENTS[n].turn !== 'uturn'); const n = (next.length ? next : seg.next)[Math.floor(t.r() * (next.length || seg.next.length))]; v.path.push(n); }
}

// ------------------------------------------------------------------ geometry
function segPoint(segId, s) { return pointAt(SEGMENTS[segId], s); }
/** A point `ds` metres from the vehicle's centre along its route (negative: behind, through the previous segment). */
function routePoint(v, ds) {
  if (v.free) { const p = v.freeS + ds; if (p < 0) { const a = along(v.free, 0), b = along(v.free, .5); const k = p; return { x: a.x + (a.x - b.x) * 2 * -k, z: a.z + (a.z - b.z) * 2 * -k }; } if (p > v.free.len) { const a = along(v.free, v.free.len), y = a.yaw, k = p - v.free.len; return { x: a.x + Math.sin(y) * k, z: a.z + Math.cos(y) * k }; } return along(v.free, p); }
  let s = v.s + ds, i = v.pi, seg = SEGMENTS[v.seg];
  if (s < 0) { if (v.prev >= 0) { const pr = SEGMENTS[v.prev]; return pointAt(pr, Math.max(0, pr.len + s)); } const a = pointAt(seg, 0); return { x: a.x - Math.sin(a.yaw) * -s, z: a.z - Math.cos(a.yaw) * -s, yaw: a.yaw }; }
  while (s > seg.len && i < v.path.length - 1) { s -= seg.len; i++; seg = SEGMENTS[v.path[i]]; }
  return pointAt(seg, s);
}
function pose(v) {
  const f = routePoint(v, v.wb / 2), r = routePoint(v, -v.wb / 2);
  const travel = Math.atan2(f.x - r.x, f.z - r.z);
  // Lateral offset to the right of travel: right of heading y is (-cos y, sin y) in this frame.
  v.x = (f.x + r.x) / 2 - Math.cos(travel) * v.lat;
  v.z = (f.z + r.z) / 2 + Math.sin(travel) * v.lat;
  const ff = routePoint(v, v.wb / 2 + 2.5), fy = Math.atan2(ff.x - f.x, ff.z - f.z);
  v.steer = clamp(wrap(fy - travel) * 1.4, -.6, .6);
  // Reversing out of a bay: the body faces back along the path.
  v.yaw = v.reverse ? wrap(travel + Math.PI) : travel;
}

// ------------------------------------------------------------------ the driving step
function leaderGap(t, v, occ, look) {
  // Nearest vehicle ahead on this segment and the next ones along the path, within `look` metres.
  let gap = Infinity, lv = 0, who = null, base = -v.s;
  for (let k = 0, i = v.pi; k < 4 && i < v.path.length; k++, i++) {
    const id = v.path[i], list = occ.get(id);
    if (list) for (const o of list) {
      if (o === v || (k === 0 && o.s <= v.s)) continue;
      const g = base + o.s - (o.len + v.len) / 2;
      if (g < gap) { gap = g; lv = o.v; who = o; }
    }
    base += SEGMENTS[id].len;
    if (base > look) break;
  }
  return { gap, lv, who };
}
function nearAhead(v, grid) {
  let gap = Infinity, lv = 0, who = null;
  const gx = Math.floor(v.x / 12), gz = Math.floor(v.z / 12), sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
  for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) for (const o of grid.get(ix * 7919 + iz) ?? []) {
    if (o === v) continue;
    // Crossing traffic is the junction rules' business; this guards against same-direction traffic and against
    // vehicles manoeuvring, parked half out of a bay, crashed or abandoned.
    const special = o.free || o.state === 'disabled' || o.state === 'abandoned' || o.state === 'crashed';
    if (!special && Math.cos(o.yaw - v.yaw) < .5) continue;
    if ((o.state === 'parked' && !v.free) || pending(o)) continue;
    const dx = o.x - v.x, dz = o.z - v.z, ahead = dx * sy + dz * cy, side = Math.abs(dx * cy - dz * sy);
    // The other's half-extent across my direction of travel.
    const rel = Math.abs(Math.sin(o.yaw - v.yaw)), half = (o.wid / 2) * (1 - rel) + (o.len / 2) * rel;
    if (ahead <= .5 || side > v.wid / 2 + half + .25) continue;
    const along = (o.len / 2) * (1 - rel) + (o.wid / 2) * rel, g = ahead - v.len / 2 - along;
    if (g < gap && g < 14) { gap = g; lv = Math.max(0, o.v * Math.cos(o.yaw - v.yaw)); who = o; }
  }
  return { gap, lv, who };
}
function idm(v, v0, gap, dv) {
  const ss = IDM.s0 + Math.max(0, v.v * IDM.T + v.v * dv / (2 * Math.sqrt(v.a * IDM.b)));
  const free = 1 - Math.pow(Math.max(0, v.v) / Math.max(.1, v0), 4);
  const inter = gap < Infinity ? (ss / Math.max(.1, gap)) ** 2 : 0;
  return v.a * (free - inter);
}
/** Whether this vehicle may enter junction connector `c` now. Returns '' if yes, else the reason. */
function mayEnter(t, v, c, ctx, dStop) {
  const j = JUNCTION.get(c.node), lane = SEGMENTS[c.inLane];
  if (j.control === 'signal') {
    const a = signalAspect(j, lane.axis, t.time);
    if (a === 'red') return 'red';
    if (a === 'amber' && dStop > v.v * v.v / (2 * 3.6) + 1 && signalRemaining(j, lane.axis, t.time) < 2.8) return 'amber';
  }
  // Someone already in a conflicting movement through the junction.
  for (const id of c.conflicts) {
    const list = ctx.occ.get(id); if (list && list.some(o => o !== v && o.state !== 'parked')) return 'conflict';
    const r = t.reserved.get(id); if (r && r !== v.id) return 'conflict';
  }
  // Priority: the side road (avenues 'v') gives way to the main road ('h'); left turns give way to oncoming traffic.
  const rank = s => (s.turn === 'straight' ? 3 : s.turn === 'right' ? 2 : s.turn === 'left' ? 1 : 0) + (j.control === 'priority' && SEGMENTS[s.inLane].axis === 'h' ? 4 : 0);
  for (const id of c.conflicts) {
    const other = SEGMENTS[id], l = ctx.occ.get(other.inLane); if (!l) continue;
    if (j.control === 'signal' && signalAspect(j, SEGMENTS[other.inLane].axis, t.time) === 'red') continue;
    if (rank(other) <= rank(c)) continue;
    for (const o of l) {
      if (o === v || o.state !== 'drive' || !o.path.includes(id)) continue;
      const left = SEGMENTS[other.inLane].len - o.s, eta = left / Math.max(1.5, o.v);
      if (left < 45 && eta < 4.2 && o.v > .6) return 'yield';
    }
  }
  // Pedestrians on, or stepping onto, the crosswalks this movement drives over.
  for (const cw of crossingsAt.get(c.node) ?? []) {
    const near = c.pts.some(p => Math.abs(p.x - cw.x) < 5.5 && Math.abs(p.z - cw.z) < 5.5) || dist(c.pts.at(-1), cw) < 5 || dist(c.pts[0], cw) < 5;
    if (!near) continue;
    for (const p of ctx.walkers) if (Math.abs(p.x - cw.x) < (cw.axis === 'v' ? 4.6 : 2) && Math.abs(p.z - cw.z) < (cw.axis === 'h' ? 4.6 : 2)) return 'pedestrian';
  }
  // Room to clear the junction on the far side (never block the box).
  // Room on the exit lane for this vehicle, after everything already queued or inside the junction heading there.
  let room = SEGMENTS[c.outLane].len;
  for (const o of ctx.occ.get(c.outLane) ?? []) room = Math.min(room, o.s - o.len / 2 + (o.v > 4 ? o.v * 1.2 : 0));
  for (const s of SEGMENTS[c.inLane].next.length ? CONN_TO.get(c.outLane) : []) for (const o of ctx.occ.get(s) ?? []) if (o !== v) room -= o.len + 2.4;
  if (room < Math.min(v.len + 2.6, SEGMENTS[c.outLane].len - .5)) return 'full';
  return '';
}
/** External obstacles (players, their cars, mission and harbour vehicles, people on the road) in this vehicle's path. */
function obstacleGap(v, ctx, look) {
  let gap = Infinity, ov = 0, kind = null;
  const hw = v.wid / 2 + .35;
  for (const o of ctx.obstacles) {
    if (Math.abs(o.x - v.x) > look + 8 || Math.abs(o.z - v.z) > look + 8) continue;
    for (let ds = 1; ds <= look; ds += 2.2) {
      const p = routePoint(v, v.len / 2 * 0 + ds);
      const lat = Math.hypot(o.x - p.x, o.z - p.z);
      if (lat < hw + o.r) { const g = ds - v.len / 2 - o.r; if (g < gap) { gap = g; ov = o.v ?? 0; kind = o.kind; } break; }
    }
  }
  return { gap, ov, kind };
}
function startFree(v, pts, state) { v.free = polyline(pts); v.freeS = 0; v.state = state; }

function stepVehicle(t, v, dt, ctx) {
  // Parked: wait, then pull out when the lane behind is clear.
  if (v.state === 'parked') {
    if (t.time < v.until) return;
    const bay = BAYS[v.bay], lane = SEGMENTS[bay.lane];
    if (!laneClear(t, bay.lane, bay.s, 28, 10) || t.list.some(o => o !== v && o.state !== 'parked' && Math.hypot(o.x - bay.x, o.z - bay.z) < 9)) { v.until = t.time + 2; return; }
    const back = { x: bay.x - Math.sin(bay.yaw) * 3.4, z: bay.z - Math.cos(bay.yaw) * 3.4 };
    v.reverse = true; startFree(v, [{ x: bay.x, z: bay.z }, back], 'unpark-rev'); v.ind = -1; v.seg = bay.lane; v.s = bay.s; v.v = 0;
    v.exitS = bay.s + 8; v.nextFree = [back, ...bez(back, pointAt(lane, bay.s + 1), pointAt(lane, bay.s + 8), 8).slice(1)];
    t.bayTaken.delete(bay.id); v.bay = -1; v.district = bay.district; v.goal = null;
    return;
  }
  if (v.state === 'crashed' || v.state === 'disabled' || v.state === 'abandoned') { v.v = Math.max(0, v.v - 9 * dt); if (v.state === 'crashed' && t.time > v.until) { v.state = 'drive'; v.hazard = false; } if (v.state !== 'drive') { pose(v); return; } }

  const seg = SEGMENTS[v.seg];
  ctx.obstacleCheck = ctx.near;
  // Free manoeuvres: into and out of bays and garages, U-turns.
  if (v.free) {
    const target = v.state === 'unpark-rev' ? 1.6 : v.state === 'uturn' ? 3 : 3.6;
    // Pulling onto the road: wait for a gap.
    if ((v.state === 'unpark' || v.state === 'exit') && v.freeS < 1.5 && (!laneClear(t, v.seg, v.exitS, 48, 10) || t.list.some(o => o !== v && (o.state === 'park' || o.state === 'unpark' || o.state === 'garage' || o.state === 'exit') && o.freeS > 0 && Math.hypot(o.x - v.x, o.z - v.z) < 9))) { v.v = 0; v.brake = true; pose(v); return; }
    const o = ctx.near ? obstacleGap(v, ctx, 6) : { gap: Infinity }, q = v.reverse ? { gap: Infinity } : nearAhead(v, ctx.grid);
    const want = o.gap < 2.5 || q.gap < 1.8 ? 0 : target;
    v.v += clamp(want - v.v, -4 * dt, 1.6 * dt); v.brake = want < v.v;
    // A manoeuvre that cannot finish (something parked in the way): when nobody is watching, it is completed.
    v.freeStuck = want === 0 && v.state !== 'unpark' && v.state !== 'exit' ? (v.freeStuck ?? 0) + dt : 0;
    if (v.freeStuck > 12 && hidden(v, ctx.players, 120)) { if (v.state === 'park' && v.bay >= 0) t.bayTaken.delete(v.bay); v.gone = true; return; }
    v.freeS += v.v * dt; pose(v);
    if (v.freeS >= v.free.len - .05) {
      if (v.state === 'unpark-rev') { v.reverse = false; startFree(v, v.nextFree, 'unpark'); pose(v); return; }
      if (v.state === 'park') { v.free = null; v.state = 'parked'; v.until = t.time + 40 + t.r() * 300; v.v = 0; v.ind = 0; t.stats.parkings++; const b = BAYS[v.bay]; v.x = b.x; v.z = b.z; v.yaw = b.yaw; return; }
      if (v.state === 'garage') { v.gone = true; t.garageStock[v.garage] = (t.garageStock[v.garage] ?? 0) + 1; return; }
      // Back on the lane (after pulling out or a U-turn).
      v.free = null; v.state = 'drive'; v.s = v.exitS; v.v = Math.max(v.v, 2); v.ind = 0; v.path = [v.seg]; v.pi = 0;
      if (!v.goal) newGoal(t, v); else replan(t, v);
      pose(v);
    }
    return;
  }

  ensurePath(t, v);
  const look = clamp(10 + v.v * 3, 18, 70);
  let v0 = Math.min(seg.speed, v.vmax) * v.drive * (v.flee ? 1.35 : 1);
  // Slow for the next connector's curve.
  let dEnd = seg.len - v.s, a = idm(v, v0, Infinity, 0), reason = '';
  const next = v.path[v.pi + 1] !== undefined ? SEGMENTS[v.path[v.pi + 1]] : null;
  if (next && next.speed < v0) { const lim = Math.sqrt(next.speed * next.speed + 2 * 2.2 * Math.max(0, dEnd - 1)); if (lim < v.v) a = Math.min(a, -(v.v * v.v - lim * lim) / (2 * Math.max(1, dEnd))); }
  // Junction entry.
  if (seg.kind === 'lane' && next && next.kind === 'conn' && v.committed !== next.id) {
    if (dEnd < Math.max(30, v.v * v.v / 3 + 10)) {
      reason = mayEnter(t, v, next, ctx, dEnd);
      if (!reason) { if (dEnd < Math.max(4, v.v * 1.2)) { v.committed = next.id; t.reserved.set(next.id, v.id); const cj = JUNCTION.get(next.node); v.clearedOn = cj.control === 'signal' ? signalAspect(cj, seg.axis, t.time) : 'free'; } }
      else { a = Math.min(a, idm(v, v0, Math.max(.1, dEnd + IDM.s0 - 1.2), v.v)); if (reason === 'red' && v.v < .2 && dEnd < 12) v.redWait = true; }
    }
    if (JUNCTION.get(next.node).control === 'priority' && seg.axis === 'v' && dEnd < 14) a = Math.min(a, (3 - v.v) * 1.5); // give way: slow right down
  }
  // Leader on the path.
  const L = leaderGap(t, v, ctx.occ, look);
  // Anything else close in front (a car that took another turn from the same lane, one manoeuvring in or out
  // of a bay or garage): treat the nearest as a leader too.
  const P = nearAhead(v, ctx.grid);
  if (P.gap < L.gap) { L.gap = P.gap; L.lv = P.lv; L.who = P.who; L.near = true; }
  // A leader turning across (into a bay or garage) sweeps its corners: keep extra room.
  if (L.who?.free) L.gap -= 2;
  if (L.gap < Infinity) a = Math.min(a, idm(v, v0, Math.max(.1, L.gap), v.v - L.lv));
  // Bus stops and parking.
  const stops = v.cls === 'bus' ? STOPS_BY_LANE.get(v.seg) : null;
  if (stops) for (const st of stops) {
    const d = st.s - v.s;
    if (d > -1 && d < 40 && v.stopAt !== st.stop + ':' + v.seg) { v.latT = 1.7; v.ind = 1; a = Math.min(a, idm(v, v0, Math.max(.1, d + IDM.s0 - .3), v.v)); if (d < .9 && v.v < .3) { v.stopAt = st.stop + ':' + v.seg; v.wait = t.time + 9 + t.r() * 6; v.dwell = st.stop; } }
  }
  if (v.wait > t.time) { a = -6; v.ind = 1; } else if (v.dwell != null && v.wait <= t.time) { v.dwell = null; v.latT = 0; v.ind = 0; }
  if (v.goal && (v.goal.type === 'bay' || v.goal.type === 'garage') && v.goal.lane === v.seg) {
    const spot = v.goal.type === 'bay' ? BAYS[v.goal.id] : GARAGES[v.goal.id], d = spot.s - 7 - v.s;
    v.ind = d < 45 ? 1 : v.ind;
    if (d > -2 && d < 40) a = Math.min(a, idm(v, v0, Math.max(.1, d + IDM.s0 - .3), v.v));
    const busySpot = t.list.some(o => o !== v && o.state !== 'parked' && o.state !== 'drive' && !pending(o) && Math.hypot(o.x - spot.x, o.z - spot.z) < 11);
    if (busySpot && d < 3) a = Math.min(a, -4);
    if (d < 1.2 && d > -4 && v.v < 2.2 && !busySpot && L.gap > 5.5) {
      const from = pointAt(seg, v.s), end = { x: spot.x, z: spot.z }, ctrl = { x: end.x - Math.sin(spot.yaw) * 4.5, z: end.z - Math.cos(spot.yaw) * 4.5 };
      // Into a bay: curve round to line up square with it 5 m out, then straight in between the neighbours.
      const front = { x: end.x - Math.sin(spot.yaw) * 5.2, z: end.z - Math.cos(spot.yaw) * 5.2 };
      const c1 = seg.axis === 'v' ? { x: from.x, z: front.z } : { x: front.x, z: from.z };
      if (v.goal.type === 'bay') { v.bay = spot.id; startFree(v, [...bez(from, c1, front, 10), ...bez(front, { x: (front.x + end.x) / 2, z: (front.z + end.z) / 2 }, end, 4).slice(1)], 'park'); }
      else {
        v.garage = spot.id;
        // Someone still waiting inside this door to come out stays in for now.
        for (const o of t.list) if (o.state === 'exit' && o.garageFrom === spot.id && pending(o)) { o.gone = true; t.garageStock[spot.id]++; }
        startFree(v, [...bez(from, ctrl, end, 10), { x: end.x + Math.sin(spot.yaw) * 5, z: end.z + Math.cos(spot.yaw) * 5 }], 'garage'); }
      pose(v); return;
    }
  }
  if (v.goal?.type === 'portal' && v.goal.lane === v.seg && dEnd < 4) { v.gone = true; return; }
  // Players, their cars, police units, people on the carriageway.
  let ext = { gap: Infinity, ov: 0, kind: null };
  if (ctx.near) {
    ext = obstacleGap(v, ctx, look);
    if (ext.gap < Infinity) a = Math.min(a, idm(v, v0, Math.max(.1, ext.gap), v.v - ext.ov));
    // A danger close in front: emergency brake and a horn.
    if (ext.gap < 6 && v.v > 3) { a = Math.min(a, -8.5); if (t.time > v.honkAt) { v.honkAt = t.time + 3.5; t.events.push({ kind: 'horn', x: v.x, z: v.z, id: v.id }); } }
  }
  // Sirens behind or approaching: indicate, pull to the right and stop until they pass (never inside a junction).
  const siren = ctx.sirens.find(u => dist(u, v) < 48);
  if (siren && seg.kind === 'lane' && dEnd > 8 && v.s > 6) { v.latT = 1.6; a = Math.min(a, -3.5); v.yielding = t.time + 2.5; v.ind = 1; }
  else if (v.yielding && t.time > v.yielding) { v.yielding = 0; v.latT = 0; v.ind = 0; }
  // Overtake a stationary obstruction (a disabled car, a stopped player) when the opposite lane is clear.
  const stuckBehind = (L.who && (L.who.state === 'disabled' || L.who.state === 'abandoned' || L.who.state === 'crashed') && L.gap < 12) || (ext.kind && ext.ov < .3 && ext.gap < 10 && ext.kind !== 'person');
  v.blockedT = v.v < .4 && !reason && (stuckBehind || (L.who && L.who.blockedT > 4 && L.gap < 10)) ? v.blockedT + dt : 0;
  if (stuckBehind && v.blockedT > 1.5 && seg.kind === 'lane' && dEnd > 22 && !v.overtaking) {
    const rev = reverseLane(seg), at = rev.len - v.s;
    const oncoming = (ctx.occ.get(rev.id) ?? []).some(o => o.s > at - 45 && o.s < at + 12) || ctx.obstacles.some(o => o.kind === 'vehicle' && Math.hypot(o.x - v.x, o.z - v.z) < 30 && Math.abs(wrap(o.yaw - v.yaw)) > 2.2);
    if (!oncoming) { v.overtaking = v.s + 22; v.latT = -LANE_OFFSET * 2 + .2; t.stats.overtakes++; v.ind = -1; }
  }
  if (v.overtaking) {
    a = Math.max(a, Math.min(1.2, idm(v, 6, Infinity, 0)));
    if (v.s > v.overtaking || seg.kind !== 'lane' || dEnd < 14) { v.overtaking = 0; v.latT = 0; v.ind = 0; }
  }
  // Still stuck: turn round and route another way (and let the city know the lane is blocked for a while).
  if (v.blockedT > 9 && seg.kind === 'lane' && !v.overtaking) {
    const rev = reverseLane(seg), at = rev.len - v.s;
    if (at > 6 && at < rev.len - 10 && laneClear(t, rev.id, at, 20, 12)) {
      t.blockedLanes.set(seg.id, t.time + 75);
      const c = pointAt(seg, v.s), mid = { x: c.x + Math.sin(c.yaw) * 4 - (-Math.cos(c.yaw)) * 0, z: c.z + Math.cos(c.yaw) * 4 }, end = pointAt(rev, at + 5);
      // (left of travel, across the centreline)
      const left = { x: Math.cos(c.yaw) * 1, z: -Math.sin(c.yaw) * 1 };
      startFree(v, [c, ...bez(c, { x: mid.x + left.x * 2, z: mid.z + left.z * 2 }, { x: (c.x + end.x) / 2 + left.x * 0 + Math.sin(c.yaw) * 3.5, z: (c.z + end.z) / 2 + Math.cos(c.yaw) * 3.5 }, 6).slice(1), ...bez({ x: (c.x + end.x) / 2 + Math.sin(c.yaw) * 3.5, z: (c.z + end.z) / 2 + Math.cos(c.yaw) * 3.5 }, { x: end.x + Math.sin(c.yaw) * 3, z: end.z + Math.cos(c.yaw) * 3 }, end, 6).slice(1)], 'uturn');
      v.seg = rev.id; v.exitS = at + 5; v.prev = -1; v.blockedT = 0; v.ind = -1; t.stats.uturns++;
      if (v.goal?.type === 'bay') t.bayTaken.delete(v.goal.id);
      v.goal = null; pose(v); return;
    }
  }
  // Integrate.
  v.why = reason || (L.gap < 8 ? (L.near ? 'near' : 'leader') : ext.gap < 8 ? 'obstacle' : '');
  v.leader = L.gap < 8 ? L.who?.id : null; v.stillT = v.v < .2 ? (v.stillT ?? 0) + dt : 0;
  a = clamp(a, -9, v.a);
  const before = v.v;
  v.v = Math.max(0, v.v + a * dt);
  v.accel = (v.v - before) / Math.max(dt, 1e-3);
  v.brake = a < -.6 || (v.v < .1 && (reason || L.gap < 4));
  if (reason === 'red' && v.v < .1 && !v.countedRed) { v.countedRed = true; t.stats.redStops++; }
  if (v.v > 2) v.countedRed = false;
  v.lat += clamp(v.latT - v.lat, -1.6 * dt, 1.6 * dt);
  v.s += v.v * dt;
  // Advance across segments.
  let guard = 0;
  while (v.s > SEGMENTS[v.seg].len && guard++ < 6) {
    const cur = SEGMENTS[v.seg];
    if (v.pi >= v.path.length - 1) ensurePath(t, v);
    if (v.pi >= v.path.length - 1) { v.s = cur.len; v.v = 0; break; }
    // Nobody crosses a stop line without having been cleared to (a long update step could otherwise skip the check).
    const nx = SEGMENTS[v.path[v.pi + 1]];
    if (cur.kind === 'lane' && nx.kind === 'conn' && v.committed !== nx.id) {
      if (mayEnter(t, v, nx, ctx, 0)) { v.s = cur.len - .05; v.v = 0; break; }
      v.committed = nx.id; t.reserved.set(nx.id, v.id); const nj = JUNCTION.get(nx.node); v.clearedOn = nj.control === 'signal' ? signalAspect(nj, cur.axis, t.time) : 'free';
    }
    v.s -= cur.len; v.prev = v.seg; v.pi++; v.seg = v.path[v.pi];
    if (SEGMENTS[v.seg].kind === 'lane') { if (t.reserved.get(v.prev) === v.id) t.reserved.delete(v.prev); v.committed = -1; v.district = SEGMENTS[v.seg].district; if (v.goal?.type === 'cruise' && v.goal.lane === v.seg) newGoal(t, v); }
    if (SEGMENTS[v.seg].kind === 'conn') {
      // A vehicle cleared on green or amber may still be crossing as the lights change (the all-red clears it).
      const cj = JUNCTION.get(SEGMENTS[v.seg].node); t.stats.junctionEntries++;
      if (cj.control === 'signal' && signalAspect(cj, SEGMENTS[v.prev].axis, t.time) === 'red') { if (v.clearedOn === 'red') t.stats.redRuns++; else t.stats.amberClears++; }
    }
    if (SEGMENTS[v.seg].kind === 'conn') v.ind = SEGMENTS[v.seg].turn === 'left' ? -1 : SEGMENTS[v.seg].turn === 'right' ? 1 : 0;
    else if (!v.yielding && !v.overtaking && v.goal?.lane !== v.seg) v.ind = 0;
  }
  // Keep the path short.
  if (v.pi > 3) { v.path.splice(0, v.pi - 1); v.pi = 1; }
  pose(v);
}

// ------------------------------------------------------------------ reactions to the world
/** Something the drivers react to: kind 'gunfire' | 'explosion' | 'crash' | 'siren'. */
export function trafficIncident(t, kind, at, strength = 1) {
  const radius = kind === 'explosion' ? 80 : kind === 'gunfire' ? 55 : 30;
  for (const v of t.list) {
    const d = dist(v, at); if (d > radius) continue;
    if (v.state === 'parked' || v.free) continue;
    if (kind === 'explosion' && d < 24 * strength && v.cls !== 'bus' && v.cls !== 'police') {
      // Close to a blast: the driver bails out and runs.
      v.state = 'abandoned'; v.hazard = true; v.v *= .3; t.events.push({ kind: 'bail', x: v.x, z: v.z, yaw: v.yaw, id: v.id });
      continue;
    }
    if (kind === 'gunfire' || kind === 'explosion') {
      v.flee = true; v.fleeUntil = t.time + 14;
      // Heading towards it: turn round at the next chance by blocking the lane ahead for a while.
      const ahead = Math.cos(wrap(Math.atan2(at.x - v.x, at.z - v.z) - v.yaw)) > .3;
      if (ahead && SEGMENTS[v.seg].kind === 'lane') { t.blockedLanes.set(v.seg, t.time + 40); v.blockedT = 9.5; }
    }
  }
}
/** A player's vehicle touching an ambient one: it stops, puts its hazards on, and is disabled by a hard hit. */
function contacts(t, ctx) {
  for (const o of ctx.obstacles) {
    if (o.kind !== 'vehicle') continue;
    for (const v of t.list) {
      if (v.state === 'parked' && (o.v ?? 0) < 3) continue;
      const dx = v.x - o.x, dz = v.z - o.z; if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
      // Oriented-box overlap (separating axes) with a little padding.
      if (!obb(v.x, v.z, v.yaw, v.len / 2, v.wid / 2, o.x, o.z, o.yaw, o.len / 2, o.wid / 2)) continue;
      const rel = Math.abs((o.v ?? 0) - v.v * Math.cos(wrap(v.yaw - o.yaw)));
      if (t.time < (v.hitAt ?? -9) + 1.2) continue;
      v.hitAt = t.time; t.stats.crashes++;
      t.events.push({ kind: 'crash', x: (v.x + o.x) / 2, z: (v.z + o.z) / 2, strength: Math.min(1, rel / 12), id: v.id, by: o.id });
      if (v.state === 'parked') { v.hazard = true; continue; }
      if (v.free) continue;
      v.impact = rel; v.v = 0;
      v.state = rel > 9 ? 'disabled' : 'crashed'; v.hazard = true; v.until = t.time + 4 + t.r() * 4;
      if (t.time > v.honkAt) { v.honkAt = t.time + 4; t.events.push({ kind: 'horn', x: v.x, z: v.z, id: v.id }); }
    }
  }
}
export function obb(ax, az, ay, ahl, ahw, bx, bz, by, bhl, bhw) {
  const axes = [[Math.sin(ay), Math.cos(ay)], [Math.cos(ay), -Math.sin(ay)], [Math.sin(by), Math.cos(by)], [Math.cos(by), -Math.sin(by)]];
  const dx = bx - ax, dz = bz - az;
  for (const [ux, uz] of axes) {
    const ra = ahl * Math.abs(Math.sin(ay) * ux + Math.cos(ay) * uz) + ahw * Math.abs(Math.cos(ay) * ux - Math.sin(ay) * uz);
    const rb = bhl * Math.abs(Math.sin(by) * ux + Math.cos(by) * uz) + bhw * Math.abs(Math.cos(by) * ux - Math.sin(by) * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

/**
 * Advance the traffic by dt seconds.
 * ctx: { players: [{x,z,yaw,view}], obstacles: [{x,z,r,v,yaw,len,wid,kind,id}], sirens: [{x,z}], walkers: [{x,z}] (people on crosswalks / carriageway) }
 */
export function stepTraffic(t, dt, ctx) {
  if (t.frozen) return;
  t.time += dt; t.frame++;
  const players = ctx.players ?? [];
  // Occupancy by segment (sorted by distance along).
  const occ = new Map();
  for (const v of t.list) {
    if (v.state === 'parked' || v.gone) continue;
    // Cars turning off into a bay or garage still occupy the lane for their first few metres.
    const leaving = (v.state === 'park' || v.state === 'garage') && v.freeS < 7;
    const id = ((v.free && v.state !== 'unpark' && v.state !== 'exit' && v.state !== 'uturn') && !leaving) || pending(v) ? null : v.seg;
    if (id == null) continue;
    if (!occ.has(id)) occ.set(id, []); occ.get(id).push(v);
  }
  t.load.clear(); for (const [id, list] of occ) t.load.set(id, list.length);
  const grid = new Map();
  for (const v of t.list) { if (v.gone) continue; const k = Math.floor(v.x / 12) * 7919 + Math.floor(v.z / 12); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); }
  const c = { ...ctx, occ, grid, players, sirens: ctx.sirens ?? [], walkers: ctx.walkers ?? [], obstacles: ctx.obstacles ?? [] };
  for (const v of t.list) {
    if (v.gone) continue;
    let d = Infinity; for (const p of players) d = Math.min(d, Math.abs(p.x - v.x) + Math.abs(p.z - v.z));
    v.tier = d < TIER.near ? 0 : d < TIER.mid ? 1 : 2;
    const every = v.tier === 0 ? 1 : v.tier === 1 ? 3 : 8;
    v.tierAcc += dt;
    if ((t.frame + (v.seed * 97 | 0)) % every !== 0) continue;
    const h = Math.min(v.tierAcc, .4); v.tierAcc = 0;
    c.near = v.tier === 0;
    if (v.flee && t.time > v.fleeUntil) v.flee = false;
    stepVehicle(t, v, h, c);
  }
  contacts(t, c);
  // Departures and clean-up: vehicles that reached a garage or the expressway, and abandoned or disabled ones
  // once nobody can see them.
  for (const v of t.list) {
    if (v.gone) continue;
    if ((v.state === 'disabled' || v.state === 'abandoned') && t.time > v.until + 60 && hidden(v, players, 200)) v.gone = true;
    // Safety valve: a car that has not moved for three minutes is quietly retired when nobody can see it.
    if (v.state === 'drive' && (v.stillT ?? 0) > 180 && hidden(v, players, 260)) v.gone = true;
  }
  const before = t.list.length;
  for (const [id, who] of t.reserved) { const o = t.list.find(x => x.id === who); if (!o || o.gone || (o.committed !== id && o.seg !== id)) t.reserved.delete(id); }
  t.list = t.list.filter(v => { if (v.gone) { if (v.goal?.type === 'bay') t.bayTaken.delete(v.goal.id); if (v.bay >= 0 && t.bayTaken.get(v.bay) === v.id) t.bayTaken.delete(v.bay); } return !v.gone; });
  t.stats.despawned += before - t.list.length;
  // Too many in a district for this hour: retire some out of sight. Too few: bring some in (out of sight).
  if (t.frame % 30 === 0) {
    const want = targets(t), have = {};
    for (const v of t.list) if (v.state === 'drive') have[v.district] = (have[v.district] ?? 0) + 1;
    for (const d in have) if (have[d] > (want[d] ?? 0) * 1.25 + 2) { const v = t.list.find(o => o.district === d && o.state === 'drive' && o.tier >= 1 && hidden(o, players, 220)); if (v) v.gone = true; }
    fill(t, players);
  }
}
/** Number of moving, parked and stopped vehicles (for the HUD/QA). */
export function trafficSummary(t) {
  const s = { total: t.list.length, moving: 0, parked: 0, stopped: 0, atRed: 0, near: 0, byDistrict: {}, byClass: {}, ...t.stats };
  for (const v of t.list) {
    if (v.state === 'parked') s.parked++; else if (v.v > .5) s.moving++; else s.stopped++;
    if (v.tier === 0) s.near++;
    s.byDistrict[v.district] = (s.byDistrict[v.district] ?? 0) + 1; s.byClass[v.cls] = (s.byClass[v.cls] ?? 0) + 1;
  }
  return s;
}
export { segPoint };
