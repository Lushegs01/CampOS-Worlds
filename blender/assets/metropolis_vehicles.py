"""Operation: Metropolis vehicles, modelled to the collision boxes they stand in (shared/arena/metropolis.mjs:
`car` 4.3 × 1.8 × 1.45, `pickup` 5.2 × 1.95 × 1.9, `van` 6.4 × 2.3 × 2.9, `bus` 9.4 × 2.55 × 3.1).

Each function returns (object, collision box size (x, y, z) in Blender axes). Long axis is +X with the front at +X;
base at z = 0; the body is a little inside the box so mirrors stay within it. Cars and pickups are lofted shells
(cross-sections sampled along the length, so bonnet, windscreen rake, roof and boot are one continuous surface, with
the wheel arches cut into the sides); the bus and the van are panelled bodies. All original geometry.
"""
import math

from mathutils import Matrix, Vector

from campos import Kit, Surface, make_material

SURFACES = {
    'paint_silver': Surface('paint_silver', (.55, .57, .58), var=.04, rough=.28, rough_var=.1, metal=.35, grime=(.2, .18, .15),
                            grime_amt=.45, dust=(.5, .46, .4), dust_amt=.35, streaks=.25, wear=(.3, .3, .3), wear_amt=.15, bump=.03),
    'paint_red': Surface('paint_red', (.42, .05, .04), var=.05, rough=.26, rough_var=.1, metal=.15, grime=(.15, .1, .08),
                         grime_amt=.45, dust=(.5, .45, .38), dust_amt=.35, streaks=.25, wear=(.3, .3, .3), wear_amt=.15, bump=.03),
    'paint_white': Surface('paint_white', (.78, .78, .76), var=.04, rough=.32, grime=(.25, .22, .18), grime_amt=.6,
                           dust=(.5, .46, .4), dust_amt=.4, streaks=.5, wear=(.35, .35, .35), wear_amt=.15, bump=.03),
    'paint_navy': Surface('paint_navy', (.04, .1, .22), var=.05, rough=.3, metal=.1, grime=(.12, .11, .1), grime_amt=.5,
                          dust=(.5, .46, .4), dust_amt=.3, streaks=.3, wear=(.35, .35, .35), wear_amt=.12, bump=.03),
    'paint_green': Surface('paint_green', (.1, .2, .14), var=.05, rough=.34, metal=.1, grime=(.12, .11, .1), grime_amt=.55,
                           dust=(.5, .46, .4), dust_amt=.45, streaks=.3, wear=(.35, .35, .35), wear_amt=.2, rust=.08, bump=.03),
    'glass': Surface('glass', (.015, .02, .025), var=.02, rough=.05, rough_var=.04, grime=(.18, .17, .15), grime_amt=.1,
                     dust=(.45, .42, .38), dust_amt=.06, bump=.0),
    'tonneau': Surface('tonneau', (.035, .035, .037), var=.08, rough=.7, grime_amt=.35, dust=(.45, .41, .36), dust_amt=.45, bump=.25, bump_scale=140),
    'trim': Surface('trim', (.03, .03, .032), var=.06, rough=.62, grime_amt=.4, dust=(.42, .39, .35), dust_amt=.35, bump=.12, bump_scale=120),
    'chrome': Surface('chrome', (.7, .7, .7), rough=.15, metal=1.0, grime_amt=.4, bump=.0),
    'rubber': Surface('rubber', (.025, .025, .025), rough=.86, grime=(.08, .07, .06), grime_amt=.35, dust=(.4, .36, .3),
                      dust_amt=.45, bump=.35, bump_scale=160),
    'rim': Surface('rim', (.5, .51, .52), rough=.3, metal=.9, grime=(.12, .1, .08), grime_amt=.85, dust=(.32, .28, .24), dust_amt=.4, bump=.05),
    'steel_rim': Surface('steel_rim', (.16, .16, .17), rough=.5, metal=.6, grime=(.12, .1, .08), grime_amt=.8, rust=.3, bump=.1),
    'headlamp': Surface('headlamp', (.8, .82, .82), rough=.08, metal=.3, grime_amt=.3, bump=.0),
    'taillamp': Surface('taillamp', (.45, .02, .02), rough=.12, grime_amt=.3, bump=.0),
    'amber': Surface('amber', (.8, .38, .02), rough=.12, grime_amt=.3, bump=.0),
    'plate': Surface('plate', (.8, .8, .74), var=.03, rough=.5, grime_amt=.6, bump=.02),
    'chassis': Surface('chassis', (.06, .06, .06), rough=.7, grime=(.08, .07, .06), grime_amt=.8, dust=(.38, .34, .28), dust_amt=.6, rust=.35, bump=.3),
    'box_white': Surface('box_white', (.74, .74, .72), var=.06, var_scale=3, rough=.45, grime=(.24, .21, .17), grime_amt=.85,
                         streaks=.8, dust=(.48, .44, .38), dust_amt=.4, wear=(.4, .4, .4), wear_amt=.2, bump=.05),
    'alu': Surface('alu', (.6, .61, .62), rough=.35, metal=.85, grime=(.2, .18, .15), grime_amt=.8, streaks=.4, bump=.08),
    'board': Surface('board', (.02, .02, .025), rough=.2, grime_amt=.2, bump=.0),
}


