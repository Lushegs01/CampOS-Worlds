// The arena's audio engine, on the game's shared AudioContext (src/audio/mixer.ts, whose master is the player's
// Volume setting):
//
//   voices ─► category buses (weapons, explosions, environment, footsteps, character, ui; each its own volume)
//          ─► deafen (flashbang low-pass) ─► rumble filter ─► glue compressor ─► brick-wall limiter ─► game master
//        └─► room send ─► one shared convolution reverb (stronger under roofs) ─┘
//
// Voices are pooled: a fixed number of filter/panner chains (fewer on phones) reused for every sound, so a firefight
// allocates only a buffer source and a gain per sound. When every voice is busy, a new sound takes the voice of the
// least important one (by priority, distance and age) or, if it is less important than all of them, is skipped.
// Each category also has its own cap (impacts, footsteps, casings …) so decoration can never crowd out gunfire.
// Distance: an inverse-distance level curve, air absorption (a low-pass that closes with distance), the speed of
// sound (far shots arrive late), occlusion through walls (darker and quieter) and a reverb send for indoor sources.
import { audio, ear, type Mixer } from '../../audio/mixer';
import { render } from './designs';
import { QA_HOOKS } from '../../qa';

export type Category = 'weapons' | 'explosions' | 'environment' | 'footsteps' | 'character' | 'ui';
export const CATEGORIES: Category[] = ['weapons', 'explosions', 'environment', 'footsteps', 'character', 'ui'];
export type Vec3 = [number, number, number];
export interface PlayOptions {
  cat: Category; at?: Vec3; gain?: number; rate?: number; delay?: number;
  /** 0–100: what survives when voices run out (own gunfire 100, an enemy's footsteps 75, a casing 10). */
  priority: number;
  /** Capped group (defaults to the category). */
  group?: string;
  /** Distance curve: full level within `ref` metres, then ref / (ref + rolloff·(d − ref)); nothing beyond `range`. */
  ref?: number; rolloff?: number; range?: number;
  /** Extra low-pass (Hz), on top of air absorption and occlusion. */
  lowpass?: number;
  /** Reverb send 0–1 (added to the indoor amount). */
  send?: number;
  /** Ignore occlusion and the speed of sound (UI, the player's own sounds). */
  direct?: boolean;
  /** A sound with the same key within 30 ms and 2 m is a duplicate (several pellets on one wall). */
  key?: string;
  /**
   * Per-emitter limit: at most `perEmitter` voices of this group for this emitter (one shooter's automatic fire);
   * a new one retriggers the oldest instead of piling up (the overlap would be masked anyway).
   */
  emitter?: string; perEmitter?: number;
}
export interface Probe { occluded: boolean; indoor: number }

const GROUP_CAP: Record<string, number> = { shot: 14, impact: 6, step: 6, casing: 3, mech: 4, explosions: 4, ui: 5, character: 4, environment: 4, flyby: 3, tail: 6, far: 6 };

interface Voice { filter: BiquadFilterNode; panner: PannerNode | null; send: GainNode; out: AudioNode; bus: AudioNode | null; sendBus: AudioNode | null; src: AudioBufferSourceNode | null; gain: GainNode | null; busy: boolean; priority: number; started: number; ends: number; group: string; emitter: string }
interface Engine {
  m: Mixer; ctx: AudioContext; buses: Record<Category, GainNode>; sends: Record<Category, GainNode>; deafen: BiquadFilterNode; reverbIn: GainNode; limiter: DynamicsCompressorNode; spatial: Voice[]; flat: Voice[];
  buffers: Map<string, AudioBuffer>; hrtf: boolean;
}
let engine: Engine | null = null, maxVoices = 32, hrtf = false;
const volumes: Record<Category, number> = { weapons: 1, explosions: 1, environment: 1, footsteps: 1, character: 1, ui: 1 };
let probe: ((at: Vec3) => Probe) | null = null, listenerIndoor = 0;
export const stats = { played: 0, skipped: 0, stolen: 0, deduped: 0, culled: 0, peakVoices: 0, rendered: 0, renderMs: 0, bufferBytes: 0 };

