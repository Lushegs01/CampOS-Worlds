# Arena graphics recovery lifecycle

## Root cause and reproduction

The recovery message came from `ExclusiveCanvas`'s local `failure` string. A `webglcontextcreationerror` or `webglcontextlost` callback latched that string without checking whether it belonged to the current renderer or whether renderer construction ultimately returned a healthy context. Successful construction and successful rendering did not clear it. Its only clear paths were the button and a context-restored callback.

Setting the string also removed the Canvas, taking its native restoration listener with it. Manual rebuild cleared the string **before** asynchronous renderer acquisition, resource preparation or rendering had succeeded. Separately, Arena's priority −1 update marked `sceneReady` and sent `loaded` before the priority +1 render pass; shader compilation errors/timeouts were swallowed. Deployment/gameplay readiness could therefore advance independently of the interruption screen and actual renderer health.

The browser regression injects an earlier creation-attempt notice while `getContext` returns a valid WebGL context. The pre-fix QA build reproduces the stale screen and fails the assertion that a usable constructor result cannot retain an interruption overlay. Evidence: [before JSON](graphics-recovery-before.json) and [screenshot](../screenshots/reliability/graphics-recovery-before.png). This identifies a reproducible lifecycle defect; the screenshot alone cannot identify the original Windows device's reason for emitting a graphics event.

## State and readiness

`src/graphics/lifecycle.ts` owns each canvas instance's immutable snapshot. UI, rendering permission and readiness notifications derive from it. Every operation carries a generation and, once attached, a renderer ID.

| State | Meaning / transitions |
| --- | --- |
| `INITIALIZING` | Renderer/resources are being prepared; mounting or downloading cannot make it READY. |
| `READY` | The current owner has a usable context, essential world/weapon shaders and resources, and a successful complete render pass with no WebGL error. The recovery overlay is absent from the component tree. |
| `CONTEXT_LOST` | Native loss is confirmed on the current renderer. Rendering and gameplay input stop; the lost canvas stays mounted to receive native restoration. |
| `RECOVERING` | Native restoration or manual retry starts exactly one newer generation. Old callbacks immediately become invalid; normal R3F teardown and the existing renderer lease release the previous context before allocating another. The overlay communicates progress and disables duplicate rebuilds. |
| `RECOVERY_FAILED` | Creation, shader preparation or rendering genuinely failed. The message remains actionable until a validated retry; the page is not reloaded. |
| `DISPOSED` | Final removal synchronously invalidates all callbacks and observers. It cannot reopen a recovery screen. |

`src/graphics/session.tsx` checks the active renderer's ownership, generation and live context before accepting resource/frame evidence. A health check brackets only a prepared validation frame, avoiding per-frame GPU error polling in normal gameplay. Prior optional/probe errors are drained before that pass so an obsolete GL error cannot falsely label a successful draw as a new graphics failure. Shader errors and render exceptions cannot be converted into readiness. Starting weapon shaders are prepared before the server spawns a load-gated player.

`ExclusiveCanvas` keeps a lost context's event listeners until restoration or explicit replacement. It treats an early creation notice as diagnostic information and uses the constructor's actual result to decide success/failure. Restoration recreates renderer-dependent resources rather than assuming Three.js's restored context alone proves the scene works. A local boundary handles failed renderer initialization without tearing down the Arena session.

The Arena `sceneReady`/`loaded` signal is emitted by the lifecycle's successful-frame transition. Input stays paused while that signal is false, held controls are released on interruption, and pointer lock is released so recovery controls can be clicked. A deliberate Return to campus remains available during recovery. Campus uses the same renderer contract so transitions retain one ownership mechanism; its welcome gate now also waits for a rendered, compiled critical scene.

No overlay timeout, unconditional readiness reset, invisible input-blocking element, forced reload, concurrent additional renderer or multiplayer/session reset is used to recover.

## Regression checks

`tests/graphics-lifecycle.test.mjs` tests the state transitions, resource-plus-frame readiness, generation/renderer guards, duplicate retry rejection, honest failed states and callbacks after disposal.

`tests/browser-graphics-recovery.mjs` runs against a QA production build and covers:

