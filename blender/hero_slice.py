"""Commercial District hero slice: Coastal Bank (Harbour Exchange block-0-1, building 0), a production car for the
district's drivable compact, and the street dressing in front of the bank.

Usage:  python blender/hero_slice.py [--out DIR]       (Blender's Python API as a module: `pip install bpy`, 5.3)
Output: DIR (default .asset-cache/hero/) hero-bank.glb, hero-bank-lod1.glb, hero-car.glb, hero-street.glb, report.json
        and the editable source scene blender/source/hero_slice.blend.
        `node scripts/assets/build-hero-slice.mjs` compresses them (meshopt) into public/assets/harbour/hero/.

Conventions (see docs/BLENDER_ASSET_PIPELINE.md): metres, Blender +Z up (glTF +Y up). The street side of every
asset faces Blender -Y, which the glTF exporter turns into the game's +Z (the bank's front, the car's nose).

Materials are *named slots*, not baked textures: each name is a key of the game's material library
(src/world/materials.ts: plaster, brick, granite, glass, glassClear, bronzeFrame ...) or of the hero car's paint
set (src/world/heroSlice.ts). The game binds them to its tiling PBR scans at load time, so the hero assets share
textures with the rest of the city (no new texture downloads), get the weathering layer, and respond to rain and
night (wet darkening, puddles, lit rooms) through src/world/environment.ts. UVs are in metres for the tiling scans.

Footprints: the bank stays inside its 20 x 30 m collision box (shared/harbour-local.mjs) at ground level; the canopy
and balconies project over the plaza only above 3.5 m. The car is modelled to VEHICLE_TYPES.car (4.3 x 1.78 m,
wheelbase 2.6 m, wheel radius 0.31 m). Street furniture dresses the existing colliders (HARBOUR_FURNITURE).
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(HERE, 'lib'), os.path.join(HERE, 'assets')]

import bpy  # noqa: E402  (bpy first: it makes bmesh importable)
import bmesh  # noqa: E402,F401
from mathutils import Matrix, Vector  # noqa: E402

import campos  # noqa: E402
from campos import Kit  # noqa: E402
from metropolis_vehicles import arch_bottom, keys, loft  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(ROOT, '.asset-cache', 'hero')
os.makedirs(OUT, exist_ok=True)

# Fallback looks for every slot (used only if the game has no binding for a name, and in Blender previews).
SLOTS = {
    # building library names
    'plaster': ((.78, .74, .66), .9, 0), 'brick': ((.45, .22, .15), .85, 0), 'granite': ((.42, .4, .38), .45, 0),
    'concrete': ((.6, .58, .54), .85, 0), 'terrazzo': ((.7, .68, .64), .3, 0), 'wood': ((.4, .26, .16), .6, 0),
    'aluminium': ((.6, .61, .62), .35, 1), 'bronzeFrame': ((.25, .18, .12), .4, .8), 'darkMetal': ((.06, .065, .07), .4, .7),
    'steel': ((.45, .46, .47), .45, 1), 'chrome': ((.8, .8, .8), .12, 1), 'paintDark': ((.035, .045, .05), .5, 0),
    'paintWhite': ((.8, .79, .75), .45, 0), 'glass': ((.03, .05, .06), .05, 0), 'glassClear': ((.5, .6, .62), .03, 0),
    'emissiveWarm': ((1, .9, .7), .5, 0), 'rubber': ((.03, .03, .03), .85, 0), 'fabricTerracotta': ((.45, .17, .1), .9, 0),
    'soil': ((.12, .07, .04), .95, 0), 'roofGreen': ((.2, .25, .2), .8, 0), 'paversGrey': ((.5, .5, .48), .8, 0),
    # hero-only slots (bound in src/world/heroSlice.ts)
    'roofMembrane': ((.09, .095, .1), .8, 0), 'solar': ((.02, .04, .09), .08, .3), 'screen': ((.05, .2, .3), .2, 0),
    'leaf': ((.06, .16, .05), .7, 0), 'leafLight': ((.12, .24, .07), .7, 0), 'bark': ((.2, .14, .1), .9, 0),
    'tank': ((.07, .1, .14), .55, 0), 'castIron': ((.04, .045, .045), .6, .6), 'brand': ((.0, .25, .32), .5, 0),
    'artwork': ((.55, .35, .2), .7, 0),
    # hero car
    'paint': ((.33, .04, .035), .3, .2), 'carGlass': ((.02, .03, .035), .05, 0), 'trim': ((.03, .03, .032), .6, 0),
    'tread': ((.02, .02, .02), .9, 0), 'rim': ((.55, .56, .57), .3, .9), 'headlamp': ((.85, .87, .87), .08, .3),
    'taillamp': ((.45, .02, .02), .12, 0), 'indicator': ((.8, .38, .02), .12, 0), 'reverseLamp': ((.85, .85, .85), .1, 0),
    'plate': ((.82, .82, .76), .5, 0), 'chassis': ((.05, .05, .05), .75, 0), 'seatFabric': ((.06, .06, .065), .9, 0),
    'dash': ((.035, .036, .04), .65, 0), 'cabin': ((.16, .155, .15), .8, 0), 'carpet': ((.03, .03, .03), .95, 0),
    'mirrorGlass': ((.6, .62, .64), .02, 1), 'instrument': ((.1, .3, .33), .3, 0),
}


BANK_SLOTS = ['plaster', 'brick', 'granite', 'concrete', 'terrazzo', 'wood', 'aluminium', 'bronzeFrame', 'darkMetal', 'steel', 'chrome',
              'paintDark', 'paintWhite', 'glass', 'glassClear', 'emissiveWarm', 'fabricTerracotta', 'roofMembrane', 'solar', 'screen',
              'leaf', 'leafLight', 'tank', 'brand', 'artwork']


def slot(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    rgb, rough, metal = SLOTS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def kit(name, names):
    for n in names:
        slot(n)
    return Kit(name, list(names))


def metre_uv(ob):
    """Box-projected UVs in metres (the game's tiling scans are authored as metres per repeat)."""
    me = ob.data
    uv = me.uv_layers.new(name='Metre UV')
    for poly in me.polygons:
        axis = max(range(3), key=lambda j: abs(poly.normal[j]))
        u, v = [(1, 2), (0, 2), (0, 1)][axis]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[u], co[v])


