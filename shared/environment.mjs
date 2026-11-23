// The open world's environment: time of day and weather (campus and Metropolitan City; not the Combat Arena, which
// has its own per-match weather variants in shared/arena and src/arena/scene/city/atmosphere.ts).
//
// Everything here is a pure function of a UTC timestamp, so every client in a room sees the same hour and the same
// weather without any network traffic and without touching the room's authoritative simulation: the environment is
// presentation only. Movement, collision, missions and hit registration never read it.
//
// * One in-game day lasts DAY_MINUTES real minutes. The hour is anchored to UTC so a reload, a reconnect or a second
//   player joining all land on the same moment.
// * Weather is chosen per WEATHER_SLOT_MINUTES slot by a seeded hash of the slot number (weighted, with persistence:
//   a slot tends to keep or step from the previous slot's weather rather than jump from clear to storm), and blends
//   into the next state over the first WEATHER_BLEND_MINUTES of each slot.

export const DAY_MINUTES = 48;
export const WEATHER_SLOT_MINUTES = 24;
export const WEATHER_BLEND_MINUTES = 3;
/** Offset (hours) so that the cycle does not start at midnight on the UTC epoch. */
const HOUR_OFFSET = 9.5;

/** Named hours for fixed presets (settings and QA). */
export const TIMES = {
  sunrise: 6.1, morning: 8.6, midday: 12.4, afternoon: 15.2, golden: 17.35, sunset: 18.05, dusk: 18.6, night: 22.5,
};
export const TIME_NAMES = Object.keys(TIMES);

/**
 * Weather states as physical parameters (all 0..1 unless noted):
 * cloud cover, overcast (flat grey sky, diffuse light), rain intensity, surface wetness reached at equilibrium,
 * puddles, fog (extra aerial extinction), wind, lightning rate (flashes per minute).
 */
export const WEATHER = {
  clear:      { cloud: .28, overcast: 0,   rain: 0,   wet: 0,   puddles: 0,   fog: 0,   wind: .25, lightning: 0 },
  overcast:   { cloud: .85, overcast: .75, rain: 0,   wet: 0,   puddles: 0,   fog: .12, wind: .4,  lightning: 0 },
  lightRain:  { cloud: .9,  overcast: .8,  rain: .35, wet: .7,  puddles: .35, fog: .25, wind: .45, lightning: 0 },
  heavyRain:  { cloud: 1,   overcast: .95, rain: .8,  wet: 1,   puddles: .8,  fog: .45, wind: .65, lightning: 0 },
  storm:      { cloud: 1,   overcast: 1,   rain: 1,   wet: 1,   puddles: 1,   fog: .5,  wind: 1,   lightning: 5 },
  fog:        { cloud: .6,  overcast: .6,  rain: 0,   wet: .25, puddles: 0,   fog: 1,   wind: .08, lightning: 0 },
};
export const WEATHER_NAMES = Object.keys(WEATHER);
const KEYS = Object.keys(WEATHER.clear);

// Transition weights from one slot's weather to the next: mostly persistent, rain builds through overcast,
// storms subside through heavy rain. Rows sum to anything (normalised at use).
const NEXT = {
  clear:     { clear: 6, overcast: 2, fog: .6, lightRain: .4 },
  overcast:  { clear: 2.5, overcast: 2, lightRain: 2, heavyRain: .6, fog: .4 },
  lightRain: { overcast: 2, lightRain: 2, heavyRain: 1.2, storm: .3, clear: .6 },
  heavyRain: { lightRain: 2, heavyRain: 1.2, storm: .8, overcast: 1 },
  storm:     { heavyRain: 2.5, lightRain: 1, storm: .5 },
  fog:       { clear: 2.5, overcast: 1.5, fog: .8 },
};

