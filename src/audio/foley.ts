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
  if (seat.kind === 'bench') play('seat-wood', { ...o, gain: .45, delay: settle });
  else if (seat.model === 'monobloc') play('seat-plastic', { ...o, gain: .5, delay: settle });
  else play('seat-wood', { ...o, gain: .5, delay: settle });
}
/** Standing up: clothes moving. */
export function standUp(at: At, delay = 0) {
  play('cloth', { at, range: 20, ref: 1.5, gain: .45, delay });
}

/**
 * A chair's legs dragged across the floor (scooting in or pushing back from a table): a dull, low drag. It was
 * a resonant band sweeping up through 0.9-2.3 kHz, which with the stick-slip judder read as a squeak. (The
 * lowpass lets through far more of the noise's low end, so the level is lower for the same loudness.)
 */
export function chairScrape(at: At, seconds: number, plastic: boolean) {
  const m = audio(); if (!m) return;
  const c = m.ctx, t = c.currentTime, src = c.createBufferSource(), dull = c.createBiquadFilter(), stick = c.createGain(), g = c.createGain(), judder = c.createOscillator(), depth = c.createGain();
  src.buffer = noise(c); src.loop = true; src.playbackRate.value = plastic ? 1.6 : 1.1;
  dull.type = 'lowpass'; dull.Q.value = 0; dull.frequency.value = plastic ? 900 : 700;
  // Stick-slip: the legs catch and release about 30 times a second (0.3–1 of the level), inside the envelope.
  judder.frequency.value = 28 + Math.random() * 8; stick.gain.value = .65; depth.gain.value = .35; judder.connect(depth).connect(stick.gain);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.3, t + .05); g.gain.setValueAtTime(.3, t + seconds - .08); g.gain.linearRampToValueAtTime(0, t + seconds);
  src.connect(dull).connect(stick).connect(g).connect(output(m, at, 1.5));
  src.start(t); judder.start(t); src.stop(t + seconds + .05); judder.stop(t + seconds + .05);
}
