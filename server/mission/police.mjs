// Metro Police: a reusable wanted-level and police simulation for Shadow Protocol missions.
//
// The police know only what they are told or see. A crime becomes a report (with a dispatch delay) from a
// civilian witness, an alarm or a camera, or is witnessed directly by an officer; reports give the incident's
// location, not the player's. Units drive real cars with the shared vehicle physics (shared/vehicles.mjs) along
// the shared road graph, leave from the Metro Police Central motor pool (or are already on patrol), and see the
// player only with a clear line of sight inside their field of view. When they lose sight they search around the
// last known position; the search is called off only when they have not seen the player for long enough AND the
// player is outside the search area.
//
// Wanted levels are distinct behaviours, not a counter:
//  1 Investigation: the nearest unit drives to the incident, an officer gets out to look and calls a warning.
//  2 Pursuit: sirens, units follow the player, more respond.
//  3 Aggressive pursuit: units try to cut the player off (interception) and one sets up a roadblock ahead.
//  4 Tactical containment: units box a slow or stopped player in; officers get out, take cover behind their cars,
//    draw weapons and issue commands; they fire only when the player is a threat.
//  5 Maximum response: a tactical van with rifle-armed officers joins; officers are cleared to fire on sight.
import { advance, localPoint, VEHICLE_TYPES, vehicleContains } from '../../shared/vehicles.mjs';
import { roadRoute, ROAD_NODES, ROADS } from '../../shared/expansion.mjs';
import { blocked, moveWithCollisions } from '../../shared/campus.mjs';
import { POLICE_BAYS, inMetro } from '../../shared/metro.mjs';

export const WANTED = [
  { level: 0, name: 'Clear', units: 0 },
  { level: 1, name: 'Investigation', units: 1, heat: 1 },
  { level: 2, name: 'Pursuit', units: 2, heat: 2.5 },
  { level: 3, name: 'Aggressive pursuit', units: 3, heat: 5, intercept: true, roadblock: true },
  { level: 4, name: 'Tactical containment', units: 4, heat: 8, intercept: true, roadblock: true },
  { level: 5, name: 'Maximum response', units: 5, heat: 12, intercept: true, roadblock: true, tactical: true },
];
/** Heat added by each kind of crime (summed; the level follows the total). */
export const SEVERITY = { alarm: 1, gunfire: 1.6, explosion: 3, theft: 1.2, crash: .5, ram: 2.2, assault: 2, killing: 3, aiming: 1.5, officerShot: 4, officerKilled: 7, evading: 1 };
const MAX_UNITS = 6, PISTOL = { damage: 8, cadence: .55, spread: .9 }, RIFLE = { damage: 11, cadence: .32, spread: .7 };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (x, z) => ({ x, z });

/** Patrol loops (road node coordinates in the city) that the two duty cruisers drive when nothing is happening. */
const PATROLS = [
  [[0, 1647.55], [300, 1647.55], [300, 1755.55], [0, 1755.55]],
  [[-180, 1647.55], [-60, 1647.55], [-60, 1755.55], [-470, 1755.55], [-470, 1540], [0, 1540], [0, 1647.55]],
];

/**
 * @param {{now:number, random?:()=>number, los:(a:any,b:any,ha?:number,hb?:number)=>boolean, patrols?:boolean}} o
 */
export function createPolice({ now, random = Math.random, los, patrols = true }) {
  const pd = {
    wanted: 0, heat: 0, reports: [], lastKnown: null, seenAt: -Infinity, identified: false, units: [], events: [],
    dispatchAt: now, searchRadius: 0, searchStart: null, escape: 0, containment: null, hostileAt: -Infinity,
    surrender: null, arrested: false, warnedAt: -Infinity, random, los, nextId: 0, roadblock: null, wantedAt: now,
    commandAt: -Infinity, commands: 0, lastShotAt: -Infinity, radioAt: -Infinity,
  };
  if (patrols) PATROLS.forEach((loop, i) => {
    const [x, z] = loop[0], [nx, nz] = loop[1];
    pd.units.push(unit(pd, 'patrol', x + Math.sign(nx - x) * 12, z + Math.sign(nz - z) * 12 + (nz === z ? 2 : 0), Math.atan2(nx - x, nz - z), now, loop));
  });
  return pd;
}

export function unit(pd, role, x, z, yaw, now, loop = null) {
  const type = role === 'tactical' ? 'shuttle' : 'car';
  return {
    id: `getaway-unit-${++pd.nextId}`, role, type, x, z, yaw, speed: 0, wheel: 0, steering: 0, police: true, livery: role === 'tactical' ? 'tactical' : 'police',
    occupants: VEHICLE_TYPES[type].seats.map(() => null), condition: 100, mode: role === 'patrol' ? 'patrol' : 'respond',
    loop, loopIndex: 1, route: [], plan: 0, target: null, sees: false, siren: false, officers: [], crew: role === 'tactical' ? 4 : 2,
    stuckAt: null, reverseUntil: 0, born: now, lastSeen: -Infinity, searchPoint: null, searchAt: 0, arrived: null,
  };
}
const say = (pd, kind, code, at, extra = {}) => pd.events.push({ kind, code, x: at.x, y: 0, z: at.z, ...extra });

