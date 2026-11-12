// Operation: Metropolis materials. Every surface is a PBR set from the arena pack (albedo, normal, AO/roughness/
// metal) mapped in world space, or a hand-built physical material (glass, paint, emissive fittings). Surfaces under
// a roof or under the street get their own instances: the sky's light is cut down to what would reach them and an
// interior fill (the room's own lighting) is added, so shops glow warm, the station is cool white and nothing
// underground is lit by a sky it cannot see.
import * as THREE from 'three';
import { surface, trackSurfaceMaterial, type Library, type SurfaceKey } from '../library';

export type Where = 'out' | 'shop' | 'hall' | 'ug';
/** How much sky light reaches a place, and the colour and strength of its own lighting. */
export const PLACES: Record<Exclude<Where, 'out'>, { sky: number; fill: THREE.Color }> = {
  shop: { sky: .3, fill: new THREE.Color('#ffe2bd').multiplyScalar(2.3) },
  hall: { sky: .4, fill: new THREE.Color('#e8eef4').multiplyScalar(1.5) },
  ug: { sky: .03, fill: new THREE.Color('#dfeaf2').multiplyScalar(2.2) },
};
/** Shared by every interior material: the fill strength of each kind of place (lowered by a power failure). */
export const interiorUniforms = { uFillScale: { value: 1 } };

