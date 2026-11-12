// The arena's audio engine, on the game's shared AudioContext (src/audio/mixer.ts, whose master is the campus Volume):
//
//   voices ─► category buses (weapons, explosions & impacts, environment, movement & footsteps, character,
//             interface, voice & announcements; each with its own volume)
//          ─► deafen (flashbang low-pass; not the interface or announcer) ─► arena master (volume)
//          ─► rumble filter (phones: 70 Hz, small speakers cannot use lower) ─► glue compressor ─► limiter ─► game master
//        └─► room send ─► one shared convolution reverb (stronger under roofs) ─┘
//
// Sounds are real recordings in sound banks (public/assets/arena/audio, built by scripts/assets/build-arena-audio.mjs):
// each bank is one or two MP3 sprites plus a manifest entry listing every sound's variants. A bank is downloaded and
// decoded only when something asks for it (the player's own weapons and the map's surfaces at deployment, another
// player's weapon when they are first seen) — at its own sample rate (32 kHz for footsteps, 24 kHz for voices…),
// through an OfflineAudioContext, so a phone keeps a third less audio in memory. Sprites start with a one-sample
// marker: the decoder's delay is measured from it, so every cut stays sample-accurate in every browser.
//
// Voices are pooled: a fixed number of filter/panner chains (fewer on phones) reused for every sound. When every voice
// is busy, a new sound takes the voice of the least important one (by priority, distance and age) or is skipped.
// Each group also has its own cap (impacts, footsteps, casings …) so decoration never crowds out gunfire. Distance:
// an inverse-distance level curve, air absorption (a low-pass closing with distance), the speed of sound, occlusion
// through walls (darker and quieter) and a reverb send for indoor sources.
import { audio, ear, type Mixer } from '../../audio/mixer';
import { assetUrl } from '../../world/assetUrl';
import { createBags, jitter } from './variation.mjs';
import { QA_HOOKS } from '../../qa';

export type Category = 'weapons' | 'explosions' | 'environment' | 'footsteps' | 'character' | 'ui' | 'voice';
export const CATEGORIES: Category[] = ['weapons', 'explosions', 'environment', 'footsteps', 'character', 'ui', 'voice'];
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
  /** Ignore occlusion and the speed of sound (interface, the player's own sounds). */
  direct?: boolean;
  /** A sound with the same key within 30 ms and 2 m is a duplicate (several pellets on one wall). */
  key?: string;
  /** Per-emitter limit: at most `perEmitter` voices of this group for this emitter; a new one retriggers the oldest. */
  emitter?: string; perEmitter?: number;
  /** Natural variation: [rate ± fraction, level ± dB]. */
  vary?: [number, number];
  /** A particular variant (otherwise a shuffle bag chooses, never the same twice in a row). */
  variant?: number;
  /** Lets the sound be stopped early by tag (a cancelled reload's remaining parts). */
  tag?: string;
  /** Schedule so the clip's loudest moment (a latch clicking, feet landing) falls at this engine time (see `now`). */
  peakAt?: number;
}
export interface Probe { occluded: boolean; indoor: number }
interface FileInfo { file: string; ch: number; rate: number; bytes: number; seconds: number }
interface BankInfo { files: FileInfo[]; sounds: Record<string, number[][]>; meta?: Record<string, unknown> }
interface Manifest { version: number; rate: number; marker: number; banks: Record<string, BankInfo> }

const GROUP_CAP: Record<string, number> = { shot: 14, tail: 6, far: 6, impact: 6, body: 4, step: 8, foley: 5, casing: 3, mech: 6, explosions: 4, ui: 4, character: 4, voice: 2, environment: 5, flyby: 3 };

