// Deterministic basketball physics shared by the room server (authoritative) and clients
// (prediction and offline play). A sphere against: court floor, backboards, torus rims, posts and
// the campus colliders. Fixed 240 Hz substeps keep fast shots from tunnelling through the rim.
import { COLLIDERS } from './campus.mjs';
import { HOOPS, BALLS } from './interactions.mjs';

export const BALL_R = .12, GRAVITY = 9.81, SUBSTEP = 1 / 240;
const COURT = { x0: 32.6, x1: 55.4, z0: 8.6, z1: 39.4 }, COURT_Y = .03;
const E = { floor: .76, board: .58, rim: .52, post: .45, wall: .4 };
export const floorAt = (x, z) => x > COURT.x0 && x < COURT.x1 && z > COURT.z0 && z < COURT.z1 ? COURT_Y : 0;

// Static obstacle boxes (min/max), built once: campus colliders, backboards, posts and arms.
const BOXES = [
  ...COLLIDERS.map(b => ({ min: [b.x - b.w / 2, 0, b.z - b.d / 2], max: [b.x + b.w / 2, b.h, b.z + b.d / 2], e: E.wall, kind: 'wall' })),
  ...HOOPS.flatMap(h => [
    { min: [h.board.x - h.board.w / 2, h.board.y - h.board.h / 2, h.board.z - h.board.d / 2], max: [h.board.x + h.board.w / 2, h.board.y + h.board.h / 2, h.board.z + h.board.d / 2], e: E.board, kind: 'board', hoop: h.id },
    { min: [h.post.x - h.post.w / 2, 0, h.post.z - h.post.d / 2], max: [h.post.x + h.post.w / 2, h.post.h, h.post.z + h.post.d / 2], e: E.post, kind: 'post' },
    { min: [h.arm.x - h.arm.w / 2, h.arm.y0, h.arm.z - h.arm.d / 2], max: [h.arm.x + h.arm.w / 2, h.arm.y1, h.arm.z + h.arm.d / 2], e: E.post, kind: 'post' },
  ]),
];

export function newBall(spec) { return { id: spec.id, x: spec.x, y: floorAt(spec.x, spec.z) + BALL_R + .9, z: spec.z, vx: 0, vy: 0, vz: 0, state: 'free', holder: null, shot: null, rest: 0, idle: 0 }; }
export function resetBall(b) { const spec = BALLS.find(s => s.id === b.id); Object.assign(b, newBall(spec), { y: floorAt(spec.x, spec.z) + .9 }); }

function bounce(b, nx, ny, nz, e, tangentKeep = .86) {
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return 0;
  // Remove normal velocity with restitution; keep most of the tangential velocity.
  const tx = b.vx - vn * nx, ty = b.vy - vn * ny, tz = b.vz - vn * nz;
  b.vx = tx * tangentKeep - vn * e * nx; b.vy = ty * tangentKeep - vn * e * ny; b.vz = tz * tangentKeep - vn * e * nz;
  return -vn;
}

/**
 * Advance one ball. Events (bounce, rim, board, score) are appended to `events`.
 * `shot` = { id, by, from: [x, z], scored } is set when the ball is released by a player.
 */