const interiorCache = new Map<string, THREE.Material>();
/** The same material as seen in a place of kind `where`. */
export function inside<T extends THREE.Material>(m: T, where: Where): T {
  if (where === 'out' || !(m as unknown as THREE.MeshStandardMaterial).isMeshStandardMaterial || m.userData.fixed) return m;
  const id = m.uuid + where; const hit = interiorCache.get(id); if (hit) return hit as T;
  const c = m.clone() as unknown as THREE.MeshStandardMaterial, place = PLACES[where];
  c.name = `${m.name}@${where}`; c.userData = { ...m.userData, where };
  c.envMapIntensity = (m as unknown as THREE.MeshStandardMaterial).envMapIntensity * (where === 'ug' ? .25 : .6);
  const uniforms = { uSkyShare: { value: place.sky }, uFill: { value: place.fill }, ...interiorUniforms };
  c.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = 'uniform float uSkyShare, uFillScale; uniform vec3 uFill;\n' + shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= uSkyShare; reflectedLight.indirectSpecular *= uSkyShare;
reflectedLight.indirectDiffuse += uFill * uFillScale * BRDF_Lambert( material.diffuseColor );`);
  };
  c.customProgramCacheKey = () => 'city-interior';
  const key = m.userData.surface as SurfaceKey | undefined; if (key) trackSurfaceMaterial(key, c, !!m.userData.metal);
  interiorCache.set(id, c);
  return c as unknown as T;
}
export function clearCityMaterials() { interiorCache.forEach(m => m.dispose()); interiorCache.clear(); }

/** Materials whose glow follows the lighting variant (lamps, signs, lit windows): [material, strength in daylight, strength at night]. */
export type Glow = { m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; day: number; night: number };

export function cityMaterials(lib: Library) {
  const glows: Glow[] = [];
  const S = (key: SurfaceKey, o: Parameters<typeof surface>[2] = {}) => { const m = surface(lib, key, o); m.userData.surface = key; m.userData.metal = o.metal !== undefined; return m; };
  /** Paint over worn concrete: smooth, slightly stained, chipped. */
  const painted = (tint: string, gain = 1, rough = .6) => S('concreteFloor', { tint, gain, rough, normalScale: .45 });
  const flat = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: 0, ...o });
  const glow = (color: string, day: number, night: number, base = '#111111') => { const m = new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: day, roughness: .5 }); m.userData.fixed = true; glows.push({ m, day, night }); return m; };
  const glass = (color: string, opacity: number, o: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .06, metalness: 0, transparent: true, opacity, depthWrite: false, envMapIntensity: 2.2, ...o }); m.userData.fixed = true; return m; };
  const grass = new THREE.MeshStandardMaterial({ map: lib.extra['textures/grass/color.ktx2'], roughness: 1, metalness: 0, color: '#c9d8b4' });
  if (grass.map) grass.map.colorSpace = THREE.SRGBColorSpace;
  const hedge = new THREE.MeshStandardMaterial({ map: lib.extra['textures/grass/color.ktx2'], roughness: 1, color: '#5d7f4a' });
  const m = {
    // ---- ground
    asphalt: S('cityAsphalt', { gain: .92 }), sidewalk: S('sidewalk', { gain: 1.08 }), pavers: S('pavers', { tint: '#e2cdb6', gain: 1.1 }), plaza: S('plazaStone', { tint: '#f1e9dc', gain: 1.75 }),
    yard: S('concreteFloor'), tile: S('floorTile', { gain: 1.1, rough: .75 }), marble: S('marble', { gain: 1.1, rough: .5 }), screed: S('concreteFloor', { tint: '#c9ccd0', rough: .8, normalScale: .6 }),
    kerb: S('concreteWall', { tint: '#d9d5cc', gain: 1.1 }), grass, hedge, soil: S('gravel', { tint: '#6b5a48' }),
    // ---- station
    ugTile: S('plazaStone', { tint: '#e3ddd2', gain: 1.7, rough: .55 }), ugWall: S('subwayTile', { gain: 1.1, rough: .55 }), ugConcrete: S('concreteWall', { tint: '#d0d2d4' }), ugCeil: S('plaster', { tint: '#eef0f2', gain: 1.45, normalScale: .5 }),
    ballast: S('gravel', { tint: '#6f6a64', gain: .8 }), rail: flat('#8f9498', { metalness: .9, roughness: .32 }), tactile: painted('#e2b322', 1.3, .7),
    // ---- buildings
    render: [S('plaster', { tint: '#efe0c4', gain: 1.15 }), S('plaster', { tint: '#d9b98a', gain: 1.1 }), S('plaster', { tint: '#e9e6dc', gain: 1.15 }), S('plaster', { tint: '#c9d6d2', gain: 1.1 }), S('plaster', { tint: '#e6c9b0', gain: 1.1 })],
    brick: S('brick', { gain: 1.6 }), panel: S('facadePanel', { tint: '#f0e6d6', gain: 2.5 }), cladding: S('cladding', { gain: 1.1 }), stone: S('plazaStone', { tint: '#ecdcc0', gain: 1.9 }), block: S('concreteWall', { tint: '#d8cfbf', gain: 1.2 }), blockwork: S('blockWall', { tint: '#f1e6d4', gain: 1.6 }),
    sheetBlue: S('corrugated', { tint: '#5b86a8', gain: 1.5 }), sheetCream: S('corrugated', { tint: '#d9d2bd', gain: 1.5 }), sheetGreen: S('corrugated', { tint: '#4f8a6c', gain: 1.4 }), sheetRoof: S('corrugated', { tint: '#a9adb0', gain: 1.3 }),
    concrete: S('concreteWall'), precast: S('concreteWall', { tint: '#e6e0d4', gain: 1.15 }), plaster: S('plaster', { tint: '#f1ece2', gain: 1.2 }), ceiling: S('ceiling', { gain: 1.2 }), shutter: S('shutter', { gain: 1.1 }),
    woodFloor: S('woodFloor', { gain: 1.1, rough: .7 }), planks: S('planks'), wood: S('woodFloor', { tint: '#b98d5e', rough: .6 }), darkWood: S('woodFloor', { tint: '#6b4a32', rough: .55 }),
    roofGravel: S('gravel', { tint: '#b9b4a8' }),
    // ---- metal and paint
    steel: painted('#8e949b', 1.1), darkSteel: painted('#3f4449', 1), white: painted('#eceae4', 1.2), yellow: painted('#e3ab22', 1.5), red: painted('#b5402f', 1.2), blue: painted('#2f6f9f', 1.2), green: painted('#3f8a5c', 1.2), orange: painted('#d9772b', 1.3), black: painted('#1d1f22', 1, .5),
    plate: S('metalPlate', { metal: .5, gain: 1.3 }), stainless: flat('#c9ced2', { metalness: 1, roughness: .22 }), bronze: flat('#a8793f', { metalness: 1, roughness: .32 }), frame: flat('#2c3136', { metalness: .7, roughness: .4 }),
    tank: flat('#16181a', { roughness: .45 }), rubber: flat('#17181a', { roughness: .92 }), plastic: flat('#d8d4c8', { roughness: .5 }),
    container: (key: string) => key === 'container-red' ? S('paintedMetal', { gain: 1.25 }) : S('corrugated', { tint: ({ 'container-blue': '#44709a', 'container-yellow': '#c9a03a', 'container-green': '#5a9068' } as Record<string, string>)[key] ?? '#8a7a62', gain: 1.9 }),
    containerFrame: (key: string) => painted(({ 'container-red': '#86392e', 'container-blue': '#36597b', 'container-yellow': '#a0802e', 'container-green': '#3f644a' } as Record<string, string>)[key] ?? '#6e624e', 1.3),
    // ---- glass, water, light
    glass: glass('#9fc3cf', .28), glassDark: new THREE.MeshStandardMaterial({ color: '#1c2a33', roughness: .08, metalness: .85, envMapIntensity: 1.9 }),
    curtain: new THREE.MeshStandardMaterial({ color: '#27485a', roughness: .1, metalness: .9, envMapIntensity: 2 }), curtainGreen: new THREE.MeshStandardMaterial({ color: '#2b5550', roughness: .1, metalness: .9, envMapIntensity: 2 }),
    water: new THREE.MeshStandardMaterial({ color: '#2f5a66', roughness: .05, metalness: .2, transparent: true, opacity: .82, envMapIntensity: 2 }),
    paintWhite: flat('#e9e6dc', { roughness: .7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), paintYellow: flat('#e0b21c', { roughness: .7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    room: glow('#ffd9a0', 0, .9, '#191713'), lamp: glow('#fff3dc', 1.2, 5), lampCool: glow('#eaf4ff', 2.4, 3.2), lampWarm: glow('#ffd9a8', 1.6, 3.2), beacon: glow('#ff3b2f', 2, 6),
    signalRed: glow('#ff2a1c', 3, 5), signalAmber: glow('#ffb01c', 3, 5), signalGreen: glow('#2bff7a', 3, 5), headlamp: glow('#fff6e0', .3, 4), taillamp: glow('#ff2218', .4, 2.5),
    led: glow('#ffb347', 2.2, 3.4),
    bodies: ['#f4f4f0', '#1d2a3a', '#8c2f2a', '#c9c9c4', '#2b2d30', '#e8c21c', '#2f6f9f'].map(c => flat(c, { roughness: .32, metalness: .35, envMapIntensity: 1.4 })),
  };
  for (const k of ['glassDark', 'curtain', 'curtainGreen', 'water'] as const) m[k].userData.fixed = true;
  return { ...m, glows, flat, painted, glow };
}
export type CityMats = ReturnType<typeof cityMaterials>;