interface Voice { filter: BiquadFilterNode; panner: PannerNode | null; send: GainNode; out: AudioNode; bus: AudioNode | null; sendBus: AudioNode | null; src: AudioBufferSourceNode | null; gain: GainNode | null; busy: boolean; priority: number; started: number; ends: number; group: string; emitter: string; tag: string }
interface Engine {
  m: Mixer; ctx: AudioContext; buses: Record<Category, GainNode>; sends: Record<Category, GainNode>; deafen: BiquadFilterNode; master: GainNode; rumble: BiquadFilterNode;
  reverbIn: GainNode; limiter: DynamicsCompressorNode; spatial: Voice[]; flat: Voice[]; hrtf: boolean;
}
let engine: Engine | null = null, maxVoices = 32, hrtf = false, phone = false, budget = 96 * 1048576;
const pinned = new Set<string>();
const volumes: Record<Category, number> = { weapons: 1, explosions: 1, environment: 1, footsteps: 1, character: 1, ui: 1, voice: 1 };
let masterVolume = 1, hidden = false;
let probe: ((at: Vec3) => Probe) | null = null, listenerIndoor = 0;
export const stats = { played: 0, skipped: 0, stolen: 0, deduped: 0, culled: 0, missing: 0, peakVoices: 0, loads: 0, loadMs: 0, failures: 0, evicted: 0 };
const bags = createBags();

/**
 * Phones get fewer voices, plain stereo panning, a rumble filter for small speakers and a smaller memory budget for
 * decoded sound (32 MB); desktops HRTF and 96 MB.
 */
export function configure(opts: { voices: number; hrtf: boolean; phone?: boolean }) {
  if (engine && (opts.voices !== maxVoices || opts.hrtf !== hrtf || !!opts.phone !== phone)) teardown();
  maxVoices = opts.voices; hrtf = opts.hrtf; phone = !!opts.phone; budget = (phone ? 32 : 96) * 1048576;
}
/** Banks never evicted for the budget (the player's own weapons and voice, the ground's footsteps…). */
export function pin(names: string[]) { pinned.clear(); for (const n of names) pinned.add(n); }
export function setVolumes(v: Partial<Record<Category, number>> & { master?: number }) {
  const { master, ...cats } = v;
  Object.assign(volumes, cats); if (master != null) masterVolume = master;
  const e = engine; if (!e) return;
  const t = e.ctx.currentTime;
  for (const c of CATEGORIES) { e.buses[c].gain.setTargetAtTime(volumes[c], t, .05); e.sends[c].gain.setTargetAtTime(volumes[c], t, .05); }
  e.master.gain.setTargetAtTime(hidden ? 0 : masterVolume, t, .05);
}
/** The scene answers "is this point behind a wall from the listener, and under a roof?" (a few ray casts). */
export function setProbe(fn: ((at: Vec3) => Probe) | null) { probe = fn; }
export function setListenerIndoor(amount: number) { listenerIndoor = amount; }
/** 0 above ground … 1 in a station or tunnel: a second, much longer reverb (hard tiled walls, a long hall) comes up. */
let tunnelWet: GainNode | null = null, underground = 0;
export function setListenerUnderground(amount: number) { if (amount === underground) return; underground = amount; if (engine && tunnelWet) tunnelWet.gain.setTargetAtTime(amount * .5, engine.ctx.currentTime, .35); }
export const indoorAmount = () => listenerIndoor;

