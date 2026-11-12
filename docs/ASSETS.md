# Asset provenance and licences

Every runtime asset is stored in `public/assets/` and served by the app itself: there are no third-party URLs at runtime. Downloaded sources are converted by the scripts in `scripts/assets/` (KTX2/Basis textures, meshopt-compressed glTF), and each build writes a ledger of what it fetched, from where, and under which licence. The tables below are generated from those ledgers.

## Characters and animation — MIT

| Asset | Source | Licence |
|---|---|---|
| `characters/*.glb` (Tunde, Chidi, Ibrahim, Ada, Amara, Mel and the other selectable students) | [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox), adult avatars (each character's exact source folder is listed in `characters/manifest.json`) | MIT, © 2020 Microsoft |
| `characters/anim-m.glb`, `anim-f.glb` | Rocketbox motion-capture clips: idle, look, walk, jog, run, wave, dance, cheer, sit down / stand up (chair and table), seated idle, seated look, seated at table, door push / pull, crouch, holding (used as an arm-only layer) | MIT, © 2020 Microsoft |

The store's premium characters are Rocketbox avatars too: Emeka (`Professions/Business_Male_05`), Folake (`Adults/Female_Party_02`) and Seun (`Professions/Sports_Male_03`). They were built with `node scripts/assets/build-characters.mjs <id>` like the rest of the cast.

Skin-tone variation is a shader tint driven by a skin mask baked by `scripts/assets/build-characters.mjs`. The accessories are procedural geometry: the backpack, headphones and glasses, plus the store's cap, beanie and gold aviators. These are fitted to each character's head and hair at runtime (`src/avatar/Avatar.tsx`).

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
| Doors opening and closing, latches, clothes, creaks (`door-*`, `cloth`, `creak`) | [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney |
| Car doors, engine start, idle loop and shut-off (`car-door-*`, `engine*`) | [Car Sound Effects Pack](https://opengameart.org/content/car-sound-effects-pack-low-quality) | GGBotNet |
| Birdsong, breeze and running water (`birds`, `wind`, `water`) | [Park ambiences](https://opengameart.org/content/park-ambiences) | Thimras |

Tyre noise on the road, the garden cart's electric motor and chair legs scraping on the floor are synthesized at runtime (Web Audio).


## Combat Arena — loaded only when a match opens

Built by `node scripts/assets/build-arena.mjs [textures|props|characters|weapons]` into `public/assets/arena/` (KTX2/Basis textures, meshopt glTF). The build records every source in `.asset-cache/ledger-arena.json`; the table below is that ledger. CC BY 4.0 works are also credited in the game (Combat Arena lobby → **Art credits**), with the changes made to them.

### PBR surfaces — CC0 (Poly Haven)

| Asset | Used for | Source |
|---|---|---|
| `arena/textures/concreteWall/{color,normal,arm}.ktx2` | concrete walls, perimeter panels | [concrete_wall_006](https://polyhaven.com/a/concrete_wall_006) |
| `arena/textures/concreteFloor/{color,normal,arm}.ktx2` | yard slab, painted steel base | [concrete_floor_worn_001](https://polyhaven.com/a/concrete_floor_worn_001) |
| `arena/textures/road/{color,normal,arm}.ktx2` | access road | [road_damaged](https://polyhaven.com/a/road_damaged) |
| `arena/textures/gravel/{color,normal,arm}.ktx2` | margins | [gravel_concrete_03](https://polyhaven.com/a/gravel_concrete_03) |
| `arena/textures/dirt/{color,normal,arm}.ktx2` | outer ground | [dry_ground_rocks](https://polyhaven.com/a/dry_ground_rocks) |
| `arena/textures/brick/{color,normal,arm}.ktx2` | brick buildings | [brick_wall_10](https://polyhaven.com/a/brick_wall_10) |
| `arena/textures/corrugated/{color,normal,arm}.ktx2` | container and shed cladding | [corrugated_iron_02](https://polyhaven.com/a/corrugated_iron_02) |
| `arena/textures/rustyCorrugated/{color,normal,arm}.ktx2` | weathered cladding | [rusty_corrugated_iron](https://polyhaven.com/a/rusty_corrugated_iron) |
| `arena/textures/paintedMetal/{color,normal,arm}.ktx2` | red containers | [rusty_painted_metal](https://polyhaven.com/a/rusty_painted_metal) |
| `arena/textures/metalPlate/{color,normal,arm}.ktx2` | floor plates, steps | [metal_plate](https://polyhaven.com/a/metal_plate) |
| `arena/textures/plywood/{color,normal,arm}.ktx2` | boarded openings | [plywood](https://polyhaven.com/a/plywood) |
| `arena/textures/planks/{color,normal,arm}.ktx2` | platforms, pallets | [wood_planks_grey](https://polyhaven.com/a/wood_planks_grey) |
| `arena/textures/plaster/{color,normal,arm}.ktx2` | interior walls | [painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall) |
| `arena/textures/sandbag/{color,normal,arm}.ktx2` | sandbags | [hessian_230](https://polyhaven.com/a/hessian_230) |

### Photoscanned props — CC0 (Poly Haven)

| Asset | Source | Author |
|---|---|---|
| `arena/props/jersey.glb` | [concrete_road_barrier](https://polyhaven.com/a/concrete_road_barrier) | Amal Kumar |
| `arena/props/milCrate.glb` | [wooden_military_crate](https://polyhaven.com/a/wooden_military_crate) | Prabhjinder Singh |
| `arena/props/oldCrate.glb` | [old_military_crate](https://polyhaven.com/a/old_military_crate) | Jack Mava |
| `arena/props/ammo.glb` | [ammo_box](https://polyhaven.com/a/ammo_box) | DanKit |
| `arena/props/barrel.glb` | [barrel_03](https://polyhaven.com/a/barrel_03) | Serhii Khromov |
| `arena/props/jerrycan.glb` | [metal_jerrycan_green](https://polyhaven.com/a/metal_jerrycan_green) | Ulan Cabanilla |
| `arena/props/generator.glb` | [portable_generator](https://polyhaven.com/a/portable_generator) | James Ray Cock |
| `arena/props/wallLamp.glb` | [industrial_wall_lamp](https://polyhaven.com/a/industrial_wall_lamp) | Kuutti Siitonen |
| `arena/props/securityLight.glb` | [security_light](https://polyhaven.com/a/security_light) | Maximilian Schuster |
| `arena/props/powerBox.glb` | [power_box_01](https://polyhaven.com/a/power_box_01) | Rico Cilliers, Yann Kervran |
| `arena/props/utilityBox.glb` | [utility_box_01](https://polyhaven.com/a/utility_box_01) | James Ray Cock |
| `arena/props/tyre.glb` | [old_tyre](https://polyhaven.com/a/old_tyre) | MP |
| `arena/props/propane.glb` | [propane_tank](https://polyhaven.com/a/propane_tank) | Slinc |
| `arena/props/crate.glb` | [wooden_crate_02](https://polyhaven.com/a/wooden_crate_02) | James Ray Cock, Jurita Burger |

### Soldiers — MIT (Microsoft Rocketbox)

| Asset | Source |
|---|---|
| `arena/characters/soldier-m1.glb` and its team-B camouflage textures | [Professions/Military_Male_01](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Professions/Military_Male_01) — MIT, © 2020 Microsoft. Team camouflage recoloured by the build. |
| `arena/characters/soldier-m2.glb` and its team-B camouflage textures | [Professions/Military_Male_03](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Professions/Military_Male_03) — MIT, © 2020 Microsoft. Team camouflage recoloured by the build. |
| `arena/characters/soldier-f1.glb` and its team-B camouflage textures | [Professions/Military_Female_01](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Professions/Military_Female_01) — MIT, © 2020 Microsoft. Team camouflage recoloured by the build. |

### Weapons and first-person arms

Sketchfab works are fetched from the [Objaverse](https://huggingface.co/datasets/allenai/objaverse) mirror of CC-licensed Sketchfab models. **Changes** (all of them): re-oriented and scaled to metres with the bore along −z, loose display items removed (cartridges, spare magazines, a deployed bipod, a second pistol variant), meshes merged, moving parts split out by name, textures recompressed to KTX2, and a simplified third-person LOD derived. In-game names are original; real-world model names appear only in this attribution.

| Asset | In game | Work | Author | Licence |
|---|---|---|---|---|
| `arena/weapons/vanguard.glb (+ vanguard-lod.glb)` | Vanguard AR-7 | [SLR AR-15](https://sketchfab.com/3d-models/429b6ef8516b46dca8992e78c4bf7a55) | AlexFinsher | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/halcyon.glb (+ halcyon-lod.glb)` | Halcyon BR | [AK-74M Assault Rifle](https://sketchfab.com/3d-models/9084c3bae8224d338103997bc3101480) | FJH | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/wasp.glb (+ wasp-lod.glb)` | Wasp SMG | [HK MP5 (9mm submachine gun)](https://sketchfab.com/3d-models/c503d96157614fb78b5953d49e643b78) | quick_loop | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/kestrel.glb (+ kestrel-lod.glb)` | Kestrel SMG | [Saiga-9mm](https://sketchfab.com/3d-models/3d031dfeb2ad45beb19e89977225a631) | rwroclav | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/bastion.glb (+ bastion-lod.glb)` | Bastion shotgun | [Remington 870 Police Magnum 12 Gauge Shotgun](https://sketchfab.com/3d-models/eea11de7e9d24b6683962b8388c319eb) | 8sianDude | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/rampart.glb (+ rampart-lod.glb)` | Rampart shotgun | [M4 Super 90 (JW2) Brand-Friendly version](https://sketchfab.com/3d-models/7e472e24152246708cac8b6f1613c7a8) | 8sianDude | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/longbow.glb (+ longbow-lod.glb)` | Longbow SR | [Sniper rifle GameReady Free](https://sketchfab.com/3d-models/e520b234140049e7890db0b6c29d3925) | pashtetuser | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/talon.glb (+ talon-lod.glb)` | Talon DMR | [HK G28 Sniper Rifle](https://sketchfab.com/3d-models/997840668e1e4c1384c7220563323085) | trolosqlfod | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/anvil.glb (+ anvil-lod.glb)` | Anvil LMG | [LMG](https://sketchfab.com/3d-models/8c24d7374ea64bdab1c30f49c69d5ed8) | DJMaesen | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/sparrow.glb (+ sparrow-lod.glb)` | Sparrow pistol | [Service Pistol](https://polyhaven.com/a/service_pistol) | Poly Haven | CC0 1.0 |
| `arena/weapons/thorn.glb (+ thorn-lod.glb)` | Thorn revolver | [Revolver .357 Magnum](https://sketchfab.com/3d-models/360c6276282e48109fcca66f31004d81) | Artem Goyko | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/knife.glb (+ knife-lod.glb)` | Combat Knife | [Combat Knife](https://sketchfab.com/3d-models/5969d3423b6d42428d2f396441d99243) | Aver1 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `arena/weapons/hammer.glb (+ hammer-lod.glb)` | Breach Axe | [Hatchet](https://polyhaven.com/a/hatchet) | Poly Haven | CC0 1.0 |
| `arena/weapons/arms.glb` | First-person arms (rigged, gloved) | [First Person arms](https://sketchfab.com/3d-models/e3c42c05b22944e5839deb8e003f0987) | DJMaesen | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Weapon anchors (grips, sights, ejection ports) and hand frames are authored in `src/arena/scene/weapons.ts`; the arms are posed by inverse kinematics at run time.

### Phone texture tier and arena sound

- `public/assets/arena/mobile/` holds the same environment textures, props and soldiers as above with each KTX2
  texture's largest mip level removed (`scripts/assets/build-arena-mobile.mjs`): derived files under the same
  licences, no new sources.

### Arena sound — CC0, CC BY 3.0, CC BY-SA 3.0/4.0

Built by `node scripts/assets/build-arena-audio.mjs` into `public/assets/arena/audio/` (36 MP3 sprite banks, loaded on
demand) from real recordings: the Free Firearm Sound Library (CC0) for every gunshot, Gary's *Handling Guns*
(CC BY-SA 3.0) for weapon mechanisms, BigSoundBank (CC0) for footsteps, Foley, cases, impacts, explosions, breathing
and ambience, congusbongus/swuing/Eelke (CC BY 3.0), Fantozzi and HaelDB (CC0) for footsteps and gear, VoiceBosch
(CC BY-SA 4.0), Michel Baradari (CC BY 3.0), HaelDB and AuraVoice (CC0) for soldier voices and the announcer, Kenney,
rubberduck (CC0) and dklon (CC BY 3.0) for the interface, debris and Foley. Every recording, its author, licence and
the bank that uses it: [docs/audio/LICENSES.md](audio/LICENSES.md) (generated by the build); every bank and clip:
[docs/audio/INVENTORY.md](audio/INVENTORY.md). The banks made from CC BY-SA recordings are shared under the same
licence. CC BY and CC BY-SA works are credited in the game (Combat Arena lobby → **Sound credits**) with the changes
made. The arena no longer uses the campus footsteps and wind (the campus still does).

## Authored for this project

- Campus architecture, doors, benches, tables, desks, counters, signage, sculpture, water and landscaping layout are procedural geometry (`src/world/architecture/`), textured with the CC0 materials above.
- The basketball (canvas-generated leather and seams), library catalogue screens, the ball, hoop and notification sounds (Web Audio synthesis) and the CampOS logo are generated at runtime.
- Basketball physics, seat anchors and door definitions live in `shared/` and are original code.

## Libraries and fonts

- Three.js (MIT) and its meshopt decoder (MIT); the Basis Universal transcoder in `public/assets/basis/` (Apache-2.0, distributed with Three.js); React Three Fiber, React and Zustand (MIT); postprocessing (Zlib); N8AO (ISC); Lucide icons (ISC).
- DM Sans and Manrope via `@fontsource-variable` (SIL Open Font License), bundled locally with system-font fallbacks.

`docs/screenshots/` contains real browser captures, not concept renders. The campus, its buildings, menus, books and classes are fictional demonstration content and do not represent any real institution's services.
