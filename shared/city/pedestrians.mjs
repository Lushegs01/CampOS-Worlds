// Metropolitan City's pedestrians: people with somewhere to be. Each one walks the sidewalk graph
// (shared/city/network.mjs) to a destination (a shop or office door, a bench, a bus stop), waits for the walk signal
// or a gap in traffic at crossings, keeps to the sidewalk and steps round other people, sometimes stops to talk or
// look around, sits, enters buildings and comes back out, boards buses, and reacts to danger: sidesteps a car
// coming at them, runs from gunfire and explosions or drops into cover when it is close, turns to look at crashes
// and sirens.
//
// Because every step follows a validated sidewalk edge, crosswalk or door path, nobody walks through a building.
// Like the traffic, the whole city is simulated with tiered update rates; density follows district and hour.
import { WALK, PLACES, CROSSWALKS, JUNCTION, DISTRICT_PROFILE, activityAt, walkRoute, walkSignal } from './network.mjs';
import { mulberry } from './traffic.mjs';
import { blocked } from '../campus.mjs';

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const PEOPLE_BUDGET = { low: 90, medium: 170, high: 260, ultra: 340 };
export const PED_TIER = { near: 90, mid: 220 };

// Appearance: body type, height, skin, clothing and accessory, chosen per person (src/city/people.ts draws them).
export const BODIES = ['man', 'woman', 'manBroad', 'womanDress'];
const SKINS = ['#5a3826', '#6b4430', '#7d5038', '#8c5d3f', '#3f281c', '#a06a47', '#c08a63', '#4e3122'];
const TOPS = ['#f1efe9', '#1f2a3a', '#7a2f2b', '#2e5d4b', '#d8c39a', '#3c5a8a', '#c9b8d8', '#e3a13b', '#5b5f66', '#a33d55', '#2c2c2e', '#88a9c3', '#d9d2c3', '#6e7f3a', '#c55a2b', '#1d4e6d'];
const BOTTOMS = ['#22262c', '#3a3f4a', '#2c3e5c', '#5a4a3a', '#c9bfa8', '#4a4a48', '#1b1d22', '#6b5a48', '#2f4a3a'];
const PRINTS = ['#c8892c', '#2f6a8f', '#8f2f5c', '#3f7a3a', '#b8452f', '#5c3f8f']; // ankara-style dresses and wraps
const HAIR = ['#141110', '#1d1713', '#2a1f18', '#3b2a1e'];
const SHOES = ['#141414', '#3b2a1e', '#e8e6e0', '#5a4636', '#1f2a3a'];
function look(r, kind = null) {
  const body = kind ?? BODIES[Math.floor(r() * BODIES.length)];
  const p = a => a[Math.floor(r() * a.length)];
  const dress = body === 'womanDress';
  return { body, skin: p(SKINS), top: dress ? p(PRINTS) : p(TOPS), bottom: dress ? p(PRINTS) : p(BOTTOMS), hair: p(HAIR), shoes: p(SHOES), height: (body.startsWith('woman') ? .94 : 1) * (.93 + r() * .14), build: .9 + r() * .22, bag: r() < .35 ? 1 : 0, headwear: r() < (dress ? .45 : .12) ? 1 : 0, accent: p(PRINTS) };
}

