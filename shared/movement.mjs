// On-foot movement, integrated identically by the room server (authoritative) and the local client
// (prediction). Keeping one implementation is what keeps the two in agreement.
import { moveWithCollisions } from './campus.mjs';

export const WALK_SPEED = 4.5, SPRINT_SPEED = 8, JUMP_SPEED = 7;
const GRAVITY = 19, ACCEL = 12, SUBSTEP = .05;
/**
 * The room keeps applying a player's last input for this long, then stops them. The client never
 * integrates more than this per frame either: after a longer stall the room has stopped the player
 * too, so the two still agree. (A smaller client cap made every long frame drop time the room did
 * not drop, and the room ended up ahead of the player.)
 */
export const INPUT_HOLD_MS = 350;
export const MAX_STEP = INPUT_HOLD_MS / 1000;

/**
 * Advance a walker `{ x, z, y, vx, vz, vy }` by `dt` seconds towards the velocity (tx, tz), in short
 * substeps with campus collisions. `allow(x, z, fromX, fromZ)` can veto a substep (vehicle bodies).
 */
export function stepWalker(w, tx, tz, dt, allow) {
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP)), h = dt / steps, k = 1 - Math.exp(-ACCEL * h);
  for (let i = 0; i < steps; i++) {
    w.vx += (tx - w.vx) * k; w.vz += (tz - w.vz) * k;
    const q = moveWithCollisions(w.x, w.z, w.vx * h, w.vz * h);
    if (!allow || allow(q.x, q.z, w.x, w.z)) { w.x = q.x; w.z = q.z; }
    w.vy -= GRAVITY * h; w.y = Math.max(0, w.y + w.vy * h); if (w.y === 0) w.vy = 0;
  }
  return w;
}

/**
 * Recent positions of the local player. The room's view of us trails ours by the network and tick
 * delay, so a room position somewhere along the path we just walked is lag, not disagreement. Only a
 * position away from that path (a teleport, a wall the two sides saw differently) is real drift.
 */
export function createTrail(seconds = 1.5, size = 256) {
  const xs = new Float64Array(size), zs = new Float64Array(size), ts = new Float64Array(size);
  let head = 0, count = 0;
  const at = i => (head - 1 - i + size) % size; // i = 0 is the newest sample
  return {
    clear() { count = 0; },
    push(x, z, t) { xs[head] = x; zs[head] = z; ts[head] = t; head = (head + 1) % size; if (count < size) count++; },
    /** Distance from (x, z) to the path walked over the last `seconds` before `now` (Infinity when empty). */
    distance(x, z, now) {
      if (!count || now - ts[at(0)] > seconds * 1000) return Infinity;
      let best = Math.hypot(x - xs[at(0)], z - zs[at(0)]);
      for (let i = 1; i < count; i++) {
        const a = at(i - 1), b = at(i);
        if (now - ts[b] > seconds * 1000) break;
        const ex = xs[a] - xs[b], ez = zs[a] - zs[b], len = ex * ex + ez * ez;
        const k = len > 1e-9 ? Math.max(0, Math.min(1, ((x - xs[b]) * ex + (z - zs[b]) * ez) / len)) : 0;
        best = Math.min(best, Math.hypot(x - xs[b] - ex * k, z - zs[b] - ez * k));
      }
      return best;
    },
  };
}
