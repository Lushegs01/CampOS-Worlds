import { LOCATIONS } from '../../shared/campus.mjs';
import { DISTRICTS } from '../../shared/expansion.mjs';

/** The open-world district around a point (its buildings, car park and stop), if any. */
export const districtAt = (x: number, z: number) => DISTRICTS.find(d => x > d.x - 40 && x < d.x + 200 && z > d.z - 80 && z < d.z + 45);

/** A short, human place name for a position: the nearest named place within reach, else the district. */
export function placeName(x: number, z: number): string {
  let best: { name: string; d: number } | null = null;
  for (const l of LOCATIONS) { const d = Math.hypot(l.x - x, l.z - z); if (d < 26 && (!best || d < best.d)) best = { name: l.name, d }; }
  if (best) return best.name;
  const district = districtAt(x, z);
  if (district) return district.name;
  return Math.abs(x) < 70 && Math.abs(z) < 65 ? 'The Courtyard' : 'On the road';
}

/** A free-standing destination ("pt:x:z:name"), used for challenge checkpoints. */
export function parsePoint(destination: string | null) {
  if (!destination?.startsWith('pt:')) return null;
  const [, x, z, ...name] = destination.split(':');
  return Number.isFinite(+x) && Number.isFinite(+z) ? { x: +x, z: +z, name: name.join(':') } : null;
}

/** Compass direction and distance from (fx, fz) to (tx, tz), for "120 m north-east". */
export function bearing(fx: number, fz: number, tx: number, tz: number) {
  const dx = tx - fx, dz = tz - fz, d = Math.hypot(dx, dz);
  // +x is east, +z is south.
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const angle = (Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2);
  return { distance: d, direction: dirs[Math.round(angle / (Math.PI / 4)) % 8] };
}
export const distanceLabel = (m: number) => (m < 8 ? 'right here' : m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`);