def export(objects, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
        for c in o.children_recursive:
            c.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_cameras=False,
                              export_lights=False, export_animations=False, export_extras=False)


def tris(ob):
    return campos.triangles(ob)


# ============================================================================================ the bank
W, D = 20.0, 30.0
FRONT = -D / 2            # facade plane (Blender -Y is the street)
GF = 4.4                  # ground-floor height
FH = 3.4                  # upper storey height
FLOORS = 3
ROOF = GF + FH * FLOORS   # 14.6
WALL = .3                 # upper facade wall thickness
GLASS_Y = FRONT + WALL    # inner face of the facade wall (glazing plane upstairs)
BAYS = [-8.0, -4.0, 0.0, 4.0, 8.0]
BALCONY_BAYS = (1, 3)


def window(k, cx, z0, w, h, lod, sill=True, mullion=True, y=GLASS_Y, frame='aluminium'):
    """A window in a reveal: frame, glass, mullion/transom (LOD0), projecting sill with a drip."""
    x0, x1 = cx - w / 2, cx + w / 2
    k.span((x0, y - .05, z0), (x1, y - .01, z0 + h), 'glass')
    f = .06
    for a, b in (((x0, y - .1, z0), (x1, y - .02, z0 + f)), ((x0, y - .1, z0 + h - f), (x1, y - .02, z0 + h)),
                 ((x0, y - .1, z0), (x0 + f, y - .02, z0 + h)), ((x1 - f, y - .1, z0), (x1, y - .02, z0 + h))):
        k.span(a, b, frame)
    if mullion and lod == 0:
        k.span((cx - .025, y - .09, z0), (cx + .025, y - .03, z0 + h), frame)
        k.span((x0, y - .09, z0 + h * .7), (x1, y - .03, z0 + h * .7 + .05), frame)
    if sill:
        k.span((x0 - .07, FRONT - .07, z0 - .07), (x1 + .07, y - .05, z0), 'concrete')
        if lod == 0:
            k.span((x0 - .07, FRONT - .07, z0 - .085), (x1 + .07, FRONT - .05, z0 - .07), 'concrete')  # drip


def punched(k, x0, x1, z0, z1, opening, mat, y0=FRONT, y1=GLASS_Y):
    """A facade wall panel from x0..x1, z0..z1 with one rectangular opening (ox0, ox1, oz0, oz1)."""
    ox0, ox1, oz0, oz1 = opening
    if ox0 > x0:
        k.span((x0, y0, z0), (ox0, y1, z1), mat)
    if x1 > ox1:
        k.span((ox1, y0, z0), (x1, y1, z1), mat)
    if oz0 > z0:
        k.span((ox0, y0, z0), (ox1, y1, oz0), mat)
    if z1 > oz1:
        k.span((ox0, y0, oz1), (ox1, y1, z1), mat)


def railing(k, x0, x1, y0, y1, z, lod):
    """A steel balcony railing round the three open sides of a slab: posts, top and foot rails, flat balusters."""
    h = 1.05
    edges = [((x0, y1), (x1, y1)), ((x0, y0), (x0, y1)), ((x1, y0), (x1, y1))]
    for (ax, ay), (bx, by) in edges:
        k.beam((ax, ay, z + h), (bx, by, z + h), .06, .04, 'darkMetal', side=Vector((0, 0, 1)), bevel=.01)
        k.beam((ax, ay, z + .1), (bx, by, z + .1), .04, .03, 'darkMetal', side=Vector((0, 0, 1)))
        length = math.hypot(bx - ax, by - ay)
        posts = max(1, round(length / .9))
        for i in range(posts + 1):
            t = i / posts
            k.span((ax + (bx - ax) * t - .02, ay + (by - ay) * t - .02, z), (ax + (bx - ax) * t + .02, ay + (by - ay) * t + .02, z + h), 'darkMetal')
        if lod == 0:
            n = int(length / .11)
            for i in range(1, n):
                t = i / n
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                k.span((px - .007, py - .007, z + .12), (px + .007, py + .007, z + h - .02), 'darkMetal')


def plant(k, at, r, rng, leaves=40, mat='leaf'):
    """A leafy shrub: overlapping small leaf quads round a centre (a real silhouette, not a sphere)."""
    for _ in range(leaves):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-.2, 1))).normalized() * rng.uniform(.3, 1) * r
        p = Vector(at) + d
        n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        s = r * rng.uniform(.18, .3)
        M = campos.align(n)
        v = [k.bm.verts.new(p + M.to_3x3() @ Vector(c) * s) for c in ((0, -1, 0), (.45, 0, 0), (0, 1.1, 0), (-.45, 0, 0))]
        f = k.bm.faces.new(v)
        f.material_index = k.m(mat if rng.random() < .7 else 'leafLight')


def ac_unit(k, cx, cy, cz, lod, wall_y):
    """A split air-conditioner condenser on wall brackets, with its refrigerant pipe run."""
    k.box((cx, cy, cz), (.82, .3, .56), 'paintWhite', .02)
    if lod == 0:
        k.ring(.17, .012, 'darkMetal', at=(cx - .12, cy - .155, cz), M=Matrix.Rotation(math.pi / 2, 4, 'X'), seg=20, tube=4)
        for i in range(5):
            a = math.pi * i / 5
            k.beam((cx - .12 - .17 * math.cos(a), cy - .156, cz - .17 * math.sin(a)), (cx - .12 + .17 * math.cos(a), cy - .156, cz + .17 * math.sin(a)), .012, .006, 'darkMetal', side=Vector((0, 1, 0)))
        for i in range(6):
            k.span((cx + .14, cy - .157, cz - .2 + i * .07), (cx + .36, cy - .15, cz - .18 + i * .07), 'darkMetal')
        for s in (-1, 1):
            k.span((cx + s * .3 - .02, wall_y - .01, cz - .32), (cx + s * .3 + .02, cy + .1, cz - .28), 'steel')
        k.pipe([(cx + .41, cy, cz + .1), (cx + .55, wall_y - .05, cz + .1), (cx + .55, wall_y - .05, cz + 1.6)], .02, 'paintWhite', 6)


