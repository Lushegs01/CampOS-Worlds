/// <reference lib="webworker" />
import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { ARENA_CODE_CACHE, STATIC_ASSET_CACHE, isArenaCode, isStaticAsset, supersededBy } from './world/assetCache';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] };
setCacheNameDetails({ prefix: 'campos-worlds' });
clientsClaim();
// A fresh document always comes from the host. Offline startup uses a truthful recovery page,
// rather than an old game document whose world assets or live state may be missing.
registerRoute(new NavigationRoute(async ({ request }) => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.status >= 500) throw new Error('Campus host unavailable');
    return response;
  } catch {
    return (await matchPrecache('/offline.html')) ?? Response.error();
  } finally { clearTimeout(timer); }
}, { denylist: [/^\/(?:api|auth|admin|shop|ws|health|ready)(?:\/|$)/, /^\/shop-return\.html$/] }));
precacheAndRoute(self.__WB_MANIFEST, { cleanURLs: false, directoryIndex: '', ignoreURLParametersMatching: [] });
cleanupOutdatedCaches();
// Runtime caching, for static files only (src/world/assetCache.ts decides what qualifies):
// * Combat Arena's code chunks (content-hashed names): cached the first time the arena is opened, so a later visit
//   on a poor connection starts without downloading them again. Campus-only players still never fetch them.
// * Models, textures, audio and decoders under /assets/ carrying the content revision (?v=…): cached as they are first
//   used, never prefetched by the worker. A newer revision of a file replaces the older one (no stale art), entries
//   are bounded, and the cache is dropped if storage runs short.
// Everything else (accounts, payments, APIs, matchmaking, WebSockets, live match state) has no route: network-only.
const evictOlder = { cacheDidUpdate: async ({ cacheName, request }: { cacheName: string; request: Request }) => {
  const cache = await caches.open(cacheName);
  for (const old of await cache.keys()) if (supersededBy(old.url, request.url)) await cache.delete(old);
} };
registerRoute(({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && isArenaCode(url.pathname),
  new CacheFirst({ cacheName: ARENA_CODE_CACHE, plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true })] }));
registerRoute(({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && isStaticAsset(url),
  new CacheFirst({ cacheName: STATIC_ASSET_CACHE, plugins: [new CacheableResponsePlugin({ statuses: [200] }), evictOlder, new ExpirationPlugin({ maxEntries: 900, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true })] }));
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