def mats(*names):
    for n in names:
        if n not in __import__('bpy').data.materials:
            make_material(SURFACES[n])
    return list(names)


# ------------------------------------------------------------------------------------------- shared parts
def wheel(k, x, y, z, r, w, rim_mat='rim', spokes=5, r_rim=None):
    """A tyre (sidewall bulge, tread shoulder) with a rim: `spokes` spokes, a hub and wheel nuts. Axis along Y; y is
    the outer face's side (+ or −)."""
    s = 1 if y > 0 else -1
    R = Matrix.Rotation(-s * math.pi / 2, 4, 'X')  # lathe +Z → outward ±Y
    at = (x, y - s * w, z)
    r_rim = r_rim or r * .62
    k.lathe([(r_rim * .98, 0), (r * .9, .0), (r * .98, w * .1), (r, w * .25), (r, w * .75), (r * .98, w * .9), (r * .9, w), (r_rim * .98, w)],
            'rubber', 36, at, R)
    # Rim barrel and face.
    k.lathe([(r_rim, w * .1), (r_rim, w * .95), (r_rim * .9, w * .97)], rim_mat, 28, at, R)
    k.lathe([(r_rim * .9, w * .97), (r_rim * .25, w * .9), (0, w * .92)], 'trim', 24, at, R)
    hub = Vector(at) + Vector((0, s * w * .97, 0))
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        d = Vector((math.cos(a), 0, math.sin(a)))
        k.beam(hub + d * r_rim * .18, hub + d * r_rim * .93, r_rim * .2, .03, rim_mat, side=Vector((0, 1, 0)), bevel=.01)
    k.cyl(hub - Vector((0, s * .02, 0)), r_rim * .22, .05, rim_mat, 16, axis='Y')
    for i in range(spokes):
        a = 2 * math.pi * (i + .5) / spokes
        k.cyl(hub + Vector((r_rim * .14 * math.cos(a), s * .02, r_rim * .14 * math.sin(a))), .011, .02, 'chrome', 6, axis='Y')


def flare(k, wx, y, cz, R, w, mat, n=12):
    """A wheel-arch flare: the upper half-circle of radius R round the hub (wx, cz), w wide across the body."""
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        p0 = Vector((wx + R * math.cos(a0), y, cz + R * math.sin(a0)))
        p1 = Vector((wx + R * math.cos(a1), y, cz + R * math.sin(a1)))
        k.beam(p0, p1, w, .06, mat, side=Vector((0, 1, 0)), bevel=.012)


