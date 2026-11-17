# Performance, network resilience and landscape implementation

This change implements a focused production improvement pass over the existing engine. It does **not** certify the fourteen-phase mandate or its physical-device acceptance targets as complete. No physical Android, iPhone, integrated-GPU laptop or dedicated-GPU laptop was available in this workspace. The production website has not been deployed by this change.

## Architecture and audit findings

The repository contains 233 source/shared/server files. The audit covered the source inventory and the main rendering, movement, input, networking, loading, cache, audio, world-detail and deployment paths. Existing working optimizations were retained.

| Area | Existing implementation | Finding / resulting change |
| --- | --- | --- |
| Engine | Vite 7, React 19, R3F 9, Three.js r183, Zustand | Keep the engine and continuous gameplay rendering. No added dependency. |
| Campus rendering | Material-merged architecture, instanced vegetation, static Low shadows, district-detail cache, distance-limited NPC loading, remote avatar LOD | Add Ultra; adapt optional AO, grass density and shadow refreshes without rebuilding the scene. |
| Arena rendering | Imperative fixed-rate simulation; pooled effects; frustum-tested soldiers; separate full-detail first-person pass | Automatic quality changes previously changed `settings.quality`, cleared `qualityChosen`, and rebuilt map/viewmodel/effects through dependencies on `q`. Replace that path with transient effect budgets. Reuse the per-frame visibility set. |
| Resolution | Existing DPR and maximum-dimension limits | Resize campus post-processing targets when DPR changes, and start adaptive trials from the capped, attainable density rather than an unreachable requested DPR. Preserve at least 0.85 requested pixels per CSS pixel during adaptation, subject to the hardware/pixel budget and a user's explicit lower render scale. Trial smaller resolution only after reducing effects; undo trials that do not improve FPS. |
| Context ownership | `ExclusiveCanvas` serializes complete renderer teardown, diagnoses context loss, rebuilds graphics | Preserve exclusive ownership. Add memory/profile-specific drawing-buffer budgets at initial sizing, adaptive resizing and viewport changes. |
| Assets | Local meshopt GLBs, Basis/KTX2 textures, shared caches, priority fetcher and two-slot decoder | Queued decodes did not observe cancellation. Late completed parses could repopulate invalidated Arena caches. Cancel queued work and dispose late unowned models/textures. Already-running native/worker parsers cannot be forcibly interrupted. |
| Campus movement | Existing negotiated sequenced input, authoritative shared collision, ack/replay; legacy room compatibility | Existing history was bounded only by 1,024 commands, which permitted minutes of speculation at low FPS. Add a four-second time bound. Remove tuple-array allocations from authority copies and full-history filtering from input batches. |
| Arena movement | 60 Hz predicted commands, 30 Hz sending, authoritative match simulation, ack/replay and remote interpolation | Previously dropped oldest unacknowledged commands after 240 entries. Keep the complete replay window and stop speculation at 120 pending commands. Resume on acknowledgement. |
| State ordering | Ack checks existed for one reconciliation branch | Reject complete duplicate/old snapshots before updating life, HUD, world or peers; reject old Arena lives; reset order on session/match changes. Advance outgoing sequence from authoritative reconnect acks. |
| Corrections | Small errors accumulated as camera offsets | Bound the combined offset to 0.75 m and reject offsets that cross cover or end inside geometry. Authoritative collision positions are never eased through walls. |
| Network recovery | Session replacement/rejoin, bounded messages, server interest/occlusion in Arena, reconnect backoff | Add 64 KiB browser-send backpressure, visible delayed campus connection state, live Arena quality grading during silence, and eight-second snapshot watchdogs. Retire a stalled handler without waiting for a blackholed close handshake. |
| Touch / orientation | Imperative joystick/look updates, safe-area Arena HUD, pointer capture | Add gesture-triggered landscape fullscreen/lock where supported, PWA manifest orientation, branded portrait fallback and input blocking in both modes. Clear held keys, button bits and pointer bookkeeping on rotation/blur. Keep controls and campus dock apart on small landscape screens. |
| Audio / caching / hosting | One campus mixer, bounded Arena voices/banks, optional audio loading; revisioned static caches; bounded service-worker caches; static frontend plus room server | Retain these paths. Do not cache multiplayer/account state or introduce workers/cascades/occlusion systems without measurements supporting them. |

The on-disk asset pack includes roughly 71 MiB Arena assets, 16 MiB campus characters, 12 MiB campus textures, 4.1 MiB props and smaller sky/audio/decoder packs. This is an inventory, **not** the initial download: Arena and optional assets already load separately.

## Runtime policy and limits

Both modes use three sustained slow samples before a budget reduction, cooldowns between changes, and fifteen sustained comfortable samples before restoring optional detail. Loading, hidden-tab gaps and deliberately throttled menus/portrait views are excluded. Network RTT and connection grade are never inputs to graphics adaptation. The saved Low/Medium/High/Ultra choice remains intact.

