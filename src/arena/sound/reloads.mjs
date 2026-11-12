// Reloads and actions as timelines shared by the first-person animation (src/arena/Scene.tsx updateViewmodel) and
// the sound (src/arena/audio.ts, `actions`): one table says when the magazine leaves the weapon, when the new one goes
// in, when the action is worked — the animation moves the parts at those times and the sound plays each part's cue
// at the same moment. Times are fractions of the reload (0 = start, 1 = done), so the plan follows the simulation's
// own timer (shared/arena/sim.mjs) whatever the frame rate, and a cancelled reload simply stops reaching its later
// cues.
//
// Tactical reloads (a round still chambered) keep the old magazine (stowed in a pouch) and do not work the action;
// reloads from empty drop the old magazine to the ground and then chamber a round (bolt catch, charging handle,
// slide release or bolt) — each weapon the way its real mechanism works.

/**
 * @typedef {[number, string]} Cue  [time 0–1, cue name] — a weapon bank sound (magOut, magIn, chargeBack …) or a
 *   shared one: grab (hand to the magazine), pouch (a magazine from or into a pouch), settle (the weapon settling),
 *   magDrop (the discarded magazine hits the ground), cases (a revolver's spent cases falling).
 * @typedef {{ tilt: number[], out: number[]|null, in: number[]|null, hand: number[], seat: number|null, rack: number[]|null, cyl?: number[], cues: Cue[] }} ReloadPlan
 *   tilt: the weapon turned for the reload [in start, in end, out start, out end]; out: the magazine leaving
 *   [start, end]; in: the new magazine travelling into the well; hand: the support hand to the magazine and back;
 *   seat: the tap that seats the magazine; rack: the action worked [start, end]; cyl: a revolver's cylinder open.
 */

const BASE = { tilt: [0, .14, .86, 1], out: [.14, .34], in: [.46, .66], hand: [.06, .18, .7, .8], seat: .66 };
/** A detachable-magazine reload. `chamber`: the empty reload's chambering cues. */
function mag(tactical, empty, chamber, keys = {}) {
  return {
    tactical: { ...BASE, ...keys, rack: null, cues: tactical },
    empty: { ...BASE, ...keys, rack: keys.rack ?? [.8, .94], cues: [...empty, ...chamber] },
  };
}
/** The common rifle/SMG sequence: release, magazine out, new magazine from a pouch, in, seated. */
const rifle = (release = .12, out = .15, stow = .3, magIn = .56, seat = .66) => ({
  tactical: [[.03, 'grab'], [release, 'magRelease'], [out, 'magOut'], [stow, 'pouch'], [magIn, 'magIn'], [seat, 'magSeat'], [.86, 'settle']],
  empty: [[.03, 'grab'], [release, 'magRelease'], [out, 'magOut'], [.32, 'magDrop'], [.36, 'pouch'], [magIn, 'magIn'], [seat, 'magSeat']],
});

