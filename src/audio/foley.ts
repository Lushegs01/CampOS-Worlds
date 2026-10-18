import { audio, noise, output, play, type At } from './mixer';
import { surfaceAt, type Surface } from './surface';

// People: footsteps on what is underfoot, jumps and landings, sitting down and standing up. Your own
// sounds are centred; everyone else's come from where they are. `at` is null for your own character.

const STEP: Record<Surface, string> = { hard: 'step-hard', grass: 'step-grass', wood: 'step-wood' };
// Grass is soft underfoot; timber floors carry.
const STEP_GAIN: Record<Surface, number> = { hard: .55, grass: .75, wood: .7 };

/** One foot touching down while walking (speed in m/s: louder and brighter when running). */
export function footstep(x: number, z: number, speed: number, at: At | null) {
  const surface = surfaceAt(x, z), pace = Math.min(1, speed / 5.5);
  play(STEP[surface], { at: at ?? undefined, gain: STEP_GAIN[surface] * (.45 + .55 * pace) * (at ? 1.3 : .85), rate: .95 + pace * .12, range: 22 });
}
/** Pushing off for a jump: a short scuff. */
export function jump(x: number, z: number, at: At | null) {
  play(STEP[surfaceAt(x, z)], { at: at ?? undefined, gain: at ? .7 : .45, rate: 1.1, range: 22 });
}
/** Both feet landing, a beat apart, with the body's weight behind them. */
export function land(x: number, z: number, at: At | null) {
  const surface = surfaceAt(x, z), o = { at: at ?? undefined, range: 22 };
  play(STEP[surface], { ...o, gain: STEP_GAIN[surface] * 1.4, rate: .9 });
  play(STEP[surface], { ...o, gain: STEP_GAIN[surface] * 1.1, rate: .95, delay: .045 });
  play('seat-soft', { ...o, gain: .35, rate: .8 });
}

type SeatKind = { kind: string; model?: string; table?: boolean };
/** Sitting down: clothes moving, then (as the weight arrives) the seat itself: a timber bench, a school chair or a plastic one. */
export function sitDown(seat: SeatKind, at: At, settle: number) {
  const o = { at, range: 20, ref: 1.5 };
  play('cloth', { ...o, gain: .5 });
  play('seat-soft', { ...o, gain: .6, delay: settle });
  if (seat.kind === 'bench') { play('seat-wood', { ...o, gain: .45, delay: settle }); play('creak', { ...o, gain: .35, delay: settle + .05 }); }
  else if (seat.model === 'monobloc') play('seat-plastic', { ...o, gain: .5, delay: settle });
  else play('seat-wood', { ...o, gain: .5, delay: settle });
}
/** Standing up: clothes, and a bench lets go of its load. */
export function standUp(seat: SeatKind, at: At, delay = 0) {
  const o = { at, range: 20, ref: 1.5 };
  play('cloth', { ...o, gain: .45, delay });
  if (seat.kind === 'bench') play('creak', { ...o, gain: .3, delay: delay + .25 });
}

/** A chair's legs dragged across the floor (scooting in or pushing back from a table). */
export function chairScrape(at: At, seconds: number, plastic: boolean) {
  const m = audio(); if (!m) return;
  const c = m.ctx, t = c.currentTime, src = c.createBufferSource(), band = c.createBiquadFilter(), stick = c.createGain(), g = c.createGain(), judder = c.createOscillator(), depth = c.createGain();
  src.buffer = noise(c); src.loop = true; src.playbackRate.value = plastic ? 1.6 : 1.1;
  band.type = 'bandpass'; band.Q.value = 2.5; band.frequency.setValueAtTime(plastic ? 1700 : 900, t); band.frequency.linearRampToValueAtTime(plastic ? 2300 : 1200, t + seconds);
  // Stick-slip: the legs catch and release about 30 times a second (0.3–1 of the level), inside the envelope.
  judder.frequency.value = 28 + Math.random() * 8; stick.gain.value = .65; depth.gain.value = .35; judder.connect(depth).connect(stick.gain);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.55, t + .05); g.gain.setValueAtTime(.55, t + seconds - .08); g.gain.linearRampToValueAtTime(0, t + seconds);
  src.connect(band).connect(stick).connect(g).connect(output(m, at, 1.5));
  src.start(t); judder.start(t); src.stop(t + seconds + .05); judder.stop(t + seconds + .05);
}
