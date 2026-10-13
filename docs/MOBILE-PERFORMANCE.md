# Mobile performance pass — 13 October 2026

Target reported by the owner: **itel S24, Chrome**. The frontend is hosted at
https://campos-worlds.ire1bami.workers.dev. A physical S24 was not available to this test environment.

## Implemented

- Phones and tablets start on Low; new desktop profiles start on Medium. Existing explicit quality preferences remain saved.
- Low loads only the 20 albedo surface textures, skipping 40 normal/ARM textures and their transcodes/uploads. Textured architecture, sky lighting, avatars, interiors and gameplay remain available.
- Low uses a simpler ground shader, 8,192 terrain triangles instead of 80,000, fewer foliage cards and a 1,024 px static sun shadow instead of 2,048 px.
- Furniture streams in as the camera approaches. Chair instances are grouped into 16 m cells with valid bounds; nearby cells render, distant cells disappear. Doors and decorative props have distance limits. Collision and interaction state are independent of visual culling.
- The high-quality post-processing stack is a separate lazy chunk: 286 KB of JavaScript (148 KB gzip) no longer loads for Low/Medium.
- Adaptive resolution targets smooth frames instead of waiting until the frame rate drops below 32 FPS. It has a recovery dead band and a 0.6 DPR floor on Low/Medium. High keeps its 0.75 floor.
- Joystick motion updates its visual knob directly, without React state updates for every pointer movement. Two-finger movement/look works; releasing, canceling, opening a menu or leaving the tab clears movement.
- Mobile overlays avoid backdrop blur over the changing canvas. Portrait and landscape HUD layouts leave space for touch controls.
- Camera collision broad-phase rejects distant buildings and avoids arrays per collider.
- Vegetation quality switches no longer dispose geometry held in the session cache.
- Cloudflare `_headers` gives assets a one-day browser cache. Runtime asset URLs include a deterministic hash of the asset contents; updated assets receive new URLs. HTML retains platform revalidation.

## Measured results

Chrome 154, Intel Iris Xe / ANGLE D3D11, 390 × 844 CSS pixels, emulated touch and device scale factor 3. Both development comparisons used Low with one other connected avatar at the entrance. Six-second samples after a ten-second settling period. There is no CPU/network throttling. These are **desktop emulation measurements, not S24 FPS**.

| Entrance sample | Before | After |
|---|---:|---:|
| Submitted triangles / frame | 420,508 | 234,972 |
| GPU textures | 122 | 65 |
| Draw calls / frame | 120 | 115 |
| Average FPS | 51.3 | 59.5 |
| 95th percentile frame time | 33.4 ms | 17.0 ms |
| Render DPR | 1.00 | 0.95 |

This is a 44% reduction in submitted triangles and a 47% reduction in GPU textures at that viewpoint. These figures vary as the player moves; interiors deliberately draw more nearby detail.

The final production preview, with **no other avatars**, recorded 60.2 FPS, 16.9 ms p95, 226,160 triangles, 104 draw calls and 60 GPU textures. It transferred 11.34 MB over 46 resource requests during the measured startup/settling/sample period on localhost. It is not a slow-mobile-network loading guarantee. Raw reports are `mobile-performance-before.json`, `mobile-performance-after.json` and `mobile-performance-production-after.json`.

The observed entry times are included in the reports but are not a controlled cold-start comparison: OS/driver shader caches, compilation and network conditions differ. Do not market their ratio as a loading-speed improvement.

A separate check of the **existing deployed build** also reached 60.2 FPS on this desktop GPU (one remote avatar, 420,508 triangles, 121 textures; `mobile-performance-deployed-before.json`). This confirms the machine can hit its refresh ceiling even before optimization. Reduced rendering/download workload is the portable evidence here; none of these runs establishes the S24's frame rate or an FPS multiplier on that phone.

## Verification

- `npm test`: all 19 gameplay, collision and multiplayer tests passed.
- `npm run build`: TypeScript and production bundling passed.
- `tests/browser-mobile.mjs`: 12 browser checks passed, including real CDP touch movement, simultaneous look, jump, release, menu reset, library/café/court rendering, quality switching and landscape control hit testing. No captured runtime/rendering errors.
- Screenshots of the running mobile views are in `docs/screenshots/performance/`.
- Low/Medium do not fetch the post-processing chunk; Low does not request the surface normal/ARM files.
- The last production smoke run (`mobile-performance-production-final.json`) passed explicit checks for omitted high-detail downloads and versioned Basis decoder URLs, with no browser errors. It recorded 60.1 FPS / 17.0 ms p95 at DPR 1.0; driver and background activity can change the adaptive DPR between runs.

## Reproduce

Start the local game with `npm run dev`, then in a second PowerShell terminal:

```powershell
$env:TEST_URL='http://127.0.0.1:5173'
node tests/browser-mobile.mjs
$env:PERF_LABEL='local'
node tests/browser-mobile-performance.mjs
```

For production measurements, run `npm run build` and `npm run preview`, set `TEST_URL` to `http://127.0.0.1:4173`, and run the performance script. Full interaction QA hooks are intentionally unavailable in a normal production build. Override `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when Chrome is installed elsewhere. `PERF_DIAGNOSE=1` adds development-only scene-group experiments; do not use that flag against production.

## Physical-phone acceptance still required

On the S24, reload after deployment and select **Settings → Low** if an older preference was saved. Target sustained 30+ FPS, with 60 FPS where device headroom permits. Walk for five minutes through the courtyard, library and courts; rotate while moving and repeat after the phone warms up. Use the live FPS reading in Settings. Record a screen capture and report frame drops by location. Desktop emulation cannot model this phone's GPU, thermal throttling, memory pressure, browser background load or mobile network.

No hundreds-of-players or fixed mobile-FPS capacity claim is made. The full avatar animation libraries and other characters still add download cost; a future change can stream interaction clips independently. Runtime assets remain local and licensed as documented in `ASSETS.md`.