export function createPeople({ seed = 2, quality = 'medium', hour = 17.5 } = {}) {
  const p = { r: mulberry(seed), list: /** @type {any[]} */ ([]), nextId: 1, time: 0, frame: 0, hour, quality, incidents: /** @type {any[]} */ ([]), seatsUsed: new Map(), stats: { spawned: 0, entered: 0, exited: 0, crossed: 0, boarded: 0, fled: 0, conversations: 0, dodges: 0 }, frozen: false };
  fillPeople(p, [], true);
  return p;
}
function budgetOf(p) { return Math.round((PEOPLE_BUDGET[p.quality] ?? PEOPLE_BUDGET.medium) * activityAt(p.hour, 'people')); }
const nodesByDistrict = {};
for (const w of WALK) if (w.edges.length) (nodesByDistrict[w.district] ??= []).push(w.id);
function targets(p) {
  let total = 0; const out = {};
  for (const d in nodesByDistrict) { const w = DISTRICT_PROFILE[d].people * nodesByDistrict[d].length; out[d] = w; total += w; }
  for (const d in out) out[d] = Math.round(budgetOf(p) * out[d] / total);
  return out;
}
function hidden(q, players, min) {
  for (const pl of players) {
    const d = dist(q, pl); if (d < 30) return false;
    if (d < min && Math.abs(wrap(Math.atan2(q.x - pl.x, q.z - pl.z) - (pl.view ?? pl.yaw ?? 0))) < 1.25) return false;
  }
  return true;
}
function person(p, x, z, district) {
  return { id: 'cp' + p.nextId++, look: look(p.r), x, z, yaw: p.r() * 6.28, v: 0, pace: 1.05 + p.r() * .45, lat: (p.r() - .5) * 1.2, latT: 0, path: [], i: 0, state: 'walk', until: 0, place: null, district, tier: 0, acc: 0, seed: p.r(), phase: p.r() * 10, fade: 1, onRoad: false, waiting: 0 };
}
function destination(p, c) {
  // Weighted by each place's busyness and its district's footfall; mostly within a few blocks.
  let best = null, bw = 0;
  for (let k = 0; k < 18; k++) {
    const pl = PLACES[Math.floor(p.r() * PLACES.length)], d = dist(pl, c);
    if (d < 25 || d > 420) continue;
    const w = pl.weight * DISTRICT_PROFILE[pl.district].people * (1.2 - d / 500) * (.5 + p.r());
    if ((pl.kind === 'bench' || pl.kind === 'busstop') && (p.seatsUsed.get(pl.id) ?? 0) >= pl.seats) continue;
    if (w > bw) { bw = w; best = pl; }
  }
  return best;
}
function nearestNode(x, z) { let best = -1, bd = Infinity; for (const w of WALK) { if (!w.edges.length) continue; const d = Math.abs(w.x - x) + Math.abs(w.z - z); if (d < bd) { bd = d; best = w.id; } } return best; }
function plan(p, c, place = null) {
  const pl = place ?? destination(p, c); if (!pl) return false;
  const start = c.node ?? nearestNode(c.x, c.z), path = walkRoute(start, pl.walk);
  if (!path) return false;
  c.path = path; c.i = 0; c.place = pl; c.state = 'walk';
  if (pl.kind !== 'door') p.seatsUsed.set(pl.id, (p.seatsUsed.get(pl.id) ?? 0) + 1);
  c.seat = pl.kind !== 'door' ? (p.seatsUsed.get(pl.id) - 1) : 0;
  return true;
}
function spawnAt(p, district, players, initial) {
  // Out of a door (people come out of buildings), or on a sidewalk out of sight.
  const doors = PLACES.filter(q => q.kind === 'door' && q.district === district);
  if (doors.length && p.r() < .55) {
    const d = doors[Math.floor(p.r() * doors.length)];
    const c = person(p, d.x, d.z, district); c.node = d.walk; c.yaw = d.yaw; c.state = 'exit'; c.fade = initial ? 1 : 0; c.until = p.time + 1.2;
    c.path = [d.walk]; c.i = 0; p.list.push(c); p.stats.spawned++; p.stats.exited++; return c;
  }
  const nodes = nodesByDistrict[district]; if (!nodes) return null;
  for (let k = 0; k < 10; k++) {
    const w = WALK[nodes[Math.floor(p.r() * nodes.length)]];
    if (!initial && !hidden(w, players, 160)) continue;
    const c = person(p, w.x, w.z, district); c.node = w.id;
    if (!plan(p, c)) continue;
    c.node = null; p.list.push(c); p.stats.spawned++;
    // Some start the day already chatting, sitting or browsing.
    if (initial && p.r() < .12) { c.state = 'idle'; c.until = p.time + 5 + p.r() * 20; }
    return c;
  }
  return null;
}
function fillPeople(p, players, initial = false) {
  const want = targets(p), have = {};
  for (const c of p.list) have[c.district] = (have[c.district] ?? 0) + 1;
  let n = 0;
  for (const d in want) {
    let missing = want[d] - (have[d] ?? 0);
    while (missing-- > 0 && n < (initial ? 9999 : 3)) { if (spawnAt(p, d, players, initial)) n++; else break; }
  }
}

