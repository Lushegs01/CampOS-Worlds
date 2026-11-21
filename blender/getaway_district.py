"""Author and export Bay 04 and the Orisun Freight yard in metres.

Run: blender -b -t 2 --python-exit-code 1 -P blender/getaway_district.py
The shared gameplay volumes are in shared/getaway.mjs. This scene is visual geometry.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, 'lib'))
from campos import Kit, collection, export_glb, reset_scene, triangles

# Blender coordinates relative to (191, 0, 12.5) in the game. Freight doors face Blender -Y.
PALETTE = {
    'aggregate': ((.29, .27, .23), .87, 0),
    'asphalt': ((.12, .109, .095), .94, 0),
    'patch': ((.081, .078, .069), .94, 0),
    'slab': ((.31, .295, .26), .85, 0),
    'concrete': ((.36, .345, .31), .88, 0),
    'corrugation': ((.26, .31, .295), .63, .38),
    'roofing': ((.15, .19, .185), .58, .36),
    'steel': ((.12, .16, .155), .62, .54),
    'rubber': ((.035, .032, .027), .91, 0),
    'zinc': ((.36, .40, .39), .49, .65),
    'oxide': ((.30, .098, .05), .72, .19),
    'wood': ((.31, .21, .12), .8, 0),
    'paint': ((.64, .415, .095), .76, 0),
    'white': ((.63, .60, .5), .78, 0),
    'glass': ((.31, .40, .415), .25, .12),
    'fixture': ((.8, .76, .62), .37, 0),
}
TEXTURED = {'aggregate', 'asphalt', 'patch', 'slab', 'concrete', 'corrugation', 'roofing', 'wood'}

reset_scene()
for name, (rgb, roughness, metallic) in PALETTE.items():
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgb, 1)
    material.use_nodes = True
    principled = material.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (*rgb, 1)
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Metallic'].default_value = metallic
    if name == 'fixture':
        principled.inputs['Emission Color'].default_value = (1, .91, .73, 1)
        principled.inputs['Emission Strength'].default_value = 2.2

family = collection('Orisun Freight — Bay 04')


def kit(name, *materials):
    return Kit(name, list(materials))


def projected(k):
    """Metric UVs by face orientation. The runtime binds the same scans as the campus."""
    ob = k.finish(family)
    mesh = ob.data
    uv = mesh.uv_layers.new(name='MetricUV')
    for face in mesh.polygons:
        nx, ny, nz = face.normal
        for loop in face.loop_indices:
            x, y, z = mesh.vertices[mesh.loops[loop].vertex_index].co
            if abs(nz) >= max(abs(nx), abs(ny)):
                point = (x, y if nz >= 0 else -y)
            elif abs(nx) >= abs(ny):
                point = (y if nx >= 0 else -y, z)
            else:
                point = (-x if ny >= 0 else x, z)
            uv.data[loop].uv = point if k.mats[face.material_index] in TEXTURED else (0, 0)
    return ob


def block(k, a, b, material, bevel=0):
    k.span(a, b, material, bevel, 1)


def bay_shell():
    k = kit('bay04Shell', 'concrete', 'corrugation', 'roofing', 'steel', 'zinc', 'glass', 'rubber', 'oxide', 'fixture', 'paint')
    # Water table and reinforced base. Corrugated panels sit on the plinth.
    walls = [
        ((-14.3, -11.8), (-5.0, -11.2)), ((5.0, -11.8), (14.3, -11.2)),
        ((-14.3, 11.2), (14.3, 11.8)),
        ((-14.3, -11.2), (-13.7, 11.2)), ((13.7, -11.2), (14.3, 11.2)),
    ]
    for (x0, y0), (x1, y1) in walls:
        block(k, (x0, y0, 0), (x1, y1, 1.47), 'concrete', .022)
        block(k, (x0 + .015, y0 + .015, 1.45), (x1 - .015, y1 - .015, 4.95), 'corrugation')
        block(k, (x0, y0, 6.2), (x1, y1, 7), 'corrugation')

    # Continuous glazed clerestories on the side walls. Solid front pilasters carry the sign and canopy.
    for side in (-1, 1):
        x_outer = side * 14
        for i in range(10):
            y = -10.35 + i * 2.3
            k.box((x_outer, y, 5.57), (.062, 2.24, 1.2), 'glass')
            k.box((x_outer, y - 1.12, 5.57), (.61, .086, 1.28), 'zinc')
            k.box((x_outer, y, 5.57), (.2, .04, 1.22), 'zinc')
        for z in (4.95, 6.21):
            k.box((x_outer, 0, z), (.68, 23, .096), 'zinc')
        for y in (-11.48, 11.48):
            k.box((side * 14.25, y, 3.53), (.19, .26, 7.06), 'zinc')
        for y in (-10.55, -3.7, 3.65, 10.55):
            # Interior portal posts, webs and foot plates stay inside the existing wall margins.
            k.box((side * 13.62, y, .069), (.44, .47, .14), 'concrete', .019, 1)
            k.box((side * 13.62, y, 3.52), (.21, .12, 6.85), 'steel')
            for dx in (-.13, .13):
                k.box((side * 13.62 + dx, y, 3.54), (.048, .27, 6.94), 'steel')

    for x0, x1 in ((-14, -5.0), (5.0, 14)):
        block(k, (x0, -11.79, 4.95), (x1, -11.21, 6.2), 'corrugation')
    for x in (-10.43, 8.32):
        # Blank panels below the lintel have weathered, opaque glazing and an external rain sill.
        k.box((x, -11.87, 3.32), (3.64, .15, 1.28), 'steel', .032, 1)
        for i in range(4):
            k.box((x + (i - 1.5) * .87, -11.955, 3.34), (.81, .043, 1.12), 'glass')
        k.box((x, -11.975, 2.69), (3.78, .35, .1), 'zinc')
    for x in (-12.85, 12.85):
        k.pipe([(x, -11.94, 6.89), (x, -12.03, 6.46), (x, -12.03, .42), (x, -12.29, .22)], .064, 'zinc', 8)
        for z in (1.18, 3.27, 5.44):
            k.box((x, -12.03, z), (.17, .16, .067), 'steel')

    # Rear service wall and the raised roller grille above the open loading doors.
    block(k, (-14.3, 11.2, 4.95), (14.3, 11.8, 6.2), 'corrugation')
    k.box((0, -11.5, 5.98), (10.2, .62, 2.0), 'corrugation')
    k.box((0, -12.04, 5.83), (8.65, .12, .91), 'steel', .025, 1)
    for x in (-5.01, 5.01):
        for y in (-11.88, -11.2):
            k.box((x, y, 2.54), (.155, .106, 5.08), 'zinc', .012, 1)
        k.box((x * 1.04, -12.0, .67), (.19, .19, 1.32), 'rubber', .03, 1)
    for z in (5.01, 5.13, 5.25, 5.37):
        k.box((0, -11.62, z), (9.87, .19, .112), 'steel', .018, 1)
    for x in (-5.31, 5.31):
        k.box((x, -12.01, 2.18), (.34, .18, .45), 'steel', .02, 1)
        k.box((x, -12.118, 2.23), (.14, .04, .14), 'oxide', .012, 1)
    # Low-slope pitched roof. Fascia, folded ridge and profiled lap seams give readable silhouettes.
    pitch = math.atan2(1.54, 14.68)
    for side in (-1, 1):
        k.box((side * 7.34, -.05, 7.79), (14.81, 24.6, .16), 'roofing', M=Matrix.Rotation(side * pitch, 4, 'Y'))
        k.box((side * 14.72, -.05, 7.0), (.20, 24.8, .24), 'zinc')
        for y in (-12.38, 12.28):
            k.beam((0, y, 8.64), (side * 14.72, y, 7.08), .21, .24, 'steel')
        for y in (-8.37, -4.2, 0, 4.2, 8.37):
            k.beam((0, y, 8.66), (side * 14.7, y, 7.13), .056, .049, 'zinc')
        for y in (-11.46, 11.46):
            peak = (0, y, 8.51)
            eave = (side * 14.29, y, 6.96)
            a = k.bm.verts.new((0, y, 6.96))
            b = k.bm.verts.new(eave)
            c = k.bm.verts.new(peak)
            face = k.bm.faces.new((a, b, c) if side * y < 0 else (c, b, a))
            face.material_index = k.m('corrugation')
            # The facing interior gets a real surface as well, with the thickness following the skin.
            y_inner = y - math.copysign(.09, y)
            verts = [k.bm.verts.new((x, y_inner, z)) for x, _, z in (a.co, b.co, c.co)]
            inner = k.bm.faces.new(verts[::-1] if side * y < 0 else verts)
            inner.material_index = k.m('corrugation')
    k.box((0, -.05, 8.63), (.33, 24.77, .085), 'zinc', .018, 1)
    # Cantilever canopy is clear of the loading corridor and redirects rain off the shutter.
    k.box((0, -13.33, 6.88), (11.55, 2.66, .14), 'roofing', M=Matrix.Rotation(-.048, 4, 'X'))
    k.box((0, -14.68, 6.76), (11.62, .19, .2), 'steel')
    for x in (-5.57, 0, 5.57):
        k.beam((x, -11.88, 6.52), (x, -14.57, 6.73), .14, .19, 'steel')
    for x in (-3.6, 3.6):
        k.box((x, -13.7, 6.71), (.64, .22, .15), 'steel', .022, 1)
        k.box((x, -13.7, 6.62), (.55, .16, .046), 'fixture', .011, 1)
    return projected(k)


def warehouse_fittings():
    k = kit('bay04Fittings', 'steel', 'zinc', 'paint', 'oxide', 'wood', 'rubber', 'fixture')
    # Industrial light housings and conduit below the existing trusses.
    for y in (-8.75, -2.1, 4.8, 9.1):
        k.rod((-12.8, y, 5.96), (12.8, y, 5.96), .023, 'zinc', 6)
        for x in (-8.1, 0, 8.1):
            k.rod((x, y, 6.18), (x, y, 5.89), .031, 'steel', 8)
            k.box((x, y, 5.85), (1.31, .242, .12), 'steel', .038, 1)
            k.box((x, y, 5.777), (1.15, .147, .049), 'fixture', .019, 1)

    # Tall pallet racking beyond the rear wall line of play, with deckboards and rack protection.
    for x, slots in [(-8.9, 2), (8.45, 2)]:
        y, span = 10.76, 2.8
        for column in range(slots + 1):
            xx = x + (column - slots / 2) * span
            for yy in (y - .38, y + .36):
                k.box((xx, yy, 1.68), (.092, .092, 3.34), 'steel')
                k.box((xx, yy, .27), (.181, .173, .54), 'paint', .02, 1)
            for z in (.65, 1.82, 2.98):
                k.beam((xx, y - .38, z), (xx, y + .36, z + .43), .048, .047, 'zinc')
        for z in (.58, 1.77, 2.94):
            for yy in (y - .37, y + .35):
                k.box((x, yy, z), (span * slots, .083, .12), 'oxide')
            for n in range(16):
                k.box((x + (n - 7.5) * .351, y, z + .074), (.305, .745, .052), 'wood')
    # Fixed work and safety stations over existing wall volumes.
    for x in (-13.59, 13.59):
        for y in (-7.7, -.3, 7.3):
            k.box((x, y, 1.36), (.22, .61, .64), 'steel', .023, 1)
            k.box((x * .989, y, 1.34), (.063, .49, .52), 'zinc', .014, 1)
            k.rod((x, y, 1.68), (x, y, 5.94), .024, 'zinc', 8)
    # Salvaged pallets sit on two of the large cover stacks, within their existing silhouettes.
    for x, y, z in [(-8, 2.5, 1.18), (5, 4.5, 1.47)]:
        for i in (-1, 0, 1):
            k.box((x + i * .39, y, z + .06), (.088, .87, .12), 'wood')
        for i in range(5):
            k.box((x, y + (i - 2) * .187, z + .138), (1.02, .145, .047), 'wood', .007, 1)
    return projected(k)


def site_surfaces():
    k = kit('freightGround', 'aggregate', 'asphalt', 'patch', 'slab', 'concrete', 'steel', 'rubber', 'paint', 'white')

    def ground(x0, z0, x1, z1, surface, h=.008):
        block(k, (x0 - 191, 12.5 - z1, h - .026), (x1 - 191, 12.5 - z0, h), surface)

    # Stop at the established road shoulders. Asphalt is above the terrain and below the kerbs.
    ground(155.67, -19.3, 260.32, 51.08, 'asphalt')
    ground(129, 42.6, 145.15, 51.11, 'aggregate')
    ground(132, 44.35, 145.85, 51.32, 'slab', .013)
    ground(212.16, 51.08, 224.45, 51.53, 'asphalt')
    ground(160, 39.78, 230, 41.1, 'patch', .011)
    ground(202.06, 41.1, 202.97, 50.75, 'patch', .012)
    # Concrete pours and expansion joints. The threshold and yard remain essentially flush.
    for ix in range(5):
        for iz in range(4):
            x0 = 176.16 + ix * 5.94
            z0 = 1.25 + iz * 5.8
            ground(x0, z0, x0 + 5.912, z0 + 5.771, 'slab', .021)
    for ix in range(5):
        for iz in range(2):
            x0 = 175.7 + ix * 6.1
            z0 = 24.28 + iz * 3.43
            ground(x0, z0, x0 + 6.077, z0 + 3.407, 'slab', .018)
    for xlo, xhi, zlo, zhi in ((232, 248, 16, 21), (157, 175.7, 24.27, 25.46), (223.6, 234.6, 32, 35)):
        ground(xlo, zlo, xhi, zhi, 'concrete', .018)
    # Open trench grating behind the apron. Dark bed, frames, individual cast bars and bridged ends.
    ground(174.9, 31.28, 205.4, 31.63, 'rubber', .012)
    for i in range(13):
        x = -14.91 + i * 2.31
        y = 12.5 - 31.455
        for dy in (-.137, .137):
            k.box((x, y + dy, .019), (2.23, .046, .025), 'steel')
        for bar in range(30):
            k.box((x + (bar - 14.5) * .073, y, .019), (.027, .245, .026), 'steel')
    # Painted route markings. Their surfaces are separate from the road and concrete meshes.
    ground(186.1, 25.85, 195.9, 25.98, 'paint', .023)
    for zz in (26.05, 28.25):
        for xx in (178.6, 183.8, 198.1, 203.0):
            ground(xx, zz, xx + .15, zz + 2.02, 'paint', .023)
    for xx in (187.0, 195.0):
        for zz in (5.7, 9.7, 13.7, 17.7, 21.7):
            ground(xx, zz, xx + .092, zz + 1.72, 'paint', .027)
    for x in (209, 215, 221):
        for offset in (-1.85, 1.85):
            ground(x + offset, 42.08, x + offset + .095, 49.88, 'white', .017)
        ground(x - 1.85, 42.04, x + 1.94, 42.14, 'white', .018)
    for z in (44.3, 46.4, 48.5):
        ground(224.25, z, 224.35, z + 1.55, 'paint', .017)
    return projected(k)


def yard_fixtures():
    k = kit('freightFixtures', 'concrete', 'steel', 'zinc', 'oxide', 'paint', 'rubber', 'fixture')

    def fence(xa, xb, z):
        y = 12.5 - z
        n = math.ceil((xb - xa) / 2.55)
        for i in range(n + 1):
            x = xa - 191 + i * (xb - xa) / n
            k.box((x, y, 1.04), (.079, .079, 2.08), 'steel')
            k.box((x, y, .07), (.25, .22, .14), 'concrete', .021, 1)
        for h in (.21, 1.12, 1.9):
            k.beam((xa - 191, y, h), (xb - 191, y, h), .036, .047, 'steel')
        for i in range(math.floor((xb - xa) / .194)):
            x = xa - 190.9 + i * .194
            k.box((x, y, 1.063), (.018, .019, 1.69), 'zinc')

    fence(129.5, 143.45, 44.62)
    fence(231.6, 249.8, 45.23)
    for x, z in [(133.25, 47.35), (141.2, 47.35), (177.1, 25), (184.7, 25), (197.3, 25), (204.2, 25)]:
        x, y = x - 191, 12.5 - z
        k.cyl((x, y, 0), .13, .11, 'concrete', 12)
        k.cyl((x, y, .09), .076, .93, 'paint', 12)
        for h in (.55, .78):
            k.cyl((x, y, h), .078, .1, 'rubber', 12)
        k.cyl((x, y, 1.02), .077, .061, 'paint', 12, r2=.018)
    for x, z in [(142.7, 46.4), (166.8, 47.8), (231.2, 41.9), (250.2, 38.2)]:
        x, y = x - 191, 12.5 - z
        k.box((x, y, .18), (.46, .48, .36), 'concrete', .052, 1)
        k.cyl((x, y, .33), .104, 5.75, 'steel', 10, r2=.071)
        k.rod((x, y, 5.76), (x, y - .81, 6.11), .044, 'zinc', 8)
        k.box((x, y - .85, 6.12), (.38, .55, .13), 'steel', .051, 1)
        k.box((x, y - .85, 6.045), (.277, .381, .038), 'fixture', .011, 1)
    return projected(k)

def depots():
    k = kit('freightDepots', 'concrete', 'corrugation', 'roofing', 'zinc', 'oxide', 'steel', 'glass', 'rubber')
    # Secondary shells follow the existing depot collision boxes, with different frontage layouts.
    for index, (wx, wz, w, d, h) in enumerate((
        (234, 9, 31, 16, 8), (235, -11, 34, 13, 7), (165, 3, 13, 23, 6.5),
        (177, -35, 23, 13, 7), (280, -37, 8, 12, 4.7), (250, -37, 20, 13, 6),
    )):
        x, y = wx - 191, 12.5 - wz
        left, right, front, back = x - w / 2, x + w / 2, y - d / 2, y + d / 2
        base = min(2.45, h * .44)
        block(k, (left, front, 0), (right, back, base), 'concrete', .043)
        block(k, (left + .04, front + .04, base - .02), (right - .04, back - .04, h), 'corrugation')
        k.box((x, y, h + .01), (w + .38, d + .33, .20), 'roofing', .044, 1)
        k.box((x, front - .14, h), (w + .4, .18, .25), 'zinc')
        for xx in (left + .38, right - .38):
            k.pipe([(xx, front - .14, h - .06), (xx, front - .22, h - .42),
                    (xx, front - .22, .42), (xx, front - .39, .22)], .052, 'zinc', 8)
        doors = (-w * .28, 0, w * .28) if index in (0, 1) else (-w * .19, w * .18) if index in (3, 5) else (0,)
        width = min(4.46, w * .48)
        for door in doors:
            xx = x + door
            sill = 3.45 if h >= 6 else 2.86
            k.box((xx, front - .095, sill / 2), (width + .24, .18, sill), 'steel', .021, 1)
            for slat in range(1, int((sill - .3) / .16)):
                k.box((xx, front - .188, slat * .16), (width - .17, .047, .119), 'zinc')
            k.box((xx, front - .265, sill - .11), (width + .31, .43, .23), 'oxide' if index % 2 == 0 else 'steel', .027, 1)
            for side in (-1, 1):
                k.box((xx + side * (width / 2 - .02), front - .27, .58), (.18, .14, 1.03), 'rubber', .043, 1)
        tick = max(2, int(w / 2.9))
        for n in range(tick):
            xx = x + (n - (tick - 1) / 2) * 2.35
            z = h - 1.33
            k.box((xx, front - .021, z), (2.01, .14, .73), 'steel')
            for leaf in (-1, 1):
                k.box((xx + leaf * .48, front - .103, z), (.886, .04, .6), 'glass')
            k.box((xx, front - .12, z - .38), (2.03, .31, .078), 'zinc')
        if index != 4:
            for offset in (-.22, .19):
                xx = x + w * offset
                k.cyl((xx, y + .9, h + .1), .29, .8, 'steel', 12)
                k.cyl((xx, y + .9, h + .86), .52, .18, 'zinc', 16, r2=.31)
    return projected(k)


models = [bay_shell(), warehouse_fittings(), site_surfaces(), yard_fixtures(), depots()]
out = os.path.join(ROOT, 'public', 'assets', 'getaway')
report = {}
for obj in models:
    key = obj.name.removeprefix('SM_')
    file = os.path.join(out, key + '.glb')
    export_glb(obj, file)
    report[key] = {
        'file': key + '.glb',
        'triangles': triangles(obj),
        'bytes': os.stat(file).st_size,
        'dimensionsBlender': [round(d, 3) for d in obj.dimensions],
    }
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'source', 'getaway_district.blend'), compress=True)
with open(os.path.join(out, 'district.json'), 'w') as manifest:
    json.dump(report, manifest, indent=2)
    manifest.write('\n')
