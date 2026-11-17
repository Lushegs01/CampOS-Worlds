"""Weapon parts modelled in Blender and merged into the licensed weapon models (scripts/assets/add-weapon-part.mjs):
moving parts that the source models fused into the frame, so the reload animation has something real to move.

Each function returns (object, size (x, y, z)). Built upright in Blender (+Z up the magazine), origin at the centre
of the baseplate's underside; the merge script places and tilts it into the weapon's own frame.
"""
from campos import Kit, Surface, make_material

SURFACES = {
    'mag_steel': Surface('mag_steel', (.045, .046, .05), var=.08, var_scale=40, rough=.38, rough_var=.12, metal=.75,
                         wear=(.55, .55, .56), wear_amt=.9, wear_metal=1.0, wear_rough=.3, grime=(.06, .05, .045), grime_amt=.6,
                         bump=.08, bump_scale=300),
    'mag_base': Surface('mag_base', (.025, .025, .027), var=.06, rough=.62, grime_amt=.5, wear=(.15, .15, .15), wear_amt=.5,
                        wear_metal=0, wear_rough=.5, bump=.25, bump_scale=400),
    'follower': Surface('follower', (.03, .03, .032), rough=.55, grime_amt=.4, bump=.05),
    'brass': Surface('brass', (.72, .52, .2), rough=.28, metal=1.0, grime=(.2, .15, .08), grime_amt=.5, bump=.02),
}


def mats(*names):
    import bpy
    for n in names:
        if n not in bpy.data.materials:
            make_material(SURFACES[n])
    return list(names)


def sparrow_mag(coll):
    """A single-stack 9 mm pistol magazine (1.85 × 2.7 × 8.3 cm, sized to the grip it sits in): folded steel body with a spine, witness holes on
    both sides, feed lips with the top round showing, and a polymer baseplate with a finger lip at the front."""
    k = Kit('sparrowMag', mats('mag_steel', 'mag_base', 'follower', 'brass'))
    W, D, H = .0185, .027, .07  # body width (x), depth (y, front toward the muzzle at +y), height (fits the grip)
    k.box((0, 0, .008 + H / 2), (W, D, H), 'mag_steel', .0025, 2)
    k.box((0, -D / 2 - .0008, .008 + H / 2), (W * .45, .002, H * .96), 'mag_steel', .0006)  # rear spine
    # Witness holes (round, numbered by position): small dark pits on each side.
    for s in (-1, 1):
        for i in range(5):
            z = .02 + i * .011
            k.cyl((s * (W / 2 + .0001), -.006, z), .0018, .0012, 'follower', 10, axis='X')
    # Feed lips folded in at the top, and the top round between them.
    for s in (-1, 1):
        k.box((s * (W / 2 - .002), -.002, .008 + H + .002), (.004, D * .7, .005), 'mag_steel', .0012)
    k.cyl((0, D / 2 - .0205, .008 + H + .002), .0047, .0185, 'brass', 14, axis='Y')
    k.cyl((0, D / 2 - .002, .008 + H + .002), .0045, .0035, 'follower', 12, axis='Y', r2=.0028)  # bullet nose (dark)
    # Polymer baseplate, wider than the body, with a finger lip at the front and the release hole.
    k.box((0, 0, .004), (W + .004, D + .006, .008), 'mag_base', .002, 2)
    k.box((0, D / 2 + .004, .0065), (W + .002, .006, .005), 'mag_base', .0015)
    k.cyl((0, -.005, -.0001), .0025, .0012, 'follower', 10)
    return k.finish(coll), (.023, .033, .083)


ASSETS = {
    'sparrowMag': ('Weapons', sparrow_mag),
}
