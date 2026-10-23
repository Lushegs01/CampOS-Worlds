# Installation, updates and offline recovery

The frontend uses `vite-plugin-pwa` 2 and Workbox 7 with a custom worker in `src/sw.ts`.
Normal builds include the manifest and worker; development does not register a worker.

## Installation

Open Settings → **CampOS on your home screen**. Browsers that emit `beforeinstallprompt`
offer **Install CampOS Worlds** there. The prompt is shown only after a click. Installed
standalone sessions hide the install button. On iPhone/iPad Safari the section instead
explains **Share → Add to Home Screen** and the Open as Web App option, where offered.
Other browsers retain the browser experience without promising an unsupported install API.
The manifest uses origin-relative `/` for its id, start URL and scope, and standalone display.

Icons are exact raster derivatives of the existing `public/favicon.svg` mark. The maskable
512 icon has an opaque background and additional safe-zone padding. `npm run assets:brand`
regenerates the icons and social image from the existing mark and bundled Manrope font;
generated images are committed, so deployment builds need no browser for asset generation.

## Cache and data boundaries

Only the launch shell is precached: the document, bundled code/styles/fonts, manifest/icons,
favicon and the standalone offline recovery page. `npm run verify:release` enforces a total
under 5 MiB and rejects world models, textures, audio and private endpoint paths in that cache.
The measured size for this release is recorded in `docs/release/artifacts.json`.

There are no runtime cache routes. Accounts, API requests, payment returns, WebSockets,
economic records and multiplayer state are never supplied from the worker cache. The existing
browser HTTP asset cache remains separate; gameplay assets retain content-revision URLs.
The worker does not proactively download the 34 MB world asset library. Workbox revisions
invalidate changed files and remove obsolete precache entries when an update activates.
If worker installation fails (for example, insufficient storage), the online game remains
usable and an existing worker is not replaced by a failed installation.

Navigations fetch a fresh document. A failed request, HTTP 5xx or a 10-second document timeout
opens the cached branded recovery page, rather than an old document with missing world assets.
Account, admin, shop and socket paths are excluded from navigation recovery.
Existing loaded campus areas may remain locally explorable when connectivity drops, but
offline startup does not promise a complete world, sign-in, multiplayer or shared actions.
Reconnect and choose **Try campus again**. No recovery action erases saved preferences.

## Updates

A new worker waits. Settings offers **Reload and update**, with notice that live activities
may end and other open campus tabs will also be offered a reload. Nothing automatically opts into a waiting
update during gameplay. Browser worker checks run on navigation; returning to the app or
reconnecting also checks at most once an hour. `sw.js` and the manifest must be revalidated
by the host. Never serve `sw.js` under an immutable long-lived cache policy.

## Hosting and metadata

Deploy all of `dist/`, including `_headers`, `sw.js`, `manifest.webmanifest`, `offline.html`,
`offline.css`, `icons/` and `brand/`. The worker must be served as JavaScript at `/sw.js`,
with scope `/`, on HTTPS (localhost is the browser's development exception). Preserve the
existing room URL and Supabase build settings. No DNS changes or server migrations are needed
for the PWA itself. A static host must return a real 404 for missing JS, models and images;
do not rewrite missing asset requests to the app document.

`SITE_URL` is a build-only HTTPS origin for canonical and sharing URLs. Its default is the
owner-supplied expected domain `https://camposworlds.click`. Availability and domain ownership
were not established by the local checks; verify the deployed host before advertising a release.
It must be an origin without credentials, path, query or fragment.

The shipped CSP is exercised by the production browser test. The current Basis/Embind decoder
generates JavaScript bindings in blob workers, so `script-src` includes `unsafe-eval` as well
as `wasm-unsafe-eval`. Removing the former currently stalls texture decoding. GLB embedded
textures need `blob:` in `connect-src`, and Fontsource inlines small data fonts. Inline scripts
remain forbidden; the payment-return script is an external same-origin file. A stricter script
policy would require replacing/rebuilding the decoder, then repeating the production tests.

## Sharing previews

Configured site: `https://camposworlds.click/`.
Configured social image: `https://camposworlds.click/brand/campos-worlds-social.png`.
The image is 1200 × 630 PNG and uses the original mark, bundled wordmark font and brand colours.
Metadata is in the initial HTML so crawlers do not need JavaScript or authentication.

Local production verification covers status, MIME type, dimensions, logo appearance and one
consistent set of Open Graph and Twitter tags. It does not prove a public deployment or that a
particular social platform has refreshed its cache. After deployment, inspect the public HTML
and image without signing in. For old previews, use Meta's
[Sharing Debugger](https://developers.facebook.com/tools/debug/) and **Scrape Again**, or LinkedIn's
[Post Inspector](https://www.linkedin.com/post-inspector/). WhatsApp, Telegram, Discord and X
may retain previously fetched previews; allow their caches to refresh. When the image itself
changes in a later release, a new versioned image URL is more reliable than overwriting cached bytes.

## Reproduce the release checks

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run verify:release
npx playwright install chromium
node tests/browser-account-recovery.mjs
npm run test:release
```

The production browser suite serves the actual `dist/` with its HTTP headers and a private
local room. It checks entry, keyboard/touch movement, metadata, Chromium installability,
worker installation/cache/update/offline recovery, WebGL context loss, an essential asset
failure and an optional panel failure. The separate account suite uses the real browser SDK,
PostgreSQL and room to verify session races and recovery without rendering two campuses. On a
GPU-less machine it uses software WebGL and a low browser DPR, with no QA hooks in production.
That verifies behaviour and layout, not physical phone performance or Safari installation.