- Normal campus-to-Arena startup with an obsolete creation notice and a healthy context.
- Actual `WEBGL_lose_context` loss, a persistent genuine loss screen and automatic native restoration.
- Manual rebuild, six immediate retry clicks, and captured retired application callbacks.
- A failed draw and successful recovery.
- Failed automatic restoration (the new constructor is deliberately refused) and an actionable manual retry.
- Keyboard and touch movement after recovery, preserving match, player and team.
- Exit during recovery, return to campus and Arena re-entry without orphaned contexts/overlays.
- An independent count asserting at most one live context throughout.

The transition memory comparison keeps a fixed warmed baseline and the existing +32 geometry/texture limits. It now waits for pending source assets, avatar texture uploads and shader compilation at a fixed authoritative player position/view; a brief gap in GPU counter changes alone is not treated as completed loading.

The repeated-transition fixture uses the empty Training firing range so a bot match cannot end and replace pause controls during slow software-rendered captures. Keyboard and touch recovery are exercised through actual input events in the dedicated regression.

The callback replay captures the application's first registered handler for each canvas/event. It does not manufacture a native Three.js restoration on a still-lost, disposed context. Native restoration is tested separately with the browser's extension.

### Recorded results

- Full unit/integration suite: **416 passed, 0 failed** when run without simultaneous software-GPU load. The compilation/ownership/lifecycle tests also pass with the pending-work diagnostics.
- TypeScript, production build and release artifact checks: **passed**, with production debug hooks absent.
- Dedicated browser regression: **7 checks passed**, no uncaught errors, at most one live context. [After evidence](graphics-recovery.json), [recovered Arena screenshot](../screenshots/reliability/graphics-recovery.png).
- Broad lifecycle regression: **2 campus/Arena cycles passed**, all four Arena profiles retain their renderer, Arena and campus injected losses recover, state survives transitions, no READY renderer has a recovery overlay, and warmed resource counts remain within the existing limits. [Transition evidence](graphics-recovery-transitions.json).
- The pre-fix regression **fails as expected** on the stale-overlay assertion; it is retained separately as before evidence, not a failure of the fixed build.

Run:

```sh
node --test tests/graphics-lifecycle.test.mjs tests/renderer-ownership.test.mjs tests/renderer-compilation.test.mjs
npm test
npm run build
npm run verify:release
VITE_QA=1 npx vite build --outDir dist-recovery-qa
node tests/browser-graphics-recovery.mjs
ROOT=dist-recovery-qa CYCLES=2 REPORT=docs/reliability/graphics-recovery-transitions.json node tests/browser-renderer-lifecycle.mjs
```

Browser evidence is Linux Chromium/SwiftShader with emulated touch, not physical Windows/Android/iOS validation. Controlled failures are injected only by the browser test. The production application has no failure-injection hooks. No live deployment is performed by these changes.

## Changed files

- `src/graphics/lifecycle.ts`: validated state transitions and stale-attempt rejection.
- `src/graphics/session.tsx`: owner/context checks and successful-frame proof.
- `src/graphics/ExclusiveCanvas.tsx`: attempt-scoped factories/listeners, restoration/retry UI and local error handling.
- `src/graphics/compile.ts`, `src/world/assets.ts`, `src/avatar/Avatar.tsx`: read-only pending-work diagnostics for consistent transition validation.
- `src/arena/Scene.tsx`: essential shader preparation, complete-frame proof, readiness/input/recovery integration.
- `src/arena/store.ts`: pause input while graphics readiness is false.
- `src/world/World.tsx`, `src/game/Player.tsx`: preserve the shared campus renderer/readiness and input contract.
- `tests/graphics-lifecycle.test.mjs`, `tests/browser-graphics-recovery.mjs`, `tests/browser-renderer-lifecycle.mjs`, `tests/renderer-compilation.test.mjs`: behavioral regressions and validation of absent recovery overlays after transitions.
- `tests/support/graphics-evidence.mjs`: compact lifecycle evidence while keeping per-sample GPU counters and errors.
- `.gitignore`: exclude the dedicated generated QA build.
- This report and the before/after browser evidence under `docs/reliability` and `docs/screenshots/reliability`.