/** Something people react to: 'gunfire' | 'explosion' | 'crash' | 'siren' | 'horn'. */
export function peopleIncident(p, kind, at, strength = 1) {
  p.incidents.push({ kind, x: at.x, z: at.z, at: p.time, strength });
  if (p.incidents.length > 16) p.incidents.shift();
  const loud = kind === 'explosion' ? 95 : kind === 'gunfire' ? 60 : kind === 'crash' ? 35 : kind === 'siren' ? 30 : 14;
  for (const c of p.list) {
    const d = dist(c, at); if (d > loud * (.6 + .4 * strength) || c.state === 'inside') continue;
    if (kind === 'crash' || kind === 'siren' || kind === 'horn') {
      if (c.state === 'walk' || c.state === 'idle' || c.state === 'talk') { c.prev = c.state === 'walk' ? null : c.state; c.state = 'watch'; c.until = p.time + (kind === 'horn' ? 1.2 : 3 + p.r() * 3); c.face = Math.atan2(at.x - c.x, at.z - c.z); }
      continue;
    }
    p.stats.fled++;
    // Close and exposed: drop into cover. Otherwise run, away from it, along the sidewalks.
    if (d < (kind === 'explosion' ? 18 : 12) && p.r() < .7) { c.state = 'cower'; c.until = p.time + 5 + p.r() * 5; c.away = { x: at.x, z: at.z }; }
    else flee(p, c, at);
  }
}
function flee(p, c, from) {
  // Pick a sidewalk node well away from the danger, roughly in the direction the person is already facing away.
  let best = -1, bs = -Infinity;
  for (let k = 0; k < 40; k++) {
    const w = WALK[Math.floor(p.r() * WALK.length)]; if (!w.edges.length) continue;
    const d = dist(w, c); if (d < 40 || d > 160) continue;
    const s = dist(w, from) - d * .5; if (s > bs) { bs = s; best = w.id; }
  }
  const start = nearestNode(c.x, c.z), path = best >= 0 ? walkRoute(start, best) : null;
  releaseSeat(p, c);
  if (path) { c.path = path; c.i = 0; }
  c.state = 'flee'; c.until = p.time + 12 + p.r() * 8; c.place = null;
}
function releaseSeat(p, c) { if (c.place && c.place.kind !== 'door') { p.seatsUsed.set(c.place.id, Math.max(0, (p.seatsUsed.get(c.place.id) ?? 1) - 1)); } }

function crosswalkOf(a, b) { const e = WALK[a]?.edges.find(e => e.to === b); return e?.cross ? e : null; }
/** May this person step onto the crosswalk from node a to b now? */
function mayCross(p, c, a, b, ctx) {
  const e = crosswalkOf(a, b); if (!e) return true;
  const j = JUNCTION.get(e.cross.node), sig = walkSignal(j, e.cross.axis, p.time);
  if (sig === 'dont' || sig === 'flash') return false;
  // Uncontrolled (or a car still finishing through): look both ways.
  const mid = { x: (WALK[a].x + WALK[b].x) / 2, z: (WALK[a].z + WALK[b].z) / 2 };
  for (const v of ctx.vehicles) {
    const d = dist(v, mid); if (d > 32) continue;
    const toward = Math.cos(wrap(Math.atan2(mid.x - v.x, mid.z - v.z) - v.yaw)) > .55;
    if (d < 7 || (toward && (v.v ?? 0) > .8 && d / Math.max(1, v.v) < (sig === 'walk' ? 2.2 : 5.5))) return false;
  }
  return true;
}

