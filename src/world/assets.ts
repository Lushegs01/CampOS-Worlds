import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ASSET_BASE as BASE, assetUrl } from './assetUrl';
import { fetchBytes, deadline, type FetchOptions } from './fetcher';
export { assetUrl };

// Runtime assets are built by scripts/assets/* into public/assets. Textures are Basis/KTX2
// (transcoded to BC/ETC2/ASTC on the GPU) and geometry is meshopt-compressed.
let ktx2: KTX2Loader | null = null, gltf: GLTFLoader | null = null, anisotropy = 4;
const textures = new Map<string, Promise<THREE.Texture>>(), models = new Map<string, Promise<GLTF>>();
/** What has finished loading (for releasing GPU resources: see cachedAssets). */
const loadedTextures = new Map<string, THREE.Texture>(), loadedModels = new Map<string, GLTF>();

/**
 * A failed download (a dropped mobile connection) is forgotten after a few seconds, so a later attempt
 * fetches it again. Not at once: React renders again as soon as the promise settles, and an immediate
 * retry would suspend again instead of reaching the error boundary, in a loop of failing requests.
 */
export function forgetOnFailure<K, T>(cache: Map<K, Promise<T>>, key: K, p: Promise<T>, afterMs = 5000) {
  p.catch(() => { const drop = () => { if (cache.get(key) === p) cache.delete(key); }; if (afterMs) setTimeout(drop, afterMs); else drop(); });
  return p;
}

export function initLoaders(renderer: THREE.WebGLRenderer, maxAnisotropy: number) {
  anisotropy = Math.min(maxAnisotropy, renderer.capabilities.getMaxAnisotropy());
  if (ktx2) return;
  const manager = new THREE.LoadingManager();
  // KTX2Loader constructs decoder URLs internally, so version those requests here as well.
  manager.setURLModifier(url => url.startsWith(BASE) && !url.includes('?') ? `${url}?v=${__CAMPUS_ASSET_VERSION__}` : url);
  // Two transcoder workers on small devices; up to four where there are cores to spare (faster arena loading).
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  ktx2 = new KTX2Loader(manager).setTranscoderPath(BASE + 'basis/').setWorkerLimit(Math.max(2, Math.min(4, Math.floor(cores / 2)))).detectSupport(renderer);
  gltf = new GLTFLoader(manager).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}

/**
 * A KTX2 texture configured for tiling. Repeats are applied per material via clone(). With `fetch` options the
 * download goes through the arena's prioritised, time-limited, retrying fetcher (src/arena/fetcher.ts) and the
 * transcode is time-limited too; without, three.js loads it as before (the campus).
 */
export function loadTexture(path: string, fetch?: FetchOptions): Promise<THREE.Texture> {
  if (!ktx2) throw new Error('initLoaders() must run before loading textures');
  let p = textures.get(path);
  if (!p) {
    const loader = ktx2;
    const raw = fetch ? fetchBytes(assetUrl(path), fetch).then(b => deadline(new Promise<THREE.Texture>((resolve, reject) => loader.parse(b, resolve, reject)), 45000, `decoding ${path} took too long`)) : loader.loadAsync(assetUrl(path));
    p = raw.then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; t.needsUpdate = true; loadedTextures.set(path, t); return t; });
    textures.set(path, forgetOnFailure(textures, path, p, fetch ? 0 : 5000));
  }
  return p;
}

export function loadModel(path: string, fetch?: FetchOptions): Promise<GLTF> {
  if (!gltf) throw new Error('initLoaders() must run before loading models');
  let p = models.get(path);
  if (!p) {
    const loader = gltf;
    p = (fetch ? fetchBytes(assetUrl(path), fetch).then(b => deadline(loader.parseAsync(b, ''), 45000, `decoding ${path} took too long`)) : loader.loadAsync(assetUrl(path))).then(g => { loadedModels.set(path, g); return g; });
    models.set(path, forgetOnFailure(models, path, p, fetch ? 0 : 5000));
  }
  return p;
}

/**
 * Forget cached downloads whose path starts with `prefix` (leaving the arena releases its models and textures;
 * the HTTP cache still has the files, so coming back does not download them again).
 */
export function forgetAssets(prefix: string) {
  for (const cache of [textures, models, loadedTextures, loadedModels] as Map<string, unknown>[]) for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}
/** Loaded models' scenes and loaded textures whose path starts with `prefix`. */
export function cachedAssets(prefix: string) {
  return { scenes: [...loadedModels].filter(([k]) => k.startsWith(prefix)).map(([, g]) => g.scene), textures: [...loadedTextures].filter(([k]) => k.startsWith(prefix)).map(([, t]) => t) };
}

/** Through the fetcher when given options: the bytes are handed to three.js as a local blob. */
async function viaBlob<T>(path: string, fetch: FetchOptions, load: (url: string) => Promise<T>) {
  const url = URL.createObjectURL(new Blob([await fetchBytes(assetUrl(path), fetch)]));
  try { return await deadline(load(url), 30000, `decoding ${path} took too long`); } finally { URL.revokeObjectURL(url); }
}
export function loadHDR(path: string, fetch?: FetchOptions) { return fetch ? viaBlob(path, fetch, u => new HDRLoader().loadAsync(u)) : new HDRLoader().loadAsync(assetUrl(path)); }
export function loadImage(path: string, fetch?: FetchOptions) { return fetch ? viaBlob(path, fetch, u => new THREE.TextureLoader().loadAsync(u)) : new THREE.TextureLoader().loadAsync(assetUrl(path)); }

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
  if (!p) { p = load(); keyed.set(key, forgetOnFailure(keyed, key, p)); }
  return p;
}