/** Deterministic hash of an integer into [0, 1). */
export function hash01(n) {
  let x = (Math.floor(n) | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function pick(row, u) {
  const entries = Object.entries(row), total = entries.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [k, w] of entries) { acc += w / total; if (u < acc) return k; }
  return entries[entries.length - 1][0];
}

// A weather chain is walked from an anchor slot so that consecutive slots are correlated. Walking from a fixed
// anchor every call would be O(slots since epoch), so the chain restarts (from clear) every CHAIN slots: each slot's
// weather depends on at most CHAIN - 1 predecessors and is still identical on every client.
const CHAIN = 12;
/** Weather name for an absolute slot index. */
export function weatherForSlot(slot) {
  const start = slot - (((slot % CHAIN) + CHAIN) % CHAIN);
  let w = 'clear';
  for (let s = start + 1; s <= slot; s++) w = pick(NEXT[w], hash01(s * 7919 + 17));
  return w;
}

/** Hour of day (0..24) at a UTC time in milliseconds. */
export function hourAt(ms) {
  const days = ms / 60000 / DAY_MINUTES;
  return (((days - Math.floor(days)) * 24 + HOUR_OFFSET) % 24 + 24) % 24;
}

const smooth = t => t * t * (3 - 2 * t);
/** Linear blend of two weather parameter sets. */
export function mixWeather(a, b, t) {
  const A = typeof a === 'string' ? WEATHER[a] : a, B = typeof b === 'string' ? WEATHER[b] : b, out = {};
  for (const k of KEYS) out[k] = A[k] + (B[k] - A[k]) * t;
  return out;
}

/** The live environment at a UTC time: hour, the weather being left and entered, and the blended parameters. */
export function environmentAt(ms) {
  const slotMs = WEATHER_SLOT_MINUTES * 60000, slot = Math.floor(ms / slotMs), into = (ms - slot * slotMs) / 60000;
  const from = weatherForSlot(slot - 1), to = weatherForSlot(slot);
  const blend = smooth(Math.min(1, into / WEATHER_BLEND_MINUTES));
  return { hour: hourAt(ms), from, to, blend, weather: blend >= 1 ? to : blend < .5 ? from : to, params: mixWeather(from, to, blend) };
}

/**
 * Sun direction (unit vector, y up, +x east, +z south as in the world's map) for an hour of day. Equatorial
 * latitude (~6.5° N, the city's setting) near equinox: sunrise ~6:00, sunset ~18:00, a high noon sun slightly to the
 * south. Returns elevation in radians as well.
 */
export function sunDirection(hour, latitude = 6.5, declination = -8) {
  const H = (hour - 12) / 24 * Math.PI * 2, lat = latitude * Math.PI / 180, dec = declination * Math.PI / 180;
  // Horizontal coordinates: east, north, up.
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const len = Math.hypot(east, north, up) || 1;
  // The world's map: +z is south (the campus looks south down the expressway to the city) and the afternoon sun
  // stands over +x, as in the photographic sky the campus was originally lit by, so +x is west.
  return { x: -east / len, y: up / len, z: -north / len, elevation: Math.asin(up / len) };
}

/** 0 in daylight, 1 at night, by the sun's elevation (civil twilight in between). */
export function nightAmount(elevation) {
  const deg = elevation * 180 / Math.PI;
  return deg >= 2 ? 0 : deg <= -8 ? 1 : (2 - deg) / 10;
}

/** Validates a saved setting: 'live' or a named preset. */
export function sanitizeTime(v) { return v === 'live' || Object.hasOwn(TIMES, v) ? v : 'live'; }
export function sanitizeWeather(v) { return v === 'live' || Object.hasOwn(WEATHER, v) ? v : 'live'; }

/**
 * The environment the client should show, given the player's settings: a fixed time and/or weather overrides the
 * live cycle; anything left on 'live' follows the shared schedule.
 */
export function resolveEnvironment(ms, time = 'live', weather = 'live') {
  const live = environmentAt(ms);
  const hour = time === 'live' ? live.hour : TIMES[time];
  if (weather === 'live') return { ...live, hour };
  return { hour, from: weather, to: weather, blend: 1, weather, params: { ...WEATHER[weather] } };
}