function impulse(ctx: BaseAudioContext, seconds: number) {
  // A hard-walled room: early reflections, then a dense tail that loses its highs as it decays.
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
  const send = ctx.createGain(); send.gain.value = 0; filter.connect(send);
  let panner: PannerNode | null = null, out: AudioNode = filter;
  if (spatial) {
    panner = ctx.createPanner(); panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
    // Level is computed by the engine (its own curve), so the panner only places the sound.
    panner.distanceModel = 'inverse'; panner.refDistance = 1; panner.rolloffFactor = 0;
    filter.connect(panner); out = panner;
  }
  return { filter, panner, send, out, bus: null, sendBus: null, src: null, gain: null, busy: false, priority: 0, started: 0, ends: 0, group: '', emitter: '', tag: '' };
}
function build(): Engine | null {
  const m = audio(); if (!m) return null;
  if (engine?.ctx === m.ctx) return engine;
  if (engine) teardown();
  const ctx = m.ctx;
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .09;
  const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -20; glue.knee.value = 10; glue.ratio.value = 2.4; glue.attack.value = .008; glue.release.value = .2;
  const rumble = ctx.createBiquadFilter(); rumble.type = 'highpass'; rumble.frequency.value = phone ? 70 : 28; rumble.Q.value = .6;
  const master = ctx.createGain(); master.gain.value = hidden ? 0 : masterVolume;
  const deafen = ctx.createBiquadFilter(); deafen.type = 'lowpass'; deafen.frequency.value = 20000; deafen.Q.value = .5;
  deafen.connect(master); master.connect(rumble).connect(glue).connect(limiter).connect(m.effects);
  const buses = Object.fromEntries(CATEGORIES.map(c => { const g = ctx.createGain(); g.gain.value = volumes[c]; g.connect(c === 'ui' || c === 'voice' ? master : deafen); return [c, g]; })) as Record<Category, GainNode>;
  const reverbIn = ctx.createGain(); reverbIn.gain.value = 1;
  const sends = Object.fromEntries(CATEGORIES.map(c => { const g = ctx.createGain(); g.gain.value = volumes[c]; g.connect(reverbIn); return [c, g]; })) as Record<Category, GainNode>;
  try { const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, maxVoices <= 20 ? .75 : 1.1); const wet = ctx.createGain(); wet.gain.value = .5; reverbIn.connect(conv).connect(wet).connect(deafen);
    const hall = ctx.createConvolver(); hall.buffer = impulse(ctx, maxVoices <= 20 ? 1.6 : 2.7); tunnelWet = ctx.createGain(); tunnelWet.gain.value = underground * .5; reverbIn.connect(hall).connect(tunnelWet).connect(deafen); } catch { /* no convolution: dry only */ }
  const spatialCount = Math.round(maxVoices * .75);
  engine = { m, ctx, buses, sends, deafen, master, rumble, reverbIn, limiter, spatial: Array.from({ length: spatialCount }, () => voice(ctx, true)), flat: Array.from({ length: maxVoices - spatialCount }, () => voice(ctx, false)), hrtf };
  return engine;
}
function teardown() {
  if (!engine) return;
  for (const v of [...engine.spatial, ...engine.flat]) { try { v.src?.stop(); } catch { /* already stopped */ } v.out.disconnect(); v.filter.disconnect(); v.send.disconnect(); }
  for (const l of loops) l.stop(0);
  for (const b of [...Object.values(engine.buses), ...Object.values(engine.sends)]) b.disconnect();
  tunnelWet?.disconnect(); tunnelWet = null;
  engine.deafen.disconnect(); engine.reverbIn.disconnect(); engine.master.disconnect(); engine.rumble.disconnect(); engine.limiter.disconnect();
  engine = null;
}
/** Leaving a match: fade out every arena sound still playing (tails, distant fire, loops) so nothing follows the player out. */
export function stopAll(fade = .08) {
  const e = engine; if (!e) return;
  const t = e.ctx.currentTime;
  for (const v of [...e.spatial, ...e.flat]) if (v.busy) {
    if (v.gain) { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, fade / 3); }
    try { v.src?.stop(t + fade); } catch { /* not started */ }
  }
  for (const l of [...loops]) l.stop(fade);
}
/** Leaving the arena: stop everything and release the graph and the decoded banks. */
export function shutdown() { teardown(); recent.length = 0; for (const b of banks.values()) b.abort?.abort(); banks.clear(); bags.clear(); queue.length = 0; }

