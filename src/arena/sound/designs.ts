// The arena's sound design: every weapon, impact, footstep detail, explosion and mechanical sound is designed here as
// physically motivated layers and rendered offline (src/arena/sound/dsp.ts). It is original work: no recordings are
// used except the campus' CC0 footstep recordings (public/assets/audio, docs/ASSETS.md).
//
// A gunshot is three buffers, played in combinations chosen by distance (src/arena/sound/engine.ts):
//   near  the shooter's position: mechanical action, muzzle report (a noise burst whose brightness falls from crack
//         to boom), the low-frequency body, the supersonic crack of rifle rounds, and a ground reflection;
//   tail  stereo: outdoor reflections off nearby buildings, the decay that tells you how open the space is;
//   far   what survives distance: the report's low end and a rolling rumble, without the crack and click.
// Each has several variants (different noise, slightly different timing) played round-robin, so automatic fire
// never repeats the identical waveform.
import { Biquad, ad, noiseBurst, sweepLowpass, thump, modes, mixInto, finish, trim, rng } from './dsp';

export interface Rendered { channels: Float32Array[] }

/** One weapon's acoustic signature. Frequencies in Hz, times in seconds, levels 0–1. */
export interface GunProfile {
  /** Muzzle report: resonance and how fast it dies; `bright` is its initial bandwidth. */
  report: { f: number; q: number; decay: number; bright: number };
  /** Low body: a falling thump (f0 → f1). */
  body: { f0: number; f1: number; decay: number; gain: number };
  /** Supersonic crack (0 for subsonic rounds such as .45 ACP and buckshot). */
  crack: number;
  /** The action: modal frequencies of the bolt/slide/hammer and its decay. */
  mech: { f: number[]; decay: number; gain: number };
  /** Outdoor tail length and level; distant layer level. */
  tail: { decay: number; gain: number }; far: number;
  /** Relative loudness when played (an SMG is quieter than a .338 rifle). */
  loud: number;
  /** Mechanical family for reloads, dry fire and handling. */
  family: 'rifle' | 'smg' | 'pistol' | 'revolver' | 'shotgun' | 'pump' | 'bolt' | 'lmg' | 'blade';
}
export const GUNS: Record<string, GunProfile> = {
  // 5.56 assault rifle: sharp crack, mid report, firm body.
  vanguard: { report: { f: 1500, q: .9, decay: .045, bright: 11000 }, body: { f0: 145, f1: 52, decay: .085, gain: .55 }, crack: .7, mech: { f: [2400, 3900, 6100], decay: .028, gain: .32 }, tail: { decay: .55, gain: .3 }, far: 1, loud: 1, family: 'rifle' },
  // Heavier battle-rifle round in bursts: deeper report, more crack.
  halcyon: { report: { f: 1250, q: .85, decay: .055, bright: 10000 }, body: { f0: 125, f1: 46, decay: .1, gain: .65 }, crack: .8, mech: { f: [2100, 3500, 5600], decay: .032, gain: .3 }, tail: { decay: .6, gain: .32 }, far: 1.05, loud: 1.08, family: 'rifle' },
  // 9 mm SMG: tight, bright, light body, quick mechanism.
  wasp: { report: { f: 2300, q: 1.1, decay: .028, bright: 9000 }, body: { f0: 175, f1: 72, decay: .05, gain: .35 }, crack: .22, mech: { f: [3000, 4700, 7200], decay: .02, gain: .42 }, tail: { decay: .4, gain: .24 }, far: .7, loud: .78, family: 'smg' },
  // .45 SMG: subsonic (no crack), thicker thud.
  kestrel: { report: { f: 1650, q: .95, decay: .04, bright: 7400 }, body: { f0: 135, f1: 55, decay: .07, gain: .5 }, crack: 0, mech: { f: [2600, 4100, 6500], decay: .024, gain: .4 }, tail: { decay: .45, gain: .26 }, far: .75, loud: .86, family: 'smg' },
  // 12-gauge pump: broad low boom, no crack, long body.
  bastion: { report: { f: 780, q: .7, decay: .09, bright: 6800 }, body: { f0: 98, f1: 38, decay: .18, gain: 1 }, crack: 0, mech: { f: [1900, 3100], decay: .03, gain: .22 }, tail: { decay: .8, gain: .36 }, far: 1.2, loud: 1.22, family: 'pump' },
  // Semi-automatic 12-gauge: a touch brighter and shorter.
  rampart: { report: { f: 900, q: .75, decay: .078, bright: 7400 }, body: { f0: 108, f1: 40, decay: .15, gain: .9 }, crack: 0, mech: { f: [1900, 3200, 5000], decay: .03, gain: .3 }, tail: { decay: .72, gain: .34 }, far: 1.12, loud: 1.14, family: 'shotgun' },
  // .338 bolt-action: the loudest, biggest crack, longest tail.
  longbow: { report: { f: 900, q: .8, decay: .1, bright: 13000 }, body: { f0: 88, f1: 32, decay: .22, gain: 1.05 }, crack: 1, mech: { f: [1700, 2900], decay: .045, gain: .18 }, tail: { decay: 1.1, gain: .42 }, far: 1.45, loud: 1.32, family: 'bolt' },
  // 7.62 DMR: hard crack, solid body.
  talon: { report: { f: 1100, q: .85, decay: .075, bright: 12000 }, body: { f0: 102, f1: 40, decay: .15, gain: .85 }, crack: .9, mech: { f: [2000, 3300, 5200], decay: .03, gain: .26 }, tail: { decay: .85, gain: .38 }, far: 1.25, loud: 1.18, family: 'rifle' },
  // 7.62 belt-fed: like the DMR with a heavier, rattling action.
  anvil: { report: { f: 1200, q: .85, decay: .06, bright: 10500 }, body: { f0: 112, f1: 42, decay: .13, gain: .8 }, crack: .85, mech: { f: [1800, 3000, 4600], decay: .04, gain: .38 }, tail: { decay: .7, gain: .34 }, far: 1.2, loud: 1.12, family: 'lmg' },
  // 9 mm pistol: snappy and light.
  sparrow: { report: { f: 2600, q: 1.2, decay: .03, bright: 9500 }, body: { f0: 190, f1: 82, decay: .045, gain: .3 }, crack: .2, mech: { f: [3400, 5200, 7600], decay: .018, gain: .45 }, tail: { decay: .38, gain: .24 }, far: .65, loud: .74, family: 'pistol' },
  // .44 Magnum revolver: a big, round bark.
  thorn: { report: { f: 1300, q: .9, decay: .07, bright: 11000 }, body: { f0: 112, f1: 42, decay: .14, gain: .85 }, crack: .5, mech: { f: [2200, 3600], decay: .03, gain: .3 }, tail: { decay: .75, gain: .36 }, far: 1.1, loud: 1.14, family: 'revolver' },
};
/** Older sound class names (shared/arena/weapons.mjs `sound`) to a representative weapon. */
export const BY_CLASS: Record<string, string> = { rifle: 'vanguard', burst: 'halcyon', smg: 'wasp', shotgun: 'bastion', sniper: 'longbow', dmr: 'talon', lmg: 'anvil', pistol: 'sparrow', magnum: 'thorn' };
export const profileOf = (id: string) => GUNS[id] ?? GUNS[BY_CLASS[id] ?? 'vanguard'];
const seedOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ---------------------------------------------------------------- gunshots
function gunNear(sr: number, g: GunProfile, seed: number): Float32Array {
  const r = rng(seed), j = (x: number, amount = .06) => x * (1 + r() * amount);
  const len = Math.max(.32, g.report.decay * 5 + g.body.decay * 2 + .06), out = new Float32Array(Math.round(sr * len));
  const mechAt = 0, reportAt = .0012 + Math.abs(r()) * .0008;
  // 1. The action: the hammer/bolt's metallic transient a moment before the report.
  mixInto(out, modes(sr, g.mech.decay * 5, g.mech.f.map(f => j(f, .04)), [1, .7, .5], [g.mech.decay, g.mech.decay * .7, g.mech.decay * .5], seed + 1), sr, mechAt, g.mech.gain * .55);
  // 2. The report: a burst whose bandwidth falls from crack to boom, with the weapon's own resonance. It carries most
  //    of the energy, in the band where a real report does (a few hundred hertz to several kilohertz).
  const report = noiseBurst(sr, g.report.decay * 6, seed + 2, t => ad(t, .00035, j(g.report.decay)) * (1 + .5 * ad(t, .0001, .005)));
  sweepLowpass(report, sr, j(g.report.bright, .08), j(g.report.f * 2.2, .08), g.report.decay * 1.4);
  new Biquad(sr, 'peak', j(g.report.f, .05), g.report.q, 9).process(report);
  new Biquad(sr, 'peak', j(g.report.f * 2.1, .05), 1.4, 4).process(report);
  new Biquad(sr, 'hp', 160, .7).process(report);
  mixInto(out, report, sr, reportAt, 3.2);
  // 3. The body: the pressure wave's thump, kept short so it is felt as punch rather than heard as a boom.
  mixInto(out, thump(sr, g.body.decay * 4, j(g.body.f0, .05), g.body.f1, g.body.decay * .35, j(g.body.decay * .7, .08), 1.8), sr, reportAt, g.body.gain * .3);
  // 4. Supersonic crack: an N-wave and a short high sizzle.
  if (g.crack) {
    const n = Math.round(sr * .0006), at = Math.round(sr * reportAt);
    for (let i = 0; i < n; i++) out[at + i] += g.crack * .9 * (i < n / 2 ? 1 - i / (n / 2) * .3 : -(1 - (i - n / 2) / (n / 2)) * .9);
    const sizzle = noiseBurst(sr, .03, seed + 3, t => ad(t, .0002, .0045), [new Biquad(sr, 'hp', 5500, .7), new Biquad(sr, 'peak', 8500, 1.2, 4)]);
    mixInto(out, sizzle, sr, reportAt, g.crack * 1.1);
  }
  // 5. Ground reflection: the report again, a few milliseconds later, darker.
  const reflect = report.slice(0, Math.round(sr * g.report.decay * 4)); new Biquad(sr, 'lp', 3200, .7).process(reflect);
  mixInto(out, reflect, sr, reportAt + j(.0095, .25), .9);
  return trim(finish(out, sr), sr);
}
function gunTail(sr: number, g: GunProfile, seed: number): Float32Array[] {
  // Outdoor: discrete slaps off buildings and containers, then a diffuse decay; left and right differ.
  return [0, 1].map(ch => {
    const r = rng(seed + ch * 101), len = g.tail.decay * 2.2 + .25, out = new Float32Array(Math.round(sr * len));
    const diffuse = noiseBurst(sr, len, seed + 7 + ch, t => ad(t, .03, g.tail.decay * .55) * .55, [new Biquad(sr, 'lp', 2400, .6), new Biquad(sr, 'hp', 120, .6)]);
    mixInto(out, diffuse, sr, .012, 1);
    for (let k = 0; k < 5; k++) {
      const at = .045 + k * .055 + Math.abs(r()) * .05, slap = noiseBurst(sr, .09, seed + 20 + k * 3 + ch, t => ad(t, .0008, .018 + k * .006), [new Biquad(sr, 'lp', 3600 - k * 450, .7), new Biquad(sr, 'peak', g.report.f * .8, 1, 4)]);
      mixInto(out, slap, sr, at, .75 * Math.pow(.7, k));
    }
    return trim(finish(out, sr, .8), sr);
  });
}
function gunFar(sr: number, g: GunProfile, seed: number): Float32Array {
  // Distance strips the crack and the click: a dull report, a low thump and a rolling rumble.
  const len = 1.8, out = new Float32Array(Math.round(sr * len));
  // The distant "pop": the report's mid-band survives (air takes the highs), centred lower for bigger calibres.
  const pop = Math.max(320, g.report.f * .42);
  const report = noiseBurst(sr, .5, seed, t => ad(t, .003, g.report.decay * 2.2), [new Biquad(sr, 'lp', 1500, .8), new Biquad(sr, 'peak', pop, 1, 10), new Biquad(sr, 'hp', 140, .7)]);
  mixInto(out, report, sr, 0, 4.5);
  mixInto(out, thump(sr, .6, 80, 36, .1, g.body.decay * 1.6, 1.4), sr, .004, .25 * g.body.gain);
  const r = rng(seed + 9), rate = 3 + Math.abs(r()) * 3;
  const rumble = noiseBurst(sr, len, seed + 5, t => ad(t, .06, .5) * (.6 + .4 * Math.sin(t * rate * 6.283)), [new Biquad(sr, 'lp', 600, .7), new Biquad(sr, 'hp', 90, .7)]);
  mixInto(out, rumble, sr, .05, 1.6);
  return trim(finish(out, sr), sr);
}