/** Phones get fewer voices and plain stereo panning; desktops more voices and HRTF (front/back, above/below). */
export function configure(opts: { voices: number; hrtf: boolean }) {
  if (engine && (opts.voices !== maxVoices || opts.hrtf !== hrtf)) { teardown(); }
  maxVoices = opts.voices; hrtf = opts.hrtf;
}
export function setVolumes(v: Partial<Record<Category, number>>) {
  Object.assign(volumes, v);
  if (engine) for (const c of CATEGORIES) { engine.buses[c].gain.setTargetAtTime(volumes[c], engine.ctx.currentTime, .05); engine.sends[c].gain.setTargetAtTime(volumes[c], engine.ctx.currentTime, .05); }
}
/** The scene answers "is this point behind a wall from the listener, and under a roof?" (a few ray casts). */
export function setProbe(fn: ((at: Vec3) => Probe) | null) { probe = fn; }
export function setListenerIndoor(amount: number) { listenerIndoor = amount; }

function impulse(ctx: AudioContext, seconds: number) {
  // A small hall: early reflections, then a dense tail that loses its highs as it decays.
  const len = Math.round(ctx.sampleRate * seconds), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let seed = 9001 + ch * 7919, lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const t = i / ctx.sampleRate, white = seed / 0x3fffffff - 1, k = Math.min(.95, .25 + t * 1.6);
      lp += (white - lp) * (1 - k);
      d[i] = lp * Math.exp(-t * 4.2 / seconds) * Math.min(1, t / .004);
    }
    for (const [at, g] of [[.007, .6], [.013, .45], [.021, .35], [.031, .25]]) d[Math.round((at + ch * .0017) * ctx.sampleRate)] += g as number;
  }
  return ir;
}
function voice(ctx: AudioContext, spatial: boolean): Voice {
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000; filter.Q.value = .5;
  // The reverb send goes through its category's send level (connected at play time), so category volume applies to it too.
  const send = ctx.createGain(); send.gain.value = 0; filter.connect(send);
  let panner: PannerNode | null = null, out: AudioNode = filter;
  if (spatial) {
    panner = ctx.createPanner(); panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
    // Level is computed by the engine (its own curve), so the panner only places the sound.
    panner.distanceModel = 'inverse'; panner.refDistance = 1; panner.rolloffFactor = 0;
    filter.connect(panner); out = panner;
  }
  return { filter, panner, send, out, bus: null, sendBus: null, src: null, gain: null, busy: false, priority: 0, started: 0, ends: 0, group: '', emitter: '' };
}
function build(): Engine | null {
  const m = audio(); if (!m) return null;
  if (engine?.ctx === m.ctx) return engine;
  const ctx = m.ctx;
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .09;
  const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 2.6; glue.attack.value = .006; glue.release.value = .22;
  const rumble = ctx.createBiquadFilter(); rumble.type = 'highpass'; rumble.frequency.value = 28; rumble.Q.value = .6;
  const deafen = ctx.createBiquadFilter(); deafen.type = 'lowpass'; deafen.frequency.value = 20000; deafen.Q.value = .5;
  deafen.connect(rumble).connect(glue).connect(limiter).connect(m.effects);
  const buses = Object.fromEntries(CATEGORIES.map(c => { const g = ctx.createGain(); g.gain.value = volumes[c]; g.connect(c === 'ui' ? rumble : deafen); return [c, g]; })) as Record<Category, GainNode>;
  const reverbIn = ctx.createGain(); reverbIn.gain.value = 1;
  const sends = Object.fromEntries(CATEGORIES.map(c => { const g = ctx.createGain(); g.gain.value = volumes[c]; g.connect(reverbIn); return [c, g]; })) as Record<Category, GainNode>;
  try { const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, maxVoices <= 20 ? .75 : 1.15); const wet = ctx.createGain(); wet.gain.value = .55; reverbIn.connect(conv).connect(wet).connect(deafen); } catch { /* no convolution: dry only */ }
  const spatialCount = Math.round(maxVoices * .75);
  engine = { m, ctx, buses, sends, deafen, reverbIn, limiter, spatial: Array.from({ length: spatialCount }, () => voice(ctx, true)), flat: Array.from({ length: maxVoices - spatialCount }, () => voice(ctx, false)), buffers: new Map(), hrtf };
  return engine;
}
function teardown() {
  if (!engine) return;
  for (const v of [...engine.spatial, ...engine.flat]) { try { v.src?.stop(); } catch { /* already stopped */ } v.out.disconnect(); v.filter.disconnect(); v.send.disconnect(); }
  for (const b of [...Object.values(engine.buses), ...Object.values(engine.sends)]) b.disconnect();
  engine.deafen.disconnect(); engine.reverbIn.disconnect(); engine.limiter.disconnect();
  engine = null;
}
/** Leaving the arena: stop everything and release the graph and rendered sounds. */
export function shutdown() { teardown(); recent.length = 0; stats.bufferBytes = 0; }