// ---------------------------------------------------------------- sound banks
let manifest: Manifest | null = null, manifestLoading: Promise<Manifest | null> | null = null;
function loadManifest(): Promise<Manifest | null> {
  if (manifest) return Promise.resolve(manifest);
  manifestLoading ??= fetch(assetUrl('arena/audio/manifest.json')).then(r => { if (!r.ok) throw new Error('audio manifest ' + r.status); return r.json(); })
    .then((m: Manifest) => (manifest = m)).catch(e => { console.warn('Arena sounds are unavailable for now.', e); setTimeout(() => { manifestLoading = null; }, 8000); return null; });
  return manifestLoading;
}
interface Bank { name: string; state: 'queued' | 'loading' | 'ready' | 'failed'; buffers: (AudioBuffer | null)[]; delays: number[]; bytes: number; used: number; priority: number; tries: number; abort?: AbortController; waiters: (() => void)[] }
const banks = new Map<string, Bank>(), queue: Bank[] = [];
let inflight = 0;
/** The banks the game wants. Lower `priority` numbers load first (1: needed to play, 2: soon, 3: whenever). */
export function want(names: string[], priority = 2): Promise<void> {
  const all = Promise.all(names.map(n => {
    let b = banks.get(n);
    if (b?.state === 'ready') { b.used = performance.now(); return Promise.resolve(); }
    if (!b) { b = { name: n, state: 'queued', buffers: [], delays: [], bytes: 0, used: performance.now(), priority, tries: 0, waiters: [] }; banks.set(n, b); queue.push(b); }
    else if (priority < b.priority) b.priority = priority;
    if (b.state === 'failed' && b.tries < 3) { b.state = 'queued'; queue.push(b); }
    const bank = b;
    return new Promise<void>(res => { if (bank.state === 'failed' || bank.state === 'ready') res(); else bank.waiters.push(res); });
  })).then(() => undefined);
  pump();
  return all;
}
/** Is a bank decoded and playable? */
export const ready = (bank: string) => banks.get(bank)?.state === 'ready';
function pump() {
  void loadManifest().then(m => {
    if (!m) return;
    const limit = phone ? 2 : 3;
    queue.sort((a, b) => a.priority - b.priority);
    while (inflight < limit && queue.length) { const b = queue.shift()!; if (b.state !== 'queued') continue; inflight++; void load(b, m).finally(() => { inflight--; pump(); }); }
  });
}
async function decodeAt(data: ArrayBuffer, rate: number, ch: number, ctx: AudioContext): Promise<AudioBuffer> {
  // An OfflineAudioContext at the file's own rate decodes without resampling up to the device rate.
  try { const Off = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext; return await new Off(ch, 1, rate).decodeAudioData(data.slice(0)); }
  catch { return await ctx.decodeAudioData(data); }
}
async function load(b: Bank, m: Manifest) {
  const info = m.banks[b.name], e = build();
  if (!info || !e) { b.state = 'failed'; b.tries = 99; b.waiters.splice(0).forEach(w => w()); return; }
  b.state = 'loading'; b.tries++; b.abort = new AbortController();
  const t0 = performance.now();
  try {
    const out = await Promise.all(info.files.map(async f => {
      const r = await fetch(assetUrl('arena/audio/' + f.file), { signal: b.abort!.signal }); if (!r.ok) throw new Error(`${f.file} ${r.status}`);
      const buf = await decodeAt(await r.arrayBuffer(), f.rate, f.ch, e.ctx);
      // The marker: the loudest sample in the lead-in shows the decoder's delay.
      const d = buf.getChannelData(0), n = Math.min(d.length, Math.round(buf.sampleRate * .25)); let mi = 0, mv = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > mv) { mv = a; mi = i; } }
      return { buf, delay: mv > .2 ? mi / buf.sampleRate - m.marker : 0 };
    }));
    if (!banks.has(b.name)) return; // released meanwhile
    b.buffers = out.map(o => o.buf); b.delays = out.map(o => o.delay); b.bytes = out.reduce((a, o) => a + o.buf.length * o.buf.numberOfChannels * 4, 0);
    b.state = 'ready'; b.used = performance.now(); stats.loads++; stats.loadMs += performance.now() - t0;
    enforceBudget(b.name);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    stats.failures++; b.state = 'failed'; console.warn('Arena sound bank failed:', b.name, (err as Error).message);
    if (b.tries < 3) setTimeout(() => { if (banks.get(b.name) === b && b.state === 'failed') { b.state = 'queued'; queue.push(b); pump(); } }, 2500 * b.tries);
  }
  b.waiters.splice(0).forEach(w => w());
}
/**
 * Over budget: let go of the least recently used banks that can come back on demand (other players' weapons and
 * voices, footsteps of surfaces not walked lately), never one used in the last 8 seconds or a pinned one.
 */
function enforceBudget(just: string) {
  let total = decodedBytes(); if (total <= budget) return;
  const now = performance.now(), list = [...banks.values()].filter(b => b.state === 'ready' && b.name !== just && !pinned.has(b.name) && /^(w\.|voice\.|steps\.|amb\.)/.test(b.name) && now - b.used > 8000).sort((a, b) => a.used - b.used);
  for (const b of list) { if (total <= budget) break; total -= b.bytes; banks.delete(b.name); stats.evicted++; }
}
/** Checked every few seconds too: banks go idle long after the last load. */
if (typeof window !== 'undefined') setInterval(() => { if (banks.size) enforceBudget(''); }, 4000);
/** Let go of banks (those starting with `prefix`, or the least recently used beyond `keep` of them). */
export function release(prefix: string, keep = 0, except: string[] = []) {
  const list = [...banks.values()].filter(b => b.name.startsWith(prefix) && !except.includes(b.name)).sort((a, b) => b.used - a.used);
  for (const b of list.slice(keep)) { b.abort?.abort(); banks.delete(b.name); stats.evicted++; }
}
export const bankMeta = (bank: string) => manifest?.banks[bank]?.meta;
export const decodedBytes = () => [...banks.values()].reduce((a, b) => a + b.bytes, 0);
/** Variant count of a sound ('bank/name'), 0 when unknown or not loaded. */
export function variants(sound: string) { const i = sound.indexOf('/'); return manifest?.banks[sound.slice(0, i)]?.sounds[sound.slice(i + 1)]?.length ?? 0; }

