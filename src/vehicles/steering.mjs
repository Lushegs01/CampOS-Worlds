// How the driver's steering keys and touch buttons reach the wheels (Settings → Steering sensitivity).
// The room's vehicle physics is unchanged and shared by every player; this only shapes the steering input
// this player sends. At sensitivity 1 the input is applied directly, as before. Lower values turn the wheel
// in gradually (a tap gives a small correction, holding gives full lock) and give less steering at speed,
// while full lock stays available when moving slowly, for parking and tight corners.
export const STEERING = Object.freeze({ min: .2, max: 1, default: .6 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const steeringSensitivity = s => clamp(Number.isFinite(s) ? s : STEERING.default, STEERING.min, STEERING.max);

/** Seconds from straight ahead to full lock (0 at sensitivity 1). Centring is twice as quick. */
export const lockSeconds = s => 1.2 * (1 - steeringSensitivity(s));

/** Moves the wheel position towards the driver's target (-1..1) for one frame of `dt` seconds. */
export function steerToward(wheel, target, sensitivity, dt) {
 target = clamp(Number.isFinite(target) ? target : 0, -1, 1);
 const lock = lockSeconds(sensitivity);
 if (lock <= 0 || !(dt > 0)) return lock <= 0 ? target : wheel;
 const centring = Math.abs(target) < Math.abs(wheel) || target * wheel < 0;
 const step = (centring ? 2 : 1) * dt / lock;
 return Math.abs(target - wheel) <= step ? target : wheel + Math.sign(target - wheel) * step;
}

/** Share of the wheel position applied at this speed: 1 when slow, down to the sensitivity from 12 m/s. */
export const steerAuthority = (sensitivity, speed) => 1 - (1 - steeringSensitivity(sensitivity)) * Math.min(1, Math.abs(Number.isFinite(speed) ? speed : 0) / 12);
