# Keeping arena files between visits

Before this pass the service worker precached only the launch shell, with no runtime caching. Arena code was
deliberately left out, and world assets relied on the browser's HTTP cache, which may evict them at any time. Now
`src/sw.ts` keeps two runtime caches, with rules in `src/world/assetCache.ts`:

| Cache | What | Rule |
|---|---|---|
| `campos-worlds-arena-code` | Combat Arena's lazily loaded chunks | `/assets/arena-<name>-<hash>.js\|css` (content-hashed names) |
| `campos-worlds-static-assets` | models, textures, audio, decoders | `/assets/…` with exactly one query parameter, `v=<content revision>`, and a static-file extension |

* **Cache-first, on use.** A file is kept the first time the game downloads it. The worker never prefetches, so a
  low-bandwidth player is never made to download the library, and campus-only players never fetch arena code.
* **Versioned.** The `v` revision is a hash of `public/assets/`. When a file is fetched at a new revision, older
  revisions of that same file are deleted.
* **Bounded.** Code is limited to 120 entries for 60 days, assets to 900 entries for 90 days. Both caches are
  dropped if the browser reports a storage-quota error. Only full `200` responses are stored.
* **Never cached.** Anything outside `/assets/` has no route, and `api`, `auth`, `admin`, `shop`, `ws`, `arena`,
  `health` and `ready` paths are excluded explicitly. That covers accounts, payments, matchmaking, WebSockets and live
  match state. The precache is unchanged (2.49 MB, `npm run verify:release`).

The existing download queue (`src/world/fetcher.ts`, priorities 1–3) is unchanged and still decides what the player
waits for. A cache hit simply arrives at once.

## Asset manager

Arena settings → **Downloaded assets** shows what is kept on this device:

* files and size, grouped as Maps, Weapons, Soldiers, Audio, and Campus and shared;
* the arena code size;
* the browser's own usage and quota figures;
* a button to remove the kept files.

## Verification

* `tests/asset-cache.test.mjs`: what qualifies and what never does (private paths, unversioned or extra-parameter
  URLs, path tricks), that only the same file is superseded, and that the worker has exactly these routes.
* A browser check against the production build (`vite preview`, Chromium):
  * a weapon model was cached on first fetch;
  * fetching a newer revision replaced the old copy;
  * the page's own revisioned assets were cached as it used them;
  * no `/health`, `/api` or `/auth` response was in any cache.

## Not done

* No "download everything now" option (there is no complete per-map asset manifest to drive it yet).
* No resumable (range) downloads.
* No offline practice mode: offline startup still opens the recovery page, as documented in [PWA.md](PWA.md).
