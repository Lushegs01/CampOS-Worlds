// Combat Arena HUD layouts: the model behind the HUD Customization Studio (src/arena/HudEditor.tsx) and the
// live HUD (src/arena/Hud.tsx, src/arena/Touch.tsx). Pure data and functions, shared by the browser and the
// tests, with no DOM access.
//
// Positions are viewport-relative, inside the safe area (notches, rounded corners and home indicators are
// excluded by the renderer with env(safe-area-inset-*)). An element at (x, y) places its own point
// (x · width, y · height) at (x, y) of the safe area: x = 0 is flush left, 1 flush right, 0.5 centred. An
// element can therefore never be pushed off screen, whatever its size or the screen's aspect ratio.
//
// A player has one layout per profile: desktop, touch landscape and touch portrait. Layouts are versioned
// and always validated before use: anything unknown, out of range or damaged is repaired element by element
// (and reported), never trusted, so a bad saved layout can never make the HUD or the touch controls unusable.

export const HUD_VERSION = 1;
export const PROFILES = /** @type {const} */ (['desktop', 'touchLandscape', 'touchPortrait']);
export const PROFILE_NAMES = { desktop: 'Desktop', touchLandscape: 'Touch · landscape', touchPortrait: 'Touch · portrait' };
/** Which layout a device uses right now. */
export function profileFor({ coarse = false, portrait = false } = {}) { return !coarse ? 'desktop' : portrait ? 'touchPortrait' : 'touchLandscape'; }
export const isTouchProfile = p => p === 'touchLandscape' || p === 'touchPortrait';

/**
 * Elements. `touch`: a touchscreen control (only in touch profiles). `movable: false`: drawn at the centre
 * of the screen (the crosshair and hit markers mark where shots go, so they cannot move). `size`: its size
 * in CSS pixels at scale 1, used for minimum touch-target sizes and overlap checks. `required`: cannot be
 * hidden in touch profiles (without them the game cannot be played or left). `align`: text alignment can be
 * chosen. `text`: also follows the global text size.
 */
export const HUD_ELEMENTS = [
  { id: 'crosshair', name: 'Crosshair', group: 'Combat', movable: false, min: .5, max: 3, size: [24, 24] },
  { id: 'hitmarker', name: 'Hit markers', group: 'Combat', movable: false, min: .5, max: 2.5, size: [30, 30] },
  { id: 'killNotify', name: 'Kill notifications', group: 'Combat', min: .6, max: 1.6, size: [420, 70], text: true },
  { id: 'health', name: 'Health', group: 'Player', min: .6, max: 2, size: [240, 34] },
  { id: 'status', name: 'Player status (connection, frame rate)', group: 'Player', min: .7, max: 2, size: [120, 16], text: true },
  { id: 'ammo', name: 'Ammunition', group: 'Weapon', min: .6, max: 2, size: [190, 64], align: true },
  { id: 'weaponInfo', name: 'Current weapon', group: 'Weapon', min: .6, max: 2, size: [200, 52], align: true, text: true },
  { id: 'weaponSlots', name: 'Weapon switching', group: 'Weapon', min: .6, max: 2, size: [260, 20], align: true, text: true },
  { id: 'minimap', name: 'Tactical minimap', group: 'Awareness', min: .5, max: 2, size: [168, 168] },
  { id: 'compass', name: 'Compass', group: 'Awareness', min: .5, max: 1.8, size: [360, 40] },
  { id: 'timer', name: 'Match timer', group: 'Match', min: .6, max: 2, size: [90, 40], text: true },
  { id: 'score', name: 'Team score', group: 'Match', min: .6, max: 2, size: [276, 30] },
  { id: 'objectives', name: 'Objective indicators', group: 'Match', min: .6, max: 2, size: [130, 36] },
  { id: 'killfeed', name: 'Kill feed', group: 'Match', min: .6, max: 1.8, size: [280, 120], align: true, text: true },
  { id: 'streaks', name: 'Killstreak rewards', group: 'Match', min: .6, max: 2, size: [190, 44] },
  // Touchscreen controls.
  { id: 'stick', name: 'Movement joystick', group: 'Touch controls', touch: true, required: true, min: .7, max: 1.6, size: [118, 118], minPx: 84 },
  { id: 'fire', name: 'Fire button', group: 'Touch controls', touch: true, required: true, min: .68, max: 1.8, size: [82, 82], minPx: 56 },
  { id: 'ads', name: 'Aim (ADS) button', group: 'Touch controls', touch: true, min: 0.75, max: 2, size: [54, 54] },
  { id: 'reload', name: 'Reload button', group: 'Touch controls', touch: true, min: 0.84, max: 2, size: [48, 48] },
  { id: 'jump', name: 'Jump button', group: 'Touch controls', touch: true, min: 0.75, max: 2, size: [54, 54] },
  { id: 'crouch', name: 'Crouch button', group: 'Touch controls', touch: true, min: 0.75, max: 2, size: [54, 54] },
  { id: 'sprint', name: 'Sprint button', group: 'Touch controls', touch: true, min: 0.84, max: 2, size: [48, 48] },
  { id: 'swap', name: 'Switch weapon button', group: 'Touch controls', touch: true, min: 0.84, max: 2, size: [48, 48] },
  { id: 'melee', name: 'Melee button', group: 'Touch controls', touch: true, min: 0.84, max: 2, size: [48, 48] },
  { id: 'lethal', name: 'Lethal button', group: 'Touch controls', touch: true, min: 0.84, max: 2, size: [48, 48] },
  { id: 'tactical', name: 'Tactical button', group: 'Touch controls', touch: true, min: 0.84, max: 2, size: [48, 48] },
  { id: 'autofire', name: 'Auto-fire switch', group: 'Touch controls', touch: true, min: 0.87, max: 2, size: [46, 46] },
  { id: 'menu', name: 'Menu and scoreboard', group: 'Touch controls', touch: true, required: true, min: .8, max: 1.8, size: [88, 40] },
];
export const HUD_ELEMENT_BY_ID = new Map(HUD_ELEMENTS.map(e => [e.id, e]));
/** The elements a profile shows (desktop has no touch controls). */
export const elementsFor = profile => HUD_ELEMENTS.filter(e => !e.touch || isTouchProfile(profile));
/** The smallest scale allowed: the element's minimum, and for touch controls at least a 40 px target. */
export function minScale(def) { const px = def.minPx ?? (def.touch ? 40 : 0); return Math.max(def.min, px ? px / Math.max(def.size[0], def.size[1]) : 0); }

