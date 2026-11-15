# Project Warzone Fidelity: transformation report (November 2026)

The brief: raise Combat Arena (Operation: Metropolis first) toward the visual and gameplay standard of the supplied
Modern Warfare / Warzone footage, with Blender as a real production environment and every asset integrated into the
playable game. The reference was used for quality and genre only; nothing from it was copied.

This document states what was actually done in this pass, what was verified and how, and what remains. The honest
summary: **one vertical slice was delivered**. It is a reproducible Blender production pipeline and six original,
collision-matched props, integrated into the live Metropolis renderer with a fallback and tests. The rest of the
brief (characters, animation, weapons, movement, VFX, interiors, doors, networking, device validation) is not done
and is listed in [REMAINING_LIMITATIONS.md](REMAINING_LIMITATIONS.md).

## 1. Starting point

* Branch `lushegs/epic-faraday-fng5we` at `33dd385` (merged PR #41, the Metropolis daylight pass). Clean tree, no
  uncommitted work. The container started without `node_modules`. After `npm ci` the baseline was
  **`npm test`: 344 passed, 0 failed**. Without dependencies, 28 suites fail on `ERR_MODULE_NOT_FOUND`, which is an
  environment state, not a code defect.
* Tooling: **no Blender MCP server was connected** and no `blender` binary was installed. Blender 5.3's Python API was
  installed as a module (`pip install bpy` in a venv) and used headlessly for all modelling, baking and export.
* Reference footage studied (three clips, 1920×1080): rooftop daylight with weathered parapets and render, deep
  aerial haze, large gloved hands and a scoped rifle filling the lower right; a stairwell interior with an optic;
  the after-action weapon-unlock screen.

## 2. Audit inventory

Classified from the code and the existing reports ([COMBAT-ARENA.md](COMBAT-ARENA.md), [METROPOLIS.md](METROPOLIS.md),
[PHOTOREALISM.md](PHOTOREALISM.md), [ARENA-AUDIO-REPORT.md](ARENA-AUDIO-REPORT.md),
[ARENA-ARMORY-HUD-REPORT.md](ARENA-ARMORY-HUD-REPORT.md), [MOBILE-PERFORMANCE.md](MOBILE-PERFORMANCE.md)). "Verified"
means covered by the passing automated suites or browser runs recorded in those reports.

| System | State |
|---|---|
| Server-authoritative 60 Hz shared simulation, command protocol, prediction + rewind/replay reconciliation, lag compensation (≤ 300 ms), interest management, droppable snapshots, reconnection | Working and verified (Node suites; browser runs over the real room server) |
| Metropolis collision map: five districts, symmetric routes, spawns, three objectives, station timetable, train damage, breakable glass | Working and verified |
| Weather variants (Storm Break, Harmattan Noon, Rainy Season, Lagoon Sunset, Blue Hour); sky, IBL, fog, wetness, puddle reflections (High/Ultra) | Working and verified in software captures; not verified on real GPUs |
| Graphics profiles Low–Ultra, resolution scale, adaptive quality, phone texture tier | Working; frame rates not verified on physical devices |
| Asset pipeline (KTX2/Basis, meshopt, ledgers, mobile tier) | Working and verified |
| Weapon catalogue, recoil, ammunition, unlocks, armory, HUD customisation | Working and verified |
| First-person viewmodel: springs, sway, sprint pose, IK hands, reload phases timed by the simulation | Working; reloads are procedural poses, not keyframed clips (partially implemented) |
| Soldiers: Rocketbox-derived models and mocap locomotion | Working; no slide/vault/hard-landing clips (partially implemented) |
| Weapon magazines for Wasp, Kestrel, Bastion | Partially implemented (fused to the gun) |
| Metropolis ambience (`amb.metropolis`, station reverb, train loop) | Missing (the map reuses the Foundry bank) |
| Interior power failure (`setPower`) | Implemented, never triggered |
| Interactive doors; enterable upper floors and towers | Missing (doors are static open leaves; towers are solid collision) |
| Vehicle animation and physics in the arena | Missing (vehicles are static cover) |
| City props drawn by code (tanks, AC units, vents, cabinets, bins, forklift, kiosks, shelters …) | Visually weak (the target of this pass for six types) |
| Physical-device performance; audio listening tests | Requires external work |

## 3. What was built

### Blender production pipeline (new)

`blender/` holds a reproducible, idempotent pipeline: geometry kit, procedural PBR recipes, Cycles baking, glTF export,
a committed source scene and a review renderer. `scripts/assets/build-blender-props.mjs` compresses its output into
the existing arena pack. The pipeline is described in [BLENDER_ASSET_PIPELINE.md](BLENDER_ASSET_PIPELINE.md).

### Six original props (created in Blender, integrated in the game)

Roof water tank, rooftop condensing unit, rooftop ventilation unit, street feeder pillar, four-wheel refuse container
and port forklift: 1,620–6,988 triangles each, one baked 512² PBR set each, 133–250 KB each. Each is modelled to its
collision box, and all 32 copies on the map are replaced. Details: [ASSET_MANIFEST.md](ASSET_MANIFEST.md).

### Game integration

* `src/arena/scene/library.ts`: `HERO_PROPS`, a theme's pre-deployment prop list (Metropolis only). A prop that fails
  to download is logged and left out.
* `src/arena/scene/city/props.ts`: `hero()` places a Blender prop in a collision box (long axis along the box, scaled
  to it, as instanced meshes). The `tank`, `ac`, `vent`, `utility`, `bin` and `forklift` cases use it, with their
  previous code geometry as the fallback.
* No collision, server, simulation or protocol change. Cover, sightlines and routes are exactly as before.

## 4. Verification

| Check | Result |
|---|---|
| `npm test` (full Node suite) | **347 passed, 0 failed** (baseline 344 + 3 new in `tests/arena-blender-props.test.mjs`) |
| `tests/arena-blender-props.test.mjs` | Manifest ↔ `HERO_PROPS` ↔ map box types agree; both tiers decode; bounds within 10 % of each collision box; base on the ground; ≤ 8,000 triangles; one material; KTX2 only |
| `npm run build` | Pass |
| `npm run verify:release` | Pass: precache 2.49 MB (unchanged; the arena pack is streamed, not precached), no production debug hooks |
| Fallback path | Exercised by the "before" captures, which ran with the six GLBs withheld: the loader logged each miss and the city drew the code geometry; the match deployed normally |
| In-game captures | Same camera, High, Harmattan Noon (`day`), render scale 0.75, Chromium software WebGL, live room server: `docs/screenshots/metropolis-photoreal/blender-{before,after}/`, side by side in `…/compare/day-{roofplant,roofac,kerb,forklift}-high-blender-after.jpg` |

Renderer counts from those captures (exact; frame rates under software WebGL are meaningless and not reported):

| View | Draw calls before → after | Triangles before → after |
|---|---|---|
| Roof water tanks | 164 → 163 | 351,415 → 412,347 |
| Roof condensing units | 644 → 638 | 1,004,373 → 1,121,881 |
| Refuse containers (alley) | 204 → 203 | 690,913 → 788,825 |
| Port forklift | 245 → 244 | 780,617 → 801,393 |

Draw calls fall slightly: each prop is one instanced batch with one material, where the code version was spread across
several merged material batches. Triangles in view rise by 3–17 %. GPU textures rise by 18 (six assets × three
maps). No frame-time claim is made: that needs the physical devices listed in
[REMAINING_LIMITATIONS.md](REMAINING_LIMITATIONS.md).

One defect was found in the in-game review and fixed: the galvanised refuse containers rendered almost black in the
covered alley. They were fully metallic, which three.js lights only from the environment probe. Galvanised steel was
re-specified as weathered (metal 0.45, roughness 0.55) and the bin and ventilation unit were rebaked. The alley was
recaptured to confirm it (`…/blender-after/day-kerb-high.jpg`). That recapture was taken before the decor props had
streamed in (131 resident textures against 187; the bin bag on the left is missing for that reason), so its counts are
not comparable and the table keeps the earlier same-state measurement.

## 5. The owner's added requirement: enterable buildings and working doors

Requested during this pass: every building enterable to the top floor, and every door opening and closing. It was
not started, because it is a map and gameplay change, not an art change:

* **Collision and balance.** Towers and upper storeys are solid boxes in the shared map. Opening them adds floors,
  stairs and windows with long sightlines over objectives and spawns. The map's west/east symmetry, spawn safety and
  objective separation (all covered by tests) have to be redesigned and re-validated.
* **Server authority.** A door that blocks movement and bullets has to be server state (open/closed per door, in
  snapshots and rejoins), checked by the shared physics on both client and server. Otherwise prediction and hit
  registration disagree. Interest management (line of sight through doorways) and the bots' A* grid change with it.
* **Performance.** Every enterable floor needs an interior. Draw calls, culling regions and the phone budget grow.

Suggested staging: (1) server-authoritative doors on the existing street-level shops, halls and station rooms;
(2) one enterable building per side (stairs to the roof, two furnished floors), symmetric, with spawn and sightline
tests; (3) extend building by building only where balance tests and frame-time measurements allow.

## 6. Documentation

New: this report, [BLENDER_ASSET_PIPELINE.md](BLENDER_ASSET_PIPELINE.md), [ASSET_MANIFEST.md](ASSET_MANIFEST.md),
[REMAINING_LIMITATIONS.md](REMAINING_LIMITATIONS.md); a pointer section in [METROPOLIS.md](METROPOLIS.md).
`ANIMATION_SYSTEM.md`, `RENDERING_ARCHITECTURE.md` and `PERFORMANCE_VALIDATION.md` were not written: this pass
changed no animation or renderer code and measured no device. The existing documents
([COMBAT-ARENA.md](COMBAT-ARENA.md), [PHOTOREALISM.md](PHOTOREALISM.md), [MOBILE-PERFORMANCE.md](MOBILE-PERFORMANCE.md))
remain the accurate description, and new files would only restate them.
