"""Render a turntable-angle preview of exported GLBs (Cycles), for review: python blender/preview.py out.png key ..."""
import math, os, sys
import bpy
from mathutils import Vector

out, keys = sys.argv[1], sys.argv[2:]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for i, key in enumerate(keys):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene; s.render.engine = 'CYCLES'; s.cycles.samples = 48; s.cycles.use_denoising = True
    s.render.resolution_x, s.render.resolution_y = 640, 520
    s.view_settings.view_transform = 'AgX'
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, '.asset-cache', 'blender', f'{key}.glb'))
    obs = [o for o in s.objects if o.type == 'MESH']
    lo = Vector((min(o.bound_box[j][0] for o in obs for j in range(8)), 0, 0))
    dims = max(max(o.dimensions) for o in obs)
    w = bpy.data.worlds.new('w'); w.use_nodes = True; bg = w.node_tree.nodes['Background']
    sky = w.node_tree.nodes.new('ShaderNodeTexSky'); w.node_tree.links.new(sky.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = .35; s.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); s.collection.objects.link(sun)
    sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sun.data.angle = math.radians(2)
    bpy.ops.mesh.primitive_plane_add(size=40)
    g = bpy.data.materials.new('g'); g.use_nodes = True; g.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.25, .24, .22, 1)
    s.objects['Plane'].data.materials.append(g)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); s.collection.objects.link(cam); s.camera = cam
    cam.data.lens = 50
    h = max(o.dimensions.z for o in obs)
    d = dims * 2.3
    cam.location = (d * .75, -d * .95, h * .5 + d * .38)
    tgt = Vector((0, 0, h * .45)); cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    s.render.filepath = os.path.join(os.path.dirname(out), f'{key}.png')
    bpy.ops.render.render(write_still=True)
from PIL import Image
ims = [Image.open(os.path.join(os.path.dirname(out), f'{k}.png')) for k in keys]
cols = 3; rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (640 * cols, 520 * rows), 'white')
for i, im in enumerate(ims): sheet.paste(im.convert('RGB'), ((i % cols) * 640, (i // cols) * 520))
sheet.save(out)
