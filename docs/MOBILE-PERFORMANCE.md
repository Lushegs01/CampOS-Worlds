# Mobile performance

Target reported by the owner: **itel S24, Chrome** (a low-end Android phone). **No physical phone has
been available to any round of this work.** Every figure below is browser emulation and must not be
read as a phone frame rate.

## 15 October 2026: low-end Android pass

### How this was measured, and what it can show

- Linux cloud container, 4 CPU cores, **no GPU**. Playwright's Chromium 1194 renders WebGL with
  **SwiftShader**, a CPU rasteriser: 1.5–3 FPS whatever the code does. Frame rates here only compare
  runs made back to back on this machine; they say nothing about a phone's GPU.
- Viewport 390 × 844 CSS px, device scale factor 3, touch, Low quality (what a phone starts on).
- **Before** = the commit this round started from; **after** = this branch. Both as production
  bundles with the inspection hooks (`VITE_QA=1 vite build`, served by `vite preview`), each with its
  own room server of the same version, measured one after the other with nothing else running.
- `tests/browser-mobile-performance.mjs`, 8 s per sample: entry (just entered), walk-and-turn,
  after-walk, then library, café and court (each a fresh offline page placed there).
  `PERF_BOTS=8` adds eight room clients walking circles round the spawn. Raw reports:
  `docs/performance/{before,after}-solo.json`, `{before,after}-8-players.json`.
- Measures that do not depend on the GPU (draw calls, triangles, GPU textures and geometries,
  main-thread script time, network bytes) are the evidence. Draw calls and triangles are one frame's
  count when the 2 s telemetry window closes, so they move with the view.

### What changed

Rendering and CPU
- **Remote avatars.** Each Rocketbox character is 2–3 draw calls, 6.7–8.8k triangles and an 80-bone
  skeleton, and skinned meshes cannot be frustum-culled by three.js (`frustumCulled = false`), so
  every other player was posed and drawn every frame, including behind the camera. Now an avatar
  outside the view is neither posed nor drawn; beyond 30 m it is posed every 2nd frame and beyond
  60 m every 4th frame, without its shadow. Sit and stand transitions keep running, so nothing
  stalls off screen; a ball held by someone off screen follows their room position.
- **React.** The interface subscribed to the whole game store, so the FPS readout (every 2 s), the
  nearby-place check and every toast re-rendered the entire interface and reconciled the 3D scene's
  React tree. `App` now selects the fields it shows, `World` is memoised, and the location label
  re-reads the position on its own twice a second. The vehicle HUD no longer re-renders on every
  vehicle snapshot (15 Hz) when nobody is driving.
- **Camera collision** tested the spring arm against all 1,214 colliders five times per frame and
  allocated about 18 vectors per frame. It now queries the collision grid once per frame and reuses
  vectors; the movement grid uses numeric keys (no string per lookup), and vehicle-footprint checks
  no longer allocate per substep.
- **Adaptive resolution** ignores stalls (a backgrounded tab used to cost 15 % resolution on every
  return) and undoes a step down that does not make frames faster, with a back-off of 20 s to 5 min.
  A phone held at 30 FPS by power saving, or limited by its CPU, keeps a sharp picture instead of
  being blurred to 60 % for no gain.
- **Low quality static shadows** no longer bake in moving objects.

Memory
- Avatar rigs release their cloned materials and skeleton bone textures; name tags dispose their
  canvas textures, which are also sized to the tag (704 × 106 instead of 1024 × 154). Before, every
  player who joined and left (or changed appearance) left textures on the GPU.
- Failed downloads are retried later instead of being cached as failures forever.

Network
- 15 Hz state messages: positions to the centimetre and angles to the milliradian, only vehicles
  that changed, one serialisation per broadcast instead of one per recipient. A standing player
  sends 4 input messages a second instead of 20.
- Remote players are drawn 110 ms in the past and interpolated between snapshots stamped with the
  room clock: constant speed (4.47–4.75 m/s for a 4.5 m/s walk with 25 ms of jitter, against
  2.67–6.50 m/s with the previous easing; `tests/interpolation.test.mjs`).

### Results (emulation, SwiftShader)

Solo, Low. "Script" is main-thread JavaScript time per second of wall time (CDP `ScriptDuration`).

