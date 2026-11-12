// The Combat Arena's sound design: which recording, which part of it, and what processing makes each sound.
// Rendered by scripts/assets/build-arena-audio.mjs into sound banks (public/assets/arena/audio/<bank>.mp3) that
// the game loads only when needed (src/arena/sound/engine.ts).
//
// Everything is cut from real recordings (scripts/assets/arena-audio/sources.mjs). "Designed" sounds are layers of
// recordings (a weapon-specific magazine made from real magazine, metal and cloth recordings, a rifle-sized
// magazine pitched from a real pistol magazine) — never synthesized tones.
//
// A variant is a region of a recording:
//   { src, at, dur }      seconds into the recording (`at` is refined to the attack unless onset: false)
//   pre / fi / fo         pre-roll before the attack, fade-in, fade-out (seconds)
//   floor                 trim the tail where it falls this many dB below the peak (default −54)
//   hp / lp / eq          filters: eq is a list like [['peak', 3500, 1.2, -3], ['hs', 8000, .7, -2]]
//   rate                  varispeed (pitch and length) — used for the size of a part, never as a "random" variant
//   gain                  dB, applied before normalisation (only meaningful in layers)
//   layers                [{ ...region, offset, gain }] mixed into one designed variant
// A sound groups variants; its `norm` sets their level: { short: dB } (loudest 30 ms RMS) or { peak: dB }.
// `link` makes a sound use the gains of another sound's variants (a gunshot's body and its tail stay one shot).

// ---------------------------------------------------------------- helpers
const R = (src, at, dur, o = {}) => ({ src, at, dur, ...o });
/** A whole one-shot file, trimmed. */
const W = (src, o = {}) => ({ src, at: 0, dur: 0, onset: false, trimHead: true, ...o });
const bsb = id => `bsb/${id}`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const pad2 = n => String(n).padStart(2, '0');
/** Steps cut automatically from a take (see build: autoSlice). */
const take = (src, o = {}) => ({ auto: true, src, ...o });

// ---------------------------------------------------------------- firearms
// Each firearm is built from one real weapon's recordings (The Free Firearm Sound Library, CC0) so it keeps that
// weapon's identity: shot bodies (first 120–200 ms: the report, muzzle blast and action), the outdoor tail that
// follows, the mid-distance microphone's version (heard from 25 m and more) and a far version (the mid version
// with distance's air absorption). Mechanical sounds come from close-miked handling recordings.
const FF = p => `ffsl/${p}`;
/** A shot at `at` in a near recording: its body and (when nothing follows it within the tail) its tail. */
const shot = (file, at, o = {}) => ({ file: FF(file), at, ...o });
/** Every shot of a burst between two times (the attacks are found automatically). */
const burst = (file, from, to, o = {}) => ({ file: FF(file), burst: [from, to], ...o });

/**
 * Weapon definitions. near: shots heard at the weapon (first person and close by); mid: the mid-distance mic.
 * body: seconds of each shot's body; eq: tone shaping of the report (tames the 2–5 kHz bite that is harsh on phone
 * speakers without dulling the crack); mech: mechanical parts (see MECH below) with their size (rate) and tone.
 */
export const FIREARMS = {
  // Vanguard AR-7 — an AR-15 (5.56 × 45): sharp crack, tight report.
  vanguard: { name: 'AR-15 (5.56 × 45)', near: [shot('AR-15/D_32P.wav', .702), shot('AR-15/D_32P.wav', 5.646)], mid: [shot('AR-15/D_24P.wav', .548), shot('AR-15/D_24P.wav', 3.908)],
    body: .15, eq: [['hp', 45], ['peak', 3400, 1.1, -2.5]], spice: [[.985, -.5], [1.015, .4], [.97, -1], [1.03, .6]], casing: 'rifle' },
  // Halcyon BR-3 — an AK-47 (7.62 × 39): heavier, rounder, recorded in single shots and bursts.
  halcyon: { name: 'AK-47 (7.62 × 39)', near: [shot('AK-47/C_28P.wav', .610), shot('AK-47/C_28P.wav', 3.256), shot('AK-47/C_28P.wav', 6.020), shot('AK-47/C_28P.wav', 9.156), burst('AK-47/C_29P.wav', 1.0, 1.4), burst('AK-47/C_29P.wav', 5.45, 5.85)],
    mid: [shot('AK-47/C_31P.wav', .336), shot('AK-47/C_31P.wav', 4.400), burst('AK-47/C_34P.wav', .7, .9)], body: .16, eq: [['hp', 40], ['peak', 3000, 1, -2]], casing: 'large', maxBodies: 10 },
  // Wasp SMG-9 — a Carl Gustav M/45 (9 × 19 submachine gun): light, fast, mechanical.
  wasp: { name: 'Carl Gustav M/45 (9 × 19)', near: [shot('Carl Gustav M45/G_31P.wav', .310), shot('Carl Gustav M45/G_31P.wav', 3.500), shot('Carl Gustav M45/G_31P.wav', 6.726), burst('Carl Gustav M45/G_35P.wav', .2, 1.1), burst('Carl Gustav M45/G_33P.wav', 4.2, 4.5)],
    mid: [shot('Carl Gustav M45/G_20P.wav', .346), shot('Carl Gustav M45/G_20P.wav', 2.258), shot('Carl Gustav M45/G_20P.wav', 5.266)], body: .1, eq: [['hp', 60], ['peak', 3600, 1.2, -2]], casing: 'pistol', maxBodies: 10 },
  // Kestrel K-45 — a PPSh-41 (7.62 × 25): very high rate, bright and snappy.
  kestrel: { name: 'PPSh-41 (7.62 × 25)', near: [shot('PPSh/P_30P.wav', .968), shot('PPSh/P_30P.wav', 4.386), shot('PPSh/P_30P.wav', 8.242), shot('PPSh/P_30P.wav', 11.420), shot('PPSh/P_30P.wav', 15.090), burst('PPSh/P_34P.wav', .7, 1.45)],
    mid: [shot('PPSh/P_16P.wav', .290), shot('PPSh/P_16P.wav', 5.250), shot('PPSh/P_16P.wav', 9.046)], body: .1, eq: [['hp', 55], ['peak', 3800, 1.2, -2.5]], casing: 'pistol', maxBodies: 10 },
  // Bastion 12G — a Benelli Nova and a Winchester Model 12 (12-gauge pump guns): broad boom, no crack.
  bastion: { name: 'Benelli Nova / Winchester Model 12 (12 ga pump)', near: [shot('Nova/O_21P.wav', .430), shot('Nova/O_21P.wav', 3.464), shot('Model 12/K_22P.wav', .840), shot('Model 12/K_22P.wav', 7.444)],
    mid: [shot('Nova/O_17P.wav', .692), shot('Nova/O_17P.wav', 3.706), shot('Model 12/K_17P.wav', .906)], body: .22, eq: [['hp', 38], ['peak', 2600, 1, -1.5]], casing: null },
  // Rampart Auto — a Charles Daly and a Mossberg 12-gauge (the report; the semi-automatic action is the Browning's).
  rampart: { name: 'Charles Daly / Mossberg (12 ga)', near: [shot('CD/H_21P.wav', .464), shot('CD/H_21P.wav', 3.074), shot('Mossberg/N_30P.wav', 1.694), shot('Mossberg/N_30P.wav', 4.960)],
    mid: [shot('CD/H_16P.wav', .606), shot('CD/H_16P.wav', 4.116), shot('Mossberg/N_26P.wav', .784)], body: .2, eq: [['hp', 40], ['peak', 2800, 1, -1.5]], casing: 'shell' },
  // Longbow SR — a Tikka T3 and a Springfield M1917 (.30-06 bolt actions): the biggest report, longest tail.
  longbow: { name: 'Tikka T3 / Springfield M1917 (.30-06 bolt action)', near: [shot('Tikka/W_29P.wav', .576), shot('Tikka/W_29P.wav', 5.664), shot('1917/B_24P.wav', 1.308), shot('1917/B_24P.wav', 6.730)],
    mid: [shot('Tikka/W_24P.wav', .754), shot('Tikka/W_24P.wav', 5.376), shot('1917/B_16P.wav', .606)], body: .24, eq: [['hp', 35], ['peak', 3000, 1, -2]], casing: 'large', tail: 1.8 },
  // Talon DMR — an SKS (7.62 × 39 semi-automatic carbine).
  talon: { name: 'Norinco SKS (7.62 × 39)', near: [shot('SKS/U_14P.wav', 3.576), shot('SKS/U_14P.wav', 6.754), shot('SKS/U_14P.wav', 10.210), shot('SKS/U_14P.wav', 13.290), shot('SKS/U_14P.wav', 16.776)],
    mid: [shot('SKS/U_19P.wav', 2.614), shot('SKS/U_19P.wav', 8.014), shot('SKS/U_19P.wav', 12.784)], body: .2, eq: [['hp', 40], ['peak', 3200, 1, -2]], casing: 'large' },
  // Anvil LMG — a Mosin–Nagant's 7.62 × 54R, the cartridge of a PK machine gun: full-power and deep.
  anvil: { name: 'Mosin–Nagant (7.62 × 54R)', near: [shot('Mosin Nagant/M_21P.wav', 1.032), shot('Mosin Nagant/M_21P.wav', 5.018), shot('Mosin Nagant/M_21P.wav', 9.154), shot('Mosin Nagant/M_21P.wav', 14.136)],
    mid: [shot('Mosin Nagant/M_26P.wav', 1.136), shot('Mosin Nagant/M_26P.wav', 6.104), shot('Mosin Nagant/M_26P.wav', 10.742)], body: .12, eq: [['hp', 38], ['peak', 3000, 1, -2]], casing: 'large', spice: [[.985, -.4], [1.012, .3], [.975, -.8], [1.025, .5]] },
  // Sparrow P9 — a Walther PPQ (9 × 19 striker pistol).
  sparrow: { name: 'Walther PPQ (9 × 19)', near: [shot('Walther PPQ/X_39P.wav', 1.406), shot('Walther PPQ/X_39P.wav', 6.444), shot('Walther PPQ/X_39P.wav', 10.660)],
    mid: [shot('Walther PPQ/X_31P.wav', 1.084), shot('Walther PPQ/X_31P.wav', 5.242)], body: .16, eq: [['hp', 60], ['peak', 3600, 1.2, -2.5]], casing: 'pistol' },
  // Thorn .44 — a Smith & Wesson 642 (.38 Special) and a .357 Magnum revolver (BigSoundBank).
  thorn: { name: 'Smith & Wesson 642 (.38 Special) / .357 Magnum', near: [shot('Smith & Wesson 642/V_27P.wav', .804), shot('Smith & Wesson 642/V_27P.wav', 6.218), { file: bsb('0438'), at: .064 }],
    mid: [shot('Smith & Wesson 642/V_22P.wav', .672), shot('Smith & Wesson 642/V_22P.wav', 5.506)], body: .2, eq: [['hp', 45], ['peak', 3200, 1, -2]], casing: null },
};