/** Resolve 'bank/name' to a buffer region (choosing a variant). Null when the bank is not ready (and asks for it). */
function resolve(sound: string, variant?: number, bagKey = sound) {
  const i = sound.indexOf('/'), bankName = sound.slice(0, i), name = sound.slice(i + 1), b = banks.get(bankName);
  if (!b || b.state !== 'ready') { if (!b) void want([bankName], 3); stats.missing++; return null; }
  const list = manifest?.banks[bankName]?.sounds[name]; if (!list?.length) { stats.missing++; return null; }
  const v = list[variant != null ? Math.min(variant, list.length - 1) : bags.next(bagKey, list.length)];
  b.used = performance.now();
  return { buffer: b.buffers[v[0]]!, offset: v[1] + b.delays[v[0]], dur: v[2], peak: v[3] ?? 0, loop: v[4] === 1 };
}
/** How long after its start a sound typically reaches its loudest moment (the median of its variants), in seconds. */
export function leadOf(sound: string) {
  const i = sound.indexOf('/'), list = manifest?.banks[sound.slice(0, i)]?.sounds[sound.slice(i + 1)]; if (!list?.length) return 0;
  const p = list.map(v => v[3] ?? 0).sort((a, b) => a - b); return p[Math.floor(p.length / 2)];
}

// ---------------------------------------------------------------- voices
const recent: { key: string; at: Vec3 | undefined; t: number }[] = [];
const distanceGain = (d: number, ref: number, rolloff: number) => (d <= ref ? 1 : ref / (ref + rolloff * (d - ref)));
const busy = (e: Engine, group: string) => { let n = 0; for (const v of e.spatial) if (v.busy && v.group === group) n++; for (const v of e.flat) if (v.busy && v.group === group) n++; return n; };
function claim(e: Engine, spatial: boolean, priority: number): Voice | null {
  const pool = spatial ? e.spatial : e.flat, now = e.ctx.currentTime;
  for (const v of pool) if (v.busy && now > v.ends + .05) release1(v); // a source whose onended never fired
  const free = pool.find(v => !v.busy); if (free) return free;
  // Steal: the least important, oldest voice, if the new sound matters more.
  let victim: Voice | null = null, worst = Infinity;
  for (const v of pool) { const score = v.priority - (now - v.started) * 8; if (score < worst) { worst = score; victim = v; } }
  if (!victim || worst >= priority) return null;
  stop(victim); stats.stolen++;
  return victim;
}
function stop(v: Voice, fade = .006) {
  const t = v.filter.context.currentTime;
  if (v.gain) { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, fade); }
  try { v.src?.stop(t + fade * 5); } catch { /* not started */ }
  if (v.src) v.src.onended = null;
  const g = v.gain, s = v.src; setTimeout(() => { s?.disconnect(); g?.disconnect(); }, fade * 5000 + 60);
  release1(v);
}
function release1(v: Voice) { v.busy = false; v.src = null; v.gain = null; v.tag = ''; }
/** Stop every playing sound with this tag (a reload cancelled by a weapon switch). */
export function stopTag(tag: string, fade = .03) { const e = engine; if (!e) return; let n = 0; for (const v of [...e.spatial, ...e.flat]) if (v.busy && v.tag === tag) { stop(v, fade); n++; } if (QA_HOOKS) stopped.push({ tag, t: Math.round(performance.now()), voices: n }); }
const stopped: { tag: string; t: number; voices: number }[] = [];