def bank(lod):
    rng = random.Random(7)
    k = kit('heroBank' + ('_lod1' if lod else ''), BANK_SLOTS)
    hw = W / 2
    # ---- masses: upper floors full depth; ground floor behind the banking hall
    k.span((-hw + .25, GLASS_Y, GF), (hw - .25, D / 2 - .25, ROOF), 'plaster')
    hall = FRONT + 4.6
    k.span((-hw + .25, hall, 0), (hw - .25, D / 2 - .25, GF), 'plaster')
    # ---- side and rear walls (plaster with floor bands), recessed side windows
    for s in (-1, 1):
        k.span((s * hw - .25 * s, FRONT, 0), (s * hw, D / 2, ROOF), 'plaster')
        for f in range(FLOORS):
            z0 = GF + FH * f
            k.span((s * (hw + .04), FRONT, z0 - .15), (s * (hw - .1), D / 2, z0 + .15), 'concrete')
            for wy in (-7.0, 0.0, 7.0):
                x = s * (hw + .001)
                k.span((x, wy - .7, z0 + .9), (x + s * .02, wy + .7, z0 + 2.6), 'glass')
                for a, b in (((wy - .78, z0 + .82), (wy + .78, z0 + .9)), ((wy - .78, z0 + 2.6), (wy + .78, z0 + 2.68)),
                             ((wy - .78, z0 + .82), (wy - .7, z0 + 2.68)), ((wy + .7, z0 + .82), (wy + .78, z0 + 2.68))):
                    k.span((x, a[0], a[1]), (x + s * .07, b[0], b[1]), 'aluminium')
                k.span((x, wy - .85, z0 + .76), (x + s * .1, wy + .85, z0 + .82), 'concrete')
    k.span((-hw, D / 2 - .25, 0), (hw, D / 2, ROOF), 'plaster')
    for f in range(FLOORS):
        z0 = GF + FH * f
        for wx in (-6, -2, 2, 6):
            y = D / 2 + .02
            k.span((wx - .7, y - .02, z0 + .9), (wx + .7, y, z0 + 2.6), 'glass')
            k.span((wx - .8, y - .02, z0 + .82), (wx + .8, y + .08, z0 + .9), 'concrete')
    # ---- ground floor: granite piers, plinth, fascia, shopfront glazing, recessed entrance
    piers = [(-hw, -9.2), (-3.5, -3.0), (3.0, 3.5), (9.2, hw)]
    for a, b in piers:
        k.box(((a + b) / 2, FRONT + .2, 1.8), (b - a, .5, 3.6), 'granite', .015)
    k.span((-hw, FRONT - .05, 0), (hw, FRONT + .35, .45), 'granite')
    k.span((-hw, FRONT - .07, 3.6), (hw, FRONT + .3, GF), 'paintDark')                 # fascia (the name is a game sign)
    k.span((-hw, FRONT - .09, 4.36), (hw, FRONT + .3, 4.44), 'aluminium')              # fascia cap
    shop_y = FRONT + .45
    for x0, x1 in ((-9.2, -3.5), (3.5, 9.2)):
        n = 4
        k.span((x0, shop_y, .45), (x1, shop_y + .02, 3.6), 'glassClear')
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            k.span((x - .035, shop_y - .06, .45), (x + .035, shop_y + .02, 3.6), 'bronzeFrame')
        for z in (.45, 2.85, 3.52):
            k.span((x0, shop_y - .07, z), (x1, shop_y + .02, z + .08), 'bronzeFrame')
    # ATM set into the right-hand bay's first pane.
    k.span((3.55, shop_y - .1, .45), (4.85, shop_y + .02, 2.85), 'steel')
    k.span((3.95, shop_y - .11, 1.45), (4.45, shop_y - .1, 1.8), 'screen')
    k.span((3.95, shop_y - .2, 1.12), (4.45, shop_y - .1, 1.32), 'darkMetal')            # keypad shelf
    k.span((3.75, shop_y - .14, 2.2), (4.65, shop_y - .1, 2.4), 'brand')                  # ATM header
    # Entrance recess: side returns, transom, double doors with push bars, soffit and threshold.
    door_y = FRONT + 1.7
    for s in (-1, 1):
        k.span((s * 2.98 - .02, shop_y, .0), (s * 2.98 + .02, door_y, 3.0), 'glassClear')
        k.span((s * 2.98 - .05, shop_y, 2.95), (s * 2.98 + .05, door_y, 3.03), 'bronzeFrame')
    k.span((-3.0, door_y, 2.5), (3.0, door_y + .02, 3.0), 'glassClear')
    k.span((-3.0, door_y - .06, 2.45), (3.0, door_y + .03, 2.53), 'bronzeFrame')
    for x0, x1 in ((-3.0, -1.0), (1.0, 3.0)):
        k.span((x0, door_y, 0), (x1, door_y + .02, 2.45), 'glassClear')
        k.span((x0 + .4, door_y - .05, 0), (x0 + .45, door_y + .02, 2.45), 'bronzeFrame') if lod == 0 else None
    for x0, x1 in ((-1.0, 0.0), (0.0, 1.0)):
        k.span((x0 + .02, door_y + .005, .02), (x1 - .02, door_y + .015, 2.43), 'glassClear')
        for a, b in (((x0, .0), (x1, .1)), ((x0, 2.35), (x1, 2.45)), ((x0, 0), (x0 + .07, 2.45)), ((x1 - .07, 0), (x1, 2.45))):
            k.span((a[0], door_y - .03, a[1]), (b[0], door_y + .04, b[1]), 'bronzeFrame')
        if lod == 0:
            k.rod((x0 + .2, door_y - .1, 1.05), (x1 - .2, door_y - .1, 1.05), .02, 'chrome', 8)
            for px in (x0 + .25, x1 - .25):
                k.rod((px, door_y - .1, 1.05), (px, door_y - .02, 1.05), .015, 'chrome', 6)
    k.span((-3.0, FRONT - .02, 3.03), (3.0, door_y, 3.1), 'plaster')                     # recess soffit
    k.span((-3.0, FRONT - .02, 0), (3.0, door_y, .03), 'granite')                         # threshold paving
    # ---- banking hall seen through the glass (LOD0 only)
    if lod == 0:
        k.span((-9.2, shop_y, 0), (9.2, hall, .04), 'terrazzo')
        k.span((-9.2, shop_y, 3.3), (9.2, hall, 3.36), 'plaster')                         # ceiling
        k.span((-9.25, shop_y, 0), (-9.2, hall, 3.36), 'plaster'); k.span((9.2, shop_y, 0), (9.25, hall, 3.36), 'plaster')
        for x in (-6.5, -2.0, 2.0, 6.5):
            for y in (shop_y + 1.1, hall - 1.2):
                k.span((x - .6, y - .3, 3.28), (x + .6, y + .3, 3.3), 'emissiveWarm')
        k.span((-9.2, hall - .02, .04), (9.2, hall, 3.3), 'plaster')
        k.span((-6.0, hall - .05, 2.2), (6.0, hall - .02, 2.75), 'brand')                 # brand band
        k.span((5.6, hall - .06, .9), (8.4, hall - .02, 2.3), 'artwork')
        k.span((5.5, hall - .07, .8), (8.5, hall - .05, .9), 'bronzeFrame')
        # Teller counter with screens, waiting chairs, a queue line and a plant.
        k.span((-8.4, hall - 1.6, 0), (-2.2, hall - .9, 1.05), 'wood')
        k.span((-8.5, hall - 1.68, 1.05), (-2.1, hall - .85, 1.1), 'granite')
        for x in (-7.3, -5.3, -3.3):
            k.span((x - .25, hall - 1.25, 1.1), (x + .25, hall - 1.2, 1.45), 'darkMetal')
            k.span((x - .22, hall - 1.26, 1.13), (x + .22, hall - 1.255, 1.42), 'screen')
        for x in (3.0, 4.2):
            k.box((x, hall - 2.6, .22), (.8, .75, .44), 'fabricTerracotta', .06)
            k.box((x, hall - 2.25, .62), (.8, .14, .5), 'fabricTerracotta', .05)
        for x in (-1.2, .6):
            k.cyl((x, shop_y + 2.2, 0), .16, .03, 'chrome', 12)
            k.rod((x, shop_y + 2.2, 0), (x, shop_y + 2.2, .95), .025, 'chrome', 8)
        k.beam((-1.2, shop_y + 2.2, .9), (.6, shop_y + 2.2, .9), .05, .01, 'brand', side=Vector((0, 0, 1)))
        k.cyl((8.3, shop_y + 1.0, 0), .28, .55, 'paintDark', 14)
        plant(k, (8.3, shop_y + 1.0, 1.05), .55, rng, 70)
    # ---- canopy over the entrance on tie rods, with downlights
    k.box((0, FRONT - .85, 3.68), (6.6, 1.8, .12), 'steel', .02)
    k.span((-3.3, FRONT - 1.77, 3.6), (3.3, FRONT - 1.73, 3.82), 'aluminium')
    if lod == 0:
        for s in (-1, 1):
            k.rod((s * 2.8, FRONT - 1.6, 3.74), (s * 2.8, FRONT - .02, 5.1), .018, 'steel', 8)
            k.cyl((s * 2.8, FRONT - .07, 4.98), .07, .08, 'steel', 10, axis='Y')
        for x in (-1.8, 0, 1.8):
            k.cyl((x, FRONT - .9, 3.6), .09, .02, 'emissiveWarm', 12)
    # ---- upper floors: punched facade, floor bands, windows, French doors and balconies
    for f in range(FLOORS):
        z0, z1 = GF + FH * f, GF + FH * (f + 1)
        for i, cx in enumerate(BAYS):
            x0, x1 = cx - 2, cx + 2
            mat = 'brick' if i in (1, 2, 3) else 'plaster'
            door = i in BALCONY_BAYS
            ow, oz0, oz1 = (1.8, z0 + .05, z0 + 2.55) if door else (1.6, z0 + .9, z0 + 2.75)
            punched(k, x0, x1, z0 + .15, z1 - .15, (cx - ow / 2, cx + ow / 2, oz0, oz1), mat)
            if door:
                window(k, cx, oz0, ow, oz1 - oz0, lod, sill=False)
                if lod == 0:
                    k.span((cx - .03, GLASS_Y - .09, oz0), (cx + .03, GLASS_Y - .03, oz1), 'aluminium')
                    k.span((cx - ow / 2, GLASS_Y - .09, oz0 + .95), (cx + ow / 2, GLASS_Y - .03, oz0 + 1.0), 'aluminium')
                # Balcony: slab with a drip edge and a railing; a pot plant and a folding chair on some.
                k.span((cx - 1.6, FRONT - 1.35, z0 - .02), (cx + 1.6, FRONT, z0 + .16), 'concrete')
                k.span((cx - 1.6, FRONT - 1.37, z0 - .06), (cx + 1.6, FRONT - 1.33, z0 - .02), 'concrete')
                railing(k, cx - 1.55, cx + 1.55, FRONT, FRONT - 1.3, z0 + .16, lod)
                if lod == 0 and (f + i) % 2 == 0:
                    k.cyl((cx + 1.1, FRONT - .9, z0 + .16), .2, .35, 'fabricTerracotta' if f % 2 else 'paintDark', 12)
                    plant(k, (cx + 1.1, FRONT - .9, z0 + .75), .38, rng, 45)
                if lod == 0 and (f + i) % 2 == 1:
                    k.span((cx - 1.1, FRONT - .95, z0 + .55), (cx - .65, FRONT - .5, z0 + .6), 'wood')
                    k.span((cx - 1.1, FRONT - .53, z0 + .6), (cx - .65, FRONT - .48, z0 + 1.0), 'wood')
                    for dx in (-1.08, -.67):
                        k.span((cx + dx, FRONT - .95, z0 + .16), (cx + dx + .02, FRONT - .93, z0 + .55), 'aluminium')
            else:
                window(k, cx, oz0, ow, oz1 - oz0, lod)
                if f == FLOORS - 1:   # sun hoods over the top-floor windows
                    k.span((cx - ow / 2 - .2, FRONT - .55, oz1 + .18), (cx + ow / 2 + .2, FRONT, oz1 + .26), 'concrete')
                    if lod == 0:
                        for s in (-1, 1):
                            k.span((cx + s * (ow / 2 + .15) - .03, FRONT - .5, oz1 - .1), (cx + s * (ow / 2 + .15) + .03, FRONT, oz1 + .18), 'concrete')
        # Floor band across the facade and corner pilasters.
        k.span((-hw - .04, FRONT - .07, z0 - .15), (hw + .04, GLASS_Y, z0 + .15), 'concrete')
    for s in (-1, 1):
        k.span((s * hw - s * .5, FRONT - .1, GF), (s * hw + s * .02, GLASS_Y, ROOF), 'plaster')
    # Air conditioners under three windows and on one side wall; downpipes at both front corners.
    for (bay, f) in ((0, 0), (4, 1), (2, 2)):
        cx, z0 = BAYS[bay], GF + FH * f
        ac_unit(k, cx - .2, FRONT - .3, z0 + .5, lod, FRONT)
    for s in (-1, 1):
        k.rod((s * (hw - .2), FRONT - .12, .15), (s * (hw - .2), FRONT - .12, ROOF + .1), .05, 'darkMetal', 10)
        k.cyl((s * (hw - .2), FRONT - .12, ROOF + .05), .1, .25, 'darkMetal', 10)
        if lod == 0:
            for z in range(2, int(ROOF), 2):
                k.span((s * (hw - .2) - .07, FRONT - .2, z), (s * (hw - .2) + .07, FRONT - .02, z + .05), 'darkMetal')
            k.pipe([(s * (hw - .2), FRONT - .12, .35), (s * (hw - .2), FRONT - .35, .12)], .05, 'darkMetal', 10)
    # ---- cornice, parapet with coping, roof
    k.span((-hw - .25, FRONT - .3, ROOF - .3), (hw + .25, D / 2 + .25, ROOF), 'concrete')
    for a, b in (((-hw, FRONT), (hw, FRONT + .25)), ((-hw, D / 2 - .25), (hw, D / 2)), ((-hw, FRONT), (-hw + .25, D / 2)), ((hw - .25, FRONT), (hw, D / 2))):
        k.span((a[0], a[1], ROOF), (b[0], b[1], ROOF + 1.1), 'plaster')
        k.span((a[0] - .05, a[1] - .05, ROOF + 1.1), (b[0] + .05, b[1] + .05, ROOF + 1.18), 'concrete')
    k.span((-hw + .25, FRONT + .25, ROOF), (hw - .25, D / 2 - .25, ROOF + .08), 'roofMembrane')
    rt = ROOF + .08
    k.span((2.0, 4.0, rt), (7.0, 10.0, rt + 2.8), 'plaster')                              # stair/plant room
    k.span((1.8, 3.8, rt + 2.8), (7.2, 10.2, rt + 2.95), 'concrete')
    k.span((3.6, 3.96, rt), (4.6, 4.0, rt + 2.1), 'paintDark')                            # door
    k.span((5.2, 3.97, rt + 1.2), (6.4, 4.0, rt + 2.2), 'aluminium')                      # louvre
    for x in (-6.5, -4.5):
        for dx in (-.55, .55):
            for dy in (-.55, .55):
                k.span((x + dx - .04, 9 + dy - .04, rt), (x + dx + .04, 9 + dy + .04, rt + 1.0), 'steel')
        k.span((x - .7, 8.3, rt + 1.0), (x + .7, 9.7, rt + 1.08), 'steel')
        k.cyl((x, 9, rt + 1.08), .75, 1.6, 'tank', 20)
        k.cyl((x, 9, rt + 2.68), .2, .12, 'tank', 10)
    for i, y in enumerate((-2.5, -.8, .9)):
        k.box((-6.2, y, rt + .45), (1.0, .45, .8), 'paintWhite', .02)
        if lod == 0:
            k.ring(.24, .015, 'darkMetal', at=(-6.2 + .25, y - .23, rt + .45), M=Matrix.Rotation(math.pi / 2, 4, 'X'), seg=20, tube=4)
            k.pipe([(-5.7, y, rt + .2), (-4.6, y, rt + .1), (-4.6, 3.8, rt + .1)], .025, 'darkMetal', 6)
    # Solar array (two tilted rows) and a satellite dish.
    for row, y in enumerate((-11.0, -7.5)):
        for i in range(4):
            x = -7.5 + i * 2.1
            M = Matrix.Rotation(math.radians(15), 4, 'X')
            k.box((x, y, rt + .55), (1.95, 1.6, .05), 'solar', 0, M=M)
            k.box((x, y, rt + .52), (2.0, 1.65, .04), 'aluminium', 0, M=M)
            if lod == 0:
                for dy in (-.6, .6):
                    k.span((x - .03, y + dy - .03, rt), (x + .03, y + dy + .03, rt + .55 + dy * .25), 'aluminium')
    if lod == 0:
        k.lathe([(0, 0), (.25, .03), (.45, .1), (.5, .14)], 'paintWhite', 20, at=(7.5, -9.5, rt + 1.2), M=Matrix.Rotation(math.radians(-55), 4, 'X'))
        k.rod((7.5, -9.5, rt), (7.5, -9.5, rt + 1.2), .03, 'steel', 8)
        for x in (-1.0, 0.5):
            k.cyl((x, 6, rt), .08, .9, 'darkMetal', 10)
            k.cyl((x, 6, rt + .9), .12, .08, 'darkMetal', 10)
    ob = k.finish(campos.collection('HeroBank'))
    metre_uv(ob)
    return ob