/**
 * A crime. `witness`: 'police' (seen by an officer: immediate, and the suspect is identified), 'civilian',
 * 'alarm' or 'camera' (a report reaches dispatch after a delay, giving the incident's location only).
 */
export function crime(pd, kind, at, now, witness = 'civilian') {
  const severity = SEVERITY[kind] ?? 1;
  if (witness === 'police') {
    // An officer who has just seen this crime does not count it again a moment later (a shot officer always counts).
    if (kind !== 'officerShot' && kind !== 'officerKilled' && now - (pd.seen?.[kind] ?? -Infinity) < 5) { pd.seenAt = now; return; }
    (pd.seen ??= {})[kind] = now;
    apply(pd, kind, severity, at, now, true); return;
  }
  const delay = witness === 'alarm' ? 3.5 + pd.random() * 2 : witness === 'camera' ? 2 + pd.random() * 2 : 5 + pd.random() * 5;
  // The same witness does not report the same crime again and again.
  if (pd.reports.some(r => r.kind === kind && dist(r.at, at) < 30 && now - r.made < 8)) return;
  pd.reports.push({ kind, severity, at: point(at.x, at.z), due: now + delay, made: now, witness });
}
function apply(pd, kind, severity, at, now, seen) {
  pd.heat += severity;
  // Reports alone never raise beyond aggressive pursuit; only what officers see can take it further.
  const cap = seen ? 5 : 3;
  const level = WANTED.reduce((l, w) => pd.heat >= (w.heat ?? Infinity) ? w.level : l, 0);
  const next = Math.max(pd.wanted, Math.min(cap, level));
  if (kind === 'officerKilled') pd.wanted = 5; else if (kind === 'officerShot') pd.wanted = Math.max(pd.wanted, 4, next); else if (next > pd.wanted) pd.wanted = next;
  if (pd.wanted > 0) { pd.wantedAt = now; if (!seen || !pd.lastKnown) pd.lastKnown = { ...point(at.x, at.z), at: now }; }
  if (seen) { pd.identified = true; pd.lastKnown = { ...point(at.x, at.z), at: now }; pd.seenAt = now; }
  pd.searchStart = null;
}
/** Starts a mission-defined response (e.g. a reported robbery) at a minimum level. */
export function alert(pd, level, at, now, code = 'dispatch') {
  pd.heat = Math.max(pd.heat, WANTED[level].heat ?? 0); pd.wanted = Math.max(pd.wanted, level);
  pd.lastKnown = { ...point(at.x, at.z), at: now }; pd.wantedAt = now; pd.dispatchAt = Math.min(pd.dispatchAt, now + .5);
  say(pd, 'radio', code, at, { level: pd.wanted });
}
export function clearWanted(pd) {
  pd.wanted = 0; pd.heat = 0; pd.reports = []; pd.lastKnown = null; pd.identified = false; pd.containment = null; pd.roadblock = null;
  pd.surrender = null; pd.escape = 0; pd.searchStart = null; pd.hostileAt = -Infinity;
}

// ---------------------------------------------------------------- perception
function eyeOf(u) { return u.type === 'shuttle' ? 1.9 : 1.35; }
/** Does this unit (its crew, from inside the car) see the player? Field of view ahead, and all round when close. */
function unitSees(pd, u, p, inVehicle) {
  const d = dist(u, p);
  if (d > (u.siren ? 85 : 65)) return false;
  const off = Math.abs(angle(facing(u, p) - u.yaw));
  if (d > 16 && off > (u.mode === 'pursuit' ? 1.9 : 1.15)) return false;
  return pd.los(u, p, eyeOf(u), inVehicle ? 1.1 : 1.3);
}
function officerSees(pd, o, p, inVehicle) {
  if (o.hp <= 0 || o.mode === 'dismount' || o.mode === 'seated') return false;
  const d = dist(o, p);
  if (d > 55) return false;
  if (d > 9 && Math.abs(angle(facing(o, p) - o.yaw)) > 1.35) return false;
  return pd.los(o, p, o.mode === 'cover' ? 1.05 : 1.55, inVehicle ? 1.1 : 1.3);
}