// ---------------------------------------------------------------- weapon mechanics
// Close-miked handling of real firearms: Gary's M1911A1, Browning 12-gauge semi-automatic, Marlin .22 and Remington
// 700 (timecodes from his notes, SMPTE 30 fps), LFA's bolt-action rifle, BigSoundBank's semi-automatic pistol and the
// Model 12's real pump stroke. Rifle and machine-gun magazines are made from the real magazine recordings at the
// part's size (a rifle magazine is longer and heavier than a pistol's: lower rate) with metal and cloth layers.
const G = f => `gary/${f}`;
const MECH = {
  // M1911A1 .45: magazine out (eject button and the magazine sliding free), in (slide in and latch), slide.
  pistolMagOut: [R(G('45ACP_Loading.wav'), 3.2, .32, { floor: -48 })],
  pistolMagIn: [R(G('45ACP_Loading.wav'), .33, .34, { floor: -48 }), R(G('45ACP_Loading.wav'), 4.9, .34, { floor: -48 })],
  pistolSlideRack: [R(G('45ACP_slide.wav'), .32, .42), R(G('45ACP_slide.wav'), 5.26, .42), R(bsb('1984'), .03, .5), R(bsb('1985'), .05, .42)],
  pistolSlideDrop: [R(G('45ACP_Loading.wav'), 7.44, .3)],
  pistolSlideLock: [R(G('45ACP_Loading.wav'), 6.28, .3)],
  pistolDry: [R(G('45ACP_slide.wav'), 1.52, .2), R(G('45ACP_slide.wav'), 4.31, .2), R(G('45ACP_slide.wav'), 6.59, .2), R(G('45ACP_slide.wav'), 9.53, .2)],
  // Remington 700 .30-06 bolt: open (lift and pull back) and close (push forward and turn down).
  boltOpen: [R(G('30-06_bolt.wav'), .52, .55)], boltClose: [R(G('30-06_bolt.wav'), 2.02, .55)],
  boltLift: [R(G('30-06_bolt.wav'), .52, .2)], boltBack: [R(G('30-06_bolt.wav'), .88, .3)],
  boltFwd: [R(G('30-06_bolt.wav'), 2.02, .3)], boltDown: [R(G('30-06_bolt.wav'), 2.40, .3)],
  rifleDry: [R(G('30-06_bolt.wav'), 5.91, .25), R(G('22_mag.wav'), 2.02, .2)],
  roundIn: [R(G('30-06_load.wav'), .22, .5), R(G('30-06_load.wav'), 4.32, .5), R(G('30-06_load.wav'), 7.82, .5)],
  // Browning 12-gauge semi-automatic: bolt (charging handle) back to lock, bolt home, a shell into the tube, the rack.
  shotgunBoltBack: [R(G('12ga_dry.wav'), .48, .4), R(G('12ga_dry.wav'), 6.24, .4)], shotgunBoltHome: [R(G('12ga_dry.wav'), 2.34, .4), R(G('12ga_dry.wav'), 8.32, .4)],
  shotgunRack: [R(G('12ga_load_chamber.wav'), 1.85, .45)], shellIntoTube: [R(G('12ga_load_chamber.wav'), .6, .45)], shotgunDry: [R(G('12ga_dry.wav'), 4.12, .25), R(G('12ga_dry.wav'), 10.26, .25)],
  // Winchester Model 12: the pump stroke as recorded on the range (near microphone), back and forward.
  pumpBack: [R(FF('Model 12/K_22P.wav'), 4.282, .3, { floor: -42, hp: 120 })], pumpFwd: [R(FF('Model 12/K_22P.wav'), 4.834, .3, { floor: -42, hp: 120 })],
  // Marlin .22: bolt open/close (light, quick) and its magazine.
  smallBolt: [R(G('22_mag.wav'), .32, .5), R(G('22_mag.wav'), 2.7, .5)],
  // Scope cover and bipod (Remington accessories): hinged spring-loaded parts.
  coverOpen: [R(G('30-06_accessories.wav'), 3.0, .3), R(G('30-06_accessories.wav'), 1.46, .35)], coverClose: [R(G('30-06_accessories.wav'), 4.16, .3), R(G('30-06_accessories.wav'), .1, .35)],
  // Hammer (BigSoundBank pistol): cocking and decocking clicks — a magazine catch or cylinder latch at the right size.
  hammer: [W(bsb('1992')), W(bsb('1993'))], decock: [W(bsb('1994')), W(bsb('1995'))],
  // Rounds: pushed into a magazine, poured out (the .45's magazine unloaded), a single cartridge.
  roundsOut: [R(G('45_unload_rounds.wav'), .05, 1.4, { floor: -50 })], roundsIn: [R(G('45_add_rounds.wav'), .34, .9), R(G('45_add_rounds.wav'), 5.41, .6)],
};
/**
 * One mechanical part at a weapon's size: rate (lower = bigger, heavier part), a tone filter, and an optional metal
 * layer (a steel magazine knocking home is louder and duller than a polymer one).
 */
