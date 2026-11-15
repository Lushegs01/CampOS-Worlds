"""CampOS Worlds — Blender production helpers (run with Blender's Python API, `bpy`).

Conventions (see docs/BLENDER_ASSET_PIPELINE.md):
  * Units are metres. Blender +Z is up; the glTF exporter converts to +Y up.
  * An asset's long axis is +X, its pivot is the centre of its base (z = 0), and it is modelled to the exact size of
    the collision box it dresses, so the game can fit it without guessing.
  * Objects are named SM_<key>; each asset lives in a collection named for its family (Rooftop, Street, Industrial).
  * Source materials are procedural (Cycles nodes). Export materials are baked: one material, one UV set and three
    textures per asset (base colour, tangent-space normal, occlusion/roughness/metal), which is what glTF and the
    game's instanced-prop renderer want: one draw call per asset.
"""
from __future__ import annotations

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------------------------- scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'
    s.unit_settings.scale_length = 1.0
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    world = bpy.data.worlds.new('World'); world.color = (0.05, 0.05, 0.05); s.world = world
    return s


def collection(name: str) -> bpy.types.Collection:
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


# --------------------------------------------------------------------------------------------- geometry kit

def align(direction: Vector, side_hint: Vector | None = None) -> Matrix:
    """A rotation whose +Z is `direction` and whose +X lies as close as possible to `side_hint`."""
    z = Vector(direction).normalized()
    hint = Vector(side_hint) if side_hint is not None else Vector((1, 0, 0))
    if abs(z.dot(hint.normalized())) > .98:
        hint = Vector((0, 1, 0)) if abs(z.y) < .9 else Vector((1, 0, 0))
    x = (hint - z * hint.dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_4x4()


class Kit:
    """Builds one asset as a single bmesh with material indices per part."""

    def __init__(self, name: str, materials: list[str]):
        self.name = name
        self.bm = bmesh.new()
        self.mats = materials

    def m(self, mat: str) -> int:
        return self.mats.index(mat)

    def _finish(self, verts, mat: str, smooth: bool):
        faces = {f for v in verts for f in v.link_faces}
        mi = self.m(mat)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth
        return faces

    def box(self, c, s, mat, bevel=0.0, seg=2, M: Matrix | None = None):
        """An axis-aligned box centred at c with size s (then transformed by M about the box centre)."""
        T = Matrix.Translation(Vector(c)) @ (M or Matrix.Identity(4)) @ Matrix.Diagonal((s[0], s[1], s[2], 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=T)
        verts = r['verts']
        faces = self._finish(verts, mat, True)
        if bevel > 0:
            edges = list({e for f in faces for e in f.edges})
            off = min(bevel, min(s) * .45)
            bmesh.ops.bevel(self.bm, geom=edges, offset=off, segments=seg, profile=.5, affect='EDGES',
                            clamp_overlap=True, material=self.m(mat))
        return faces

    def span(self, a, b, mat, bevel=0.0, seg=2):
        """A box from corner a to corner b."""
        a, b = Vector(a), Vector(b)
        lo = Vector((min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)))
        hi = Vector((max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)))
        return self.box((lo + hi) / 2, hi - lo, mat, bevel, seg)

    def beam(self, p0, p1, w, h, mat, side=None, bevel=0.0):
        """A rectangular bar from p0 to p1 (w across `side`, h across the other)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        R = align(d, side)
        return self.box((p0 + p1) / 2, (w, h, d.length), mat, bevel, 1, R)

    def cyl(self, c, r, h, mat, seg=16, axis='Z', r2=None, caps=True, smooth=True):
        """A cylinder (or cone, with r2) whose base centre is c, running h along +axis."""
        rot = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(-math.pi / 2, 4, 'X')}[axis]
        off = {'Z': Vector((0, 0, h / 2)), 'X': Vector((h / 2, 0, 0)), 'Y': Vector((0, h / 2, 0))}[axis]
        T = Matrix.Translation(Vector(c) + off) @ rot
        r_ = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r,
                                   radius2=r if r2 is None else r2, depth=h, matrix=T)
        return self._finish(r_['verts'], mat, smooth)

    def rod(self, p0, p1, r, mat, seg=10):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        T = Matrix.Translation((p0 + p1) / 2) @ align(d)
        r_ = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r,
                                   depth=d.length, matrix=T)
        return self._finish(r_['verts'], mat, True)

    def pipe(self, pts, r, mat, seg=10):
        """A pipe through a polyline, with a ball at each bend standing in for the elbow fitting."""
        pts = [Vector(p) for p in pts]
        for a, b in zip(pts, pts[1:]):
            self.rod(a, b, r, mat, seg)
        for p in pts[1:-1]:
            v = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=6, radius=r * 1.18,
                                          matrix=Matrix.Translation(p))['verts']
            self._finish(v, mat, True)

    def lathe(self, profile, mat, seg=24, at=(0, 0, 0), M: Matrix | None = None, smooth=True):
        """Revolve a (radius, height) profile about +Z; points with radius 0 become poles."""
        T = Matrix.Translation(Vector(at)) @ (M or Matrix.Identity(4))
        rings = []
        for r, z in profile:
            if r < 1e-6:
                rings.append([self.bm.verts.new(T @ Vector((0, 0, z)))])
            else:
                rings.append([self.bm.verts.new(T @ Vector((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z))) for i in range(seg)])
        new = []
        for A, B in zip(rings, rings[1:]):
            for i in range(seg):
                j = (i + 1) % seg
                if len(A) == 1 and len(B) == 1:
                    continue
                if len(A) == 1:
                    q = (A[0], B[i], B[j])
                elif len(B) == 1:
                    q = (A[i], A[j], B[0])
                else:
                    q = (A[i], A[j], B[j], B[i])
                try:
                    new.append(self.bm.faces.new(q))
                except ValueError:
                    pass
        verts = [v for ring in rings for v in ring]
        return self._finish(verts, mat, smooth)

    def ring(self, R, r, mat, at=(0, 0, 0), M: Matrix | None = None, seg=32, tube=6):
        """A torus of major radius R and tube radius r, in the XY plane."""
        prof = [(R + r * math.cos(2 * math.pi * k / tube), r * math.sin(2 * math.pi * k / tube)) for k in range(tube + 1)]
        return self.lathe(prof, mat, seg, at, M)

    def taper(self, c, bottom, top, h, mat, bevel=0.0):
        """A box whose footprint grows from bottom (x, y) at the base to top (x, y) at height h; base centre c."""
        faces = self.box((c[0], c[1], c[2] + h / 2), (bottom[0], bottom[1], h), mat, 0)
        verts = {v for f in faces for v in f.verts}
        for v in verts:
            if v.co.z > c[2] + h / 2:
                v.co.x = c[0] + (v.co.x - c[0]) * top[0] / bottom[0]
                v.co.y = c[1] + (v.co.y - c[1]) * top[1] / bottom[1]
        if bevel:
            edges = list({e for f in faces for e in f.edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=2, profile=.5, affect='EDGES', clamp_overlap=True, material=self.m(mat))
        return faces

    def finish(self, coll: bpy.types.Collection, sharp_deg=50.0) -> bpy.types.Object:
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.normal_update()
        lim = math.radians(sharp_deg)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                a, b = e.link_faces
                e.smooth = a.normal.angle(b.normal, 0) < lim and a.smooth and b.smooth
            else:
                e.smooth = False
        me = bpy.data.meshes.new('ME_' + self.name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('SM_' + self.name, me)
        coll.objects.link(ob)
        for mn in self.mats:
            me.materials.append(bpy.data.materials[mn])
        return ob


# --------------------------------------------------------------------------------------------- procedural materials

class Surface:
    """A procedural PBR recipe. Every channel is a node socket so it can be baked."""

    def __init__(self, name, base, *, var=.12, var_scale=6.0, rough=.6, rough_var=.15, metal=0.0,
                 grime=(.16, .14, .12), grime_amt=.55, dust=(.55, .52, .47), dust_amt=0.0,
                 wear=None, wear_amt=0.0, wear_metal=1.0, wear_rough=.35, streaks=0.0,
                 bump=.25, bump_scale=60.0, rust=0.0):
        self.__dict__.update(locals())
        del self.__dict__['self']


def _n(nt, kind, **props):
    n = nt.nodes.new(kind)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def _mix_color(nt, fac, a, b):
    m = _n(nt, 'ShaderNodeMix', data_type='RGBA', clamp_factor=True)
    _link(nt, fac, m.inputs[0]); _link(nt, a, m.inputs[6]); _link(nt, b, m.inputs[7])
    return m.outputs[2]


def _mix_float(nt, fac, a, b):
    m = _n(nt, 'ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
    _link(nt, fac, m.inputs[0]); _link(nt, a, m.inputs[2]); _link(nt, b, m.inputs[3])
    return m.outputs[0]


def _link(nt, src, dst):
    if isinstance(src, (int, float)):
        dst.default_value = src
    elif isinstance(src, tuple):
        dst.default_value = (*src, 1.0) if len(src) == 3 else src
    else:
        nt.links.new(src, dst)


def _math(nt, op, a, b=None, clamp=False):
    m = _n(nt, 'ShaderNodeMath', operation=op, use_clamp=clamp)
    _link(nt, a, m.inputs[0])
    if b is not None:
        _link(nt, b, m.inputs[1])
    return m.outputs[0]


def _ramp(nt, src, lo, hi):
    m = _n(nt, 'ShaderNodeMapRange', clamp=True)
    _link(nt, src, m.inputs['Value']); m.inputs['From Min'].default_value = lo; m.inputs['From Max'].default_value = hi
    return m.outputs['Result']


def _noise(nt, coord, scale, detail=4.0, rough=.55, stretch=None):
    if stretch is not None:
        mp = _n(nt, 'ShaderNodeMapping')
        mp.inputs['Scale'].default_value = stretch
        nt.links.new(coord, mp.inputs['Vector'])
        coord = mp.outputs['Vector']
    t = _n(nt, 'ShaderNodeTexNoise')
    nt.links.new(coord, t.inputs['Vector'])
    t.inputs['Scale'].default_value = scale; t.inputs['Detail'].default_value = detail; t.inputs['Roughness'].default_value = rough
    return t.outputs['Fac']


def make_material(s: Surface) -> bpy.types.Material:
    """Build the procedural source material; stores the channel sockets on the material for baking."""
    mat = bpy.data.materials.get(s.name) or bpy.data.materials.new(s.name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = _n(nt, 'ShaderNodeOutputMaterial'); bsdf = _n(nt, 'ShaderNodeBsdfPrincipled')
    co = _n(nt, 'ShaderNodeTexCoord').outputs['Object']
    geo = _n(nt, 'ShaderNodeNewGeometry')
    # Variation of the base colour.
    n1 = _noise(nt, co, s.var_scale)
    base = _mix_color(nt, _ramp(nt, n1, .3, .7), tuple(c * (1 - s.var) for c in s.base), tuple(min(1, c * (1 + s.var)) for c in s.base))
    # Cavity grime from ambient occlusion, plus run-off streaks below horizontal edges.
    ao = _n(nt, 'ShaderNodeAmbientOcclusion', samples=16, only_local=True)
    ao.inputs['Distance'].default_value = .25
    cav = _math(nt, 'SUBTRACT', 1.0, ao.outputs['AO'])
    grime = _math(nt, 'MULTIPLY', _ramp(nt, cav, .05, .6), s.grime_amt)
    if s.streaks:
        st = _noise(nt, co, 3.0, 2.0, .4, stretch=(14, 14, .7))
        grime = _math(nt, 'ADD', grime, _math(nt, 'MULTIPLY', _ramp(nt, st, .55, .75), s.streaks), clamp=True)
    col = _mix_color(nt, grime, base, s.grime)
    # Rust blooms.
    rust = 0.0
    if s.rust:
        rn = _noise(nt, co, 4.0, 8.0, .7)
        rust = _math(nt, 'MULTIPLY', _ramp(nt, rn, .58, .68), s.rust)
        rust = _math(nt, 'ADD', rust, _math(nt, 'MULTIPLY', grime, s.rust * .6), clamp=True)
        col = _mix_color(nt, rust, col, (.33, .14, .06))
    # Dust settling on upward faces.
    if s.dust_amt:
        sep = _n(nt, 'ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sep.inputs[0])
        up = _ramp(nt, sep.outputs['Z'], .35, .9)
        dn = _noise(nt, co, 9.0, 6.0, .6)
        dust = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', up, _ramp(nt, dn, .3, .75)), s.dust_amt)
        col = _mix_color(nt, dust, col, s.dust)
    else:
        dust = 0.0
    # Edge wear: paint chipped off convex edges (curvature from the bevel normal), broken up by noise.
    edge = 0.0
    if s.wear and s.wear_amt:
        bev = _n(nt, 'ShaderNodeBevel', samples=8); bev.inputs['Radius'].default_value = .012
        dot = _n(nt, 'ShaderNodeVectorMath', operation='DOT_PRODUCT')
        nt.links.new(bev.outputs['Normal'], dot.inputs[0]); nt.links.new(geo.outputs['Normal'], dot.inputs[1])
        curv = _math(nt, 'SUBTRACT', 1.0, dot.outputs['Value'])
        en = _noise(nt, co, 22.0, 6.0, .7)
        edge = _math(nt, 'MULTIPLY', _ramp(nt, _math(nt, 'ADD', _math(nt, 'MULTIPLY', curv, 9.0), _math(nt, 'MULTIPLY', en, .6)), .55, .8), s.wear_amt)
        col = _mix_color(nt, edge, col, s.wear)
    # Roughness and metal.
    rn2 = _noise(nt, co, 14.0)
    rough = _math(nt, 'ADD', s.rough, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', rn2, .5), s.rough_var))
    rough = _math(nt, 'ADD', rough, _math(nt, 'MULTIPLY', grime, .25))
    if s.dust_amt: rough = _math(nt, 'ADD', rough, _math(nt, 'MULTIPLY', dust, .35))
    if s.rust: rough = _mix_float(nt, rust, rough, .9)
    if s.wear and s.wear_amt: rough = _mix_float(nt, edge, rough, s.wear_rough)
    rough = _math(nt, 'MAXIMUM', _math(nt, 'MINIMUM', rough, 1.0), .04)
    metal = s.metal
    if s.wear and s.wear_amt: metal = _mix_float(nt, edge, metal, s.wear_metal)
    if s.rust: metal = _mix_float(nt, rust, metal, 0.0)
    if s.dust_amt: metal = _mix_float(nt, dust, metal, 0.0)
    if isinstance(metal, float):
        v = _n(nt, 'ShaderNodeValue'); v.outputs[0].default_value = metal; metal = v.outputs[0]
    # Fine relief.
    bn = _noise(nt, co, s.bump_scale, 6.0, .6)
    bump = _n(nt, 'ShaderNodeBump'); bump.inputs['Strength'].default_value = s.bump; bump.inputs['Distance'].default_value = .002
    nt.links.new(bn, bump.inputs['Height'])
    _link(nt, col, bsdf.inputs['Base Color']); _link(nt, rough, bsdf.inputs['Roughness']); _link(nt, metal, bsdf.inputs['Metallic'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    # Remember the channels (by node name + socket) so the baker can route each to an emission shader.
    ch = {'albedo': col, 'rough': rough, 'metal': metal}
    for k, sock in ch.items():
        mat[f'ch_{k}'] = f'{sock.node.name}|{sock.identifier}'
    return mat


def _socket(mat, key):
    node, ident = mat[f'ch_{key}'].split('|')
    return next(o for o in mat.node_tree.nodes[node].outputs if o.identifier == ident)


# --------------------------------------------------------------------------------------------- UVs, bake, export

def select_only(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def unwrap(ob, margin=.004):
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')


def _bake(ob, kind, img, samples, route=None):
    s = bpy.context.scene
    s.cycles.samples = samples
    s.render.bake.margin = 8
    s.render.bake.use_clear = True
    s.render.bake.normal_space = 'TANGENT'
    restore = []
    for slot in ob.material_slots:
        mat = slot.material; nt = mat.node_tree
        node = nt.nodes.get('BAKE_TARGET') or nt.nodes.new('ShaderNodeTexImage')
        node.name = 'BAKE_TARGET'; node.image = img; nt.nodes.active = node
        if route:
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            old = out.inputs['Surface'].links[0].from_socket
            em = nt.nodes.get('BAKE_EMIT') or nt.nodes.new('ShaderNodeEmission'); em.name = 'BAKE_EMIT'
            em.inputs['Strength'].default_value = 1.0
            src = _socket(mat, route)
            for l in list(em.inputs['Color'].links): nt.links.remove(l)
            nt.links.new(src, em.inputs['Color'])
            nt.links.new(em.outputs[0], out.inputs['Surface'])
            restore.append((nt, old, out))
    select_only(ob)
    bpy.ops.object.bake(type=kind)
    for nt, old, out in restore:
        nt.links.new(old, out.inputs['Surface'])
    return np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)


def _srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= .0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - .055)


def _png(arr01, path):
    from PIL import Image
    a = (np.clip(arr01, 0, 1) * 255 + .5).astype(np.uint8)[::-1]  # Blender rows are bottom-up
    Image.fromarray(a, 'RGB').save(path, optimize=True)


def bake_asset(ob, out_dir, size=1024, ao_in_albedo=.45):
    """Bake every procedural channel to textures and replace the materials with one export material."""
    os.makedirs(out_dir, exist_ok=True)
    key = ob.name[3:]
    img = bpy.data.images.new(f'BAKE_{key}', size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    albedo = _bake(ob, 'EMIT', img, 16, 'albedo')[..., :3]
    rough = _bake(ob, 'EMIT', img, 4, 'rough')[..., 0]
    metal = _bake(ob, 'EMIT', img, 4, 'metal')[..., 0]
    ao = _bake(ob, 'AO', img, 48)[..., 0]
    normal = _bake(ob, 'NORMAL', img, 8)[..., :3]
    albedo = albedo * (1 - ao_in_albedo * (1 - ao[..., None]))
    paths = {k: os.path.join(out_dir, f'{key}_{k}.png') for k in ('color', 'normal', 'orm')}
    _png(_srgb(albedo), paths['color'])
    _png(normal, paths['normal'])
    _png(np.stack([ao, rough, metal], -1), paths['orm'])
    bpy.data.images.remove(img)
    # The export material: what glTF stores and three.js draws.
    m = bpy.data.materials.new(f'M_{key}')
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = _n(nt, 'ShaderNodeOutputMaterial'); bsdf = _n(nt, 'ShaderNodeBsdfPrincipled')
    def tex(path, data):
        t = _n(nt, 'ShaderNodeTexImage'); t.image = bpy.data.images.load(path)
        t.image.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        return t
    c = tex(paths['color'], False); nm = tex(paths['normal'], True); orm = tex(paths['orm'], True)
    nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
    nmap = _n(nt, 'ShaderNodeNormalMap'); nt.links.new(nm.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    sep = _n(nt, 'ShaderNodeSeparateColor'); nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    # glTF occlusion: the exporter reads it from a "glTF Material Output" group's Occlusion input.
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g = _n(nt, 'ShaderNodeGroup'); g.node_tree = grp
    nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    ob.data.materials.clear(); ob.data.materials.append(m)
    for p in ob.data.polygons: p.material_index = 0
    return paths


def triangles(ob) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export_glb(ob, path):
    select_only(ob)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
                              export_image_format='AUTO', export_cameras=False, export_lights=False, export_animations=False,
                              export_extras=False)