// ---------------------------------------------------------------- driving
function nearestNode(at) { return ROAD_NODES.reduce((b, n) => dist(n, at) < dist(b, at) ? n : b, ROAD_NODES[0]); }
function routeTo(u, target, now, every = 1.2) {
  if (now < u.plan && u.target && dist(u.target, target) < 8) return;
  u.plan = now + every; u.target = point(target.x, target.z);
  const direct = dist(u, target) < 28;
  u.route = direct ? [u.target] : roadRoute(u, target).points.filter((q, i) => i > 0 || dist(u, q) > 6);
  if (!u.route.length || dist(u.route.at(-1), target) > 3) u.route.push(u.target);
}
/** Steers a unit along its route with the shared physics; slows for vehicles ahead; reverses out when stuck. */
function drive(u, dt, now, traffic, players, desired, stopAt = 3.4) {
  while (u.route.length > 1 && dist(u, u.route[0]) < 7) u.route.shift();
  const next = u.route[0] ?? u.target;
  if (!next) { advance(u, { throttle: 0, steer: 0, brake: true }, dt, traffic, players); return true; }
  // Keep right of the centre line on the way (Nigeria drives on the right); the final approach is direct.
  let aim = next;
  const far = dist(u, next);
  if (far > 12 && !(u.route.length <= 1 && far < 30)) { const h = facing(u, next); aim = { x: next.x - Math.cos(h) * 1.7, z: next.z + Math.sin(h) * 1.7 }; }
  const d = dist(u, next), turn = angle(facing(u, aim) - u.yaw), last = u.route.length <= 1;
  let speed = last && d < stopAt ? 0 : clamp(desired - Math.abs(turn) * 9, 4, desired);
  if (last) speed = Math.min(speed, Math.max(0, (d - stopAt) * 1.1));
  const wanted = speed;
  // Keep a gap to whatever is ahead in the lane (other units, traffic, the player's car when not ramming).
  for (const o of traffic) {
    if (o.id === u.id) continue;
    const dx = o.x - u.x, dz = o.z - u.z, ahead = dx * Math.sin(u.yaw) + dz * Math.cos(u.yaw), side = Math.abs(dx * Math.cos(u.yaw) - dz * Math.sin(u.yaw));
    const same = Math.cos(angle((o.yaw ?? 0) - u.yaw)) > .3;
    if (ahead > 0 && ahead < 14 && side < (same ? 2.6 : 1.5)) speed = Math.min(speed, Math.max(0, (ahead - 6.5) * .9 + Math.max(0, o.speed ?? 0)));
  }
  // Stuck (blocked by a car that is not moving, a wall, a kerb corner): back off and try again.
  if (Math.abs(u.speed) < .45 && wanted > 1) {
    u.stuckAt ??= now;
    if (now - u.stuckAt > 1.4) { u.reverseUntil = now + 1.1; u.stuckAt = null; }
  } else u.stuckAt = null;
  if (u.reverseUntil > now) advance(u, { throttle: -.7, steer: -Math.sign(turn || 1), brake: false }, dt, traffic, players);
  else advance(u, { throttle: speed > Math.abs(u.speed) + .3 ? 1 : 0, steer: clamp(turn * 1.7, -1, 1), brake: speed < Math.abs(u.speed) - 1 }, dt, traffic, players);
  return last && d < stopAt + .8 && Math.abs(u.speed) < .5;
}

// ---------------------------------------------------------------- officers on foot
function dismount(pd, u, p, now, reason) {
  if (u.officers.length) return true;
  const t = VEHICLE_TYPES[u.type], away = facing(p, u);
  const seats = u.type === 'shuttle' ? [[1, 1.2], [-1, 1.2], [1, -1], [-1, -1]] : [[1, -.02], [-1, -.02]];
  const crew = seats.slice(0, u.crew).flatMap(([side, sz], k) => {
    const seat = localPoint(u, side * .39, sz), door = localPoint(u, side * (t.width / 2 + .7), sz);
    if (blocked(door.x, door.z, .35)) return [];
    // Cover: behind the car (the side away from the player), spread along its length.
    const along = (k % 2 ? 1 : -1) * t.length * .32;
    const cover = point(u.x + Math.sin(away) * (t.width / 2 + .85) + Math.cos(away) * along, u.z + Math.cos(away) * (t.width / 2 + .85) - Math.sin(away) * along);
    return [{ id: `${u.id}-officer-${k}`, unit: u.id, side, ...door, door, seat, cover: blocked(cover.x, cover.z, .35) ? door : cover,
      yaw: u.yaw + side * Math.PI / 2, mode: 'dismount', at: now, hp: u.role === 'tactical' ? 140 : 100, maxHp: u.role === 'tactical' ? 140 : 100,
      weapon: u.role === 'tactical' ? 'vanguard' : 'sparrow', nextShot: now + 1.6 + k * .35, peekUntil: 0, coverAt: 0 }];
  });
  if (!crew.length) return false;
  u.officers = crew; u.speed = 0; u.mode = reason; u.siren = true;
  say(pd, 'radio', reason === 'investigate' ? 'onScene' : 'deploy', u, { unit: u.id });
  return true;
}
function walk(o, target, speed, dt) {
  const d = dist(o, target);
  if (d < .12) return true;
  o.yaw = facing(o, target);
  Object.assign(o, moveWithCollisions(o.x, o.z, Math.sin(o.yaw) * Math.min(d, speed * dt), Math.cos(o.yaw) * Math.min(d, speed * dt)));
  return d < .2;
}
/** Would a shot between a and b (heights ya, yb) pass through a vehicle body (not the shooter's own car)? */
export function vehicleInTheWay(a, ya, b, yb, vehicles, skip = null) {
  const d = dist(a, b), steps = Math.ceil(d / .3);
  for (let i = 2; i < steps - 1; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = ya + (yb - ya) * t;
    for (const v of vehicles) if (v.id !== skip && y < VEHICLE_TYPES[v.type].height - .05 && vehicleContains(v, x, z, -.05)) return true;
  }
  return false;
}