const part = (list, rate = 1, o = {}) => list.map(v => ({ ...v, rate: (v.rate ?? 1) * rate, ...(o.hp ? { hp: o.hp } : {}), ...(o.lp ? { lp: o.lp } : {}), ...(o.eq ? { eq: o.eq } : {}) }));

// Per weapon: the reload's mechanical cues (src/arena/sound/reloads.mjs times them to the animation).
export const WEAPON_MECH = {
  vanguard: { // aluminium STANAG magazine, bolt catch
    magRelease: part(MECH.hammer, 1.25, { hp: 600 }), magOut: part(MECH.pistolMagOut, .86), magIn: part(MECH.pistolMagIn, .84), magSeat: part(MECH.decock, .9),
    boltRelease: part(MECH.pistolSlideDrop, .8, { lp: 7000 }), dry: part(MECH.rifleDry, 1.05), raise: part(MECH.smallBolt, .9, { lp: 5000 }),
  },
  halcyon: { // steel AK magazine rocked in, heavy charging handle
    magRelease: part(MECH.hammer, 1.0, { hp: 400 }), magOut: part(MECH.pistolMagOut, .78, { lp: 6500 }), magIn: part(MECH.pistolMagIn, .76, { lp: 6500 }), magSeat: part(MECH.hammer, .82),
    chargeBack: part(MECH.shotgunBoltBack, 1.02), chargeFwd: part(MECH.shotgunBoltHome, 1.0), dry: part(MECH.rifleDry, .95), raise: part(MECH.smallBolt, .85, { lp: 4500 }),
  },
  wasp: { // curved steel SMG magazine, cocking handle slapped home
    magRelease: part(MECH.hammer, 1.35, { hp: 700 }), magOut: part(MECH.pistolMagOut, .92), magIn: part(MECH.pistolMagIn, .9), magSeat: part(MECH.decock, 1.05),
    chargeBack: part(MECH.shotgunBoltBack, 1.18), chargeFwd: part(MECH.shotgunBoltHome, 1.2), dry: part(MECH.pistolDry, .95), raise: part(MECH.smallBolt, 1.0, { lp: 5000 }),
  },
  kestrel: { // box magazine, bolt-handle charging
    magRelease: part(MECH.hammer, 1.15, { hp: 500 }), magOut: part(MECH.pistolMagOut, .88), magIn: part(MECH.pistolMagIn, .86), magSeat: part(MECH.hammer, .95),
    chargeBack: part(MECH.smallBolt, .8), chargeFwd: part(MECH.shotgunBoltHome, 1.1), dry: part(MECH.pistolDry, .9), raise: part(MECH.smallBolt, .95, { lp: 5000 }),
  },
  rampart: { // detachable box magazine, the Browning's own charging handle
    magRelease: part(MECH.hammer, .95, { hp: 400 }), magOut: part(MECH.pistolMagOut, .74, { lp: 6000 }), magIn: part(MECH.pistolMagIn, .72, { lp: 6000 }), magSeat: part(MECH.hammer, .78),
    chargeBack: part(MECH.shotgunBoltBack, 1), chargeFwd: part(MECH.shotgunBoltHome, 1), rack: part(MECH.shotgunRack, 1), dry: part(MECH.shotgunDry, 1), raise: part(MECH.smallBolt, .8, { lp: 4000 }),
  },
  bastion: { // tube-fed pump: shells one by one, the real Model 12 pump stroke
    shellIn: [...part(MECH.shellIntoTube, 1), ...part(MECH.roundIn, .86, { lp: 6000 })], pumpBack: part(MECH.pumpBack, 1), pumpFwd: part(MECH.pumpFwd, 1),
    dry: part(MECH.shotgunDry, 1.05), raise: part(MECH.smallBolt, .78, { lp: 4000 }),
  },
  longbow: { // detachable box, the Remington 700 bolt
    magRelease: part(MECH.hammer, 1.1, { hp: 500 }), magOut: part(MECH.pistolMagOut, .9), magIn: part(MECH.pistolMagIn, .88), magSeat: part(MECH.decock, .95),
    boltLift: part(MECH.boltLift, 1), boltBack: part(MECH.boltBack, 1), boltFwd: part(MECH.boltFwd, 1), boltDown: part(MECH.boltDown, 1), dry: part(MECH.rifleDry, 1), raise: part(MECH.smallBolt, .82, { lp: 4500 }),
  },
  talon: { // steel 20-round box, charging handle
    magRelease: part(MECH.hammer, 1.05, { hp: 450 }), magOut: part(MECH.pistolMagOut, .8), magIn: part(MECH.pistolMagIn, .78), magSeat: part(MECH.hammer, .86),
    chargeBack: part(MECH.shotgunBoltBack, 1.08), chargeFwd: part(MECH.shotgunBoltHome, 1.06), dry: part(MECH.rifleDry, 1.0), raise: part(MECH.smallBolt, .85, { lp: 4500 }),
  },
  anvil: { // belt-fed: feed cover, ammunition box, belt, charging handle
    coverOpen: part(MECH.coverOpen, .72, { lp: 6000 }), coverClose: part(MECH.coverClose, .7, { lp: 6000 }), magRelease: part(MECH.hammer, .8, { hp: 400 }), magOut: part(MECH.pistolMagOut, .66, { lp: 5000 }), magIn: part(MECH.pistolMagIn, .64, { lp: 5000 }),
    magSeat: part(MECH.hammer, .7), belt: [W(bsb('0360'), { hp: 400, rate: .9, fo: .1 }), W(bsb('0361'), { hp: 400, rate: .9, fo: .1 })], chargeBack: part(MECH.shotgunBoltBack, .9), chargeFwd: part(MECH.shotgunBoltHome, .88), dry: part(MECH.rifleDry, .9), raise: part(MECH.smallBolt, .72, { lp: 4000 }),
  },
  sparrow: { // polymer 9 mm pistol: the 1911's magazine and slide, a touch smaller
    magRelease: part(MECH.hammer, 1.4, { hp: 800 }), magOut: part(MECH.pistolMagOut, 1.06), magIn: part(MECH.pistolMagIn, 1.06), magSeat: part(MECH.decock, 1.15),
    slideDrop: part(MECH.pistolSlideDrop, 1.06), slideRack: part(MECH.pistolSlideRack, 1.04), dry: part(MECH.pistolDry, 1.04), raise: part(MECH.pistolSlideLock, 1.2, { lp: 3500 }),
  },
  thorn: { // revolver: cylinder latch and swing, ejector, speed-loader, close
    cylOpen: [...part(MECH.hammer, 1.15), ...part(MECH.smallBolt, 1.25, { lp: 7000 })], eject: part(MECH.roundsOut, 1.05), speedload: part(MECH.roundsIn, 1.1), cylClose: part(MECH.coverClose, 1.25),
    dry: part(MECH.hammer, .95), raise: part(MECH.hammer, .8, { lp: 3000 }),
  },
};

