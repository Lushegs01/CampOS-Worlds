import { player } from '../state';
import { audio as mixer, play } from '../audio/mixer';

// Interaction sounds. Doors use recordings (src/audio, public/assets/audio) once loaded; the ball, the
// hoop and the interface are synthesized here, nothing fetched. All share the game's one AudioContext and
// its volume (Settings), and fade with distance from the player.
let white: AudioBuffer | null = null;
function audio() {
  const m = mixer(); if (!m) return null;
  const ctx = m.ctx;
  if (!white) { white = ctx.createBuffer(1, ctx.sampleRate * .5, ctx.sampleRate); const d = white.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return { ctx, out: m.effects, ui: m.master };
}

function tone(c: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + .005); g.gain.exponentialRampToValueAtTime(.0005, t0 + dur);
  o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + .02);
}
function hiss(c: AudioContext, out: AudioNode, t0: number, dur: number, peak: number, freq: number, q = 1) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = white; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + .01); g.gain.exponentialRampToValueAtTime(.0005, t0 + dur);
  s.connect(f).connect(g).connect(out); s.start(t0); s.stop(t0 + dur + .02);
}

/** The discovery chime for notices. Uses the shared context: a new AudioContext per notice ran into the
 * browser's limit on contexts and, on phones, started suspended (silent). */
export function chime() {
  const a = audio(); if (!a) return;
  const { ctx: c, ui } = a, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(523, t); o.frequency.exponentialRampToValueAtTime(784, t + .16);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.09, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .38);
  o.connect(g).connect(ui); o.start(t); o.stop(t + .4); o.onended = () => g.disconnect();
}

export type Sfx = 'bounce' | 'rim' | 'board' | 'swish' | 'door-open' | 'door-close' | 'locked' | 'sit' | 'pickup' | 'shot' | 'deny';
/** Play an interaction sound, optionally at a world position (quieter further from the player). */
export function sfx(kind: Sfx, at?: { x: number; z: number; glass?: boolean }, strength = 1) {
  const a = audio(); if (!a) return;
  if (recorded(kind, at)) return;
  const { ctx: c } = a, t = c.currentTime;
  const d = at ? Math.hypot(at.x - player.x, at.z - player.z) : 0;
  if (d > 40) return;
  const out = c.createGain(); out.gain.value = .35 * Math.min(1.4, strength) / (1 + d / 7); out.connect(a.out);
  switch (kind) {
    case 'bounce': tone(c, out, 'sine', 150, 55, t, .16, .9); hiss(c, out, t, .05, .25, 900); break;
    case 'rim': tone(c, out, 'triangle', 1180, 1100, t, .5, .35); tone(c, out, 'sine', 2730, 2700, t, .3, .12); tone(c, out, 'sine', 520, 500, t, .25, .2); break;
    case 'board': tone(c, out, 'sine', 210, 120, t, .18, .7); hiss(c, out, t, .06, .3, 1600); break;
    case 'swish': hiss(c, out, t, .32, .45, 4200, .7); break;
    case 'door-open': hiss(c, out, t, .45, .12, 380, 3); tone(c, out, 'sine', 95, 70, t, .2, .25); break;
    case 'door-close': tone(c, out, 'sine', 120, 50, t, .22, .8); hiss(c, out, t, .05, .3, 2400); break;
    case 'locked': for (let i = 0; i < 3; i++) { hiss(c, out, t + i * .09, .05, .35, 3200, 4); tone(c, out, 'square', 900, 700, t + i * .09, .03, .05); } break;
    case 'sit': hiss(c, out, t, .3, .18, 700, .8); tone(c, out, 'sine', 90, 60, t + .05, .15, .3); break;
    case 'pickup': hiss(c, out, t, .12, .2, 1200, .9); tone(c, out, 'sine', 180, 120, t, .1, .3); break;
    case 'shot': hiss(c, out, t, .18, .15, 900, .7); break;
    case 'deny': tone(c, out, 'sine', 330, 247, t, .22, .25); break;
  }
  setTimeout(() => out.disconnect(), 1200);
}

/**
 * Doors from recordings, heard from where the door is: the handle and the swing when it opens, the leaf
 * meeting the frame and the latch when it shuts (glass doors ring a little), a rattled handle when locked.
 * False while the recordings are still loading (the synthesized versions above play instead).
 */
function recorded(kind: Sfx, at?: { x: number; z: number; glass?: boolean }) {
  if (!at) return false;
  const o = { at: { x: at.x, y: 1.1, z: at.z }, range: 35 };
  if (kind === 'door-open') return play('door-latch', { ...o, gain: .45 }) && play('door-open', { ...o, gain: at.glass ? .45 : .7, delay: .05, rate: at.glass ? 1.15 : 1 });
  if (kind === 'door-close') return play('door-close', { ...o, gain: at.glass ? .6 : .85 }) && (!at.glass || play('glass', { ...o, gain: .35, delay: .01 }));
  if (kind === 'locked') return play('door-latch', { ...o, gain: .7 }) && play('door-latch', { ...o, gain: .6, delay: .16, rate: 1.1 }) && play('door-latch', { ...o, gain: .5, delay: .3 });
  return false;
}
