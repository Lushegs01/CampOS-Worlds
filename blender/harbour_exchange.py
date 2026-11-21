"""Generate the block-batched Harbour Exchange assets from the shared road and parcel layout."""
from collections import defaultdict
import json
from pathlib import Path
import sys
import bpy

layout_file, output_dir = sys.argv[sys.argv.index('--') + 1:]
layout = json.loads(Path(layout_file).read_text())
output = Path(output_dir)
output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
palette = {
    'paversGrey': (.36, .34, .30), 'asphalt': (.095, .091, .083),
    'concrete': (.54, .51, .44), 'brick': (.33, .17, .12), 'stucco': (.55, .51, .4),
    'shopGlass': (.20, .26, .27), 'roof': (.115, .12, .115), 'glass': (.06, .1, .125), 'aluminium': (.19, .215, .22),
    'whitePaint': (.82, .78, .68), 'yellowPaint': (.65, .4, .12),
    'darkSteel': (.12, .135, .13), 'shopGlow': (.52, .31, .14),
    'greenTrim': (.07, .205, .17), 'oxideTrim': (.32, .125, .08), 'blueTrim': (.09, .16, .23),
}
materials = {}
for name, rgb in palette.items():
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .13 if name == 'glass' else .72
    shader.inputs['Metallic'].default_value = .45 if name in {'aluminium', 'darkSteel'} else .03
    if name == 'shopGlow':
        shader.inputs['Emission Color'].default_value = (*rgb, 1)
        shader.inputs['Emission Strength'].default_value = .32
    materials[name] = mat

faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]

class Batch:
    def __init__(self):
        self.parts = defaultdict(list)

    def box(self, mat, x, y, z, w, h, d):
        if min(w, h, d) <= 0:
            return
        self.parts[mat].append([(x + sx*w/2, -z + sz*d/2, y + sy*h/2) for sx, sz, sy in
            [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]])

    def mesh(self, label):
        result = []
        for mat, boxes in self.parts.items():
            name = label + ':' + mat
            verts = [point for box in boxes for point in box]
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata(verts, [], [tuple(i+8*j for i in face) for j in range(len(boxes)) for face in faces])
            mesh.update()
            uv = mesh.uv_layers.new(name='Metre UV')
            for polygon in mesh.polygons:
                axis = max(range(3), key=lambda j: abs(polygon.normal[j]))
                u, v = [[1, 2], [0, 2], [0, 1]][axis]
                for i in polygon.loop_indices:
                    point = mesh.vertices[mesh.loops[i].vertex_index].co
                    uv.data[i].uv = (point[u], point[v])
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.collection.objects.link(obj)
            obj.data.materials.append(materials[mat])
            result.append(obj)
        return result