The first budget level disables optional AO and Arena street reflections. The second slows dynamic sun-shadow refreshes, removes Arena decorative dust, and gradually reduces campus grass instance count to 35%. Nearby assets, weapon models, reticles, CSS HUD/text, damage, hit tests, input rates and server authority retain their original behavior. Render-scale trials follow those changes and revert without an 8% FPS gain; another trial waits sixty samples. These are practical frame-time heuristics, not GPU timer or OS memory-pressure measurements.

Drawing buffers are limited to 1920×1080-equivalent pixels when reported device memory is at most 2 GiB; 2560×1440 for at most 4 GiB or Low/Medium; 3840×2160 otherwise. Hardware maximum texture/renderbuffer dimensions remain additional limits. Ordinary 844×390 landscape at 1.5 DPR fits even the smallest budget. These limits bound drawing buffers and associated full-screen targets, **not total GPU texture memory**.

During a sustained loss of authoritative updates, bounded prediction intentionally stops. Campus transitions to local exploration while reconnecting. Arena continues displaying/aiming but cannot confirm combat without the server. No unsafe action replay queue or offline competitive outcomes were added.

## Measurements and evidence

All new runtime browser evidence is Chromium 156.0.8078.79 on Linux with SwiftShader software WebGL. Touch, DPR and viewports are emulated. QA render scales are explicit in the JSON reports; they are excluded from production builds. Container CPU rasterization is not representative of a phone GPU.

| Evidence | Scope |
| --- | --- |
| [`mobile-performance-mandate-before.json`](mobile-performance-mandate-before.json) | Initial untouched-code baseline at 390×844, Low, QA DPR 0.2; entry/walking/interior samples, percentiles, main-thread time, JS heap and renderer counters. |
| [`performance/mandate-landscape-before.json`](performance/mandate-landscape-before.json) / [`after`](performance/mandate-landscape-after.json) | Landscape runs at 844×390, Low, QA DPR 0.2; full environment and raw sample metadata retained. These noisy software-rendering runs do not establish a game-wide FPS improvement; container background CPU activity and camera trajectories were not controlled. |
| [`performance/mandate-prediction-cpu.json`](performance/mandate-prediction-cpu.json) | Actual shared movement authority: 40,000 commands, 15 Hz snapshots, seven alternating runs after warm-up, identical final coordinates. Median 108.01 ms before / 45.31 ms after, about 58% lower elapsed time. Open collision callback; no network or GPU. This is a microbenchmark, not a frame-rate result. |
| [`performance/mandate-browser.json`](performance/mandate-browser.json) | QA production bundle: refused fullscreen fallback, portrait input block, rotate/resume, layout bounds, injected reordered snapshots, bounded silent-server prediction, recovery and same-match reconnect. |
| [`performance/renderer-lifecycle.json`](performance/renderer-lifecycle.json) | Existing renderer lifecycle suite, rerun for repeated campus/Arena transitions, four Arena quality profiles and intentional context loss/rebuild. Consult its checks and samples for the run outcome. |

Landscape entry measured 1.6 FPS / p95 1000 ms before and 2.0 FPS / p95 650 ms after; ready times were 41.4 s / 17.9 s. These are individual observations in the uncontrolled software environment, not an attributed speedup. The after run's six samples ranged from 1.2–2.0 FPS and approximately 181–200 MiB JS heap, with no captured page errors. Full percentile/long-frame data is retained in JSON.

The initial portrait baseline measured 2.2–2.6 FPS in the three entry/walking samples, p95 frame times 483–667 ms, and JS heap roughly 171–183 MiB. Those results demonstrate the container's unsuitable software rasterization speed, not support for 30 FPS. The landscape before/after JSON files retain p50/p95/p99/max, long frames, script/task costs, texture/geometry counts, heap and transferred resources without substituting averages for frame pacing.

## Validation

The unit/integration suite exercises authoritative movement, collision, delayed/bursty acknowledgements, forged/duplicate inputs, packet-loss/jitter simulation, server combat, twelve-player matches, reconnects, asset retries/cancellation, persistence and renderer ownership. New tests add time-based prediction bounds at 2 FPS, graphics-budget restoration/noise/CPU-bound behavior, snapshot ordering, wall-constrained visual correction, all four saved campus profiles, draw-buffer budgets, queued-decode aborts, and supported/refused/unsupported orientation API branches.

The browser orientation test injects fullscreen refusal. Supported API sequencing is tested with controlled API doubles. Neither proves Android hardware orientation locking, iOS behavior or notch geometry on a real device. Browser networking tests inject stale application messages and silence; WebSocket/TCP itself delivers ordered reliable messages. The existing match integration tests additionally simulate lost input batches, high latency and jitter.

Final recorded verification completed successfully (the logs were recovered after the execution connection was interrupted):

