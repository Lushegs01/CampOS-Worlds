import { PLAZA } from '../world/layout';
import { audio, loadSounds, loop, type Loop } from './mixer';
import { indoors } from './surface';
import { useGame } from '../state';

// The campus around you: birdsong and a light breeze outdoors, the fountain's water in the courtyard, all
// muffled (quieter and duller, as through walls) when you step inside a building or your room.
// Settings → Environment sounds sets their level; at zero none of them play.

let birds: Loop | null = null, wind: Loop | null = null, water: Loop | null = null, inside = false;
const FOUNTAIN = { x: PLAZA.x, y: .6, z: PLAZA.z };

/** Each frame while on campus, with where you are. */
export function tickAmbience(x: number, z: number) {
  const m = audio();
  if (!m || !useGame.getState().ambience) { stopAmbience(); return; }
  loadSounds();
  birds ??= loop('birds', { gain: .5, bus: 'ambience' });
  wind ??= loop('wind', { gain: .3, bus: 'ambience' });
  const nearFountain = Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < 50;
  if (nearFountain) water ??= loop('water', { at: FOUNTAIN, gain: .9, ref: 4, bus: 'ambience' });
  else if (water) { water.stop(1); water = null; }
  const now = indoors(x, z);
  if (now !== inside) {
    inside = now; const t = m.ctx.currentTime;
    m.muffle.frequency.setTargetAtTime(inside ? 650 : 20000, t, .25);
    m.ambience.gain.setTargetAtTime(inside ? .45 : 1, t, .25);
  }
}

/** Leaving the campus (back to the welcome screen): fade the soundscape out. */
export function stopAmbience() { for (const l of [birds, wind, water]) l?.stop(1); birds = wind = water = null; rainLevel(0); }

// Rain: band-passed noise on the ambience bus (so it is muffled indoors with everything else) at the rain's
// intensity; synthesized, so no download. Birdsong falls silent in heavy rain.
let rain: { source: AudioBufferSourceNode; gain: GainNode } | null = null, rainBuffer: AudioBuffer | null = null;
function rainLevel(level: number) {
  const m = audio(); if (!m) return;
  const t = m.ctx.currentTime;
  if (level <= .01) { if (rain) { const r = rain; r.gain.gain.setTargetAtTime(0, t, .6); setTimeout(() => { try { r.source.stop(); } catch { /* already stopped */ } }, 3000); rain = null; } return; }
  if (!rain) {
    if (!rainBuffer) { rainBuffer = m.ctx.createBuffer(1, m.ctx.sampleRate * 3, m.ctx.sampleRate); const d = rainBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const source = m.ctx.createBufferSource(); source.buffer = rainBuffer; source.loop = true;
    const band = m.ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 2400; band.Q.value = .5;
    const low = m.ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 400; low.gain.value = 6;
    const gain = m.ctx.createGain(); gain.gain.value = 0;
    source.connect(band).connect(low).connect(gain).connect(m.ambience); source.start();
    rain = { source, gain };
  }
  rain.gain.gain.setTargetAtTime(.06 + .22 * level, t, .8);
}
let lastRain = -1;
/** Each frame from the rain renderer: the rain's intensity where you are (0 under a roof is handled by the muffle). */
export function tickRain(level: number) {
  if (!useGame.getState().ambience || useGame.getState().phase !== 'playing') level = 0;
  if (Math.abs(level - lastRain) < .02 && !(level === 0 && lastRain !== 0)) return;
  lastRain = level; rainLevel(level);
  birds?.gain.setTargetAtTime(.5 * (1 - Math.min(1, level * 1.5)), audio()?.ctx.currentTime ?? 0, 1);
}