export function stepBall(b, dt, events = []) {
  if (b.state === 'held') return events;
  if (b.state === 'free' && b.rest > .5) return events; // sleeping on the ground
  const n = Math.max(1, Math.ceil(dt / SUBSTEP)), h = dt / n;
  for (let i = 0; i < n; i++) {
    const py = b.y;
    b.vy -= GRAVITY * h;
    const drag = 1 - .03 * h; b.vx *= drag; b.vy *= drag; b.vz *= drag;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    // Floor (court surface or ground).
    const fy = floorAt(b.x, b.z) + BALL_R;
    if (b.y < fy) {
      b.y = fy;
      const s = bounce(b, 0, 1, 0, E.floor, .97);
      if (s > .6) events.push({ type: 'bounce', ball: b.id, kind: 'floor', speed: s });
      if (Math.abs(b.vy) < .35) b.vy = 0;
      const roll = 1 - 1.6 * h; b.vx *= roll; b.vz *= roll;
      if (b.state === 'flight') { b.state = 'free'; }
    }
    // Boxes (only those near the ball).
    for (const box of BOXES) {
      if (b.x < box.min[0] - .3 || b.x > box.max[0] + .3 || b.z < box.min[2] - .3 || b.z > box.max[2] + .3 || b.y > box.max[1] + .3) continue;
      const cx = Math.max(box.min[0], Math.min(b.x, box.max[0])), cy = Math.max(box.min[1], Math.min(b.y, box.max[1])), cz = Math.max(box.min[2], Math.min(b.z, box.max[2]));
      let dx = b.x - cx, dy = b.y - cy, dz = b.z - cz, d = Math.hypot(dx, dy, dz);
      if (d >= BALL_R) continue;
      if (d < 1e-6) { dx = 0; dy = 1; dz = 0; d = 1; } // centre inside: push up
      const nx = dx / d, ny = dy / d, nz = dz / d;
      b.x = cx + nx * BALL_R; b.y = cy + ny * BALL_R; b.z = cz + nz * BALL_R;
      const s = bounce(b, nx, ny, nz, box.e);
      if (s > .4 && box.kind === 'board') events.push({ type: 'board', ball: b.id, hoop: box.hoop, speed: s });
      else if (s > .6) events.push({ type: 'bounce', ball: b.id, kind: box.kind, speed: s });
    }
    // Rims: a torus of radius R around the hoop axis with a tube of 1.2 cm.
    for (const hp of HOOPS) {
      const qx = b.x - hp.x, qz = b.z - hp.z, ql = Math.hypot(qx, qz);
      if (ql > hp.rimR + BALL_R + .05 || Math.abs(b.y - hp.rimY) > BALL_R + .05) {
        // Fall through to the scoring test only.
      } else if (ql > 1e-6) {
        const kx = hp.x + qx / ql * hp.rimR, kz = hp.z + qz / ql * hp.rimR;
        let dx = b.x - kx, dy = b.y - hp.rimY, dz = b.z - kz; const d = Math.hypot(dx, dy, dz), min = BALL_R + .012;
        if (d < min && d > 1e-6) {
          dx /= d; dy /= d; dz /= d;
          b.x = kx + dx * min; b.y = hp.rimY + dy * min; b.z = kz + dz * min;
          const s = bounce(b, dx, dy, dz, E.rim, .8);
          if (s > .3) events.push({ type: 'rim', ball: b.id, hoop: hp.id, speed: s });
        }
      }
      // Score: the ball's centre crosses the rim plane downwards inside the ring.
      if (b.shot && !b.shot.scored && py >= hp.rimY && b.y < hp.rimY && b.vy < 0 && Math.hypot(b.x - hp.x, b.z - hp.z) < hp.rimR - BALL_R * .35) {
        b.shot.scored = true;
        const dist = Math.hypot(b.shot.from[0] - hp.x, b.shot.from[1] - hp.z);
        events.push({ type: 'score', ball: b.id, hoop: hp.id, by: b.shot.by, shot: b.shot.id, points: dist > 6.75 ? 3 : 2, distance: +dist.toFixed(1) });
      }
    }
  }
  // Sleep when resting; respawn if the ball leaves the campus or idles far from the court.
  const speed = Math.hypot(b.vx, b.vy, b.vz), grounded = b.y <= floorAt(b.x, b.z) + BALL_R + .002;
  b.rest = grounded && speed < .08 ? b.rest + dt : 0;
  if (b.rest > .5) { b.vx = b.vy = b.vz = 0; }
  const outside = b.x < COURT.x0 - 3 || b.x > COURT.x1 + 3 || b.z < COURT.z0 - 3 || b.z > COURT.z1 + 3;
  b.idle = outside ? b.idle + dt : 0;
  if (b.idle > 20 || b.y < -5 || Math.abs(b.x) > 75 || Math.abs(b.z) > 70) { resetBall(b); events.push({ type: 'respawn', ball: b.id }); }
  return events;
}

/** The hoop a player at (x, z) facing `yaw` is aiming at, if any (within range and a ±28° cone). */
export function targetHoop(x, z, yaw) {
  let best = null, bestScore = Infinity;
  for (const hp of HOOPS) {
    const dx = hp.x - x, dz = hp.z - z, d = Math.hypot(dx, dz);
    if (d > 13 || d < .8) continue;
    let off = Math.atan2(dx, dz) - yaw; off = Math.atan2(Math.sin(off), Math.cos(off));
    if (Math.abs(off) < .49 && Math.abs(off) + d * .02 < bestScore) { best = hp; bestScore = Math.abs(off) + d * .02; }
  }
  return best;
}

export const RELEASE_HEIGHT = 2.35, LAUNCH_ANGLE = 55 * Math.PI / 180;
/**
 * Launch state for a shot. `charge` (0..1) scales speed around the ideal value for the target, so a
 * well-timed release swishes and a poor one falls short or clanks long. Direction comes from the
 * player's facing, gently assisted towards the targeted hoop.
 */
export function planShot(x, z, yaw, charge) {
  const hp = targetHoop(x, z, yaw);
  const sx = x + Math.sin(yaw) * .35, sz = z + Math.cos(yaw) * .35, sy = RELEASE_HEIGHT;
  let dirYaw = yaw, speed, angle = LAUNCH_ANGLE;
  if (hp) {
    // Aim a few centimetres past the rim centre, the way shooters do, for a cleaner entry angle.
    const toX = hp.x - sx, toZ = hp.z - sz, toL = Math.hypot(toX, toZ) || 1;
    const dx = toX + toX / toL * .07, dz = toZ + toZ / toL * .07, d = Math.hypot(dx, dz), dh = hp.rimY + .02 - sy;
    const aim = Math.atan2(dx, dz); let off = aim - yaw; off = Math.atan2(Math.sin(off), Math.cos(off));
    dirYaw = yaw + off * .85; // assist: most, not all, of the aiming error is corrected
    // Close shots need a steeper arc to drop through the ring rather than clip the front rim.
    angle = LAUNCH_ANGLE + Math.max(0, 3.2 - d) * .12;
    const c = Math.cos(angle), ideal = Math.sqrt(GRAVITY * d * d / (2 * c * c * Math.max(.05, d * Math.tan(angle) - dh)));
    // +1.6% offsets air drag; ±10% across the meter means the sweet spot is skill, not luck.
    speed = ideal * (1.016 + .2 * (Math.max(0, Math.min(1, charge)) - .5));
  } else speed = 4 + 6 * Math.max(0, Math.min(1, charge));
  const h = Math.cos(angle) * speed;
  return { x: sx, y: sy, z: sz, vx: Math.sin(dirYaw) * h, vy: Math.sin(angle) * speed, vz: Math.cos(dirYaw) * h, hoop: hp?.id ?? null };
}
/** Charge value that produces the ideal shot (centre of the meter's sweet spot). */
export const IDEAL_CHARGE = .5;