def loft(k, xs, section, material, cap):
    """A closed shell through cross-sections. section(x) → list of (y, z) for the right half (y ≥ 0), from the bottom
    centre round to the top centre; mirrored for the left. material(x, i, n, y, z) → material name for the quad that
    starts at point i of n (half ring)."""
    rings = []
    for x in xs:
        half = section(x)
        pts = half + [(-y, z) for y, z in reversed(half[1:-1])]
        rings.append([k.bm.verts.new((x, y, z)) for y, z in pts])
    n = len(half)
    faces = []
    for a in range(len(rings) - 1):
        A, B = rings[a], rings[a + 1]
        m = len(A)
        for i in range(m):
            j = (i + 1) % m
            f = k.bm.faces.new((A[i], A[j], B[j], B[i]))
            hi = i if i < n - 1 else m - i - 1  # mirror index into the half ring
            cx = (A[i].co.x + B[i].co.x) / 2
            y = abs(A[i].co.y + A[j].co.y) / 2
            z = (A[i].co.z + A[j].co.z + B[i].co.z + B[j].co.z) / 4
            f.material_index = k.m(material(cx, hi, n, y, z))
            f.smooth = True
            faces.append(f)
    # Caps.
    for R in (rings[0], rings[-1]):
        f = k.bm.faces.new(R if R is rings[-1] else list(reversed(R)))
        f.material_index = k.m(cap)
    return faces


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def keys(pairs):
    """Piecewise-smooth interpolation through (x, value) keys (x ascending)."""
    def f(x):
        if x <= pairs[0][0]:
            return pairs[0][1]
        for (x0, v0), (x1, v1) in zip(pairs, pairs[1:]):
            if x <= x1:
                return v0 + (v1 - v0) * ease((x - x0) / (x1 - x0))
        return pairs[-1][1]
    return f


def arch_bottom(x, wheels, base, r, cz):
    """The underside of the body, raised round each wheel (hub height cz) into an arch of radius r."""
    z = base
    for wx in wheels:
        d = abs(x - wx)
        if d < r:
            z = max(z, cz + math.sqrt(r * r - d * d))
    return z