// ---------------------------------------------------------------- banks
const footstepSurfaces = {
  // Boots and shoes on concrete (BigSoundBank's walking and running takes, swuing's boots on concrete).
  concrete: { takes: [take(bsb('1318'), { max: 26 }), take(bsb('1319'), { max: 22 }), take(bsb('0514'), { max: 12 })], extra: range(0, 8).map(i => W(`congus/boots/${i}.ogg`)), eq: [['hp', 90], ['peak', 250, .9, 1.5]] },
  // Asphalt: the concrete steps, a little darker with more grit (the same boots on a different floor).
  asphalt: { takes: [take(bsb('1318'), { max: 20, skip: 13 }), take(bsb('1319'), { max: 18, skip: 11 })], eq: [['hp', 80], ['ls', 300, .7, 1.5], ['hs', 5000, .7, -3], ['peak', 2400, 1.5, 1.5]] },
  // Gravel: the BigSoundBank gravel takes (studio Foley and a mountain path) and Ali_6868's gravel.
  gravel: { takes: [take(bsb('1117'), { max: 22 }), take(bsb('3216'), { max: 16 }), take(bsb('0085'), { max: 10 }), take(bsb('0510'), { max: 12 })], extra: range(0, 9).map(i => W(`congus/gravel/${i}.ogg`)), eq: [['hp', 100]] },
  // Dirt: a packed earth path (fine gravel takes, low-passed: no stones) and jumps on a dirt road.
  dirt: { takes: [take(bsb('3202'), { max: 22 }), take(bsb('3216'), { max: 12, skip: 9 })], eq: [['hp', 80], ['lp', 4200], ['ls', 220, .7, 2]] },
  // Grass: short and tall grass, slow and quick (BigSoundBank), swuing's grass.
  grass: { takes: [take(bsb('1254'), { max: 14 }), take(bsb('0854'), { max: 16 }), take(bsb('1253'), { max: 10 }), take(bsb('1024'), { max: 12 })], extra: range(0, 8).map(i => W(`congus/grass/${i}.ogg`)), eq: [['hp', 90]] },
  // Sand: Fantozzi's sand steps and the softest dirt steps.
  sand: { takes: [take(bsb('3202'), { max: 12, skip: 30 })], extra: ['SandL1', 'SandL2', 'SandL3', 'SandR1', 'SandR2', 'SandR3'].map(n => W(`fantozzi/Fantozzi-${n}.flac`)), eq: [['hp', 90], ['lp', 3500]] },
  // Metal floors, stairs and grates: boots on an aluminium ladder (Eelke), heavier with a steel layer.
  metal: { extra: range(0, 7).map(i => W(`congus/metal/${i}.ogg`)), designed: 'metal', eq: [['hp', 110]] },
  // Container roofs and sheet steel: the metal steps through a hollow, boomy box.
  container: { extra: range(0, 7).map(i => W(`congus/metal/${i}.ogg`, { rate: .86 })), designed: 'container', eq: [['hp', 70], ['peak', 180, 1.2, 4], ['lp', 6000]] },
  // Timber floors and crates: BigSoundBank's shoes on wooden floors, swuing's wood.
  wood: { takes: [take(bsb('1515'), { max: 16 }), take(bsb('1516'), { max: 14 }), take(bsb('1518'), { max: 14 }), take(bsb('0165'), { max: 10 }), take(bsb('1845'), { max: 8 })], extra: range(0, 8).map(i => W(`congus/wood/${i}.ogg`)), eq: [['hp', 80]],
    stairs: [take(bsb('3026'), { max: 14 }), take(bsb('3212'), { max: 10 }), take(bsb('3025'), { max: 10 })] },
  // Stone paving and tiled floors: a stone staircase (BigSoundBank), tile steps, Fantozzi's stone.
  stone: { takes: [take(bsb('0606'), { max: 24 })], extra: [...range(1, 8).map(i => W(`congus/tile/${i}.ogg`)), ...['StoneL2', 'StoneL3', 'StoneR1', 'StoneR2', 'StoneR3'].map(n => W(`fantozzi/Fantozzi-${n}.flac`))], eq: [['hp', 100]], stairs: [take(bsb('0606'), { max: 14, skip: 20 })] },
};
export const SURFACES = Object.keys(footstepSurfaces);
export const SURFACE_SOURCES = footstepSurfaces;
/** Landing on each surface: BigSoundBank's two-footed jumps where recorded, else designed from two heavy steps. */
export const LANDINGS = {
  concrete: [W(bsb('1835'), { headDb: -14 }), W(bsb('1836'), { headDb: -14 })], asphalt: [W(bsb('1835'), { headDb: -14, eq: [['hs', 5000, .7, -3]] }), W(bsb('1836'), { headDb: -14, eq: [['hs', 5000, .7, -3]] })],
  dirt: [W(bsb('1837'), { headDb: -14 }), W(bsb('1838'), { headDb: -14 })], gravel: [W(bsb('1837'), { headDb: -14, eq: [['hs', 3000, .7, 3]] }), W(bsb('1838'), { headDb: -14, eq: [['hs', 3000, .7, 3]] })],
  grass: [W(bsb('1839'), { headDb: -14 }), W(bsb('1840'), { headDb: -14 })], sand: [W(bsb('1839'), { headDb: -14, lp: 3000 }), W(bsb('1840'), { headDb: -14, lp: 3000 })],
  wood: [W(bsb('1841'), { headDb: -14 }), W(bsb('1842'), { headDb: -14 })], stone: [W(bsb('1835'), { headDb: -14, eq: [['peak', 3000, 1, 2]] }), W(bsb('1836'), { headDb: -14, eq: [['peak', 3000, 1, 2]] })],
};

