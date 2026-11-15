"""Operation: Metropolis hero props, modelled to the collision boxes they dress (shared/arena/metropolis.mjs).

Each function returns (object, collision box size (x, y, z) in Blender axes). Long axis is +X; base at z = 0.
"""
import math

import bmesh

from mathutils import Matrix, Vector

from campos import Kit, Surface, make_material

# ------------------------------------------------------------------------------------------- shared surfaces
SURFACES = {
    'poly_black': Surface('poly_black', (.035, .036, .038), var=.25, rough=.55, rough_var=.2, grime=(.09, .085, .08), grime_amt=.3,
                          dust=(.36, .33, .3), dust_amt=.4, streaks=.35, bump=.12, bump_scale=90),
    'stand_steel': Surface('stand_steel', (.17, .18, .19), rough=.6, metal=.0, wear=(.32, .3, .28), wear_amt=.8, rust=.55,
                           dust_amt=.4, dust=(.45, .41, .36), bump=.35),
    'pvc_grey': Surface('pvc_grey', (.52, .53, .52), var=.08, rough=.45, grime_amt=.6, dust_amt=.5, streaks=.3, bump=.05),
    'ac_casing': Surface('ac_casing', (.72, .7, .64), var=.06, rough=.42, grime=(.3, .27, .22), grime_amt=.7, streaks=.55,
                         wear=(.45, .45, .46), wear_amt=.6, dust_amt=.45, dust=(.5, .46, .4), rust=.12, bump=.08),
    'coil': Surface('coil', (.28, .29, .3), rough=.5, metal=.85, grime=(.1, .09, .08), grime_amt=.8, dust_amt=.3, bump=.6, bump_scale=200),
    'fan_black': Surface('fan_black', (.03, .03, .03), rough=.5, grime_amt=.2, dust_amt=.5, bump=.05),
    'copper': Surface('copper', (.72, .38, .2), rough=.35, metal=1.0, grime=(.18, .22, .16), grime_amt=.9, bump=.1),
    'foam': Surface('foam', (.02, .02, .02), rough=.85, grime_amt=.1, dust_amt=.5, bump=.8, bump_scale=140),
    'rubber': Surface('rubber', (.025, .025, .025), rough=.88, grime=(.08, .07, .06), grime_amt=.4, dust_amt=.35, bump=.3, bump_scale=120),
    'galv': Surface('galv', (.6, .62, .62), var=.18, var_scale=18, rough=.55, rough_var=.3, metal=.45, grime=(.2, .19, .17),
                    grime_amt=.85, streaks=.6, dust_amt=.35, dust=(.48, .44, .38), rust=.18, bump=.12),
    'dark_paint': Surface('dark_paint', (.11, .12, .12), rough=.5, wear=(.4, .4, .41), wear_amt=.7, rust=.25, dust_amt=.4, streaks=.3, bump=.15),
    'concrete': Surface('concrete', (.48, .46, .42), var=.18, var_scale=10, rough=.92, grime=(.18, .17, .15), grime_amt=.8,
                        streaks=.4, dust_amt=.2, bump=.6, bump_scale=45),
    'cabinet_green': Surface('cabinet_green', (.2, .26, .21), var=.08, rough=.48, grime=(.1, .1, .08), grime_amt=.7, streaks=.6,
                             wear=(.45, .45, .44), wear_amt=.75, rust=.15, dust_amt=.3, bump=.1),
    'steel_bright': Surface('steel_bright', (.62, .62, .6), rough=.32, metal=1.0, grime_amt=.6, bump=.1),
    'sign_yellow': Surface('sign_yellow', (.85, .62, .05), var=.05, rough=.45, grime_amt=.6, streaks=.3, bump=.02),
    'sign_white': Surface('sign_white', (.8, .8, .78), var=.05, rough=.45, grime_amt=.6, streaks=.3, bump=.02),
    'bin_lid': Surface('bin_lid', (.08, .2, .1), var=.12, rough=.55, grime=(.07, .07, .05), grime_amt=.6, dust_amt=.6, streaks=.4, bump=.1),
    'fork_yellow': Surface('fork_yellow', (.8, .52, .04), var=.07, rough=.42, grime=(.15, .12, .08), grime_amt=.75, streaks=.35,
                           wear=(.12, .11, .1), wear_amt=.9, wear_metal=.0, wear_rough=.7, dust_amt=.35, rust=.08, bump=.1),
    'fork_black': Surface('fork_black', (.04, .04, .045), rough=.45, wear=(.42, .41, .4), wear_amt=.85, rust=.15, dust_amt=.35, bump=.12),
    'fork_steel': Surface('fork_steel', (.2, .2, .2), rough=.45, metal=.6, wear=(.6, .6, .6), wear_amt=1.0, rust=.35, bump=.3),
    'vinyl': Surface('vinyl', (.03, .03, .03), rough=.55, grime_amt=.3, wear=(.12, .12, .12), wear_amt=.6, wear_metal=0, wear_rough=.8, bump=.2, bump_scale=150),
    'lens': Surface('lens', (.85, .85, .8), rough=.1, grime_amt=.4, bump=.0),
    'beacon': Surface('beacon', (.9, .35, .02), rough=.2, grime_amt=.4, bump=.0),
}