export const CROSSHAIR_STYLES = ['cross', 'crossDot', 'dot', 'circle', 'chevron'];
export const CROSSHAIR_NAMES = { cross: 'Cross', crossDot: 'Cross and dot', dot: 'Dot', circle: 'Circle', chevron: 'Chevron' };
export const CROSSHAIR_COLORS = ['#ffffff', '#4dff88', '#ffe14d', '#4de4ff', '#ff4dd2', '#ff5a48'];
export const PRESETS = ['classic', 'competitive', 'minimal', 'mobileStandard', 'mobileClaw', 'custom'];
export const PRESET_NAMES = { classic: 'Classic FPS', competitive: 'Competitive', minimal: 'Minimal', mobileStandard: 'Mobile Standard', mobileClaw: 'Mobile Claw', custom: 'Custom' };
/** The preset a profile starts with. */
export const defaultPreset = profile => (isTouchProfile(profile) ? 'mobileStandard' : 'classic');

// ---------------------------------------------------------------- base positions per profile
const el = (x, y, scale = 1, extra = {}) => ({ x, y, scale, opacity: 1, visible: true, ...extra });
const BASE = {
  desktop: {
    crosshair: el(.5, .5), hitmarker: el(.5, .5), killNotify: el(.5, .26),
    health: el(0, 1), status: el(.5, 1),
    ammo: el(1, 1, 1, { align: 'right' }), weaponInfo: el(1, .885, 1, { align: 'right' }), weaponSlots: el(1, .815, 1, { align: 'right' }),
    minimap: el(0, 0), compass: el(.5, .1), timer: el(.5, 0), score: el(.5, .055), objectives: el(.5, .19),
    killfeed: el(1, 0, 1, { align: 'right' }), streaks: el(0, .9),
  },
  touchLandscape: {
    crosshair: el(.5, .5), hitmarker: el(.5, .5), killNotify: el(.5, .24, .8),
    health: el(.2, 0, .72), status: el(.5, 1, .9),
    ammo: el(1, .33, .6, { align: 'right' }), weaponInfo: el(1, .25, .6, { align: 'right' }), weaponSlots: el(1, .4, .6, { align: 'right', visible: false }),
    minimap: el(0, 0, .62), compass: el(.5, .16, .6), timer: el(.5, 0, .8), score: el(.5, .095, .72), objectives: el(.5, .3, .8),
    killfeed: el(1, 0, .62, { align: 'right' }), streaks: el(.5, .62, .9),
    stick: el(0.125, 0.82), fire: el(0.958, 0.801), ads: el(0.839, 0.673), reload: el(0.828, 0.859), jump: el(0.998, 0.999), crouch: el(0.91, 1), sprint: el(0.059, 0.555, 1, { visible: false }), swap: el(0.948, 0.503), melee: el(0.869, 0.473), lethal: el(0.785, 0.5), tactical: el(0.755, 0.681), autofire: el(0.749, 0.897), menu: el(0, 0.43),
  },
  touchPortrait: {
    crosshair: el(.5, .5), hitmarker: el(.5, .5), killNotify: el(.5, .3, .75),
    health: el(0, .085, .7), status: el(.5, 1, .9),
    ammo: el(1, .62, .62, { align: 'right' }), weaponInfo: el(1, .55, .6, { align: 'right' }), weaponSlots: el(1, .5, .6, { align: 'right', visible: false }),
    minimap: el(0, 0, .6), compass: el(.5, .12, .55), timer: el(.5, 0, .8), score: el(1, 0, .6), objectives: el(.5, .19, .75),
    killfeed: el(1, .11, .65, { align: 'right' }), streaks: el(0, .5, .85),
    stick: el(0.134, 0.921), fire: el(0.899, 0.865), ads: el(0.643, 0.798), reload: el(0.609, 0.884), jump: el(0.961, 0.977), crouch: el(0.779, 0.977), sprint: el(0.108, 0.673, 1, { visible: false }), swap: el(0.892, 0.723), melee: el(0.722, 0.71), lethal: el(0.549, 0.716), tactical: el(0.471, 0.802), autofire: el(0.607, 0.973), menu: el(0, 0.2),
  },
};
const BASE_GLOBAL = { opacity: 1, textScale: 1, iconScale: 1, contrast: 'standard', buttonOpacity: .85 };
const BASE_CROSSHAIR = { style: 'cross', color: '#ffffff', thickness: 2, outline: true };
// Presets change only what differs from the profile's base.
const PRESET_PATCH = {
  classic: { landscape: {}, portrait: {}, desktop: {} },
  mobileStandard: { landscape: {}, portrait: {}, desktop: {} },
  competitive: {
    desktop: { minimap: { scale: 1.2 }, killfeed: { scale: .85 }, weaponSlots: { visible: false }, streaks: { scale: .85 }, health: { scale: .9 }, ammo: { scale: .85 }, weaponInfo: { scale: .85 }, status: { visible: true } },
    landscape: { minimap: { scale: .75 }, compass: { visible: false }, killfeed: { scale: .6 } },
    portrait: { minimap: { scale: .7 }, compass: { visible: false }, killfeed: { scale: .6 } },
    global: { textScale: .9 }, crosshair: { style: 'crossDot', color: '#4dff88', thickness: 1 },
  },
  minimal: {
    desktop: { compass: { visible: false }, weaponSlots: { visible: false }, streaks: { visible: false }, weaponInfo: { visible: false }, status: { visible: false }, score: { scale: .85 }, killfeed: { opacity: .8, scale: .85 } },
    landscape: { compass: { visible: false }, weaponInfo: { visible: false }, swap: { opacity: .7 }, melee: { visible: false }, lethal: { visible: false }, tactical: { visible: false }, autofire: { visible: false }, status: { visible: false } },
    portrait: { compass: { visible: false }, weaponInfo: { visible: false }, melee: { visible: false }, lethal: { visible: false }, tactical: { visible: false }, autofire: { visible: false }, status: { visible: false } },
    global: { opacity: .85, buttonOpacity: .6 }, crosshair: { style: 'dot', thickness: 2 },
  },
  mobileClaw: {
    // Index fingers on the top corners: aim on the left, jump, crouch and sprint on the right; thumbs move and fire.
    desktop: {},
    landscape: { stick: { x: .132, y: .825 }, ads: { x: .014, y: .28, scale: 1.1 }, sprint: { x: .106, y: .28, visible: true }, jump: { x: .988, y: .3, scale: 1.05 }, crouch: { x: .898, y: .3 },
      swap: { x: .816, y: .3 }, melee: { x: .738, y: .32 }, menu: { x: 0, y: .545 }, reload: { x: .846, y: .867 }, fire: { x: .974, y: .798, scale: 1.08 }, lethal: { x: .797, y: .514 }, tactical: { x: .757, y: .681 }, autofire: { x: .755, y: .896 } },
    portrait: { stick: { x: .141, y: .916 }, ads: { x: .03, y: .6 }, sprint: { x: .25, y: .6, visible: true }, jump: { x: .976, y: .6 }, crouch: { x: .794, y: .6 }, tactical: { x: .477, y: .804 } },
    global: {}, crosshair: {},
  },
  custom: { landscape: {}, portrait: {}, desktop: {} },
};
const patchKey = profile => (profile === 'desktop' ? 'desktop' : profile === 'touchPortrait' ? 'portrait' : 'landscape');
const clone = v => JSON.parse(JSON.stringify(v));

