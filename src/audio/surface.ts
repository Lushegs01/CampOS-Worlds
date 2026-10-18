import { inDormRoom } from '../../shared/dorm.mjs';
import { BUILDINGS, DRIVEWAYS, EXPANSION_PATHS, PARKING } from '../../shared/expansion.mjs';
import { FOOTPRINTS, PITCH, inRect, isLawn, onPath } from '../world/layout';
import { CARRIAGEWAY, courtyardLot, roadsideHeight } from '../world/roads';

/** What a footstep lands on: paving, asphalt and indoor floors are hard; lawns and meadow grass; timber floors. */
export type Surface = 'hard' | 'grass' | 'wood';

const centred = (r: { x: number; z: number; w: number; d: number }, x: number, z: number, pad = 0) => Math.abs(x - r.x) < r.w / 2 + pad && Math.abs(z - r.z) < r.d / 2 + pad;
const inCourtyard = (x: number, z: number) => Math.abs(x) < 69.6 && z > -64.6 && z < 50.2;
const OPEN_WORLD_HARD = [...EXPANSION_PATHS, ...PARKING, ...DRIVEWAYS];

export function surfaceAt(x: number, z: number): Surface {
  if (inDormRoom(x, z)) return 'wood';
  // Inside the campus walls everything that is not lawn or the pitch is paved or a floor.
  if (inCourtyard(x, z)) return isLawn(x, z) || inRect(x, z, PITCH) ? 'grass' : 'hard';
  if (onPath(x, z) || inRect(x, z, courtyardLot) || roadsideHeight(x, z) > 0 || CARRIAGEWAY.some(r => inRect(x, z, r))) return 'hard';
  if (OPEN_WORLD_HARD.some(r => centred(r, x, z)) || BUILDINGS.some(b => centred(b, x, z, .5))) return 'hard';
  return 'grass';
}

/** Under a roof: inside a campus building, a district building or your room (the outdoors is muffled there). */
export const indoors = (x: number, z: number) => inDormRoom(x, z) || FOOTPRINTS.some(f => inRect(x, z, f)) || BUILDINGS.some(b => centred(b, x, z));
