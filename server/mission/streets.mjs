// Metropolitan City's streets around the player: moving traffic and pedestrians that react to what happens.
//
// Simulated only near the player (distance-based simulation): cars and people are kept in a ring around them,
// appear out of sight and are released when far away. Traffic drives on the right in its lane along the shared
// road graph with the shared vehicle physics, keeps its distance, stops for people and obstacles, pulls over for
// sirens, stops after a collision and turns round when the road stays blocked (so nothing loops against a
// roadblock forever). Pedestrians walk the sidewalks, stop to talk, look at incidents, and run or take cover from
// gunfire and explosions according to how close they are.
import { advance } from '../../shared/vehicles.mjs';
import { ROADS } from '../../shared/expansion.mjs';
import { moveWithCollisions, blocked } from '../../shared/campus.mjs';
import { inMetro } from '../../shared/metro.mjs';

const CARS = 7, PEOPLE = 12, KEEP = 250;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const METRO_ROADS = ROADS.filter(r => inMetro(r.a.x, r.a.z, 5) && inMetro(r.b.x, r.b.z, 5));
const ends = n => METRO_ROADS.filter(r => r.a === n || r.b === n);
const CAST = ['amara', 'tunde', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada', 'chidi', 'mel'];

export function createStreets({ now, random = Math.random }) {
  return { cars: [], people: [], events: [], random, nextId: 0, at: now, incidents: [] };
}
/** Something the street reacts to: 'gunfire' | 'explosion' | 'crash' | 'siren'. strength 0…1. */
export function streetEvent(st, kind, at, now, strength = 1) {
  st.incidents.push({ kind, x: at.x, z: at.z, at: now, strength });
  if (st.incidents.length > 12) st.incidents.shift();
}

/** A lane point: `t` metres from road end `from`, offset to the right of travel. */
function lane(road, from, t, offset) {
  const to = road.a === from ? road.b : road.a, len = dist(from, to), ux = (to.x - from.x) / len, uz = (to.z - from.z) / len;
  // Right of travel (+X east, +Z south, yaw 0 faces +z): right = (-uz, ux).
  return { x: from.x + ux * t - uz * offset, z: from.z + uz * t + ux * offset, yaw: Math.atan2(ux, uz), len };
}
function spawnPoint(st, p, min, max, visible) {
  for (let k = 0; k < 24; k++) {
    const road = METRO_ROADS[Math.floor(st.random() * METRO_ROADS.length)], from = st.random() < .5 ? road.a : road.b;
    const len = Math.hypot(road.a.x - road.b.x, road.a.z - road.b.z);
    if (len < 30) continue;
    const t = 12 + st.random() * (len - 24), q = lane(road, from, t, 0);
    const d = dist(q, p);
    if (d < min || d > max) continue;
    // Out of the player's sight: behind them or with a building in the way.
    const ahead = Math.abs(angle(facing(p, q) - (p.yaw ?? 0) - Math.PI)) < 1.2;
    if (ahead && visible(p, q)) continue;
    return { road, from, t };
  }
  return null;
}

function addCar(st, p, now, visible) {
  const s = spawnPoint(st, p, 110, 220, visible);
  if (!s) return;
  const q = lane(s.road, s.from, s.t, 2);
  if (st.cars.some(c => dist(c, q) < 14) || blocked(q.x, q.z, 1.1)) return;
  st.cars.push({ id: `metro-traffic-${++st.nextId}`, type: 'car', x: q.x, z: q.z, yaw: q.yaw, speed: 6, wheel: 0, steering: 0, occupants: [null, null, null, null],
    traffic: true, road: s.road, from: s.from, mode: 'drive', until: 0, blockedFor: 0, cruise: 9 + st.random() * 4, condition: 100, shaken: -Infinity, honk: 0 });
}
function nextRoad(st, c, away = null) {
  const node = c.road.a === c.from ? c.road.b : c.road.a;
  let options = ends(node).filter(r => r !== c.road);
  if (away) options.sort((a, b) => dist(a.a === node ? a.b : a.a, away) < dist(b.a === node ? b.b : b.a, away) ? 1 : -1);
  if (!options.length) options = [c.road];
  const road = away ? options[0] : options[Math.floor(st.random() * options.length)];
  c.road = road; c.from = node;
}

function carStep(st, c, dt, now, ctx, p) {
  const node = c.road.a === c.from ? c.road.b : c.road.a, len = dist(c.from, node);
  // Progress along the road: project onto it.
  const ux = (node.x - c.from.x) / len, uz = (node.z - c.from.z) / len, t = (c.x - c.from.x) * ux + (c.z - c.from.z) * uz;
  const recent = st.incidents.filter(e => now - e.at < 6);
  const panic = recent.find(e => (e.kind === 'gunfire' || e.kind === 'explosion') && dist(e, c) < (e.kind === 'explosion' ? 90 : 55));
  let target = c.cruise * (panic ? 1.5 : 1), offset = 2;
  // Sirens: pull over to the right and stop while the unit passes.
  const siren = ctx.sirens.find(u => dist(u, c) < 45);
  // (Never in a junction: a car that stops there blocks everyone, the unit included.)
  const inJunction = dist(c, node) < 13 || dist(c, c.from) < 13;
  if (siren && c.mode !== 'yield' && !panic && !inJunction) { c.mode = 'yield'; c.until = now + 3.5; c.honk = 0; }
  if (c.mode === 'yield') { offset = 3.3; target = now < c.until - 2.5 ? 3 : 0; if (now > c.until && !ctx.sirens.some(u => dist(u, c) < 30) || now > c.until + 6) c.mode = 'drive'; }
  // After a collision: stop, hazards on, then carry on.
  if (now - c.shaken < 4) target = 0;
  if (t > len - 8) { if (panic) nextRoad(st, c, panic); else nextRoad(st, c); return carStep(st, c, 0, now, ctx, p); }
  const aim = lane(c.road, c.from, Math.min(len, t + 9), offset);
  // Keep a gap: anything ahead in the lane, and people on the carriageway.
  for (const o of [...ctx.vehicles, ...st.cars]) {
    if (o.id === c.id) continue;
    const dx = o.x - c.x, dz = o.z - c.z, ahead = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw), side = Math.abs(dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw));
    if (ahead > 0 && ahead < 16 && side < 2.4) target = Math.min(target, Math.max(0, (ahead - 7) * .8 + Math.max(0, o.speed ?? 0) * .9));
  }
  for (const q of [...ctx.players, ...st.people]) {
    const dx = q.x - c.x, dz = q.z - c.z, ahead = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw), side = Math.abs(dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw));
    if (!q.vehicle && ahead > 0 && ahead < 12 && side < 1.6) { target = 0; if (now > c.honk) { c.honk = now + 5; st.events.push({ kind: 'horn', x: c.x, y: 0, z: c.z }); } }
  }
  // Blocked for a while (a roadblock, a crash): turn round rather than wait for ever.
  c.blockedFor = target < .5 && c.mode === 'drive' && now - c.shaken > 4 ? c.blockedFor + dt : 0;
  if (c.blockedFor > 7) { c.from = node; c.blockedFor = 0; c.mode = 'turn'; c.until = now + 2.2; }
  if (c.mode === 'turn') { advance(c, { throttle: -.6, steer: 1, brake: false }, dt, [...ctx.vehicles, ...st.cars], ctx.players); if (now > c.until) c.mode = 'drive'; return; }
  const turn = angle(facing(c, aim) - c.yaw);
  target = Math.min(target, clamp(c.cruise - Math.abs(turn) * 10, 3, c.cruise * 1.5));
  advance(c, { throttle: target > c.speed + .3 ? .85 : 0, steer: clamp(turn * 2, -1, 1), brake: target < c.speed - .8 }, dt, [...ctx.vehicles, ...st.cars], ctx.players);
}