function stepPerson(p, c, dt, ctx, grid) {
  c.phase += dt * Math.max(.2, c.v) * 1.9;
  if (c.fade < 1 && c.state !== 'enter') c.fade = Math.min(1, c.fade + dt * 1.5);
  // Danger from vehicles: something coming at them fast and close: jump aside.
  if (c.tier === 0 && c.state !== 'cower' && c.state !== 'inside') for (const v of ctx.fast) {
    const dx = c.x - v.x, dz = c.z - v.z, d = Math.hypot(dx, dz); if (d > 9) continue;
    const ahead = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw), side = -dx * Math.cos(v.yaw) + dz * Math.sin(v.yaw);
    if (ahead > 0 && ahead < 4 + v.v * .9 && Math.abs(side) < 2.4) {
      c.dodge = { x: -Math.cos(v.yaw) * Math.sign(side || 1), z: Math.sin(v.yaw) * Math.sign(side || 1), until: p.time + .7 };
      if (c.state !== 'flee') { c.state = 'watch'; c.until = p.time + 2.5; c.face = Math.atan2(v.x - c.x, v.z - c.z); }
      p.stats.dodges++;
    }
  }
  if (c.dodge) {
    if (p.time > c.dodge.until) c.dodge = null;
    else { const nx = c.x + c.dodge.x * 4.2 * dt, nz = c.z + c.dodge.z * 4.2 * dt; if (!blocked(nx, nz, .3)) { c.x = nx; c.z = nz; } c.v = 4.2; return; }
  }
  switch (c.state) {
    case 'exit': { // Out of the door and across to the sidewalk, then off to the next destination.
      const n = WALK[c.path[0]], a = Math.atan2(n.x - c.x, n.z - c.z), d = dist(n, c);
      c.v = 1.1; c.yaw += wrap(a - c.yaw) * Math.min(1, dt * 5); const k = Math.min(d, 1.1 * dt); c.x += Math.sin(a) * k; c.z += Math.cos(a) * k;
      if (d < .3 || p.time > c.until + 25) { c.node = c.path[0]; c.state = 'walk'; if (!plan(p, c)) c.state = 'enter'; c.node = null; }
      return;
    }
    case 'enter': c.v = .9; c.fade -= dt * 1.4; if (c.place?.kind === 'door') { const a = Math.atan2(c.place.x - c.x, c.place.z - c.z); c.yaw = a; c.x += Math.sin(a) * .9 * dt; c.z += Math.cos(a) * .9 * dt; } if (c.fade <= 0) { c.gone = true; p.stats.entered++; } return;
    case 'sit': case 'wait': c.v = 0; c.yaw += wrap(c.place.yaw - c.yaw) * Math.min(1, dt * 4);
      if (c.state === 'wait' && ctx.buses.some(b => b.stop === c.place.id && dist(b, c) < 16)) { c.state = 'board'; c.target = ctx.buses.find(b => b.stop === c.place.id); }
      if (p.time > c.until) { releaseSeat(p, c); c.node = c.place.walk; if (!plan(p, c)) c.until = p.time + 10; c.node = null; }
      return;
    case 'board': { const b = c.target; c.v = 1.6; const a = Math.atan2(b.x - c.x, b.z - c.z); c.yaw = a; c.x += Math.sin(a) * 1.6 * dt; c.z += Math.cos(a) * 1.6 * dt; c.fade -= dt * .8; if (c.fade <= 0 || dist(b, c) < 1.4) { releaseSeat(p, c); c.gone = true; p.stats.boarded++; } return; }
    case 'idle': case 'talk': case 'watch': c.v = 0;
      if (c.state === 'watch' && c.face != null) c.yaw += wrap(c.face - c.yaw) * Math.min(1, dt * 6);
      if (c.state === 'talk' && c.partner) { const o = c.partner; c.yaw += wrap(Math.atan2(o.x - c.x, o.z - c.z) - c.yaw) * Math.min(1, dt * 4); }
      if (p.time > c.until) { c.state = c.prev ?? 'walk'; c.prev = null; c.partner = null; if (c.state !== 'walk') c.until = p.time + 4; }
      return;
    case 'cower': c.v = 0; if (p.time > c.until) flee(p, c, c.away ?? c); return;
  }
  // Walking (or running) along the path.
  const running = c.state === 'flee';
  if (running && p.time > c.until) { c.state = 'walk'; if (!plan(p, c)) c.path = []; }
  if (c.i >= c.path.length) {
    if (c.place && !running) {
      if (c.place.kind === 'door') { c.state = 'enter'; return; }
      c.state = c.place.kind === 'busstop' ? 'wait' : 'sit'; c.until = p.time + 15 + p.r() * 50;
      const a = c.place.yaw + Math.PI / 2, k = (c.seat - (c.place.seats - 1) / 2) * .62;
      c.x = c.place.x + Math.sin(a) * k; c.z = c.place.z + Math.cos(a) * k; return;
    }
    if (!plan(p, c)) { c.state = 'enter'; c.place = null; }
    return;
  }
  const node = WALK[c.path[c.i]], prevNode = c.i > 0 ? c.path[c.i - 1] : null;
  // Waiting at the kerb for the walk signal / a gap.
  if (prevNode != null && crosswalkOf(prevNode, node.id) && !c.crossing) {
    if (!running && !mayCross(p, c, prevNode, node.id, ctx)) { c.v = 0; c.waiting += dt; c.yaw += wrap(Math.atan2(node.x - c.x, node.z - c.z) - c.yaw) * Math.min(1, dt * 3); return; }
    c.crossing = true; p.stats.crossed++;
  }
  // Steering: towards the next node, offset sideways within the sidewalk to pass people.
  const tx = node.x, tz = node.z, dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
  const ux = dx / (d || 1), uz = dz / (d || 1);
  let speed = running ? 4.6 + c.seed : c.pace;
  // Other people just ahead: slow down and drift to one side (everyone keeps right).
  let latT = c.crossing ? 0 : .2 + (c.seed - .5) * .5;
  if (c.tier === 0) {
    const gx = Math.floor(c.x / 4), gz = Math.floor(c.z / 4);
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) for (const o of grid.get(ix * 100003 + iz) ?? []) {
      if (o === c) continue;
      const ox = o.x - c.x, oz = o.z - c.z, ahead = ox * ux + oz * uz, side = -ox * uz + oz * ux;
      if (ahead > 0 && ahead < 2.2 && Math.abs(side) < .75) { if (o.v < c.v * .7) latT = side > 0 ? -.7 : .7; else speed = Math.min(speed, o.v + .05); }
      // Two strollers meeting: sometimes they stop for a chat.
      if (!running && o.state === 'walk' && c.state === 'walk' && Math.hypot(ox, oz) < 1.6 && p.r() < .0015 && c.place?.kind !== 'busstop') {
        for (const q of [c, o]) { q.state = 'talk'; q.until = p.time + 8 + p.r() * 14; }
        c.partner = o; o.partner = c; p.stats.conversations++;
      }
    }
    // The player on foot in the way.
    for (const pl of ctx.walkersExt) { const ox = pl.x - c.x, oz = pl.z - c.z, ahead = ox * ux + oz * uz, side = -ox * uz + oz * ux; if (ahead > 0 && ahead < 1.8 && Math.abs(side) < .8) latT = side > 0 ? -.7 : .7; }
  }
  c.lat += clamp(latT - c.lat, -1.2 * dt, 1.2 * dt);
  // Sidewalk lateral offset: right of travel is (-uz, ux).
  const want = Math.atan2(ux, uz);
  c.yaw += wrap(want - c.yaw) * Math.min(1, dt * 7);
  const step = Math.min(d, speed * dt);
  c.x += ux * step; c.z += uz * step;
  // Keep the lateral offset relative to the path line (applied as a display offset, never across a wall).
  c.ox = -uz * c.lat; c.oz = ux * c.lat;
  c.v = speed;
  c.onRoad = !!c.crossing;
  if (d < .35) {
    c.i++; if (c.crossing) c.crossing = false;
    // Now and then, stop to look around or at a shop window.
    if (!running && p.r() < .035 && node.kind !== 'curb') { c.state = 'idle'; c.until = p.time + 2 + p.r() * 6; }
  }
}

