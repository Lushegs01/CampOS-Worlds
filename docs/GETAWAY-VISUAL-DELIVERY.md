# The Getaway Industrial District visual slice

Bay 04 and its freight yard now render as a working logistics site in the existing CampOS Worlds mission. The work replaces the warehouse and depot shells with authored meshes, builds the yard above the terrain, and uses scanned surfaces and practical fixtures throughout. The combat and vehicle changes use the same room authority, movement, checkpoints, and drive simulation.

The visual target for this pass is an original, coherent industrial location that reads from the gameplay camera. The screen captures show a substantial change in that location. The project still has browser-scale limitations in character detail, world density and lighting.

- [Original visual audit and art direction](GETAWAY-VISUAL-AUDIT.md)
- [Asset inventory and licenses](ASSET_MANIFEST.md#orisun-freight--the-getaway)
- [Blender production workflow](BLENDER_ASSET_PIPELINE.md#orisun-freight-visual-production)
- [Runtime measurements and diagnostics](performance/getaway-visual/)

## Evidence from the running game

Playwright opened the account-backed campus, spoke to Sade, accepted the assignment, and entered the server-controlled warehouse encounter. Fixture positions repeat the viewpoints. The third-person view uses the normal spring arm. The staged close-ups and wide view use the live WebGL camera. Both High capture runs used Chromium with SwiftShader at a 1280 × 800 viewport and 793 × 496 drawing buffer. The room was connected for all six views on both builds. The Chrome DevTools protocol recorded the JavaScript heap, and Three.js reported render calls, triangles and resources. The lab extends network timeouts in development because software shader compilation can stall the browser.

| View | Before | After |
| --- | --- | --- |
| Third person | [Screenshot](screenshots/getaway-visual/before/third-person.jpg) | [Screenshot](screenshots/getaway-visual/after/third-person.jpg) |
| Industrial street | [Screenshot](screenshots/getaway-visual/before/industrial-street.jpg) | [Screenshot](screenshots/getaway-visual/after/industrial-street.jpg) |
| Warehouse encounter | [Screenshot](screenshots/getaway-visual/before/warehouse-interior.jpg) | [Screenshot](screenshots/getaway-visual/after/warehouse-interior.jpg) |
| Vehicle close-up | [Screenshot](screenshots/getaway-visual/before/vehicle-close.jpg) | [Screenshot](screenshots/getaway-visual/after/vehicle-close.jpg) |
| Character close-up | [Screenshot](screenshots/getaway-visual/before/character-close.jpg) | [Screenshot](screenshots/getaway-visual/after/character-close.jpg) |
| Wide environmental view | [Screenshot](screenshots/getaway-visual/before/wide.jpg) | [Screenshot](screenshots/getaway-visual/after/wide.jpg) |

The Performance profile also ran the live [warehouse encounter](screenshots/getaway-visual/performance/warehouse-interior.jpg) and [first-person view](screenshots/getaway-visual/performance/combat-view.jpg). The campaign playthrough recorded [aimed rifle play](screenshots/getaway-visual/gameplay/combat-rifle.jpg), [pursuit](screenshots/getaway-visual/gameplay/pursuit.jpg), and the [completion screen](screenshots/getaway-visual/gameplay/debrief.jpg).

## Implementation

- Blender source and five Meshopt GLBs cover the dock, depots, drainage, practicals, equipment and perimeter. The total is **30,750 triangles and 371,376 bytes**. Visual meshes and surface-height offsets are separate from the collision boxes. Additional fixtures have footprint proxies on the boundary or off the mission line.
- Bay 04 uses corrugated oxide cladding, zinc flashing, clerestory and rainwater detailing, braced trusses, electrical fittings, racking, jointed concrete and an open receiving bay. The apron, parking marks, gates, and used equipment establish the site’s function. Reuse keeps the material and manufacturing style consistent.
- Existing 1024² Poly Haven color, normal, and packed AO/roughness/metal maps are reused. The asphalt uses a second rotated sample to break up repeating cracks. PBR variants distinguish concrete, sealant, painted sheet, glass, and worn wood. Directional shadows use a tighter local frustum, and lightweight practical lights illuminate the warehouse on higher profiles.
- Two authorized Rocketbox soldier kits replace the enemies’ civilian visual stand-ins after streaming. Their grip IK, locomotion, hit response and death pose run from live actor state. The player’s selected campus avatar carries through the mission. Camera-space rigged hands, anchor-based reloads, and weapon-specific muzzle feedback reuse the existing authored models and Arena animator for the Sparrow, Vanguard and Bastion.
- The compact and shuttle have projectors, finishes and fascia detail that match the freight fleet. Chase units have a distinct response livery and profiled emergency bar. Driving uses the existing wheel, suspension and braking motion. The local driver gets headlights on Balanced or higher. Condition changes dull the clearcoat and trigger engine smoke. Pooled tracks and dust respond to local hard braking and cornering.
- The existing room supplies impact surfaces, normals and blast timings. Pooled effects render dust, sparks, moving tracers, fire, smoke, debris and scorch. The yard alarm and response lighting offer a steady reduced-motion mode. The Performance profile uses soft contact shadows for moving enemy feet under its static sun map. The camera blends into the encounter and back from driving, with automatic immediate aim as a shot is taken.
- All four campus profiles share the same level. Performance keeps the authored architecture with existing color maps, mobile prop and character tiers, container LOD, and capped effects. Balanced uses material maps and one warehouse practical light. High adds the second practical, set dressing, SSAO and SMAA. Cinematic / Ultra increases shadow update frequency and anisotropic filtering. Optional district files start near the site via the existing fetch queue, Meshopt/KTX2 decoders, and HTTP/PWA caches.
- WebGPU would require porting the existing `onBeforeCompile` shaders and the WebGL post stack. The slice uses the existing WebGL2 and AgX pipeline.

## Performance and verification

Results are recorded in the adjacent diagnostics. Single-frame render-call and triangle counts include the shadow and post-processing passes where active. The capture files record individual frames, whose workload varies with shadow refresh and culling. A profiling pass also removed the lawn-blade draw outside its mask. At High, that skips 52,000 instances per scene pass in the freight yard. The frame samples exercise the final rendering code after that optimization. SwiftShader measures this machine’s CPU-backed rendering. Physical GPU timings, VRAM, browser compatibility across devices, thermal behavior and weak-link load times need device measurements.

- **Production build passed**, including TypeScript, Vite and the PWA manifest. Vite reported its chunk-size warning for the ~1 MB minified Three.js chunk.
- **432 repository tests passed** in the final run. Coverage includes room authority, multiplayer, vehicles, collision, Arena, movement, persistence, and the new GLB size and UV assertions. The final production build and all eight focused mission and GLB tests passed after the contact-shadow change.
- **Desktop campaign Playwright passed** with normal input. It entered the warehouse, failed and retried a checkpoint, fought with all three loadout weapons, triggered the fuel drum, drove the compact during a live pursuit, evaded police, delivered the case, and confirmed the reward after refresh.
- **High and Performance Playwright capture passes succeeded.** The six High comparisons and the Performance capture series ran in a connected room. The High warehouse and [first-person view](screenshots/getaway-visual/after/combat-view.jpg) reported three live hostile rigs and the equipped Sparrow model. The Performance run reported no failed asset requests or graphics diagnostics.
- **Touch smoke passed** in the manual-frame software lab. CDP touch inputs moved the joystick, aimed, fired, reloaded, swapped weapons, entered the compact and accelerated. Earlier continuous-render attempts stalled during touch actions or ran into the pursuit timeout. [Touch combat](screenshots/getaway-visual/gameplay/touch-combat.jpg) · [Touch driving](screenshots/getaway-visual/gameplay/touch-driving.jpg)

### Matched software measurements

Each timing run opened Chromium in a fresh context and joined an account-backed mission. It used the live scene and camera at a fixed 614 × 384 drawing buffer. After two warm-up draws per position, the browser rendered on animation frames for at least seven seconds. The fixed QA scale makes the renderer comparison repeatable. Physical-device performance and the adaptive quality controller need their own measurements. The Performance timing samples preceded the final addition of the three local contact shadows.

| Profile | Position | FPS before → after | Median frame ms | P95 frame ms | Submitted triangles in final sample | Frames counted |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| High | Loading yard | 0.36 → 0.20 | 2,600 → 5,083 | 3,383 → 5,083 | 1,165,763 → 863,797 | 3 → 2 |
| High | Warehouse | 0.35 → 0.19 | 2,650 → 5,700 | 3,483 → 5,700 | 1,208,465 → 966,515 | 3 → 2 |
| Performance | Loading yard | 1.00 → 0.64 | 1,000 → 1,550 | 1,083 → 1,700 | 135,216 → 165,512 | 8 → 5 |
| Performance | Warehouse | 0.96 → 0.68 | 1,017 → 1,500 | 1,183 → 1,617 | 144,678 → 220,395 | 7 → 5 |

Both profiles took longer per frame in this software lab. High submitted fewer triangles after the grass cull and local shadow changes. Its 3,072² freight shadow map improved the untuned High samples from 0.19 to 0.20 FPS in the yard and 0.16 to 0.19 FPS in the warehouse. Samples contain only two to eight frames, so their percentiles describe these runs. Playable frame rate on hardware remains unverified.

The browser recorded transferred Getaway and reused Arena assets after the campus opened. **High 0.70 → 9.40 MB and Performance 0.59 → 4.53 MB**. The five newly authored architecture GLBs account for 371 KB of the payload. Performance uses lower downloaded assets and fewer material inputs. The timing files also record cached geometry and texture counts and JavaScript heap snapshots. [Raw captures and timings](performance/getaway-visual/)


### Reproduce the checks

```sh
npm run build
npm test
node tests/browser-getaway.mjs
GETAWAY_TOUCH_MANUAL_RENDER=1 node tests/browser-getaway-touch.mjs
GETAWAY_EXPECT_TRANSFORMED=1 GETAWAY_PROFILE=high node tests/browser-getaway-visual.mjs
GETAWAY_EXPECT_TRANSFORMED=1 GETAWAY_PROFILE=low GETAWAY_TIMING=1 node tests/browser-getaway-visual.mjs
```

`GETAWAY_EVIDENCE` sets the output directory. The browser tests use the local account and room service. Render timings toggle the same WebGL pipeline from a requestAnimationFrame callback after setup has settled. The complete keyboard playthrough uses regular gameplay inputs. Touch uses CDP pointer events with an isolated pursuit fixture for the accelerator check.

## Directive coverage

| Requirement | Classification | Evidence or gap |
| --- | --- | --- |
| 1. Rendering audit and six baseline views | Implemented and verified | Existing rendering, assets, bottlenecks, priorities, and gameplay-camera comparisons are documented. |
| 2. Original art direction | Implemented and verified | The Orisun Freight design is visible in the connected campus across the six views. |
| 3. Real 3D assets and provenance | Implemented and verified | Original Blender environment modules, existing licensed scans, optimized runtime GLBs and visual/collision separation. |
| 3. Connected Blender MCP | Blocked | No Blender MCP tool was exposed. Blender 4.3 ran headlessly and produced an editable source scene. |
| 4. PBR surfaces | Implemented and verified | Shared compressed maps, metric UVs, scene-specific finishes and HDR reflections. True displacement and transparent room glazing remain incomplete. |
| 5. Industrial environmental realism | Implemented and verified | Bay 04, street, apron, drainage, loading, gate, utilities, handling equipment and staging are visible in the running mission. The freight slice contains the new district artwork. |
| 6. Lighting and atmosphere | Incomplete | Local practicals, regional shadows, haze, HDR and direct illumination work. The district remains in the existing time of day. Weather, volumetrics, dynamic sky, and screen-space reflections are outside the implemented slice. |
| 7. Character realism and animation | Incomplete | Enemy rigs and weapon IK, existing player avatar, locomotion, aim, reload and hit/fall presentation work. New faces, hair and wardrobes, a full-body combat animation library, foot IK and vehicle entry or exit clips are unfinished. |
| 8. Vehicle realism | Incomplete | Drivable compact and shuttle, upgraded materials and lamps, response livery, wheel/body motion and vehicle feedback are implemented. New full vehicle meshes, deformation, and breakable glass are unfinished. |
| 9. Effects and action feedback | Incomplete | The pooled shot, impact, blast and driving effects are implemented. Breakable glass and a dedicated footstep particle pass are unfinished. |
| 10. Camera and cinematic presentation | Implemented and verified | The existing collision-aware spring arm and chase rig operate in the slice. The short combat and driver-exit transitions and chase framing are integrated. |
| 11. Asset delivery | Implemented and verified | Browser load, decoders, metric UVs, byte limits, and source regeneration are tested. Original assets remain editable. |
| 12. Profiles and performance | Incomplete | Four profiles, lower assets and pooled effects, software frame measurements, and adaptive rendering are implemented. Physical-device, low-bandwidth and hardware-GPU profiling are unverified. |
| 13. First playable vertical slice | Incomplete | Industrial mission space and its render integration are implemented. Several fidelity and animation requirements remain open in rows 6–9. |
| 14. Visual and regression validation | Implemented and verified | Matched Playwright screenshots, runtime probes and repository tests are linked above and below. |
| 15. Existing engine, features, rights and asset constraints | Implemented and verified | Same world renderer and gameplay entry points. Original artwork and documented licensed reuse. |
| 16. Delivery evidence | Implemented and verified | Audit, source, manifest, camera comparisons, diagnostics, inventory and limitations appear in the delivery. |

### Slice checklist

| Playable slice requirement | Classification | Result |
| --- | --- | --- |
| Industrial street | Implemented and verified | The freight road connects to the paved yard, marked lanes, gates and drainage. |
| Warehouse exterior | Implemented and verified | Bay 04 uses the Blender shell with roof, canopy, shutters, zinc and glazed openings. |
| Warehouse interior | Implemented and verified | Racks, cover, equipment, conduits, trusses, lights and concrete flooring. |
| Player character | Incomplete | Authored selectable Rocketbox models and hand IK are integrated. New player bodies and wardrobes remain unfinished. |
| Two enemy characters | Implemented and verified | Two military rigs and three live hostile instances loaded in the High warehouse capture. |
| Three weapon models | Implemented and verified | Sparrow, Vanguard and Bastion all operate in the campaign. The higher tiers request the full models. |
| Two drivable vehicles | Implemented and verified | The compact and shuttle have distinct upgraded visuals and retain the drive simulation. The fleet test drives both and the cart. |
| Roads and pavements | Implemented and verified | Asphalt, a concrete apron, road shoulders, loading lines and drain grating are in the camera comparisons. |
| Environmental light | Implemented and verified | Sky, HDR lighting, sunlight, local fog and warehouse practicals are active in the slice. |
| Materials | Implemented and verified | KTX2 material sets and differentiated surface response are visible in the comparisons. |
| Shadows | Implemented and verified | The camera views record building, canopy, cargo and vehicle contact with the lighting. |
| Third-person camera | Implemented and verified | World, aim and drive transitions keep the existing spring-arm collision and input paths. |
| Combat effects | Implemented but not verified | Material-specific impact, moving tracer and muzzle systems are wired in. Individual particle and short-duration muzzle timings were outside the screenshot checks. |
| Vehicle lighting and driving effects | Implemented but not verified | Projectors, lamp response, condition-dependent finish changes, engine smoke, dust and tracks are wired. Dedicated activated-effect captures are incomplete. |
| Police pursuit | Implemented and verified | The campaign test confirmed dispatch, visual contact and escape using the drivable compact. The response livery and lights are implemented. |
| Explosion, smoke and fire | Implemented but not verified | The playthrough triggered the server-authoritative blast. The connected browser recorded populated effect buffers after the timer fired. A clear visual capture of the short-lived fireball and lingering smoke remains open. |

## Modified files

```text
README.md
blender/getaway_district.py
blender/source/getaway_district.blend
docs/ASSET_MANIFEST.md
docs/BLENDER_ASSET_PIPELINE.md
docs/GETAWAY-VISUAL-AUDIT.md
docs/GETAWAY-VISUAL-DELIVERY.md
docs/performance/getaway-visual/after-high-before-shadow-tuning.json
docs/performance/getaway-visual/after-high-captures.json
docs/performance/getaway-visual/after-high-combat.json
docs/performance/getaway-visual/after-high-timing.json
docs/performance/getaway-visual/after-performance-captures.json
docs/performance/getaway-visual/after-performance-combat.json
docs/performance/getaway-visual/after-performance-timing.json
docs/performance/getaway-visual/before-high-captures.json
docs/performance/getaway-visual/before-high-timing.json
docs/performance/getaway-visual/before-performance-timing.json
docs/screenshots/getaway-visual/after/character-close.jpg
docs/screenshots/getaway-visual/after/combat-view.jpg
docs/screenshots/getaway-visual/after/industrial-street.jpg
docs/screenshots/getaway-visual/after/third-person.jpg
docs/screenshots/getaway-visual/after/vehicle-close.jpg
docs/screenshots/getaway-visual/after/warehouse-interior.jpg
docs/screenshots/getaway-visual/after/wide.jpg
docs/screenshots/getaway-visual/before/character-close.jpg
docs/screenshots/getaway-visual/before/industrial-street.jpg
docs/screenshots/getaway-visual/before/third-person.jpg
docs/screenshots/getaway-visual/before/vehicle-close.jpg
docs/screenshots/getaway-visual/before/warehouse-interior.jpg
docs/screenshots/getaway-visual/before/wide.jpg
docs/screenshots/getaway-visual/gameplay/combat-rifle.jpg
docs/screenshots/getaway-visual/gameplay/debrief.jpg
docs/screenshots/getaway-visual/gameplay/pursuit.jpg
docs/screenshots/getaway-visual/gameplay/touch-combat.jpg
docs/screenshots/getaway-visual/gameplay/touch-driving.jpg
docs/screenshots/getaway-visual/industrial-street-comparison.jpg
docs/screenshots/getaway-visual/performance/character-close.jpg
docs/screenshots/getaway-visual/performance/combat-view.jpg
docs/screenshots/getaway-visual/performance/industrial-street.jpg
docs/screenshots/getaway-visual/performance/third-person.jpg
docs/screenshots/getaway-visual/performance/vehicle-close.jpg
docs/screenshots/getaway-visual/performance/warehouse-interior.jpg
docs/screenshots/getaway-visual/performance/wide.jpg
docs/screenshots/getaway-visual/warehouse-interior-comparison.jpg
public/assets/getaway/bay04Fittings.glb
public/assets/getaway/bay04Shell.glb
public/assets/getaway/district.json
public/assets/getaway/freightDepots.glb
public/assets/getaway/freightFixtures.glb
public/assets/getaway/freightGround.glb
scripts/assets/optimize-getaway.mjs
server/mission/getaway.mjs
shared/getaway.mjs
src/arena/scene/fx.ts
src/arena/scene/muzzle.ts
src/arena/scene/soldiers.ts
src/arena/scene/weapons.ts
src/game/Player.tsx
src/mission/IndustrialDistrict.tsx
src/mission/client.ts
src/mission/effects.tsx
src/mission/meshAsset.tsx
src/mission/presentation.tsx
src/mission/scene.tsx
src/network/client.ts
src/ui/Panels.tsx
src/world/Sky.tsx
src/world/Vegetation.tsx
src/world/Vehicles.tsx
src/world/World.tsx
src/world/vehicleModels.ts
tests/browser-getaway-touch.mjs
tests/browser-getaway-visual.mjs
tests/browser-npcs.mjs
tests/getaway-visual-assets.test.mjs
tests/getaway.test.mjs
tests/support/browser.mjs
tests/support/stack.mjs
```
