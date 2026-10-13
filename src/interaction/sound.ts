import { player, useGame } from '../state';

// Small synthesized foley for interactions: no audio files, nothing fetched. Every sound respects the
// player's volume setting (silent by default) and fades with distance from the listener.
let ctx: AudioContext | null = null, noise: AudioBuffer | null = null;
function audio() {
  const volume = useGame.getState().volume;
  if (!volume) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate * .5, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return { ctx, volume };
  } catch { return null; }
}

function tone(c: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + .005); g.gain.exponentialRampToValueAtTime(.0005, t0 + dur);
  o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + .02);
}
function hiss(c: AudioContext, out: AudioNode, t0: number, dur: number, peak: number, freq: number, q = 1) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + .01); g.gain.exponentialRampToValueAtTime(.0005, t0 + dur);
  s.connect(f).connect(g).connect(out); s.start(t0); s.stop(t0 + dur + .02);
}

export type Sfx = 'bounce' | 'rim' | 'board' | 'swish' | 'door-open' | 'door-close' | 'locked' | 'sit' | 'pickup' | 'shot' | 'deny';
/** Play an interaction sound, optionally at a world position (quieter further from the player). */
export function sfx(kind: Sfx, at?: { x: number; z: number }, strength = 1) {
  const a = audio(); if (!a) return;
  const { ctx: c, volume } = a, t = c.currentTime;
  const d = at ? Math.hypot(at.x - player.x, at.z - player.z) : 0;
  if (d > 40) return;
  const out = c.createGain(); out.gain.value = volume * .35 * Math.min(1.4, strength) / (1 + d / 7); out.connect(c.destination);
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