/** Play a sound ('bank/name'). False when it was not played (sound off, not loaded, out of range, duplicate, no voice). */
export function play(sound: string, o: PlayOptions): boolean {
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
    const mine = [...e.spatial, ...e.flat].filter(v => v.busy && v.group === group && v.emitter === o.emitter).sort((a, b) => a.started - b.started);
    if (mine.length >= (o.perEmitter ?? 2)) { reuse = mine[0]; stop(reuse); }
  }
  if (!reuse && busy(e, group) >= (GROUP_CAP[group] ?? 8)) {
    const pool = [...e.spatial, ...e.flat].filter(v => v.busy && v.group === group).sort((a, b) => a.priority - b.priority || a.started - b.started)[0];
    if (!pool || pool.priority >= priority) { stats.skipped++; return false; }
    stop(pool); stats.stolen++;
  }
  const r = resolve(sound, o.variant, o.emitter ? sound + '|' + o.emitter : sound); if (!r) return false;
  const v = reuse && !!reuse.panner === !!o.at ? reuse : claim(e, !!o.at, priority); if (!v) { stats.skipped++; return false; }
  if (o.at && !o.direct) prb = probe?.(o.at) ?? null;
  const vary = o.vary ? jitter(Math.random, o.vary[0], o.vary[1]) : { rate: 1, gain: 1 };
  let level = (o.gain ?? 1) * vary.gain * (o.at ? distanceGain(d, o.ref ?? 4, o.rolloff ?? 1) : 1);
  let cutoff = Math.min(o.lowpass ?? 20000, o.at ? Math.max(1500, 19000 * Math.exp(-d / 70)) : 20000);
  if (prb?.occluded) { level *= .5; cutoff = Math.min(cutoff, 1100); }
  const rate = (o.rate ?? 1) * vary.rate;
  let delay = (o.delay ?? 0) + (o.at && !o.direct && d > 18 ? Math.min(.25, (d - 18) / 343) : 0), skip = 0;
  if (o.peakAt != null) { const s0 = o.peakAt - r.peak / rate - now; if (s0 >= 0) delay += s0; else skip = Math.min(r.peak, -s0 * rate); }
  const start = now + delay;
  v.filter.frequency.setValueAtTime(cutoff, start);
  if (v.panner && o.at) { v.panner.positionX.setValueAtTime(o.at[0], start); v.panner.positionY.setValueAtTime(o.at[1], start); v.panner.positionZ.setValueAtTime(o.at[2], start); }
  const room = Math.max(listenerIndoor, prb?.indoor ?? 0);
  v.send.gain.setValueAtTime(Math.min(.9, (o.send ?? .05) + room * .38), start);
  if (v.bus !== e.buses[o.cat]) { if (v.bus) v.out.disconnect(v.bus); v.out.connect(e.buses[o.cat]); v.bus = e.buses[o.cat]; }
  if (v.sendBus !== e.sends[o.cat]) { if (v.sendBus) v.send.disconnect(v.sendBus); v.send.connect(e.sends[o.cat]); v.sendBus = e.sends[o.cat]; }
  const src = e.ctx.createBufferSource(), gain = e.ctx.createGain();
  src.buffer = r.buffer; src.playbackRate.value = rate; gain.gain.value = level;
  src.connect(gain).connect(v.filter);
  v.busy = true; v.src = src; v.gain = gain; v.priority = priority; v.group = group; v.emitter = o.emitter ?? ''; v.tag = o.tag ?? ''; v.started = now; v.ends = start + (r.dur - skip) / rate;
  src.onended = () => { if (v.src === src) release1(v); src.disconnect(); gain.disconnect(); };
  src.start(start, Math.max(0, r.offset + skip), r.dur - skip);
  stats.played++;
  const active = e.spatial.filter(x => x.busy).length + e.flat.filter(x => x.busy).length; if (active > stats.peakVoices) stats.peakVoices = active;
  if (QA_HOOKS) {
    log.push(`${sound}@${o.cat}#${level.toFixed(4)}${prb?.occluded ? '~occluded' : ''}${o.at ? `~${d.toFixed(0)}m` : ''}`); if (log.length > 400) log.shift();
    // When it will be heard (page clock, ms) and when its loudest moment lands, for timing checks.
    events.push({ sound, cat: o.cat, level: +level.toFixed(4), t: Math.round(performance.now() + delay * 1000), peak: Math.round(performance.now() + (delay + Math.max(0, r.peak - skip) / rate) * 1000), d: +d.toFixed(1), occluded: !!prb?.occluded, tag: o.tag ?? '' }); if (events.length > 600) events.shift();
  }
  return true;
}
const log: string[] = [], events: { sound: string; cat: string; level: number; t: number; peak: number; d: number; occluded: boolean; tag: string }[] = [];