/** All banks: name → sounds. Weapon, footstep and voice banks are generated by the build from the tables above. */
export const BANKS = {
  // -------------------------------------------------------------- interface (Kenney, CC0): precise and quiet
  ui: {
    q: 4, rate: 32000, max: .4, sounds: {
      click: { norm: { short: -24 }, variants: [1, 3, 4].map(i => W(`kenneyif/click_00${i}.ogg`)) },
      hover: { norm: { short: -32 }, variants: range(2, 6).map(i => W(`kenneyui/rollover${i}.wav`)) },
      confirm: { norm: { short: -22 }, variants: range(1, 4).map(i => W(`kenneyif/confirmation_00${i}.ogg`)) },
      select: { norm: { short: -24 }, variants: range(1, 8).map(i => W(`kenneyif/select_00${i}.ogg`)) },
      back: { norm: { short: -24 }, variants: range(1, 4).map(i => W(`kenneyif/back_00${i}.ogg`)) },
      toggle: { norm: { short: -24 }, variants: range(1, 4).map(i => W(`kenneyif/toggle_00${i}.ogg`)) },
      tick: { norm: { short: -28 }, variants: [1, 2, 4].map(i => W(`kenneyif/tick_00${i}.ogg`)) },
      error: { norm: { short: -22 }, variants: [W('kenneyif/error_004.ogg'), W('kenneyif/error_006.ogg'), W('kenneyif/error_008.ogg')] },
      purchase: { norm: { short: -20 }, variants: [W('kenneyif/maximize_006.ogg'), W('kenneyif/confirmation_002.ogg')] },
      equip: { norm: { short: -22 }, variants: range(1, 5).map(i => W(`kenneyui/switch${[2, 7, 13, 21, 30][i - 1]}.wav`)) },
      // Hit confirmation: a real mechanical click (a thermostat, BigSoundBank) — crisp in the 2–5 kHz band phone speakers
      // reproduce, short enough never to mask a footstep. Headshot: a light glass/metal tap on top. Elimination: a body
      // punch under the click, felt more than heard.
      hit: { norm: { short: -18 }, max: .12, variants: [W(bsb('2191'), { hp: 900 }), W(bsb('2192'), { hp: 900 }), W('kenneyif/tick_002.ogg', { hp: 900 })] },
      headshot: { norm: { short: -17 }, max: .25, variants: [{ layers: [W(bsb('2191'), { hp: 900 }), W('kenneyif/glass_002.ogg', { offset: .004, gain: -4 })] }, { layers: [W(bsb('2192'), { hp: 900 }), W('kenneyif/glass_004.ogg', { offset: .004, gain: -4 })] }] },
      kill: { norm: { short: -16 }, variants: [{ layers: [W(bsb('2191'), { hp: 900 }), W(bsb('2459'), { lp: 900, offset: .002, gain: -2 })] }, { layers: [W(bsb('2192'), { hp: 900 }), W(bsb('2462'), { lp: 900, offset: .002, gain: -2 })] }] },
      medal: { norm: { short: -22 }, variants: [W('kenneyif/confirmation_004.ogg'), W('kenneyif/maximize_008.ogg')] },
      streak: { norm: { short: -20 }, variants: [W('kenneyif/maximize_004.ogg')] },
      countdown: { norm: { short: -24 }, variants: [W('kenneyif/tick_004.ogg')] },
      notify: { norm: { short: -24 }, variants: [W('kenneyif/question_001.ogg'), W('kenneyif/question_003.ogg')] },
      ping: { norm: { short: -22 }, variants: [W('kenneyif/glass_006.ogg'), W('kenneyif/bong_001.ogg', { gain: -6 })] },
    },
  },
  // -------------------------------------------------------------- announcer and radio (real voice actors)
  vo: {
    q: 5, rate: 24000, sounds: Object.fromEntries([
      ['three', 'kenneyvo/Male/3.ogg'], ['two', 'kenneyvo/Male/2.ogg'], ['one', 'kenneyvo/Male/1.ogg'], ['go', 'kenneyvo/Male/go.ogg'], ['ready', 'kenneyvo/Male/ready.ogg'],
      ['win', 'vbradio/20._mission_accomplished.wav'], ['lose', 'kenneyvo/Male/mission_failed.ogg'], ['draw', 'kenneyvo/Male/its_a_tie.ogg'],
      ['secured', 'vbradio/17._objective_secured.wav'], ['lost', 'vbradio/18._objective_lost.wav'], ['contested', 'vbradio/25._were_under_attack.wav'], ['losing', 'vbradio/15._were_losing_ground.wav'],
      ['supply', 'vbradio/19._care_package_inbound.wav'], ['strikeOurs', 'vbradio/21._air_support_inbound.wav'], ['strikeTheirs', 'vbradio/10._artillery_strike_inbound.wav'],
      ['uav', 'vbradio/09._enemy_uav_overhead.wav'], ['goodwork', 'vbradio/13._good_work_soldier.wav'], ['grenade', 'kenneyvo/Male/war_fire_in_the_hole.ogg'], ['grenadeF', 'kenneyvo/Female/war_fire_in_the_hole.ogg'],
    ].map(([k, f]) => [k, { norm: { short: -17 }, variants: [W(f, { hp: 110, floor: -50, fo: .06 })] }])),
  },
  // -------------------------------------------------------------- shared weapon handling (any weapon)
  handling: {
    q: 4, rate: 32000, max: .6, sounds: {
      // A hand going to a magazine pouch: the pouch's flap (Velcro, BigSoundBank) and the jacket moving.
      pouch: { norm: { short: -26 }, variants: ['#0', '#3', '#6', '#9', '#11'].map(k => R(bsb('0629'), k, .32, { hp: 300 })) },
      grab: { norm: { short: -28 }, variants: [R(bsb('1104'), '#0', .3, { hp: 200 }), R(bsb('1104'), '#1', .3, { hp: 200 }), R(bsb('1104'), '#2', .3, { hp: 200 }), R(bsb('0399'), '#2', .3, { hp: 250 }), R(bsb('0399'), '#5', .3, { hp: 250 })] },
      // The weapon settling in the hands after a reload or a raise: sling swivels and buckle (BigSoundBank).
      settle: { norm: { short: -30 }, variants: [W(bsb('0355'), { hp: 500, fo: .1 }), W(bsb('1241'), { hp: 700, fo: .1 }), R(bsb('0575'), '#2', .4, { hp: 400 }), R(bsb('0575'), '#9', .4, { hp: 400 }), R(bsb('0575'), '#14', .4, { hp: 400 })] },
      // Raising to the sights: cloth and a light grip adjustment.
      ads: { norm: { short: -32 }, variants: [R(bsb('1104'), 3.6, .22, { hp: 250, onset: false, fi: .02 }), R(bsb('1104'), 6.45, .22, { hp: 250, onset: false, fi: .02 }), R(bsb('0399'), '#7', .22, { hp: 250 })] },
      // Switching weapons: a sling moving, a weapon swung across the body (nylon, BigSoundBank).
      swap: { norm: { short: -26 }, variants: ['1787', '1789', '1791', '1793'].map(id => W(bsb(id), { hp: 200, fo: .08, headDb: -18 })) },
      // A blade drawn from its sheath (a sword sliding along metal, a knife blade's ring; BigSoundBank), quietly.
      drawBlade: { norm: { short: -28 }, max: .5, variants: [W(bsb('0129'), { hp: 300, fo: .15 }), W(bsb('2574'), { hp: 500, fo: .15 }), W(bsb('2578'), { hp: 500, fo: .15 })] },
      // Melee: blades and tools through the air, the hit.
      swingKnife: { norm: { short: -18 }, variants: ['0128', '1797', '1802'].map(id => W(bsb(id), { headDb: -20 })) },
      swingHeavy: { norm: { short: -18 }, variants: ['1798', '1801', '1795'].map(id => W(bsb(id), { headDb: -20 })) },
      swingRifle: { norm: { short: -22 }, variants: ['1799', '1796'].map(id => W(bsb(id), { headDb: -20 })) },
      stab: { norm: { short: -16 }, variants: [W(bsb('0127')), { layers: [W(bsb('0127')), W(bsb('2463'), { gain: -6, offset: .01 })] }, { layers: [W(bsb('0127'), { rate: .92 }), W(bsb('2461'), { gain: -6, offset: .01 })] }] },
      chop: { norm: { short: -15 }, variants: [{ layers: [R(bsb('0705'), '#1', .5), W(bsb('2464'), { gain: -3 })] }, { layers: [R(bsb('0536'), '#2', .5), W(bsb('2466'), { gain: -3 })] }, { layers: [R(bsb('0705'), '#5', .5), W(bsb('2468'), { gain: -3 })] }] },
      butt: { norm: { short: -15 }, variants: [W(bsb('2460')), W(bsb('2465')), W(bsb('2467'))] },
      // Grenades: the pin (a split ring and its spring, BigSoundBank carabiner), the spoon flying off, the throw.
      pin: { norm: { short: -24 }, variants: [W(bsb('1237'), { hp: 700 }), W(bsb('1239'), { hp: 700 })] },
      spoon: { norm: { short: -26 }, variants: ['#0', '#3', '#4'].map(k => R(bsb('0461'), k, .35, { hp: 900 })) },
      throwArm: { norm: { short: -22 }, variants: ['1795', '1796'].map(id => W(bsb(id), { hp: 200, headDb: -20 })) },
      // Resupplied from a crate: rounds handled and pouches closed.
      resupply: { norm: { short: -24 }, max: .9, variants: [{ layers: [W(bsb('1988')), R(bsb('0629'), 1.0, .3, { offset: .25, gain: -4 })] }, { layers: [W(bsb('1990')), R(bsb('0629'), 3.2, .3, { offset: .3, gain: -4 })] }] },
    },
  },
  // -------------------------------------------------------------- bullets: impacts, flybys, casings, dropped magazines
  impacts: {
    q: 4, rate: 32000, max: .36, sounds: {
      // A round striking each material: a real impact on that material (BigSoundBank, rubberduck) with the sharp
      // leading edge a bullet has, and debris where the material breaks up.
      concrete: { norm: { short: -16 }, variants: [W('rdbreak/bfh1_rock_hit_01.ogg', { fo: .12 }), { layers: [R(bsb('1022'), '#1', .35), W('rdbreak/bfh1_hit_03.ogg', { gain: -3 })] }, { layers: [R(bsb('1022'), '#4', .35), W('rdbreak/bfh1_hit_05.ogg', { gain: -3 })] }, { layers: [R(bsb('1022'), '#9', .35), W('rdbreak/bfh1_hit_06.ogg', { gain: -3 })] }, W('rdbreak/bfh1_rock_breaking_01.ogg', { fo: .15, rate: 1.15 }), W('rdbreak/bfh1_rock_breaking_02.ogg', { fo: .15, rate: 1.15 })] },
      brick: { norm: { short: -16 }, variants: [W('rdbreak/bfh1_rock_hit_01.ogg', { lp: 6000, rate: .92 }), W('rdbreak/bfh1_rock_breaking_03.ogg', { fo: .15, rate: 1.05 }), { layers: [R(bsb('1022'), '#12', .4), W('rdbreak/bfh1_hit_08.ogg', { gain: -3 })] }] },
      metal: { norm: { short: -16 }, max: .5, variants: [R(bsb('0706'), '#0', .5, { fo: .2 }), R(bsb('0706'), '#3', .5, { fo: .2 }), W(bsb('1771'), { fo: .2 }), W(bsb('1773'), { fo: .2 }), W('rdbreak/bfh1_metal_hit_01.ogg', { fo: .2 }), W('rdbreak/bfh1_metal_hit_03.ogg', { fo: .2 })] },
      // Thin sheet steel (containers, roofs): hollow and ringing.
      sheet: { norm: { short: -16 }, max: .5, variants: [W(bsb('0246'), { fo: .2 }), W(bsb('0248'), { fo: .2 }), W('rdbreak/bfh1_metal_hit_05.ogg', { fo: .25 }), W('rdbreak/bfh1_metal_falling_02.ogg', { fo: .25 })] },
      wood: { norm: { short: -16 }, variants: [W(bsb('1588')), R(bsb('1011'), '#0', .3), R(bsb('1011'), '#3', .3), W('rdbreak/bfh1_wood_hit_01.ogg'), W('rdbreak/bfh1_wood_hit_02.ogg'), W('rdbreak/bfh1_wood_breaking_01.ogg', { rate: 1.2, fo: .12 })] },
      dirt: { norm: { short: -18 }, variants: [...['#1', '#3', '#4', '#7'].map(k => R(bsb('1305'), k, .45, { trimHead: true, headDb: -16 })), W(bsb('1837'), { hp: 200, headDb: -14 })] },
      sand: { norm: { short: -19 }, variants: [R(bsb('1305'), '#9', .35, { lp: 3000 }), R(bsb('1305'), '#10', .35, { lp: 3000 }), R(bsb('0576'), '#1', .5, { lp: 3000 })] },
      foliage: { norm: { short: -20 }, variants: [R(bsb('1299'), '#0', .35, { fo: .1 }), R(bsb('1300'), '#0', .35, { fo: .1 }), R(bsb('1024'), '#0', .3), R(bsb('1024'), '#4', .3)] },
      glass: { norm: { short: -17 }, variants: [W(bsb('2039')), W(bsb('2041')), W(bsb('2043')), W(bsb('1121'))] },
      // A round stopped by a person: through clothing (a dull punch), into a plate carrier (a hard knock on the plate
      // with the fabric over it), off a helmet (a short metallic knock).
      flesh: { norm: { short: -15 }, variants: [W(bsb('2459')), W(bsb('2461')), W(bsb('2463')), W(bsb('2468')), R('dklon/chest_hit.wav', '#0', .4), R('dklon/chest_hit.wav', '#2', .4)] },
      armour: { norm: { short: -14 }, variants: [{ layers: [W(bsb('2462')), W('rdbreak/bfh1_hit_01.ogg', { gain: -3, hp: 400 })] }, { layers: [W(bsb('2465')), W('rdbreak/bfh1_hit_02.ogg', { gain: -3, hp: 400 })] }, { layers: [W(bsb('2467')), W('rdbreak/bfh1_hit_04.ogg', { gain: -3, hp: 400 })] }] },
      helmet: { norm: { short: -14 }, variants: [{ layers: [W(bsb('1084'), { fo: .15 }), W(bsb('2464'), { gain: -6 })] }, { layers: [W('rdbreak/bfh1_metal_hit_02.ogg', { fo: .12 }), W(bsb('2466'), { gain: -6 })] }] },
      // A ricochet off steel: the strike and a whine (a fast-moving metal "zing", BigSoundBank whooshes, raised in pitch).
      ricochet: { norm: { short: -18 }, max: .5, variants: [{ layers: [W(bsb('0706'), { fo: .1 }), W(bsb('1800'), { rate: 2.2, hp: 1500, offset: .01, gain: -2 })] }, { layers: [W('rdbreak/bfh1_metal_hit_04.ogg', { fo: .1 }), W(bsb('1801'), { rate: 2.4, hp: 1500, offset: .01, gain: -2 })] }] },
      // Rounds passing close: the supersonic crack (the leading edge of a rifle's report, high-passed) and a subsonic whiz.
      snap: { norm: { peak: -3 }, variants: [R(FF('AR-15/D_24P.wav'), .548, .05, { hp: 2500, fo: .03 }), R(FF('Tikka/W_24P.wav'), .754, .05, { hp: 2500, fo: .03 }), R(FF('SKS/U_19P.wav'), 2.614, .05, { hp: 2500, fo: .03 })] },
      whiz: { norm: { short: -18 }, variants: [W(bsb('1797'), { rate: 1.8, hp: 900 }), W(bsb('1802'), { rate: 1.9, hp: 900 }), W(bsb('0128'), { rate: 1.6, hp: 900 })] },
      // Spent cases landing: real 9 mm, 5.56 and 7.62 cases on concrete; a plastic shotgun hull (a 7.62 case, damped).
      casePistol: { norm: { short: -24 }, max: .45, variants: range(1355, 1358).map(i => W(bsb(String(i)))) },
      caseRifle: { norm: { short: -23 }, max: .45, variants: range(1361, 1364).map(i => W(bsb(String(i)))) },
      caseLarge: { norm: { short: -22 }, max: .45, variants: range(1367, 1370).map(i => W(bsb(String(i)))) },
      caseShell: { norm: { short: -24 }, max: .4, variants: range(1367, 1369).map(i => W(bsb(String(i)), { rate: .72, lp: 3500 })) },
      caseSoft: { norm: { short: -32 }, max: .3, variants: range(1361, 1363).map(i => W(bsb(String(i)), { lp: 1200, floor: -30 })) },
      // An empty magazine dropping: a light steel box on the ground (BigSoundBank tin cans).
      magDrop: { norm: { short: -22 }, max: .5, variants: [W(bsb('0246'), { rate: 1.1 }), W(bsb('0247'), { rate: 1.1 }), W(bsb('0249'), { rate: 1.1 })] },
      magDropSoft: { norm: { short: -28 }, variants: [W(bsb('0246'), { lp: 1500, floor: -30 }), W(bsb('0249'), { lp: 1500, floor: -30 })] },
    },
  },
  // -------------------------------------------------------------- explosives and scorestreaks
  explosives: {
    q: 4, rate: 32000, max: 2.2, sounds: {
      // A grenade close by: a real blast heard at 10 m (a propane bird-scarer cannon, BigSoundBank) and firework bangs
      // (rubberduck) for the sharp front, with stone debris raining down. Further away: the same blasts recorded at
      // 150 and 250 m.
      blastNear: { norm: { peak: -1 }, variants: [{ layers: [W(bsb('1808')), W('rdbang/cannon_02.ogg', { gain: -2 }), W(bsb('1023'), { offset: .03, gain: -5, rate: .9 }), R(bsb('1022'), '#14', 1.4, { offset: .2, gain: -14, fi: .05 })] },
        { layers: [W(bsb('1808'), { rate: .92 }), W('rdbang/cannon_01.ogg', { gain: -2 }), W(bsb('1023'), { offset: .03, gain: -6 }), R(bsb('1022'), '#20', 1.4, { offset: .22, gain: -14, fi: .05 })] },
        { layers: [W('rdbang/bang_09.ogg'), W(bsb('1808'), { rate: .86, gain: -2 }), W(bsb('1023'), { offset: .04, gain: -6, rate: .85 }), R(bsb('1022'), '#26', 1.4, { offset: .2, gain: -14, fi: .05 })] }] },
      blastMid: { norm: { peak: -2 }, max: 1.6, variants: [W(bsb('1807')), W(bsb('1807'), { rate: .93 }), W('rdbang/cannon_02.ogg', { lp: 3000 })] },
      blastFar: { norm: { peak: -3 }, max: 2.0, variants: [W(bsb('1806')), W(bsb('1023')), W('rdbang/cannon_05.ogg', { lp: 1600 })] },
      debris: { norm: { short: -22 }, max: 1.2, variants: [R(bsb('1022'), '#30', 1.2, { fi: .03 }), W('rdbreak/bfh1_rock_falling_03.ogg'), W('rdbreak/bfh1_rock_falling_06.ogg')] },
      // Flash: a very sharp bang (rubberduck), no debris. Smoke: the canister's pop and its hiss (BigSoundBank air).
      flashBang: { norm: { peak: -1 }, max: 1.1, variants: [W('rdbang/bang_03.ogg'), W('rdbang/bang_07.ogg')] },
      smokePop: { norm: { short: -18 }, variants: [W('rdbang/shot_02.ogg', { lp: 2500 }), R(bsb('0138'), '#0', .6), R(bsb('0138'), '#3', .6)] },
      smokeHiss: { norm: { short: -22 }, loop: { xf: .4 }, variants: [R(bsb('1486'), 3.0, 6.4, { hp: 500, onset: false })] },
      // A grenade on the ground: a steel ball bouncing off tiles (BigSoundBank) for hard floors; a dull knock on earth.
      bounce: { norm: { short: -22 }, max: .3, variants: range(2242, 2245).map(i => R(bsb(String(i)), '#0', .3, { fo: .08 })) },
      bounceSoft: { norm: { short: -28 }, variants: [W(bsb('1837'), { lp: 1200, headDb: -14 }), W(bsb('1839'), { lp: 1200, headDb: -14 })] },
      // Tack Charge: sticks with a thump, arms with an electronic beep (a real device, BigSoundBank).
      stick: { norm: { short: -18 }, max: .4, variants: [W(bsb('1234'), { fo: .1, headDb: -16 }), W(bsb('1084'), { lp: 2000, fo: .1 })] },
      beep: { norm: { short: -24 }, max: .2, variants: [R(bsb('0760'), '#0', .35), R(bsb('0760'), '#1', .35)] },
      // Supply crate landing and the strike's warning tone.
      crate: { norm: { short: -16 }, max: .7, variants: [{ layers: [W(bsb('2452')), W('rdbreak/bfh1_wood_hit_03.ogg', { gain: -3 })] }, { layers: [W(bsb('2454')), W('rdbreak/bfh1_wood_hit_01.ogg', { gain: -3 })] }] },
      alarm: { norm: { short: -22 }, max: 1.2, variants: [W(bsb('0268'), { hp: 300 })] },
    },
  },
  // -------------------------------------------------------------- movement Foley shared by every character
  movement: {
    q: 5, rate: 32000, max: .9, sounds: {
      // Clothing with each step (very quiet): a jacket and trousers rubbing (BigSoundBank, HaelDB).
      cloth: { norm: { short: -34 }, max: .25, variants: [...range(1, 4).map(i => W(`haeldbsteps/step_cloth${i}.ogg`, { hp: 200 })), R(bsb('1104'), .4, .18, { hp: 250 }), R(bsb('1104'), 2.6, .18, { hp: 250 }), R(bsb('1104'), 4.8, .18, { hp: 250 })] },
      leather: { norm: { short: -34 }, max: .25, variants: [W('haeldbsteps/step_lth1.ogg', { hp: 200 }), W('haeldbsteps/step_lth2.ogg', { hp: 200 }), W('haeldbsteps/step_lth4.ogg', { hp: 200 })] },
      // Equipment: magazines and buckles in a vest, kept light; heavier when sprinting or landing.
      gearLight: { norm: { short: -34 }, max: .25, variants: [W('haeldbsteps/step_metal.ogg', { hp: 900 }), W('haeldbsteps/step_metal (2).ogg', { hp: 900 }), W('haeldbsteps/step_metal (3).ogg', { hp: 900 }), W(bsb('1238'), { hp: 900, fo: .05 }), W(bsb('1240'), { hp: 900, fo: .05 })] },
      gearHeavy: { norm: { short: -28 }, max: .4, variants: [W(bsb('2556'), { hp: 500, fo: .1 }), W(bsb('2558'), { hp: 500, fo: .1 }), W(bsb('2560'), { hp: 500, fo: .1 }), W(bsb('0360'), { hp: 400, fo: .1 })] },
      // Fast moves (jump, slide, quick turns): a jacket swept through the air (nylon flags shaken, BigSoundBank).
      whoosh: { norm: { short: -28 }, max: .45, variants: ['1788', '1790', '1792', '1794'].map(id => W(bsb(id), { hp: 250, headDb: -18 })) },
      // Sliding: the body on the ground (a wooden chair dragged, dklon; gravel shuffled, BigSoundBank).
      slideHard: { norm: { short: -22 }, max: .8, variants: ['#2', '#5', '#8'].map(k => R(bsb('1107'), k, .75, { hp: 150, lp: 7000, fi: .02, fo: .3 })) },
      slideSoft: { norm: { short: -22 }, max: .8, variants: [R(bsb('1117'), 30, .75, { onset: false, fi: .03, fo: .25 }), R(bsb('1117'), 60, .75, { onset: false, fi: .03, fo: .25 })] },
      // An eliminated soldier hitting the floor with their equipment (BigSoundBank body falls, dklon).
      bodyfall: { norm: { short: -17 }, variants: [...range(2452, 2456).map(i => W(bsb(String(i)), { headDb: -20 })), W('dklon/body_hit_on_ground.wav', { headDb: -20 })] },
      // Respawn: gear settling as a soldier takes position.
      spawn: { norm: { short: -26 }, variants: [{ layers: [W(bsb('0576'), { gain: -6 }), W(bsb('2557'), { hp: 500, offset: .12, gain: -4 })] }] },
    },
  },
};