| Sample | | FPS | p50 frame | Draw calls | Triangles | GPU textures / geometries | Script ms/s | Render DPR |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Walk and turn | before | 1.5 | 667 ms | 129 | 313,770 | 68 / 194 | 23.1 | 1.00 |
| | after | 2.4 | 417 ms | 127 | 312,568 | 69 / 167 | 26.3 | 0.72 |
| After the walk | before | 1.6 | 650 ms | 124 | 309,004 | 68 / 194 | 12.7 | 1.00 |
| | after | 2.6 | 400 ms | 113 | 301,738 | 69 / 167 | 11.3 | 0.72 |
| Library / café / court | before | 1.5 / 1.6 / 1.7 | | 112 / 111 / 107 | 350,582 / 289,832 / 293,880 | 67–71 / 207–216 | 77 / 12 / 9 | 1.00 |
| | after | 2.0 / 1.7 / 1.9 | | 112 / 111 / 107 | identical | 69–73 / 155–168 | 56 / 11 / 11 | 0.85 |

The solo scene draws the same campus before and after (this round did not cut scenery). The higher
frame rate after comes from the **render resolution** (0.72 instead of 1.0 DPR): the old controller
had not yet stepped down when these samples were taken, the new one had. On SwiftShader, rendering is
fill-rate bound, so fewer pixels means faster frames; that is a policy difference, **not** a speed-up
of the same work. Main-thread script time is unchanged within noise when alone. The ~25 fewer
geometries are the name-tag and avatar resources now shared or disposed.

With eight other players near the spawn:

| Sample | | FPS | Draw calls | Triangles | GPU textures / geometries | Script ms/s | JS heap |
|---|---|---:|---:|---:|---:|---:|---:|
| Walk and turn | before | 1.6 | 159 | 377,792 | 143 / 235 | 26.8 | 154.5 MB |
| | after | 1.6 | 129 | 313,770 | 135 / 228 | 25.3 | 156.5 MB |
| After the walk | before | 1.7 | 143 | 370,926 | 143 / 235 | 13.3 | 158.3 MB |
| | after | 1.5 | 124 | 309,004 | 135 / 228 | 12.0 | 157.6 MB |

The other players cost 19–30 draw calls and 62–64k triangles over the solo scene before, and 11 draw
calls and 7k triangles after, mostly because players behind the camera are no longer drawn. How many
were in view at the sampled frame depends on where the bots were on their circles, so treat these as
indicative; a probe on the after build confirmed a player in front of the camera is drawn and is
skipped once the camera turns away. Both 8-player runs held DPR 1.0. The "entry" samples (not shown)
include one-time work such as the static shadow render and are in the raw files.

Network: state messages to each client, 15 Hz (`server/room.mjs` payload probe, bytes per message):

| Players in the room | Before | After |
|---:|---:|---:|
| 1 | 2,662 B (39.9 KB/s) | 662 B (9.9 KB/s) |
| 8 | 5,027 B (74 KB/s) | 2,826 B (42 KB/s) |
| 24 | 10,449 B (159 KB/s) | 7,757 B (116 KB/s) |

Long session (`tests/browser-soak.mjs`, 5 minutes, 800 × 600, Low, six other players at a time, one
leaving and a new one joining every 8 s, 42 in all; `docs/performance/soak-{before,after}.json`):

| | GPU textures at 1 / 2 / 5 min | Growth over the last 3 min | Geometries 1 → 5 min | JS heap 1 → 5 min |
|---|---|---|---|---|
| Before | 163 / 197 / 266 | **+69**, still rising about one per visitor | 240 → 257 | 156 → 160 MB |
| After | 133 / 153 / 156 | **+3** (153–159 from 2 min) | 209 → 236 | 159 → 157 MB |

After this round a character's textures are uploaded the first time it is drawn, and players behind the
camera are not drawn, so the working set of eight characters takes up to two minutes to fill; the
soak's leak check (`SOAK_ASSERT=1`, at most 8 textures of growth) therefore starts at 2 minutes.
The `growthAfterWarmup` fields inside these two files were computed from 1 minute, before that change.

Before, every player who came and went left GPU textures behind; on a phone that ends in a lost WebGL
context after a long enough evening. After, texture count stops at the working set.

Loading: 49 requests / 12.24 MB solo and 57 / 21.1 MB with eight characters, the same before and after
(localhost, no network throttling; not a mobile-network figure).

