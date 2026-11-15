"""Build CampOS Worlds Blender assets headlessly.

Usage (Blender's Python API as a module, `pip install bpy`; or `blender -b -P blender/build.py -- [keys]`):
    python blender/build.py [key ...] [--size 1024]

1. Models every asset (blender/assets/*.py) into one scene, organised into collections, and saves the procedural
   source as blender/source/metropolis_props.blend (no baked images: they are build products).
2. Per asset: Smart UV project, Cycles bake (albedo, roughness, metal, AO, tangent normal), one export material.
3. Exports .asset-cache/blender/<key>.glb (+ PNGs) and .asset-cache/blender/report.json (size, triangles, box).
   `node scripts/assets/build-blender-props.mjs` then compresses them into public/assets/arena/props/.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(HERE, 'lib'), os.path.join(HERE, 'assets')]

import bpy  # noqa: E402

import campos  # noqa: E402
from metropolis_props import ASSETS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
size = 1024
if '--size' in argv:
    i = argv.index('--size'); size = int(argv[i + 1]); del argv[i:i + 2]
keys = argv or list(ASSETS)
STAGE = os.path.join(ROOT, '.asset-cache', 'blender')
os.makedirs(STAGE, exist_ok=True)
os.makedirs(os.path.join(HERE, 'source'), exist_ok=True)

campos.reset_scene()
built = {}
for key, (family, fn) in ASSETS.items():
    ob, box = fn(campos.collection(family))
    built[key] = (ob, box)
    dims = tuple(round(d, 3) for d in ob.dimensions)
    print(f'{key:16s} {campos.triangles(ob):6d} tris  dims {dims}  box {box}')
    # Lay assets out side by side in the source file (export resets location).
    ob.location.x = sum(b[0] + 1 for _, b in list(built.values())[:-1])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'source', 'metropolis_props.blend'), compress=True)

report_file = os.path.join(STAGE, 'report.json')
report = json.load(open(report_file)) if os.path.exists(report_file) else {}
for key in keys:
    ob, box = built[key]
    t = time.time()
    ob.location = (0, 0, 0)
    campos.unwrap(ob)
    campos.bake_asset(ob, STAGE, size)
    campos.export_glb(ob, os.path.join(STAGE, f'{key}.glb'))
    report[key] = {'family': built[key][0].users_collection[0].name, 'triangles': campos.triangles(ob),
                   'dimensions': [round(d, 3) for d in ob.dimensions], 'collisionBox': box, 'textureSize': size,
                   'blendSource': 'blender/source/metropolis_props.blend', 'object': ob.name}
    print(f'  baked + exported {key} in {time.time() - t:.0f}s')
    json.dump(report, open(report_file, 'w'), indent=2)