/** Ambience per map: long beds (looped) and emitters placed in the world. */
export const AMBIENCE = {
  foundry: {
    // Outside: wind across the yard; the industrial district beyond the walls (a metallurgical factory, low-passed by
    // distance); under the sheds: the room tone of a workshop and a heat pump's fans; at the machines: a technical
    // room's pumps; at the lamps: a transformer's hum.
    wind: { loop: 10, xf: 1.2, src: bsb('0154'), at: 12, hp: 120, lp: 5000, short: -34 },
    district: { loop: 12, xf: 1.5, src: bsb('0749'), at: 60, hp: 90, lp: 1500, short: -38 },
    interior: { loop: 5.5, xf: .8, src: bsb('0032'), at: .3, hp: 80, lp: 4000, short: -40 },
    machine: { loop: 6, xf: .8, src: bsb('0504'), at: 10, hp: 70, lp: 6000, short: -30 },
    hum: { loop: 4, xf: .6, src: bsb('2118'), at: 1, hp: 90, lp: 5000, short: -36 },
    oneshots: { creak: [R(bsb('0616'), '#0', 2.2, { fo: .5 }), R(bsb('0616'), '#17', 2.2, { fo: .5 }), R(bsb('0539'), '#2', 2.5, { fo: .5 })], clank: [W(bsb('1772'), { lp: 2500 }), W(bsb('1776'), { lp: 2500 }), W(bsb('0235'), { lp: 2500 })], chain: [W(bsb('0359'), { lp: 4000 })], flag: [R(bsb('1632'), 10, 3.0, { fi: .5, fo: .8 }), R(bsb('1632'), 40, 3.0, { fi: .5, fo: .8 })] },
  },
  // Operation: Metropolis (Okun Bay). Outside: wind between buildings and the city's traffic beyond the block; in
  // shops and halls: air handling; under the street: the tone of a metro corridor; by the quay: gulls over the port;
  // in the rainy variant: rain on concrete. The train is a metro passing, with a horn as it reaches the platforms.
  // The four occasional sounds keep the names the game asks every map for: `creak` is a car passing on the next
  // street, `clank` something dropped in the port, `chain` a car horn a few blocks away, `flag` a bus horn.
  metropolis: {
    wind: { loop: 10, xf: 1.2, src: bsb('0154'), at: 24, hp: 120, lp: 5000, short: -36 },
    district: { loop: 12, xf: 1.5, src: bsb('0608'), at: 8, hp: 90, lp: 3200, short: -36 },
    interior: { loop: 5.5, xf: .8, src: bsb('0032'), at: .3, hp: 80, lp: 4000, short: -42 },
    machine: { loop: 6, xf: .8, src: bsb('1233'), at: 4, hp: 70, lp: 6000, short: -32 },
    hum: { loop: 4, xf: .6, src: bsb('2118'), at: 1.5, hp: 90, lp: 5000, short: -38 },
    station: { loop: 10, xf: 1.2, src: bsb('0093'), at: 6, hp: 70, lp: 5000, short: -36 },
    harbour: { loop: 11, xf: 1.4, src: bsb('2573'), at: 5, hp: 200, lp: 7000, short: -38 },
    rain: { loop: 8, xf: 1, src: bsb('1289'), at: 6, hp: 150, lp: 9000, short: -30 },
    train: { loop: 7, xf: 1, src: bsb('0092'), at: 14, hp: 50, lp: 7000, short: -20 },
    oneshots: { creak: [R(bsb('2987'), 5, 5.5, { onset: false, fi: .8, fo: 1.5, lp: 3000 })], clank: [W(bsb('1772'), { lp: 2500 }), W(bsb('1776'), { lp: 2500 }), W(bsb('0235'), { lp: 2500 })], chain: [R(bsb('0258'), .05, 1.2, { onset: false, lp: 2600, fo: .3 })], flag: [R(bsb('3594'), .05, 1.3, { onset: false, lp: 2400, fo: .4 })], horn: [R(bsb('2847'), .1, 3.2, { onset: false, fo: .6 })] },
  },
  quad: {
    wind: { loop: 10, xf: 1.2, src: bsb('0908'), at: 10, hp: 120, lp: 6000, short: -36 },
    district: { loop: 12, xf: 1.5, src: bsb('0716'), at: 6, hp: 90, lp: 2500, short: -40 },
    interior: { loop: 6, xf: .8, src: bsb('1032'), at: 2, hp: 80, lp: 3500, short: -42 },
    machine: { loop: 6, xf: .8, src: bsb('0957'), at: 2, hp: 70, lp: 5000, short: -34 },
    hum: { loop: 4, xf: .6, src: bsb('2119'), at: 1, hp: 90, lp: 5000, short: -38 },
    oneshots: { creak: [R(bsb('3051'), '#0', .8), R(bsb('3053'), '#0', .8)], clank: [W(bsb('1588'), { lp: 2500 }), W(bsb('1590'), { lp: 2500 })], chain: [W(bsb('0356'), { lp: 4000 })], flag: [R(bsb('1633'), 8, 3.0, { fi: .5, fo: .8 })] },
  },
};

