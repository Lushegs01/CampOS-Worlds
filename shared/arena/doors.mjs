// Doors: every doorway in a map's walls (a `deco` opening of kind 'door' no wider than 2.2 m and no taller than 3.6 m)
// gets a leaf that opens and closes. Wider openings are vehicle bays and arcades (Foundry Yard's warehouse bays, Sim
// Quad's arcades): they have no hinged door and stay open. Shared by the server (authority: who may open or close which door, movement, hits,
// line of sight) and the client (prediction, rendering, the "use" prompt), so both see the same doors.
//
// A door is a box in the collision world (physics.mjs) that is switched off while the door is open. Every door
// starts open, so a map's routes, sightlines and balance are exactly as designed until a player closes one; a new
// round opens them all again. Closed doors block movement and line of sight; like other thin cover they can be shot
// through by penetrating rounds (shared/arena/weapons.mjs `penetration`).
import { createWorld } from './physics.mjs';

/** How far a player can reach a door from (metres from the eye to the nearest point of the leaf). */
export const DOOR_REACH = 1.9;
/** A door cannot be worked again until its leaf has swung (milliseconds; server rule, also used for the animation). */
export const DOOR_SWING_MS = 450;
/** The largest opening that is a doorway (metres): anything bigger is a bay or an arcade. */
export const DOORWAY = { w: 2.2, h: 3.6 };
/** Leaf thickness (metres). */
const LEAF = .08;
const PLAYER_R = .3, PLAYER_H = 1.8;

const cache = new WeakMap();
/**
 * The doors of a map, in a fixed order (their index is their id on the wire). Each is { i, min, max, alongZ, w, h }:
 * min/max is the closed leaf (centred in the wall), alongZ whether the wall runs along z, w/h the opening's size.
 */
export function doorsOf(map) {
  let list = cache.get(map); if (list) return list;
  list = (map.deco ?? []).filter(d => d.kind === 'door' && Math.max(d.max[0] - d.min[0], d.max[2] - d.min[2]) <= DOORWAY.w && d.max[1] - d.min[1] <= DOORWAY.h).map((d, i) => {
    const alongZ = !!d.alongZ, min = [...d.min], max = [...d.max];
    // Thin the leaf to the middle of the wall's thickness.
    const a = alongZ ? 0 : 2, mid = (min[a] + max[a]) / 2, t = max[a] - min[a]; min[a] = mid - LEAF / 2; max[a] = mid + LEAF / 2;
    return { i, min, max, alongZ, t, w: alongZ ? max[2] - min[2] : max[0] - min[0], h: max[1] - min[1] };
  });
  // How each opens, from the map's solid geometry.
  for (const d of list) d.leaves = doorLeafPlan(d, map.boxes);
  cache.set(map, list);
  return list;
}

/** The open leaf's angle from the wall (radians): just past square, or (where square would close off the space beside
 *  the door) folded back flat against the wall. */
export const DOOR_OPEN_ANGLE = 1.62, DOOR_FOLD_ANGLE = 2.97;
/** Clear room needed beyond a square-open leaf (metres): two players abreast, so a leaf never pinches a corridor. */
const PASS = 1.2;

/** The leaves of a doorway, shut (in the wall frame: u along the wall, n across it). */
function leavesOf(d) {
  const a0 = d.alongZ ? d.min[2] : d.min[0], a1 = d.alongZ ? d.max[2] : d.max[0], c = (a0 + a1) / 2;
  const pair = d.w > 1.3, w = pair ? d.w / 2 - .01 : d.w - .02, h = d.h - .02, y0 = d.min[1] + .01;
  return pair ? [{ hinge: a0 + .01, dir: 1, w, h, y0 }, { hinge: a1 - .01, dir: -1, w, h, y0 }] : [{ hinge: c > 0 ? a1 - .01 : a0 + .01, dir: c > 0 ? -1 : 1, w, h, y0 }];
}
/** A leaf's footprint open at `angle` on side `swing` (world-axis box), optionally grown across the wall by `extra`. */
function leafBox(d, l, swing, angle, extra = 0, from = 0) {
  const T = .06, mid = d.alongZ ? (d.min[0] + d.max[0]) / 2 : (d.min[2] + d.max[2]) / 2;
  // The leaf's local +x (dir), turned by −swing·dir·angle about y, lands at u = dir·w·cos, n = swing·w·sin
  // (n is −x when the wall runs along z): see the renderer's hinge frame in src/arena/scene/doorLeaves.ts.
  const tipU = l.hinge + l.dir * l.w * Math.cos(angle), n1 = swing * (l.w * Math.sin(angle) + T / 2 + extra), n0 = swing * from;
  let u0 = Math.min(l.hinge, tipU) - T / 2, u1 = Math.max(l.hinge, tipU) + T / 2;
  // Never into the opening itself: an open door leaves its whole doorway clear (the leaf's half-thickness over the
  // jamb line is 2 cm of paint, not something to stop a player on).
  const j = l.dir > 0 ? l.hinge - .01 : l.hinge + .01;
  if (l.dir > 0) u1 = Math.min(u1, j); else u0 = Math.max(u0, j);
  const nA = Math.min(n0, n1), nB = Math.max(n0, n1);
  return d.alongZ ? { min: [mid - nB, l.y0, u0], max: [mid - nA, l.y0 + l.h, u1] } : { min: [u0, l.y0, mid + nA], max: [u1, l.y0 + l.h, mid + nB] };
}
const hits = (a, boxes) => boxes.some(b => a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2]);

