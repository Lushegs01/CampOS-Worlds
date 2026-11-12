# Combat Arena: deployment reliability, audio, interface and mobile performance

This report covers the production-hardening pass on Combat Arena: why players were stuck on
**"Combat Arena · Deploying…"**, what was changed, how it was measured, and what is still not done. Every number
here comes from a script in this repository that can be re-run; where a number could not be measured (no GPU, no
phone in this environment), that is said.

**Test environment.** A Linux container with 4 CPU cores and no GPU. Browsers are headless Chromium with
SwiftShader (software WebGL), so absolute frame rates and decode times are far slower than on real hardware; the
comparisons below are like for like (same machine, same harness, same build settings, fresh browser cache per run).
No physical phones were available.

## 1. Deployment: what was wrong

Measured with a new benchmark, `scripts/qa/arena-deploy.mjs`: the production bundle built with the QA inspection
hooks, served exactly like production with the real room server, one fresh browser context per run, timing from
pressing **Start training** to the player's own simulation moving when they press forward. Network profiles are
Chrome DevTools-style emulation applied after the lobby is ready; failures are injected with request routing.

Before (`docs/performance/arena-deploy-before.json`):

| Scenario | Result |
|---|---|
| Normal (loopback), 5 runs | p50 **19.9 s** to playable, 25.2 MB, ~200 requests |
| 4G (9 Mbit/s, 70 ms) | **31.6 s** — and the screen cleared only via a 15 s cap, *before* the soldier models had arrived, so the bots were invisible |
| 3G (1.6 Mbit/s, 300 ms) | **111 s**, same invisible-enemy cap |
| One environment texture fails to download | **stuck forever** on "Deploying…" (still stuck at 120 s) |
| One decorative prop never answers | **stuck forever** |
| Repeat deployments in one page | 21.1 s, 9.3 s, 9.1 s |

Root causes, from the code and the per-stage probes the benchmark records:

1. **The overlay waited for everything, serially.** `Scene.tsx` showed "Deploying…" until the environment library,
   the soldier models, the player's weapon *and* the arms were all ready. The soldier models (≈11 MB with their
   animation libraries and weapon LODs) only *started* downloading after the 14 MB environment library had finished
   (`useEffect(…, [lib])`). Probe timings on loopback: server assignment 0.16 s, environment 5.7 s, soldiers 17.2 s
   → overlay 17.2 s.
2. **Any failure or stall in the library blocked forever.** The library was one `Promise.all` over ~60 files with
   no timeouts and no retries. A rejected download set an error nobody displayed, and the 15 s safety cap was armed
   only *after* the library loaded — so a single failed or hanging file meant an infinite "Deploying…".
3. **25 MB before playing.** Every environment texture at 1024², every prop including pure decoration, every
   soldier, every free weapon's third-person model and the player's own weapon were on the critical path on every
   device.
4. **Server-side identification could loop.** The arena verified the account and then fetched the profile and arena
   progress one after the other (up to 3 × 5 s), while its heartbeat closed any socket not identified within 15 s —
   so a slow account service produced connect → close → reconnect forever. An exception in identification sent no
   `ready` at all (a client stuck on "Connecting…").
5. **Players were put into live combat before they could see.** Joining a match in progress (or a match starting)
   spawned the player immediately, while their scene could still be loading for many seconds.
6. **A graphics change re-entered "Deploying…" mid-match.** Adaptive performance stepping the profile down remounts
   the 3D view, which showed the deployment overlay again and, from Medium to Low, would have switched texture sets.

## 2. Deployment: what changed

* **Explicit lifecycle** — `src/arena/deploy.ts`: `requesting → loading-code → preparing → synchronizing →
  deployed`, plus `recovering` and `failed`. Each stage has an entry call, a completion condition, a failure
  condition and a time budget checked every second by a watchdog (preparing is judged by *time since the last byte*,
  so slow connections are allowed while data flows). Duplicate deploy requests are ignored; a timed-out stage fails
  with a specific message and a Retry that does the right thing (re-request, re-download only what failed, or
  re-sync with the match). A dropped connection during deployment goes to `recovering` and resumes after the rejoin.