### Not measured, and what to check on a phone

- No physical device. No GPU frame times, thermal throttling, memory pressure or mobile network.
- The static-shadow change was checked mechanically (`tests/browser-reliability.mjs`), not visually.
- Room CPU under load: the payload change is measured, room CPU differences were within noise.
- A character's textures now upload when it first comes into view rather than when it joins; on a
  phone that may show as one longer frame the first time you turn towards a newcomer. Not measured.

On the S24 (or a similar phone), with **Settings → Low**: note the live FPS readout in Settings at the
gate, while walking through the courtyard, in the library and on the courts, alone and with several
other people; walk for 15 minutes with people joining and leaving and check it does not degrade
(before this round, textures accumulated); rotate the phone; background the tab for a minute and come
back (it should resume connected, in place, at the same sharpness). Report frame drops by location
with a screen recording.

### Reproduce

```bash
VITE_QA=1 npx vite build --outDir dist-qa
PORT=3103 ALLOWED_ORIGINS=http://127.0.0.1:4173 node server/index.mjs &
ROOM_URL=127.0.0.1:3103 npx vite preview --outDir dist-qa --host 127.0.0.1 --port 4173 &
TEST_URL=http://127.0.0.1:4173 PERF_LABEL=after PERF_OUT=docs/performance/after-solo.json node tests/browser-mobile-performance.mjs
TEST_URL=http://127.0.0.1:4173 PERF_LABEL=after-8-players PERF_BOTS=8 PERF_OUT=docs/performance/after-8-players.json node tests/browser-mobile-performance.mjs
TEST_URL=http://127.0.0.1:4173 SOAK_LABEL=after SOAK_SECONDS=300 node tests/browser-soak.mjs
```

For "before", check out the starting commit in another directory and do the same on other ports.

## Previous round: 13 October 2026 (desktop GPU, phone viewport emulation)

Target reported by the owner: **itel S24, Chrome**. The frontend is hosted at
https://campos-worlds.ire1bami.workers.dev. A physical S24 was not available to this test environment.

### Implemented

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

### Measured results

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

### Verification

- `npm test`: all 19 gameplay, collision and multiplayer tests passed.
- `npm run build`: TypeScript and production bundling passed.
- `tests/browser-mobile.mjs`: 12 browser checks passed, including real CDP touch movement, simultaneous look, jump, release, menu reset, library/café/court rendering, quality switching and landscape control hit testing. No captured runtime/rendering errors.
- Screenshots of the running mobile views are in `docs/screenshots/performance/`.
- Low/Medium do not fetch the post-processing chunk; Low does not request the surface normal/ARM files.
- The last production smoke run (`mobile-performance-production-final.json`) passed explicit checks for omitted high-detail downloads and versioned Basis decoder URLs, with no browser errors. It recorded 60.1 FPS / 17.0 ms p95 at DPR 1.0; driver and background activity can change the adaptive DPR between runs.

### Reproduce

Start the local game with `npm run dev`, then in a second PowerShell terminal:

```powershell
$env:TEST_URL='http://127.0.0.1:5173'
node tests/browser-mobile.mjs
$env:PERF_LABEL='local'
node tests/browser-mobile-performance.mjs
```

For production measurements, run `npm run build` and `npm run preview`, set `TEST_URL` to `http://127.0.0.1:4173`, and run the performance script. Full interaction QA hooks are intentionally unavailable in a normal production build. Override `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when Chrome is installed elsewhere. `PERF_DIAGNOSE=1` adds development-only scene-group experiments; do not use that flag against production.

### Physical-phone acceptance still required

On the S24, reload after deployment and select **Settings → Low** if an older preference was saved. Target sustained 30+ FPS, with 60 FPS where device headroom permits. Walk for five minutes through the courtyard, library and courts; rotate while moving and repeat after the phone warms up. Use the live FPS reading in Settings. Record a screen capture and report frame drops by location. Desktop emulation cannot model this phone's GPU, thermal throttling, memory pressure, browser background load or mobile network.

No hundreds-of-players or fixed mobile-FPS capacity claim is made. The full avatar animation libraries and other characters still add download cost; a future change can stream interaction clips independently. Runtime assets remain local and licensed as documented in `ASSETS.md`.
