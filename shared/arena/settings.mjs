// Combat Arena player settings: defaults and validation. The browser keeps them on the device and, for
// signed-in players, in their account (arena_preferences); either copy is validated here before use, so a
// damaged or older value falls back field by field to the defaults.

/** Auto-fire is off until the player turns it on. */
export const DEFAULT_AUTO_FIRE = false;
export const QUALITIES = ['low', 'medium', 'high'];
/** Sound levels per category (the game's master volume is the campus Volume setting). */
export const VOLUME_KEYS = ['volWeapons', 'volExplosions', 'volEnvironment', 'volFootsteps', 'volCharacter', 'volUi'];
const RANGES = { mouse: [.2, 3], ads: [.3, 1.5], touch: [.3, 3], pad: [.3, 3], fov: [60, 100], renderScale: [.5, 1], ...Object.fromEntries(VOLUME_KEYS.map(k => [k, [0, 1]])) };
const BOOLS = ['invertY', 'showFps', 'autoSprint', 'autoFire', 'adaptive', 'fixedStick'];

/** Defaults; `quality` is the device's recommendation (src/world/quality.ts). */
export function defaultArenaSettings(quality = 'medium') {
  return { mouse: 1, ads: .8, touch: 1, pad: 1, invertY: false, fov: 78, quality: QUALITIES.includes(quality) ? quality : 'medium', qualityChosen: false,
    showFps: false, autoSprint: true, autoFire: DEFAULT_AUTO_FIRE, adaptive: true, renderScale: 1, fixedStick: false,
    volWeapons: 1, volExplosions: 1, volEnvironment: .85, volFootsteps: 1, volCharacter: .9, volUi: .8 };
}
/** A valid settings object from anything, keeping every valid field of `raw`. */
export function parseArenaSettings(raw, quality = 'medium') {
  const out = defaultArenaSettings(quality);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, [lo, hi]] of Object.entries(RANGES)) if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = Math.min(hi, Math.max(lo, raw[k]));
  for (const k of BOOLS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  if (QUALITIES.includes(raw.quality)) out.quality = raw.quality;
  if (typeof raw.qualityChosen === 'boolean') out.qualityChosen = raw.qualityChosen;
  return out;
}
/** The settings worth keeping in the account (device-specific ones, like graphics quality, stay on the device). */
export const SYNCED_SETTINGS = ['mouse', 'ads', 'touch', 'pad', 'invertY', 'fov', 'showFps', 'autoSprint', 'autoFire', 'fixedStick', ...VOLUME_KEYS];
export const syncedSettings = s => Object.fromEntries(SYNCED_SETTINGS.map(k => [k, s[k]]));