* **Correlation and diagnostics** — every attempt has a random correlation id sent with the request. The server
  traces the same attempt (assigned, loaded, spawned) and keeps client-reported stage timings in a rolling window
  with p50/p95/p99 (`/admin/arena` → `deployments`). The client logs one structured `[arena-deploy]` line per
  attempt and shows the last three in **Settings → Diagnostics** (copyable from the failure screen). No names,
  accounts or addresses are recorded.
* **Robust downloads** — `src/world/fetcher.ts`: a strict priority queue (critical files first; nothing optional
  starts while a critical file is still downloading), per-request stall and overall timeouts, retries with
  exponential backoff and jitter for transient failures, no retries for permanent ones (404/403), cancellation when
  leaving, byte-accurate progress (retried bytes are not double counted), and a time limit on decoding.
* **Staged loading** — priority 1: environment surfaces, the props that *are* cover (crates, jersey barriers), the
  sky and its light, the player's own weapon (queued first) and arms. Priority 2: soldiers (other players are drawn
  as soldier-shaped stand-ins in team colours until the models arrive — never invisible), the second weapon, set
  dressing (added to the scene after the match is on screen; the static shadow is redrawn once). Priority 3: other
  weapons' models in idle time on Medium/High. Normal/AO maps fall back to flat ones if they cannot be downloaded;
  colour maps, cover and the player's weapon are essential and stop the deployment with the file and reason.
* **Phone texture tier** — `public/assets/arena/mobile/`, generated by `scripts/assets/build-arena-mobile.mjs`:
  the same environment, props and soldiers with each texture's largest mip level dropped (`scripts/assets/ktx2-mips.mjs`
  rewrites the KTX2 container; nothing is re-encoded — verified bit-identical to the original 512² mip with the Basis
  transcoder; geometry in the GLBs is copied byte for byte). 18.9 MB → 8.8 MB. The Low profile uses it; first-person
  weapons and arms always stay full resolution. The tier is fixed for a match, so an adaptive quality drop never
  re-downloads.
* **Shaders compiled before reveal** — `renderer.compileAsync` runs before the player is shown the match.
* **Server** — identification has a 9 s deadline with the profile and arena progress fetched in parallel, always
  answers `ready` (as a guest with a notice when the account service is slow or failing), and only sockets that never
  said hello are closed. Clients that report scene loading (`caps: ['loadgate']`) are held out of live combat until
  their scene is ready (capped at `loadWaitMs`, 20 s); older clients and raw test sockets keep the previous
  behaviour. A gated player who reconnects mid-match is held until loaded again.
* **Deployment screen** — the real stages with their times, files and megabytes actually received, the texture tier,
  retries, "taking longer than usual" guidance, Leave, Retry and diagnostics; a quiet "Applying graphics settings…"
  instead of the deployment screen when the view is rebuilt mid-match.

## 3. Audio

Before: every sound was a few lines of filtered white noise with **the same noise seed for every gun**, ±6 % pitch
as the only variation, one inverse-distance panner, no limiter, no voice limit, reverb applied equally to everything.

After (`src/arena/sound/`):

* **Designs** (`designs.ts`, original work rendered offline by `dsp.ts`): each of the eleven firearms has its own
  profile — action transient, muzzle report with its own resonance and a crack-to-boom bandwidth sweep, a short
  low-end punch, a supersonic crack only for supersonic rounds (not the .45 SMG or buckshot), a ground reflection; a
  stereo outdoor tail; a distant layer. Four variants per shot (round-robin, never the same twice). Reloads per
  mechanical family (magazine out/in, charging handle, pump, bolt, revolver cylinder, shell-by-shell), dry fire, draw,
  ADS; impacts per surface (concrete, brick, metal with occasional ricochet, wood, dirt, sand, foliage, flesh);
  flybys (supersonic snap / subsonic whiz); explosions near and far; flashbang; gear rattle; steel footsteps; slides,
  jumps and landings by fall speed. Footsteps on concrete, wood and soft ground use the campus' CC0 recordings.
