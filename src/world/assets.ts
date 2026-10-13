import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Runtime assets are built by scripts/assets/* into public/assets. Textures are Basis/KTX2
// (transcoded to BC/ETC2/ASTC on the GPU) and geometry is meshopt-compressed.
const BASE = `${import.meta.env.BASE_URL}assets/`;
let ktx2: KTX2Loader | null = null, gltf: GLTFLoader | null = null, anisotropy = 4;
const textures = new Map<string, Promise<THREE.Texture>>(), models = new Map<string, Promise<GLTF>>();

export function initLoaders(renderer: THREE.WebGLRenderer, maxAnisotropy: number) {
  anisotropy = Math.min(maxAnisotropy, renderer.capabilities.getMaxAnisotropy());
  if (ktx2) return;
  const manager = new THREE.LoadingManager();
  // KTX2Loader constructs decoder URLs internally, so version those requests here as well.
  manager.setURLModifier(url => url.startsWith(BASE) && !url.includes('?') ? `${url}?v=${__CAMPUS_ASSET_VERSION__}` : url);
  ktx2 = new KTX2Loader(manager).setTranscoderPath(BASE + 'basis/').setWorkerLimit(2).detectSupport(renderer);
  gltf = new GLTFLoader(manager).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}

export const assetUrl = (path: string) => `${BASE}${path}?v=${__CAMPUS_ASSET_VERSION__}`;

/** A KTX2 texture configured for tiling. Repeats are applied per material via clone(). */
export function loadTexture(path: string): Promise<THREE.Texture> {
  if (!ktx2) throw new Error('initLoaders() must run before loading textures');
  let p = textures.get(path);
  if (!p) {
    p = ktx2.loadAsync(assetUrl(path)).then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.needsUpdate = true; return t; });
    textures.set(path, p);
  }
  return p;
}

export function loadModel(path: string): Promise<GLTF> {
  if (!gltf) throw new Error('initLoaders() must run before loading models');
  let p = models.get(path);
  if (!p) { p = gltf.loadAsync(assetUrl(path)); models.set(path, p); }
  return p;
}

export function loadHDR(path: string) { return new HDRLoader().loadAsync(assetUrl(path)); }
export function loadImage(path: string) { return new THREE.TextureLoader().loadAsync(assetUrl(path)); }

/** Suspense-friendly cache: throws the pending promise until the value is ready. */
const settled = new WeakMap<Promise<unknown>, { value?: unknown; error?: unknown; done: boolean }>();
export function suspend<T>(promise: Promise<T>): T {
  let entry = settled.get(promise);
  if (!entry) {
    entry = { done: false }; settled.set(promise, entry);
    promise.then(v => { entry!.value = v; entry!.done = true; }, e => { entry!.error = e; entry!.done = true; });
  }
  if (!entry.done) throw promise;
  if (entry.error) throw entry.error;
  return entry.value as T;
}

/**
 * Module-level promise cache. Components that suspend before their first commit lose their hook
 * state, so `suspend(useMemo(load))` would create a new promise on every retry; key it here instead.
 */
const keyed = new Map<string, Promise<unknown>>();
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = keyed.get(key) as Promise<T> | undefined;
  if (!p) { p = load(); keyed.set(key, p); }
  return p;
}