/** The rendered buffer for a sound name (rendered on first use, then cached for this context). */
export function buffer(name: string): AudioBuffer | null {
  const e = build(); if (!e) return null;
  let b = e.buffers.get(name);
  if (!b) {
    // Layers with nothing above a few kilohertz (outdoor tails, distant fire, distant blasts, smoke) are rendered at
    // half the sample rate: half the memory and rendering time, no audible difference.
    const rate = /^(gun:[a-z]+:(tail|far)|boom:far|hiss)/.test(name) ? Math.round(e.ctx.sampleRate / 2) : e.ctx.sampleRate;
    const t0 = performance.now(), r = render(name, rate); if (!r) return null;
    b = e.ctx.createBuffer(r.channels.length, Math.max(...r.channels.map(c => c.length)), rate);
    r.channels.forEach((c, i) => b!.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    e.buffers.set(name, b); stats.rendered++; stats.renderMs += performance.now() - t0; stats.bufferBytes += b.length * b.numberOfChannels * 4;
  }
  return b;
}
/** Render sounds ahead of need, a few per idle slice (the player's own weapons at deployment). */
export function prepare(names: string[]) {
  const list = [...names];
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 30));
  const step = () => { if (!build()) return; const t = performance.now(); while (list.length && performance.now() - t < 8) buffer(list.shift()!); if (list.length) idle(step, { timeout: 500 }); };
  idle(step, { timeout: 500 });
}

const recent: { key: string; at: Vec3 | undefined; t: number }[] = [];
const distanceGain = (d: number, ref: number, rolloff: number) => (d <= ref ? 1 : ref / (ref + rolloff * (d - ref)));
const busy = (e: Engine, group: string) => { let n = 0; for (const v of e.spatial) if (v.busy && v.group === group) n++; for (const v of e.flat) if (v.busy && v.group === group) n++; return n; };
function claim(e: Engine, spatial: boolean, priority: number, group: string): Voice | null {
  const pool = spatial ? e.spatial : e.flat, now = e.ctx.currentTime;
  for (const v of pool) if (v.busy && now > v.ends + .05) release(v); // a source whose onended never fired
  const free = pool.find(v => !v.busy); if (free) return free;
  // Steal: the least important, oldest voice, if the new sound matters more.
  let victim: Voice | null = null, worst = Infinity;
  for (const v of pool) { const score = v.priority - (now - v.started) * 8; if (score < worst) { worst = score; victim = v; } }
  if (!victim || worst >= priority) return null;
  stop(victim); stats.stolen++;
  void group; return victim;
}
function stop(v: Voice) {
  const t = v.filter.context.currentTime;
  if (v.gain) { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, .006); }
  try { v.src?.stop(t + .03); } catch { /* not started */ }
  if (v.src) v.src.onended = null;
  const g = v.gain, s = v.src; setTimeout(() => { s?.disconnect(); g?.disconnect(); }, 60);
  release(v);
}
function release(v: Voice) { v.busy = false; v.src = null; v.gain = null; }