# ------------------------------------------------------------------------------------------- sedan
def _sedan(name, paint, coll):
    k = Kit(name, mats(paint, 'glass', 'trim', 'chrome', 'rubber', 'rim', 'headlamp', 'taillamp', 'amber', 'plate', 'chassis'))
    L, W = 4.24, .82  # length, half width of the body
    WX, WR, TR = 1.33, .43, .32  # wheel stations ±WX, arch radius, tyre radius
    x0, x1 = -L / 2, L / 2
    belt = keys([(x0, .86), (x0 + .25, .92), (-1.0, .93), (.7, .9), (x1 - .25, .8), (x1, .7)])
    top = keys([(x0, .9), (-1.15, .96), (-.62, 1.4), (-.1, 1.43), (.32, 1.4), (.85, .97), (x1 - .2, .84), (x1, .72)])
    cabin = lambda x: -1.12 < x < .86
    half_w = lambda x: W * (1 - (abs(x) / (L / 2)) ** 8) ** .25
    roof_w = lambda x: half_w(x) - (.17 if cabin(x) else .06)

    def section(x):
        hw, zb = half_w(x), arch_bottom(x, (-WX, WX), .2, WR, TR)
        b, t, rw = belt(x), max(top(x), belt(x) + .02), roof_w(x)
        pts = [(0, .18), (hw - .12, .18), (hw - .02, .26)]
        # The side, up from the sill (raised over the wheel arches) to the shoulder.
        z_lo = max(.3, zb)
        for i in range(5):
            u = i / 4
            pts.append((hw - .01 * math.sin(u * math.pi), z_lo + (b - .02 - z_lo) * u))
        pts += [(hw - .015, b), (hw - .05, b + .015)]
        # The greenhouse (or the bonnet / boot lid, where top ≈ belt), then the roof's crown.
        pts += [(rw + (hw - .05 - rw) * .5, b + (t - b) * .45), (rw, t - .05), (rw * .7, t - .012), (0, t)]
        # Over the arches the sill and the first side point sit at the arch's height.
        if zb > .3:
            pts[1] = (hw - .12, zb); pts[2] = (hw - .02, zb + .02)
        return pts

    def material(x, i, n, y, z):
        if i <= 1:
            return 'chassis'
        if x <= x0 + 1e-3 or x >= x1 - 1e-3:
            return paint
        b = belt(x)
        if i >= 9 and cabin(x):
            t = top(x)
            on_slope = t < 1.37  # windscreen / rear window
            if on_slope and i >= 10:
                return 'glass'
            if i in (9, 10):
                pillar = (-.24 < x < -.12) or x < -1.0 or x > .72
                return paint if pillar or z < b + .03 else 'glass'
        return paint

    xs = [x0 + (x1 - x0) * i / 52 for i in range(53)]
    loft(k, xs, section, material, paint)
    # Wheels.
    for wx in (-WX, WX):
        for s in (-1, 1):
            wheel(k, wx, s * (W - .02), TR, TR, .2)
    # Bumpers (wrapping round the corners), grille, lamps, plates.
    for sx, zc in ((1, .42), (-1, .45)):
        xe = sx * (L / 2 + .01)
        k.box((xe - sx * .08, 0, zc), (.2, 2 * W - .08, .2), paint, .07, 3)
        k.box((xe - sx * .05, 0, zc - .12), (.14, 2 * W - .2, .06), 'trim', .02)
    k.box((L / 2 - .02, 0, .6), (.06, .78, .16), 'trim', .025)
    for i in range(5):
        k.box((L / 2 + .005, 0, .54 + i * .028), (.03, .74, .008), 'chrome')
    for s in (-1, 1):
        k.box((L / 2 - .08, s * .58, .66), (.12, .36, .1), 'headlamp', .03, M=Matrix.Rotation(s * .18, 4, 'Z'))
        k.box((L / 2 - .02, s * .66, .48), (.05, .16, .05), 'amber', .015)
        k.box((-L / 2 + .05, s * .62, .78), (.1, .34, .12), 'taillamp', .03, M=Matrix.Rotation(-s * .15, 4, 'Z'))
        k.box((-L / 2 + .03, s * .45, .78), (.06, .06, .1), 'headlamp', .01)  # reversing lamp
    for sx in (1, -1):
        k.box((sx * (L / 2 + .02), 0, .44 if sx > 0 else .62), (.02, .52, .12), 'plate', .01)
    # Mirrors, door handles, door seams, side skirts, wipers, exhaust, aerial.
    for s in (-1, 1):
        k.box((.72, s * (W + .045), .99), (.14, .1, .1), paint, .035)
        k.box((.72, s * (W + .02), .97), (.06, .06, .04), 'trim')
        for hx in (.28, -.6):
            k.box((hx, s * (W - .005), .84), (.16, .03, .03), 'chrome', .01)
        for sx in (.68, -.18, -1.0):
            k.box((sx, s * (half_w(sx) - .003), .58), (.012, .012, .62), 'trim')
        k.box((-.15, s * (W - .015), .29), (1.7, .04, .06), 'trim', .015)
    for wy in (-.2, .22):
        k.beam((.83, wy - .3, .99), (.83, wy + .3, .99), .015, .015, 'trim', side=Vector((1, 0, 0)))
    k.cyl((-L / 2 - .02, -.5, .26), .035, .1, 'chrome', 12, axis='X')
    # Underbody tray, so a low view under the car sees a floor, not the sky.
    k.span((-L / 2 + .25, -W + .12, .17), (L / 2 - .25, W - .12, .2), 'chassis')
    return k.finish(coll), (4.3, 1.8, 1.45)


def sedan_silver(coll):
    return _sedan('sedanSilver', 'paint_silver', coll)


def sedan_red(coll):
    return _sedan('sedanRed', 'paint_red', coll)


