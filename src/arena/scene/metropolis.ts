// City presentation follows the shared collision map. No decorative wall closes a playable opening.
// (Lighting presets for the four weather/time variants are used by the scene's sun, sky and fog.)
import { metropolis } from '../../../shared/arena/metropolis.mjs';
import { Builder } from './environment';
import { DECOR_PROPS, CITY_PROPS, type Library, type PropKey } from './library';
import { buildCity } from './city';
import type { CityMap } from './city/kit';
import { type ArenaQuality } from './world';
import { cityDetail } from './cityDetail';

type City = ReturnType<typeof metropolis>;
export const CITY_LIGHT = {
  day: { sky: '#b7ccda', fog: '#d8d4c6', sun: '#ffe9c4', strength: 3.2, fill: 1.65, env: 1.35, dir: [.5543, .7418, .3775] },
  overcast: { sky: '#899ba8', fog: '#9faeb5', sun: '#d7e4ef', strength: 1, fill: 1.5, env: .8, dir: [.5543, .7418, .3775] },
  sunset: { sky: '#d7a58c', fog: '#d9b6a1', sun: '#ffb568', strength: 2.7, fill: .9, env: .8, dir: [-.85, .32, .3] },
  night: { sky: '#172b46', fog: '#253a50', sun: '#9fbce5', strength: .65, fill: .8, env: .5, dir: [.5543, .7418, .3775] },
};
export type CityVariant = keyof typeof CITY_LIGHT;

/** Everything the city dresses itself with once the match is on screen (streamed; geometry stands in until then). */
export const CITY_DECOR: PropKey[] = [...DECOR_PROPS, ...CITY_PROPS];

/**
 * Operation: Metropolis. The city itself is built by `./city` (facades with real window reveals, interiors lit by the
 * kind of place they are, the station, street furniture, vehicles, the port and the skyline, the train, glass, rain),
 * merged per material and per region so a frame draws only what the camera can be in. Street wear (dirt, cracks,
 * contact shading, kerb drains, puddles in the rain) is layered on by `cityDetail`.
 */
export function buildMetropolis(lib: Library, map: City, q: ArenaQuality, variant: CityVariant) {
  const city = buildCity(lib, map as unknown as CityMap, q, variant);
  const wear = new Builder(lib);
  cityDetail(lib, wear, map.boxes, variant === 'overcast', !!q.detail, { walls: false });
  for (const mesh of wear.meshes(false)) { mesh.receiveShadow = true; mesh.renderOrder = 1; city.group.add(mesh); }
  return { ...city, decor: (keys: PropKey[]) => city.decor(keys) };
}
