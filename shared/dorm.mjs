// Personal rooms in the residents' wing behind Palm House (Palm Residences). There is one physical room;
// every resident who goes in is in it, but the room server keeps each in their own space: residents see
// only their own furniture and only the players in the same space. Shared by rendering, the arrange-room
// editor, client movement and the room server's validation, so all of them agree.
import { BUILDINGS } from './expansion.mjs';

const PALM = BUILDINGS.find(b => b.id === 'residential-0');
/** Centre line of Palm House's back wall (0.4 m thick); the wing is built against it, to the north. */
const BACK = PALM.z - PALM.d / 2;
/** The room's floor in world metres (x0..x1, z0..z1). Furniture positions are relative to (x0, z0). */
export const DORM_ROOM = { x0: PALM.x + 3.5, x1: PALM.x + 11, z0: BACK - .2 - 5.5, z1: BACK - .2, height: 3 };
export const DORM_W = DORM_ROOM.x1 - DORM_ROOM.x0, DORM_D = DORM_ROOM.z1 - DORM_ROOM.z0;
/**
 * The door between the common room and the wing, in a gap between Palm House's back windows. `outside`
 * and `inside` are where a player stands after going through; `face` is the door's centre on each side.
 */
export const DORM_DOOR = { x: PALM.x + 6.8, outsideFace: BACK + .2, insideFace: BACK - .2 };
export const DORM_OUTSIDE = { x: DORM_DOOR.x, z: BACK + .2 + .9, yaw: 0 };
// Arrivals stand 2.2 m in, so the third-person camera has room behind them.
export const DORM_INSIDE = { x: DORM_DOOR.x, z: DORM_ROOM.z1 - 2.2, yaw: Math.PI };
/** How close to the door (either side) a player must be to go through it. */
export const DORM_REACH = 2.2;
/** Kept clear of furniture (room-relative): the doorway and where arrivals stand, so they can always move. */
export const DOOR_CLEARANCE = { x0: DORM_DOOR.x - DORM_ROOM.x0 - .8, x1: DORM_DOOR.x - DORM_ROOM.x0 + .8, z0: DORM_D - 2.7, z1: DORM_D };
/** The wing's outer walls (the fourth side is Palm House's back wall): shared colliders for everyone. */
export const DORM_WALLS = [
  { x: DORM_ROOM.x0 - .15, z: (DORM_ROOM.z0 - .3 + BACK) / 2, w: .3, d: BACK - DORM_ROOM.z0 + .3, h: 3.4 },
  { x: DORM_ROOM.x1 + .15, z: (DORM_ROOM.z0 - .3 + BACK) / 2, w: .3, d: BACK - DORM_ROOM.z0 + .3, h: 3.4 },
  { x: (DORM_ROOM.x0 + DORM_ROOM.x1) / 2, z: DORM_ROOM.z0 - .15, w: DORM_W + .6, d: .3, h: 3.4 },
];
export const inDormRoom = (x, z) => x > DORM_ROOM.x0 && x < DORM_ROOM.x1 && z > DORM_ROOM.z0 && z < DORM_ROOM.z1;
export const nearDormDoor = (x, z, inside) => Math.hypot(x - DORM_DOOR.x, z - (inside ? DORM_DOOR.insideFace : DORM_DOOR.outsideFace)) < DORM_REACH;

/**
 * The furniture catalogue: footprint w × d and height in metres (front faces +z when unrotated), how many
 * a room may hold, whether it takes a colour (`tones`) and whether it lies on the floor (`floor`, walkable).
 * @type {Record<string, { name: string, w: number, d: number, h: number, max: number, tones?: boolean, floor?: boolean }>}
 */
export const FURNITURE = {
  bed: { name: 'Bed', w: 2, d: 1, h: .55, max: 1, tones: true },
  nightstand: { name: 'Bedside table', w: .5, d: .4, h: .55, max: 2 },
  desk: { name: 'Desk', w: 1.25, d: .6, h: .76, max: 2 },
  chair: { name: 'Desk chair', w: .5, d: .5, h: .9, max: 3 },
  wardrobe: { name: 'Wardrobe', w: 1, d: .6, h: 2, max: 2 },
  shelf: { name: 'Bookshelf', w: .8, d: .3, h: 1.6, max: 3 },
  beanbag: { name: 'Beanbag', w: .8, d: .8, h: .6, max: 2, tones: true },
  lamp: { name: 'Floor lamp', w: .35, d: .35, h: 1.6, max: 2 },
  plant: { name: 'Plant', w: .45, d: .45, h: 1.1, max: 4 },
  rug: { name: 'Rug', w: 1.75, d: 1.25, h: .02, max: 2, floor: true, tones: true },
};
export const FURNITURE_TYPES = Object.keys(FURNITURE);
export const TONES = ['#5b7fa6', '#b05f49', '#537d70', '#e8b95e'];
export const MAX_ITEMS = 16;
/** Positions are kept to 5 cm. */
export const SNAP = .05;