- `npm test`: 413 passed, 0 failed.
- `npm run build` and `npm run verify:release`: passed; production debug hooks are absent.
- QA production browser checks: nine passed, including post-processing target resizing, portrait/landscape input, stale snapshots, bounded prediction and same-match recovery.
- Renderer lifecycle: two campus/Arena transition cycles passed, all four Arena profiles retained the same context, both injected context-loss recoveries passed, and resource counts remained bounded after uploads settled. The initial early-sampling geometry-count assertion was resolved by waiting for separately compiled vegetation and stable GPU uploads before comparing visits; its resource-growth thresholds were retained.

This short transition test is not an extended soak or a physical-device certification.

Reproduce from the repository root:

```sh
npm test
npm run build
npm run verify:release
VITE_QA=1 npx vite build --outDir dist-qa
node tests/browser-performance-mandate.mjs
ROOT=dist-qa CYCLES=2 node tests/browser-renderer-lifecycle.mjs
PERF_LABEL=mandate-landscape-after PERF_SECONDS=4 PERF_QUERY='?qa-scale=0.2' \
  PERF_OUT=docs/performance/mandate-landscape-after.json node tests/browser-mobile-performance.mjs
BASELINE_ROOT=/path/to/untouched-checkout node scripts/qa/prediction-benchmark.mjs
```

The benchmark defaults to landscape; `PERF_WIDTH` / `PERF_HEIGHT` select other sizes. A portrait gameplay benchmark must account for the intentional input-blocking overlay.

## Device support / outstanding acceptance

| Device / browser | Validation status |
| --- | --- |
| Linux container, Chromium + SwiftShader | Automated functional, rendering lifecycle and emulated touch checks; raw software frame-time evidence. |
| Physical low/entry/mid/high Android phones | Untested; 30/60 FPS, thermal behavior, physical landscape lock and memory limits not certified. |
| Physical iPhones / Safari | Untested; fallback designed for unsupported lock/fullscreen. |
| Physical tablets / unusual notches / installed PWA | Untested; media queries, safe-area CSS and manifest implemented, hardware behavior unverified. |
| Low-end Windows / Intel integrated / dedicated GPU / high-DPI laptop | Untested in this workspace; existing observed-capability recommendation and new pixel budgets apply. |
| Browsers without WebGL 2 | Outside the existing Three.js engine's minimum requirements. |

Remaining work includes profiling on physical target hardware; extended multi-hour/thermal and low-memory sessions; real mobile network switching; total texture/render-target memory instrumentation; and assessing additional campus interior/region streaming only after target-device traces identify its benefit. Runtime adaptation currently uses FPS windows rather than a GPU timer or frame-variance controller. This pass preserves existing district streaming, avatar LOD, shared caches and server interest management rather than claiming new implementations of them.

Production build and local QA artifacts are generated in the workspace. No remote deployment, release publication or live configuration change was performed.


## Files changed

- `README.md`
- `docs/PERFORMANCE-MANDATE.md`
- `docs/mobile-performance-mandate-before.json`
- `docs/performance/mandate-browser.json`
- `docs/performance/mandate-landscape-after.json`
- `docs/performance/mandate-landscape-before.json`
- `docs/performance/mandate-prediction-cpu.json`
- `docs/performance/renderer-lifecycle.json`
- `docs/release/artifacts.json`
- `docs/screenshots/performance/mandate-orientation.png`
- `docs/screenshots/performance/mobile-mandate-before.png`
- `docs/screenshots/performance/mobile-mandate-landscape-after.png`
- `scripts/qa/prediction-benchmark.mjs`
- `shared/arena/performance.mjs`
- `shared/prediction.mjs`
- `src/App.tsx`
- `src/arena/Scene.tsx`
- `src/arena/Touch.tsx`
- `src/arena/input.ts`
- `src/arena/net.ts`
- `src/arena/reconciliation.mjs`
- `src/arena/scene/world.ts`
- `src/arena/store.ts`
- `src/game/Player.tsx`
- `src/graphics/ExclusiveCanvas.tsx`
- `src/graphics/ownership.ts`
- `src/mobile/Orientation.tsx`
- `src/mobile/orientation.ts`
- `src/network/client.ts`
- `src/network/flow.mjs`
- `src/npc/Npcs.tsx`
- `src/preferences.mjs`
- `src/state.ts`
- `src/styles.css`
- `src/ui/Panels.tsx`
- `src/ui/TouchControls.tsx`
- `src/world/PostFX.tsx`
- `src/world/Sky.tsx`
- `src/world/Vegetation.tsx`
- `src/world/World.tsx`
- `src/world/assets.ts`
- `src/world/decodeQueue.ts`
- `src/world/fetcher.ts`
- `src/world/quality.ts`
- `src/world/rendering.ts`
- `tests/browser-mobile-performance.mjs`
- `tests/browser-performance-mandate.mjs`
- `tests/browser-renderer-lifecycle.mjs`
- `tests/browser-soak.mjs`
- `tests/decode-queue.test.mjs`
- `tests/orientation.test.mjs`
- `tests/performance-budget.test.mjs`
- `tests/prediction.test.mjs`
- `tests/preferences.test.mjs`
- `tests/reconciliation.test.mjs`
- `tests/renderer-ownership.test.mjs`
- `vite.config.ts`
