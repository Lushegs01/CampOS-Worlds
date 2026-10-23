/// <reference lib="webworker" />
import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

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
}, { denylist: [/^\/(?:api|auth|admin|shop|ws|health)(?:\/|$)/, /^\/shop-return\.html$/] }));
precacheAndRoute(self.__WB_MANIFEST, { cleanURLs: false, directoryIndex: '', ignoreURLParametersMatching: [] });
cleanupOutdatedCaches();
// No runtime caching: accounts, payments, APIs, socket state and the large world assets stay network-only.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
