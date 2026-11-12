// Combat Arena asset library: the arena's own pack (public/assets/arena, built by
// scripts/assets/build-arena.mjs) plus the campus HDR sky. Loaded only when a match opens; every
// texture is Basis KTX2 and every model meshopt-compressed.
import * as THREE from 'three';
import { initLoaders, loadTexture, loadModel, loadHDR, loadImage, cached } from '../../world/assets';
import { assetUrl as assetUrlOf } from '../../world/assetUrl';
import type { FetchOptions } from '../../world/fetcher';
import type { ArenaQuality } from './world';

export type CitySurfaceKey = 'cityAsphalt' | 'sidewalk' | 'pavers' | 'plazaStone' | 'floorTile' | 'marble' | 'subwayTile' | 'facadePanel' | 'cladding' | 'blockWall' | 'shutter' | 'woodFloor' | 'ceiling';
export type SurfaceKey = 'concreteWall' | 'concreteFloor' | 'road' | 'gravel' | 'dirt' | 'brick' | 'corrugated' | 'rustyCorrugated' | 'paintedMetal' | 'metalPlate' | 'plywood' | 'planks' | 'plaster' | 'sandbag' | CitySurfaceKey;
/** The training maps' surfaces (Foundry Yard, Sim Quad). */
export const SURFACE_KEYS: SurfaceKey[] = ['concreteWall', 'concreteFloor', 'road', 'gravel', 'dirt', 'brick', 'corrugated', 'rustyCorrugated', 'paintedMetal', 'metalPlate', 'plywood', 'planks', 'plaster', 'sandbag'];
/** Operation: Metropolis: the city's own surfaces (scripts/assets/build-metropolis.mjs) plus the arena sets it reuses. */
export const CITY_SURFACE_KEYS: SurfaceKey[] = ['cityAsphalt', 'sidewalk', 'pavers', 'plazaStone', 'floorTile', 'marble', 'subwayTile', 'facadePanel', 'cladding', 'blockWall', 'shutter', 'woodFloor', 'ceiling',
  'concreteWall', 'concreteFloor', 'gravel', 'brick', 'corrugated', 'paintedMetal', 'metalPlate', 'planks', 'plaster'];
export type CityPropKey = 'streetLamp' | 'aircon' | 'trashCan' | 'parkBench' | 'manhole' | 'tubeLight' | 'shelves' | 'plasticCrate' | 'cardboard' | 'cement' | 'handTruck' | 'officeDesk' | 'planterBox' | 'cafeSet' | 'trashbag' | 'sofa' | 'camera' | 'monobloc';
export const CITY_PROPS: CityPropKey[] = ['streetLamp', 'aircon', 'trashCan', 'parkBench', 'manhole', 'tubeLight', 'shelves', 'plasticCrate', 'cardboard', 'cement', 'handTruck', 'officeDesk', 'planterBox', 'cafeSet', 'trashbag', 'sofa', 'camera', 'monobloc'];
/** What a map's art needs from the pack. */
export interface Theme { id: string; surfaces: SurfaceKey[]; decor: PropKey[]; /** Relief and roughness maps arrive after deployment. */ deferDetail: boolean; /** Campus textures the map borrows (grass, foliage). */ extra: string[] }
export const THEMES: Record<string, Theme> = {
  yard: { id: 'yard', surfaces: SURFACE_KEYS, decor: [], deferDetail: false, extra: [] },
  city: { id: 'city', surfaces: CITY_SURFACE_KEYS, decor: [], deferDetail: true, extra: ['textures/grass/color.ktx2', 'foliage/palm-frond.ktx2', 'foliage/leaf-broad.ktx2', 'foliage/leaf-hedge.ktx2'] },
};
export const themeOf = (mapId: string) => (mapId === 'metropolis' ? THEMES.city : THEMES.yard);
export type PropKey = 'jersey' | 'milCrate' | 'oldCrate' | 'ammo' | 'barrel' | 'jerrycan' | 'generator' | 'wallLamp' | 'securityLight' | 'powerBox' | 'utilityBox' | 'tyre' | 'propane' | 'crate' | CityPropKey;
export const PROP_KEYS: PropKey[] = ['jersey', 'milCrate', 'oldCrate', 'ammo', 'barrel', 'jerrycan', 'generator', 'wallLamp', 'securityLight', 'powerBox', 'utilityBox', 'tyre', 'propane', 'crate'];
/** Props that ARE cover (crates and jersey barriers fill collision boxes): needed before anyone can play. */
export const COVER_PROPS: PropKey[] = ['jersey', 'milCrate', 'oldCrate', 'crate'];
/** Set dressing (drums, cans, lamps, generators): streamed in after the match is on screen. */
export const DECOR_PROPS: PropKey[] = PROP_KEYS.filter(k => !COVER_PROPS.includes(k));
export interface SurfaceSet { color: THREE.Texture; normal: THREE.Texture; arm: THREE.Texture }
export interface Library {
  theme: Theme;
  /** Campus textures borrowed by the theme, by path (released with the match). */
  extra: Record<string, THREE.Texture>;
  surfaces: Record<SurfaceKey, SurfaceSet>;
  /** Cover props always; decorative props once loadDecor() has added them. */
  props: Partial<Record<PropKey, { scene: THREE.Group; size: THREE.Vector3 }>> & Record<'jersey' | 'milCrate' | 'oldCrate' | 'crate', { scene: THREE.Group; size: THREE.Vector3 }>;
  env: THREE.Texture; sky: THREE.Texture; hdr: THREE.Texture; skyScale: number; skyCoverage: number; horizon: THREE.Color;
  sun: { dir: THREE.Vector3; color: THREE.Color; irradiance: number };
  mobile: boolean;
}