/**
 * Character voices: short, non-verbal reactions by real voice actors, never screams. Each soldier keeps one voice
 * for the match. hurt: a short grunt (light hits use its first part); heavy: a fuller grunt; severe: strained, for
 * a hit that leaves little health; death: the elimination; effort: jumps, landings, throws.
 */
const vb = n => `vbdmg/${pad2(n)}._damage_grunt_male.wav`, ve = n => `vbeff/${pad2(n)}._effort_grunt_male.wav`, hd = n => `haeldb/${n}.wav`, bd = n => `baradari/${n}.wav`;
export const VOICES = {
  mA: { who: 'VoiceBosch (male)', hurt: [4, 9, 14, 15, 16, 18, 2, 13].map(vb), heavy: [1, 3, 5, 6, 7, 11, 12, 17, 19, 20, 21].map(vb), severe: [ve(20), ve(29), ve(35)], death: [vb(8), vb(10), vb(22)], effort: [1, 2, 3, 6, 12, 13, 21, 22, 23, 30, 31, 32].map(ve) },
  mB: { who: 'HaelDB vocalist 1 (male)', hurt: ['1yell1', '1yell2', '1yell7', '1yell9', '1yell15', '1yell16'].map(hd), heavy: ['1yell8', '1yell11', '1yell13', '1yell14', '1yell6'].map(hd), severe: ['1yell10', '1yell12'].map(hd), death: ['1yell3', '1yell5'].map(hd), effort: ['1yell15', '1yell16', '1yell1'].map(hd) },
  mC: { who: 'Michel Baradari (male)', hurt: ['pain1', 'pain3', 'pain6', 'painh', 'paino'].map(bd), heavy: ['pain2', 'pain4', 'pain5'].map(bd), severe: ['pain4', 'pain2'].map(bd), death: ['die1', 'die2', 'deathh'].map(bd), effort: ['pain1', 'painh'].map(bd) },
  mD: { who: 'HaelDB vocalist 3 (male)', hurt: ['3grunt2', '3grunt4', '3grunt5', '3yell3'].map(hd), heavy: ['3grunt1', '3grunt3', '3yell4', '3yell8'].map(hd), severe: ['3grunt6', '3yell11'].map(hd), death: ['3yell5', '3yell7', '3yell12'].map(hd), effort: ['3grunt4', '3grunt2'].map(hd) },
  // AuraVoice: one take of six reactions (cut at their attacks).
  fA: { who: 'AuraVoice (female)', take: 'aura/female_hurt_grunts_groans_1.ogg', cuts: [2.11, 3.73, 4.92, 5.59, 9.40, 11.70], hurt: [2, 3], heavy: [0, 1, 5], severe: [4], death: [4, 1], effort: [2, 3] },
};
/** Exertion breathing (loops) per body: BigSoundBank's breathless man and woman. */
export const BREATH = { m: { src: bsb('1103'), at: 2, loop: 6.5, xf: .8 }, f: { src: bsb('1345'), at: 6, loop: 6.5, xf: .8 } };