def mats(*names):
    for n in names:
        make_material(SURFACES[n])
    return list(names)


# ------------------------------------------------------------------------------------------- rooftop water tank
def roof_tank(coll):
    """1.7 × 1.7 × 2.5 m: a ribbed black polyethylene tank on a braced angle-iron stand, with inlet and outlet."""
    k = Kit('roofTank', mats('poly_black', 'stand_steel', 'pvc_grey'))
    H0, L = .55, .76
    # Stand: four angle-iron legs, a ring frame, two joists, X-braces on every side, a deck plate and foot plates.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * L, sy * L
            k.span((x - .03, y - .003, 0), (x + .03, y + .003, H0), 'stand_steel')
            k.span((x - .003, y - .03, 0), (x + .003, y + .03, H0), 'stand_steel')
            k.span((x - .07, y - .07, 0), (x + .07, y + .07, .012), 'stand_steel', .003)
    for s in (-1, 1):
        k.span((-L - .03, s * L - .03, H0 - .05), (L + .03, s * L + .03, H0), 'stand_steel', .004)
        k.span((s * L - .03, -L - .03, H0 - .05), (s * L + .03, L + .03, H0), 'stand_steel', .004)
        k.span((-L, s * .26 - .02, H0 - .06), (L, s * .26 + .02, H0), 'stand_steel', .004)
        for d in (-1, 1):
            k.beam((-L, s * L, .05), (L, s * L, H0 - .06), .04, .006, 'stand_steel', side=Vector((d, 0, 0)))
            k.beam((s * L, -L, .05), (s * L, L, H0 - .06), .04, .006, 'stand_steel', side=Vector((0, d, 0)))
    k.span((-L, -L, H0), (L, L, H0 + .012), 'stand_steel', .003)
    # The tank: a lathed profile with moulded ribs, a rounded foot, a domed shoulder and a screw lid.
    R, z0, body = .8, H0 + .012, 1.52
    prof = [(0, z0), (R - .06, z0), (R - .015, z0 + .02), (R, z0 + .06)]
    n = 40
    for i in range(1, n + 1):
        t = i / n
        prof.append((R + .018 * max(0, math.sin(t * math.pi * 9)) ** 3, z0 + .06 + t * body))
    top = z0 + .06 + body
    for i in range(1, 9):
        a = i / 8 * math.pi / 2
        prof.append((.28 + (R - .28) * math.cos(a), top + .2 * math.sin(a)))
    prof += [(.26, top + .2), (.25, top + .23), (0, top + .23)]
    k.lathe(prof, 'poly_black', 40)
    k.lathe([(0, top + .23), (.27, top + .23), (.27, top + .3), (.255, top + .31), (0, top + .31)], 'poly_black', 32)
    for i in range(24):
        a = 2 * math.pi * i / 24
        k.box((.272 * math.cos(a), .272 * math.sin(a), top + .265), (.016, .016, .06), 'poly_black', M=Matrix.Rotation(a, 4, 'Z'))
    # Outlet: from the foot of the tank, through the deck, down to the roof and away (between two legs).
    c45 = math.cos(math.pi / 4)
    p0 = Vector((R * c45, R * c45, z0 + .12))
    k.pipe([p0 - Vector((.05, .05, 0)), p0 + Vector((.08, .08, 0)), Vector((.62, .62, .06)), Vector((.62, .83, .06))], .03, 'pvc_grey')
    k.cyl((p0.x + .02, p0.y + .02, p0.z - .045), .045, .09, 'pvc_grey', 14)  # gate valve body
    k.rod((p0.x + .02, p0.y + .02, p0.z + .045), (p0.x + .02, p0.y + .02, p0.z + .1), .008, 'stand_steel', 8)
    k.cyl((p0.x + .02, p0.y + .02, p0.z + .1), .035, .012, 'stand_steel', 12)
    # Inlet from the riser, over the shoulder into the float valve under the dome.
    k.pipe([(.83, 0, H0 + .02), (.83, 0, top + .1), (.56, 0, top + .1), (.42, 0, top + .1)], .02, 'pvc_grey')
    # Overflow on the other side.
    k.pipe([(-R + .01, 0, top - .12), (-.83, 0, top - .12), (-.83, 0, H0 + .03)], .018, 'pvc_grey')
    return k.finish(coll), (1.7, 1.7, 2.5)


