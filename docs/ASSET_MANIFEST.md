# Asset manifest

The project already keeps a licence ledger for every downloaded asset in [ASSETS.md](ASSETS.md) (generated from each
build script's ledger), with per-pack manifests beside the files:

| Pack | Manifest | Origin |
|---|---|---|
| Campus characters, animation, environment, props, sound | [ASSETS.md](ASSETS.md) | Microsoft Rocketbox (MIT), Poly Haven (CC0), Kenney (CC0), OpenGameArt (CC0) |
| Combat Arena surfaces, props, soldiers, weapons, audio | [ASSETS.md](ASSETS.md) § Combat Arena, `.asset-cache/ledger-arena.json` | Poly Haven (CC0), CC BY 4.0 works credited in-game, original synthesis |
| Operation: Metropolis surfaces and street props | `public/assets/arena/metropolis.json` | Poly Haven (CC0) |
| Phone tier | `public/assets/arena/mobile/manifest.json` | Derived (top mip levels dropped) |
| **Blender-authored props** | **`public/assets/arena/blender.json`** | **Original: modelled and baked by `blender/build.py`** |

This page adds the Blender-authored set; it does not repeat the ledgers above.

## Blender-authored props (November 2026)

The vehicles (added in the ultimate-FPS pass) load before deployment like the other props, because they are built into
the city's static art. They add **2.70 MB** to a desktop's first deployment and **1.40 MB** to a phone's (the phone tier
drops the top mip level); the service-worker cache keeps them, so later visits do not download them again. The lorry
(`truck`) is still drawn by code.

Seen in the game (Metropolis, day, Medium, live room server):
`docs/screenshots/metropolis-photoreal/vehicles-after/day-veh-{bus,van,car,pickup}-medium.jpg`. The captures found a
pipeline defect. `blender/build.py` left each baked asset at the origin, so every later asset was baked overlapping
the earlier ones, and their geometry crushed its ambient occlusion. Mean AO by bake order: silver saloon 120 (first,
clean), red saloon 43, pickup 96, bus 78, box van 7.5. In game the van rendered black in shade. Assets are now baked
alone. The four vehicles and the six earlier props were rebaked (red saloon 121, pickup 117, bus 82, box van 123);
the bus's lower figure comes from its own overlapping window and pillar panels.

Source scene: `blender/source/metropolis_props.blend` (objects `SM_<key>`). Build: [BLENDER_ASSET_PIPELINE.md](BLENDER_ASSET_PIPELINE.md).
Box sizes are length × depth × height in metres, as in the collision map.

| File | Family | Collision box | Triangles | Textures | Size | Dresses (box type × copies on the map) |
|---|---|---|---|---|---|---|
| `props/roofTank.glb` | Rooftop | 1.7 × 1.7 × 2.5 | 6,892 | 512² | 196 KB | `tank` × 6: ribbed polyethylene water tank, braced angle-iron stand, inlet, outlet with gate valve, overflow |
| `props/roofAC.glb` | Rooftop | 1.4 × 1 × 1.15 | 4,976 | 512² | 207 KB | `ac` × 6: top-discharge condensing unit, louvred coil on three sides, fan and guard, service valves, copper and insulated lines, disconnect switch, rails |
| `props/roofVent.glb` | Rooftop | 2.2 × 1.4 × 1.5 | 2,536 | 512² | 174 KB | `vent` × 4: galvanised ventilation unit on a bolted curb, standing seams, louvred intake, access door, two mushroom exhausts |
| `props/utilityCabinet.glb` | Street | 1.1 × 0.9 × 1.25 | 1,620 | 512² | 133 KB | `utility` × 6: feeder pillar on a concrete plinth, double doors, hinges, louvres, T-handle and lock, warning and asset plates |
| `props/wasteBin.glb` | Street | 1.2 × 1 × 1.3 | 3,032 | 512² | 182 KB | `bin` × 8: four-wheel galvanised refuse container, castors, tapered ribbed body, lifting comb, trunnions, split plastic lid |
| `props/forklift.glb` | Industrial | 2.5 × 1.3 × 2.1 | 6,988 | 512² | 250 KB | `forklift` × 2: LPG counterbalance forklift: mast, chains, lift and tilt cylinders, carriage, backrest, forks, overhead guard, seat, controls, lamps, beacon |
| `props/sedanSilver.glb` | Vehicles | 4.3 × 1.8 × 1.45 | 9,896 | 1024² | 545 KB (phone 285 KB) | `car` (alternating with the red one): lofted saloon body with wheel arches, alloy wheels, glazing with A/B/C pillars, lamps, grille, bumpers, mirrors, handles, door seams, wipers, exhaust |
| `props/sedanRed.glb` | Vehicles | 4.3 × 1.8 × 1.45 | 9,896 | 1024² | 563 KB (phone 289 KB) | `car`: the same saloon in red |
| `props/pickup.glb` | Vehicles | 5.2 × 1.95 × 1.9 | 12,554 | 1024² | 608 KB (phone 332 KB) | `pickup` × 2: double-cab utility, covered load bed with rails and tie-downs, roll bar, bull-bar, steel wheels, arch flares, step bars, tow bar |
| `props/cityBus.glb` | Vehicles | 9.4 × 2.55 × 3.1 | 7,280 | 1024² | 467 KB (phone 237 KB) | `bus` × 2: low-floor city bus, navy skirt, glazed band, kerb-side doors, louvred engine bay, roof air-conditioning pod (route sign and lit board drawn by the game) |
| `props/boxVan.glb` | Vehicles | 6.4 × 2.3 × 2.9 | 8,320 | 1024² | 516 KB (phone 257 KB) | `van` × 2: box truck, lofted cab, ribbed box with rails and posts, rear portal with doors, hinges and locking bars (livery drawn by the game) |

