# Commercial District hero slice: Coastal Bank, its street and the district's production car

Phase 2 of the open-world transformation ([OPEN_WORLD_VISUAL_TRANSFORMATION.md](OPEN_WORLD_VISUAL_TRANSFORMATION.md)).
One complete environment slice in Harbour Exchange (Metropolitan City's Commercial District), built on the Phase 1
environment system, to validate the asset pipeline and rendering architecture before anything is propagated.

**Where:** block-0-1 of Harbour Exchange, building 0 ("Coastal Bank", world x −101.6, z 1672.45, 20 × 30 m
collision box), facing the district's mid street; the district's drivable compact (`harbour-compact`, parked at
x −150, z 1765.8). Teleport for review: `__campusDebug.teleport(-99, 1703, 0, .17, 12)` (QA builds).

## What was built

| Element | Implementation | Status |
|---|---|---|
| Detailed building | `blender/hero_slice.py` → `hero-bank.glb` (LOD0, 16,320 tris) and `hero-bank-lod1.glb` (7,604 tris). Granite piers and plinth, recessed bronze-framed shopfront, recessed double-door entrance with push bars, glazed returns and transom, steel canopy on tie rods with downlights, fascia with lettering, ATM with lit screen; three upper storeys with punched windows in 0.3 m reveals (frames, mullions, transoms, projecting sills with drips), brick and plaster bays, floor bands, corner pilasters, French doors onto balconies with drip-edged slabs and steel railings (posts, rails, flat balusters), pot plants and a chair, split AC units with fan grilles and pipe runs, top-floor sun hoods, downpipes with brackets and shoes, cornice, parapet with coping, roof membrane, stair/plant room, water tanks on stands, condensers, a tilted solar array and a satellite dish; side and rear windows. | Done |
| Visible interior | Banking hall behind the glass (LOD0): terrazzo floor, ceiling with light panels, brand band and artwork, teller counter with screens, waiting chairs, queue posts, a plant. Lit at night by the Phase 1 lamp level. Not enterable (the collider is solid, as before). | Done |
| Road segment and sidewalk | Phase 1 asphalt layer (patches, cracks, oil, wet puddles) on the existing street; kerb gullies with cast-iron grates every 12 m and a manhole cover (`hero-street.glb`). The existing kerb and paving geometry was not remodelled. | Partial |
| Vegetation | Two granite planters with leaf-card shrubs and an ornamental tree each (trunk, branches, ~850 leaf quads). Static: they do not sway. | Done (static) |
| Street furniture | Two cast-iron and timber benches. The planters and benches dress block-0-1's front-side shared colliders (`HARBOUR_FURNITURE`), which previously had **no visuals** (invisible obstacles). | Done |
| Production vehicle | `hero-car.glb` (16,224 tris): lofted saloon shell, bumpers, grille, projector headlamps, indicators and side repeaters, tail, reverse lamps, plates, mirrors with mirror glass, door handles and seams, wipers, exhaust, aerial; underbody (tray, exhaust run, tank, arms, dampers); **interior**: carpet, dashboard, instrument cluster, centre screen, console and selector, front seats with headrests, rear bench, door cards, headliner, rear-view mirror; separate wheels (tyre, 36 tread blocks, five-spoke alloy, nuts) and a separate steering wheel. Transparent tinted glass so the interior is seen. | Done |
| Vehicle visual systems | `buildHeroCar()` returns the game's `VehicleModel`, so `src/world/Vehicles.tsx` drives it exactly like the procedural cars: wheel spin, front-wheel steer, suspension pitch/roll, brake, reverse and head lamps (brighter at night), plus the steering wheel turning with the road wheels (new). Physics, seats and networking are untouched. Verified in-engine (see below). Indicators have no game state to follow and stay dim. | Done except indicators |
| Pedestrian | **Funmilayo**, a bank customer: see *Production pedestrian* below. Block-0-1's existing walker still crosses the frontage on its own line. | Done (no facial animation) |
| Lighting and reflections | Phase 1: analytic sky and PMREM probe, sun/moon key, lamp pools, wet surfaces, lit windows, bloom. All hero materials carry the environment layer. | Done (Phase 1) |
| LOD and streaming | LOD1 loads with the block; LOD0 is fetched only within 150 m of the bank; `THREE.LOD` switches at 85 m camera distance; until LOD1 arrives, or if it fails, the collision box is drawn as before. The old bank is cut out of block-0-1's batched GLB at load (`MeshAsset` `clip`), so the batch file did not need regenerating. The car loads on demand; the procedural compact is shown until then or on failure. | Done |

### Pipeline

```sh
python blender/hero_slice.py                # Blender 5.3 Python API (pip install bpy): model, save blender/source/hero_slice.blend, export
node scripts/assets/build-hero-slice.mjs    # meshopt → public/assets/harbour/hero/*.glb + manifest.json
node --test tests/hero-slice.test.mjs       # budgets, footprint vs collider, car rig vs VEHICLE_TYPES.car, material binding
```

Material slots are names, not baked textures. Library names (`plaster`, `brick`, `granite`, `glass`, `glassClear`,
`bronzeFrame` …) bind at load to the shared KTX2 PBR scans in `src/world/materials.ts`. Hero-only slots (roof
membrane, solar glass, screens, foliage, bark, cast iron, brand colours, the car's clear-coat paint and glass) are
made in `src/world/heroSlice.tsx`. The slice therefore downloads **no new textures**. The four GLBs total about
520 KB (bank 194 KB, LOD1 94 KB, car 142 KB, street 90 KB). Every asset is project-original; there is no third-party
content (`manifest.json`).

## Production pedestrian

| Part | Implementation |
|---|---|
| Character | Microsoft Rocketbox `Professions/Business_Female_03` (MIT), not used anywhere else in the game. Built by `scripts/assets/build-characters.mjs` like the player cast: Basis KTX2 textures, meshopt geometry, the baked skin mask (tinted to a deep skin tone), 81-bone Biped rig, 837 KB. Listed in the character manifest with `npc: true`. The avatar picker, `sanitizeAvatar` and the database allowlist only accept `MODELS`, so players cannot choose her (tested). |
| Animation | The shared motion-capture library through `src/avatar/Avatar.tsx`: speed-blended walking with turns, the captured sit-down and stand-up transitions, the seated idle with its look-around, a wave. Two Rocketbox clips were added to both body libraries for ambient life: texting on a phone (`phone`) and checking a document or receipt (`documents`). The existing clips' speeds, seat offsets and root heights are unchanged. |
| Behaviour | `src/world/heroPedestrianPlan.mjs`: a 144 s round as a pure function of the room clock, identical on every client and with no network traffic. She walks in from the west end of the block, steps up to Coastal Bank's ATM and checks her receipt (9 s), crosses to the hero bench and sits (26 s), stands, walks to the east end and texts (11 s), then walks back. |
| Reactions | Per viewer: her head and neck follow a player within 7 m in front of her; she turns and waves at a player who stops within 4 m (at most every 30 s, never while walking or seated); and she steps up to 0.85 m aside on her walking line instead of walking through a player. |
| Seating | She sits on the hero bench, which dresses a shared bench collider. `AvatarMotion.seatAt`, a small client-only addition to `Avatar.tsx`, gives the avatar this seat without adding it to the shared, server-authoritative seat table, so no new player interaction is created. |
| Animation LOD | Avatar's existing rules for non-local characters: not posed or drawn off screen, posed every 2nd frame beyond 30 m and every 4th beyond 60 m, and no shadow beyond 60 m. She is mounted only while block-0-1 is drawn (within 175 m, or 100 m on Low). |
| Robustness | If the captured stand-up has not finished 4 s after it was requested (a very low frame rate, or a clock jump), the seat is released and the round continues. If the character fails to load, `AvatarBoundary` shows its fallback as for every other character. |

Verification: `tests/hero-pedestrian.test.mjs` (4 tests) covers purity and periodicity; continuous movement at walking pace; every activity reached; the route staying outside every building, clear of planters and on the block; the bench being a shared bench collider; the ATM stand outside the bank's collider; and the character shipping with `npc` and both new clips. In-engine (High, `docs/screenshots/world-visual/hero-pedestrian/`, 0 page errors) her round was pinned and frozen at each moment: walking past the bank, at the ATM with the receipt, approaching the bench, seated with her head turned to the player (gaze 0.39 rad), standing up, texting, and a wave reported by the avatar for a player who stopped beside her.

Found and fixed during verification:
* **The stand-up could stall** at very low frame rates or after a clock jump. Fixed with the 4 s release above.
* **She waved with her back to the player.** She now turns to face whoever she greets.
* **An apparent "invisible at the ATM" problem** turned out to be capture lag: only 2–3 frames render in 2.5 s under software WebGL. Captures now freeze her clock and wait.

Costs:
* +837 KB for her character, loaded only near the slice.
* The two new clips add about 0.3–0.4 MB to each shared clip library (`anim-m.glb` 2.51 → 2.94 MB, `anim-f.glb` 2.39 → 2.70 MB), which every player downloads.
* Loading her took about 70 s under software WebGL with 18 other assets queued. This was not measured on a GPU.

## Verification

| Check | Result |
|---|---|
| `tests/hero-slice.test.mjs` | 5/5. Assets decode with no textures; within budgets (bank ≤ 25k, LOD1 ≤ 10k, car ≤ 20k, street ≤ 8k triangles); LOD1 < 60 % of LOD0; bank inside its collider below 3.5 m; car wheelbase, hub height, symmetric track and steering wheel at the driver seat match `VEHICLE_TYPES.car`; street dressing over the four front-side colliders; every material slot has a binding. |
| In-engine driving | Entered the car and drove it (local exploration, High). Position moved under the unchanged physics; wheel spin 0 → 4.36 rad; steering wheel 0 → −1.12 rad; no page errors. One defect found and fixed: the seated driver's head came through the roof (roof raised 8 cm to 1.53 m). |
| Captures, High | `docs/screenshots/world-visual/hero-after/`: wide bank view, shopfront close-up and car, each at golden hour, night and heavy rain, plus `hero-car-driving-golden-high.jpg`. Before (Phase 1 only, same views): `hero-before/`. |
| Captures, Low | `hero-after/*-low.jpg`, `results-low.json` |
| `npm run build`, `npm run verify:release` | Pass (precache 2,720 KB; hero GLBs are streamed, not precached) |
| `npm test` | **468 passed, 0 failed**. An earlier run made while browser captures loaded the CPU had one WebSocket timeout in `shop-accounts.test.mjs`, which is unrelated and passed on its own. |

Renderer counts at the bank view, golden hour, High (software WebGL, [min, max] over five samples): before
600 draw calls / 1.18 M triangles; after 424 / 0.80–0.81 M (Low: 371 / 0.54 M). The drop is measured but its cause
was not isolated: the two runs also differ in streaming state (234 vs 217 resident textures), so treat it as "no
increase" rather than a saving. Car view, after: 383–586 draw calls depending on the shadow frame and weather. **No frame-rate claim**: software WebGL runs at ~1 FPS
here, and no physical device or real GPU was available.

## Remaining limitations of this slice

* **Pedestrian**: no facial animation, blinking or lip sync. Rocketbox ships `_facial` FBX variants with blend
  shapes, but the pipeline does not import them yet. No carrying, vehicle entry/exit or conversation with the player.
  Gaze is a horizontal head and neck turn only (no eyes). The new clips cost every player about 0.7 MB; a separate
  ambient-clip file would avoid that.
* **Road and sidewalk geometry**: no remodelled kerb stones, drop kerbs, tactile paving or paving joints; the detail
  is in the shader layer, gullies and a manhole cover.
* **Vegetation**: planter shrubs and trees are static leaf cards without wind or LOD; the district's shared street
  trees are unchanged.
* **Car**: indicators have no game state; no interior light; no door or bonnet animation; plates are blank; no
  shadow LOD. In a Blender review render a thin dark line appears along the roof edge; a geometry search found
  nothing protruding there, so it is not confirmed as an in-game defect. Only `harbour-compact` uses it.
* **Building**: interiors exist only on the ground floor; upper rooms come from the window shader. The side facing
  the neighbouring building has simple windows. Weathering comes from the shared shader layer only (no baked AO or
  decals).
* **Measurement**: no physical-device or real-GPU frame timing; no memory-growth soak with the hero assets.
* **Propagation**: by design nothing outside the slice has changed. Propagating needs the review in the next section.

## Next steps

1. Review the captures on a real GPU and on the reference phone (Low/Balanced), measuring frame time near the bank,
   at the LOD switch and while driving the car.
2. If accepted, turn the bank's parts into a modular kit (shop bay, entrance bay, balcony bay, window bay, corner,
   roof edge), then generate the other Harbour Exchange buildings from it per district identity, replacing the
   batched boxes block by block with the same clip/LOD/stream pattern.
3. Car variants (paint, trim, SUV and coupé proportions) for the rest of the player fleet; then instanced LODs of the
   same model for city traffic.
4. Facial blend shapes (Rocketbox `_facial` exports) for blinking and speech on dialogue characters; ambient clips in their
   own file; more pedestrians on the same pattern, with the instanced crowd for distant people.
