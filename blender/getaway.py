"""Build the missing original Getaway props with Blender 4.x.

blender -b -t 2 -P blender/getaway.py
Uses the existing metres/pivot and Kit conventions from Blender's campus pipeline.
"""
import json
import os
import sys

import bpy
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, 'lib'))
from campos import Kit, collection, export_glb, reset_scene, triangles, unwrap

reset_scene()
family = collection('Industrial District')
PALETTE = {
    'marine': (.082, .14, .145, 1), 'ridge': (.12, .195, .195, 1),
    'graphite': (.035, .047, .043, 1), 'zinc': (.29, .32, .31, 1),
    'amber': (.81, .43, .07, 1), 'polymer': (.055, .063, .06, 1),
    'seal': (.021, .029, .025, 1), 'paper': (.71, .69, .49, 1),
}
for name in PALETTE:
    bpy.data.materials.new(name)
material = bpy.data.materials.new('Industrial coated surfaces')
material.use_nodes = True
pbr = material.node_tree.nodes.get('Principled BSDF')
pbr.inputs['Roughness'].default_value = .73
vertex = material.node_tree.nodes.new('ShaderNodeVertexColor')
vertex.layer_name = 'Color'
material.node_tree.links.new(vertex.outputs['Color'], pbr.inputs['Base Color'])


def colored(kit):
    ob = kit.finish(family)
    colors = ob.data.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    for face in ob.data.polygons:
        color = PALETTE[kit.mats[face.material_index]]
        for i in face.loop_indices:
            colors.data[i].color = color
        face.material_index = 0
    ob.data.materials.clear()
    ob.data.materials.append(material)
    unwrap(ob)
    return ob


def shipping_container(name, detail):
    k = Kit(name, ['marine', 'ridge', 'graphite', 'zinc', 'amber'])
    k.box((0, 0, 1.325), (5.94, 2.52, 2.52), 'marine', .018, 1)
    for y in (-1.25, 1.25):
        for z in (.075, 2.575):
            k.box((0, y, z), (6, .1, .15), 'graphite')
        for x in (-2.93, 2.93):
            k.box((x, y, 1.325), (.14, .1, 2.65), 'graphite')
        if detail:
            for i in range(25):
                k.box(((i-12)*.22, y, 1.325), (.1, .1, 2.16), 'ridge', .015, 1)
    for y in (-.64, .64):
        k.box((3, y, 1.325), (.035, 1.09, 2.33), 'ridge')
        if detail:
            for yy in (y-.22,y+.22):
                k.cyl((3.04, yy, .34), .026, 1.96, 'zinc', 8)
    k.box((3.025, .66, .69), (.044, .28, .1), 'amber')
    return colored(k)


def case():
    k = Kit('intelligenceCase', ['polymer', 'seal', 'amber', 'zinc', 'paper', 'graphite'])
    k.box((0, 0, .135), (.76, .49, .27), 'polymer', .032, 2)
    k.box((0, 0, .168), (.776, .496, .026), 'seal', .008, 1)
    for x in (-.26, .26):
        for z in (.035, .235):
            k.box((x, 0, z), (.08, .501, .062), 'seal', .01, 1)
        k.box((x, -.26, .166), (.071, .042, .081), 'amber', .009, 1)
    k.beam((-.11,-.253,.12),(-.11,-.305,.12),.037,.037,'zinc',bevel=.006)
    k.beam((.11,-.253,.12),(.11,-.305,.12),.037,.037,'zinc',bevel=.006)
    k.beam((-.11,-.303,.12),(.11,-.303,.12),.038,.038,'seal',bevel=.006)
    k.box((.12,.028,.274),(.25,.17,.006),'paper')
    k.box((.12,.05,.279),(.14,.012,.005),'graphite')
    return colored(k)


def truss():
    k = Kit('warehouseTruss', ['graphite', 'zinc', 'amber'])
    for z in (0, .66):
        k.box((0,0,z+.05),(27.2,.15,.1),'graphite',.012,1)
    for i in range(17):
        x=(i-8)*1.65
        k.beam((x,0,.1),(x+.8,0,.66),.067,.067,'zinc')
        k.beam((x+.8,0,.66),(x+1.65,0,.1),.067,.067,'zinc')
    for x in (-8,0,8):
        k.box((x,0,-.03),(.68,.24,.075),'amber')
    return colored(k)


assets = [shipping_container('freightContainer', True), shipping_container('freightContainerLow', False), case(), truss()]
output = os.path.join(ROOT, 'public', 'assets', 'getaway')
os.makedirs(output, exist_ok=True)
report = {}
for ob in assets:
    key = ob.name[3:]
    file = os.path.join(output, key + '.glb')
    export_glb(ob, file)
    report[key] = {'file': key + '.glb', 'triangles': triangles(ob), 'bytes': os.stat(file).st_size,
                   'dimensionsBlender': [round(d, 3) for d in ob.dimensions]}
for i, ob in enumerate(assets):
    ob.location.y = i * 5
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'source', 'getaway.blend'), compress=True)
with open(os.path.join(output, 'models.json'), 'w') as manifest:
    json.dump(report, manifest, indent=2)
    manifest.write('\n')
