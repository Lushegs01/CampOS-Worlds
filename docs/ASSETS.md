# Asset provenance and licences

Every runtime asset is stored in `public/assets/` and served by the app itself: there are no third-party URLs at runtime. Downloaded sources are converted by the scripts in `scripts/assets/` (KTX2/Basis textures, meshopt-compressed glTF), and each build writes a ledger of what it fetched, from where, and under which licence. The tables below are generated from those ledgers.

## Characters and animation — MIT

| Asset | Source | Licence |
|---|---|---|
| `characters/*.glb` (Tunde, Chidi, Ibrahim, Ada, Amara, Mel and the other selectable students) | [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox), adult avatars (each character's exact source folder is listed in `characters/manifest.json`) | MIT, © 2020 Microsoft |
| `characters/anim-m.glb`, `anim-f.glb` | Rocketbox motion-capture clips: idle, look, walk, jog, run, wave, dance, cheer, sit down / stand up (chair and table), seated idle, seated look, seated at table, door push / pull, crouch, holding (used as an arm-only layer) | MIT, © 2020 Microsoft |

Skin-tone variation is a shader tint driven by a skin mask baked by `scripts/assets/build-characters.mjs`; the backpack, headphones and glasses accessories are procedural geometry.

## Environment — CC0 (Poly Haven)

| Asset | Source |
|---|---|
| Sky dome and image-based lighting | [Kloofendal 48d Partly Cloudy (pure sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) — Greg Zaal, Jarod Guest |
| Ground and building textures | [leafy grass](https://polyhaven.com/a/leafy_grass), [sparse grass](https://polyhaven.com/a/sparse_grass), [red laterite soil](https://polyhaven.com/a/red_laterite_soil_stones), [interlocking pavers](https://polyhaven.com/a/interlocking_concrete_pavers), [patterned pavers](https://polyhaven.com/a/patterned_concrete_pavers), [hexagonal paving](https://polyhaven.com/a/hexagonal_concrete_paving), [white stucco](https://polyhaven.com/a/white_stucco), [plastered wall 04](https://polyhaven.com/a/plastered_wall_04), [concrete wall 008](https://polyhaven.com/a/concrete_wall_008), [ribbed concrete](https://polyhaven.com/a/ribbed_concrete_wall), [brushed concrete](https://polyhaven.com/a/brushed_concrete), [large red bricks](https://polyhaven.com/a/large_red_bricks), [box-profile metal sheet](https://polyhaven.com/a/box_profile_metal_sheet), [terrazzo tiles](https://polyhaven.com/a/terrazzo_tiles), [granite tile](https://polyhaven.com/a/granite_tile), [palm bark](https://polyhaven.com/a/palm_tree_bark), [asphalt 02](https://polyhaven.com/a/asphalt_02), [rubberized track](https://polyhaven.com/a/rubberized_track), [worn table wood](https://polyhaven.com/a/wood_table_worn) |
| Tree bark and leaf cards | Bark from [island tree 01](https://polyhaven.com/a/island_tree_01); leaf silhouettes and colour from island tree 01, [jacaranda](https://polyhaven.com/a/jacaranda_tree) and [small tree 02](https://polyhaven.com/a/tree_small_02), composed into atlases by `scripts/assets/build-environment.mjs` |

## Props — CC0 (Poly Haven)

| Asset | Source | Author |
|---|---|---|
| `props/schoolChair.glb` (library, classroom and computer chairs) | [School Chair 01](https://polyhaven.com/a/SchoolChair_01) | Ethan Place |
| `props/monobloc.glb` (café chairs) | [Plastic Monobloc Chair 01](https://polyhaven.com/a/plastic_monobloc_chair_01) | Kuutti Siitonen |
| `props/schoolDesk.glb` | [School Desk 01](https://polyhaven.com/a/SchoolDesk_01) | Ethan Place |
| `props/pottedPalm.glb`, `pottedPlant.glb` | [Potted Plant 01](https://polyhaven.com/a/potted_plant_01), [02](https://polyhaven.com/a/potted_plant_02) | Rico Cilliers |
| `props/fern.glb`, `calathea.glb`, `anthurium.glb` | [Fern 02](https://polyhaven.com/a/fern_02), [Calathea Orbifolia 01](https://polyhaven.com/a/calathea_orbifolia_01), [Anthurium 01](https://polyhaven.com/a/anthurium_botany_01) | Rob Tuytel, Rico Cilliers |
| `props/shrub.glb` | [Shrub 04](https://polyhaven.com/a/shrub_04) | Rico Cilliers |
| `props/chalkboard.glb` | [Standing Chalkboard 01](https://polyhaven.com/a/standing_chalkboard_01) | ParzivalCG |
| `props/hydrant.glb` | [Fire Hydrant](https://polyhaven.com/a/fire_hydrant) | Gonçalo Felício |
| `props/picnic.glb` | [Wooden Picnic Table](https://polyhaven.com/a/wooden_picnic_table) | Ulan Cabanilla |
| `props/wetFloor.glb` | [Wet Floor Sign 01](https://polyhaven.com/a/WetFloorSign_01) | Fran Calvente |
| `props/seating.glb` | [Modular Street Seating](https://polyhaven.com/a/modular_street_seating) | Stuart Attenborrow (no longer placed: forecourt benches are sittable timber benches) |

## Sound — CC0

Built into `public/assets/audio/` (mono MP3, trimmed, level-matched, loops made seamless) by `scripts/assets/build-audio.mjs`, which downloads these sources into `.asset-cache/audio/`.

| Sound | Source | Author |
|---|---|---|
| Footsteps on paving, grass and timber (`step-*`); landings, sitting on chairs and benches (`seat-*`); glass | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney |
| Doors opening and closing, latches, clothes (`door-*`, `cloth`) | [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney |
| Car doors, engine start, idle loop and shut-off (`car-door-*`, `engine*`) | [Car Sound Effects Pack](https://opengameart.org/content/car-sound-effects-pack-low-quality) | GGBotNet |
| Birdsong, breeze and running water (`birds`, `wind`, `water`) | [Park ambiences](https://opengameart.org/content/park-ambiences) | Thimras |

Tyre noise on the road, the garden cart's electric motor and chair legs scraping on the floor are synthesized at runtime (Web Audio).

## Authored for this project

- Campus architecture, doors, benches, tables, desks, counters, signage, sculpture, water and landscaping layout are procedural geometry (`src/world/architecture/`), textured with the CC0 materials above.
- The basketball (canvas-generated leather and seams), library catalogue screens, the ball, hoop and notification sounds (Web Audio synthesis) and the CampOS logo are generated at runtime.
- Basketball physics, seat anchors and door definitions live in `shared/` and are original code.

## Libraries and fonts

- Three.js (MIT) and its meshopt decoder (MIT); the Basis Universal transcoder in `public/assets/basis/` (Apache-2.0, distributed with Three.js); React Three Fiber, React and Zustand (MIT); postprocessing (Zlib); N8AO (ISC); Lucide icons (ISC).
- DM Sans and Manrope via `@fontsource-variable` (SIL Open Font License), bundled locally with system-font fallbacks.

`docs/screenshots/` contains real browser captures, not concept renders. The campus, its buildings, menus, books and classes are fictional demonstration content and do not represent any real institution's services.
