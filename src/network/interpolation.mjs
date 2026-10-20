// Remote players arrive as 15 Hz snapshots. Drawing them a little in the past and interpolating
// between the two snapshots around that moment gives steady, constant-speed motion; easing towards the
// newest snapshot (the previous approach) lagged and made their speed pulse with every update.
// Free of React and three.js so it is unit-tested (tests/interpolation.test.mjs).

/** How far in the past remote players are drawn (ms): 1.5 snapshot intervals plus jitter margin. */
export const INTERP_DELAY = 110;
const EXTRAPOLATE = 250, TELEPORT = 5;

/**
 * Converts the room's clock to ours. The smallest observed (local − room) difference is the best
 * estimate of the offset (it has the least network delay in it); it drifts slowly upwards so a changed
 * route or clock adjustment is followed.
 */
export function createClock() {
  let offset = null;
  return {
    reset() { offset = null; },
    /** Record a message stamped `roomMs` that arrived at `localMs`; returns its time on our clock. */
    receive(roomMs, localMs) {
      const d = localMs - roomMs;
      offset = offset == null || d < offset ? d : offset + (d - offset) * .02;
      return roomMs + offset;
    },
  };
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
/** A short history of one remote player's positions, sampled at any moment. */
export function createTrack(size = 8) {
  const samples = [];
  return {
    get length() { return samples.length; },
    push(t, x, y, z, yaw) {
      const last = samples[samples.length - 1];
      if (last && t <= last.t) return; // late or duplicated
      // A teleport (meeting up, a reconnect) jumps instead of sliding across the campus.
      if (last && Math.hypot(x - last.x, z - last.z) > TELEPORT) samples.length = 0;
      samples.push({ t, x, y, z, yaw });
      if (samples.length > size) samples.shift();
    },
    /** Position at time `t` (our clock) into `out`: interpolated, briefly extrapolated, or held. */
    sample(t, out) {
      const n = samples.length;
      if (!n) return false;
      let a = samples[0], b = a;
      if (t <= a.t || n === 1) { Object.assign(out, { x: a.x, y: a.y, z: a.z, yaw: a.yaw }); return true; }
      for (let i = 1; i < n; i++) { b = samples[i]; if (b.t >= t) { a = samples[i - 1]; break; } a = b; }
      if (t > b.t) {
        // Past the newest snapshot (a late packet): continue at the last velocity for a moment, then hold.
        const p = samples[n - 2], q = samples[n - 1], span = q.t - p.t || 1, k = Math.min(t - q.t, EXTRAPOLATE) / span;
        out.x = q.x + (q.x - p.x) * k; out.y = Math.max(0, q.y + (q.y - p.y) * k); out.z = q.z + (q.z - p.z) * k; out.yaw = q.yaw;
        return true;
      }
      const k = (t - a.t) / (b.t - a.t || 1);
      out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k; out.yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
      return true;
    },
  };
}
