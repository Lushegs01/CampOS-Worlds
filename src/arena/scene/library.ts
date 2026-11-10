// Combat Arena asset library: the arena's own pack (public/assets/arena, built by
// scripts/assets/build-arena.mjs) plus the campus HDR sky. Loaded only when a match opens; every
// texture is Basis KTX2 and every model meshopt-compressed.
import * as THREE from 'three';
import { initLoaders, loadTexture, loadModel, loadHDR, loadImage, assetUrl } from '../../world/assets';
import type { ArenaQuality } from './world';

export type SurfaceKey = 'concreteWall' | 'concreteFloor' | 'road' | 'gravel' | 'dirt' | 'brick' | 'corrugated' | 'rustyCorrugated' | 'paintedMetal' | 'metalPlate' | 'plywood' | 'planks' | 'plaster' | 'sandbag';
export const SURFACE_KEYS: SurfaceKey[] = ['concreteWall', 'concreteFloor', 'road', 'gravel', 'dirt', 'brick', 'corrugated', 'rustyCorrugated', 'paintedMetal', 'metalPlate', 'plywood', 'planks', 'plaster', 'sandbag'];
export type PropKey = 'jersey' | 'milCrate' | 'oldCrate' | 'ammo' | 'barrel' | 'jerrycan' | 'generator' | 'wallLamp' | 'securityLight' | 'powerBox' | 'utilityBox' | 'tyre' | 'propane' | 'crate';
export const PROP_KEYS: PropKey[] = ['jersey', 'milCrate', 'oldCrate', 'ammo', 'barrel', 'jerrycan', 'generator', 'wallLamp', 'securityLight', 'powerBox', 'utilityBox', 'tyre', 'propane', 'crate'];
export interface SurfaceSet { color: THREE.Texture; normal: THREE.Texture; arm: THREE.Texture }
export interface Library {
  surfaces: Record<SurfaceKey, SurfaceSet>;
  props: Record<PropKey, { scene: THREE.Group; size: THREE.Vector3 }>;
  env: THREE.Texture; sky: THREE.Texture; skyScale: number; skyCoverage: number; horizon: THREE.Color;
  sun: { dir: THREE.Vector3; color: THREE.Color; irradiance: number };
}

const pending = new WeakMap<THREE.WebGLRenderer, Promise<Library>>();
let hdrOnce: Promise<THREE.DataTexture> | null = null;
/** Load everything the arena scene draws. Downloads are shared; GPU-side results are per renderer. */
export function loadLibrary(gl: THREE.WebGLRenderer, q: ArenaQuality): Promise<Library> {
  const hit = pending.get(gl); if (hit) return hit;
  initLoaders(gl, q.anisotropy);
  const surfaces = Promise.all(SURFACE_KEYS.map(async key => {
    const [color, normal, arm] = await Promise.all(['color', 'normal', 'arm'].map(slot => loadTexture(`arena/textures/${key}/${slot}.ktx2`)));
    color.colorSpace = THREE.SRGBColorSpace;
    return [key, { color, normal, arm }] as const;
  }));
  const props = Promise.all(PROP_KEYS.map(async key => {
    const g = await loadModel(`arena/props/${key}.glb`);
    g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; (m.material as THREE.MeshStandardMaterial).envMapIntensity = .9; } });
    const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
    return [key, { scene: g.scene, size }] as const;
  }));
  const info = fetch(assetUrl('sky/sky.json')).then(r => r.json()).catch(() => null);
  const env = (hdrOnce ??= loadHDR('sky/environment.hdr')).then(hdr => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(gl); const rt = pmrem.fromEquirectangular(hdr); pmrem.dispose();
    return rt.texture;
  });
  const sky = loadImage(q.detail ? 'sky/sky.jpg' : 'sky/sky-low.jpg').then(t => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t; });
  const p = Promise.all([surfaces, props, env, sky, info]).then(([s, pr, e, sk, i]) => ({
    surfaces: Object.fromEntries(s) as Record<SurfaceKey, SurfaceSet>,
    props: Object.fromEntries(pr) as Library['props'],
    env: e, sky: sk, skyScale: i?.skyScale ?? 4, skyCoverage: i?.skyCoverage ?? .544, horizon: new THREE.Color().setRGB(...((i?.horizon ?? [.43, .46, .56]) as [number, number, number]), THREE.LinearSRGBColorSpace),
    sun: { dir: new THREE.Vector3(...((i?.sunDirection ?? [.55, .74, .38]) as [number, number, number])).normalize(), color: new THREE.Color().setRGB(...((i?.sunColor ?? [1, .98, .9]) as [number, number, number]), THREE.LinearSRGBColorSpace), irradiance: i?.sunIrradiance ?? 4 },
  }));
  pending.set(gl, p); p.catch(() => pending.delete(gl));
  return p;
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
  }
  return m;
}
export function clearMaterialCache() { materialCache.forEach(m => m.dispose()); materialCache.clear(); }
