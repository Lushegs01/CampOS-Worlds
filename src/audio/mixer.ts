import { useGame } from '../state';
import { assetUrl } from '../world/assetUrl';
import { QA_HOOKS } from '../qa';

// The game's sound: one AudioContext, with effects and ambience on their own buses under the master volume
// (Settings). Ambience also has its own level (Settings → Environment sounds). Recorded sounds (public/assets/audio, CC0: docs/ASSETS.md) load once you are on campus, and
// only while sound is on. Sounds in the world are positioned and heard from the camera.

export interface Mixer { ctx: AudioContext; master: GainNode; effects: GainNode; ambience: GainNode; environment: GainNode; muffle: BiquadFilterNode }
let mixer: Mixer | null = null;

function create(): Mixer | null {
  if (mixer) return mixer;
  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const master = ctx.createGain(), effects = ctx.createGain(), ambience = ctx.createGain(), environment = ctx.createGain(), muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass'; muffle.frequency.value = 20000;
    // `ambience` is faded by the surroundings (quieter indoors); `environment` is the player's chosen level.
    effects.connect(master); ambience.connect(environment).connect(muffle).connect(master); master.connect(ctx.destination);
    master.gain.value = useGame.getState().volume; environment.gain.value = useGame.getState().ambience;
    mixer = { ctx, master, effects, ambience, environment, muffle };
  } catch { /* no Web Audio */ }
  return mixer;
}

/** The mixer while sound is on (resumed if the browser suspended it), otherwise null. */
export function audio(): Mixer | null {
  if (!useGame.getState().volume) return null;
  const m = create();
  if (m && m.ctx.state === 'suspended') void m.ctx.resume().catch(() => {});
  return m;
}

if (typeof window !== 'undefined') {
  // Mobile browsers keep audio suspended until a tap or key press, and most sounds start from the frame
  // loop, where resuming is refused: the first gesture resumes the shared context.
  for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, () => { audio(); }, { capture: true, passive: true });
  // Volume 0 suspends the context entirely (no mixing at all on a phone that has sound off).
  useGame.subscribe((s, before) => {
    if (mixer && s.ambience !== before.ambience) mixer.environment.gain.setTargetAtTime(s.ambience, mixer.ctx.currentTime, .05);
    if (s.volume === before.volume || !mixer) return;
    mixer.master.gain.setTargetAtTime(s.volume, mixer.ctx.currentTime, .05);
    if (s.volume) void mixer.ctx.resume().catch(() => {}); else setTimeout(() => { if (mixer && !useGame.getState().volume) void mixer.ctx.suspend(); }, 300);
  });
}

// ---------------------------------------------------------------- recorded sounds
interface Manifest { pad: number; sounds: Record<string, { variants: number; loop?: [number, number] }> }
let manifest: Manifest | null = null, loading: Promise<void> | null = null;
const buffers = new Map<string, AudioBuffer[]>();

/** Fetch and decode every sound once (in the background; until then the synthesized stand-ins play). */
export function loadSounds() {
  const m = audio(); if (!m || loading) return;
  loading = fetch(assetUrl('audio/manifest.json')).then(r => { if (!r.ok) throw Error(`audio manifest ${r.status}`); return r.json(); }).then(async (man: Manifest) => {
    manifest = man;
    // Short effects first, the long ambience loops last.
    const names = Object.keys(man.sounds).sort((a, b) => Number(!!man.sounds[a].loop) - Number(!!man.sounds[b].loop));
    for (const name of names) {
      const s = man.sounds[name], files = s.loop ? [`audio/${name}.mp3`] : Array.from({ length: s.variants }, (_, i) => `audio/${name}-${i}.mp3`);
      buffers.set(name, await Promise.all(files.map(f => fetch(assetUrl(f)).then(r => { if (!r.ok) throw Error(`${f} ${r.status}`); return r.arrayBuffer(); }).then(b => m.ctx.decodeAudioData(b)))));
    }
  }).catch(e => { console.warn('Sounds are unavailable for now.', e); setTimeout(() => { loading = null; }, 15000); });
}

// ---------------------------------------------------------------- the listener and positioned voices
export type At = { x: number; y?: number; z: number };
/** Where the camera is (sounds further than their range are not started at all). */
export const ear = { x: 0, y: 0, z: 0 };
export function setListener(p: At & { y: number }, forward: At & { y: number }) {
  ear.x = p.x; ear.y = p.y; ear.z = p.z;
  const l = mixer?.ctx.listener; if (!l || mixer!.ctx.state !== 'running') return;
  if (l.positionX) {
    l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
    l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0); }
}
export const heard = (at: At, range: number) => Math.hypot(at.x - ear.x, at.z - ear.z) < range;
function place(p: PannerNode, at: At) {
  const y = at.y ?? 1;
  if (p.positionX) { p.positionX.value = at.x; p.positionY.value = y; p.positionZ.value = at.z; } else p.setPosition(at.x, y, at.z);
}
/** Equal-power panning (HRTF is too costly for a phone) with natural distance fall-off. */
function panner(ctx: AudioContext, at: At, ref: number) {
  const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.4; p.maxDistance = 200;
  place(p, at); return p;
}

