// Combat Arena sound: every sound is synthesised here (filtered noise and tones shaped by envelopes),
// so there are no recordings to license or download. Sounds go through the game's mixer (Settings →
// Sound sets the volume; 0 turns sound off) and world sounds are positioned around the listener.
import { audio } from '../audio/mixer';

type Ctx = AudioContext;
const cache = new Map<string, AudioBuffer>();
let lastCtx: Ctx | null = null;

function noise(ctx: Ctx, seconds: number, shape: (t: number, i: number) => number, color = 0) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0, seed = 1234567;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = seed / 0x3fffffff - 1;
    last = color ? last + (white - last) * (1 - color) : white; // simple low-pass for darker noise
    d[i] = last * shape(i / ctx.sampleRate, i);
  }
  return buf;
}
const env = (attack: number, decay: number) => (t: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** Each weapon class's report: a sharp transient, a body and a tail, all distinct. */
const GUNS: Record<string, { len: number; crack: number; body: number; color: number; tone?: number }> = {
  rifle: { len: .32, crack: .004, body: .06, color: .55, tone: 110 },
  burst: { len: .28, crack: .003, body: .05, color: .5, tone: 130 },
  smg: { len: .2, crack: .003, body: .035, color: .45, tone: 160 },
  shotgun: { len: .55, crack: .006, body: .14, color: .72, tone: 70 },
  sniper: { len: .9, crack: .005, body: .2, color: .7, tone: 60 },
  dmr: { len: .5, crack: .004, body: .1, color: .62, tone: 85 },
  lmg: { len: .34, crack: .004, body: .07, color: .6, tone: 95 },
  pistol: { len: .22, crack: .003, body: .04, color: .4, tone: 180 },
  magnum: { len: .5, crack: .004, body: .11, color: .6, tone: 90 },
};
function buffer(name: string): AudioBuffer | null {
  const m = audio(); if (!m) return null;
  if (lastCtx !== m.ctx) { cache.clear(); lastCtx = m.ctx; }
  const hit = cache.get(name); if (hit) return hit;
  const ctx = m.ctx; let b: AudioBuffer;
  const g = GUNS[name];
  if (g) b = noise(ctx, g.len, t => .9 * env(.0008, g.crack)(t) + .55 * env(.002, g.body)(t) + (g.tone ? .25 * Math.sin(t * g.tone * 6.283) * env(.001, g.body * 1.4)(t) : 0), g.color);
  else switch (name) {
    case 'click': b = noise(ctx, .05, env(.0005, .008), .2); break;
    case 'mag': b = noise(ctx, .12, t => env(.001, .02)(t) + .6 * env(.001, .015)(Math.max(0, t - .06)) * (t > .06 ? 1 : 0), .5); break;
    case 'swing': b = noise(ctx, .25, t => Math.sin(Math.PI * Math.min(1, t / .25)) * .6, .8); break;
    case 'step': b = noise(ctx, .09, env(.004, .025), .85); break;
    case 'land': b = noise(ctx, .18, env(.004, .05), .9); break;
    case 'boom': b = noise(ctx, 1.6, t => env(.004, .35)(t) * (1 + .4 * Math.sin(t * 38)), .93); break;
    case 'thud': b = noise(ctx, .3, env(.002, .07), .92); break;
    case 'hiss': b = noise(ctx, 1.2, t => Math.min(1, t * 6) * Math.exp(-t * 1.6) * .5, .1); break;
    default: b = noise(ctx, .05, env(.001, .01));
  }
  cache.set(name, b);
  return b;
}

/** Play a buffer, optionally at a world position (relative to the listener set by the scene). */
export function play(name: string, opts: { at?: [number, number, number]; gain?: number; rate?: number; delay?: number } = {}) {
  const m = audio(); const b = buffer(name); if (!m || !b) return;
  const src = m.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = opts.rate ?? (0.94 + Math.random() * .12);
  const gain = m.ctx.createGain(); gain.gain.value = opts.gain ?? 1;
  let node: AudioNode = src.connect(gain);
  if (opts.at) {
    const p = m.ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 150;
    p.positionX.value = opts.at[0]; p.positionY.value = opts.at[1]; p.positionZ.value = opts.at[2];
    node = node.connect(p);
  }
  node.connect(m.effects);
  src.start(m.ctx.currentTime + (opts.delay ?? 0));
}
/** A short tone sequence (interface cues: hit markers, captures, rewards, countdown). */
export function tones(notes: [number, number, number?][], gain = .18, type: OscillatorType = 'triangle') {
  const m = audio(); if (!m) return;
  const t0 = m.ctx.currentTime;
  for (const [freq, at, len = .09] of notes) {
    const o = m.ctx.createOscillator(), g = m.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(gain, t0 + at + .005); g.gain.exponentialRampToValueAtTime(.0001, t0 + at + len);
    o.connect(g).connect(m.effects); o.start(t0 + at); o.stop(t0 + at + len + .02);
  }
}
export const sfx = {
  gun: (sound: string, at?: [number, number, number]) => play(sound, { at, gain: at ? .9 : .55 }),
  hit: () => tones([[1900, 0, .04]], .12, 'square'),
  headshot: () => tones([[2600, 0, .05], [3400, .03, .08]], .12, 'square'),
  kill: () => tones([[880, 0, .07], [1320, .06, .12]], .16),
  hurt: () => play('thud', { gain: .7, rate: .7 }),
  reload: (empty = false) => { play('mag', { gain: .5 }); play('click', { gain: .45, delay: empty ? .9 : .6 }); },
  switch: () => play('click', { gain: .4, rate: .7 }),
  dry: () => play('click', { gain: .5, rate: 1.4 }),
  swing: (at?: [number, number, number]) => play('swing', { at, gain: .5 }),
  step: (at?: [number, number, number], gain = .25) => play('step', { at, gain }),
  land: () => play('land', { gain: .4 }),
  boom: (at: [number, number, number]) => play('boom', { at, gain: 1.4, rate: .8 + Math.random() * .1 }),
  flash: (at: [number, number, number]) => { play('click', { at, gain: 1, rate: .5 }); tones([[3800, .02, .9]], .05, 'sine'); },
  smoke: (at: [number, number, number]) => play('hiss', { at, gain: .5 }),
  capture: (good: boolean) => tones(good ? [[523, 0], [659, .09], [784, .18, .2]] : [[392, 0], [311, .12, .25]], .14),
  streak: () => tones([[660, 0], [880, .08], [1175, .16, .25]], .15),
  alarm: () => tones([[740, 0, .12], [740, .25, .12], [740, .5, .12], [740, .75, .12]], .1, 'square'),
  beep: (high = false) => tones([[high ? 1240 : 820, 0, .12]], .12, 'sine'),
  victory: () => tones([[523, 0, .3], [659, .12, .3], [784, .24, .3], [1047, .4, .6]], .16),
  defeat: () => tones([[392, 0, .35], [349, .2, .35], [262, .45, .7]], .14),
  ui: () => tones([[1100, 0, .03]], .06, 'sine'),
};
