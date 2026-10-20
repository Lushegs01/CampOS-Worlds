// Camera language for the trailer: splines, easing, operator shake and framing helpers. Pure maths on
// three.js vectors; every value is a function of shot time, so a frame renders the same way every time.
import * as THREE from 'three';

export type V3 = readonly [number, number, number];
export interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll?: number }

export const vec = (p: V3 | THREE.Vector3) => p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0..1 progress of `t` through [t0, t1]. */
export const seg = (t: number, t0: number, t1: number) => clamp01((t - t0) / (t1 - t0));

export const ease = {
  linear: (x: number) => x,
  in: (x: number) => x * x * x,
  out: (x: number) => 1 - Math.pow(1 - x, 3),
  inOut: (x: number) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  sine: (x: number) => -(Math.cos(Math.PI * x) - 1) / 2,
  outExpo: (x: number) => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x),
  inExpo: (x: number) => x <= 0 ? 0 : Math.pow(2, 10 * x - 10),
  smoother: (x: number) => x * x * x * (x * (x * 6 - 15) + 10),
  /** Starts at speed `v0` (in units of the average speed) and settles gently: a camera already moving. */
  carried: (v0: number) => (x: number) => v0 * x + (3 - 2 * v0) * x * x + (v0 - 2) * x * x * x,
};

/** A value keyframed in time, eased between keys: keyed(t, [[0, 50], [1.5, 72], [3, 60]]). */
export function keyed(t: number, keys: [number, number][], curve = ease.sine) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, a] = keys[i - 1], [t1, b] = keys[i]; return mix(a, b, curve((t - t0) / (t1 - t0))); }
  return keys[keys.length - 1][1];
}

/**
 * Speed ramp: progress 0..1 along a path whose speed follows the keyed profile (relative speeds), so a
 * camera can creep, rush and settle on one continuous move.
 */
export function travel(t: number, speeds: [number, number][]) {
  const t0 = speeds[0][0], t1 = speeds[speeds.length - 1][0], n = 400, h = (t1 - t0) / n;
  let total = 0, done = 0;
  for (let i = 0; i < n; i++) { const a = t0 + (i + .5) * h, v = keyed(a, speeds, ease.linear) * h; total += v; if (a < t) done += a + h / 2 <= t ? v : v * (t - (a - h / 2)) / h; }
  return clamp01(done / total);
}

/** A smooth path through keyframe positions, travelled at constant speed along its length. */
export function path(points: V3[], closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => vec(p)), closed, 'centripetal');
  return (u: number) => curve.getPointAt(clamp01(u));
}

/** A point on a circle around `centre` (angle in radians, measured from +z towards +x, like the game's yaw). */
export function orbit(centre: V3 | THREE.Vector3, radius: number, angle: number, height: number) {
  const c = vec(centre);
  return new THREE.Vector3(c.x + Math.sin(angle) * radius, height, c.z + Math.cos(angle) * radius);
}

/** Hand-held operator motion: a few incommensurate sines, so it never visibly loops. */
export function shake(t: number, amplitude: number, rate = 1, seed = 0) {
  const n = (k: number) => Math.sin(t * rate * (1.31 + k * .37) + seed * 3.7 + k) * .55 + Math.sin(t * rate * (2.93 + k * .61) + seed * 1.3 + k * 2.1) * .3 + Math.sin(t * rate * (5.17 + k * .23) + seed + k * 4.4) * .15;
  return new THREE.Vector3(n(0), n(1) * .7, n(2)).multiplyScalar(amplitude);
}

/** An impact: a quick decaying jolt starting at `t0`. */
export function jolt(t: number, t0: number, amplitude: number, decay = 9) {
  if (t < t0) return new THREE.Vector3();
  const k = t - t0, e = Math.exp(-k * decay) * amplitude;
  return new THREE.Vector3(Math.sin(k * 47) * e, Math.sin(k * 61 + 1) * e * .8, Math.sin(k * 53 + 2) * e * .5);
}

/**
 * Vertical field of view for this frame. Shots are composed for 9:16; the 16:9 cut keeps roughly the same
 * subject size by matching the vertical coverage of a slightly tighter frame (`landscape` overrides it).
 */
export function fovFor(aspect: number, portrait: number, landscape?: number) {
  if (aspect < 1) return portrait;
  if (landscape) return landscape;
  const t = Math.tan(THREE.MathUtils.degToRad(portrait) / 2) * .62;
  return THREE.MathUtils.radToDeg(2 * Math.atan(t));
}

/** Critically damped follow, frame-rate independent. */
export class Follow {
  value = new THREE.Vector3(); velocity = new THREE.Vector3(); started = false;
  constructor(public stiffness = 6) {}
  reset(p: THREE.Vector3) { this.value.copy(p); this.velocity.set(0, 0, 0); this.started = true; return this.value; }
  update(target: THREE.Vector3, dt: number) {
    if (!this.started) return this.reset(target);
    const w = this.stiffness, x = this.value.clone().sub(target), exp = Math.exp(-w * dt);
    const tmp = this.velocity.clone().add(x.clone().multiplyScalar(w)).multiplyScalar(dt);
    this.velocity.sub(tmp.clone().multiplyScalar(w)).multiplyScalar(exp);
    this.value.copy(target).add(x.add(tmp).multiplyScalar(exp));
    return this.value;
  }
}