# ============================================================================================ the car
L, CW = 4.24, .84
WB, TR = 1.3, .31          # wheel stations at ±1.3 m (wheelbase 2.6 m), tyre radius
TRACK = .76                # hub offset from the centre line


def car_body():
    """The body shell (lofted), bumpers, lamps, mirrors and the interior; along +X (nose) before export rotation."""
    k = kit('heroCar', ['paint', 'carGlass', 'trim', 'chrome', 'rubber', 'tread', 'rim', 'headlamp', 'taillamp', 'indicator',
                        'reverseLamp', 'plate', 'chassis', 'seatFabric', 'dash', 'cabin', 'carpet', 'mirrorGlass', 'instrument'])
    x0, x1 = -L / 2, L / 2
    belt = keys([(x0, .84), (x0 + .25, .9), (-1.0, .92), (.7, .89), (x1 - .25, .79), (x1, .69)])
    # Roof at 1.53 m: the game's seated avatar (seatHeight 0.5) needs the head room of VEHICLE_TYPES.car (1.5 m).
    top = keys([(x0, .88), (-1.15, .95), (-.6, 1.49), (-.1, 1.53), (.3, 1.5), (.86, .96), (x1 - .2, .83), (x1, .71)])
    cabin = lambda x: -1.12 < x < .87
    half_w = lambda x: CW * (1 - (abs(x) / (L / 2)) ** 8) ** .25
    roof_w = lambda x: half_w(x) - (.17 if cabin(x) else .06)

    def section(x):
        hw, zb = half_w(x), arch_bottom(x, (-WB, WB), .2, .42, TR)
        b, t, rw = belt(x), max(top(x), belt(x) + .02), roof_w(x)
        pts = [(0, .18), (hw - .12, .18), (hw - .02, .26)]
        z_lo = max(.3, zb)
        for i in range(5):
            u = i / 4
            pts.append((hw - .012 * math.sin(u * math.pi), z_lo + (b - .02 - z_lo) * u))
        pts += [(hw - .015, b), (hw - .05, b + .015)]
        pts += [(rw + (hw - .05 - rw) * .5, b + (t - b) * .45), (rw, t - .05), (rw * .7, t - .012), (0, t)]
        if zb > .3:
            pts[1] = (hw - .12, zb); pts[2] = (hw - .02, zb + .02)
        return pts

    def material(x, i, n, y, z):
        if i <= 1:
            return 'chassis'
        if x <= x0 + 1e-3 or x >= x1 - 1e-3:
            return 'paint'
        b = belt(x)
        if i >= 9 and cabin(x):
            t = top(x)
            if t < 1.46 and i >= 10:
                return 'carGlass'
            if i in (9, 10):
                pillar = (-.24 < x < -.12) or x < -1.0 or x > .73
                return 'paint' if pillar or z < b + .03 else 'carGlass'
        return 'paint'

    loft(k, [x0 + (x1 - x0) * i / 64 for i in range(65)], section, material, 'paint')
    # Bumpers wrapping round the corners, grille, lamps, plates.
    for sx, zc in ((1, .42), (-1, .45)):
        xe = sx * (L / 2 + .01)
        k.box((xe - sx * .08, 0, zc), (.2, 2 * CW - .08, .2), 'paint', .07, 3)
        k.box((xe - sx * .05, 0, zc - .12), (.14, 2 * CW - .2, .06), 'trim', .02)
    k.box((L / 2 - .02, 0, .6), (.06, .8, .16), 'trim', .025)
    for i in range(5):
        k.box((L / 2 + .005, 0, .54 + i * .028), (.03, .76, .008), 'chrome')
    for s in (-1, 1):
        k.box((L / 2 - .08, s * .59, .66), (.13, .37, .1), 'headlamp', .03, M=Matrix.Rotation(s * .18, 4, 'Z'))
        k.cyl((L / 2 - .03, s * .52, .66), .035, .03, 'chrome', 12, axis='X')            # projector
        k.box((L / 2 - .02, s * .67, .48), (.05, .17, .05), 'indicator', .015)
        k.box((-L / 2 + .05, s * .62, .79), (.1, .34, .12), 'taillamp', .03, M=Matrix.Rotation(-s * .15, 4, 'Z'))
        k.box((-L / 2 + .04, s * .45, .79), (.06, .07, .1), 'reverseLamp', .01)
        k.box((.95, s * (half_w(.95) + .005), .7), (.08, .03, .04), 'indicator', .01)      # side repeater
    for sx in (1, -1):
        k.box((sx * (L / 2 + .02), 0, .44 if sx > 0 else .62), (.02, .52, .12), 'plate', .01)
    # Mirrors (housing, glass, arm), handles, door seams, skirts, wipers, exhaust, aerial, fuel flap.
    for s in (-1, 1):
        k.box((.72, s * (CW + .07), 1.0), (.14, .13, .1), 'paint', .035)
        k.box((.66, s * (CW + .075), 1.0), (.012, .11, .08), 'mirrorGlass')
        k.box((.75, s * (CW + .01), .97), (.08, .06, .04), 'trim')
        for hx in (.28, -.6):
            k.box((hx, s * (CW - .002), .84), (.16, .03, .03), 'chrome', .01)
        for sx in (.68, -.18, -1.0):
            k.box((sx, s * (half_w(sx) - .002), .58), (.012, .012, .62), 'trim')
        k.box((-.15, s * (CW - .012), .29), (1.7, .04, .06), 'trim', .015)
    k.box((-1.35, -(half_w(-1.35) - .002), .84), (.14, .02, .1), 'paint', .01)
    for wy in (-.2, .22):
        k.beam((.85, wy - .3, .99), (.85, wy + .3, .99), .015, .015, 'trim', side=Vector((1, 0, 0)))
    k.cyl((-L / 2 - .02, -.5, .26), .035, .12, 'chrome', 12, axis='X')
    k.rod((-.9, 0, 1.52), (-1.05, 0, 1.64), .006, 'trim', 6)
    # Underbody: tray, exhaust run, fuel tank, suspension arms (seen from a low camera).
    k.span((-L / 2 + .25, -CW + .12, .17), (L / 2 - .25, CW - .12, .2), 'chassis')
    k.pipe([(1.0, -.25, .16), (-.4, -.3, .15), (-1.6, -.45, .18), (-L / 2, -.5, .26)], .035, 'chassis', 8)
    k.span((-1.0, -.1, .12), (-.4, .6, .17), 'chassis')
    for wx in (-WB, WB):
        for s in (-1, 1):
            k.beam((wx, s * .25, .22), (wx, s * (TRACK - .1), TR), .06, .05, 'chassis', side=Vector((1, 0, 0)))
            k.cyl((wx, s * (TRACK - .22), .25), .05, .38, 'chassis', 10)              # damper
    # ---- interior (left-hand drive: the driver sits on the left, +Y here; the game's +x)
    k.span((-1.1, -.68, .3), (.86, .68, .34), 'carpet')
    k.box((.62, 0, .78), (.28, 1.4, .2), 'dash', .06)                                     # dashboard top
    k.box((.55, 0, .6), (.2, 1.3, .3), 'dash', .05)
    k.box((.47, .37, .82), (.05, .36, .12), 'instrument', .01)                            # instrument cluster
    k.box((.48, 0, .7), (.06, .22, .14), 'instrument', .01)                               # centre screen
    k.box((.25, 0, .45), (.5, .22, .22), 'dash', .04)                                     # console
    k.rod((.1, 0, .6), (.1, 0, .66), .02, 'chrome', 8)                                    # gear selector
    for s in (-1, 1):
        y = s * .37
        k.box((-.2, y, .45), (.5, .48, .14), 'seatFabric', .05)                           # cushion
        k.box((-.47, y, .76), (.14, .46, .58), 'seatFabric', .05, M=Matrix.Rotation(math.radians(-14), 4, 'Y'))
        k.box((-.56, y, 1.15), (.1, .26, .16), 'seatFabric', .04)                         # headrest
        k.rod((-.56, y - .07, 1.04), (-.56, y - .07, 1.08), .008, 'chrome', 6)
        k.rod((-.56, y + .07, 1.04), (-.56, y + .07, 1.08), .008, 'chrome', 6)
        k.box((0, s * .74, .62), (1.5, .06, .36), 'cabin', .03)                           # door cards
        k.box((0, s * .72, .7), (.5, .05, .04), 'chrome', .01)
    k.box((-1.0, 0, .45), (.5, 1.3, .14), 'seatFabric', .05)                              # rear bench
    k.box((-1.2, 0, .74), (.14, 1.3, .52), 'seatFabric', .05, M=Matrix.Rotation(math.radians(-16), 4, 'Y'))
    k.box((-1.35, 0, .92), (.3, 1.35, .04), 'cabin', .02)                                 # parcel shelf
    k.span((-.95, -.48, 1.42), (.45, .48, 1.44), 'cabin')                                 # headliner (inside the roof)
    k.box((.35, 0, 1.43), (.06, .1, .05), 'trim', .01)                                    # rear-view mirror
    k.box((.33, 0, 1.38), (.01, .22, .06), 'mirrorGlass')
    ob = k.finish(campos.collection('HeroCar'))
    # Nose to -Y (the glTF +Z the game drives towards).
    ob.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    return ob