/**
 * How a door opens, chosen from the map's own geometry (so mirrored doors make mirrored choices and the map stays
 * symmetric): square into the side away from the map's centre line; else square into the other side; else folded
 * back flat against the wall. "Square" is allowed only where nothing solid stands in the leaf's arc or in the
 * player-wide strip beyond its tip, so an open door never closes off a corridor or a corner.
 * Returns the leaves with `swing` (the side, ±n) and `angle`. Shared by the renderer and the collision world.
 */
export function doorLeafPlan(d, boxes = []) {
  const centre = d.alongZ ? (d.min[0] + d.max[0]) / 2 : (d.min[2] + d.max[2]) / 2, pref = (centre >= 0 ? 1 : -1) * (d.alongZ ? -1 : 1);
  const leaves = leavesOf(d), wallHalf = (d.t ?? .2) / 2 + .02;
  const clear = (swing, angle) => leaves.every(l => !hits(leafBox(d, l, swing, angle, angle === DOOR_OPEN_ANGLE ? PASS : .02, wallHalf), boxes));
  for (const [swing, angle] of [[pref, DOOR_OPEN_ANGLE], [-pref, DOOR_OPEN_ANGLE], [pref, DOOR_FOLD_ANGLE], [-pref, DOOR_FOLD_ANGLE]])
    if (clear(swing, angle)) return leaves.map(l => ({ ...l, swing, angle }));
  return leaves.map(l => ({ ...l, swing: pref, angle: DOOR_FOLD_ANGLE }));
}
/** Where each leaf stands when open, as collision boxes (world axes). An open door is in the way like any thin cover:
 *  players walk round it, and penetrating rounds go through it. */
export const openLeafBoxes = d => (d.leaves ?? doorLeafPlan(d)).map(l => leafBox(d, l, l.swing, l.angle));

/**
 * The match's collision world: the map's static boxes plus a switchable box per door (all open). The world keeps
 * `doorBox[i]` (the door's box) and `doors` (the list from doorsOf).
 * @returns {ReturnType<typeof createWorld> & { doors: ReturnType<typeof doorsOf>, doorBox: any[] }}
 */
export function arenaWorld(map) {
  const doors = doorsOf(map), n = map.boxes.length, leaves = doors.flatMap(d => openLeafBoxes(d).map(b => ({ ...b, thin: true, door: d.i })));
  const world = /** @type {any} */ (createWorld([...map.boxes, ...doors.map(d => ({ min: d.min, max: d.max, thin: true, door: d.i })), ...leaves], map.bounds));
  world.doors = doors; world.doorBox = doors.map((d, k) => world.boxes[n + k]);
  // Each door's open leaves: solid while the door is open, gone while it is shut (the closed leaf is `doorBox`).
  world.leafBox = doors.map(() => []); leaves.forEach((l, k) => world.leafBox[l.door].push(world.boxes[n + doors.length + k]));
  for (const b of world.doorBox) b.off = true;
  return world;
}
/** Every door's open-leaf boxes (for a navigation world planned with every door open). */
export const openLeafBoxesOf = map => doorsOf(map).flatMap(d => openLeafBoxes(d));

/** Open (true) or close (false) door `i` in a world. */
export function setDoor(world, i, open) { const b = world.doorBox?.[i]; if (b) b.off = !!open; for (const l of world.leafBox?.[i] ?? []) l.off = !open; }
export const doorOpen = (world, i) => !!world.doorBox?.[i]?.off;
/** The indices of the closed doors (what a joining or rejoining client is told). */
export function closedDoors(world) { const out = []; world.doorBox?.forEach((b, i) => { if (!b.off) out.push(i); }); return out; }
/** Open every door (a new round). Returns whether any was closed. */
export function openAllDoors(world) { let any = false; (world.doorBox ?? []).forEach((b, i) => { if (!b.off) any = true; setDoor(world, i, true); }); return any; }

/**
 * The door a player can work: the nearest leaf within reach of the eye (x, y, z) that lies in front of the view
 * (yaw: 0 looks along −z), or that the player is standing in. Returns its index or −1.
 */
export function doorInReach(world, x, y, z, yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best = -1, bestD = DOOR_REACH;
  for (const d of world.doors ?? []) {
    if (y < d.min[1] - .3 || y > d.max[1] + .6) continue;
    // Nearest point of the leaf (horizontally) to the eye.
    const px = Math.max(d.min[0], Math.min(x, d.max[0])), pz = Math.max(d.min[2], Math.min(z, d.max[2]));
    const dx = px - x, dz = pz - z, dist = Math.hypot(dx, dz);
    if (dist >= bestD) continue;
    if (dist > .45 && (dx * fx + dz * fz) / dist < .3) continue;
    best = d.i; bestD = dist;
  }
  return best;
}

const inside = (p, b) => p.x + PLAYER_R > b.min[0] && p.x - PLAYER_R < b.max[0] && p.z + PLAYER_R > b.min[2] && p.z - PLAYER_R < b.max[2] && p.y + PLAYER_H > b.min[1] && p.y < b.max[1];
/**
 * Would moving door `i` trap any of these bodies ({ x, y, z } feet positions)? Closing checks the doorway; opening
 * (`opening` true) checks where the leaves will stand.
 */
export function doorBlocked(world, i, bodies, opening = false) {
  const d = world.doors?.[i]; if (!d) return false;
  const areas = opening ? openLeafBoxes(d) : [d];
  return bodies.some(p => areas.some(b => inside(p, b)));
}
