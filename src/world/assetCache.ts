// What the service worker may keep (shared by src/sw.ts and the page), and the page's view of what it holds.
// Only immutable static files qualify: content-hashed code chunks and revisioned assets. Nothing private or live.

export const ARENA_CODE_CACHE = 'campos-worlds-arena-code';
export const STATIC_ASSET_CACHE = 'campos-worlds-static-assets';
const ASSET_EXT = /\.(glb|gltf|bin|ktx2|hdr|exr|png|jpe?g|webp|avif|ogg|opus|mp3|m4a|wav|webm|json|wasm|js)$/i;
/** Paths that must never be served from a cache, whatever they look like. */
const PRIVATE = /^\/(?:api|auth|admin|shop|ws|arena|health|ready)(?:\/|$)/;

/** Combat Arena's lazily loaded code: hashed file names (assets/arena-<name>-<hash>.js|css). */
export const isArenaCode = (pathname: string) => !PRIVATE.test(pathname) && /^\/assets\/arena-[\w.-]+-[\w-]{8,}\.(?:js|css)$/.test(pathname);
/** A world asset with its content revision: /assets/<path>.<ext>?v=<revision>. */
export function isStaticAsset(url: URL) {
  const v = url.searchParams.get('v');
  return !PRIVATE.test(url.pathname) && url.pathname.startsWith('/assets/') && !!v && /^[\w-]{4,64}$/.test(v) && ASSET_EXT.test(url.pathname) && [...url.searchParams.keys()].length === 1;
}
/** True when `older` is the same file as `newer` at a different revision (the newer one replaces it). */
export function supersededBy(older: string, newer: string) {
  try { const a = new URL(older), b = new URL(newer); return a.pathname === b.pathname && a.searchParams.get('v') !== b.searchParams.get('v'); } catch { return false; }
}

export interface CacheReport {
  supported: boolean; files: number; bytes: number; code: number;
  groups: Record<string, { files: number; bytes: number }>;
  /** The browser's own figures for this site (all storage, not only these caches). */
  usage?: number; quota?: number; persisted?: boolean; stale: number;
}
/** What group a cached asset belongs to, for the asset manager (maps, weapons, soldiers, audio, other). */
export function groupOf(pathname: string) {
  const p = pathname.replace(/^\/assets\//, '');
  if (/^arena\/weapons\//.test(p)) return 'Weapons';
  if (/^arena\/characters\/|^characters\//.test(p)) return 'Soldiers';
  if (/audio\//.test(p) || /\.(ogg|opus|mp3|m4a|wav)$/.test(p)) return 'Audio';
  if (/^arena\//.test(p)) return 'Maps';
  return 'Campus and shared';
}
/** Read the caches (on demand only: it touches every entry). `current` is this build's asset revision. */
export async function cacheReport(current: string): Promise<CacheReport> {
  const out: CacheReport = { supported: typeof caches !== 'undefined', files: 0, bytes: 0, code: 0, groups: {}, stale: 0 };
  if (!out.supported) return out;
  const sizeOf = async (r: Response | undefined) => { const n = Number(r?.headers.get('content-length')); return Number.isFinite(n) && n > 0 ? n : (await r?.clone().blob())?.size ?? 0; };
  const assets = await caches.open(STATIC_ASSET_CACHE);
  for (const req of await assets.keys()) {
    const url = new URL(req.url); if (url.searchParams.get('v') !== current) { out.stale++; continue; }
    const n = await sizeOf(await assets.match(req)), g = (out.groups[groupOf(url.pathname)] ??= { files: 0, bytes: 0 });
    g.files++; g.bytes += n; out.files++; out.bytes += n;
  }
  const code = await caches.open(ARENA_CODE_CACHE);
  for (const req of await code.keys()) { const n = await sizeOf(await code.match(req)); out.code += n; out.bytes += n; }
  try { const e = await navigator.storage?.estimate?.(); out.usage = e?.usage; out.quota = e?.quota; out.persisted = await navigator.storage?.persisted?.(); } catch { /* not offered */ }
  return out;
}
/** Remove everything these caches hold (the files download again when next used). */
export async function clearAssetCaches() { if (typeof caches === 'undefined') return; await Promise.all([caches.delete(STATIC_ASSET_CACHE), caches.delete(ARENA_CODE_CACHE)]); }