# ------------------------------------------------------------------------------------------- packaged rooftop AC
def roof_ac(coll):
    """1.4 × 1.0 × 1.15 m: a top-discharge condensing unit on steel rails, coil on three sides, fan guard, pipework."""
    k = Kit('roofAC', mats('ac_casing', 'coil', 'fan_black', 'copper', 'foam', 'stand_steel'))
    X, Y = .65, .46
    for s in (-1, 1):
        k.span((-.7, s * .36 - .04, 0), (.7, s * .36 + .04, .1), 'stand_steel', .006)
        k.span((-.7, s * .36 - .04, .088), (.7, s * .36 + .04, .1), 'stand_steel')
    z0, z1 = .1, 1.1
    k.span((-X - .01, -Y - .01, z0), (X + .01, Y + .01, z0 + .07), 'ac_casing', .01)  # base pan
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.span((sx * X - .035, sy * Y - .035, z0), (sx * X + .035, sy * Y + .035, z1), 'ac_casing', .006)
    # Coil faces (back and both ends) behind horizontal louvres.
    k.span((-X + .03, Y - .04, z0 + .07), (X - .03, Y - .02, z1 - .06), 'coil')
    for s in (-1, 1):
        k.span((s * X - .04 if s > 0 else -X + .02, -Y + .03, z0 + .07), (s * X - .02 if s > 0 else -X + .04, Y - .03, z1 - .06), 'coil')
    z = z0 + .1
    while z < z1 - .08:
        k.span((-X, Y - .012, z), (X, Y + .012, z + .006), 'ac_casing')
        for s in (-1, 1):
            k.span((s * X - .012, -Y, z), (s * X + .012, Y, z + .006), 'ac_casing')
        z += .028
    # Front service panel with screws, a rating plate and the service valves.
    k.span((-X + .03, -Y - .012, z0 + .07), (X - .03, -Y + .01, z1 - .06), 'ac_casing', .004)
    for x in (-X + .07, X - .07):
        for zz in (z0 + .12, z1 - .1, (z0 + z1) / 2):
            k.cyl((x, -Y - .012, zz), .007, .004, 'stand_steel', 8, axis='Y')
    k.span((-.25, -Y - .014, .78), (.05, -Y - .012, .9), 'stand_steel')
    for i, (r, mat) in enumerate(((.022, 'foam'), (.012, 'copper'))):
        x = .42 + i * .1
        k.pipe([(x, -Y - .01, .3), (x, -Y - .09, .3), (x, -Y - .09, .02)], r, mat)
        k.cyl((x - .03, -Y - .03, .3 - .03), .02, .06, 'copper', 8)
    # Disconnect switch on the end.
    k.span((X + .01, -.2, .55), (X + .08, .0, .82), 'ac_casing', .006)
    k.span((X + .08, -.12, .66), (X + .1, -.08, .74), 'fan_black', .003)
    # Top: panel frame around the fan shroud, the fan, the guard.
    k.span((-X - .02, -Y - .02, z1 - .03), (X + .02, Y + .02, z1), 'ac_casing', .01)
    k.cyl((0, 0, z1 - .22), .38, .2, 'fan_black', 36, caps=False)
    k.cyl((0, 0, z1 - .23), .37, .01, 'fan_black', 36)
    k.cyl((0, 0, z1 - .2), .07, .08, 'fan_black', 16)
    for i in range(4):
        a = i * math.pi / 2 + .3
        k.box((.19 * math.cos(a), .19 * math.sin(a), z1 - .15), (.26, .09, .008), 'fan_black', M=Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(.35, 4, 'X'))
    for r in (.08, .15, .22, .29, .36):
        k.ring(r, .004, 'stand_steel', (0, 0, z1 + .01), seg=40, tube=4)
    for i in range(8):
        a = i * math.pi / 4
        k.beam((.05 * math.cos(a), .05 * math.sin(a), z1 + .012), (.37 * math.cos(a), .37 * math.sin(a), z1 + .012), .008, .006, 'stand_steel', side=Vector((0, 0, 1)))
    k.cyl((0, 0, z1 - .005), .05, .03, 'stand_steel', 14)
    return k.finish(coll), (1.4, 1.0, 1.15)


