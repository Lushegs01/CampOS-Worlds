// City presentation follows the shared collision map. No decorative wall closes a playable opening.
// (Sky, sun, image-based light, fog and exposure for the five weather/time variants: ./city/atmosphere.ts.)
import * as THREE from 'three';
import { metropolis } from '../../../shared/arena/metropolis.mjs';
import { ATMOSPHERE, atmosphereOf } from './city/atmosphere';
import { Builder } from './environment';
import { DECOR_PROPS, CITY_PROPS, type Library, type PropKey } from './library';
import { buildCity } from './city';
import type { CityMap } from './city/kit';
import { type ArenaQuality } from './world';
import { cityDetail } from './cityDetail';

type City = ReturnType<typeof metropolis>;
/** The variants' sun, sky and fog, as colours (the full model, used by the renderer, is ATMOSPHERE). */
const hex = (v: [number, number, number]) => '#' + new THREE.Color(...v).getHexString();
export const CITY_LIGHT = Object.fromEntries(Object.entries(ATMOSPHERE).map(([k, a]) => [k, { sky: hex(a.horizon), fog: hex(a.fog), sun: hex(a.sunColor), strength: a.sun, fill: a.fill, env: a.env, dir: a.sunDir }])) as Record<'storm' | 'day' | 'overcast' | 'sunset' | 'night', { sky: string; fog: string; sun: string; strength: number; fill: number; env: number; dir: [number, number, number] }>;
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
  cityDetail(lib, wear, map.boxes, atmosphereOf(variant).wet > 0, !!q.detail, { walls: false });
  for (const mesh of wear.meshes(false)) { mesh.receiveShadow = true; mesh.renderOrder = 1; city.group.add(mesh); }
  return { ...city, decor: (keys: PropKey[]) => city.decor(keys) };
}