/** Where an arena file is: phones (the Low profile) use the 512² texture tier built by scripts/assets/build-arena-mobile.mjs. */
export const arenaPath = (rel: string, mobile: boolean) => (mobile ? `arena/mobile/${rel}` : `arena/${rel}`);
/** Download policy by priority: 1 gameplay-critical, 2 nearby detail, 3 optional. */
export const P1: FetchOptions = { priority: 1, retries: 3, stallMs: 15000, timeoutMs: 120000 };
export const P2: FetchOptions = { priority: 2, retries: 3, stallMs: 20000, timeoutMs: 180000 };
export const P3: FetchOptions = { priority: 3, retries: 1, stallMs: 30000, timeoutMs: 240000 };

async function prop(key: PropKey, mobile: boolean, fetch: FetchOptions) {
  const g = await loadModel(arenaPath(`props/${key}.glb`, mobile), fetch);
  g.scene.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true;
    // Transmission (lamp glass) makes three.js draw the whole scene a second time every frame: use plain transparency.
    const mat = m.material as THREE.MeshPhysicalMaterial; if (mat.transmission) { mat.transmission = 0; mat.transparent = true; mat.opacity = .4; mat.depthWrite = false; }
  });
  const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
  return [key, { scene: g.scene, size }] as const;
}

/** 1×1 stand-ins: a flat normal, and full AO / 0.9 roughness / no metal. */
const flats: Partial<Record<'normal' | 'arm', THREE.DataTexture>> = {};
function flat(slot: 'normal' | 'arm') {
  return flats[slot] ??= Object.assign(new THREE.DataTexture(new Uint8Array(slot === 'normal' ? [128, 128, 255, 255] : [255, 230, 0, 255]), 1, 1), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, needsUpdate: true });
}

const pending = new WeakMap<THREE.WebGLRenderer, Map<string, Promise<Library>>>();
/**
 * Everything the arena needs before anyone can play: every surface set, the props that form cover, the sky and its
 * lighting. Downloads are shared (and retried, time-limited, prioritised); GPU-side results are per renderer.
 */