# ------------------------------------------------------------------------------------------- pickup
def pickup(coll):
    """5.2 × 1.95 × 1.9: a double-cab utility pickup with an open load bed, tow bar and roll bar."""
    paint = 'paint_green'
    k = Kit('pickup', mats(paint, 'glass', 'tonneau', 'trim', 'chrome', 'rubber', 'steel_rim', 'headlamp', 'taillamp', 'amber', 'plate', 'chassis'))
    L, W = 5.06, .88
    WX0, WX1, WR, TR = -1.55, 1.65, .5, .4
    x0, x1 = -L / 2, L / 2
    cab0, cab1 = -.55, 1.15  # cab from the bed's front wall to the windscreen base
    belt = keys([(x0, 1.08), (cab0, 1.1), (cab1, 1.08), (x1 - .4, 1.02), (x1, .92)])
    top = keys([(cab0 - .02, 1.1), (cab0, 1.84), (.85, 1.86), (cab1 + .05, 1.12), (x1 - .4, 1.04), (x1, .94)])
    half_w = lambda x: W * (1 - (abs(x - .4) / (L / 2 + .4)) ** 10) ** .25
    in_cab = lambda x: cab0 <= x <= cab1 + .05

    def section(x):
        hw = half_w(x)
        zb = arch_bottom(x, (WX0, WX1), .42, WR, TR)
        b = belt(x)
        t = max(top(x), b + .02) if x >= cab0 else b + .02
        rw = hw - (.12 if in_cab(x) else .04)
        z_lo = max(.5, zb)
        pts = [(0, .4), (hw - .1, .4), (hw - .02, .48)]
        for i in range(5):
            u = i / 4
            pts.append((hw, z_lo + (b - .02 - z_lo) * u))
        pts += [(hw - .01, b), (hw - .04, b + .01), (rw + (hw - .04 - rw) * .5, b + (t - b) * .45), (rw, t - .05), (rw * .7, t - .01), (0, t)]
        if zb > .5:
            pts[1] = (hw - .1, zb); pts[2] = (hw - .02, zb + .02)
        return pts

    def material(x, i, n, y, z):
        if i <= 1:
            return 'chassis'
        if x < cab0 - .05 and i >= 10:
            return 'tonneau'  # the load bed under a soft cover
        if i >= 9 and in_cab(x):
            t = top(x)
            if t < 1.8 and i >= 10 and x > cab0 + .05:
                return 'glass'
            if i in (9, 10) and z > belt(x) + .03 and not (-.0 < x < .14) and cab0 + .1 < x < cab1 - .05:
                return 'glass'
        return paint

    xs = [x0 + (x1 - x0) * i / 56 for i in range(57)]
    loft(k, xs, section, material, paint)
    # The bed (under its cover): bed rails with tie-down hooks, the tailgate latch; a roll bar behind the cab.
    for s in (-1, 1):
        k.span((x0 + .04, s * (W - .02), belt(-1.5) - .01), (cab0 - .02, s * (W - .12), belt(-1.5) + .035), paint, .01)
        for hx in (x0 + .4, -1.1, cab0 - .3):
            k.box((hx, s * (W - .07), belt(-1.5) + .05), (.05, .03, .03), 'chrome', .008)
    k.box((x0 + .03, 0, 1.03), (.06, 2 * W - .08, .12), 'chrome', .01)
    for s in (-1, 1):
        k.rod((cab0 - .15, s * .7, 1.1), (cab0 - .15, s * .7, 1.9), .035, 'chrome', 12)
    k.rod((cab0 - .15, -.7, 1.9), (cab0 - .15, .7, 1.9), .035, 'chrome', 12)
    # Wheels (steel), arch flares, bumpers, bull-bar, lamps, mirrors, step bars, tow bar, snorkel.
    for wx in (WX0, WX1):
        for s in (-1, 1):
            wheel(k, wx, s * (W - .03), TR, TR, .27, 'steel_rim', 6, TR * .6)
            flare(k, wx, s * (W + .015), TR, WR + .02, .09, 'trim')
    k.box((x1 - .05, 0, .62), (.16, 2 * W - .04, .24), 'trim', .05)
    for s in (-1, 1):
        k.rod((x1 + .02, s * .5, .62), (x1 + .02, s * .5, .9), .03, 'chrome', 10)
        k.box((x1 - .06, s * .62, .98), (.1, .3, .12), 'headlamp', .03)
        k.box((x0 + .03, s * .8, 1.1), (.06, .1, .26), 'taillamp', .02)
        k.box((cab1 - .3, s * (W + .05), 1.42), (.14, .1, .13), 'trim', .03)
        k.span((-.5, s * (W - .05), .44), (1.1, s * (W + .06), .48), 'chrome', .01)
        for hx in (.85, .05):
            k.box((hx, s * W, 1.22), (.16, .03, .035), 'trim', .01)
    k.rod((x1 + .02, -.5, .9), (x1 + .02, .5, .9), .03, 'chrome', 10)
    k.box((x1 + .015, 0, .62), (.02, .52, .12), 'plate', .01)
    k.box((x0 - .015, 0, .7), (.02, .52, .12), 'plate', .01)
    k.box((x0 - .02, 0, .5), (.1, 1.4, .1), 'trim', .02)
    k.span((x0 - .2, -.04, .44), (x0, .04, .5), 'chassis')
    k.span((-L / 2 + .3, -W + .15, .38), (L / 2 - .3, W - .15, .42), 'chassis')
    return _done(k, coll), (5.2, 1.95, 1.9)


