import { VEHICLE_TYPES } from '../../shared/vehicles.mjs';

/** Continues `v` along its current arc for `dt` seconds, writing the pose into `out` (no allocation). */
function arc(v, dt, out) {
  const turn = v.speed / VEHICLE_TYPES[v.type].wheelbase * Math.tan(v.steering), yaw = v.yaw + turn * dt;
  let x = v.x, z = v.z;
  if (Math.abs(turn) < 1e-6) { x += Math.sin(v.yaw) * v.speed * dt; z += Math.cos(v.yaw) * v.speed * dt; }
  else { x += v.speed / turn * (Math.cos(v.yaw) - Math.cos(yaw)); z += v.speed / turn * (Math.sin(yaw) - Math.sin(v.yaw)); }
  out.x = x; out.z = z; out.yaw = yaw; out.speed = v.speed; out.steering = v.steering; out.wheel = v.wheel + v.speed * dt / .32;
  return out;
}

/** Extrapolate from each vehicle's own immutable snapshot, for at most 250 ms. */
export function createVehicleMotion() {
  const samples = new Map();
  return {
    receive(v, at) { samples.set(v.id, { ...v, at }); },
    sample(id, now, out) {
      const v = samples.get(id); if (!v) return false;
      Object.assign(out, v); arc(v, Math.max(0, Math.min(.25, (now - v.at) / 1000)), out);
      return true;
    },
  };
}

import { INTERP_DELAY } from './interpolation.mjs';

/** How far in the past other vehicles are drawn (ms): the same playback point as remote players. */
export const VEHICLE_DELAY = INTERP_DELAY;
const TELEPORT = 8, GAP = 150, STEP = 66, FIELDS = ['x', 'z', 'yaw', 'speed', 'steering', 'wheel'], LINEAR = ['x', 'z', 'speed', 'steering', 'wheel'];
const SLEW = .05;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * Timestamped snapshots of one vehicle (room time), drawn VEHICLE_DELAY in the past and
 * interpolated between the two around that moment. Extrapolating from each snapshot's arrival time made a
 * car's speed pulse with network jitter; past the newest snapshot the arc continues briefly, then holds.
 */
export function createVehicleTrack(size = 8) {
  const samples = [];
  // How far this vehicle's state time trails the room's clock (a driver's car is only as far along as their
  // commands have reached): a near-maximum that rises at once and relaxes slowly. Playback follows it at no
  // more than SLEW of real time, so a late batch of commands shows as a slight easing of speed, not a jolt.
  let lag = 0, shown = null, previous = null;
  return {
    get length() { return samples.length; },
    get lag() { return lag; },
    /** `t`: the room time the state represents; `at`: the room time the snapshot was sent (defaults to t). */
    push(t, v, at = t) {
      const behind = Math.max(0, at - t); lag = behind > lag ? behind : lag + (behind - lag) * .01;
      const last = samples[samples.length - 1];
      if (last && t <= last.t) return; // late or duplicated
      if (last && Math.hypot(v.x - last.x, v.z - last.z) > TELEPORT) samples.length = 0; // recovered home
      // Only vehicles that change are sent: one that sat still was there until just before it moved.
      else if (last && t - last.t > GAP) samples.push({ ...last, t: t - STEP });
      const s = { t, type: v.type, id: v.id };
      for (const k of FIELDS) s[k] = v[k];
      samples.push(s); while (samples.length > size) samples.shift();
    },
    /** Pose at room time `t` (less this vehicle's lag) into `out`: interpolated, briefly extrapolated, or held. */
    sample(t, out) {
      const step = previous === null ? Infinity : Math.max(0, Math.min(100, t - previous)) * SLEW; previous = t;
      shown = shown === null || Math.abs(lag - shown) > 250 ? lag : shown + Math.max(-step, Math.min(step, lag - shown));
      const n = samples.length; t -= shown;
      if (!n) return false;
      const first = samples[0], newest = samples[n - 1];
      if (t <= first.t) { for (const k of FIELDS) out[k] = first[k]; return true; }
      if (t >= newest.t) { arc(newest, Math.min(.25, (t - newest.t) / 1000), out); return true; }
      let i = 1; while (samples[i].t < t) i++;
      const a = samples[i - 1], b = samples[i], k = (t - a.t) / (b.t - a.t || 1);
      for (const f of LINEAR) out[f] = a[f] + (b[f] - a[f]) * k;
      out.yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
      return true;
    },
  };
}
