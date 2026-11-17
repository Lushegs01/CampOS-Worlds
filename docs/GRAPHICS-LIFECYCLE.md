# Exclusive campus / Arena graphics

## Evidence and limits

The pre-change Chromium/SwiftShader audit entered campus, opened Arena and deployed Training. Both
`__campusGL.getContext().isContextLost()` and `__arenaGL.getContext().isContextLost()` were false.
Campus reported 144 geometries / 76 textures; Arena 45 / 74. There were three DOM canvases, including
2D artwork: counting all canvas elements is not a reliable WebGL-context measurement.

Deliberately losing **Arena** through `WEBGL_lose_context` left campus healthy, panel `arena`, and
phase `match`, without graphics recovery. Previously only campus listened for loss and opened the
campus recovery panel. This confirms concurrent contexts and missing Arena recovery, **not** the
identity or cause of a spontaneous loss on the reported laptop. That still requires a trace on that
machine. No physical Intel/AMD/NVIDIA, hybrid GPU, battery/AC or high-DPI hardware was available here.

## Ownership and teardown

`App` unmounts campus throughout Arena (including its lobby/results). Account, profile, discoveries,
keepsakes, settings, social/party state, room connection and session stores remain outside Canvas.
Player coordinates/rotation and input orbit already live in module state; camera orbit/zoom now do too.
Player teardown clears held controls and sends a stationary room input. Scene objects are reconstructed
from deterministic campus data and existing CPU asset caches, without serializing scenes to storage.

Both 3D canvases use `graphics/ExclusiveCanvas`. Its async renderer factory takes a shared lease **before**
constructing WebGLRenderer. The installed R3F 9.8.1 flushes child cleanup, disposes the scene, calls renderer
`dispose`, then `forceContextLoss`. Only that final call, with `isContextLost()` confirmed, releases the
lease. Rapid navigation and pending factories queue through the same lease. An unconfirmed release
blocks future creation with an explicit error. No guessed timeout or animation-frame delay opens the gate.

R3F continues to own the factory renderer and dispose scene resources. The shared dispose-listener
tracker releases retained renderer callbacks (including Three's shared placeholder textures) after
teardown. Removed listeners leave the tracker immediately, avoiding accumulation on quality changes.
Source textures/geometry retain their CPU data and can upload into the next context. Campus and Arena
PMREM targets now retain their render-target owner for complete framebuffer disposal. Arena shadow
maps, world geometry, skeletons, instances, post buffers, reflections and match resources follow their
existing cleanup paths. Debug renderer/composer/camera references are removed on teardown.

## Quality and recovery

Arena no longer keys Canvas by quality. Native antialiasing is fixed on; post profiles retain their own
SMAA. DPR, shadow/profile settings, AO, post-processing, reflection budgets and scene detail update in
place. Texture tier remains fixed per match; ordinary quality changes do not restart asset acquisition.
Library PMREM resources live for the renderer, independently of quality-dependent world rebuilding.

Three r183 shader polling can read a disposed material's missing `currentProgram`, throwing outside
its promise. `graphics/compile` bounds polling to renderer lifetime, removes disposed materials, cancels
pending polls on teardown and reports compilation failures through the promise/diagnostics.

Both owners listen for creation errors, loss and restoration. An unexpected loss unmounts its Canvas,
stops local input and presents an owner-specific rebuild action. Rebuild takes the same exclusive lease
and recreates shader gates, environment maps and post targets; it never trusts old GPU contents.
Arena's network/account/result lifecycle remains independent. If a restoration event arrives before
retirement, it also triggers reconstruction. Intentional retirement is recorded separately from failure.

The bounded diagnostic ring includes owner/renderer ID, active owner, scene, profile, device DPR,
effective renderer DPR, drawing buffer, elapsed initialization time, texture/geometry/program counts,
compile start/end/error, shader logs and context events. Creation records WebGL version, exposed GPU
vendor/renderer, max texture/renderbuffer sizes and samples. QA builds expose `window.__graphics()`;
errors are also logged with `[graphics]`. The latest unexpected context-loss record is retained separately
from the ring so shader activity cannot erase attribution before recovery is inspected. WebGL does not expose reliable total texture-memory bytes.
Automatic Arena quality selection reuses this CPU-only capability snapshot; its previous hidden
WebGL probe canvas has been removed. Power preference is browser-default, allowing integrated/hybrid GPU policy. Drawing buffers are capped
at 8,294,400 pixels and hardware limits; existing profile/adaptive settings still operate below the cap.

## Reproducible validation

- `npm test`: automated suite, including lease ordering, release failure, pixel limits and shader races.
- `VITE_QA=1 npm run build && node tests/browser-renderer-lifecycle.mjs`: shipped static bundle with real
  room server; independently counts WebGL contexts, repeated navigation, four quality profiles, state
  retention and injected context loss/rebuild in each environment. Report:
  `docs/performance/renderer-lifecycle.json`. `CYCLES` defaults to three.
- `node tests/browser-arena.mjs`: existing signed-in two-player account/loadout/match/results/database
  validation plus phone Training. The return step now waits for the recreated campus inspection hook.

On real laptops, repeat campus → lobby → multiplayer match → results → campus → Arena for Low,
Medium, High and Ultra, on AC/battery, at native/high DPI, with Intel, AMD, NVIDIA and hybrid graphics
where available. Save diagnostics at each stage and any spontaneous failure, drawing buffers, frame
pacing and recovery result. Software-WebGL results cannot establish driver reliability on those devices.

## Recorded results (2026-11-17)

- `npm run build` and `VITE_QA=1 npm run build`: **passed**.
- `npm test`: **398 passed, 0 failed** (including eight renderer/device/compilation/deployment regressions).
- `node tests/browser-arena.mjs`: **12 checks passed**. Two signed-in browsers completed Team Deathmatch;
  eliminations, victory/defeat, XP and weapon statistics were saved. Return preserved account identity,
  position, appearance and discoveries, and walking worked. Phone Training fired and moved through touch
  controls. Current result: [arena-results.json](arena-results.json).
- QA production bundle, `CYCLES=3 node tests/browser-renderer-lifecycle.mjs`: **8 checks passed**.
  Independent context instrumentation observed a maximum of **one** live WebGL context; lobbies had zero.
  Low/Medium/High/Ultra reused one renderer. Both injected losses rebuilt into rendered scenes; Arena kept
  its match and campus kept position/discoveries. The final two campus returns had 174/171 geometries and
  84/82 textures; after recovery, 172/82. Streaming detail makes the initial loading sample unsuitable as
  a steady-state memory baseline. Full trace: [renderer-lifecycle.json](performance/renderer-lifecycle.json).

These are software-WebGL results. Physical laptop validation and attribution of the originally reported
spontaneous failure remain outstanding; no physical GPU devices were exposed in this workspace.
