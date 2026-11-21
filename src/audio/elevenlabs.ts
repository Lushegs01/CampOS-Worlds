import { assetUrl } from '../world/assetUrl';
import { audio, heard, recordSound, spot, type At, type Mixer } from './mixer';

type Clips = Record<string, string>;
let manifest: Promise<Clips> | undefined;
const effects = new Map<string, AudioBuffer>();
const loadingEffects = new Map<string, Promise<void>>();
const voices = new Map<string, AudioBuffer>();
const loadingVoices = new Map<string, Promise<AudioBuffer | undefined>>();

function clips() {
  manifest ??= fetch(assetUrl('elevenlabs/manifest.json')).then(async r => {
    if (!r.ok) return {};
    const data = await r.json();
    return data.clips && typeof data.clips === 'object' ? data.clips as Clips : {};
  }).catch(() => ({}));
  return manifest;
}
export async function hasElevenLabsClip(id: string) {
  return typeof (await clips())[id] === 'string';
}
async function loadClip(m: Mixer, id: string) {
  const path = (await clips())[id];
  if (typeof path !== 'string') return;
  try {
    const response = await fetch(assetUrl('elevenlabs/' + path));
    if (response.ok) return await m.ctx.decodeAudioData(await response.arrayBuffer());
  } catch { /* Missing or undecodable audio leaves the captions and stock effects available. */ }
}
export function prepareElevenLabsEffects() {
  const m = audio();
  if (!m) return;
  void clips().then(entries => {
    for (const id of Object.keys(entries)) {
      if (!id.startsWith('sfx/') || effects.has(id) || loadingEffects.has(id)) continue;
      loadingEffects.set(id, loadClip(m, id).then(buffer => {
        if (buffer) effects.set(id, buffer);
      }));
    }
  });
}

export function playElevenLabsEffect(name: string, gain: number, at?: At) {
  const id = 'sfx/' + name;
  const m = audio(), buffer = effects.get(id);
  if (!m || !buffer) return false;
  if (at && !heard(at, 95)) return true;
  const source = m.ctx.createBufferSource(), level = m.ctx.createGain();
  const position = at && spot(m, at, 5);
  source.buffer = buffer;
  level.gain.value = gain;
  source.connect(level).connect(position ? position.input : m.effects);
  source.onended = () => { source.disconnect(); level.disconnect(); if (position) position.release(); };
  source.start();
  recordSound(id);
  return true;
}
export function loopElevenLabsEffect(name: string, bus: 'ambience' | 'effects', gain: number, at?: At) {
  const id = 'sfx/' + name;
  const m = audio(), buffer = effects.get(id);
  if (!m || !buffer) return;
  const source = m.ctx.createBufferSource(), level = m.ctx.createGain();
  const position = at && spot(m, at, 6);
  source.buffer = buffer;
  source.loop = true;
  const now = m.ctx.currentTime;
  level.gain.setValueAtTime(0, now);
  level.gain.setTargetAtTime(gain, now, .1);
  source.connect(level).connect(position ? position.input : m[bus]);
  source.onended = () => { source.disconnect(); level.disconnect(); if (position) position.release(); };
  source.start(now, Math.random() * buffer.duration);
  recordSound('loop:' + id);
  return {
    move: (point: At) => { if (position) position.move(point); },
    stop: () => {
      const time = m.ctx.currentTime;
      level.gain.cancelScheduledValues(time);
      level.gain.setTargetAtTime(0, time, .05);
      source.stop(time + .18);
    },
  };
}

export function loadElevenLabsVoice(m: Mixer, id: string) {
  const cached = voices.get(id);
  if (cached) return Promise.resolve(cached);
  let pending = loadingVoices.get(id);
  if (!pending) {
    pending = loadClip(m, id).then(buffer => {
      if (buffer) {
        if (voices.size >= 12) voices.delete(voices.keys().next().value!);
        voices.set(id, buffer);
      }
      return buffer;
    }).finally(() => loadingVoices.delete(id));
    loadingVoices.set(id, pending);
  }
  return pending;
}
