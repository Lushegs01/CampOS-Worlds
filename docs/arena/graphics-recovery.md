# Arena graphics recovery

Source audit: checkout `d5badcb` did not contain either “Arena graphics were interrupted.” or “Rebuild arena graphics”, and had no Arena `webglcontextlost`/`webglcontextrestored` listeners. The screenshot's exact production overlay therefore cannot be traced to a component in that revision. The campus has a separate context-loss panel in `src/world/World.tsx` / `src/ui/Panels.tsx`; it does not establish Arena renderer health. Production asset inspection was unavailable from the execution environment (HTTP proxy returned 403).

The concrete readiness defects in this checkout were in `src/arena/Scene.tsx`: shader compilation used `.catch(() => null).then(setCompiled)`, treating failure as success; the simulation callback set `sceneReady` / `sceneLoaded(true)` before the render callback ran. Context loss never cleared those flags, and restoration never rebuilt the Arena's baked lighting and postprocessing. Deployment state and gameplay could consequently report success without a healthy renderer. The old `SceneBoundary` also reported every scene error as a code download failure.

The new graphics owner uses INITIALIZING, READY, CONTEXT_LOST, RECOVERING, RECOVERY_FAILED and DISPOSED with validated transitions and generation IDs. Asset downloads retain their existing deployment errors; shader and rendering failures become graphics failures. READY requires essential environment/weapon loading, shader compilation, and a completed scene/postprocessing render with a live context and no WebGL error. QA's no-render mode also validates its first frame.

Context loss prevents default restoration cancellation, clears readiness and held input, releases pointer lock, and suspends simulation input and rendering. The lost World is unmounted while its context is still lost, before deleting stale GL handles can contaminate the restored context. A small driver retains context listeners. Restoration retires the old resource generation, invalidates the renderer-keyed library cache (including baked environment textures), and reconstructs World resources on the same renderer/context. Manual rebuild accepts one attempt, invalidates the old callbacks immediately, disposes/loses the failed context, and remounts Canvas. Neither operation reconnects the socket nor resets the player, match, loadout or statistics. Success unmounts the recovery dialog and reattaches desktop/touch controls. The graphics error boundary supports renderer creation/resource exceptions separately from code-download errors.

Validation:

- `npm run build`
- `npm test`
- `VITE_QA=1 npx vite build --outDir dist-qa`
- `node tests/browser-arena-graphics-recovery.mjs`

The pure lifecycle tests cover transition validation, stale completion/error events, duplicate retries, error clearing, disposal, and repeated entry/exit generations. The browser suite uses Chromium software WebGL and WEBGL_lose_context against a local production build/room server. It checks startup from campus, automatic restoration on the same context, keyboard movement and touch controls after recovery, a deliberately broken restoration render, manual rebuild and duplicate clicks, stale old-canvas events, match preservation, and exit/re-entry. Software WebGL does not establish behavior on every physical GPU/browser.

Files changed:

- `src/arena/Scene.tsx`: lifecycle driver, health validation, recovery dialog, renderer error boundary and resource teardown order.
- `src/arena/scene/graphicsLifecycle.mjs`: validated transitions and generation rejection.
- `src/arena/scene/library.ts`: invalidate renderer-specific baked lighting on restoration.
- `src/arena/ArenaApp.tsx`: mount touch controls and play hint only while graphics are ready.
- `src/arena/input.ts`: readiness checks and pointer-lock bookkeeping.
- `src/arena/arena.css`: keep recovery actionable above other Arena sheets.
- `src/arena/net.ts`: expose readiness in the existing QA-only inspection API.
- `tests/arena-graphics-recovery.test.mjs`: lifecycle regression tests.
- `tests/browser-arena-graphics-recovery.mjs`: controlled WebGL loss/restoration and gameplay tests.
- `docs/arena/graphics-recovery.md`: findings, scope and reproduction commands.

Verified locally: production build passed; all 393 automated tests passed; the Chromium recovery suite passed, including keyboard/touch interaction, failed restoration with a real resource-render exception, duplicate retries, old canvas events, preserved match identity, exit/re-entry and rapid exits during initialization. The injected failure and canceled downloads deliberately produce console diagnostics. No production deployment was performed.
