import { overlaps, raycast } from '../../shared/arena/physics.mjs';
import { eyeOf } from '../../shared/arena/sim.mjs';

const hit = { t: 0, box: null, normal: [0, 0, 0] };
/** Smooth the camera only within a short, unobstructed segment. Physics always stays authoritative. */
export function constrainCorrection(world, sim, offset) {
  const distance = Math.hypot(offset.x, offset.y, offset.z), eye = eyeOf(sim);
  if (!Number.isFinite(distance) || distance > .75 || distance > 1e-6 && (
    overlaps(world, sim.x + offset.x, eye + offset.y - .1, sim.z + offset.z, .12, .2) ||
    raycast(world, sim.x, eye, sim.z, offset.x / distance, offset.y / distance, offset.z / distance, distance + .1, null, hit)
  )) offset.x = offset.y = offset.z = 0;
  return offset;
}