/** Play a sound. False when it was not played (sound off, out of range, duplicate, no voice to spare). */
export function play(name: string, o: PlayOptions): boolean {
  const e = build(); if (!e || e.ctx.state !== 'running') return false;
  const group = o.group ?? o.cat, now = e.ctx.currentTime;
  let d = 0, prb: Probe | null = null;
  if (o.at) {
    d = Math.hypot(o.at[0] - ear.x, o.at[1] - ear.y, o.at[2] - ear.z);
    if (d > (o.range ?? 200)) { stats.culled++; return false; }
  }
  if (o.key) {
    const t = performance.now();
    while (recent.length && t - recent[0].t > 60) recent.shift();
    if (recent.some(r => r.key === o.key && t - r.t < 30 && (!o.at || !r.at || Math.hypot(o.at[0] - r.at[0], o.at[2] - r.at[2]) < 2))) { stats.deduped++; return false; }
    recent.push({ key: o.key, at: o.at, t });
  }
  // Distance makes a sound less important (a far shot gives way to a near footstep).
  const priority = o.priority - (o.at ? Math.min(40, d * .35) : 0);
  let reuse: Voice | null = null;
  if (o.emitter) {
    // The same emitter's earlier sounds of this group: retrigger the oldest once over its limit.
    const mine = [...e.spatial, ...e.flat].filter(v => v.busy && v.group === group && v.emitter === o.emitter).sort((a, b) => a.started - b.started);
    if (mine.length >= (o.perEmitter ?? 2)) { reuse = mine[0]; stop(reuse); }
  }
  if (!reuse && busy(e, group) >= (GROUP_CAP[group] ?? 8)) {
    // Over its group's cap: replace the least important voice of the same group, or skip.
    const pool = [...e.spatial, ...e.flat].filter(v => v.busy && v.group === group).sort((a, b) => a.priority - b.priority || a.started - b.started)[0];
    if (!pool || pool.priority >= priority) { stats.skipped++; return false; }
    stop(pool); stats.stolen++;
  }
  const b = buffer(name); if (!b) return false;
  const v = reuse && !!reuse.panner === !!o.at ? reuse : claim(e, !!o.at, priority, group); if (!v) { stats.skipped++; return false; }
  if (o.at && !o.direct) prb = probe?.(o.at) ?? null;
  // Level and colour from distance, occlusion and the speed of sound.
  let level = (o.gain ?? 1) * (o.at ? distanceGain(d, o.ref ?? 4, o.rolloff ?? 1) : 1);
  let cutoff = Math.min(o.lowpass ?? 20000, o.at ? Math.max(1200, 20000 * Math.exp(-d / 55)) : 20000);
  if (prb?.occluded) { level *= .5; cutoff = Math.min(cutoff, 1100); }
  const delay = (o.delay ?? 0) + (o.at && !o.direct && d > 18 ? Math.min(.25, (d - 18) / 343) : 0);
  const start = now + delay;
  v.filter.frequency.setValueAtTime(cutoff, start);
  if (v.panner && o.at) { v.panner.positionX.setValueAtTime(o.at[0], start); v.panner.positionY.setValueAtTime(o.at[1], start); v.panner.positionZ.setValueAtTime(o.at[2], start); }
  const room = Math.max(listenerIndoor, prb?.indoor ?? 0);
  v.send.gain.setValueAtTime(Math.min(.9, (o.send ?? .06) + room * .4), start);
  if (v.bus !== e.buses[o.cat]) { if (v.bus) v.out.disconnect(v.bus); v.out.connect(e.buses[o.cat]); v.bus = e.buses[o.cat]; }
  if (v.sendBus !== e.sends[o.cat]) { if (v.sendBus) v.send.disconnect(v.sendBus); v.send.connect(e.sends[o.cat]); v.sendBus = e.sends[o.cat]; }
  const src = e.ctx.createBufferSource(), gain = e.ctx.createGain();
  src.buffer = b; src.playbackRate.value = o.rate ?? 1; gain.gain.value = level;
  src.connect(gain).connect(v.filter);
  v.busy = true; v.src = src; v.gain = gain; v.priority = priority; v.group = group; v.emitter = o.emitter ?? ''; v.started = now; v.ends = start + b.duration / (o.rate ?? 1);
  src.onended = () => { if (v.src === src) release(v); src.disconnect(); gain.disconnect(); };
  src.start(start);
  stats.played++;
  const active = e.spatial.filter(x => x.busy).length + e.flat.filter(x => x.busy).length; if (active > stats.peakVoices) stats.peakVoices = active;
  if (QA_HOOKS) { log.push(`${name}@${o.cat}#${level.toFixed(4)}${prb?.occluded ? '~occluded' : ''}`); if (log.length > 400) log.shift(); }
  return true;
}
const log: string[] = [];