export function loadLibrary(gl: THREE.WebGLRenderer, q: ArenaQuality, theme: Theme = THEMES.yard): Promise<Library> {
  let byTheme = pending.get(gl); if (!byTheme) pending.set(gl, byTheme = new Map());
  const hit = byTheme.get(theme.id); if (hit) return hit;
  initLoaders(gl, q.anisotropy);
  const mobile = q.mobileAssets;
  // Colour maps are essential; a normal or AO/roughness/metal map that cannot be downloaded falls back to a flat one
  // (the surface loses some relief, the match goes on) and the deployment trace records it.
  const surfaces = Promise.all(theme.surfaces.map(async key => {
    const [color, normal, arm] = await Promise.all(['color', 'normal', 'arm'].map(slot => {
      // A theme that defers detail deploys on colour alone; relief and roughness follow (loadSurfaceDetail).
      if (theme.deferDetail && slot !== 'color') return Promise.resolve(flat(slot as 'normal' | 'arm') as THREE.Texture);
      const t = loadTexture(arenaPath(`textures/${key}/${slot}.ktx2`, mobile), P1);
      return slot === 'color' ? t : t.catch(e => { console.warn(`Arena ${key}/${slot} map unavailable, using a flat one:`, (e as Error).message); return flat(slot as 'normal' | 'arm'); });
    }));
    color.colorSpace = THREE.SRGBColorSpace;
    return [key, { color, normal, arm }] as const;
  }));
  const props = Promise.all(COVER_PROPS.map(key => prop(key, mobile, P1)));
  const info = fetch(assetUrlOf('sky/sky.json')).then(r => r.json()).catch(() => null);
  // The campus has usually decoded the sky already (same cache key as src/world/Sky.tsx).
  const hdrP = cached('sky:hdr', () => loadHDR('sky/environment.hdr', P1));
  const env = hdrP.then(hdr => {
    const pmrem = new THREE.PMREMGenerator(gl); const rt = pmrem.fromEquirectangular(hdr); pmrem.dispose();
    return rt.texture;
  });
  const sky = loadImage(q.detail ? 'sky/sky.jpg' : 'sky/sky-low.jpg', P1).then(t => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t; });
  const extra = Promise.all(theme.extra.map(async path => [path, await loadTexture(path, P1)] as const));
  const p = Promise.all([surfaces, props, env, sky, info, hdrP, extra]).then(([s, pr, e, sk, i, hdr, ex]) => ({
    hdr, theme, extra: Object.fromEntries(ex),
    surfaces: Object.fromEntries(s) as Record<SurfaceKey, SurfaceSet>,
    props: Object.fromEntries(pr) as Library['props'],
    env: e, sky: sk, skyScale: i?.skyScale ?? 4, skyCoverage: i?.skyCoverage ?? .544, horizon: new THREE.Color().setRGB(...((i?.horizon ?? [.43, .46, .56]) as [number, number, number]), THREE.LinearSRGBColorSpace),
    sun: { dir: new THREE.Vector3(...((i?.sunDirection ?? [.55, .74, .38]) as [number, number, number])).normalize(), color: new THREE.Color().setRGB(...((i?.sunColor ?? [1, .98, .9]) as [number, number, number]), THREE.LinearSRGBColorSpace), irradiance: i?.sunIrradiance ?? 4 },
    mobile,
  }));
  byTheme.set(theme.id, p); p.catch(() => byTheme.delete(theme.id));
  return p;
}
/**
 * Set dressing, after the match is on screen. Each prop that arrives is added to the library; one that cannot be
 * downloaded is simply left out (it is decoration). Resolves with the keys that loaded.
 */