# ------------------------------------------------------------------------------------------- city bus
def city_bus(coll):
    """9.4 × 2.55 × 3.1: a low-floor city bus (two doors on the kerb side, a glazed band, a rear engine bay, a roof
    air-conditioning pod). The destination board and route sign are added by the game (lit text)."""
    k = Kit('cityBus', mats('paint_white', 'paint_navy', 'glass', 'trim', 'chrome', 'rubber', 'rim', 'headlamp', 'taillamp',
                            'amber', 'board', 'chassis', 'alu'))
    L, W, H = 9.2, 1.17, 2.86
    x0, x1 = -L / 2, L / 2
    WX0, WX1, TR = -2.35, 2.75, .48
    # Body shell: a rounded box, lower skirt in the livery's navy.
    k.span((x0, -W, .36), (x1, W, H), 'paint_white', .16)
    k.span((x0 + .01, -W - .01, .36), (x1 - .01, W + .01, 1.05), 'paint_navy', .06)
    # Glazed band: the windows sit a little in, with dark rubber surrounds and black pillars.
    for s in (-1, 1):
        k.span((x0 + .5, s * (W + .005) - .01, 1.3), (x1 - .9, s * (W + .005) + .01, 2.42), 'glass')
        u = x0 + .5
        while u < x1 - .95:
            k.span((u - .05, s * W - .03, 1.28), (u + .05, s * W + .03, 2.44), 'trim')
            u += 1.32
        k.span((x0 + .45, s * W - .03, 2.42), (x1 - .85, s * W + .03, 2.5), 'trim')
        k.span((x0 + .45, s * W - .03, 1.22), (x1 - .85, s * W + .03, 1.3), 'trim')
    # Doors on the kerb side (−Y): glazed leaves in aluminium frames.
    for u in (x1 - 1.9, -.5):
        k.span((u, -W - .03, .38), (u + 1.25, -W + .02, 2.48), 'alu', .02)
        for v in (u + .06, u + .66):
            k.span((v, -W - .04, .5), (v + .53, -W - .01, 2.38), 'glass')
        k.span((u + .615, -W - .045, .4), (u + .635, -W - .01, 2.46), 'trim')
    # Front: windscreen with a deep rake at the top, destination board, lamps, bumper, wipers, mirrors on stalks.
    k.span((x1 + .001, -W + .12, 1.25), (x1 + .02, W - .12, 2.5), 'glass')
    k.span((x1 - .01, -W + .3, 2.58), (x1 + .025, W - .3, 2.86), 'board')
    for s in (-1, 1):
        k.box((x1 + .005, s * (W - .4), .82), (.05, .34, .2), 'headlamp', .04)
        k.box((x1 + .005, s * (W - .14), .82), (.05, .12, .2), 'amber', .03)
        k.rod((x1 - .1, s * W, 2.3), (x1 + .16, s * (W + .08), 2.22), .02, 'trim', 8)
        k.box((x1 + .18, s * (W + .08), 1.97), (.06, .1, .34), 'trim', .03)
        k.beam((x1 + .03, s * .55 - .45, 1.3), (x1 + .03, s * .55 + .2, 1.95), .02, .02, 'trim', side=Vector((1, 0, 0)))
    k.span((x1 - .1, -W + .05, .32), (x1 + .06, W - .05, .62), 'trim', .05)
    # Rear: engine grille louvres, tail lamps, rear window, bumper.
    k.span((x0 - .015, -W + .2, 1.6), (x0 + .01, W - .2, 2.45), 'glass')
    for i in range(7):
        k.span((x0 - .02, -W + .45, .72 + i * .1), (x0 + .01, W - .45, .76 + i * .1), 'trim')
    for s in (-1, 1):
        k.box((x0 - .005, s * (W - .25), 1.15), (.05, .18, .42), 'taillamp', .03)
    k.span((x0 - .06, -W + .05, .32), (x0 + .1, W - .05, .62), 'trim', .05)
    # Wheels (dual at the rear, so a wider tyre), arch liners, side indicators, roof pod.
    for wx, w in ((WX1, .28), (WX0, .36)):
        for s in (-1, 1):
            wheel(k, wx, s * (W - .02), TR, TR, w, 'rim', 8, TR * .58)
            k.span((wx - .62, s * W - .03, .32), (wx + .62, s * W + .03, 1.06), 'chassis')
    for s in (-1, 1):
        k.box((x1 - 1.0, s * (W + .01), .95), (.12, .02, .05), 'amber')
    k.span((x0 + .6, -W + .4, H), (x0 + 3.2, W - .4, H + .24), 'paint_white', .08)
    for i in range(4):
        k.span((x0 + .8 + i * .6, -W + .5, H + .24), (x0 + 1.2 + i * .6, W - .5, H + .25), 'alu')
    k.span((x0 + .3, -W + .1, .3), (x1 - .3, W - .1, .36), 'chassis')
    return _done(k, coll), (9.4, 2.55, 3.1)