/** A new resident's room: bed, desk and chair, wardrobe, a shelf, a rug and a plant. */
export const DEFAULT_LAYOUT = { items: [
  { t: 'bed', x: 1, z: .5, r: 0, c: 0 }, { t: 'nightstand', x: 2.3, z: .2, r: 0, c: 0 },
  { t: 'desk', x: 7.2, z: 1.3, r: 3, c: 0 }, { t: 'chair', x: 6.45, z: 1.3, r: 1, c: 0 },
  { t: 'wardrobe', x: 5.6, z: .3, r: 0, c: 0 }, { t: 'shelf', x: 3.9, z: .15, r: 0, c: 0 },
  { t: 'rug', x: 3.4, z: 2.4, r: 0, c: 1 }, { t: 'beanbag', x: 1.2, z: 3.4, r: 0, c: 2 }, { t: 'plant', x: 7.2, z: 5.2, r: 0, c: 0 },
] };

/** Room-relative footprint of an item: { x0, x1, z0, z1 }. A quarter turn swaps width and depth. */
export function footprint(item) {
  const f = FURNITURE[item.t], turned = item.r % 2 === 1, w = turned ? f.d : f.w, d = turned ? f.w : f.d;
  return { x0: item.x - w / 2, x1: item.x + w / 2, z0: item.z - d / 2, z1: item.z + d / 2 };
}
const EPS = 1e-6;
const overlaps = (a, b) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
const snapped = v => Math.abs(v / SNAP - Math.round(v / SNAP)) < 1e-4;
const round = v => Math.round(Math.round(v / SNAP) * SNAP * 100) / 100;

/**
 * Check a layout sent by a player and return a clean copy ({ ok, layout }) or a reason ({ ok: false, reason }).
 * Client values are never trusted: unknown fields are dropped, every item must be a catalogue piece inside
 * the room, solid pieces may not overlap each other or the space inside the door, rugs may not overlap rugs.
 */
export function validateLayout(raw) {
  const list = raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw.items : null;
  if (!list) return { ok: false, reason: 'That room layout could not be read.' };
  if (list.length > MAX_ITEMS) return { ok: false, reason: `A room holds up to ${MAX_ITEMS} pieces of furniture.` };
  const items = [], counts = {};
  for (const it of list) {
    if (!it || typeof it !== 'object' || typeof it.t !== 'string' || !Object.hasOwn(FURNITURE, it.t)) return { ok: false, reason: 'That piece of furniture is not in the catalogue.' };
    const f = FURNITURE[it.t], r = it.r ?? 0, c = it.c ?? 0;
    if (typeof it.x !== 'number' || typeof it.z !== 'number' || !Number.isFinite(it.x) || !Number.isFinite(it.z) || !snapped(it.x) || !snapped(it.z)) return { ok: false, reason: 'A piece of furniture has an invalid position.' };
    if (!Number.isInteger(r) || r < 0 || r > 3 || !Number.isInteger(c) || c < 0 || c >= TONES.length) return { ok: false, reason: 'A piece of furniture has an invalid turn or colour.' };
    counts[it.t] = (counts[it.t] ?? 0) + 1;
    if (counts[it.t] > f.max) return { ok: false, reason: `A room can have ${f.max === 1 ? 'one' : `up to ${f.max}`} ${f.name.toLowerCase()}${f.max === 1 ? '' : 's'}.` };
    const item = { t: it.t, x: round(it.x), z: round(it.z), r, c: f.tones ? c : 0 }, box = footprint(item);
    if (box.x0 < -EPS || box.z0 < -EPS || box.x1 > DORM_W + EPS || box.z1 > DORM_D + EPS) return { ok: false, reason: `The ${f.name.toLowerCase()} doesn’t fit there: keep it inside the room.` };
    if (!f.floor && overlaps(box, DOOR_CLEARANCE)) return { ok: false, reason: 'Keep the space inside the door clear.' };
    for (const other of items) {
      const g = FURNITURE[other.t];
      if (!!f.floor === !!g.floor && overlaps(box, footprint(other))) return { ok: false, reason: `The ${f.name.toLowerCase()} overlaps the ${g.name.toLowerCase()}.` };
    }
    items.push(item);
  }
  return { ok: true, layout: { items } };
}

/**
 * Is a body at world (x, z) inside solid furniture of this layout? Movement uses it as a veto for
 * stepping into a piece (stepping out is always allowed, so a piece placed on a player cannot trap them).
 */
export function furnitureBlocked(layout, x, z, radius = .25) {
  if (!layout || !inDormRoom(x, z)) return false;
  const lx = x - DORM_ROOM.x0, lz = z - DORM_ROOM.z0;
  for (const it of layout.items) {
    if (FURNITURE[it.t].floor) continue;
    const b = footprint(it);
    if (lx > b.x0 - radius && lx < b.x1 + radius && lz > b.z0 - radius && lz < b.z1 + radius) return true;
  }
  return false;
}
/** The veto for a walking substep from (fx, fz) to (x, z): entering a piece is refused, leaving one is not. */
export const furnitureAllows = (layout, x, z, fx, fz) => !layout || !furnitureBlocked(layout, x, z) || furnitureBlocked(layout, fx, fz);