* **Engine** (`engine.ts`): category buses (weapons, explosions, environment, footsteps, character, interface), each
  with its own volume *and* reverb send; a deafening filter (flashbangs), rumble filter, glue compressor and a
  brick-wall limiter before the game's master volume; pooled voices (20 on phones with stereo panning, 32 with HRTF
  elsewhere) with priority-based stealing, per-group caps, per-emitter retriggering (one shooter's automatic fire
  does not pile up) and de-duplication; distance curve, air absorption, the speed of sound for distant shots,
  occlusion and roofs from two ray casts in the collision world, indoor reverb.
* **Distance behaviour**: within 25 m the near layers; between 25 and 75 m they cross-fade to the distant layer
  (which fades in by 40 m and then only falls with distance); beyond 75 m only the distant layer.
* **Mobile**: band-limited layers are rendered at half the sample rate; the player's loadout is rendered ahead of
  play in idle slices, other players' weapons when first seen; nothing is scheduled while the context is suspended,
  and the next sound or touch resumes it.

Measured offline (`node scripts/qa/arena-sounds.mjs` → `docs/performance/arena-sounds.json`): every design peaks
at or below −1 dBFS with no invalid samples; spectral centroids order as they should (pistol ≈2.3 kHz, SMG ≈2.0,
assault rifle ≈1.6, DMR/LMG ≈1.0–1.1, shotguns and sniper 0.7–0.8 kHz); the minimum spectral distance between any
two weapons rose from 0.035 (the first draft — two weapons were nearly identical, caught by this check and fixed)
to 0.226; variants' waveform correlation ≤ 0.08.

Measured in Chromium (`node tests/browser-arena-audio.mjs` → `docs/arena-audio-results.json`, phone profile): see
the results table below.

## 4. Interface

* **Design system** — graphite surfaces, hairline edges, one amber accent for action and progress, team colours
  only where a team is meant, Manrope display type with tabular numbers, short purposeful motion that respects
  reduced-motion settings (`src/arena/arena.css`, "Premium arena design system").
* **Lobby** — operator card (emblem, level, experience), connection status, mode cards with each map's real
  tactical plan (`src/arena/MapPlan.tsx`, drawn from the collision boxes, spawns and Domination zones) and the key
  rules, map cards with plans, a loadout summary with weapon silhouettes, equipment and perks, Armory and HUD
  customization, collapsible controls and credits. Rankings, match history and emblems are under Rankings.
* **Weapon silhouettes** (`src/arena/WeaponGlyph.tsx`, original) in the lobby, loadout editor, Armory, kill feed,
  HUD weapon panel and results.
* **Deployment screen** — described above.
* **HUD** — silhouettes in the kill feed and on the weapon panel's name line, so no HUD element changes size: saved
  layouts, positions, scales, visibility and appearance are untouched (the HUD studio previews the same views).
* **Post-match** — outcome, final score, statistic tiles, best weapon (eliminations, accuracy, headshots),
  experience breakdown with the level bar filling from before to after, unlocks and save state; Play again goes
  through the deployment lifecycle.
* **Settings** — master volume plus six category faders (voice chat marked as not available), diagnostics.
* **Responsive** — checked at 1440×900, 1280×720, 1024×768, 844×390 (phone landscape) and 390×844 (phone
  portrait) with `scripts/qa/arena-ui-shots.mjs`: no horizontal page scroll on any screen. This found and fixed a
  real bug: on phones the floating "Campus" button covered the settings button and swallowed taps.

## 5. Mobile performance and memory

* Remote soldiers are skinned meshes with culling disabled (their bones move them outside their bounds), so every
  soldier was skinned and drawn even behind the camera. They are now culled per soldier against the view frustum
  (a wider sphere when sun shadows are drawn live), and distant soldiers are posed at a lower rate (every 2nd frame
  beyond 25 m, every 3rd beyond 50 m on Low) with the skipped time carried forward.