/** A complete layout for `profile`, from a preset. */
export function presetLayout(profile, preset = defaultPreset(profile)) {
  if (!PROFILES.includes(profile)) profile = 'desktop';
  if (!PRESETS.includes(preset)) preset = defaultPreset(profile);
  const patch = PRESET_PATCH[preset], elements = {};
  for (const def of elementsFor(profile)) elements[def.id] = { ...BASE[profile][def.id], ...(patch[patchKey(profile)]?.[def.id] ?? {}) };
  return { version: HUD_VERSION, profile, preset, global: { ...BASE_GLOBAL, ...(patch.global ?? {}) }, crosshair: { ...BASE_CROSSHAIR, ...(patch.crosshair ?? {}) }, elements };
}
export function defaultHudStore() {
  return { version: HUD_VERSION, layouts: Object.fromEntries(PROFILES.map(p => [p, presetLayout(p)])), previous: null, updatedAt: 0 };
}

// ---------------------------------------------------------------- validation and repair
const num = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const GLOBAL_RANGES = { opacity: [.3, 1], textScale: [.8, 1.5], iconScale: [.7, 1.5], buttonOpacity: [.2, 1] };
/**
 * A valid layout for `profile` from anything (a saved layout, an older version, a damaged or hostile value).
 * Returns { layout, repaired } where `repaired` names what had to be reset or clamped (empty when the input
 * was valid). Required touch controls are always visible.
 */