# ------------------------------------------------------------------------------------------- rooftop ventilation unit
def roof_vent(coll):
    """2.2 × 1.4 × 1.5 m: a galvanised supply/extract unit on a curb, louvred intake, two mushroom exhausts."""
    k = Kit('roofVent', mats('galv', 'dark_paint', 'stand_steel'))
    k.span((-1.1, -.7, 0), (1.1, .7, .2), 'galv', .01)
    k.span((-1.08, -.68, .2), (1.08, .68, .23), 'galv', .006)
    X, Y, z0, z1 = 1.0, .6, .23, 1.03
    k.span((-X, -Y, z0), (X, Y, z1), 'galv', .012)
    for i in range(-3, 4):
        x = i * .28
        for s in (-1, 1):
            k.span((x - .008, s * Y - .006, z0), (x + .008, s * Y + .012 * s, z1), 'galv')
    k.span((-X - .012, -Y - .012, z1 - .02), (X + .012, Y + .012, z1 + .02), 'galv', .006)
    # Louvred intake on the front: a frame and angled blades.
    k.span((-.75, -Y - .03, z0 + .12), (-.05, -Y - .005, z0 + .62), 'dark_paint', .006)
    z = z0 + .17
    while z < z0 + .58:
        k.box((-.4, -Y - .035, z), (.66, .006, .07), 'dark_paint', M=Matrix.Rotation(-.7, 4, 'X'))
        z += .05
    # Access door on the end.
    k.span((X - .005, -.35, z0 + .1), (X + .012, .35, z1 - .1), 'galv', .006)
    for zz in (z0 + .2, z1 - .2):
        k.cyl((X + .012, .37, zz - .05), .012, .1, 'stand_steel', 8)
    k.span((X + .012, -.3, (z0 + z1) / 2 - .05), (X + .04, -.27, (z0 + z1) / 2 + .05), 'stand_steel', .004)
    # Two mushroom exhausts: stack, struts, cap.
    for x in (-.5, .45):
        k.cyl((x, .05, z1), .23, .06, 'galv', 28)
        k.cyl((x, .05, z1 + .06), .2, .2, 'galv', 28, caps=False)
        for i in range(3):
            a = i * 2 * math.pi / 3
            k.beam((x + .2 * math.cos(a), .05 + .2 * math.sin(a), z1 + .24), (x + .24 * math.cos(a), .05 + .24 * math.sin(a), z1 + .3), .02, .004, 'galv')
        k.lathe([(0, z1 + .44), (.12, z1 + .43), (.3, z1 + .32), (.32, z1 + .29), (.3, z1 + .285), (0, z1 + .31)], 'dark_paint', 28, at=(x, .05, 0))
    # Bolted flange along the curb.
    for i in range(-7, 8):
        for s in (-1, 1):
            k.cyl((i * .14, s * .685, .215), .008, .02, 'stand_steel', 6)
    return k.finish(coll), (2.2, 1.4, 1.5)


