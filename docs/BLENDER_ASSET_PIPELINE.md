# Blender asset pipeline

How CampOS Worlds models, bakes and ships original 3D assets with Blender, and how they reach the Combat Arena.

## What runs where

| Step | Command | Output |
|---|---|---|
| Model, unwrap, bake, export | `python blender/build.py [key …] [--size 512] [--model-only]` | `blender/source/metropolis_props.blend` (procedural source), `.asset-cache/blender/<key>.glb` + PNGs + `report.json` (staging, git-ignored) |
| Compress for the game | `node scripts/assets/build-blender-props.mjs [key …]` | `public/assets/arena/props/<key>.glb` (Basis KTX2 textures, meshopt geometry), `public/assets/arena/blender.json` |
| Phone tier | `node scripts/assets/build-arena-mobile.mjs` | `public/assets/arena/mobile/props/<key>.glb` |
| Review render | `python blender/preview.py out.png <key> …` | Cycles turntable-angle stills of the exported GLBs |
| Test | `node --test tests/arena-blender-props.test.mjs` | Manifest, both tiers decode, bounds match collision box, budgets |

`python` is any Python 3.13 with Blender's API installed as a module (`pip install bpy`, Blender 5.3). The same script
also runs inside a Blender install: `blender -b -P blender/build.py -- roofTank`. The two `pip` packages needed besides
`bpy` are `numpy` (bundled with `bpy`) and `pillow`.

**Blender MCP.** The production brief asked for a live Blender MCP connection. None was connected to the session that
built this pipeline, so everything here was produced headlessly through the same Blender Python API (`bpy` 5.3) with
no interactive scene. The scripts work unchanged from an MCP session or the Blender UI's text editor.

## Asset modules

`blender/build.py` builds each module into its own editable source scene:

| Module | Source | Assets |
|---|---|---|
| `blender/assets/metropolis_props.py` | `blender/source/metropolis_props.blend` | roof tank, condensing unit, ventilation unit, feeder pillar, refuse container, forklift |
| `blender/assets/metropolis_vehicles.py` | `blender/source/metropolis_vehicles.blend` | silver and red saloons, pickup, city bus, box van |
| `blender/assets/weapon_parts.py` | `blender/source/weapon_parts.blend` | the Sparrow's magazine |

* **Vehicles** have lofted bodies (`loft()`: cross-sections sampled along the length, wheel arches cut into the sides)
  plus parts from the kit. They are baked at 1024² and have their own triangle budget (≤ 14,000) in
  `tests/arena-blender-props.test.mjs`.
* **Weapon parts** are not shipped as props: `node scripts/assets/add-weapon-part.mjs <weapon>` compresses the part
  and merges it into the licensed weapon model as the moving part the animator looks for (`mag`, `bolt` …). It places
  and tilts the part from the weapon's measurement sheet.
* `--model-only` builds and saves the source scenes without baking: use it, with a quick Cycles render, to check
  shape and fit before spending the bake time (about 3–4 minutes per vehicle on CPU).

## Layout

```text
blender/
  build.py                  entry point: model every asset, save the .blend, bake + export the requested keys
  preview.py                review renders of exported GLBs
  lib/campos.py             geometry kit (bmesh), procedural PBR recipes, UV, Cycles bake, glTF export
  assets/metropolis_props.py   the Operation: Metropolis prop set (one function per asset)
  source/metropolis_props.blend   procedural source scene (collections Rooftop / Street / Industrial)
scripts/assets/build-blender-props.mjs   staging → KTX2 + meshopt → public/assets/arena
```

Source, staging and production are separate: `.blend` sources are committed, baked PNGs and raw GLBs are build
products in `.asset-cache/blender/`, and only compressed GLBs are shipped.

## Conventions

* **Units and axes.** Metres; Blender +Z up (exported as glTF +Y up). Long axis +X; pivot at the centre of the base.
* **Size.** Each prop is modelled to the exact collision box it dresses in `shared/arena/metropolis.mjs` and is placed
  by `hero()` in `src/arena/scene/city/props.ts`, which scales it to the box. Collision is never derived from art.