/**
 * ctx: { players:[{x,z,yaw,view}], vehicles:[{x,z,yaw,v}] (all moving cars), fast:[{x,z,yaw,v}] (fast cars near
 * people: players' and police), walkersExt:[{x,z}] (players on foot), buses:[{x,z,stop}] (buses dwelling at stops) }
 */
export function stepPeople(p, dt, ctx) {
  if (p.frozen) return;
  p.time += dt; p.frame++;
  const players = ctx.players ?? [];
  const c2 = { vehicles: ctx.vehicles ?? [], fast: ctx.fast ?? [], walkersExt: ctx.walkersExt ?? [], buses: ctx.buses ?? [] };
  const grid = new Map();
  for (const c of p.list) { const k = Math.floor(c.x / 4) * 100003 + Math.floor(c.z / 4); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
  for (const c of p.list) {
    let d = Infinity; for (const q of players) d = Math.min(d, Math.abs(q.x - c.x) + Math.abs(q.z - c.z));
    c.tier = d < PED_TIER.near ? 0 : d < PED_TIER.mid ? 1 : 2;
    const every = c.tier === 0 ? 1 : c.tier === 1 ? 4 : 10;
    c.acc += dt; if ((p.frame + (c.seed * 101 | 0)) % every !== 0) continue;
    const h = Math.min(c.acc, .5); c.acc = 0;
    stepPerson(p, c, h, c2, grid);
  }
  p.list = p.list.filter(c => !c.gone);
  if (p.frame % 40 === 0) {
    const want = targets(p), have = {};
    for (const c of p.list) have[c.district] = (have[c.district] ?? 0) + 1;
    // Retire people out of sight where a district is over its share (they go indoors).
    for (const d in have) if (have[d] > (want[d] ?? 0) * 1.3 + 2) { const c = p.list.find(o => o.district === d && o.tier >= 1 && o.state === 'walk' && hidden(o, players, 180)); if (c) { releaseSeat(p, c); c.gone = true; } }
    for (const c of p.list) if (c.state === 'walk' && c.path[c.i] != null) c.district = WALK[c.path[c.i]].district;
    fillPeople(p, players);
  }
}
/** People on a crosswalk or the carriageway (drivers stop for them). */
export function peopleOnRoad(p) { return p.list.filter(c => c.onRoad || c.state === 'flee' && c.tier === 0); }
export function peopleSummary(p) {
  const s = { total: p.list.length, walking: 0, waiting: 0, seated: 0, talking: 0, fleeing: 0, near: 0, byDistrict: {}, ...p.stats };
  for (const c of p.list) {
    if (c.state === 'walk' && c.v > .1) s.walking++; else if (c.state === 'walk') s.waiting++;
    if (c.state === 'sit' || c.state === 'wait') s.seated++; if (c.state === 'talk') s.talking++; if (c.state === 'flee' || c.state === 'cower') s.fleeing++;
    if (c.tier === 0) s.near++;
    s.byDistrict[c.district] = (s.byDistrict[c.district] ?? 0) + 1;
  }
  return s;
}
export { CROSSWALKS };