function addPerson(st, p, now, visible) {
  const s = spawnPoint(st, p, 35, 140, visible);
  if (!s) return;
  const side = st.random() < .5 ? -1 : 1, q = lane(s.road, s.from, s.t, side * 5.45);
  if (blocked(q.x, q.z)) return;
  const talk = st.random() < .25;
  st.people.push({ id: `metro-civilian-${++st.nextId}`, model: CAST[st.nextId % CAST.length], x: q.x, z: q.z, yaw: q.yaw, road: s.road, from: s.from, side,
    mode: talk ? 'talk' : 'walk', until: now + (talk ? 12 + st.random() * 20 : 0), speed: 0, pace: 1.15 + st.random() * .35, fear: 0, from_: null });
  if (talk) { const o = st.people.at(-1); st.people.push({ ...o, id: `metro-civilian-${++st.nextId}`, model: CAST[st.nextId % CAST.length], x: o.x + Math.sin(o.yaw) * 1.1, z: o.z + Math.cos(o.yaw) * 1.1, yaw: o.yaw + Math.PI, partner: o.id }); }
}
function personStep(st, c, dt, now, ctx) {
  const recent = st.incidents.filter(e => now - e.at < 10);
  // React to the strongest nearby incident they can hear or see.
  for (const e of recent) {
    const d = dist(e, c), loud = e.kind === 'explosion' ? 90 : e.kind === 'gunfire' ? 55 : 25;
    if (d > loud || e.seenBy?.has(c.id)) continue;
    (e.seenBy ??= new Set()).add(c.id);
    if (e.kind === 'crash' || e.kind === 'siren') { if (c.mode === 'walk' || c.mode === 'talk') { c.mode = 'look'; c.until = now + 3 + st.random() * 2; c.yaw = facing(c, e); } continue; }
    const seen = ctx.clear(e, c, 1.4, 1.5);
    // Close and in the open: drop and cover. Otherwise run away from it.
    if (d < 14 && seen) { c.mode = 'cower'; c.until = now + 6 + st.random() * 4; }
    else { c.mode = 'flee'; c.until = now + 8 + st.random() * 5; c.away = { x: e.x, z: e.z }; }
    c.fear = 1;
  }
  if (c.mode === 'cower') { c.speed = 0; if (now > c.until) { c.mode = 'flee'; c.until = now + 6; c.away ??= { x: c.x, z: c.z + 1 }; } return; }
  if (c.mode === 'look' || c.mode === 'talk') { c.speed = 0; if (now > c.until) c.mode = 'walk'; return; }
  const running = c.mode === 'flee', speed = running ? 5.2 : c.pace;
  let dir = c.yaw;
  if (running) {
    dir = facing(c.away, c);
    if (now > c.until) { c.mode = 'walk'; c.fear = 0; }
  } else {
    const node = c.road.a === c.from ? c.road.b : c.road.a, len = dist(c.from, node);
    const ux = (node.x - c.from.x) / len, uz = (node.z - c.from.z) / len, t = (c.x - c.from.x) * ux + (c.z - c.from.z) * uz;
    if (t > len - 6) { const options = ends(node).filter(r => r !== c.road); if (options.length) { c.road = options[Math.floor(st.random() * options.length)]; c.from = node; } else { c.from = node; } }
    const aim = lane(c.road, c.from, Math.min(len, Math.max(0, t) + 4), c.side * 5.45);
    dir = facing(c, aim);
  }
  c.yaw += angle(dir - c.yaw) * Math.min(1, dt * 6);
  const before = { x: c.x, z: c.z };
  Object.assign(c, moveWithCollisions(c.x, c.z, Math.sin(c.yaw) * speed * dt, Math.cos(c.yaw) * speed * dt));
  c.speed = dist(before, c) / Math.max(dt, 1e-3);
  if (running && c.speed < .5) c.yaw += 1.3; // cornered: try another way
}