# ------------------------------------------------------------------------------------------- street utility cabinet
def utility_cabinet(coll):
    """1.1 × 0.9 × 1.25 m: a painted-steel feeder pillar on a concrete plinth: double doors, louvres, lock, warning sign."""
    k = Kit('utilityCabinet', mats('cabinet_green', 'concrete', 'steel_bright', 'sign_yellow', 'fan_black', 'sign_white'))
    k.span((-.55, -.45, 0), (.55, .45, .1), 'concrete', .02)
    X, Y, z0, z1 = .5, .37, .1, 1.14
    k.span((-X, -Y, z0), (X, Y, z1), 'cabinet_green', .012)
    k.span((-X - .04, -Y - .05, z1), (X + .04, Y + .05, z1 + .03), 'cabinet_green', .008)
    k.box((0, 0, z1 + .055), (2 * X + .06, 2 * Y + .08, .03), 'cabinet_green', .008, M=Matrix.Rotation(.0, 4, 'X'))
    k.span((-X - .02, -Y - .03, z1 + .07), (X + .02, Y + .03, 1.2), 'cabinet_green', .01)
    k.span((-X + .05, -Y + .05, 1.2), (X - .05, Y - .05, 1.25), 'cabinet_green', .02)
    # Two doors, slightly proud, with a centre seam, hinges, louvres top and bottom, a T-handle and lock.
    for s in (-1, 1):
        x0, x1 = (-X + .03, -.006) if s < 0 else (.006, X - .03)
        k.span((x0, -Y - .012, z0 + .05), (x1, -Y + .002, z1 - .05), 'cabinet_green', .004)
        hx = x0 - .012 if s < 0 else x1 + .012
        for zz in (z0 + .15, z1 - .2):
            k.cyl((hx, -Y - .008, zz), .01, .09, 'cabinet_green', 8)
        cx = (x0 + x1) / 2
        for zb in (z0 + .12, z1 - .2):
            for j in range(5):
                k.box((cx, -Y - .016, zb + j * .018), (x1 - x0 - .12, .004, .012), 'fan_black', M=Matrix.Rotation(.6, 4, 'X'))
    k.span((-.04, -Y - .03, .58), (-.02, -Y - .012, .76), 'steel_bright', .004)
    k.span((-.07, -Y - .045, .74), (.01, -Y - .03, .76), 'steel_bright', .004)
    k.cyl((.03, -Y - .012, .66), .012, .012, 'steel_bright', 10, axis='Y', r2=None)
    # Warning sign (triangle with a bolt) and a white asset plate.
    T = Matrix.Translation((.25, -Y - .016, .95)) @ Matrix.Rotation(-math.pi / 2, 4, 'X') @ Matrix.Rotation(math.pi / 2, 4, 'Z')
    r = bmesh.ops.create_cone(k.bm, cap_ends=True, segments=3, radius1=.075, radius2=.075, depth=.004, matrix=T)
    k._finish(r['verts'], 'sign_yellow', False)
    for a, b in (((.25, .985), (.235, .945)), ((.235, .945), (.262, .95)), ((.262, .95), (.247, .905))):
        k.beam((a[0], -Y - .02, a[1]), (b[0], -Y - .02, b[1]), .008, .003, 'fan_black', side=Vector((0, 1, 0)))
    k.span((-.36, -Y - .016, .9), (-.16, -Y - .012, .98), 'sign_white', .002)
    return k.finish(coll), (1.1, 0.9, 1.25)