def car_wheel(name):
    """One wheel centred on its hub, axis along X (after rotation): tyre, tread blocks, five-spoke alloy, nuts."""
    k = kit(name, ['rubber', 'tread', 'rim', 'trim', 'chrome'])
    r, w, rr = TR, .2, TR * .62
    R = Matrix.Rotation(-math.pi / 2, 4, 'X')
    at = (0, -w / 2, 0)
    k.lathe([(rr * .98, 0), (r * .9, 0), (r * .98, w * .1), (r, w * .25), (r, w * .75), (r * .98, w * .9), (r * .9, w), (rr * .98, w)], 'rubber', 40, at, R)
    for i in range(36):                                                                   # tread blocks
        a = 2 * math.pi * i / 36
        c = Vector((r * math.cos(a), 0, r * math.sin(a)))
        k.box(c * 1.004, (.05, w * .8, .012), 'tread', 0, M=Matrix.Rotation(-a + math.pi / 2, 4, 'Y'))
    k.lathe([(rr, w * .1), (rr, w * .95), (rr * .9, w * .97)], 'rim', 28, at, R)
    k.lathe([(rr * .9, w * .97), (rr * .25, w * .9), (0, w * .92)], 'trim', 24, at, R)
    hub = Vector((0, w / 2 - .01, 0))
    for i in range(5):
        a = 2 * math.pi * i / 5
        d = Vector((math.cos(a), 0, math.sin(a)))
        k.beam(hub + d * rr * .18, hub + d * rr * .93, rr * .2, .03, 'rim', side=Vector((0, 1, 0)), bevel=.01)
        a2 = a + math.pi / 5
        k.cyl(hub + Vector((rr * .14 * math.cos(a2), .02, rr * .14 * math.sin(a2))), .011, .02, 'chrome', 6, axis='Y')
    k.cyl(hub - Vector((0, .02, 0)), rr * .22, .05, 'rim', 16, axis='Y')
    ob = k.finish(campos.collection('HeroCar'))
    ob.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))   # axis along X, outer face +X
    return ob