export function stepStreets(st, p, dt, now, ctx) {
  const visible = (a, b) => ctx.clear(a, b, 1.6, 1.4);
  for (const u of ctx.sirens) if (!st.incidents.some(e => e.kind === 'siren' && now - e.at < 2 && dist(e, u) < 20)) streetEvent(st, 'siren', u, now, .4);
  const active = inMetro(p.x, p.z, 40);
  st.cars = st.cars.filter(c => dist(c, p) < KEEP + 30 && c.condition > 0);
  st.people = st.people.filter(c => dist(c, p) < KEEP * .7);
  if (active) {
    if (st.cars.length < CARS && st.random() < dt * 1.5) addCar(st, p, now, visible);
    if (st.people.length < PEOPLE && st.random() < dt * 2) addPerson(st, p, now, visible);
  }
  for (const c of st.cars) carStep(st, c, dt, now, ctx, p);
  for (const c of st.people) personStep(st, c, dt, now, ctx);
  if (st.events.length) { ctx.events.push(...st.events.map(e => ({ id: 0, ...e }))); st.events.length = 0; }
}
export function viewStreets(st) {
  return {
    cars: st.cars.map(({ id, type, x, z, yaw, speed, wheel, steering, occupants, mode, condition }) => ({ id, type, x, z, yaw, speed, wheel, steering, occupants, traffic: true, mode, condition })),
    civilians: st.people.map(({ id, model, x, z, yaw, mode, speed }) => ({ id, model, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(yaw * 100) / 100, mode, speed: Math.round(speed * 10) / 10 })),
  };
}