## Blender-authored weapon parts

| Part | Merged into | Triangles | Textures | What |
|---|---|---|---|---|
| `sparrowMag` (`blender/source/weapon_parts.blend`) | `weapons/sparrow.glb` as `mag` (+59 KB) | 1,140 | 256² | Single-stack 9 mm magazine sized to the grip (1.85 × 2.7 × 8.3 cm): steel body, spine, witness holes, feed lips with the top round, polymer baseplate. The licensed model fused the magazine inside its grip; merged by `scripts/assets/add-weapon-part.mjs`. |

## Orisun Freight — The Getaway

The new original assets were authored for CampOS Worlds. Their source is `blender/source/getaway_district.blend` and the reproducible generator is `blender/getaway_district.py`. The source and exported meshes contain no marketplace or GTA content.

| Runtime GLB | Contents | Triangles | Compressed bytes |
| --- | --- | ---: | ---: |
| `getaway/bay04Shell.glb` | Portal warehouse, profiled roof, glazing, roller grille, canopy, downpipes | 3,774 | 54,784 |
| `getaway/bay04Fittings.glb` | Rack assemblies, boards, conduit and practical light fixtures | 4,864 | 67,836 |
| `getaway/freightGround.glb` | Asphalt, jointed concrete apron, loading marks, drainage grating | 5,844 | 76,064 |
| `getaway/freightFixtures.glb` | Welded gates, railings, bollards and yard lamps | 5,040 | 62,352 |
| `getaway/freightDepots.glb` | Six varied secondary buildings, service doors and roof extraction | 11,228 | 110,340 |
| **Total** | | **30,750** | **371,376** |

- **Material scans** use the campus asphalt, concrete, box-profile metal and wood KTX2 sets. Sources and license are recorded in the [campus asset inventory](ASSETS.md#environment--cc0-poly-haven).
- **Reused CC0 scans** include the wooden military crate, fuel drum, concrete barrier, portable generator, old tyre, plastic crate, cardboard box and hand truck. High and 512² mobile variants already ship in the Arena and Metropolis asset packs. [Arena source credits](ASSETS.md#photoscanned-props--cc0-poly-haven) · [Metropolis source ledger](../public/assets/arena/metropolis.json)
- **Reused original CampOS artwork** includes the freight containers and their LOD, truss, intelligence case, Blender forklift and cabinet, waste bin and roof vent. The compact, shuttle and response cars use the existing drivable chassis with original projectors, grille details, finishes and livery. [Blender asset pipeline](BLENDER_ASSET_PIPELINE.md)
- **Reused Rocketbox avatars and animations** include the selectable campus player, Sade and two military rigs. Microsoft Rocketbox is MIT, copyright © 2020 Microsoft. The male locomotion library is shared with campus and Arena. [Character and rig credits](ASSETS.md)
- **Reused licensed weapon and arms meshes** include the Sparrow, Vanguard, Bastion and rigged gloves. Sources, CC0 and CC BY 4.0 terms, and attribution are recorded for each exact model in the existing inventory. [Weapon and arm credits](ASSETS.md#weapons-and-first-person-arms)
- **Acquisition review** covered Quixel Megascans listings and Fab’s terms for incorporated assets, along with Poly Haven’s CC0 terms. The slice uses the repository’s existing world-ready scans, optimized derivatives and original assets. [Quixel catalogue](https://www.fab.com/sellers/Quixel%20Megascans) · [Fab Standard License](https://www.fab.com/eula) · [Poly Haven license](https://polyhaven.com/license)

### Harbour Exchange source and scene binding

| Runtime asset | Source | Use |
| --- | --- | --- |
| `harbour/block-{0,1,2}-{0,1,2}.glb` | `blender/source/harbour_exchange.blend` | Commercial façades, roof equipment, recesses, shop displays, sidewalks and curb edges. Streaming and shared parcel footprints come from `shared/harbour.mjs`. |
| `harbour/freight-gantry.glb` | Same Blender scene | Freight-yard crane. Its supporting feet are shared collision geometry in `shared/getaway.mjs`. |

The Blender scenes contain original CampOS geometry. Both environments use the existing licensed texture library. See [asset licenses](ASSETS.md) for the Poly Haven surface sets, Rocketbox character rigs and motion clips, and Arena weapons and props.