function officerStep(pd, u, o, p, dt, now, ctx) {
  if (o.hp <= 0) return;
  const inVehicle = !!ctx.vehicle, sees = officerSees(pd, o, p, inVehicle);
  if (sees) { pd.seenAt = now; pd.lastKnown = { ...point(p.x, p.z), at: now }; if (dist(o, p) < 40) pd.identified = true; }
  if (o.mode === 'dismount') { if (now - o.at > .9) o.mode = 'deploy'; return; }
  if (o.mode === 'board') { if (walk(o, o.door, 3.6, dt)) { o.mode = 'seated'; } return; }
  if (o.mode === 'seated') return;
  if (o.mode === 'arrest') {
    if (walk(o, localTo(p, o), 1.9, dt) && dist(o, p) < 1.7) { pd.surrender.cuffing = (pd.surrender.cuffing ?? 0) + dt; o.yaw = facing(o, p); }
    return;
  }
  if (o.mode === 'search') {
    o.lookAt ??= now;
    const goal = o.searchPoint ?? pd.lastKnown ?? u;
    if (walk(o, goal, 1.7, dt) || now - o.lookAt > 9) { o.searchPoint = point(o.door.x + (pd.random() - .5) * 18, o.door.z + (pd.random() - .5) * 18); if (blocked(o.searchPoint.x, o.searchPoint.z)) o.searchPoint = o.door; o.lookAt = now; }
    if (sees && dist(o, p) < 30) o.mode = 'deploy';
    return;
  }
  // Deploy to cover, then hold it: crouched, weapon drawn, peeking to aim or fire.
  if (o.mode === 'deploy') { if (walk(o, o.cover, 3.1, dt)) { o.mode = 'cover'; o.coverAt = now; } return; }
  if (o.mode === 'cover' || o.mode === 'aim' || o.mode === 'fire') {
    o.yaw = facing(o, p);
    const threat = now - pd.hostileAt < 12 || pd.wanted >= 5;
    const d = dist(o, p);
    if (threat && sees && d < 48) {
      if ((o.mode === 'cover' || o.mode === 'aim') && now >= o.nextShot - .4) { o.mode = 'fire'; o.peekUntil = now + 1.4; }
      if (o.mode === 'fire' && now >= o.nextShot) {
        const w = o.weapon === 'vanguard' ? RIFLE : PISTOL;
        o.nextShot = now + w.cadence + pd.random() * .25;
        const exposed = ctx.vehicle ? 1.15 : 1.3, blockedByCar = vehicleInTheWay(o, 1.45, p, exposed, ctx.vehicles, u.id);
        const hit = !blockedByCar && pd.random() < clamp(w.spread - d * .016 - (ctx.moving ? .22 : 0) - (ctx.vehicle ? .12 : 0), .12, .75);
        ctx.events.push({ kind: 'enemyShot', x: o.x, y: 1.42, z: o.z, end: [p.x + (hit ? 0 : (pd.random() - .5) * 2.4), 1.2, p.z + (hit ? 0 : (pd.random() - .5) * 2.4)], weapon: o.weapon, police: true });
        pd.lastShotAt = now;
        if (hit) ctx.hurt(w.damage, ctx.vehicle ? 'vehicle' : 'body');
        else if (blockedByCar) ctx.events.push({ kind: 'impact', x: p.x, y: .9, z: p.z, surface: 'metal' });
      }
      if (o.mode === 'fire' && now > o.peekUntil) { o.mode = 'cover'; o.nextShot = Math.max(o.nextShot, now + .8 + pd.random()); }
    } else o.mode = sees ? 'aim' : 'cover';
  }
}
const localTo = (p, o) => { const a = facing(p, o); return point(p.x + Math.sin(a) * 1.2, p.z + Math.cos(a) * 1.2); };