def steering_wheel():
    """Steering wheel centred on its hub; its column axis is the object's local Z before the tilt."""
    k = kit('heroSteering', ['dash', 'trim', 'chrome'])
    k.ring(.18, .018, 'dash', seg=32, tube=8)
    for a in (math.pi / 2, math.pi * 7 / 6, math.pi * 11 / 6):
        k.beam((0, 0, 0), (.17 * math.cos(a), .17 * math.sin(a), 0), .04, .015, 'trim', side=Vector((0, 0, 1)))
    k.cyl((0, 0, -.03), .055, .05, 'trim', 16)
    k.cyl((0, 0, .015), .03, .006, 'chrome', 12)
    return k.finish(campos.collection('HeroCar'))


def car():
    body = car_body()
    body.name = 'body'
    parts = [body]
    for fx, tag in ((1, 'f'), (-1, 'r')):
        for s, side in ((-1, 'r'), (1, 'l')):
            w = car_wheel(f'wheel_{tag}{side}')
            if s < 0:
                w.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
                w.data.flip_normals()
            w.name = f'wheel_{tag}{side}'
            # After the -90° turn the nose is -Y: front wheels at y = -WB; driver's (left) side is +x.
            w.location = (s * TRACK, -fx * WB, TR)
            parts.append(w)
    sw = steering_wheel()
    sw.name = 'steering'
    # Driver on the left (+x), column raked back toward the driver.
    sw.location = (.37, -.36, .93)
    sw.rotation_euler = (math.radians(-62), 0, 0)
    parts.append(sw)
    root = bpy.data.objects.new('heroCar', None)
    campos.collection('HeroCar').objects.link(root)
    for p in parts:
        p.parent = root
    return root, parts