// ---------------------------------------------------------------- loops (ambience, breathing, a smoke canister's hiss)
export interface LoopHandle { setGain(g: number, tau?: number): void; setLowpass(f: number, tau?: number): void; move(at: Vec3): void; stop(fade?: number): void; readonly alive: boolean }
const loops = new Set<LoopHandle>();
/** A seamless loop of a sound's variant, faded in; positioned when given a place. Null if not loaded yet. */
export function loop(sound: string, o: { cat: Category; at?: Vec3; gain?: number; rate?: number; ref?: number; rolloff?: number; send?: number; lowpass?: number; fade?: number; variant?: number }): LoopHandle | null {
  const e = build(); if (!e || e.ctx.state !== 'running' || loops.size >= 10) return null;
  const r = resolve(sound, o.variant ?? 0); if (!r) return null;
  const t = e.ctx.currentTime, src = e.ctx.createBufferSource(), g = e.ctx.createGain(), f = e.ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = o.lowpass ?? 20000; f.Q.value = .5;
  src.buffer = r.buffer; src.loop = true; src.loopStart = r.offset; src.loopEnd = r.offset + r.dur; src.playbackRate.value = o.rate ?? 1;
  g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(o.gain ?? 1, t, (o.fade ?? .6) / 3);
  let p: PannerNode | null = null;
  src.connect(g).connect(f);
  if (o.at) { p = e.ctx.createPanner(); p.panningModel = e.hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref ?? 3; p.rolloffFactor = o.rolloff ?? 1.2; p.maxDistance = 120; p.positionX.value = o.at[0]; p.positionY.value = o.at[1]; p.positionZ.value = o.at[2]; f.connect(p).connect(e.buses[o.cat]); }
  else f.connect(e.buses[o.cat]);
  const send = e.ctx.createGain(); send.gain.value = o.send ?? 0; f.connect(send).connect(e.sends[o.cat]);
  // Start somewhere inside the loop, so two of the same never play in lockstep.
  src.start(t, r.offset + Math.random() * r.dur);
  let alive = true;
  const h: LoopHandle = {
    get alive() { return alive; },
    setGain: (v, tau = .2) => g.gain.setTargetAtTime(v, e.ctx.currentTime, tau),
    setLowpass: (v, tau = .2) => f.frequency.setTargetAtTime(v, e.ctx.currentTime, tau),
    move: at => { if (p) { p.positionX.value = at[0]; p.positionY.value = at[1]; p.positionZ.value = at[2]; } },
    stop: (fade = .3) => {
      if (!alive) return; alive = false; loops.delete(h);
      const now = e.ctx.currentTime; g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, Math.max(.005, fade / 3));
      try { src.stop(now + fade + .05); } catch { /* stopped */ }
      src.onended = () => { src.disconnect(); g.disconnect(); f.disconnect(); p?.disconnect(); send.disconnect(); };
    },
  };
  loops.add(h);
  if (QA_HOOKS) { log.push(`loop:${sound}@${o.cat}`); if (log.length > 400) log.shift(); }
  return h;
}

// ---------------------------------------------------------------- mix
/** Brief ducking of the environment under the player's own gunfire, nearby blasts and announcements. */
export function duck(amount = .6, seconds = .25, cat: Category = 'environment') {
  const e = engine; if (!e) return;
  const g = e.buses[cat].gain, t = e.ctx.currentTime;
  g.cancelScheduledValues(t); g.setTargetAtTime(volumes[cat] * amount, t, .015); g.setTargetAtTime(volumes[cat], t + seconds, .15);
}
/**
 * A flashbang: the world goes dull and a tinnitus ring fades over `ms` (a pure tone is how the ear's ringing is
 * heard, so this one sound is a tone; it plays on the interface bus, under the player's character volume).
 */
