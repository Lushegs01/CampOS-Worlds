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

Totals: 26,044 triangles across six models (one material each), 1.12 MB for the full tier. The phone tier is the
same size, because the textures are already 512². Licence: project-original. No third-party mesh, texture or scan
is used in these files.