export function validateLayout(raw, profile) {
  const repaired = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { layout: presetLayout(profile), repaired: ['layout'] };
  const migrated = migrateLayout(raw, repaired);
  const preset = PRESETS.includes(migrated.preset) ? migrated.preset : (repaired.push('preset'), defaultPreset(profile));
  const base = presetLayout(profile, preset), out = { ...base, elements: {} };
  const g = migrated.global && typeof migrated.global === 'object' ? migrated.global : (repaired.push('global'), {});
  for (const [k, [lo, hi]] of Object.entries(GLOBAL_RANGES)) {
    if (g[k] === undefined) continue;
    if (!num(g[k])) { repaired.push(`global.${k}`); continue; }
    out.global[k] = clamp(g[k], lo, hi); if (out.global[k] !== g[k]) repaired.push(`global.${k}`);
  }
  if (g.contrast !== undefined) { if (g.contrast === 'standard' || g.contrast === 'high') out.global.contrast = g.contrast; else repaired.push('global.contrast'); }
  const c = migrated.crosshair && typeof migrated.crosshair === 'object' ? migrated.crosshair : (migrated.crosshair === undefined ? {} : (repaired.push('crosshair'), {}));
  if (c.style !== undefined) { if (CROSSHAIR_STYLES.includes(c.style)) out.crosshair.style = c.style; else repaired.push('crosshair.style'); }
  if (c.color !== undefined) { if (typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)) out.crosshair.color = c.color.toLowerCase(); else repaired.push('crosshair.color'); }
  if (c.thickness !== undefined) { if (Number.isInteger(c.thickness) && c.thickness >= 1 && c.thickness <= 4) out.crosshair.thickness = c.thickness; else repaired.push('crosshair.thickness'); }
  if (c.outline !== undefined) { if (typeof c.outline === 'boolean') out.crosshair.outline = c.outline; else repaired.push('crosshair.outline'); }
  const elements = migrated.elements && typeof migrated.elements === 'object' && !Array.isArray(migrated.elements) ? migrated.elements : (repaired.push('elements'), {});
  for (const def of elementsFor(profile)) {
    const e = { ...base.elements[def.id] }, r = elements[def.id];
    if (r === undefined) { out.elements[def.id] = e; continue; }
    if (!r || typeof r !== 'object') { repaired.push(def.id); out.elements[def.id] = e; continue; }
    let bad = false;
    if (def.movable !== false) for (const k of ['x', 'y']) if (r[k] !== undefined) { if (num(r[k])) { e[k] = clamp(r[k], 0, 1); bad ||= e[k] !== r[k]; } else bad = true; }
    if (r.scale !== undefined) { if (num(r.scale)) { e.scale = clamp(r.scale, minScale(def), def.max); bad ||= e.scale !== r.scale; } else bad = true; }
    if (r.opacity !== undefined) { if (num(r.opacity)) { e.opacity = clamp(r.opacity, .2, 1); bad ||= e.opacity !== r.opacity; } else bad = true; }
    if (r.visible !== undefined) { if (typeof r.visible === 'boolean') e.visible = r.visible; else bad = true; }
    if (def.required && !e.visible) { e.visible = true; bad = true; }
    if (def.align && r.align !== undefined) { if (['left', 'center', 'right'].includes(r.align)) e.align = r.align; else bad = true; }
    if (bad) repaired.push(def.id);
    out.elements[def.id] = e;
  }
  for (const id of Object.keys(elements)) if (!HUD_ELEMENT_BY_ID.has(id)) repaired.push(`unknown:${String(id).slice(0, 24)}`);
  out.profile = profile; out.preset = preset; out.version = HUD_VERSION;
  return { layout: out, repaired };
}
/** Bring an older layout up to HUD_VERSION. Version 1 is the first; future versions add steps here. */
function migrateLayout(raw, repaired) {
  const v = raw.version;
  if (!Number.isInteger(v) || v < 1) { repaired.push('version'); return { ...raw, version: HUD_VERSION }; }
  // A layout from a newer game version: keep what this version understands, repair the rest.
  if (v > HUD_VERSION) repaired.push('version');
  return raw;
}
/** A valid store (every profile's layout plus the last saved one to restore) from anything. */
export function validateHudStore(raw) {
  const repaired = [], store = defaultHudStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { store, repaired: raw == null ? [] : ['store'] };
  const layouts = raw.layouts && typeof raw.layouts === 'object' ? raw.layouts : {};
  for (const p of PROFILES) if (layouts[p] !== undefined) { const r = validateLayout(layouts[p], p); store.layouts[p] = r.layout; repaired.push(...r.repaired.map(x => `${p}.${x}`)); }
  if (raw.previous && typeof raw.previous === 'object') {
    store.previous = {}; for (const p of PROFILES) if (raw.previous[p] !== undefined) store.previous[p] = validateLayout(raw.previous[p], p).layout;
  }
  store.updatedAt = num(raw.updatedAt) && raw.updatedAt > 0 ? raw.updatedAt : 0;
  return { store, repaired };
}

