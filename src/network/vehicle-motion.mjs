import { VEHICLE_TYPES } from '../../shared/vehicles.mjs';

/** Extrapolate from each vehicle's own immutable snapshot, for at most 250 ms. */
export function createVehicleMotion() {
  const samples = new Map();
  return {
    receive(v, at) { samples.set(v.id, { ...v, at }); },
    sample(id, now, out) {
      const v = samples.get(id); if (!v) return false;
      const dt = Math.max(0, Math.min(.25, (now - v.at) / 1000));
      const turn = v.speed / VEHICLE_TYPES[v.type].wheelbase * Math.tan(v.steering);
      const yaw = v.yaw + turn * dt;
      Object.assign(out, v, { yaw, wheel: v.wheel + v.speed * dt / .32 });
      if (Math.abs(turn) < 1e-6) {
        out.x += Math.sin(v.yaw) * v.speed * dt; out.z += Math.cos(v.yaw) * v.speed * dt;
      } else {
        out.x += v.speed / turn * (Math.cos(v.yaw) - Math.cos(yaw));
        out.z += v.speed / turn * (Math.sin(yaw) - Math.sin(v.yaw));
      }
      return true;
    },
  };
}
