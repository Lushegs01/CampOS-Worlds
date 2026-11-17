# Arena shader recovery on Windows D3D11

The supplied console output identifies a Windows ANGLE/D3D11 compiler failure: `Error compiling dynamic pixel executable` (`HRESULT 0x80004005`), followed by invalid-program operations and context loss. The screenshot reports shader compilation failure. This is evidence of a shader/driver failure after native context creation; the previous context-allocation fallback alone does not address it. The precise shader and affected GPU/driver are not established by the collapsed `[graphics] Object` entries. The later Arena connection failure may follow the lengthy graphics stall; it does not establish that networking caused the shader failure.

## Change

Initial Arena creation now honors each profile’s antialias setting instead of always forcing MSAA, including profiles already using post-process antialiasing.

Arena's next manual or native-restoration rebuild uses compatibility graphics for the rest of the current page session, including later Arena entries. Saved quality preferences are preserved; reloading the page retries the chosen profile. Campus and successful initial Arena sessions keep their normal pipeline.

Compatibility disables MSAA, shadow maps, post-processing, planar reflections, procedural sky rendering, custom tone grading and fog (so the height-fog shader branch is not compiled). It uses a capped Low-derived render profile, retaining the match's chosen texture tier. During compile/draw only, PBR materials are replaced with cached built-in Lambert materials. Geometry, base textures, cutouts, side selection, depth behavior and animated colors/opacity remain; shared source materials are restored even if a pass throws. The replacement materials are disposed with the renderer. World and weapon draws use the same policy.

Compilation now checks successful linking after completion: a completed compiler job can still be invalid. Three's shader-error callback stops the current pass rather than continuing to issue commands with the rejected program. These errors suspend readiness and input; recovery still requires compilation and a completed first frame. First shader errors capture bounded shader sources in the existing diagnostic buffer. The recovery screen offers **Save graphics report**, which downloads local JSON with GPU capabilities, browser details and bounded events; nothing is uploaded.

## Validation and limits

Unit tests cover completed-but-failed shader links, cached simpler materials, transparency/cutouts, animated material state, cleanup and restoration after thrown compile/draw calls. The real-browser regression deliberately compiles an invalid fragment shader during Arena startup, checks failed readiness and downloadable diagnostics, then checks that rebuilding reaches READY with Lambert programs, shadows off and antialiasing off. It also retains native loss/restoration, repeat-click, draw failure, full allocation denial, constructor cleanup, input and exit/re-entry checks. Context counts are independently measured and must never exceed one live context.

These are controlled Chromium/SwiftShader tests, not reproduction on the affected Windows D3D11 GPU. They establish error containment and a materially simpler recovery path; they cannot guarantee that a broken driver will accept every shader. If compatibility also fails, the saved graphics report is needed to identify the exact program/GPU. No deployment is performed by this change.

Recorded checks: all 424 unit tests passed; production TypeScript/Vite build and release artifact checks passed with QA hooks absent. The controlled browser run is recorded in `arena-shader-compatibility.json`, with a low-resolution software-rendered screenshot in `../screenshots/reliability/arena-shader-compatibility.png`; the screenshot is not a device performance or image-quality benchmark.