# ------------------------------------------------------------------------------------------- 4-wheel waste container
def waste_bin(coll):
    """1.2 × 1.0 × 1.3 m: a galvanised four-wheel refuse container: castors, tapered body, lifting comb, plastic lid."""
    k = Kit('wasteBin', mats('galv', 'rubber', 'stand_steel', 'bin_lid'))
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * .42, sy * .3
            k.span((x - .05, y - .05, .19), (x + .05, y + .05, .23), 'stand_steel', .005)
            k.span((x - .012, y - .035, .1), (x + .012, y + .035, .2), 'stand_steel', .003)
            k.cyl((x - .03, y, .1), .095, .06, 'rubber', 18, axis='X')
            k.cyl((x - .035, y, .1), .045, .07, 'stand_steel', 12, axis='X')
    k.taper((0, 0, .23), (1.0, .78), (1.12, .9), .85, 'galv', .03)
    for i in (-2, -1, 0, 1, 2):
        for s in (-1, 1):
            k.beam((i * .19, s * .39, .26), (i * .21, s * .45, 1.05), .04, .015, 'galv', side=Vector((1, 0, 0)))
    k.span((-.58, -.47, 1.06), (.58, .47, 1.12), 'galv', .015)
    # Front lifting comb, handles and side trunnions.
    k.span((-.5, -.52, .93), (.5, -.46, 1.02), 'galv', .01)
    for x in (-.4, .4):
        k.pipe([(x, -.45, .78), (x, -.54, .78), (x, -.54, .62), (x, -.43, .62)], .015, 'stand_steel', 8)
    for s in (-1, 1):
        k.cyl((.56 if s > 0 else -.61, 0, .95), .04, .05, 'galv', 14, axis='X')
    # Domed plastic lid in two halves, hinged at the back, with lift handles.
    for s in (-1, 1):
        x0, x1 = (-.59, -.005) if s < 0 else (.005, .59)
        k.span((x0, -.49, 1.12), (x1, .49, 1.17), 'bin_lid', .02)
        k.span((x0 + .03, -.45, 1.17), (x1 - .03, .43, 1.21), 'bin_lid', .02)
        k.span(((x0 + x1) / 2 - .1, -.52, 1.13), ((x0 + x1) / 2 + .1, -.49, 1.19), 'bin_lid', .008)
    k.cyl((-.58, .5, 1.14), .02, 1.16, 'stand_steel', 10, axis='X')
    return k.finish(coll), (1.2, 1.0, 1.3)