* **Names.** Object `SM_<key>`, mesh `ME_<key>`, export material `M_<key>`, procedural materials named by surface
  (`galv`, `poly_black`, `fork_yellow` …). One collection per family.
* **Geometry.** All parts of an asset are one mesh built in `bmesh`: boxes with real bevels, lathed bodies, pipes with
  elbow fittings. Shading is smooth with sharp edges above 50°, so bevels catch light and hard corners stay crisp.
* **Materials.** Source materials are procedural Cycles node trees made from a `Surface` recipe: base colour with
  variation, cavity grime from ambient occlusion, run-off streaks, rust blooms, dust on upward faces, paint chipped off
  convex edges (curvature from the Bevel node), roughness and metal to match, and fine bump. None of these nodes is
  glTF-compatible, so they are always baked.
* **Bake.** Smart UV project (55°) and concave island packing; Cycles CPU bakes albedo, roughness and metal (each routed
  through an emission shader), ambient occlusion (48 samples) and a tangent-space normal map. AO is kept in the
  occlusion channel and also multiplied into albedo at 45 % so small props keep their contact shading under direct
  sun (three.js applies `aoMap` to indirect light only). Packed as glTF expects: base colour (sRGB), normal, and
  occlusion/roughness/metal in R/G/B.
* **Export material.** One material per asset (one draw call per instanced batch), with the glTF occlusion socket wired
  through a `glTF Material Output` group.
* **Budgets.** ≤ 8,000 triangles and one 512² texture set per street-scale prop (≈ 130–250 KB compressed). They are
  drawn as `InstancedMesh` batches, at most 8 copies each, so they carry no LODs; a prop that will be instanced in
  large numbers or seen from far away needs an LOD before it is added.
* **Fallback.** Blender props are optional at run time: if one fails to download, the city draws its earlier code
  geometry in the same box (`HERO_PROPS` in `src/arena/scene/library.ts`).

## Adding an asset

1. Find (or add, with the server and tests) the collision box it will dress and note its size.
2. Write a function in `blender/assets/` that builds it with `Kit` to that size, and add it to `ASSETS`.
3. `python blender/build.py <key>`; review it with `python blender/preview.py /tmp/p.png <key>`.
4. `node scripts/assets/build-blender-props.mjs <key> && node scripts/assets/build-arena-mobile.mjs`.
5. Add the key to `HERO_PROPS` and a `hero('<key>', box, P)` call in front of the box type's code geometry.
6. Add the key to `HERO` in `tests/arena-blender-props.test.mjs`; run it.

Every asset in this pipeline is original work made by these scripts; there is no third-party mesh or texture in them.

## Shadow Protocol — The Getaway

The editable Industrial District prop source is `blender/source/getaway.blend`. It contains the freight container, its lower-detail mesh, the intelligence case, and the warehouse truss. Both container meshes use the same base pivot so they fit the same collision box. The assets carry UVs and a single vertex-color PBR material, with one mesh primitive per export and no texture downloads.

```sh
blender -b -t 2 --python-exit-code 1 -P blender/getaway.py
node scripts/assets/optimize-getaway.mjs
python3 scripts/audio/getaway-score.py
```

The Blender commands export and compress to `public/assets/getaway/` and record the triangle counts, dimensions, and byte sizes in `models.json`. The Python score renderer uses FFmpeg to write three phase-aligned MP3 loops to the same directory. The campus loader also uses existing Arena GLBs for the loadout, crates, and barrel. It fits the props to the authoritative collision boxes in `shared/getaway.mjs`. The existing campus vehicles and avatars supply the driving model and character animation.

The browser plays existing recorded effects through the campus volume controls and crossfades the original score with the mission state. Each reused sample retains the credits in `docs/audio/LICENSES.md` and the repository's asset documentation. Mission dialogue is presented in text.