def building(batch, b):
    x,z,w,d,h,style,front = (b[k] for k in ('x','z','w','d','h','style','front'))
    masonry = ['concrete', 'brick', 'stucco'][style]
    accent = ['greenTrim', 'oxideTrim', 'blueTrim'][style]
    batch.box('concrete', x, .26, z, w, .28, d)
    batch.box('roof', x, h-.26, z, w, .34, d)
    batch.box(masonry, x, (h+3.4)/2, z, w-.3, h-3.4, d-.44)
    # The exterior glazing is inset between masonry piers. A deep shadow line under each slab
    # and metre-scale UVs keep façades readable from ground level.
    for side in [-1, 1]:
        plane = z+side*(d/2-.08)
        for end in [-1, 1]:
            batch.box(masonry, x+end*(w/2-.37), h/2, plane, .74, h, .26)
        for floor in range(int((h-4.1)/2.95)):
            y = 5.4 + floor*2.95
            batch.box('concrete', x, y-1.22, plane+side*.12, w, .19, .32)
            for bay in range(6):
                wx=x+(bay-2.5)*3.08
                batch.box('aluminium', wx, y, plane+side*.023, 2.26, 1.87, .11)
                batch.box('glass', wx, y, plane+side*.087, 2.05, 1.67, .035)
                batch.box('aluminium', wx, y, plane+side*.115, .072, 1.72, .055)
                if style != 1:
                    batch.box(masonry, wx-1.24, y+.13, plane+side*.14, .17, 2.55, .42)
        for end in [-1, 1]:
            batch.box(masonry, x+end*w*.402, 1.82, plane, w*.194, 3.16, .24)
        batch.box('darkSteel', x, 1.89, plane-side*1.07, w-.7, 3.38, .4)
        for bay in range(5):
            wx = x+(bay-2)*2.65
            batch.box('shopGlass', wx, 1.94, plane-side*.15, 2.47, 2.62, .052)
            batch.box('aluminium', wx-1.28, 1.95, plane-side*.098, .115, 2.81, .19)
            batch.box('aluminium', wx, 2.9, plane-side*.1, 2.55, .065, .13)
            batch.box(accent, wx, .94, plane-side*.63, 1.92, .62, .38)
            batch.box('shopGlow', wx, 1.34, plane-side*.86, 1.98, .09, .31)
            for item in range(-1, 2):
                batch.box(['stucco','oxideTrim','greenTrim'][(bay+item)%3], wx+item*.48, 1.54+item*.045,
                          plane-side*.72, .34, .27+item*.09, .21)
        batch.box(accent, x, 3.61, plane+side*.1, w-.42, .75, .31)
        if side == front:
            batch.box('aluminium', x, 3.14, plane+side*.66, w-.75, .16, 1.62)
            for bay in range(-2,3):
                batch.box('shopGlow', x+bay*3.7, 3.035, plane+side*.82, .73, .035, .17)
        batch.box(masonry, x, h-.14, z+side*(d/2-.08), w, .48, .26)
    for side in [-1, 1]:
        batch.box(masonry, x+side*(w/2-.13), 1.93, z, .26, 3.64, d)
        for gate in [-1, 1]:
            door_z = z + gate * 8.1
            batch.box('aluminium', x+side*(w/2+.016), 1.72, door_z, .065, 2.64, 2.15)
            for slat in range(15):
                batch.box('darkSteel', x+side*(w/2+.052), .5+slat*.16, door_z, .014, .018, 2.09)
        batch.box('darkSteel', x+side*(w/2+.016), 3.46, z, .076, .23, 15)
        for end in [-1, 1]:
            batch.box('aluminium', x+side*(w/2+.043), 2.05, z+end*13.9, .09, 3.6, .088)
        batch.box(masonry, x+side*(w/2-.08), h-.14, z, .26, .48, d)
        for floor in range(int((h-4.1)/2.95)):
            y = 5.4 + floor*2.95
            for bay in range(6):
                wz=z+(bay-2.5)*4.55
                batch.box('aluminium', x+side*(w/2-.08), y, wz, .18, 1.65, 2.84)
                batch.box('glass', x+side*(w/2+.023), y, wz, .04, 1.47, 2.66)
            batch.box('concrete', x+side*(w/2+.09), y-1.22, z, .3, .15, d)
    batch.box('stucco', x-3.9, h+.45, z-5.3, 5.9, 1.46, 5.1)
    batch.box('roof', x-3.9, h+1.23, z-5.3, 6.05, .16, 5.25)
    for side in [-1, 1]:
        batch.box('aluminium', x+3.8, h+.37, z+side*4.4, 2.04, .76, 2.87)
        for n in range(-3,4):
            batch.box('darkSteel', x+3.8+n*.22, h+.77, z+side*4.4, .095, .04, 2.49)

def export_group(label, batch):
    objects = batch.mesh(label)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(output / (label+'.glb')), export_format='GLB', use_selection=True, export_yup=True)

for block in layout['blocks']:
    batch = Batch()
    x,z,w,d = (block[k] for k in ('x', 'z', 'w', 'd'))
    batch.box('paversGrey', x, .063, z, w, .124, d)
    for side in [-1, 1]:
        batch.box('concrete', x, .077, z+side*(d/2-.085), w, .15, .17)
        batch.box('concrete', x+side*(w/2-.085), .077, z, .17, .15, d)
        for end in [-1, 1]:
            ux,uz=x+side*(w/2-.8),z+end*(d/2-.75)
            batch.box('darkSteel', ux, 2.13, uz, .105, 4.0, .105)
            batch.box('aluminium', ux-side*.56, 4.14, uz, 1.22, .12, .19)
            batch.box('shopGlow', ux-side*.76, 4.03, uz, .45, .08, .22)
    for definition in layout['buildings']:
        if definition['block'] == block['id']:
            building(batch, definition)
    export_group(block['id'], batch)

yard = Batch()
for x in [257, 270]:
    for z in [12, 26]:
        yard.box('yellowPaint', x, 3.66, z, .51, 7.28, .51)
        yard.box('concrete', x, .18, z, 1.28, .36, 1.25)
    yard.box('yellowPaint', x, 7.08, 19, .63, .78, 15.3)
for z in [12, 26]:
    yard.box('yellowPaint', 263.5, 7.58, z, 14.4, .93, .65)
    yard.box('darkSteel', 263.5, 7.99, z, 14.4, .13, .44)
yard.box('darkSteel', 264, 7.42, 19, .32, .32, 14.5)
yard.box('darkSteel', 264, 6.95, 20.1, 1.22, .68, 1.32)
yard.box('darkSteel', 264, 5.7, 20.1, .032, 2.22, .032)
yard.box('yellowPaint', 264, 4.59, 20.1, .54, .27, .29)
export_group('freight-gantry', yard)

bpy.ops.wm.save_as_mainfile(filepath=str(Path('blender/source/harbour_exchange.blend').resolve()))