/** Brief ducking of the environment under the player's own gunfire and nearby blasts. */
export function duck(amount = .6, seconds = .25) {
  const e = engine; if (!e) return;
  const g = e.buses.environment.gain, t = e.ctx.currentTime;
  g.cancelScheduledValues(t); g.setTargetAtTime(volumes.environment * amount, t, .015); g.setTargetAtTime(volumes.environment, t + seconds, .12);
}
/** A flashbang: the world goes dull and a ringing fades over `ms`. */
export function deafen(ms: number) {
  const e = build(); if (!e) return;
  const f = e.deafen.frequency, t = e.ctx.currentTime, s = ms / 1000;
  f.cancelScheduledValues(t); f.setValueAtTime(380, t); f.setTargetAtTime(20000, t + s * .35, s * .3);
  const o = e.ctx.createOscillator(), g = e.ctx.createGain(); o.frequency.value = 3600 + Math.random() * 300; o.type = 'sine';
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05 * volumes.character, t + .05); g.gain.setTargetAtTime(0, t + s * .3, s * .25);
  o.connect(g).connect(e.buses.ui); o.start(t); o.stop(t + s * 1.6); o.onended = () => { o.disconnect(); g.disconnect(); };
}
/** A short tone sequence on the UI bus (hit markers, captures, countdown, results). */
export function tones(notes: [number, number, number?][], gain = .14, type: OscillatorType = 'triangle', cat: Category = 'ui') {
  const e = build(); if (!e || e.ctx.state !== 'running') return;
  const t0 = e.ctx.currentTime;
  for (const [freq, at, len = .09] of notes) {
    const o = e.ctx.createOscillator(), g = e.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(gain, t0 + at + .006); g.gain.exponentialRampToValueAtTime(.0001, t0 + at + len);
    o.connect(g).connect(e.buses[cat]); o.start(t0 + at); o.stop(t0 + at + len + .02); o.onended = () => { o.disconnect(); g.disconnect(); };
  }
}
export function contextState() { return engine?.ctx.state ?? audio()?.ctx.state ?? 'none'; }
export function activeVoices() { return engine ? engine.spatial.filter(v => v.busy).length + engine.flat.filter(v => v.busy).length : 0; }
if (QA_HOOKS && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__arenaSound = () => ({ state: contextState(), voices: activeVoices(), max: maxVoices, hrtf, ...stats, volumes: { ...volumes }, recent: log.slice(-60) });
  // The game's final output (after the player's master volume): peak, clipped samples and loudness while running.
  let tap: { an: AnalyserNode; buf: Float32Array<ArrayBuffer>; timer: ReturnType<typeof setInterval>; peak: number; clipped: number; sum: number; n: number; voices: number } | null = null;
  (window as unknown as Record<string, unknown>).__arenaSoundTap = {
    /** `where`: 'master' (everything the player hears, campus ambience included) or 'arena' (the arena's own mix). */
    start(where: 'master' | 'arena' = 'master') {
      const e = build(); if (!e) return false;
      const an = e.ctx.createAnalyser(); an.fftSize = 2048; (where === 'arena' ? e.limiter : e.m.master).connect(an);
      const t = { an, buf: new Float32Array(2048), timer: setInterval(() => { an.getFloatTimeDomainData(t.buf); for (const x of t.buf) { const a = Math.abs(x); if (a > t.peak) t.peak = a; if (a >= .999) t.clipped++; t.sum += x * x; t.n++; } t.voices = Math.max(t.voices, activeVoices()); }, 20), peak: 0, clipped: 0, sum: 0, n: 0, voices: 0 };
      tap = t; return true;
    },
    stop() { if (!tap) return null; clearInterval(tap.timer); tap.an.disconnect(); const r = { peak: tap.peak, peakDb: 20 * Math.log10(tap.peak || 1e-9), clipped: tap.clipped, rmsDb: 10 * Math.log10(tap.sum / Math.max(1, tap.n) || 1e-12), maxVoices: tap.voices }; tap = null; return r; },
  };
  (window as unknown as Record<string, unknown>).__arenaSoundProbe = (at: Vec3) => probe?.(at) ?? null;
  (window as unknown as Record<string, unknown>).__arenaSoundSuspend = () => build()?.ctx.suspend();
}
