# WebGL allocation during campus / Arena transitions

A reported failure occurs when entering an Arena game after campus renders normally. That confirms WebGL is available at least for the campus; the affected device's precise driver/allocation failure remains unconfirmed. The production domain could not be inspected from this environment (network proxy returned 403), so this change does not assert which bundle is deployed.

The shared renderer previously delegated context creation to Three with antialiasing enabled. There was no lower-memory allocation fallback. Three also performs a second context request to diagnose an attribute failure; if that request succeeds, it throws without returning a renderer, leaving application cleanup without access to the native context.

`src/graphics/context.ts` now owns native WebGL2 acquisition on the actual canvas. The initial allocation is 1×1 until the existing viewport budget applies. If the first allocation returns null or throws, one attempt follows after 150 ms, with antialiasing, stencil and preserved drawing buffers disabled. The delay allows asynchronous driver reclamation following the previous renderer's confirmed loss. There is no loop, hidden probe, WebGL1 fallback or second live renderer. A successful initial allocation retains the requested quality.

The native context is passed into Three explicitly, so a constructor failure can release it even when no renderer object was returned. An unconfirmed release still blocks subsequent owners. Leaving or superseding an attempt during the delay cancels allocation. Full browser denial remains an actionable error; readiness still requires resources and a successfully rendered frame.

Validation includes unit coverage of successful acquisition, reduced-memory fallback, total denial, cancellation, and native cleanup. The real-browser recovery regression injects Arena-only MSAA rejection while campus uses its normal context, then checks first-frame readiness, native restoration, manual retries, full denial, constructor failure, movement and rapid scene exit. Every sampled transition requires at most one live context. See `graphics-context-allocation.json` for the recorded run.

These controlled Chromium/SwiftShader checks establish fallback and lifecycle behavior. They cannot prove that the user's Windows GPU will accept the fallback or identify its original driver failure. No deployment is performed by this change.

## Recorded validation

- `npm run build` and `npm run verify:release`: passed; production QA hooks remain absent.
- Focused context/lifecycle/compilation/ownership unit tests: 15 passed.
- `tests/browser-graphics-recovery.mjs`: all 8 checks passed, no uncaught browser errors.
- Full unit run: 413/421 passed initially. An account message timed out while the build was running; a competition database startup stalled and was interrupted. Re-running both files sequentially after browser work completed passed all 14 tests, covering all 8 initial failures. This is a passing isolated rerun, not a claim that the initial full run was green.
