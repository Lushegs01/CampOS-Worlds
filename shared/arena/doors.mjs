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
    const a = alongZ ? 0 : 2, mid = (min[a] + max[a]) / 2; min[a] = mid - LEAF / 2; max[a] = mid + LEAF / 2;
    return { i, min, max, alongZ, w: alongZ ? max[2] - min[2] : max[0] - min[0], h: max[1] - min[1] };
  });
  cache.set(map, list);
  return list;
}

/**
 * The match's collision world: the map's static boxes plus a switchable box per door (all open). The world keeps
 * `doorBox[i]` (the door's box) and `doors` (the list from doorsOf).
 * @returns {ReturnType<typeof createWorld> & { doors: ReturnType<typeof doorsOf>, doorBox: any[] }}
 */
export function arenaWorld(map) {
  const doors = doorsOf(map), n = map.boxes.length;
  const world = /** @type {any} */ (createWorld([...map.boxes, ...doors.map(d => ({ min: d.min, max: d.max, thin: true, door: d.i }))], map.bounds));
  world.doors = doors; world.doorBox = doors.map((d, k) => world.boxes[n + k]);
  for (const b of world.doorBox) b.off = true;
  return world;
}

/** Open (true) or close (false) door `i` in a world. */
export function setDoor(world, i, open) { const b = world.doorBox?.[i]; if (b) b.off = !!open; }
export const doorOpen = (world, i) => !!world.doorBox?.[i]?.off;
/** The indices of the closed doors (what a joining or rejoining client is told). */
export function closedDoors(world) { const out = []; world.doorBox?.forEach((b, i) => { if (!b.off) out.push(i); }); return out; }
/** Open every door (a new round). Returns whether any was closed. */
export function openAllDoors(world) { let any = false; for (const b of world.doorBox ?? []) { if (!b.off) any = true; b.off = true; } return any; }

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

/** Would closing door `i` trap any of these bodies ({ x, y, z } feet positions)? */
export function doorBlocked(world, i, bodies) {
  const d = world.doors?.[i]; if (!d) return false;
  for (const p of bodies) {
    if (p.x + PLAYER_R > d.min[0] && p.x - PLAYER_R < d.max[0] && p.z + PLAYER_R > d.min[2] && p.z - PLAYER_R < d.max[2] && p.y + PLAYER_H > d.min[1] && p.y < d.max[1]) return true;
  }
  return false;
}