export function deafen(ms: number) {
  const e = build(); if (!e) return;
  const f = e.deafen.frequency, t = e.ctx.currentTime, s = ms / 1000;
  f.cancelScheduledValues(t); f.setValueAtTime(380, t); f.setTargetAtTime(20000, t + s * .35, s * .3);
  const o = e.ctx.createOscillator(), g = e.ctx.createGain(); o.frequency.value = 3600 + Math.random() * 300; o.type = 'sine';
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.04 * volumes.character, t + .05); g.gain.setTargetAtTime(0, t + s * .3, s * .25);
  o.connect(g).connect(e.buses.ui); o.start(t); o.stop(t + s * 1.6); o.onended = () => { o.disconnect(); g.disconnect(); };
}
export function contextState() { return engine?.ctx.state ?? audio()?.ctx.state ?? 'none'; }
export function activeVoices() { return engine ? engine.spatial.filter(v => v.busy).length + engine.flat.filter(v => v.busy).length : 0; }
export const now = () => engine?.ctx.currentTime ?? 0;

// Hidden tab: fade the arena out (no ambience or breathing playing in the background) and back in on return; the
// shared context itself is resumed by the mixer on the next gesture if the browser suspended it.
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  hidden = document.hidden; const e = engine; if (!e) return;
  e.master.gain.setTargetAtTime(hidden ? 0 : masterVolume, e.ctx.currentTime, .08);
  if (!hidden && e.ctx.state !== 'running') void e.ctx.resume().catch(() => {});
});

if (QA_HOOKS && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__arenaSound = () => ({
    state: contextState(), voices: activeVoices(), max: maxVoices, hrtf, phone, budget, ...stats, volumes: { ...volumes, master: masterVolume }, ear: { ...ear }, recent: log.slice(-80), events: events.slice(-300), stopped: stopped.slice(-30), loops: loops.size,
    banks: [...banks.values()].map(b => ({ name: b.name, state: b.state, bytes: b.bytes, rate: b.buffers[0]?.sampleRate ?? 0, delayMs: +(b.delays[0] * 1000 || 0).toFixed(2) })), bufferBytes: decodedBytes(),
  });
  // The game's final output (after the player's master volume): peak, clipped samples and loudness while running.
  let tap: { an: AnalyserNode; buf: Float32Array<ArrayBuffer>; timer: ReturnType<typeof setInterval>; peak: number; clipped: number; sum: number; n: number; voices: number; last: number; start: number; seen: number; read: () => void } | null = null;
  (window as unknown as Record<string, unknown>).__arenaSoundTap = {
    /** `where`: 'master' (everything the player hears) or 'arena' (the arena's own mix, after its limiter). */
    start(where: 'master' | 'arena' = 'master') {
      const e = build(); if (!e) return false;
      const an = e.ctx.createAnalyser(); an.fftSize = 32768; (where === 'arena' ? e.limiter : e.m.master).connect(an);
      const win = an.fftSize / e.ctx.sampleRate;
      const t = { an, buf: new Float32Array(an.fftSize), timer: 0 as unknown as ReturnType<typeof setInterval>, peak: 0, clipped: 0, sum: 0, n: 0, voices: 0, last: e.ctx.currentTime, start: e.ctx.currentTime, seen: 0, read: () => {} };
      t.read = () => {
        const now = e.ctx.currentTime, fresh = Math.min(win, now - t.last); t.last = now; t.seen += fresh;
        an.getFloatTimeDomainData(t.buf);
        const from = Math.max(0, t.buf.length - Math.round(fresh * e.ctx.sampleRate));
        for (let i = 0; i < t.buf.length; i++) { const x = t.buf[i], a = Math.abs(x); if (a > t.peak) t.peak = a; if (i >= from) { if (a >= .999) t.clipped++; t.sum += x * x; t.n++; } }
        t.voices = Math.max(t.voices, activeVoices());
      };
      t.timer = setInterval(t.read, 150);
      tap = t; return true;
    },
    stop() {
      if (!tap) return null; tap.read(); clearInterval(tap.timer); tap.an.disconnect();
      const span = Math.max(1e-6, tap.an.context.currentTime - tap.start);
      const r = { peak: tap.peak, peakDb: 20 * Math.log10(tap.peak || 1e-9), clipped: tap.clipped, rmsDb: 10 * Math.log10(tap.sum / Math.max(1, tap.n) || 1e-12), maxVoices: tap.voices, coverage: Math.min(1, tap.seen / span) };
      tap = null; return r;
    },
  };
  (window as unknown as Record<string, unknown>).__arenaSoundProbe = (at: Vec3) => probe?.(at) ?? null;
  (window as unknown as Record<string, unknown>).__arenaSoundSuspend = () => build()?.ctx.suspend();
}