* Soldier posing and arm IK no longer allocate: ~12 `Vector3`/`Quaternion` objects per soldier per frame are now
  reused scratch objects, and grip anchors are looked up once per weapon instead of every frame.
* The phone texture tier quarters GPU texture memory for the environment, props and soldiers (512² instead of 1024²).
* **A real memory leak, found with heap snapshots** (`scripts/qa/arena-heap.mjs`): every match left its renderer,
  WebGL context and canvas reachable — between match 2 and match 8, +6 WebGL contexts, ~1,400 WebGL buffers, ~800
  textures, ~150 programs and +4 detached DOM nodes per match. Cause: three.js renderers register a `dispose`
  listener on every texture, geometry and material they upload, including three's own module-level placeholder
  textures, which every renderer shares and nobody disposes; cached arena assets were shared the same way. Fix:
  when a match's scene unmounts, the GPU side of everything it drew is released (cached objects stay usable and
  re-upload to the next match) and the `dispose` listeners registered during the match are removed
  (`src/arena/scene/gpuListeners.ts`). A second path kept the *last* match's renderer alive after leaving: a
  long-lived callback created inside the scene component (closures keep their whole context). After both fixes:
  no growth in contexts, buffers, textures or DOM nodes over 8 consecutive matches, and a second visit to the arena
  leaves exactly what the first did (ArrayBuffer data 110.5 MB → 110.5 MB; only the campus's own renderer remains).
* Match sounds stop when the match ends (previously gunfire tails and distant layers followed the player into the
  lobby: up to 5 voices measured).
* Leaving the arena cancels its downloads and releases its parsed models, textures, materials and rendered sounds
  (`releaseArena()`). The two character animation libraries (≈4.9 MB) stay in the campus's own cache because campus
  characters use the same files.

## 6. Results after the changes

### Deployment (`docs/performance/arena-deploy-after.json`, same harness as the baseline)

"Ready" is when the deployment screen clears; "playable" adds the harness's own check that the player moves when
pressing forward (≈1.3 s of measurement overhead in both columns).

| Scenario | Before: ready / playable | After: ready / playable | Downloaded before play |
|---|---|---|---|
| Normal (loopback), 5 runs | 18.5 s / p50 19.9 s, p95 20.5 s | **6.4 s / p50 7.7 s, p95 8.0 s** | 25.2 MB → ~13 MB (phone tier) |
| 4G (9 Mbit/s, 70 ms), 2 runs | 29.6 s / 31.6 s (bots invisible) | **11.1 s / 12.1–13.0 s** | 25.2 MB → 7.9–10.8 MB |
| 3G (1.6 Mbit/s, 300 ms) | 109.7 s / 111 s (bots invisible) | **51.4 s / 52.7 s** | 14.8 MB → 7.2 MB |
| An environment normal map fails | stuck (> 120 s) | 9.3 s / 10.8 s, flat normal used | — |
| An environment colour map fails | (stuck) | stops at 6.1 s with *"The training ground could not be downloaded. arena/mobile/textures/brick/color.ktx2: Failed to fetch"*; Retry → playable at 13.7 s | — |
| A decorative prop never answers | stuck (> 120 s) | 6.5 s / 7.8 s (the prop is skipped) | — |
| A soldier model never answers | 18.5 s / 19.8 s, that soldier invisible | 6.4 s / 7.6 s, stand-in drawn | — |
| Arena connection dropped while deploying | 18.6 s / 20.1 s | 6.4 s / 7.8 s | — |
| Three deployments in one page | 21.1 s, 9.3 s, 9.1 s | 8.1 s, 8.9 s, 9.8 s | cached |

Percentiles beyond p50 are from 5 runs (normal) and 2 runs (4G): p95/p99 equal the slowest run, not a population
statistic. Repeat deployments are dominated by per-match renderer work (shader compilation, texture upload,
environment build), which is very slow under software rendering; see limitations.

### Audio (`docs/arena-audio-results.json`, Chromium, phone profile — 9 / 9 checks)

| Check | Result |
|---|---|
| 3 s firefight: 12 shooters at 3–124 m (automatic rifles, SMGs, LMG, shotguns, sniper, pistols), the player's own automatic fire, casings, an explosion every 0.9 s, impacts | peak −2.2 dBFS, **0 clipped samples** with 97 % of the output inspected; ≤ 20 voices; 440 played, 308 culled, 50 stolen by priority |
| Cost per sound call | 0.52 ms including first-time rendering of 90 sounds; ≈0.1 ms once rendered |
| Distance (DMR, engine-set layer levels) | 4 m: near layer 1.12 in the open (0.56 in the recorded run, where a spawn-shelter wall was in between: occlusion halves it) → 45 m: near 0.04 + distant 0.375 → 130 m: distant only, 0.176 |
| Occlusion and roofs | engine agrees with an independent line-of-sight computation on 8 points; inside the warehouse = indoor |
| Weapons volume 0 / 1 (player's own shot, arena mix) | −81 dBFS / −1.7 dBFS |
| Suspended context | resumed in 0.46 s by the next sound or touch; nothing queued meanwhile |
| Game path | own near and tail layers on the weapons bus; magazine out then in; footsteps |

### Repeated matches (`docs/performance/arena-soak.json`, 5 Training matches in one page)

Window listeners 32 → 32, DOM nodes 1968 → 1968, voices left playing in the lobby 0 after every match, deployment
6.2–7.4 s each, re-entering the arena after leaving it 5.9 s. JS heap 29.4 → 31.0 MB over five matches (rendered
sounds for newly heard weapons and JIT-compiled code; no WebGL objects, see section 5), and 28.7 MB back on the
campus after leaving the arena.

### Interface

Screenshots in `docs/screenshots/arena/premium/` (lobby at five sizes; training, settings, deployment, HUD and
results on desktop and phone landscape); no horizontal page scroll on any of them. Existing HUD customisation is
unchanged and its browser suite passes (layouts saved, restored on another device, repaired when damaged, touch
layout honoured in the firing range, auto-fire).

### Test suites

| Suite | Result |
|---|---|
| `npm test` (all campus and arena suites) | **309 / 309 pass** (293 before; new: deployment 8, downloader 8) |
| `npm run typecheck`, `npm run build`, `npm run verify:release` | pass; no QA hooks in the production bundle; precache 2.48 MB, no arena files in it |
| `tests/browser-arena.mjs` (two signed-in players, full stack) | 12 / 12 |
| `tests/browser-arena-hud.mjs` | 9 / 9 |
| `tests/browser-arena-audio.mjs` | 9 / 9 |
| `tests/browser-arena-soak.mjs` | pass |

Arena code size (production, gzip): entry chunk 52.7 KB → 68.8 KB (the sound engine and designs replace a few
noise buffers; the designs are code, not downloads), scene chunk 24.7 → 26.6 KB, styles 9.4 → 13.3 KB.

## 7. Limitations

* **No GPU and no phones were available.** Every browser measurement here used SwiftShader on a 4-core container.
  Frame rates (1–5 fps here) say nothing about real devices; decode, shader compilation and upload times are much
  slower than on real hardware, so absolute deployment times on real devices will differ (network-bound parts,
  such as the 3G and 4G runs' download volume, transfer directly). The 30 fps phone and 60 fps desktop targets are
  **not verified**.
* Network conditions are emulated in Chromium, not measured on real mobile networks.
* Repeat deployments still create a new renderer per match (≈6–7 s here, mostly shader compilation and upload under
  software rendering). Keeping one renderer across matches is the next step.
* The weapon sounds are original synthesised designs judged by measurement (levels, spectra, distinctness,
  variation) and by structure; no licensed recordings were available to this build, and no listening test with
  players has been done. There is no suppressed-fire design because no weapon has a suppressor; there is no voice
  chat to mix.
* The phone tier lowers environment, prop and soldier textures only; first-person weapons stay at full resolution
  (the largest single critical file on phones: 2.4 MB for the Vanguard).
* Party information in the lobby, and parties queuing together, are not built (unchanged).
* Server-side deployment traces are kept in memory per process (`/admin/arena`), not exported to a metrics system.