// ---------------------------------------------------------------- weapon handling (per mechanical family)
type Mech = 'magout' | 'magin' | 'charge' | 'pump' | 'boltaction' | 'dry' | 'draw' | 'ads' | 'shell' | 'cylinder';
const FAMILY_PITCH: Record<GunProfile['family'], number> = { rifle: 1, smg: 1.15, pistol: 1.35, revolver: 1.1, shotgun: .9, pump: .88, bolt: .95, lmg: .82, blade: 1.4 };
function mech(sr: number, family: GunProfile['family'], what: Mech, seed: number): Float32Array {
  const p = FAMILY_PITCH[family], out = new Float32Array(Math.round(sr * .5));
  const click = (at: number, f: number[], decay: number, gain: number, s: number) => mixInto(out, modes(sr, decay * 6, f.map(x => x * p), [1, .6, .4], [decay, decay * .7, decay * .5], s), sr, at, gain);
  const scrape = (at: number, len: number, f: number, gain: number, s: number) => mixInto(out, noiseBurst(sr, len, s, t => Math.sin(Math.PI * Math.min(1, t / len)) ** 2, [new Biquad(sr, 'bp', f * p, 1.4)]), sr, at, gain);
  const thud = (at: number, f: number, gain: number, s: number) => mixInto(out, noiseBurst(sr, .08, s, t => ad(t, .0006, .012), [new Biquad(sr, 'lp', f, .8)]), sr, at, gain);
  switch (what) {
    case 'magout': click(0, [2900, 4400, 6800], .012, .5, seed); scrape(.012, .09, 1600, .35, seed + 1); thud(.11, 900, .25, seed + 2); break;
    case 'magin': scrape(0, .07, 1800, .3, seed); click(.07, [2300, 3700, 5900], .02, .9, seed + 1); thud(.072, 1400, .55, seed + 2); click(.1, [3100, 5200], .01, .35, seed + 3); break;
    case 'charge': click(0, [2500, 4200], .015, .5, seed); scrape(.015, .07, 2200, .35, seed + 1); click(.1, [1900, 3300, 5100], .03, 1, seed + 2); thud(.1, 1200, .5, seed + 3); break;
    case 'pump': scrape(0, .09, 1200, .5, seed); click(.09, [1600, 2700], .025, .9, seed + 1); thud(.09, 700, .6, seed + 2); scrape(.15, .08, 1300, .45, seed + 3); click(.23, [1800, 3000], .02, .8, seed + 4); break;
    case 'boltaction': click(0, [2100, 3500], .02, .7, seed); scrape(.03, .1, 1700, .4, seed + 1); click(.14, [1500, 2600, 4100], .025, .7, seed + 2); scrape(.2, .1, 1900, .35, seed + 3); click(.31, [2300, 3800], .03, 1, seed + 4); break;
    case 'dry': click(0, [3600, 5400], .006, .9, seed); thud(0, 2500, .2, seed + 1); break;
    case 'draw': scrape(0, .14, 900, .35, seed); click(.13, [2600, 4000], .015, .55, seed + 1); break;
    case 'ads': scrape(0, .12, 600, .3, seed); scrape(.02, .1, 2200, .08, seed + 1); break;
    case 'shell': scrape(0, .05, 1500, .3, seed); click(.05, [1700, 2900], .02, .8, seed + 1); thud(.05, 800, .4, seed + 2); break;
    case 'cylinder': click(0, [2800, 4500], .012, .7, seed); scrape(.02, .1, 2000, .3, seed + 1); click(.14, [2400, 3900], .02, .8, seed + 2); break;
  }
  return trim(finish(out, sr, .7), sr);
}