# ============================================================================================ street dressing
def street():
    """In front of the bank, block-0-1's front edge (local frame: x = block centre, y = 0 at the block edge, -Y road):
    two planters with shrubs and an ornamental tree, two benches (dressing the shared furniture colliders), kerb
    gullies with grates and a manhole cover in the road."""
    rng = random.Random(11)
    k = kit('heroStreet', ['concrete', 'granite', 'soil', 'leaf', 'leafLight', 'bark', 'wood', 'castIron', 'darkMetal', 'steel'])
    # Planters at block x ± 16, 1.3 m in from the edge (collider 1.65 x 1.42 x 0.34).
    for s in (-1, 1):
        cx, cy = s * 16, 1.3
        k.box((cx, cy, .2), (1.65, 1.42, .4), 'granite', .02)
        k.span((cx - .72, cy - .6, .2), (cx + .72, cy + .6, .38), 'soil')
        for i in range(5):
            plant(k, (cx + rng.uniform(-.55, .55), cy + rng.uniform(-.45, .45), .55), rng.uniform(.25, .38), rng, 30)
        # Ornamental tree: tapering trunk, three branches, leaf clusters.
        k.cyl((cx, cy, .38), .07, 2.0, 'bark', 10, r2=.045)
        tips = []
        for j in range(3):
            a = 2 * math.pi * j / 3 + rng.uniform(-.3, .3)
            tip = (cx + .6 * math.cos(a), cy + .6 * math.sin(a), 2.9 + rng.uniform(-.2, .2))
            k.rod((cx, cy, 2.2), tip, .03, 'bark', 6)
            tips.append(tip)
        for tip in tips + [(cx, cy, 3.1), (cx + .3, cy - .2, 2.6)]:
            plant(k, tip, .8, rng, 170)
    # Benches at block x ± 10, 1.02 m in from the edge (collider 1.9 x 0.78 x 0.58): cast-iron ends, timber slats.
    for s in (-1, 1):
        cx, cy = s * 10, 1.02
        for dx in (-.8, .8):
            k.span((cx + dx - .04, cy - .32, 0), (cx + dx + .04, cy + .32, .42), 'castIron')
            k.span((cx + dx - .04, cy + .22, .42), (cx + dx + .04, cy + .3, .8), 'castIron')
        for i in range(4):
            k.span((cx - .95, cy - .3 + i * .135, .42), (cx + .95, cy - .2 + i * .135, .46), 'wood')
        for i in range(3):
            k.span((cx - .95, cy + .3, .5 + i * .1), (cx + .95, cy + .34, .57 + i * .1), 'wood')
    # Kerb gullies: a cast-iron grate in a concrete frame in the channel just off the block edge, every 12 m.
    for x in (-18, -6, 6, 18):
        k.span((x - .42, -.62, -.005), (x + .42, -.12, .012), 'concrete')
        k.span((x - .35, -.55, .012), (x + .35, -.19, .02), 'castIron')
        for i in range(9):
            k.span((x - .3 + i * .075, -.52, .02), (x - .28 + i * .075, -.22, .028), 'darkMetal')
    # A manhole cover in the near lane.
    k.cyl((4.0, -3.6, -.01), .34, .03, 'castIron', 24)
    k.ring(.34, .02, 'steel', at=(4.0, -3.6, .02), seg=24, tube=4)
    ob = k.finish(campos.collection('HeroStreet'))
    metre_uv(ob)
    return ob


# ============================================================================================ build
campos.reset_scene()
report = {}
lod0 = bank(0)
lod1 = bank(1)
lod1.location.x = 30
c_root, c_parts = car()
c_root.location.x = -20
st = street()
st.location.y = -30
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'source', 'hero_slice.blend'), compress=True)

for ob, name in ((lod0, 'hero-bank'), (lod1, 'hero-bank-lod1'), (st, 'hero-street')):
    home = ob.location.copy(); ob.location = (0, 0, 0)
    export([ob], os.path.join(OUT, name + '.glb'))
    ob.location = home
    report[name] = {'triangles': tris(ob), 'dimensions': [round(d, 3) for d in ob.dimensions], 'materials': [m.name for m in ob.data.materials]}
c_root.location = (0, 0, 0)
export([c_root], os.path.join(OUT, 'hero-car.glb'))
report['hero-car'] = {'triangles': sum(tris(p) for p in c_parts), 'parts': {p.name: tris(p) for p in c_parts},
                      'materials': sorted({m.name for p in c_parts for m in p.data.materials})}
json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=2)
print(json.dumps({k: v['triangles'] for k, v in report.items()}))