export async function loadDecor(lib: Library, signal?: AbortSignal, wanted: PropKey[] = DECOR_PROPS): Promise<PropKey[]> {
  const got = await Promise.all(wanted.map(key => prop(key, lib.mobile, { ...P2, signal }).catch(e => { if ((e as Error).name !== 'AbortError') console.warn(`Arena prop ${key} skipped:`, (e as Error).message); return null; })));
  const keys: PropKey[] = [];
  for (const r of got) if (r) { lib.props[r[0]] = r[1]; keys.push(r[0]); }
  return keys;
}
/** The photographic sky on a dome (the campus' Poly Haven HDRI, decoded to linear radiance). */
export function skyDome(lib: Library) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uSky: { value: lib.sky }, uScale: { value: lib.skyScale }, uCoverage: { value: lib.skyCoverage }, uHorizon: { value: new THREE.Vector3(lib.horizon.r, lib.horizon.g, lib.horizon.b) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
    fragmentShader: `uniform sampler2D uSky; uniform float uScale, uCoverage; uniform vec3 uHorizon; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float u = atan(d.z, d.x) / 6.2831853 + .5, polar = acos(clamp(d.y, -1., 1.)) / 3.14159265;
        vec3 sky = texture2D(uSky, vec2(u, 1. - polar / uCoverage)).rgb * uScale;
        sky = mix(sky, uHorizon, smoothstep(uCoverage - .07, uCoverage, polar));
        gl_FragColor = vec4(sky, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), material); mesh.scale.setScalar(900); mesh.renderOrder = -1000; mesh.frustumCulled = false; mesh.name = 'sky';
  return mesh;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
/** Materials made from each surface set, so late relief and roughness maps can be given to them. */
const materialsOf = new Map<SurfaceKey, { m: THREE.MeshStandardMaterial; metal: boolean }[]>();
/**
 * A PBR material from a surface set: albedo, tangent-space normal, and AO/roughness/metal packed in
 * one map (Poly Haven "arm"). `scale` is metres per texture repeat; geometry carries world-space UVs.
 */
export function surface(lib: Library, key: SurfaceKey, opts: { tint?: string; gain?: number; metal?: number; rough?: number; normalScale?: number; name?: string } = {}) {
  const id = `${key}|${opts.tint ?? ''}|${opts.gain ?? ''}|${opts.metal ?? ''}|${opts.rough ?? ''}|${opts.normalScale ?? ''}`;
  let m = materialCache.get(id);
  if (!m) {
    const s = lib.surfaces[key];
    m = new THREE.MeshStandardMaterial({
      name: opts.name ?? key, map: s.color, normalMap: s.normal, normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      roughnessMap: s.arm, aoMap: s.arm, aoMapIntensity: .75,
      // Painted and coated surfaces are dielectric; only bare steel (opts.metal) reads the metal channel.
      ...(opts.metal !== undefined ? { metalnessMap: s.arm, metalness: opts.metal } : { metalness: 0 }),
      roughness: opts.rough ?? 1, color: new THREE.Color(opts.tint ?? '#ffffff').multiplyScalar(opts.gain ?? 1),
    });
    materialCache.set(id, m);
    const list = materialsOf.get(key) ?? []; list.push({ m, metal: opts.metal !== undefined }); materialsOf.set(key, list);
  }
  return m;
}
export function clearMaterialCache() { materialCache.forEach(m => m.dispose()); materialCache.clear(); materialsOf.clear(); }
/** A material that shares a surface set's maps (for hand-built materials that want the late detail maps too). */
export function trackSurfaceMaterial(key: SurfaceKey, m: THREE.MeshStandardMaterial, metal = false) { const list = materialsOf.get(key) ?? []; list.push({ m, metal }); materialsOf.set(key, list); return m; }
/**
 * Relief (normal) and AO/roughness/metal maps for a theme that deployed on colour alone. They are fetched after the
 * match is playable, nearest surfaces first, and swapped into the live materials (same shader: no recompile, no hitch).
 * A map that cannot be downloaded is simply left flat. Resolves with how many arrived.
 */
export async function loadSurfaceDetail(lib: Library, signal?: AbortSignal, onEach?: () => void): Promise<number> {
  if (!lib.theme.deferDetail) return 0;
  let n = 0;
  for (const key of lib.theme.surfaces) {
    if (signal?.aborted) break;
    const [normal, arm] = await Promise.all((['normal', 'arm'] as const).map(slot => loadTexture(arenaPath(`textures/${key}/${slot}.ktx2`, lib.mobile), { ...P2, signal }).catch(() => null)));
    if (signal?.aborted) break;
    const set = lib.surfaces[key];
    if (normal) set.normal = normal; if (arm) set.arm = arm;
    for (const { m, metal } of materialsOf.get(key) ?? []) {
      if (normal) m.normalMap = normal;
      if (arm) { m.roughnessMap = arm; m.aoMap = arm; if (metal) m.metalnessMap = arm; }
    }
    n += (normal ? 1 : 0) + (arm ? 1 : 0); onEach?.();
  }
  return n;
}
