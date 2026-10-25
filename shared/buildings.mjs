// Building availability: how complete each staffed campus building is, as an explicit percentage.
// There is no construction gameplay: the rendered geometry says nothing about completion, so these
// numbers are configuration. Campus characters (shared/npcs.mjs) appear in a building only once its
// completion reaches their own activation threshold.
//
// The defaults below are what every room and offline client starts from. A room operator can override
// them at start-up (BUILDING_COMPLETION=studio-d1=70,courtyard-cafe=35) or change them on a live room
// through the admin endpoint (POST /admin/buildings); a live change lasts until the room restarts.
import { LOCATIONS } from './campus.mjs';
import { CLASSROOM } from './interactions.mjs';
import { LAB } from './economic-lab.mjs';
import { BUILDINGS as DISTRICT_BUILDINGS } from './expansion.mjs';
import { CLASSROOMS } from './classes.mjs';

/** Bumped whenever a building is added or removed, or a default changes meaning. */
export const BUILDING_CONFIG_VERSION = 1;

const PALM = DISTRICT_BUILDINGS.find(b => b.id === 'residential-0');
/**
 * id, name, the place it belongs to (a LOCATIONS id from shared/campus.mjs, or a CLASSROOMS id from
 * shared/classes.mjs for Studio D1, which has no map marker of its own), its completion (0–100 %),
 * whether it is open at all, and `region`: the floor area its staff work in (x0..x1, z0..z1, metres).
 * @type {readonly { id: string, name: string, location: string, completion: number, available: boolean, region: { x0: number, x1: number, z0: number, z1: number } }[]}
 */
export const CAMPUS_BUILDINGS = Object.freeze([
  // Studio D1 at 85 % and the café at 60 %: the teacher (80 %) and the vendor (40 %) are on duty from the start.
  { id: 'studio-d1', name: 'Studio D1', location: 'classroom-d1', completion: 85, available: true, region: { x0: CLASSROOM.x0, x1: CLASSROOM.x1, z0: CLASSROOM.z0, z1: CLASSROOM.z1 } },
  { id: 'courtyard-cafe', name: 'Courtyard Café', location: 'student', completion: 60, available: true, region: { x0: 18.1, x1: 41.9, z0: -12.3, z1: -4.7 } },
  { id: 'adunni-library', name: 'Adunni Learning Commons', location: 'library', completion: 75, available: true, region: { x0: -41.5, x1: -18.5, z0: -25.5, z1: -4.6 } },
  { id: 'campos-connect', name: 'CampOS Connect', location: 'services', completion: 100, available: true, region: { x0: -27, x1: -19, z0: 20, z1: 26.5 } },
  { id: 'horizon-auditorium', name: 'Horizon Auditorium', location: 'lecture', completion: 90, available: true, region: { x0: -16, x1: 16, z0: -34.2, z1: -26 } },
  { id: 'the-courts', name: 'The Courts', location: 'sports', completion: 100, available: true, region: { x0: 32.6, x1: 55.4, z0: 8.6, z1: 39.4 } },
  { id: 'palm-house', name: 'Palm House', location: 'residential-0', completion: 80, available: true, region: { x0: PALM.x - PALM.w / 2 + .2, x1: PALM.x + PALM.w / 2 - .2, z0: PALM.z - PALM.d / 2 + .2, z1: PALM.z + PALM.d / 2 - .2 } },
  { id: 'economic-lab', name: LAB.name, location: 'economic-lab', completion: 100, available: true, region: { x0: -63.5, x1: -46.5, z0: 17.5, z1: 26.6 } },
  { id: 'welcome-pavilion', name: 'Welcome Pavilion', location: 'orientation', completion: 100, available: true, region: { x0: -17, x1: -7, z0: 22.5, z1: 30 } },
  { id: 'campus-grounds', name: 'Courtyard gardens', location: 'orientation', completion: 100, available: true, region: { x0: -17.5, x1: -7.5, z0: 13, z1: 21.5 } },
].map(b => Object.freeze({ ...b, region: Object.freeze(b.region) })));
export const BUILDING_BY_ID = new Map(CAMPUS_BUILDINGS.map(b => [b.id, b]));
/** A real campus place: a map location or a classroom. */
export const isPlace = id => LOCATIONS.some(l => l.id === id) || CLASSROOMS.some(c => c.id === id);

