import { PLAZA } from '../world/layout';
import { audio, loadSounds, loop, type Loop } from './mixer';
import { indoors } from './surface';

// The campus around you: birdsong and a light breeze outdoors, the fountain's water in the courtyard, all
// muffled (quieter and duller, as through walls) when you step inside a building or your room.

let birds: Loop | null = null, wind: Loop | null = null, water: Loop | null = null, inside = false;
const FOUNTAIN = { x: PLAZA.x, y: .6, z: PLAZA.z };

/** Each frame while on campus, with where you are. */
export function tickAmbience(x: number, z: number) {
  const m = audio();
  if (!m) { stopAmbience(); return; }
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
export function stopAmbience() { for (const l of [birds, wind, water]) l?.stop(1); birds = wind = water = null; }
