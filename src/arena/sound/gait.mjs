// Footstep timing from movement, for the player's own character and for everyone else.
//
// The player: one gait phase drives the camera bob, the first-person weapon bob and the footsteps (src/arena/Scene.tsx),
// so a foot lands exactly when the view dips: the phase advances with ground speed (1.75 rad per metre walking,
// 1.45 sprinting — longer strides) and a footfall happens each time it crosses π/2 + nπ. Standing still the phase
// stops, so steps stop with the player; in the air nothing lands.
//
// Others: their soldiers' walk, jog and run animations play at a rate proportional to speed (scene/soldiers.ts), so a
// stride is a fixed distance per gait; a footfall happens every stride travelled, which keeps the sound in step with
// the animation whatever the network rate.
//
// Both also report the movements that make a sound without a footstep: a sudden stop and a sharp change of direction.

export const PHASE_PER_METRE = { walk: 1.75, sprint: 1.45 };
/** Metres per footfall of a remote soldier in each gait (animation base speed × cycle length / 2 steps). */
export const STRIDE = { walk: .78, jog: 1.05, run: 1.32, crouch: .55 };

/** The gait a moving player's footsteps use: soft (crouching, or slow), walk, or run (sprinting). */
export function gaitOf(speed, { sprint = false, crouch = false } = {}) {
  if (crouch || speed < 2.4) return 'soft';
  return sprint || speed > 6.2 ? 'run' : 'walk';
}

/** The player's footstep tracker. `update` returns the events of this frame. */
export function createGait() {
  const st = { phase: 0, speed: 0, vx: 0, vz: 0, wasFast: 0, turnAt: -1, stopAt: -1, t: 0, grounded: true };
  return {
    get phase() { return st.phase; },
    /**
     * dt seconds; vx, vz ground velocity (m/s); grounded; sprint; crouch (stance 1); sliding (stance 2).
     * Returns { step: gait | null, stop: boolean, turn: boolean }.
     */
    update(dt, vx, vz, grounded, sprint, crouch, sliding) {
      st.t += dt;
      const speed = Math.hypot(vx, vz), ev = { step: null, stop: false, turn: false };
      if (grounded && !sliding && speed > .25) {
        const before = st.phase, k = sprint ? PHASE_PER_METRE.sprint : PHASE_PER_METRE.walk;
        st.phase += speed * dt * k;
        // A footfall at each π/2 + nπ crossed.
        if (Math.floor((st.phase - Math.PI / 2) / Math.PI) > Math.floor((before - Math.PI / 2) / Math.PI)) ev.step = gaitOf(speed, { sprint, crouch });
      }
      if (grounded && !sliding) {
        // A hard stop: from running pace to almost still within a fraction of a second.
        if (speed > 3.6) st.wasFast = st.t;
        if (speed < .9 && st.t - st.wasFast < .35 && st.t - st.stopAt > .6) { ev.stop = true; st.stopAt = st.t; st.wasFast = -1; }
        // A sharp turn at speed: the velocity's direction swings by more than ~100° within a quarter second.
        if (speed > 3 && st.speed > 3) {
          const dot = (vx * st.vx + vz * st.vz) / (speed * st.speed);
          if (dot < -.17 && st.t - st.turnAt > .5) { ev.turn = true; st.turnAt = st.t; }
        }
      }
      // Remember the velocity of a quarter of a second ago (smoothed), for the turn test.
      const a = Math.min(1, dt / .25); st.vx += (vx - st.vx) * a; st.vz += (vz - st.vz) * a; st.speed = Math.hypot(st.vx, st.vz);
      st.grounded = grounded;
      return ev;
    },
    reset() { st.phase = 0; st.vx = st.vz = st.speed = 0; st.wasFast = -1; },
  };
}

/** A remote player's footstep tracker: distance travelled per stride of the gait their soldier animates. */
export function createRemoteGait() {
  const st = { x: NaN, z: NaN, dist: 0, speed: 0, airT: 0, grounded: true };
  return {
    /**
     * Position now, dt, and flags (shared FLAG: crouch 2, slide 4, sprint 8, grounded 256). Returns
     * { step: gait | null, land: boolean, speed }.
     */
    update(x, z, dt, flags) {
      const ev = { step: null, land: false, speed: 0 };
      if (Number.isNaN(st.x)) { st.x = x; st.z = z; return ev; }
      const d = Math.hypot(x - st.x, z - st.z); st.x = x; st.z = z;
      if (d > 4) { st.dist = 0; return ev; } // a teleport (respawn, correction): no steps
      const v = dt > 0 ? d / dt : 0; st.speed += (Math.min(v, 9) - st.speed) * Math.min(1, dt * 8); ev.speed = st.speed;
      const grounded = (flags & 256) !== 0, crouch = (flags & 2) !== 0, slide = (flags & 4) !== 0;
      if (!grounded) { st.airT += dt; st.grounded = false; return ev; }
      if (!st.grounded && st.airT > .25) ev.land = true;
      st.grounded = true; st.airT = 0;
      if (slide || st.speed < .4) { st.dist = Math.min(st.dist, .3); return ev; }
      const gait = crouch ? 'crouch' : st.speed < 2.8 ? 'walk' : st.speed < 5.2 ? 'jog' : 'run';
      st.dist += d;
      if (st.dist >= STRIDE[gait]) { st.dist -= STRIDE[gait]; if (st.dist > STRIDE[gait]) st.dist = 0; ev.step = crouch ? 'soft' : gait === 'walk' ? (st.speed < 2 ? 'soft' : 'walk') : gait === 'jog' ? 'walk' : 'run'; }
      return ev;
    },
  };
}
