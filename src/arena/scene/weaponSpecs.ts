// Per-weapon first-person calibration: where each hand holds the weapon, where its sights, magazine well, ejection port
// and charging point are. Measured from the normalised models on the 5 cm sheets that
// `node scripts/qa/arena-weapons.mjs sheet <ids>` renders (y up from the bore, z back from the muzzle, metres).
// Pure data, so the anchor validator (tests/arena-weapon-anchors.test.mjs) can check it against the catalogue and the
// models without a browser.

/** Hand placement style: how each hand wraps what it holds. */
export type Hold = 'rifle' | 'pistol' | 'blade';
export interface Spec {
  grip: [number, number]; fore: [number, number]; sight: [number, number]; mag: [number, number];
  eject: [number, number, number] | null; eye: number; hold: Hold;
  /** Red-dot optics: z of the emitter window, where the reticle is drawn. */
  dot?: number;
  /** Where the support hand works the action on an empty reload [x, y, z]: bolt catch, charging handle, cocking lever. */
  charge?: [number, number, number];
}
// Measured from the normalised models (y up from the bore, z back from the muzzle, metres).
export const SPECS: Record<string, Spec> = {
  m7: { grip: [-.09, .69], fore: [-.035, .4], sight: [.104, .6], mag: [-.13, .58], eject: [.035, .0, .61], eye: .22, hold: 'rifle', dot: .51 , charge: [-.022, -.02, .52] },
  vanguard: { grip: [-.09, .58], fore: [-.035, .3], sight: [.0685, .41], mag: [-.12, .38], eject: [.025, 0, .5], eye: .26, hold: 'rifle', dot: .35 , charge: [-.022, -.012, .43] },
  halcyon: { grip: [-.09, .66], fore: [-.03, .38], sight: [.053, .4], mag: [-.12, .48], eject: [.025, .01, .55], eye: .17, hold: 'rifle' , charge: [.035, .025, .5] },
  wasp: { grip: [-.1, .39], fore: [-.03, .14], sight: [.071, .285], mag: [-.12, .17], eject: [.025, .02, .3], eye: .26, hold: 'rifle', dot: .25 , charge: [-.03, .035, .1] },
  kestrel: { grip: [-.075, .55], fore: [-.03, .3], sight: [.122, .47], mag: [-.13, .42], eject: [.03, .04, .45], eye: .26, hold: 'rifle', dot: .405 , charge: [-.03, .03, .44] },
  bastion: { grip: [-.08, .68], fore: [-.035, .32], sight: [.034, .55], mag: [-.04, .5], eject: [.025, 0, .55], eye: .3, hold: 'rifle' },
  rampart: { grip: [-.08, .7], fore: [-.04, .34], sight: [.045, .58], mag: [-.04, .52], eject: [.03, 0, .55], eye: .17, hold: 'rifle' , charge: [.03, .0, .5] },
  longbow: { grip: [-.1, .78], fore: [-.035, .45], sight: [.1, .86], mag: [-.1, .66], eject: [.03, .02, .7], eye: .1, hold: 'rifle' , charge: [.035, .03, .74] },
  talon: { grip: [-.1, .76], fore: [-.035, .42], sight: [.11, .8], mag: [-.1, .58], eject: [.03, .02, .68], eye: .1, hold: 'rifle' , charge: [.035, .03, .62] },
  anvil: { grip: [-.08, .7], fore: [-.05, .36], sight: [.058, .71], mag: [-.12, .55], eject: [.03, 0, .62], eye: .16, hold: 'rifle' , charge: [.035, .035, .56] },
  sparrow: { grip: [-.072, .165], fore: [-.088, .155], sight: [.008, .19], mag: [-.1, .16], eject: [.012, 0, .12], eye: .55, hold: 'pistol' },
  thorn: { grip: [-.088, .2], fore: [-.1, .19], sight: [.012, .18], mag: [-.03, .1], eject: null, eye: .55, hold: 'pistol' },
  knife: { grip: [.03, .26], fore: [-.3, .3], sight: [0, .2], mag: [-.3, .3], eject: null, eye: .3, hold: 'blade' },
  hammer: { grip: [.085, .33], fore: [-.3, .4], sight: [0, .25], mag: [-.3, .4], eject: null, eye: .3, hold: 'blade' },
};

/** What a weapon of each kind must carry (anchors the animator and IK read). */
export function requiredAnchors(w: { category: string; fire: string; reloadMode?: string }): (keyof Spec)[] {
  if (w.fire === 'melee') return ['grip', 'hold'];
  return ['grip', 'fore', 'sight', 'mag', 'eye', 'hold'];
}
/** Problems with one weapon's calibration (empty when it is complete and consistent with its kind). */
export function anchorProblems(w: { id: string; category: string; fire: string }): string[] {
  const s = SPECS[w.id]; if (!s) return [`${w.id}: no calibration`];
  const out: string[] = [];
  for (const k of requiredAnchors(w)) if (s[k] == null) out.push(`${w.id}: missing ${k}`);
  const want: Hold = w.fire === 'melee' ? 'blade' : w.category === 'pistol' ? 'pistol' : 'rifle';
  if (s.hold !== want) out.push(`${w.id}: hold ${s.hold}, expected ${want}`);
  if (w.fire !== 'melee') {
    // The support hand is ahead of the firing hand on a long gun, and on (or just ahead of) it on a pistol.
    if (s.fore[1] > s.grip[1] + .01) out.push(`${w.id}: support hand behind the firing hand`);
    if (w.category !== 'pistol' && s.grip[1] - s.fore[1] < .15) out.push(`${w.id}: hands closer than 15 cm on a long gun`);
    if (s.sight[0] <= 0 && w.category !== 'pistol') out.push(`${w.id}: sight not above the bore`);
  }
  return out;
}