let voices = 0;
const MAX_VOICES = 28;
// QA builds: what has played, for browser tests (tests/browser-sound.mjs).
const played: string[] = [];
if (QA_HOOKS && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__campusSounds = () => ({ state: mixer?.ctx.state ?? 'none', loaded: [...buffers.keys()], played: played.slice(-300), voices, environment: mixer?.environment.gain.value ?? null });
export interface PlayOptions { at?: At; gain?: number; rate?: number; delay?: number; range?: number; ref?: number; bus?: 'effects' | 'ambience' }
/** Play one recorded sound (a random variant, slightly varied in pitch). False when it is not available yet. */
export function play(name: string, o: PlayOptions = {}): boolean {
  const m = audio(), list = buffers.get(name); if (!m || !list?.length) return false;
  if (o.at && !heard(o.at, o.range ?? 30)) return true;
  if (voices >= MAX_VOICES) return true;
  const src = m.ctx.createBufferSource(), g = m.ctx.createGain(), p = o.at ? panner(m.ctx, o.at, o.ref ?? 2) : null;
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = (o.rate ?? 1) * (.94 + Math.random() * .12);
  g.gain.value = o.gain ?? 1;
  src.connect(g); (p ? g.connect(p) : g).connect(o.bus === 'ambience' ? m.ambience : m.effects);
  voices++; src.onended = () => { voices--; src.disconnect(); g.disconnect(); p?.disconnect(); };
  src.start(m.ctx.currentTime + (o.delay ?? 0));
  if (QA_HOOKS) played.push(name);
  return true;
}

export interface Loop { gain: AudioParam; rate: AudioParam; move(at: At): void; stop(fade?: number): void }
/** A seamless loop (engine, birdsong, water), faded in; positioned when given a place. */
export function loop(name: string, o: { at?: At; gain?: number; rate?: number; ref?: number; bus?: 'effects' | 'ambience' } = {}): Loop | null {
  const m = audio(), buffer = buffers.get(name)?.[0], points = manifest?.sounds[name]?.loop; if (!m || !buffer || !points) return null;
  const src = m.ctx.createBufferSource(), g = m.ctx.createGain(), p = o.at ? panner(m.ctx, o.at, o.ref ?? 3) : null, t = m.ctx.currentTime;
  src.buffer = buffer; src.loop = true; src.loopStart = points[0]; src.loopEnd = points[1]; src.playbackRate.value = o.rate ?? 1;
  g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(o.gain ?? 1, t, .15);
  src.connect(g); (p ? g.connect(p) : g).connect(o.bus === 'ambience' ? m.ambience : m.effects);
  // A random starting point, so two of the same engine (or two visits) never sound in lockstep.
  src.start(t, points[0] + Math.random() * (points[1] - points[0]));
  if (QA_HOOKS) played.push('loop:' + name);
  let stopped = false;
  return {
    gain: g.gain, rate: src.playbackRate, move: at => { if (p) place(p, at); },
    stop: (fade = .3) => { if (stopped) return; stopped = true; const now = m.ctx.currentTime; g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, fade / 3); src.stop(now + fade); src.onended = () => { src.disconnect(); g.disconnect(); p?.disconnect(); }; },
  };
}

let noiseBuffer: AudioBuffer | null = null;
/** Two seconds of soft (brown) noise: tyres on the road, chair legs on the floor. */
export function noise(ctx: AudioContext) {
  if (noiseBuffer) return noiseBuffer;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return noiseBuffer = b;
}
/** A movable point on the effects bus for continuous synthesized sound (tyres, a motor). */
export interface Spot { input: AudioNode; move(at: At): void; release(): void }
export function spot(m: Mixer, at: At, ref = 3): Spot {
  const p = panner(m.ctx, at, ref); p.connect(m.effects);
  return { input: p, move: a => place(p, a), release: () => p.disconnect() };
}
/** A positioned (or plain) chain on the effects bus for synthesized sounds: returns its input. */
export function output(m: Mixer, at?: At, ref = 2): AudioNode {
  if (!at) return m.effects;
  const p = panner(m.ctx, at, ref); p.connect(m.effects); setTimeout(() => p.disconnect(), 4000); return p;
}