export const RELOADS = {
  // M7: retain the chambered round; release the locked bolt only after an empty reload.
  m7: (() => { const r = rifle(.13, .18, .34, .59, .69); return mag(r.tactical, r.empty, [[.84, 'boltRelease'], [.95, 'settle']], { out: [.18, .36], in: [.48, .69], seat: .69 }); })(),
  // AR-15: magazine catch, the magazine slides out; from empty the bolt is locked back, so the bolt catch releases it.
  vanguard: (() => { const r = rifle(.12, .15, .3, .57, .66); return mag(r.tactical, r.empty, [[.82, 'boltRelease'], [.93, 'settle']]); })(),
  // AK-pattern: the paddle released and the magazine rocked out and in; the charging handle pulled and let go.
  halcyon: (() => { const r = rifle(.11, .14, .3, .56, .66); return mag(r.tactical, r.empty, [[.81, 'chargeBack'], [.88, 'chargeFwd'], [.95, 'settle']]); })(),
  // SMGs: the cocking handle pulled back to its notch and slapped home.
  wasp: (() => { const r = rifle(.12, .15, .32, .55, .66); return mag(r.tactical, r.empty, [[.81, 'chargeBack'], [.88, 'chargeFwd']]); })(),
  kestrel: (() => { const r = rifle(.12, .15, .32, .55, .66); return mag(r.tactical, r.empty, [[.81, 'chargeBack'], [.88, 'chargeFwd']]); })(),
  // Semi-automatic shotgun with a box magazine: the Browning-style charging handle.
  rampart: (() => { const r = rifle(.12, .16, .32, .55, .66); return mag(r.tactical, r.empty, [[.81, 'chargeBack'], [.88, 'chargeFwd'], [.95, 'settle']]); })(),
  // Bolt-action rifle: from empty the bolt is lifted, drawn back, pushed forward and turned down.
  longbow: (() => { const r = rifle(.12, .15, .3, .56, .66); return mag(r.tactical, r.empty, [[.8, 'boltLift'], [.83, 'boltBack'], [.88, 'boltFwd'], [.92, 'boltDown']]); })(),
  talon: (() => { const r = rifle(.12, .15, .3, .56, .66); return mag(r.tactical, r.empty, [[.81, 'chargeBack'], [.88, 'chargeFwd'], [.95, 'settle']]); })(),
  // Belt-fed machine gun: feed cover up, the box out and a new one in, the belt laid on the tray, cover slammed;
  // from empty, the bolt charged.
  anvil: mag(
    [[.02, 'grab'], [.08, 'coverOpen'], [.16, 'magRelease'], [.19, 'magOut'], [.3, 'pouch'], [.45, 'magIn'], [.54, 'magSeat'], [.6, 'belt'], [.7, 'coverClose'], [.8, 'settle']],
    [[.02, 'grab'], [.08, 'coverOpen'], [.16, 'magRelease'], [.19, 'magOut'], [.36, 'magDrop'], [.45, 'magIn'], [.54, 'magSeat'], [.6, 'belt'], [.7, 'coverClose']],
    [[.87, 'chargeBack'], [.92, 'chargeFwd']],
    { tilt: [0, .08, .9, 1], out: [.18, .32], in: [.4, .54], hand: [.05, .14, .76, .84], seat: .54, rack: [.86, .95] }),
  // Pistol: magazine dropped free, a new one in; from empty the slide stop releases the slide.
  sparrow: mag(
    [[.12, 'magRelease'], [.14, 'magOut'], [.3, 'pouch'], [.53, 'magIn'], [.64, 'magSeat'], [.84, 'settle']],
    [[.12, 'magRelease'], [.14, 'magOut'], [.36, 'magDrop'], [.38, 'pouch'], [.54, 'magIn'], [.64, 'magSeat']],
    [[.84, 'slideDrop']], { seat: .64 }),
  // Revolver: the latch, the cylinder swung out, the ejector rod pushed (spent cases fall), a speed-loader, closed.
  thorn: (() => {
    const plan = { ...BASE, out: null, in: null, seat: null, rack: null, cyl: [.1, .8], cues: [[.03, 'grab'], [.1, 'cylOpen'], [.2, 'eject'], [.3, 'cases'], [.44, 'pouch'], [.56, 'speedload'], [.79, 'cylClose'], [.9, 'settle']] };
    return { tactical: plan, empty: plan };
  })(),
};

/** The plan for a reload of `weapon` (tactical or from empty), or null (shell-by-shell or melee). */
export function reloadPlan(weapon, empty) { const r = RELOADS[weapon]; return r ? (empty ? r.empty : r.tactical) : null; }

/**
 * Shell-by-shell reloads (the pump gun): the first part lifts the gun and reaches for a shell; then each shell is
 * taken from the carrier and pushed through the loading gate. `u` is the progress through one shell (0–1).
 */
export const SHELL = { start: [[.15, 'grab']], each: [[.12, 'shellGrab'], [.55, 'shellIn']] };

/**
 * Actions worked between shots, as fractions of the time between shots (the weapon's cooldown): the pump's stroke
 * and the bolt's four movements, with the spent case thrown out at the back of the stroke. The first-person
 * animation draws the same stroke (Scene.tsx: pump from 0.12, bolt from 0.15).
 */
export const CYCLES = {
  bastion: [[.12, 'pumpBack'], [.3, 'case'], [.37, 'pumpFwd']],
  longbow: [[.15, 'boltLift'], [.2, 'boltBack'], [.38, 'case'], [.43, 'boltFwd'], [.62, 'boltDown']],
};

/** Cues whose time lies in (from, to] — what a timeline crossed since the last frame (none when going backwards). */
export function crossed(cues, from, to) {
  if (!(to > from)) return [];
  const out = []; for (const c of cues) if (c[0] > from && c[0] <= to) out.push(c); return out;
}
