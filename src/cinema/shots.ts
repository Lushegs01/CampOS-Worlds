// Camera grammar for in-engine cinematics. Every shot is a function of time and of the live world (positions are
// read from the game every frame, never baked), so a shot of an officer frames where that officer really is.
import * as THREE from 'three';

export type P = { x: number; y?: number; z: number };
export type Pose = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll?: number };
export type Shot = { name: string; seconds: number; cut?: 'cut' | 'ease'; ease?: number; at: (t: number, u: number) => Pose };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const smooth = (u: number) => u * u * (3 - 2 * u);
const flat = (a: P, b: P) => { const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d, d }; };

/** Establishing / reveal: a crane from a low start to a high end (or the reverse), looking at a target. */
export function crane(name: string, seconds: number, from: () => P & { y: number }, to: () => P & { y: number }, look: () => P & { y: number }, fov = 50): Shot {
  return { name, seconds, at: (_, u) => { const a = from(), b = to(), k = smooth(u), l = look(); return { pos: V(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k), look: V(l.x, l.y, l.z), fov }; } };
}
/** Tracking: the camera holds an offset in the subject's own frame (yaw) and looks at it, easing round as it turns. */
export function track(name: string, seconds: number, subject: () => P & { yaw: number }, offset: [number, number, number], lookUp = 1.1, fov = 42, drift: [number, number, number] = [0, 0, 0]): Shot {
  return { name, seconds, at: (_, u) => {
    const s = subject(), c = Math.cos(s.yaw), n = Math.sin(s.yaw), ox = offset[0] + drift[0] * u, oy = offset[1] + drift[1] * u, oz = offset[2] + drift[2] * u;
    // Local +x is the subject's left, +z its forward.
    return { pos: V(s.x + c * ox + n * oz, (s.y ?? 0) + oy, s.z - n * ox + c * oz), look: V(s.x, (s.y ?? 0) + lookUp, s.z), fov };
  } };
}
/** Over the shoulder of `from`, framing `to`. side: 1 = right shoulder, -1 = left. */
export function overShoulder(name: string, seconds: number, from: () => P, to: () => P, side = 1, fov = 38, push = .25): Shot {
  return { name, seconds, at: (_, u) => {
    const a = from(), b = to(), f = flat(a, b), rx = -f.z * side, rz = f.x * side, back = 1.05 - push * smooth(u);
    return { pos: V(a.x - f.x * back + rx * .55, (a.y ?? 0) + 1.72, a.z - f.z * back + rz * .55), look: V(b.x, (b.y ?? 0) + 1.5, b.z), fov };
  } };
}
/** Close-up on a face, slightly off-axis from the person they are talking to. */
export function closeUp(name: string, seconds: number, who: () => P, toward: () => P, side = 1, fov = 26, dist = 1.55): Shot {
  return { name, seconds, at: (_, u) => {
    const a = who(), b = toward(), f = flat(a, b), rx = -f.z * side, rz = f.x * side, d = dist - .12 * smooth(u);
    return { pos: V(a.x + f.x * d + rx * .42, (a.y ?? 0) + 1.6, a.z + f.z * d + rz * .42), look: V(a.x, (a.y ?? 0) + 1.58, a.z), fov };
  } };
}
/** Orbit round a centre at a radius and height, sweeping `sweep` radians, framing the centre. */
export function orbit(name: string, seconds: number, centre: () => P, radius: number, height: number, start: () => number, sweep: number, lookY = 1, fov = 46): Shot {
  return { name, seconds, at: (_, u) => { const c = centre(), a = start() + sweep * smooth(u); return { pos: V(c.x + Math.sin(a) * radius, (c.y ?? 0) + height, c.z + Math.cos(a) * radius), look: V(c.x, (c.y ?? 0) + lookY, c.z), fov }; } };
}
/** A fixed low-angle or insert camera: placed relative to a subject, looking at a point, with a slow push. */
export function locked(name: string, seconds: number, pos: () => P & { y: number }, look: () => P & { y: number }, fov = 40, push = 0): Shot {
  return { name, seconds, at: (_, u) => { const p = pos(), l = look(), k = push * smooth(u), f = flat(p, l); return { pos: V(p.x + f.x * k, p.y, p.z + f.z * k), look: V(l.x, l.y, l.z), fov }; } };
}

// ---------------------------------------------------------------- keeping the lens out of walls
import { collidersIn, blocked } from '../../shared/campus.mjs';
import { rayBox } from '../../shared/arena/physics.mjs';
/** True when the camera stands in the open and nothing solid stands between it and what it looks at. */
export function viewClear(pos: THREE.Vector3, look: THREE.Vector3) {
  if (blocked(pos.x, pos.z, .35) && pos.y < 7) return false;
  const dx = look.x - pos.x, dy = look.y - pos.y, dz = look.z - pos.z, len = Math.hypot(dx, dy, dz);
  if (len < .3) return true;
  for (const b of collidersIn(Math.min(pos.x, look.x), Math.min(pos.z, look.z), Math.max(pos.x, look.x), Math.max(pos.z, look.z)))
    if (rayBox(pos.x, pos.y, pos.z, dx / len, dy / len, dz / len, b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, b.h, b.z + b.d / 2, len - .4, null) >= 0) return false;
  return true;
}
/** The first framing whose camera is clear at its start, middle and end (else the first one). */
export function pickClear(...options: Shot[]): Shot {
  for (const s of options) if ([0, .5, 1].every(u => { const p = s.at(s.seconds * u, u); return viewClear(p.pos, p.look); })) return s;
  return options[0];
}