// ---------------------------------------------------------------- the response
/** Player's shot against officers: returns the hit officer (and applies damage), or null. */
export function shootOfficers(pd, origin, dir, maxT, damage, raySphere, now, vehicles) {
  let best = maxT, hit = null, head = false;
  for (const u of pd.units) for (const o of u.officers) {
    if (o.hp <= 0 || o.mode === 'seated') continue;
    const crouch = o.mode === 'cover';
    for (const [h, r, isHead] of crouch ? [[.45, .38, false], [.85, .4, false], [1.12, .23, true]] : [[.52, .37, false], [1.13, .44, false], [1.65, .24, true]]) {
      const t = raySphere(origin.x, origin.y, origin.z, dir[0], dir[1], dir[2], o.x, h, o.z, r, best);
      if (t >= 0) { best = t; hit = o; head = isHead; }
    }
  }
  if (!hit) return null;
  const at = { x: origin.x + dir[0] * best, z: origin.z + dir[2] * best }, y = origin.y + dir[1] * best;
  if (vehicleInTheWay(origin, origin.y, at, y, vehicles, null)) return { blocked: true, t: best };
  hit.hp = Math.max(0, hit.hp - damage * (head ? 2 : 1));
  pd.hostileAt = now;
  pd.events.push({ kind: 'hit', x: hit.x, y: 1, z: hit.z, officer: hit.id });
  crime(pd, hit.hp ? 'officerShot' : 'officerKilled', hit, now, 'police');
  if (!hit.hp) { hit.mode = 'down'; say(pd, 'radio', 'officerDown', hit); }
  return { officer: hit, t: best };
}
/** A blast: hurts officers and damages units within range (line of sight is the caller's). */
export function blastPolice(pd, at, radius, clear) {
  for (const u of pd.units) {
    const d = dist(u, at);
    if (d < radius && clear(at, u)) u.condition = Math.max(0, u.condition - Math.round(70 * (1 - d / radius)));
    for (const o of u.officers) if (o.hp > 0 && dist(o, at) < radius * .6 && clear(at, o)) { o.hp = Math.max(0, o.hp - 90 * (1 - dist(o, at) / (radius * .6))); if (!o.hp) o.mode = 'down'; }
  }
}
export function playerThreat(pd, now) { pd.hostileAt = now; }
export function surrender(pd, p, now) {
  const near = pd.units.some(u => dist(u, p) < 32) && pd.wanted > 0;
  if (!near) return false;
  pd.surrender = { at: now, x: p.x, z: p.z, cuffing: 0 };
  say(pd, 'command', 'getDown', p);
  return true;
}

function freeBay(pd, traffic) {
  return POLICE_BAYS.find(b => !traffic.some(v => Math.hypot(v.x - b.x, v.z - b.z) < 4.5));
}
function respondingUnits(pd) { return pd.units.filter(u => u.mode !== 'patrol' && u.mode !== 'return' && u.condition > 0); }

/**
 * One simulation step. ctx: { vehicle (the player's car, or null), moving, aiming, vehicles (everything else that
 * drives), players ([p]), hurt(amount), events (the mission's event list), onImpact }.
 */