// ---------------------------------------------------------------- editing (each returns a new layout)
const set = (layout, id, patch) => ({ ...layout, preset: 'custom', elements: { ...layout.elements, [id]: { ...layout.elements[id], ...patch } } });
/** Snap a coordinate to a grid of `grid` steps (0 = off). */
export const snapTo = (v, grid) => (grid > 0 ? Math.round(v * grid) / grid : v);
/** Move an element (x, y within the safe area, 0…1), optionally snapping to a grid. Fixed elements stay put. */
export function moveElement(layout, id, x, y, { grid = 0 } = {}) {
  const def = HUD_ELEMENT_BY_ID.get(id); if (!def || def.movable === false || !layout.elements[id]) return layout;
  return set(layout, id, { x: clamp(snapTo(num(x) ? x : .5, grid), 0, 1), y: clamp(snapTo(num(y) ? y : .5, grid), 0, 1) });
}
/** Resize an element, within its minimum and maximum (touch targets never below 40 px). */
export function resizeElement(layout, id, scale) {
  const def = HUD_ELEMENT_BY_ID.get(id); if (!def || !layout.elements[id]) return layout;
  return set(layout, id, { scale: Math.round(clamp(num(scale) ? scale : 1, minScale(def), def.max) * 100) / 100 });
}
/** Change other properties (visible, opacity, align); required touch controls stay visible. */
export function updateElement(layout, id, patch) {
  const def = HUD_ELEMENT_BY_ID.get(id); if (!def || !layout.elements[id]) return layout;
  const next = {};
  if (typeof patch.visible === 'boolean') next.visible = def.required && isTouchProfile(layout.profile) ? true : patch.visible;
  if (num(patch.opacity)) next.opacity = clamp(patch.opacity, .2, 1);
  if (def.align && ['left', 'center', 'right'].includes(patch.align)) next.align = patch.align;
  return set(layout, id, next);
}
export function updateGlobal(layout, patch) {
  const g = { ...layout.global };
  for (const [k, [lo, hi]] of Object.entries(GLOBAL_RANGES)) if (num(patch[k])) g[k] = clamp(patch[k], lo, hi);
  if (patch.contrast === 'standard' || patch.contrast === 'high') g.contrast = patch.contrast;
  return { ...layout, preset: 'custom', global: g };
}
export function updateCrosshair(layout, patch) {
  const c = { ...layout.crosshair };
  if (CROSSHAIR_STYLES.includes(patch.style)) c.style = patch.style;
  if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) c.color = patch.color.toLowerCase();
  if (Number.isInteger(patch.thickness) && patch.thickness >= 1 && patch.thickness <= 4) c.thickness = patch.thickness;
  if (typeof patch.outline === 'boolean') c.outline = patch.outline;
  return { ...layout, preset: 'custom', crosshair: c };
}
/** Put one element back where the layout's preset has it. */
export function resetElement(layout, id) {
  const base = presetLayout(layout.profile, layout.preset === 'custom' ? defaultPreset(layout.profile) : layout.preset);
  if (!base.elements[id]) return layout;
  return { ...layout, elements: { ...layout.elements, [id]: { ...base.elements[id] } } };
}
/**
 * Alignment guides while dragging: snaps (x, y) to the safe area's centre and edges and to other elements'
 * positions within `threshold`, and says which guides to draw.
 */