# ------------------------------------------------------------------------------------------- box van
def box_van(coll):
    """6.4 × 2.3 × 2.9: a light box truck (cab with a raked windscreen, a box body with external posts, top and bottom
    rails, a rear portal with two doors on four hinges, locking bars, a step bumper). Livery text is added by the
    game."""
    cabpaint = 'paint_navy'
    k = Kit('boxVan', mats(cabpaint, 'box_white', 'alu', 'glass', 'trim', 'chrome', 'rubber', 'steel_rim', 'headlamp', 'taillamp',
                           'amber', 'plate', 'chassis'))
    L, W, H = 6.3, 1.03, 2.86
    x0, x1 = -L / 2, L / 2
    cab = x1 - 1.85
    TR = .38
    # Cab: lofted so the bonnet, windscreen and roof read as one shell.
    belt = keys([(cab, 1.25), (x1 - .5, 1.2), (x1, 1.0)])
    top = keys([(cab, 2.45), (cab + .9, 2.42), (x1 - .45, 1.3), (x1, 1.02)])

    def section(x):
        hw = W - .04 - .08 * ease((x - (x1 - .35)) / .35)
        b, t = belt(x), max(top(x), belt(x) + .02)
        z_lo = max(.55, arch(x))
        pts = [(0, .45), (hw - .1, .45), (hw - .02, .52)]
        for i in range(4):
            u = i / 3
            pts.append((hw, z_lo + (b - .02 - z_lo) * u))
        pts += [(hw - .01, b), (hw - .05, b + .02), (hw - .1, b + (t - b) * .5), (hw - .14, t - .05), (hw * .6, t - .01), (0, t)]
        return pts

    def arch(x):
        return arch_bottom(x, (x1 - 1.0,), .45, .5, TR)

    def material(x, i, n, y, z):
        if i <= 1:
            return 'chassis'
        if x >= x1 - 1e-3 or x <= cab + 1e-3:
            return cabpaint
        if i >= 8 and z > belt(x) + .05:
            if top(x) < 2.35 and i >= 10:
                return 'glass'
            if i in (8, 9) and cab + .25 < x < x1 - .55:
                return 'glass'
        return cabpaint

    xs = [cab + (x1 - cab) * i / 24 for i in range(25)]
    loft(k, xs, section, material, cabpaint)
    # Box body: panels, top and bottom rails, posts every ~0.52 m, corner posts, roof.
    bx1 = cab - .08
    k.span((x0, -W, .78), (bx1, W, H), 'box_white', .02)
    for s in (-1, 1):
        k.span((x0, s * W - .03, H - .1), (bx1, s * W + .03, H), 'alu', .01)
        k.span((x0, s * W - .035, .78), (bx1, s * W + .035, .93), 'alu', .01)
        u = x0 + .3
        while u < bx1 - .2:
            k.span((u - .025, s * W - .02, .93), (u + .025, s * W + .02, H - .1), 'box_white')
            u += .52
        k.span((x0 + .2, s * (W - .1) - .06, .12), (x0 + 1.9, s * (W - .1) + .02, .58), 'chassis')  # side guard
    # Rear portal: frame, two doors, hinges, locking bars with cam keepers, marker lamps, step bumper, plate.
    k.span((x0 - .03, -W, .78), (x0 + .02, -W + .12, H), 'alu')
    k.span((x0 - .03, W - .12, .78), (x0 + .02, W, H), 'alu')
    k.span((x0 - .03, -W, H - .16), (x0 + .02, W, H), 'alu')
    k.span((x0 - .02, -W + .12, .83), (x0 + .01, W - .12, H - .16), 'box_white')
    k.span((x0 - .03, -.008, .83), (x0 + .015, .008, H - .16), 'trim')
    for v in (-W + .45, -.25, .25, W - .45):
        k.span((x0 - .06, v - .02, .85), (x0 - .02, v + .02, H - .2), 'chrome')
        for z in (.95, H - .3):
            k.span((x0 - .07, v - .04, z), (x0 - .02, v + .04, z + .08), 'trim')
    for s in (-1, 1):
        for z in (1.1, (H + .8) / 2, H - .45):
            k.span((x0 - .05, s * (W - .12) - .03, z), (x0 - .01, s * (W - .12) + .05, z + .14), 'trim')
        k.box((x0 - .01, s * (W - .2), .66), (.04, .14, .2), 'taillamp', .02)
    for v in (-W + .2, 0, W - .2):
        k.box((x0 - .02, v, H - .09), (.03, .1, .05), 'amber', .01)
    k.span((x0 - .12, -W + .1, .38), (x0 + .1, W - .1, .5), 'trim', .02)
    k.box((x0 - .13, 0, .44), (.02, .52, .12), 'plate', .01)
    # Cab front: grille, lamps, bumper, mirrors on arms; wheels; chassis rails.
    k.span((x1 - .02, -.55, .62), (x1 + .02, .55, .92), 'trim', .02)
    for s in (-1, 1):
        k.box((x1 - .02, s * (W - .3), .82), (.06, .3, .16), 'headlamp', .03)
        k.rod((x1 - .6, s * W, 2.0), (x1 - .5, s * (W + .09), 2.0), .015, 'trim', 6)
        k.box((x1 - .5, s * (W + .1), 1.85), (.06, .08, .32), 'trim', .02)
        for wx in (x0 + 1.5, x1 - 1.0):
            wheel(k, wx, s * (W - .02), TR, TR, .24 if wx > 0 else .32, 'steel_rim', 6, TR * .6)
    k.span((x1 - .1, -W + .05, .42), (x1 + .05, W - .05, .62), 'trim', .04)
    k.box((x1 + .06, 0, .52), (.02, .52, .12), 'plate', .01)
    k.span((x0 + .2, -.55, .48), (x1 - .4, .55, .62), 'chassis')
    return _done(k, coll), (6.4, 2.3, 2.9)


def _done(k, coll):
    return k.finish(coll)


ASSETS = {
    'sedanSilver': ('Vehicles', sedan_silver),
    'sedanRed': ('Vehicles', sedan_red),
    'pickup': ('Vehicles', pickup),
    'cityBus': ('Vehicles', city_bus),
    'boxVan': ('Vehicles', box_van),
}