export function stepPolice(pd, p, dt, now, ctx) {
  ctx.vehicles = [...ctx.vehicles];
  const traffic = [...ctx.vehicles, ...pd.units];
  ctx.vehicles = traffic;
  const inVehicle = !!ctx.vehicle, playerSpeed = inVehicle ? Math.abs(ctx.vehicle.speed) : ctx.moving ? 4 : 0;
  // Reports reaching dispatch.
  for (const r of pd.reports.filter(r => now >= r.due)) {
    pd.reports.splice(pd.reports.indexOf(r), 1);
    const before = pd.wanted;
    apply(pd, r.kind, r.severity, r.at, now, false);
    say(pd, 'radio', r.kind === 'gunfire' ? 'shotsFired' : r.kind === 'explosion' ? 'explosion' : r.kind === 'alarm' ? 'alarm' : r.kind === 'crash' || r.kind === 'ram' ? 'collision' : 'report', r.at, { level: pd.wanted, raised: pd.wanted > before });
  }
  // Perception from every crewed car.
  let visible = false;
  for (const u of pd.units) {
    u.sees = u.condition > 0 && !u.officers.some(o => o.mode !== 'seated') && unitSees(pd, u, p, inVehicle);
    if (u.sees) { visible = true; u.lastSeen = now; }
  }
  if (pd.units.some(u => u.officers.some(o => officerSees(pd, o, p, inVehicle)))) visible = true;
  if (visible) {
    if (pd.wanted > 0 && now - pd.seenAt > 4) say(pd, 'radio', 'visual', p, { level: pd.wanted });
    pd.seenAt = now; pd.lastKnown = { ...point(p.x, p.z), at: now, vx: inVehicle ? Math.sin(ctx.vehicle.yaw) * ctx.vehicle.speed : 0, vz: inVehicle ? Math.cos(ctx.vehicle.yaw) * ctx.vehicle.speed : 0 };
    if (pd.units.some(u => u.sees && dist(u, p) < 45)) pd.identified = true;
  }
  // Escalation from what officers see.
  if (pd.wanted > 0 && visible && pd.identified) {
    if (pd.wanted === 1 && (playerSpeed > 7 || now - pd.hostileAt < 3)) { pd.wanted = 2; pd.heat = Math.max(pd.heat, WANTED[2].heat); say(pd, 'radio', 'pursuit', p, { level: 2 }); }
    if (pd.wanted >= 2) pd.heat += dt * (playerSpeed > 6 ? .1 : .03);
    const level = WANTED.reduce((l, w) => pd.heat >= (w.heat ?? Infinity) ? w.level : l, 0);
    if (level > pd.wanted && pd.wanted >= 2) { pd.wanted = Math.min(5, level); pd.dispatchAt = Math.min(pd.dispatchAt, now + 1); say(pd, 'radio', pd.wanted === 3 ? 'backup' : pd.wanted === 4 ? 'tactical' : 'maximum', p, { level: pd.wanted }); }
  }
  if (ctx.aiming && visible && pd.wanted > 0 && now - pd.hostileAt > 2) { pd.hostileAt = now; crime(pd, 'aiming', p, now, 'police'); }
  // Dispatch: more units as the level rises, physically leaving the Security District motor pool.
  const want = Math.min(MAX_UNITS, WANTED[pd.wanted].units);
  if (pd.wanted > 0) {
    for (const u of pd.units.filter(u => u.mode === 'patrol' || u.mode === 'return')) if (respondingUnits(pd).length < want) { u.mode = 'respond'; u.plan = 0; say(pd, 'radio', 'responding', u, { unit: u.id }); }
    if (respondingUnits(pd).length < want && now >= pd.dispatchAt && pd.units.length < MAX_UNITS + 2) {
      const bay = freeBay(pd, traffic);
      if (bay) {
        const tactical = WANTED[pd.wanted].tactical && !pd.units.some(u => u.role === 'tactical');
        const u = unit(pd, tactical ? 'tactical' : 'response', bay.x, bay.z, bay.yaw, now);
        pd.units.push(u); traffic.push(u); say(pd, 'radio', tactical ? 'tacticalRolling' : 'responding', u, { unit: u.id });
      }
      pd.dispatchAt = now + (pd.wanted >= 4 ? 4 : 7);
    }
  }
  // Containment: the player is slow or on foot with units close: they box in, and officers get out.
  const lk = pd.lastKnown;
  if (pd.wanted >= 2 && visible && playerSpeed < 2.2 && pd.units.some(u => u.condition > 0 && dist(u, p) < 26)) {
    if (!pd.containment) { pd.containment = { x: p.x, z: p.z, at: now }; pd.commands = 0; say(pd, 'radio', 'contained', p, { level: pd.wanted }); if (pd.wanted < 4) { pd.wanted = 4; pd.heat = Math.max(pd.heat, WANTED[4].heat); } }
  } else if (pd.containment && (dist(p, pd.containment) > 16 && playerSpeed > 4 || !visible && now - pd.seenAt > 6)) {
    say(pd, 'radio', 'breakout', p); pd.containment = null; pd.surrender = null;
    for (const u of pd.units) for (const o of u.officers) if (o.hp > 0) o.mode = 'board';
  }
  // Roadblock ahead of a fleeing driver (level 3+): one unit takes a junction 80–220 m ahead and stops across it.
  if (WANTED[pd.wanted].roadblock && visible && inVehicle && playerSpeed > 8 && (!pd.roadblock || dist(pd.roadblock, p) > 260)) {
    const vx = Math.sin(ctx.vehicle.yaw), vz = Math.cos(ctx.vehicle.yaw);
    const ahead = ROAD_NODES.filter(n => inMetro(n.x, n.z) && ((n.x - p.x) * vx + (n.z - p.z) * vz) > 80 && dist(n, p) < 220 && Math.abs((n.x - p.x) * vz - (n.z - p.z) * vx) < 30);
    const node = ahead.sort((a, b) => dist(a, p) - dist(b, p))[0];
    const taker = node && pd.units.filter(u => u.mode !== 'contain' && u.condition > 0 && !u.officers.length).sort((a, b) => dist(a, node) - dist(b, node))[0];
    if (node && taker && dist(taker, node) < dist(p, node) * 1.4) { pd.roadblock = { ...point(node.x, node.z), unit: taker.id, at: now }; taker.mode = 'roadblock'; taker.plan = 0; say(pd, 'radio', 'roadblock', node, { unit: taker.id }); }
  }
  if (pd.roadblock && (dist(pd.roadblock, p) > 300 || now - pd.roadblock.at > 70)) { const u = pd.units.find(u => u.id === pd.roadblock.unit); if (u && u.mode === 'roadblock') { u.mode = 'respond'; for (const o of u.officers) if (o.hp > 0) o.mode = 'board'; } pd.roadblock = null; }

  const cctx = { ...ctx, vehicles: traffic };
  let index = 0;
  for (const u of pd.units) {
    index++;
    // Officers on foot first; a car only moves once its crew is back aboard.
    for (const o of u.officers) officerStep(pd, u, o, p, dt, now, cctx);
    if (u.officers.length) {
      const out = u.officers.filter(o => o.hp > 0 && o.mode !== 'seated');
      if (!out.length && !pd.containment) { u.officers = u.officers.filter(o => o.hp <= 0); u.bodies = [...(u.bodies ?? []), ...u.officers]; u.officers = []; u.mode = pd.wanted ? 'respond' : 'return'; u.plan = 0; }
      else { u.speed = 0; continue; }
    }
    if (u.condition <= 0) { u.speed *= .9; continue; }
    u.siren = pd.wanted >= 2 && u.mode !== 'patrol' && u.mode !== 'return' || u.mode === 'roadblock';
    const d = dist(u, p);
    if (pd.wanted === 0 && u.mode !== 'patrol') u.mode = u.role === 'patrol' ? 'patrol' : 'return';
    if (u.mode === 'patrol') {
      const loop = u.loop ?? PATROLS[0], q = point(...loop[u.loopIndex % loop.length]);
      if (dist(u, q) < 9) u.loopIndex++;
      routeTo(u, point(...loop[u.loopIndex % loop.length]), now, 3);
      drive(u, dt, now, traffic, ctx.players, 11);
      continue;
    }
    if (u.mode === 'return') {
      if (u.role === 'patrol') { u.mode = 'patrol'; continue; }
      const home = POLICE_BAYS[0];
      routeTo(u, home, now, 3);
      // Units that are back at the station, or far out of sight, stand down.
      if (dist(u, home) < 25 || d > 180 && !u.sees) { u.gone = true; continue; }
      drive(u, dt, now, traffic, ctx.players, 13);
      continue;
    }
    if (u.mode === 'roadblock' && pd.roadblock?.unit === u.id) {
      routeTo(u, pd.roadblock, now, 2);
      if (drive(u, dt, now, traffic, ctx.players, 21, 2)) dismount(pd, u, p, now, 'roadblock');
      continue;
    }
    if (pd.containment && d < 34) {
      // Box in: a slot on a ring round the player, from the side this unit approached.
      const slot = facing(p, u) + (index % 2 ? .25 : -.25), ring = point(p.x + Math.sin(slot) * 9.5, p.z + Math.cos(slot) * 9.5);
      u.route = [ring]; u.target = ring;
      u.mode = 'contain';
      // Close enough: stop where it is (angled across the player's escape) and deploy.
      if (d < 13.5 || dist(u, ring) < 2.5) { advance(u, { throttle: 0, steer: 0, brake: true }, dt, traffic, ctx.players); if (Math.abs(u.speed) < .4) dismount(pd, u, p, now, 'contain'); }
      else drive(u, dt, now, traffic, ctx.players, 9, 1.2);
      continue;
    }
    if (pd.wanted === 1) {
      // Investigation: the incident location, then a look round on foot.
      const goal = lk ?? u;
      routeTo(u, goal, now, 2);
      if (drive(u, dt, now, traffic, ctx.players, 14, 9) && !u.officers.length && dismount(pd, u, p, now, 'investigate')) for (const o of u.officers) o.mode = 'search';
      if (u.sees && d < 30 && now - pd.warnedAt > 6) { pd.warnedAt = now; say(pd, 'command', 'police', u); }
      continue;
    }
    if (u.sees || now - u.lastSeen < 1.2) {
      u.mode = 'pursuit';
      // Interceptors aim at where the player will be; the others follow.
      let goal = point(p.x, p.z);
      if (WANTED[pd.wanted].intercept && index % 2 === 0 && inVehicle && d > 30 && lk?.vx !== undefined) goal = point(p.x + lk.vx * clamp(d / 22, 1, 4), p.z + lk.vz * clamp(d / 22, 1, 4));
      routeTo(u, goal, now, d < 40 ? .4 : 1);
      drive(u, dt, now, ctx.vehicle ? traffic.filter(v => v.id !== ctx.vehicle.id || pd.wanted < 4 || d > 12) : traffic, ctx.players, pd.wanted >= 3 ? 23 : 20, 4);
    } else if (lk && now - pd.seenAt < 6) {
      // Another unit has eyes on the player: converge on the reported position at speed.
      u.mode = 'respond';
      routeTo(u, lk, now, 1.5);
      drive(u, dt, now, traffic, ctx.players, pd.wanted >= 3 ? 22 : 19, 6);
    } else if (lk) {
      // Search: the last known position, then nearby junctions (the search widens with time).
      u.mode = 'search';
      if (!u.searchPoint || dist(u, u.searchPoint) < 10 || now > u.searchAt) {
        const r = 40 + pd.searchRadius, cands = ROAD_NODES.filter(n => dist(n, lk) < r && inMetro(n.x, n.z, 20));
        u.searchPoint = now - lk.at < 6 ? point(lk.x, lk.z) : cands.length ? cands[Math.floor(pd.random() * cands.length)] : point(lk.x, lk.z);
        u.searchAt = now + 18;
      }
      routeTo(u, u.searchPoint, now, 2);
      drive(u, dt, now, traffic, ctx.players, 12, 5);
    } else {
      u.mode = 'respond';
      routeTo(u, nearestNode(p), now, 3);
      drive(u, dt, now, traffic, ctx.players, 16);
    }
  }
  pd.units = pd.units.filter(u => !u.gone);
  // Surrender and arrest: two officers walk up and cuff the player.
  if (pd.surrender) {
    if (dist(p, pd.surrender) > 2.5 || ctx.firedAt > pd.surrender.at) { pd.surrender = null; pd.hostileAt = now; say(pd, 'command', 'finalWarning', p); }
    else {
      const crew = pd.units.flatMap(u => u.officers).filter(o => o.hp > 0 && o.mode !== 'seated' && o.mode !== 'board').sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 2);
      if (!crew.length) for (const u of pd.units.filter(u => dist(u, p) < 32).slice(0, 1)) dismount(pd, u, p, now, 'contain');
      for (const o of crew) o.mode = 'arrest';
      if ((pd.surrender.cuffing ?? 0) > 2.2) { pd.arrested = true; say(pd, 'command', 'arrested', p); }
    }
  }
  // Commands at a containment: what the officers see the player doing decides what they shout.
  if (pd.containment && visible && now - pd.commandAt > 3.6 && pd.units.some(u => u.officers.some(o => o.mode === 'cover' || o.mode === 'aim'))) {
    pd.commandAt = now; pd.commands++;
    const threat = now - pd.hostileAt < 8;
    const code = pd.surrender ? 'stayDown' : threat ? (pd.commands % 2 ? 'dropWeapon' : 'shotsFired') : inVehicle ? (pd.commands < 3 ? ['stepOut', 'engineOff', 'handsOnWheel'][pd.commands % 3] : 'finalWarning') : (pd.commands < 3 ? ['freeze', 'handsUp', 'getDown'][pd.commands % 3] : 'finalWarning');
    const speaker = pd.units.flatMap(u => u.officers).find(o => o.hp > 0 && (o.mode === 'cover' || o.mode === 'aim'));
    say(pd, 'command', code, speaker ?? p, { officer: speaker?.id });
  }
  // Search, then escape: out of sight for long enough AND outside the search area.
  if (pd.wanted > 0 && !visible) {
    pd.searchStart ??= now;
    const unseen = now - Math.max(pd.seenAt, pd.wantedAt), need = 14 + pd.wanted * 6;
    pd.searchRadius = Math.min(220, 30 + (now - pd.searchStart) * 4 + pd.wanted * 10);
    const outside = !lk || dist(p, lk) > pd.searchRadius * .55 + 25;
    const nearest = pd.units.reduce((m, u) => Math.min(m, dist(u, p)), Infinity);
    pd.escape = clamp(Math.min(unseen / need, outside ? 1 : .6), 0, 1);
    if (pd.wanted === 1 && unseen > 25 && now - pd.wantedAt > 20 || unseen >= need && outside && nearest > 45) {
      say(pd, 'radio', 'searchOver', p, { level: 0 });
      clearWanted(pd);
    }
  } else { pd.searchStart = null; pd.escape = 0; pd.searchRadius = 0; }
  if (pd.events.length) { ctx.events.push(...pd.events); pd.events.length = 0; }
  return { visible };
}

export function viewPolice(pd, now) {
  return {
    wanted: pd.wanted, level: WANTED[pd.wanted].name, escape: Math.round(pd.escape * 100) / 100, contained: !!pd.containment, surrender: !!pd.surrender,
    searching: pd.wanted > 0 && pd.searchStart !== null, lastKnown: pd.lastKnown && pd.searchStart !== null ? { x: Math.round(pd.lastKnown.x), z: Math.round(pd.lastKnown.z), r: Math.round(pd.searchRadius) } : null,
    units: pd.units.map(({ id, type, x, z, yaw, speed, wheel, steering, occupants, mode, siren, condition, livery, role }) => ({ id, type, x, z, yaw, speed, wheel, steering, occupants, police: true, mode, siren, condition, livery, role })),
    officers: pd.units.flatMap(u => [...u.officers, ...(u.bodies ?? [])].map(({ id, side, x, z, yaw, mode, seat, at, hp, weapon }) => ({ id, side, x, z, yaw, mode, seat, age: now - at, hp, weapon }))),
  };
}
void ROADS;
