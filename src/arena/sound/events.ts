// The arena's sound events, as data: which bus, how loud, how important, how far it carries, how much it varies.
// src/arena/audio.ts plays sounds through these definitions, so the mix of the whole game is tuned here.
//
// Levels are relative to the banks' normalisation (scripts/assets/arena-audio/recipes.mjs: footsteps walk −21,
// run −17 dB short-term; gunshot bodies peak −1.5 dBFS …). Priorities 0–100 decide what survives when the voice
// budget is full: the player's own gunfire, explosions and enemies' footsteps rank high (they are information),
// decoration (casings, distant creaks) low. `vary`: [playback-rate ± fraction, level ± dB], drawn from a triangular
// distribution — small differences, like the same action repeated.
import type { Category, PlayOptions } from './engine';

export interface EventDef extends Omit<PlayOptions, 'at' | 'delay' | 'emitter' | 'variant' | 'tag' | 'peakAt' | 'key'> { cat: Category }
const E = <T extends Record<string, EventDef>>(t: T) => t;

export const EV = E({
  // ---------------------------------------------------------------- weapons: the player's own
  shotOwn: { cat: 'weapons', gain: .58, priority: 100, group: 'shot', vary: [.012, .7], perEmitter: 3, send: .06, direct: true },
  tailOwn: { cat: 'weapons', gain: .62, priority: 62, group: 'tail', perEmitter: 1, send: .02, direct: true },
  mechOwn: { cat: 'weapons', gain: .62, priority: 66, group: 'mech', vary: [.018, .8], direct: true },
  dryOwn: { cat: 'weapons', gain: .7, priority: 70, group: 'mech', vary: [.02, .6], direct: true },
  handlingOwn: { cat: 'weapons', gain: .5, priority: 40, group: 'foley', vary: [.03, 1], direct: true },
  // ---------------------------------------------------------------- weapons: other players (layered by distance)
  shotNear: { cat: 'weapons', gain: .72, priority: 88, group: 'shot', ref: 5, rolloff: .9, vary: [.015, .8], perEmitter: 2, send: .07 },
  tailNear: { cat: 'weapons', gain: .7, priority: 56, group: 'tail', ref: 6, rolloff: .7, perEmitter: 1, send: .02 },
  shotMid: { cat: 'weapons', gain: .95, priority: 78, group: 'far', ref: 22, rolloff: .55, perEmitter: 1, send: .05, vary: [.01, .5] },
  shotFar: { cat: 'weapons', gain: .9, priority: 72, group: 'far', ref: 45, rolloff: .4, perEmitter: 1, send: .03, vary: [.01, .5] },
  mechRemote: { cat: 'weapons', gain: .8, priority: 52, group: 'mech', ref: 2, rolloff: 1.3, range: 20, vary: [.02, .8] },
  flyby: { cat: 'weapons', gain: .55, priority: 90, group: 'flyby', ref: 1, rolloff: .5, direct: true },
  // ---------------------------------------------------------------- bullets, casings, magazines
  impact: { cat: 'explosions', gain: .55, priority: 36, group: 'impact', ref: 3, rolloff: 1.2, range: 60, vary: [.05, 1.5], send: .05 },
  ricochet: { cat: 'explosions', gain: .5, priority: 40, group: 'impact', ref: 3, rolloff: 1, range: 60, vary: [.06, 1.5] },
  bodyHit: { cat: 'character', gain: .7, priority: 74, group: 'body', ref: 3, rolloff: 1.1, range: 60, vary: [.04, 1.2] },
  bodyHitOwn: { cat: 'character', gain: .62, priority: 92, group: 'body', ref: 1, rolloff: 1, direct: true, vary: [.04, 1] },
  casing: { cat: 'environment', gain: .35, priority: 10, group: 'casing', ref: 1.5, rolloff: 1.4, range: 8, vary: [.08, 2] },
  casingOwn: { cat: 'environment', gain: .42, priority: 12, group: 'casing', direct: true, vary: [.08, 2] },
  magDrop: { cat: 'environment', gain: .55, priority: 30, group: 'casing', ref: 2, rolloff: 1.3, range: 14, vary: [.05, 1.5] },
  // ---------------------------------------------------------------- movement
  stepOwn: { cat: 'footsteps', gain: .5, priority: 35, group: 'step', vary: [.03, 1.2], direct: true },
  stepEnemy: { cat: 'footsteps', gain: .85, priority: 76, group: 'step', ref: 3, rolloff: 1.15, range: 34, vary: [.03, 1.2] },
  stepFriend: { cat: 'footsteps', gain: .65, priority: 40, group: 'step', ref: 3, rolloff: 1.3, range: 24, vary: [.03, 1.2] },
  foleyOwn: { cat: 'footsteps', gain: .45, priority: 18, group: 'foley', vary: [.04, 1.5], direct: true },
  foleyRemote: { cat: 'footsteps', gain: .55, priority: 22, group: 'foley', ref: 2, rolloff: 1.5, range: 12, vary: [.04, 1.5] },
  landOwn: { cat: 'footsteps', gain: .62, priority: 48, group: 'step', direct: true, vary: [.03, 1] },
  landRemote: { cat: 'footsteps', gain: .85, priority: 70, group: 'step', ref: 3, rolloff: 1.15, range: 34, vary: [.03, 1] },
  slideOwn: { cat: 'footsteps', gain: .55, priority: 46, group: 'foley', direct: true, vary: [.03, 1] },
  slideRemote: { cat: 'footsteps', gain: .75, priority: 64, group: 'foley', ref: 3, rolloff: 1.2, range: 28, vary: [.03, 1] },
  // ---------------------------------------------------------------- characters
  voiceOwn: { cat: 'character', gain: .4, priority: 70, group: 'character', direct: true, vary: [.025, 1] },
  voiceRemote: { cat: 'character', gain: .72, priority: 68, group: 'character', ref: 3, rolloff: 1.1, range: 40, vary: [.025, 1] },
  bodyfall: { cat: 'character', gain: .65, priority: 50, group: 'body', ref: 3, rolloff: 1.2, range: 40, vary: [.04, 1] },
  // ---------------------------------------------------------------- explosives
  blastNear: { cat: 'explosions', gain: .95, priority: 96, group: 'explosions', ref: 6, rolloff: .8, send: .12, vary: [.03, .8] },
  blastMid: { cat: 'explosions', gain: .9, priority: 90, group: 'explosions', ref: 25, rolloff: .55, send: .06, vary: [.03, .8] },
  blastFar: { cat: 'explosions', gain: .85, priority: 85, group: 'explosions', ref: 50, rolloff: .4, send: .03, vary: [.03, .8] },
  debris: { cat: 'explosions', gain: .5, priority: 40, group: 'impact', ref: 6, rolloff: 1, range: 45, vary: [.05, 1.5] },
  flashBang: { cat: 'explosions', gain: .95, priority: 94, group: 'explosions', ref: 5, rolloff: .8, send: .1 },
  gadget: { cat: 'explosions', gain: .6, priority: 60, group: 'explosions', ref: 3, rolloff: 1.1, range: 35, vary: [.04, 1] },
  bounce: { cat: 'explosions', gain: .55, priority: 62, group: 'impact', ref: 2.5, rolloff: 1.2, range: 30, vary: [.08, 2] },
  throwOwn: { cat: 'character', gain: .55, priority: 50, group: 'foley', direct: true, vary: [.04, 1] },
  // ---------------------------------------------------------------- interface and announcements
  ui: { cat: 'ui', gain: .9, priority: 90, group: 'ui', direct: true },
  hitMarker: { cat: 'ui', gain: .85, priority: 95, group: 'ui', direct: true, vary: [.02, .5] },
  announcer: { cat: 'voice', gain: .9, priority: 98, group: 'voice', direct: true },
  // ---------------------------------------------------------------- surroundings
  ambientOneShot: { cat: 'environment', gain: .5, priority: 8, group: 'environment', ref: 8, rolloff: .9, range: 80, send: .1, vary: [.04, 2] },
});
export type EventName = keyof typeof EV;