# ------------------------------------------------------------------------------------------- counterbalance forklift
def forklift(coll):
    """2.5 × 1.3 × 2.1 m: an LPG counterbalance forklift, forks toward +X."""
    k = Kit('forklift', mats('fork_yellow', 'fork_black', 'fork_steel', 'rubber', 'vinyl', 'lens', 'beacon', 'stand_steel'))
    # Wheels: drive at the front, steer at the back, each with a hub and nuts.
    for x, r, w in ((.32, .3, .2), (-.86, .23, .16)):
        for s in (-1, 1):
            y0 = s * (.6 - w)
            k.cyl((x, y0 if s > 0 else -.6, r), r, w, 'rubber', 28, axis='Y')
            k.cyl((x, s * .605 - (.012 if s > 0 else 0), r), r * .58, .012, 'fork_black', 20, axis='Y')
            for i in range(6):
                a = i * math.pi / 3
                k.cyl((x + .09 * r * 3 * math.cos(a) * .55, s * .61 - (.01 if s > 0 else 0), r + .09 * r * 3 * math.sin(a) * .55), .012, .012, 'stand_steel', 6, axis='Y')
    # Chassis and body.
    k.span((-1.0, -.4, .14), (.56, .4, .55), 'fork_black', .02)
    k.span((-.6, -.62, .32), (-.04, .62, 1.0), 'fork_yellow', .04)
    for s in (-1, 1):
        k.span((0, s * .62, .64), (.6, s * .4, .7), 'fork_yellow', .02)
        k.span((-1.22, s * .62, .5), (-.62, s * .4, .58), 'fork_yellow', .02)
        k.span((.05, s * .63, .35), (.32, s * .5, .37), 'fork_black', .004)  # step
    k.span((-1.25, -.6, .5), (-.6, .6, 1.15), 'fork_yellow', .12)  # counterweight
    k.span((-1.25, -.4, .14), (-1.0, .4, .55), 'fork_yellow', .06)
    k.span((-1.27, -.25, .22), (-1.2, .25, .34), 'fork_black', .01)  # tow pin pocket
    # Engine hood and seat.
    k.span((-.75, -.5, 1.0), (-.05, .5, 1.08), 'fork_yellow', .03)
    k.span((-.58, -.25, 1.08), (-.18, .25, 1.2), 'vinyl', .04)
    k.box((-.6, 0, 1.42), (.08, .48, .42), 'vinyl', .04, M=Matrix.Rotation(-.18, 4, 'Y'))
    # Cowl, dash, steering column and wheel.
    k.span((-.05, -.55, .95), (.45, .55, 1.22), 'fork_yellow', .04)
    k.span((.2, -.35, 1.22), (.4, .35, 1.3), 'fork_black', .02)
    k.rod((.25, 0, 1.22), (.06, 0, 1.46), .025, 'fork_black')
    tilt = Matrix.Rotation(-.75, 4, 'Y')
    k.ring(.17, .016, 'vinyl', (.05, 0, 1.47), tilt, seg=32, tube=6)
    k.cyl((.05, 0, 1.46), .04, .03, 'fork_black', 12)
    for y in (-.22, .22):
        k.rod((.32, y, 1.3), (.28, y, 1.45), .012, 'fork_black', 8)  # levers
        k.cyl((.28, y, 1.45), .022, .04, 'fork_black', 10)
    # Overhead guard.
    for x, zb in ((.42, 1.0), (-.72, 1.08)):
        for s in (-1, 1):
            k.span((x - .03, s * .55 - .03, zb), (x + .03, s * .55 + .03, 1.98), 'fork_black', .006)
    for s in (-1, 1):
        k.span((-.75, s * .55 - .03, 1.92), (.45, s * .55 + .03, 2.0), 'fork_black', .008)
    for x in (-.72, .42):
        k.span((x - .03, -.58, 1.92), (x + .03, .58, 2.0), 'fork_black', .008)
    for i in range(1, 7):
        y = -.55 + i * 1.1 / 7
        k.span((-.72, y - .012, 1.96), (.42, y + .012, 1.99), 'fork_black')
    # Lights and beacon; the LPG cylinder behind the seat.
    for s in (-1, 1):
        k.cyl((.46, s * .55, 1.7), .05, .07, 'fork_black', 14, axis='X')
        k.cyl((.53, s * .55, 1.7), .042, .006, 'lens', 14, axis='X')
    k.cyl((-.72, 0, 2.0), .05, .02, 'fork_black', 14)
    k.lathe([(0, 2.02), (.042, 2.02), (.04, 2.07), (.025, 2.1), (0, 2.1)], 'beacon', 14, at=(-.72, 0, 0))
    k.cyl((-1.0, -.38, 1.33), .15, .76, 'stand_steel', 24, axis='Y')
    k.lathe([(0, 0), (.15, 0), (.15, .02)], 'stand_steel', 24, at=(-1.0, -.38, 1.33), M=Matrix.Rotation(math.pi / 2, 4, 'X'))
    k.cyl((-1.0, .38, 1.33), .05, .06, 'fork_steel', 10, axis='Y')
    for y in (-.25, .25):
        k.span((-1.12, y - .02, 1.15), (-.88, y + .02, 1.5), 'fork_black', .004)
    # Mast: outer and inner channels, cross ties, lift cylinder and chains.
    for s in (-1, 1):
        k.span((.6, s * .36 - .04, .1), (.68, s * .36 + .04, 2.0), 'fork_black', .008)
        k.span((.68, s * .28 - .035, .12), (.74, s * .28 + .035, 1.95), 'fork_black', .008)
        k.span((.66, s * .32 - .006, .5), (.72, s * .32 + .006, 1.9), 'stand_steel')  # chain
        k.rod((.55, s * .36, .9), (.6, s * .3, .5), .03, 'fork_steel')  # tilt cylinder
    for z in (.12, 1.1, 1.95):
        k.span((.6, -.4, z), (.68, .4, z + .08), 'fork_black', .006)
    k.cyl((.66, 0, .2), .045, 1.4, 'fork_steel', 14)
    k.cyl((.66, 0, .2), .055, .9, 'fork_black', 14)
    # Carriage, load backrest and forks.
    k.span((.74, -.5, .12), (.79, .5, .5), 'fork_black', .008)
    for z in (.5, 1.02):
        k.span((.75, -.5, z), (.79, .5, z + .04), 'fork_black', .006)
    for i in range(9):
        y = -.48 + i * .12
        k.span((.76, y - .012, .5), (.78, y + .012, 1.02), 'fork_black')
    for y in (-.3, .3):
        k.span((.79, y - .05, .04), (.84, y + .05, .52), 'fork_steel', .006)
        k.span((.8, y - .05, .02), (1.25, y + .05, .07), 'fork_steel', .006)
    return k.finish(coll), (2.5, 1.3, 2.1)


ASSETS = {
    'roofTank': ('Rooftop', roof_tank),
    'roofAC': ('Rooftop', roof_ac),
    'roofVent': ('Rooftop', roof_vent),
    'utilityCabinet': ('Street', utility_cabinet),
    'wasteBin': ('Street', waste_bin),
    'forklift': ('Industrial', forklift),
}
