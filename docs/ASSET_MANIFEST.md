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
