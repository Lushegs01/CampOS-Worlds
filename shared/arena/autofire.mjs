// Combat Arena auto-fire: an optional, player-controlled setting (off by default) that presses the trigger
// for the player while the aim they control themselves is on a valid, visible enemy.
//
// It is deliberately not aim assistance. It never moves the view, never looks for targets anywhere but along
// the player's own line of fire, and only ever sets the same FIRE button a player can press. Everything else
// is unchanged: the shared simulation (shared/arena/sim.mjs) decides whether the weapon can fire (fire rate,
// magazine, reload, switching, sprint) on the client and again on the server, the server decides every hit
// with its own ray casts and lag compensation, and interest management means enemies behind walls are never
// even sent to the client. Spread, recoil and damage are identical with or without it.
//
// The client calls `autoFireDecision` once per 60 Hz input tick (src/arena/net.ts).
import { raycast } from './physics.mjs';
import { weaponOf, fireModeOf, direction, eyeOf, hitbox, B } from './sim.mjs';
import { damageAt, isFirearm } from './weapons.mjs';

/** Stance from a remote player's snapshot flags (crouch 2, slide 4). */
export const heightFromFlags = flags => (flags & 4 ? 1.0 : flags & 2 ? 1.25 : 1.8);

/** Distance along the ray (ox, oy, oz) + t·(dx, dy, dz) to a player's head sphere or body box, or Infinity. */
export function rayHitsPlayer(ox, oy, oz, dx, dy, dz, x, y, z, h) {
  const b = hitbox(x, y, z, h);
  let best = Infinity;
  // Head: sphere.
  const lx = ox - b.hx, ly = oy - b.hy, lz = oz - b.hz, bq = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - b.hr * b.hr, disc = bq * bq - c;
  if (disc >= 0) { const t = -bq - Math.sqrt(disc); if (t > 0) best = t; }
  // Body: axis-aligned box (slab method).
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return best; continue; }
    let a = (lo - o) / d, e = (hi - o) / d; if (a > e) [a, e] = [e, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, e); if (t0 > t1) return best;
  }
  return Math.min(best, t0 > 0 ? t0 : best);
}

const scratch = { t: 0, box: null, normal: [0, 0, 0] }, dir = [0, 0, 0];
/**
 * Whether auto-fire should hold the trigger this tick.
 *   sim      the player's predicted simulation state (null when not deployed)
 *   view     { yaw, pitch }: the view the player is steering (recoil is added as the simulation adds it)
 *   targets  other players as drawn: { team, alive, x, y, z, flags, visible } (visible: in the latest snapshot)
 *   world    the map's collision world (shared/arena/physics.mjs)
 *   team     the player's team
 *   held     buttons the player is pressing themselves this tick
 * Returns { fire, reason, target, distance }.
 */
export function autoFireDecision({ sim, view, targets, world, team, held = 0 }) {
  const no = reason => ({ fire: false, reason, target: null, distance: 0 });
  if (!sim) return no('not deployed');
  const w = weaponOf(sim);
  if (!isFirearm(w)) return no('melee weapon');
  if (sim.phase !== 'ready') return no(sim.phase);
  const cur = sim.wpn[sim.slot];
  if (cur.mag <= 0) return no('magazine empty');
  // Sprinting is the player's choice to move, not to shoot: auto-fire never cancels it.
  if (sim.sprint || (held & B.SPRINT)) return no('sprinting');
  // Semi-automatic, burst and bolt-action weapons fire once per trigger press: release between shots.
  if (fireModeOf(sim) !== 'auto' && sim.trig) return no('trigger reset');
  const ox = sim.x, oy = eyeOf(sim), oz = sim.z;
  direction(view.yaw + sim.ry, view.pitch + sim.rp, dir);
  let best = null, bestT = Infinity;
  for (const t of targets) {
    // Teammates count too, so a teammate in the line of fire stops auto-fire rather than being shot at.
    if (!t || !t.alive || !t.visible || t.team < 0) continue;
    const d = rayHitsPlayer(ox, oy, oz, dir[0], dir[1], dir[2], t.x, t.y, t.z, heightFromFlags(t.flags ?? 0));
    if (d < bestT) { bestT = d; best = t; }
  }
  if (!best) return no('no enemy under the crosshair');
  if (best.team === team) return no('teammate in the line of fire');
  if (bestT > w.range || damageAt(w, bestT) <= 0) return no('out of range');
  // Line of sight: nothing solid between the eye and the enemy along the line of fire.
  const wall = world ? raycast(world, ox, oy, oz, dir[0], dir[1], dir[2], bestT, null, scratch) : null;
  if (wall && wall.t < bestT - .05) return no('obstructed');
  return { fire: true, reason: 'enemy under the crosshair', target: best, distance: bestT };
}