// ---------------------------------------------------------------- impacts, flybys, bodies, gear
export type Surface = 'concrete' | 'metal' | 'wood' | 'sand' | 'brick' | 'dirt' | 'foliage' | 'flesh';
function impact(sr: number, s: Surface, seed: number): Float32Array {
  const r = rng(seed), out = new Float32Array(Math.round(sr * .45)), j = (x: number) => x * (1 + r() * .12);
  const burst = (len: number, decay: number, f: [number, number], gain: number, at = 0, k = 0) => mixInto(out, noiseBurst(sr, len, seed + k, t => ad(t, .0003, decay), [new Biquad(sr, 'hp', f[0], .7), new Biquad(sr, 'lp', f[1], .7)]), sr, at, gain);
  switch (s) {
    case 'concrete': case 'brick':
      burst(.06, .006, [600, s === 'brick' ? 6000 : 9000], 1, 0, 1);
      for (let k = 0; k < 6; k++) burst(.03, .004, [1500, 7000], .18 * Math.abs(r()), .02 + Math.abs(r()) * .14, 10 + k); // debris
      break;
    case 'metal':
      mixInto(out, modes(sr, .4, [j(1900), j(3150), j(4800), j(6900)], [1, .7, .5, .35], [.09, .06, .04, .03], seed), sr, 0, .55);
      burst(.02, .002, [2500, 12000], .6, 0, 2);
      if (Math.abs(r()) > .55) { // ricochet whine
        const n = Math.round(sr * .28), at = Math.round(sr * .01); let ph = 0;
        for (let i = 0; i < n && at + i < out.length; i++) { const t = i / sr, f = 3800 - 2400 * (t / .28); ph += 2 * Math.PI * f / sr; out[at + i] += .22 * Math.sin(ph) * ad(t, .01, .09); }
      }
      break;
    case 'wood': burst(.08, .012, [250, 3200], 1, 0, 3); mixInto(out, modes(sr, .1, [j(420), j(980)], [1, .5], [.025, .015], seed), sr, 0, .5); for (let k = 0; k < 3; k++) burst(.02, .003, [2000, 8000], .15, .01 + k * .02, 20 + k); break;
    case 'sand': case 'dirt': burst(.12, .03, [120, s === 'sand' ? 1800 : 2600], 1, 0, 4); burst(.15, .05, [2500, 7000], .12, .01, 5); break;
    case 'foliage': burst(.25, .07, [1200, 7000], .8, 0, 6); burst(.06, .01, [200, 1200], .5, 0, 7); break;
    case 'flesh': burst(.1, .022, [180, 2200], 2.2, 0, 8); mixInto(out, thump(sr, .12, 150, 70, .02, .025, 1.2), sr, 0, .35); break;
  }
  return trim(finish(out, sr, .8), sr);
}
function flyby(sr: number, kind: 'snap' | 'whiz', seed: number): Float32Array[] {
  // Rendered in stereo (left to right); the engine flips the pair for a round passing the other way.
  return [0, 1].map(ch => {
    if (kind === 'snap') { const out = noiseBurst(sr, .05, seed + ch, t => ad(t - ch * .0015, .0002, .004), [new Biquad(sr, 'hp', 2200, .7)]); return finish(out, sr, .85); }
    const len = .32, out = new Float32Array(Math.round(sr * len)), r = rng(seed + ch);
    const band = new Biquad(sr, 'bp', 1600, 3);
    for (let i = 0; i < out.length; i++) { const t = i / sr; if ((i & 31) === 0) band.set('bp', 1700 - 1000 * t / len, 3); const pan = ch ? t / len : 1 - t / len; out[i] = band.run(r()) * Math.sin(Math.PI * t / len) ** 3 * (.4 + .6 * pan); }
    return finish(out, sr, .7);
  });
}
function explosion(sr: number, far: boolean, seed: number): Float32Array {
  const len = far ? 2.6 : 2.4, out = new Float32Array(Math.round(sr * len));
  if (!far) {
    const crack = noiseBurst(sr, .35, seed, t => ad(t, .0005, .045), [new Biquad(sr, 'lp', 7000, .7), new Biquad(sr, 'peak', 700, .8, 6), new Biquad(sr, 'hp', 120, .7)]);
    mixInto(out, crack, sr, 0, 5.5);
  }
  mixInto(out, thump(sr, 1.4, far ? 60 : 85, 26, .16, far ? .4 : .3, 2.2), sr, far ? .01 : 0, .5);
  const rate = 4 + Math.abs(rng(seed)()) * 4;
  mixInto(out, noiseBurst(sr, len, seed + 1, t => ad(t, .02, far ? .7 : .5) * (.55 + .45 * Math.sin(t * rate * 6.283)), [new Biquad(sr, 'lp', far ? 900 : 2200, .7), new Biquad(sr, 'hp', 70, .7)]), sr, .01, far ? 3.2 : 2.8);
  if (!far) for (let k = 0; k < 10; k++) mixInto(out, noiseBurst(sr, .04, seed + 10 + k, t => ad(t, .0004, .006), [new Biquad(sr, 'hp', 1500, .7), new Biquad(sr, 'lp', 6000, .7)]), sr, .25 + k * .09 + rng(seed + k)() * .04, .35); // debris
  return trim(finish(out, sr), sr);
}
const simple: Record<string, (sr: number, seed: number) => Float32Array> = {
  // Equipment rattle when running: tiny metal parts against each other.
  gear: (sr, seed) => trim(finish(mixInto(mixInto(new Float32Array(Math.round(sr * .2)), modes(sr, .12, [3200, 4700, 6100], [1, .6, .4], [.012, .01, .008], seed), sr, 0, .5), noiseBurst(sr, .1, seed + 1, t => ad(t, .002, .02), [new Biquad(sr, 'bp', 2400, 1)]), sr, .02, .5), sr, .6), sr),
  // A boot on steel: the plate rings.
  metalstep: (sr, seed) => trim(finish(mixInto(modes(sr, .3, [620, 1350, 2240, 3480].map((f, i) => f * (1 + rng(seed + i)() * .05)), [1, .7, .45, .3], [.06, .045, .03, .02], seed), noiseBurst(sr, .05, seed + 1, t => ad(t, .0005, .008), [new Biquad(sr, 'lp', 2000, .7)]), sr, 0, .8), sr, .7), sr),
  // Sliding on the ground: a scrape.
  slide: (sr, seed) => trim(finish(noiseBurst(sr, .6, seed, t => Math.min(1, t / .04) * Math.exp(-t / .35), [new Biquad(sr, 'bp', 900, .9), new Biquad(sr, 'lowshelf', 300, .7, 4)]), sr, .6), sr),
  whoosh: (sr, seed) => { const len = .3, out = new Float32Array(Math.round(sr * len)), r = rng(seed), f = new Biquad(sr, 'bp', 600, 1.2); for (let i = 0; i < out.length; i++) { const t = i / sr; if ((i & 31) === 0) f.set('bp', 500 + 1800 * Math.sin(Math.PI * t / len), 1.2); out[i] = f.run(r()) * Math.sin(Math.PI * t / len) ** 2; } return finish(out, sr, .6); },
  // Taking a hit: a dull body thud.
  body: (sr, seed) => trim(finish(mixInto(thump(sr, .2, 120, 55, .03, .04, 1.5), noiseBurst(sr, .1, seed, t => ad(t, .001, .022), [new Biquad(sr, 'lp', 1400, .7), new Biquad(sr, 'hp', 140, .7)]), sr, 0, 2), sr, .8), sr),
  jump: (sr, seed) => trim(finish(noiseBurst(sr, .15, seed, t => ad(t, .01, .04), [new Biquad(sr, 'bp', 700, 1)]), sr, .5), sr),
  land: (sr, seed) => trim(finish(mixInto(thump(sr, .25, 130, 55, .03, .045, 1.6), noiseBurst(sr, .14, seed, t => ad(t, .001, .03), [new Biquad(sr, 'lp', 2400, .7), new Biquad(sr, 'hp', 150, .7)]), sr, 0, 5), sr, .85), sr),
  casing: (sr, seed) => trim(finish(mixInto(mixInto(new Float32Array(Math.round(sr * .35)), modes(sr, .15, [5200, 7900, 10400].map(f => f * (1 + rng(seed)() * .08)), [1, .6, .4], [.03, .02, .015], seed), sr, 0, 1), modes(sr, .12, [5600, 8400], [.8, .5], [.02, .012], seed + 1), sr, .07 + Math.abs(rng(seed + 2)()) * .05, .5), sr, .5), sr),
  hiss: (sr, seed) => trim(finish(noiseBurst(sr, 1.6, seed, t => Math.min(1, t * 6) * Math.exp(-t * 1.4), [new Biquad(sr, 'hp', 2000, .6), new Biquad(sr, 'lp', 9000, .7)]), sr, .6), sr),
  pin: (sr, seed) => trim(finish(mixInto(modes(sr, .1, [3800, 6200], [1, .5], [.015, .01], seed), noiseBurst(sr, .05, seed + 1, t => ad(t, .002, .01), [new Biquad(sr, 'bp', 3000, 1)]), sr, .03, .4), sr, .55), sr),
  flashbang: (sr, seed) => trim(finish(mixInto(noiseBurst(sr, .5, seed, t => ad(t, .0003, .03), [new Biquad(sr, 'hp', 300, .7)]), thump(sr, .4, 120, 40, .04, .09, 2), sr, 0, .7), sr), sr),
};

/** Render a named sound (see the switch for the names). Returns null for an unknown name. */
export function render(name: string, sr: number): Rendered | null {
  const [kind, a = '', b = '', c = '0'] = name.split(':'), seed = seedOf(name);
  if (kind === 'gun') { const g = profileOf(a); return b === 'tail' ? { channels: gunTail(sr, g, seed) } : { channels: [b === 'far' ? gunFar(sr, g, seed) : gunNear(sr, g, seed)] }; }
  if (kind === 'mech') return { channels: [mech(sr, (a as GunProfile['family']) || 'rifle', b as Mech, seed)] };
  if (kind === 'impact') return { channels: [impact(sr, a as Surface, seed)] };
  if (kind === 'flyby') return { channels: flyby(sr, a as 'snap' | 'whiz', seed) };
  if (kind === 'boom') return { channels: [explosion(sr, a === 'far', seed)] };
  if (simple[kind]) return { channels: [simple[kind](sr, seed)] };
  void c; return null;
}
