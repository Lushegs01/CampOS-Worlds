# Open-world visual transformation: audit and Phase 1 (environment foundation)

Scope: the campus and Metropolitan City renderer (`src/world/`, `src/city/`). The Combat Arena has its own renderer
(`src/arena/scene/`, see [PHOTOREALISM.md](PHOTOREALISM.md)) and was not changed.

**Summary.** This pass delivered the *visual foundation* the brief asks for first: a deterministic, shared time of
day and weather system, a sky, lighting and reflection pipeline that follows it, wet surfaces, rain, night lighting
and a material layer used by every architectural surface. It also fixed the one failing test. The hero environment slice
followed as Phase 2: see [HERO_SLICE_COMMERCIAL_DISTRICT.md](HERO_SLICE_COMMERCIAL_DISTRICT.md). Nothing
here has been measured on a real GPU or a physical device. See §6 for what remains.

## 1. Starting point

* Branch `lushegs/blissful-ramanujan-7pds8m` from `e7a49f7` (merged PR #58), clean tree.
* `npm test` baseline: **455 passed, 1 failed** (`trees never stand on a road, junction, car park or driveway`:
  two Downtown planter trees at (192.02, 1710.58) and (291.44, 1692.23) stood on junction corner flares).
  Fixed in `c523919` (`shared/metro.mjs` skips planters on a junction pad; 42 → 40 planters).
* **The six gameplay screenshots referenced in the brief were not attached to this session.** The defect report
  below is based on in-game captures taken here from the untouched code
  (`docs/screenshots/world-visual/before/`, High profile, five views) and on reading the code.

## 2. Audit

### Renderer inventory

| Area | What exists |
|---|---|
| Engine | three.js r183 via R3F 9, WebGL2. `World.tsx` owns the frame loop; `ExclusiveCanvas` owns context lifecycle. |
| Profiles | Low / Medium (“Balanced”) / High / Ultra (`src/world/quality.ts`), adaptive budget (`campusBudget`) and resolution trials. Unchanged. |
| Post stack | High/Ultra only: N8AO, AgX tone mapping, SMAA. Low/Medium: renderer AgX, MSAA. |
| Lighting (before) | A photographic HDR sky (Poly Haven Kloofendal, CC0) on a dome, its prefiltered HDR as IBL, one directional sun fixed at the photo's sun position, a fixed fog. “Golden hour, all day.” |
| Materials | Poly Haven CC0 PBR scans (KTX2/Basis, 20 sets), a world-space weathering layer (grime, streaks, macro tone) on walls. |
| Architecture | Procedural kit (`architecture/kit.ts`): merged per-material geometry, window reveals, roof plant, signage; Metro detail streamed per 160 m cell with a box-shell LOD. |
| Vehicles | City traffic: instanced procedural bodies (one shader, per-car paint and lamps). Player fleet: procedural multi-part models (`vehicleModels.ts`). |
| People | City: four instanced vertex-animated meshes. Players/NPCs: skinned Rocketbox-derived avatars. |
| Vegetation | Card/frond trees with vertex wind, GPU grass ring, hedges. |

### Visual defect report (from the baseline captures)

| # | Category | Defect |
|---|---|---|
| 1 | Lighting deficiency | One fixed golden-hour sun and sky everywhere; no day, night or weather. City “night” existed only as a traffic density curve. |
| 2 | Rendering limitation | **City shadows mostly missing**: the shadow frustum was fitted with the light anchored near the campus origin, so for city regions (~1.7 km away) its depth range was degenerate. Measured: the shadow pass drew 26 calls in the Commercial District against 142 in the main pass. |
| 3 | Incorrect material response | Every window the same dark mirror (“unnatural black windows”); no interiors, blinds or variation. |
| 4 | Missing visual detail | Asphalt one repeated scan: no patches, cracks, stains; long roads read as one texture. |
| 5 | Poor asset geometry | Facades are extruded boxes with uniform window grids; street furniture, signal poles and props are primitive boxes and cylinders; pedestrians are low-detail instanced figures. |
| 6 | Environmental composition | Wide empty sidewalks and plazas, little clutter, uniform building heights per block; sparse greenery downtown. |
| 7 | Performance-related reductions | Box-shell far LOD visible while detail streams (slow on weak devices); Low has no normal/ARM maps (deliberate). |

Items 1–4 are addressed in this pass. Items 5–7 need modelled assets (§6).

## 3. What was built (Phase 1)

### Shared, deterministic environment — `shared/environment.mjs`
* One in-game day = 48 real minutes, anchored to UTC. Weather per 24-minute slot from a seeded Markov chain
  (clear, overcast, light rain, heavy rain, storm, fog; rain builds through overcast, storms subside through heavy
  rain), blended over 3 minutes. Every client computes the same sky with **no network traffic** and no change to
  the room's simulation, movement, collision, missions or hit registration.
* Sun position for ~6.5° N near equinox; moon; night factor; presets (sunrise … night); setting sanitisers.
* `tests/environment.test.mjs` (6 tests): purity, day length, weather distribution and transitions, smooth
  blending, sun path, setting overrides.

### Environment controller — `src/world/environment.ts`
Per-frame state (sun/moon, key light colour and intensity, sky colours, hemisphere fill, fog, exposure, bloom,
lamp level, wetness that lags the rain: ~40 s to soak, ~160 s to dry) and one set of shared uniforms.

**Material layer** (`environmentLayer`), chained onto existing materials (no new materials or draw calls):
* Wet: porous surfaces darken and gloss in proportion to porosity; vertical faces wet in uneven runs.
* Puddles on flat paving and asphalt, with rain-ring ripples while it rains.
* Asphalt wear: patch repairs with tar-sealed seams, crack networks in worn zones, oil stains, large-scale tone.
* Glazing: per-room blinds (height, fabric tone, slats), varied glass smoothness, interior depth by day; a seeded
  share of rooms lit warm or cool at night; shopfronts lit at night.
* Applied to the shared library (`materials.ts`), the terrain (`Ground.tsx`) and city traffic (`vehicleKit.ts`).
* Pitfall fixed during implementation: three.js's default program cache key is the `onBeforeCompile` source, which a
  wrapper makes identical across materials; the previous key is captured eagerly so programs are never shared wrongly.

### Sky, light, probe — `src/world/Sky.tsx`
* Analytic sky: elevation-anchored gradient, Mie glow, HDR sun disc, parallax cloud deck lit from the sun side,
  overcast dome, stars and moon, lightning. Cloud octaves follow the profile.
* Reflection probe: the same sky (no disc) rendered into a cube and prefiltered (PMREM) only after a perceptible
  change, at most every 1.5 s (High) / 3 s (Medium) / 8 s (Low); 256/128/64 px faces.
* Key light switches sun → moon; hemisphere fill for night and overcast; weather fog; exposure adapts
  (applied by the post stack on High/Ultra, by the renderer elsewhere).
* Shadow frustum fitted around the region it covers (fixes defect 2); refits and, for Low's static map,
  re-renders only after the sun has turned ~0.6°. City shadow radius 52 m (campus unchanged).
* Night street-lamp pools: a fixed pool of point lights (0/4/8/10 by profile; constant count, so no shader
  recompiles) moved to the lamps nearest the view.
* Lamp lenses, beacons and player-car headlights brighten with the lamp level; the city population's hour
  (`src/city/clock.ts`) now follows the sky.

### Rain — `src/world/Weather.tsx`, `src/audio/ambience.ts`
GPU-animated streaks in a camera-following box (1.8k/4.5k/9k/12k by profile; density by intensity; wind slant),
hidden and surfaces dry under a roof (reusing `audio/surface.ts`'s `indoors`), a synthesized rain bed on the
ambience bus (muffled indoors; birdsong fades in heavy rain). Reduced motion slows the rain and disables lightning.

### Post — `src/world/PostFX.tsx`
Exposure and a mild weather saturation grade before tone mapping; bloom with a 1.1 luminance threshold (sun disc,
lamps, lit windows, wet highlights), 0.10 by day to 0.42 at night, off at adaptive budget level 2.

### Settings and HUD
Settings → *Time & weather*: Live cycle / Live forecast (shared) or a fixed time and weather (this device only).
Saved and sanitised (`preferences.mjs`, test added). The location card shows the hour and weather instead of
“Golden hour”. The user's quality profile is never changed by any of this.

### Shadow-pass cost reduction — `vehicleModels.ts`
Lamps, chrome, trim, seats, dials, rims and tyre walls no longer cast shadows (they did not change the shadow on the
road but cost a shadow draw each: 16+ per car). Measured in the Commercial District: shadow-pass draws 266 → 186
with this change, 144 with the 52 m city radius.

## 4. Measurements

All runs: Chromium + SwiftShader software WebGL, 1280×720, `qa-scale=0.6`, High profile, this container.
**Frame rates under software WebGL (~1 FPS) are not meaningful and no frame-time claim is made.** Draw calls and
triangles are exact renderer counts, given as the [min, max] over five samples taken 2.2 s apart (the shadow map
and probe are not drawn every frame). Before = untouched code with the same harness; after = golden hour, clear.

| View | Draw calls before | after | Triangles before | after |
|---|---|---|---|---|
| commercial | 278–314 | 369–409 | 691,269–897,251 | 968,720–996,392 |
| commercial-street | 262–296 | 272–278 | 694,939–907,351 | 665,578–676,600 |
| downtown | 567 | 576 | 1,194,883–1,196,267 | 1,096,020–1,097,888 |
| downtown-avenue | 446–483 | 558 | 1,012,443–1,240,901 | 1,255,798–1,260,078 |
| campus | 235–530 | 252 | 1,114,205–1,768,452 | 1,114,222 |

Reading the table: most views are within the sampling range of the baseline; the Commercial District overview and
Downtown avenue rise because the shadow pass now actually covers the area around the player (defect 2), offset by
the vehicle-caster reduction. Low profile (`results-low.json`): Commercial street 170 draws in heavy rain, Downtown
320 at golden hour. A split of one Commercial District frame (afternoon) after all changes:
main pass 95 calls, shadow pass 144; before: main 142, shadow 26.

Other effects:
* The campus no longer downloads the photographic sky: `sky/environment.hdr` (748 KB) and `sky.jpg` (228 KB) or
  `sky-low.jpg` (60 KB) are only fetched by the Combat Arena now (by file size and code path; not separately
  measured over the network).
* Precache after build: 40 entries, 2,630 KiB (`npm run verify:release`: pass, no production debug hooks).
* Shader cost of the layer and sky on real GPUs: **not measured** (no GPU in this environment).

## 5. Verification

| Check | Result |
|---|---|
| `npm test` | **463 passed, 0 failed** (baseline 455/456). One regression found and fixed on the way: the preferences hydration test (time/weather keys now only hydrate when the store defines them). |
| `npm run build`, `npm run verify:release` | Pass |
| In-game captures, High: 5 views before/after | `docs/screenshots/world-visual/{before,after}/`, `results-high*.json` |
| In-game captures, High: 9 time/weather presets × 2 views | `docs/screenshots/world-visual/after/*-{preset}-high.jpg`, `results-high-presets.json` |
| In-game captures, Low: 3 presets × 2 views | `docs/screenshots/world-visual/after/*-low.jpg`, `results-low.json` |
| Page errors during captures | 0 |
| Physical devices, real GPUs, multiplayer, cinematics, Combat Arena transitions, context loss | **Not run in this pass** |

Reproduce: `node tests/browser-world-visual.mjs` (see its header for `VISUAL_LABEL`, `QUALITY`, `PRESETS`, `VIEWS`).
`tests/browser-city-life.mjs` now pins golden hour/clear so its density checks stay deterministic.

## 6. Not done, and the plan

Not implemented in this pass (no claim is made for any of these):

* **Hero slice in the Commercial District**: built in Phase 2 ([HERO_SLICE_COMMERCIAL_DISTRICT.md](HERO_SLICE_COMMERCIAL_DISTRICT.md))
  with the building, street dressing and production car. A new production pedestrian is still outstanding.
* Modular architectural kit with district identities beyond palette; trim sheets and atlases; KTX2 texture tiers for
  new assets; asset streaming priorities for them.
* Vehicle visual systems beyond existing ones (suspension compression, interior lights); human animation
  architecture (gaze, carrying, vehicle entry/exit for NPCs, facial animation, lip sync); crowd impostors.
* Vegetation species/LOD rebuild, terrain variation, environmental clutter, drainage and street-furniture assets.
* Screen-space reflections, contact shadows beyond N8AO, cascaded shadows, baked indirect light, light probes.
* Cinematic director extensions (DoF, motion blur).
* True rain occlusion (rain is hidden whenever the player is indoors; rain seen through a window from inside is not
  drawn; surfaces under canopies outdoors still get wet).
* Wet roads at night do not reflect individual street lamps (only the sky probe and the nearby lamp pool).
* Room-authoritative environment: the schedule is shared by construction (UTC), but a client with a wrong clock sees
  a different hour.
* Real-GPU and physical-device performance (30 FPS low-end Android / 60 FPS desktop targets) — needs devices.

Suggested next phase: the Commercial District hero slice on top of this foundation — one Blender building module set
(ground-floor shop bay, upper-floor bay with balcony, corner, roof edge) with three LODs and a trim sheet, one
production car (≤ 25k triangles LOD0, interior, separate wheels/doors), one rigged pedestrian, measured against the
same harness and on the reference devices before propagation.