/** A completion percentage: a finite number from 0 to 100 (a numeric string from configuration is read as one). */
export function validCompletion(value) {
  const n = typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Problems with a building list (empty when it is valid): unique ids, real locations, valid percentages and regions. */
export function validateBuildings(list = CAMPUS_BUILDINGS) {
  const problems = [], seen = new Set();
  if (!Array.isArray(list) || !list.length) return ['No buildings are configured.'];
  for (const b of list) {
    const id = typeof b?.id === 'string' ? b.id : '';
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) { problems.push(`A building has an invalid id (${JSON.stringify(b?.id)}).`); continue; }
    if (seen.has(id)) problems.push(`${id}: duplicate id.`); seen.add(id);
    if (typeof b.name !== 'string' || !b.name.trim()) problems.push(`${id}: missing name.`);
    if (!isPlace(b.location)) problems.push(`${id}: unknown location ${JSON.stringify(b.location)}.`);
    if (validCompletion(b.completion) === null || typeof b.completion !== 'number') problems.push(`${id}: completion must be a number from 0 to 100.`);
    if (typeof b.available !== 'boolean') problems.push(`${id}: available must be true or false.`);
    const r = b.region;
    if (!r || ![r.x0, r.x1, r.z0, r.z1].every(Number.isFinite) || r.x0 >= r.x1 || r.z0 >= r.z1) problems.push(`${id}: region must be a box with x0 < x1 and z0 < z1.`);
  }
  return problems;
}

/**
 * Operator overrides, as "id=percent" pairs separated by commas ("studio-d1=70,courtyard-cafe=35").
 * Unknown ids and out-of-range values are refused with a message (the room then does not start).
 * @returns {Record<string, number>}
 */
export function parseCompletionOverrides(text = '') {
  const out = {};
  for (const part of String(text).split(',').map(s => s.trim()).filter(Boolean)) {
    const [id, value, extra] = part.split('=').map(s => s.trim());
    if (extra !== undefined || !BUILDING_BY_ID.has(id)) throw new Error(`BUILDING_COMPLETION: unknown building "${id}". Known: ${[...BUILDING_BY_ID.keys()].join(', ')}.`);
    const n = validCompletion(value);
    if (n === null) throw new Error(`BUILDING_COMPLETION: ${id} must be a percentage from 0 to 100.`);
    out[id] = n;
  }
  return out;
}

/**
 * The live completion state: the defaults with overrides applied. `set` validates every change; the
 * state never holds an invalid value, and `revision` counts real changes only.
 */
export function createBuildingState(overrides = {}) {
  const live = new Map(CAMPUS_BUILDINGS.map(b => [b.id, { completion: b.completion, available: b.available }]));
  let revision = 0;
  for (const [id, value] of Object.entries(overrides ?? {})) { const n = validCompletion(value); if (live.has(id) && n !== null) live.get(id).completion = n; }
  return {
    get revision() { return revision; },
    get: id => live.get(id) ?? null,
    /** Change one building's completion and/or availability. Returns { ok, changed } or { ok: false, reason }. */
    set(id, { completion, available } = {}) {
      const b = live.get(typeof id === 'string' ? id : '');
      if (!b) return { ok: false, reason: 'Unknown building.' };
      const n = completion === undefined ? b.completion : validCompletion(completion);
      if (n === null || typeof completion === 'string') return { ok: false, reason: 'Completion must be a number from 0 to 100.' };
      if (available !== undefined && typeof available !== 'boolean') return { ok: false, reason: 'Available must be true or false.' };
      const next = { completion: n, available: available ?? b.available }, changed = next.completion !== b.completion || next.available !== b.available;
      Object.assign(b, next); if (changed) revision++;
      return { ok: true, changed };
    },
    snapshot: () => CAMPUS_BUILDINGS.map(b => ({ id: b.id, name: b.name, ...live.get(b.id) })),
    /** Apply a room's snapshot (client side): unknown ids and invalid values are ignored. */
    load(list) { let changed = false; for (const s of Array.isArray(list) ? list : []) { const b = live.get(s?.id), n = validCompletion(s?.completion); if (!b || n === null || typeof s.available !== 'boolean') continue; if (b.completion !== n || b.available !== s.available) { b.completion = n; b.available = s.available; changed = true; } } if (changed) revision++; return changed; },
  };
}