export function alignGuides(layout, id, x, y, threshold = .012) {
  const xs = [0, .5, 1], ys = [0, .5, 1];
  for (const [other, e] of Object.entries(layout.elements)) if (other !== id && e.visible && HUD_ELEMENT_BY_ID.get(other)?.movable !== false) { xs.push(e.x); ys.push(e.y); }
  const near = (v, list) => { let best = null; for (const t of list) if (Math.abs(t - v) <= threshold && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t; return best; };
  const gx = near(x, xs), gy = near(y, ys);
  return { x: gx ?? x, y: gy ?? y, guides: [...(gx === null ? [] : [{ axis: 'x', at: gx }]), ...(gy === null ? [] : [{ axis: 'y', at: gy }])] };
}
/**
 * Touch controls follow the screen: drawn at `touchFit` × their scale (smaller phones, larger tablets), but
 * never below their minimum target (40 px, the fire button 56 px, the stick 84 px). The renderer and the
 * overlap check use the same rule.
 */
export function touchFit(width, height) {
  const [rw, rh] = width >= height ? [844, 390] : [390, 844];
  return clamp(Math.min(width / rw, height / rh), .8, 1.35);
}
/** The scale an element is actually drawn at on a safe area of width × height. */
export function drawnScale(def, e, width, height) {
  if (!def.touch) return e.scale;
  return Math.max(e.scale * touchFit(width, height), (def.minPx ?? 40) / Math.max(def.size[0], def.size[1]));
}
/** The on-screen rectangle (CSS px) of an element in a safe area of width × height. */
export function rectOf(layout, id, width, height) {
  const def = HUD_ELEMENT_BY_ID.get(id), e = layout.elements[id]; if (!def || !e) return null;
  const k = drawnScale(def, e, width, height), w = def.size[0] * k, h = def.size[1] * k;
  const x = def.movable === false ? (width - w) / 2 : e.x * (width - w), y = def.movable === false ? (height - h) / 2 : e.y * (height - h);
  return { x, y, w, h };
}
/** Visible touch controls that overlap on a screen of width × height (pairs of ids), so the editor can warn. */
export function touchOverlaps(layout, width, height) {
  const ids = HUD_ELEMENTS.filter(d => d.touch && layout.elements[d.id]?.visible).map(d => d.id), out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = rectOf(layout, ids[i], width, height), b = rectOf(layout, ids[j], width, height);
    if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) out.push([ids[i], ids[j]]);
  }
  return out;
}

// ---------------------------------------------------------------- undo and redo
export function createHistory(limit = 60) { return { past: [], future: [], limit }; }
/** Record `before` as undoable (call with the layout as it was before a change). */
export function pushHistory(h, before) { return { ...h, past: [...h.past, before].slice(-h.limit), future: [] }; }
export function undo(h, current) { if (!h.past.length) return { history: h, layout: current }; return { history: { ...h, past: h.past.slice(0, -1), future: [current, ...h.future] }, layout: h.past.at(-1) }; }
export function redo(h, current) { if (!h.future.length) return { history: h, layout: current }; return { history: { ...h, past: [...h.past, current], future: h.future.slice(1) }, layout: h.future[0] }; }
export { clone as cloneLayout };
