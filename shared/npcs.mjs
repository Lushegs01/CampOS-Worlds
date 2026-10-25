// Campus characters (NPCs): who works where, how they look, how they move and what you can ask them.
// Shared by the renderer, the interaction prompts, the offline client and the authoritative room server,
// so every one of them computes the same character in the same place at the same moment.
//
// A character is data: a definition below, plus (optionally) dialogue topics in src/npc/dialogue.tsx.
// Nothing about a character is random. Where it stands is a pure function of its definition, the room's
// clock and a small shared state (the routine's start, who is talking to it), see npcPose().
//
// Lifecycle: a character is on duty only while its building is available and at least as complete as its
// activation threshold (shared/buildings.mjs), its definition is valid and any working hours allow. The
// director keeps one instance per id; crossing a threshold again never creates a second one.
import { collidersIn, PLAYER_RADIUS, MODELS, SKINS, ACCENTS, ACCESSORIES, doorOpen } from './campus.mjs';
import { DOORS, SEATS, seatApproach, BALLS, POINTS } from './interactions.mjs';
import { LOCKED_ACCENTS } from './achievements.mjs';
import { LAB_STATIONS } from './economic-lab.mjs';
import { DORM_OUTSIDE, inDormRoom } from './dorm.mjs';
import { WORLD_LIMIT } from './expansion.mjs';
import { BUILDING_BY_ID, createBuildingState } from './buildings.mjs';
import { validateOrder, ORDER_READY_S } from './cafe.mjs';

/** Behaviour states a character can be in (each role uses only the ones its routine needs). */
export const NPC_STATES = Object.freeze(['inactive', 'idle', 'working', 'walking', 'greeting', 'interacting', 'returning']);
/** What a character does while it waits at a stop. `reach` and `tend` repeat a gesture every few seconds. */
export const NPC_ACTIVITIES = Object.freeze(['idle', 'hold', 'reach', 'tend', 'look']);
/** Props a character may carry (drawn in the hands while it holds them; src/npc/props.ts). */
export const NPC_PROPS = Object.freeze(['tablet', 'clipboard', 'cup', 'book']);
/** Top walking speed (m/s): an unhurried indoor pace. Starts and stops ease in and out. */
export const NPC_WALK_SPEED = 1.1;
/** Extra reach the room allows on top of a character's talk range (the room's view of a player lags a little). */
export const TALK_SLACK = .6;
/** A conversation ends when its player walks this far away, leaves, or after ATTENTION_MS. */
export const LEAVE_RANGE = 6, ATTENTION_MS = 300_000, MAX_ATTENDING = 4;
/** Greeting: a wave for someone who comes within this radius, at most once per GREET_COOLDOWN_MS per character. */
export const GREET_RADIUS = 4.2, GREET_COOLDOWN_MS = 20_000, GREET_REPEAT_MS = 90_000;
/** A gesture (wave, cheer, serve) is shown for this long after it starts. */
export const GESTURE_MS = 3000;
/** Colliders at most this tall (counters, desks, low shelves) do not block talking across them. */
const TALL = 1.3;
const CUE_FIRST = 800, CUE_EVERY = 5500, CUE_LENGTH = 2000;

// ------------------------------------------------------------------ the cast
// Positions are world metres (+x east, +z south); yaw 0 faces +z (south), π/2 faces +x (east).
// `home` is where a character works; every routine step walks between home and one waypoint (a star),
// so the way back home from anywhere along a routine is a straight line that has been checked.
const def = d => Object.freeze({ greet: true, prop: null, hours: null, reacts: null, serves: null, ...d, talk: Object.freeze({ range: 2.6, priority: 5, ...d.talk }) });
export const NPCS = Object.freeze([
  def({
    id: 'teacher', name: 'Ms Ifeoma Okafor', role: 'Teacher', title: 'Design tutor · Studio D1', building: 'studio-d1', threshold: 80,
    description: 'Runs the Studio D1 design brief from the whiteboard and helps students find their next step.',
    greeting: 'Welcome to Studio D1. Today’s brief is on the board: make one corner of campus more welcoming.',
    appearance: { model: 'ngozi', skin: 'natural', accent: '#537d70', accessory: 'glasses' }, prop: 'tablet',
    home: { x: 36.35, z: -42.1, yaw: 0 },
    waypoints: { board: { x: 33.05, z: -42.45, yaw: Math.PI }, desk: { x: 32.6, z: -42.55, yaw: .3 }, front: { x: 35.05, z: -41.25, yaw: 0 } },
    routine: [['home', 14, 'hold'], ['board', 9, 'reach'], ['home', 8, 'idle'], ['desk', 10, 'hold'], ['home', 10, 'look'], ['front', 8, 'idle']],
    talk: { label: 'Talk to teacher', range: 2.8 },
  }),
  def({
    id: 'vendor', name: 'Tolu', role: 'Café vendor', title: 'Courtyard Café counter', building: 'courtyard-cafe', threshold: 40,
    description: 'Serves the Courtyard Café counter: the menu and demo orders (nothing is ever charged).',
    greeting: 'Good afternoon! The jollof is fresh. Have a look at the menu and tell me what you’d like.',
    appearance: { model: 'ada', skin: 'natural', accent: '#b05f49', accessory: 'cap' }, prop: 'cup',
    home: { x: 26.6, z: -11.55, yaw: 0 },
    waypoints: { espresso: { x: 24.4, z: -11.6, yaw: 0 }, shelf: { x: 28.3, z: -11.75, yaw: Math.PI }, till: { x: 29.4, z: -11.55, yaw: 0 } },
    routine: [['home', 12, 'idle'], ['espresso', 7, 'reach'], ['home', 6, 'idle'], ['shelf', 6, 'reach'], ['home', 10, 'idle'], ['till', 6, 'idle']],
    // Across the counter. While she is on duty the counter's own prompt ("Order at the counter") opens a
    // conversation with her at the order form (`serves`); below the threshold the counter works by itself.
    talk: { label: 'Talk to vendor', range: 3.4, priority: 7 },
    serves: { fixture: 'cafe-counter', topic: 'order' },
  }),
  def({
    id: 'librarian', name: 'Mrs Hauwa Musa', role: 'Librarian', title: 'Issue desk · Adunni Learning Commons', building: 'adunni-library', threshold: 60,
    description: 'Looks after the issue desk: finding books, the catalogue computers and the New Arrivals display.',
    greeting: 'Hello, and welcome to the Learning Commons. What are you looking for today?',
    appearance: { model: 'zainab', skin: 'natural', accent: '#506b96', accessory: 'glasses' }, prop: 'book',
    home: { x: -22.65, z: -8.65, yaw: 0 },
    waypoints: { returns: { x: -22.0, z: -9.45, yaw: Math.PI / 2 }, shelf: { x: -22.35, z: -14.4, yaw: Math.PI / 2 } },
    routine: [['home', 16, 'idle'], ['returns', 7, 'reach'], ['home', 10, 'look'], ['shelf', 9, 'reach']],
    talk: { label: 'Ask librarian', range: 2.8 },
  }),
  def({
    id: 'services-officer', name: 'Mr Chinedu Eze', role: 'Student services officer', title: 'CampOS Connect', building: 'campos-connect', threshold: 50,
    description: 'Explains the CampOS Connect services and gives directions around campus. Not an administrator: no records are connected.',
    greeting: 'Hi there. I can point you to anything on campus, or explain what CampOS Connect does.',
    appearance: { model: 'emeka', skin: 'natural', accent: '#353c4c', accessory: 'none' }, prop: 'tablet',
    home: { x: -19.9, z: 23.6, yaw: -.4 },
    waypoints: { side: { x: -20.3, z: 21.9, yaw: -Math.PI / 2 } },
    routine: [['home', 18, 'hold'], ['side', 8, 'look']],
    talk: { label: 'Ask about services' },
  }),
  def({
    id: 'event-host', name: 'Kemi', role: 'Campus event host', title: 'Horizon Auditorium', building: 'horizon-auditorium', threshold: 70,
    description: 'Helps players find campus events: the events board, the noticeboard and check-in at an event’s place.',
    greeting: 'Hey! Looking for something to do? I can show you what’s on and where to find it.',
    appearance: { model: 'folake', skin: 'natural', accent: '#e8b95e', accessory: 'headphones' }, prop: 'clipboard',
    home: { x: 3.3, z: -30.2, yaw: 0 },
    waypoints: { doors: { x: 3.0, z: -33.6, yaw: Math.PI } },
    routine: [['home', 16, 'hold'], ['doors', 7, 'look'], ['home', 12, 'idle']],
    talk: { label: 'Ask about campus events' },
  }),
  def({
    id: 'coach', name: 'Coach Dayo', role: 'Basketball coach', title: 'The Courts', building: 'the-courts', threshold: 50,
    description: 'Explains shooting, the round of five and Court Duel. Never changes a score: the room’s physics decides every basket.',
    greeting: 'Welcome to The Courts! Grab a ball from the rack and show me your shot.',
    appearance: { model: 'seun', skin: 'natural', accent: '#506b96', accessory: 'cap' }, prop: 'clipboard',
    home: { x: 33.5, z: 19.3, yaw: 1.0 },
    waypoints: { sideline: { x: 35.6, z: 17.2, yaw: Math.PI / 2 }, corner: { x: 35.0, z: 11.8, yaw: .9 } },
    routine: [['home', 14, 'idle'], ['sideline', 8, 'reach'], ['home', 10, 'hold'], ['corner', 8, 'look']],
    // A basket anywhere on the court earns a cheer.
    reacts: { score: 'cheer' },
    talk: { label: 'Talk to coach' },
  }),
  def({
    id: 'residence-assistant', name: 'Amaka', role: 'Residence assistant', title: 'Palm House common room', building: 'palm-house', threshold: 60,
    description: 'Explains personal rooms, privacy and visiting rules. Cannot open anyone’s room or let anybody in.',
    greeting: 'Welcome to Palm House. Questions about rooms or visiting friends? I can help.',
    appearance: { model: 'mel', skin: 'natural', accent: '#537d70', accessory: 'none' }, prop: 'clipboard',
    home: { x: 650.0, z: 1.8, yaw: 0 },
    waypoints: { door: { x: 653.0, z: 1.2, yaw: Math.PI * .8 }, notices: { x: 644.5, z: 1.0, yaw: Math.PI } },
    routine: [['home', 15, 'hold'], ['door', 7, 'look'], ['home', 10, 'idle'], ['notices', 8, 'hold']],
    talk: { label: 'Ask about student rooms' },
  }),
  def({
    id: 'research-assistant', name: 'Tobi', role: 'Economic research assistant', title: 'Economic Simulation Lab', building: 'economic-lab', threshold: 80,
    description: 'Introduces the lab’s six stations and how experiments run. Cannot change the simulation or its results.',
    greeting: 'Welcome to the lab. Six stations, one shared simulation. Want the quick tour?',
    appearance: { model: 'chidi', skin: 'natural', accent: '#353c4c', accessory: 'glasses' }, prop: 'tablet',
    home: { x: -54.2, z: 23.2, yaw: -.6 },
    waypoints: { market: { x: -55.0, z: 20.9, yaw: Math.PI }, evidence: { x: -51.3, z: 24.0, yaw: Math.PI / 2 } },
    routine: [['home', 14, 'hold'], ['market', 8, 'look'], ['home', 10, 'idle'], ['evidence', 8, 'reach']],
    talk: { label: 'Ask about the Economic Simulation Lab', range: 2.8 },
  }),
  // Ambient roles: a few people with a purpose, not a crowd.
  def({
    id: 'orientation-guide', name: 'Zara', role: 'Orientation guide', title: 'Welcome Pavilion', building: 'welcome-pavilion', threshold: 30,
    description: 'Starts new arrivals on the five-stop campus tour and the keepsake trail.',
    greeting: 'First day? Welcome! I can start you on the five-stop campus tour.',
    appearance: { model: 'ibrahim', skin: 'natural', accent: '#e8b95e', accessory: 'backpack' }, prop: 'clipboard',
    home: { x: -15.6, z: 25.4, yaw: .15 },
    waypoints: { board: { x: -12.0, z: 24.7, yaw: Math.PI } },
    routine: [['home', 18, 'idle'], ['board', 7, 'reach'], ['home', 12, 'hold']],
    talk: { label: 'Talk to orientation guide' },
  }),
  def({
    id: 'groundskeeper', name: 'Mr Femi', role: 'Groundskeeper', title: 'Courtyard gardens', building: 'campus-grounds', threshold: 20,
    description: 'Tends the flower beds by the Welcome Pavilion and knows every tree on campus.',
    greeting: 'Afternoon! Mind the flowers. Ask me anything about the gardens.',
    appearance: { model: 'tunde', skin: 'natural', accent: '#537d70', accessory: 'cap' },
    home: { x: -14.6, z: 18.4, yaw: 1.14 },
    waypoints: { bed: { x: -15.6, z: 14.5, yaw: -1.0 }, lawn: { x: -9.6, z: 16.4, yaw: 0 } },
    routine: [['home', 12, 'tend'], ['bed', 12, 'tend'], ['home', 8, 'look'], ['lawn', 9, 'idle']],
    talk: { label: 'Ask about the gardens' },
  }),
]);
export const NPC_BY_ID = new Map(NPCS.map(d => [d.id, d]));
/** Stable id under which a character's avatar and live state are registered (never a player connection id). */
export const npcKey = id => `npc:${id}`;

// ------------------------------------------------------------------ geometry
const boxHit = (b, x, z, r) => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r;
/** Free standing for a body of radius r, whatever the doors are doing (a doorway never counts as free). */
export function standable(x, z, r = PLAYER_RADIUS) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) return false;
  for (const b of collidersIn(x - r, z - r, x + r, z + r)) if (boxHit(b, x, z, r)) return false;
  return !DOORS.some(d => boxHit(d.collider, x, z, r));
}
/** Does the segment a→b cross box b (2D slab test)? */
function crosses(ax, az, bx, bz, b, pad = 0) {
  let t0 = 0, t1 = 1;
  for (const [o, d, lo, hi] of [[ax, bx - ax, b.x - b.w / 2 - pad, b.x + b.w / 2 + pad], [az, bz - az, b.z - b.d / 2 - pad, b.z + b.d / 2 + pad]]) {
    if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) return false; continue; }
    let u = (lo - o) / d, v = (hi - o) / d; if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) return false;
  }
  return true;
}
/**
 * Can someone at a see and speak to someone at b? Walls, fences and closed doors are in the way; counters,
 * desks and low shelves are not (you talk to the vendor across the counter).
 */
export function lineClear(ax, az, bx, bz) {
  for (const b of collidersIn(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz))) if (b.h > TALL && crosses(ax, az, bx, bz, b)) return false;
  return !DOORS.some(d => !doorOpen[d.id] && crosses(ax, az, bx, bz, d.collider));
}
/** Within `range` of (x, z) and in plain sight of it. */
export const canTalk = (p, x, z, range) => Math.hypot(p.x - x, p.z - z) <= range && lineClear(p.x, p.z, x, z);

const inRegion = (r, x, z, pad = 0) => x >= r.x0 + pad && x <= r.x1 - pad && z >= r.z0 + pad && z <= r.z1 - pad;
const stopsOf = d => ({ home: d.home, ...d.waypoints });
/** Points every 5 cm along a segment (both ends included). */
function along(a, b, step = .05) { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step)), out = []; for (let i = 0; i <= n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n }); return out; }

/** Flood-fill a 25 cm grid from `entry` inside `region` (+1.5 m), doors passable: is `target` reachable on foot? */
export function reachableOnFoot(region, entry, target, r = PLAYER_RADIUS) {
  const step = .25, x0 = region.x0 - 1.5, z0 = region.z0 - 1.5, nx = Math.ceil((region.x1 - region.x0 + 3) / step) + 1, nz = Math.ceil((region.z1 - region.z0 + 3) / step) + 1;
  const free = (i, j) => { const x = x0 + i * step, z = z0 + j * step; for (const b of collidersIn(x - r, z - r, x + r, z + r)) if (boxHit(b, x, z, r)) return false; return true; };
  const cell = p => [Math.round((p.x - x0) / step), Math.round((p.z - z0) / step)], seen = new Uint8Array(nx * nz), [ti, tj] = cell(target);
  const queue = [cell(entry)]; if (!free(...queue[0])) return false; seen[queue[0][1] * nx + queue[0][0]] = 1;
  while (queue.length) {
    const [i, j] = queue.pop(); if (Math.abs(i - ti) <= 1 && Math.abs(j - tj) <= 1) return true;
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (a >= 0 && b >= 0 && a < nx && b < nz && !seen[b * nx + a]) { seen[b * nx + a] = 1; if (free(a, b)) queue.push([a, b]); }
  }
  return false;
}
/** Where players come into each building: the starting point for the reachability check. */
export const ENTRIES = Object.freeze({ 'studio-d1': { x: 32.7, z: -37.3 }, 'courtyard-cafe': { x: 26.95, z: -5.3 }, 'adunni-library': { x: -30, z: -5.2 }, 'campos-connect': { x: -23, z: 25.5 },
  'horizon-auditorium': { x: 0, z: -27 }, 'the-courts': { x: 31.6, z: 21 }, 'palm-house': { x: 648, z: 24 }, 'economic-lab': { x: -57, z: 26 }, 'welcome-pavilion': { x: -12, z: 29.2 }, 'campus-grounds': { x: -12, z: 13.2 } });

// ------------------------------------------------------------------ validation
const NAME = /^[a-z][a-z0-9-]{1,31}$/, finite = (...v) => v.every(Number.isFinite), HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const appearanceOk = a => !!a && MODELS.includes(a.model) && SKINS.includes(a.skin) && (ACCENTS.includes(a.accent) || Object.keys(LOCKED_ACCENTS).includes(a.accent)) && ACCESSORIES.includes(a.accessory);
/** Things a character must keep clear of: seats and where people stand to use them, door swings, the ball rack, lab stations, the residents' door. */
function clearance(p) {
  for (const s of SEATS) if (Math.abs(s.x - p.x) < 3 && Math.abs(s.z - p.z) < 3) { const a = seatApproach(s); if (Math.hypot(s.x - p.x, s.z - p.z) < .75 || Math.hypot(a.x - p.x, a.z - p.z) < .75) return `too close to seat ${s.id}`; }
  for (const d of DOORS) for (const l of d.leaves) if (Math.hypot(l.hx - p.x, l.hz - p.z) < l.len + .6) return `inside the swing of door ${d.id}`;
  for (const b of BALLS) if (Math.hypot(b.x - p.x, b.z - p.z) < 1.8) return `too close to the ball rack (${b.id})`;
  for (const s of LAB_STATIONS) if (Math.hypot(s.point.x - p.x, s.point.z - p.z) < 1) return `in front of lab station ${s.id}`;
  for (const f of POINTS) if (f.seat && Math.hypot(f.x - p.x, f.z - p.z) < 1) return `in front of fixture ${f.id}`;
  if (inDormRoom(p.x, p.z)) return 'inside a personal room';
  if (Math.hypot(DORM_OUTSIDE.x - p.x, DORM_OUTSIDE.z - p.z) < 1.5) return 'in the residents’ doorway';
  return null;
}
/**
 * Problems with one definition (empty when valid). `deep` also floods the building's floor to prove its
 * home is reachable on foot (a few milliseconds per character; the room and the tests run it).
 */
export function validateNpc(d, { deep = false } = {}) {
  const problems = [], id = typeof d?.id === 'string' ? d.id : '?', say = m => problems.push(`${id}: ${m}`);
  if (!d || typeof d !== 'object') return ['A character definition is not an object.'];
  if (!NAME.test(id)) say('invalid id');
  for (const k of ['name', 'role', 'title', 'description', 'greeting']) if (typeof d[k] !== 'string' || !d[k].trim() || d[k].length > 160) say(`missing ${k}`);
  const building = BUILDING_BY_ID.get(d.building);
  if (!building) { say(`unknown building ${JSON.stringify(d.building)}`); return problems; }
  if (!finite(d.threshold) || d.threshold < 0 || d.threshold > 100) say('threshold must be a number from 0 to 100');
  if (!appearanceOk(d.appearance)) say('appearance uses an unknown model, skin, accent or accessory');
  if (d.prop !== null && !NPC_PROPS.includes(d.prop)) say(`unknown prop ${d.prop}`);
  if (!d.talk || typeof d.talk.label !== 'string' || !d.talk.label.trim() || !finite(d.talk.range, d.talk.priority) || d.talk.range < 1 || d.talk.range > 4 || d.talk.priority < 0 || d.talk.priority > 12) say('talk needs a label, a range of 1–4 m and a priority of 0–12');
  if (d.hours !== null && !(d.hours && HHMM.test(d.hours.from) && HHMM.test(d.hours.to))) say('hours must be null or { from: "HH:MM", to: "HH:MM" }');
  if (d.serves !== null && !(d.serves && POINTS.some(f => f.id === d.serves.fixture) && typeof d.serves.topic === 'string')) say('serves must name a fixture (shared/interactions.mjs POINTS) and a dialogue topic');
  if (d.reacts !== null && !(d.reacts && typeof d.reacts === 'object' && Object.values(d.reacts).every(g => ['wave', 'cheer'].includes(g)))) say('reacts must map events to wave or cheer');
  const stops = stopsOf(d);
  for (const [name, p] of Object.entries(stops)) {
    if (!p || !finite(p.x, p.z, p.yaw)) { say(`stop ${name} must have x, z and yaw`); continue; }
    if (!inRegion(building.region, p.x, p.z)) say(`stop ${name} is outside ${building.name}`);
    if (!standable(p.x, p.z)) say(`stop ${name} overlaps a wall, fixture or doorway`);
    const why = clearance(p); if (why) say(`stop ${name} is ${why}`);
  }
  if (!Array.isArray(d.routine) || !d.routine.length || d.routine[0]?.[0] !== 'home') say('routine must start at home');
  else d.routine.forEach(([at, dwell, activity], i) => {
    const next = d.routine[(i + 1) % d.routine.length][0];
    if (!stops[at]) say(`routine step ${i} goes to unknown stop ${at}`);
    if (!finite(dwell) || dwell < 1 || dwell > 120) say(`routine step ${i} must wait 1–120 s`);
    if (!NPC_ACTIVITIES.includes(activity)) say(`routine step ${i} has unknown activity ${activity}`);
    if (at !== next && at !== 'home' && next !== 'home') say(`routine step ${i} walks ${at} → ${next}: every walk must start or end at home`);
    if (stops[at] && stops[next] && at !== next) for (const p of along(stops[at], stops[next])) {
      if (!standable(p.x, p.z) || !inRegion(building.region, p.x, p.z)) { say(`the walk ${at} → ${next} crosses a wall, fixture, doorway or the building edge`); break; }
      const why = clearance(p); if (why) { say(`the walk ${at} → ${next} passes ${why}`); break; }
    }
  });
  if (deep && !problems.length && !reachableOnFoot(building.region, ENTRIES[building.id], d.home)) say(`home cannot be reached on foot from the entrance of ${building.name}`);
  return problems;
}
/** Problems with the whole cast: each definition, plus unique ids. */
export function validateNpcs(list = NPCS, options) {
  const ids = list.map(d => d?.id), problems = list.flatMap(d => validateNpc(d, options));
  for (const id of new Set(ids)) if (ids.filter(x => x === id).length > 1) problems.push(`${id}: duplicate id`);
  return problems;
}

// ------------------------------------------------------------------ routines and poses
const cache = new WeakMap();
/** The routine as timed segments: dwell at a stop, then walk to the next one. */
export function routineOf(d) {
  let r = cache.get(d); if (r) return r;
  const stops = stopsOf(d), steps = d.routine.map(([at, dwell, activity], i) => {
    const from = stops[at], to = stops[d.routine[(i + 1) % d.routine.length][0]], length = Math.hypot(to.x - from.x, to.z - from.z);
    return { at, from, to, dwell: dwell * 1000, activity, length, walk: travelMs(length), heading: Math.atan2(to.x - from.x, to.z - from.z) };
  });
  r = { steps, cycle: steps.reduce((t, s) => t + s.dwell + s.walk, 0) }; cache.set(d, r); return r;
}
/** Walking time for a distance with eased start and stop: 1.5 × the time at top speed. */
const travelMs = length => length > .01 ? length / NPC_WALK_SPEED * 1500 : 0;
/** Smoothstep progress and the speed it implies (m/s) at fraction u of a walk of `length` over `ms`. */
const ease = (u, length, ms) => ({ k: u * u * (3 - 2 * u), speed: ms ? length / (ms / 1000) * 6 * u * (1 - u) : 0 });
/** A stable number for a character id (FNV-1a): offsets its routine so the cast does not move in step. */
export function npcSeed(id) { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** @typedef {{ x: number, z: number, yaw: number, speed: number, state: string, activity: string, cue: number | null }} NpcPose */
/**
 * @typedef {{ mode: 'routine' | 'engaged', epoch?: number, from?: { x: number, z: number, at: number } | null, x?: number, z?: number, yaw?: number, at?: number,
 *   by?: { id: string, at: number }[], since?: number, gesture?: { kind: string, at: number, to: string | null } | null }} NpcState
 */
/**
 * Where a character is at room time `t` (ms) and what it is doing: { x, z, yaw, speed, state, activity, cue }.
 * `cue` is when the current repeated gesture (reach, tend) started, or null. Pure: same inputs, same pose.
 * `state` is the shared state from the director: { mode: 'routine', epoch, from? } or { mode: 'engaged', x, z, yaw }.
 * @param {any} d @param {NpcState | null | undefined} state @param {number} t @param {any} [out] @returns {NpcPose}
 */
export function npcPose(d, state, t, out = {}) {
  out.cue = null; out.activity = 'idle'; out.speed = 0;
  if (!state) { Object.assign(out, { x: d.home.x, z: d.home.z, yaw: d.home.yaw, state: 'inactive' }); return out; }
  if (state.mode === 'engaged') { Object.assign(out, { x: state.x, z: state.z, yaw: state.yaw, state: 'interacting' }); return out; }
  const from = state.from;
  if (from && t < from.at + travelMs(Math.hypot(d.home.x - from.x, d.home.z - from.z))) {
    const length = Math.hypot(d.home.x - from.x, d.home.z - from.z), ms = travelMs(length), e = ease(Math.max(0, t - from.at) / ms, length, ms);
    Object.assign(out, { x: from.x + (d.home.x - from.x) * e.k, z: from.z + (d.home.z - from.z) * e.k, yaw: Math.atan2(d.home.x - from.x, d.home.z - from.z), speed: e.speed, state: 'returning' });
    return out;
  }
  const r = routineOf(d); let tau = (t - state.epoch) % r.cycle; if (tau < 0) tau += r.cycle;
  for (const s of r.steps) {
    if (tau < s.dwell) {
      const cueing = s.activity === 'reach' || s.activity === 'tend', n = cueing && tau >= CUE_FIRST ? Math.floor((tau - CUE_FIRST) / CUE_EVERY) : -1, at = CUE_FIRST + n * CUE_EVERY;
      Object.assign(out, { x: s.from.x, z: s.from.z, yaw: s.from.yaw, state: s.activity === 'idle' ? 'idle' : 'working', activity: s.activity, cue: n >= 0 && at + CUE_LENGTH <= s.dwell ? t - (tau - at) : null });
      return out;
    }
    tau -= s.dwell;
    if (tau < s.walk) { const e = ease(tau / s.walk, s.length, s.walk); Object.assign(out, { x: s.from.x + (s.to.x - s.from.x) * e.k, z: s.from.z + (s.to.z - s.from.z) * e.k, yaw: s.heading, speed: e.speed, state: 'walking' }); return out; }
    tau -= s.walk;
  }
  Object.assign(out, { x: d.home.x, z: d.home.z, yaw: d.home.yaw, state: 'idle' }); return out;
}

/** Is t (ms) inside a character's working hours (campus time, West Africa Time, UTC+1)? Always, without hours. */
export function onShift(d, t) {
  if (!d.hours) return true;
  const minutes = ((Math.floor(t / 60000) + 60) % 1440 + 1440) % 1440, m = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const a = m(d.hours.from), b = m(d.hours.to);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** Whether a character may be on duty now, and if not, why (for the player). */
export function eligibility(d, buildings, t, valid = true) {
  const config = BUILDING_BY_ID.get(d?.building), b = config && buildings.get(config.id);
  if (!config || !b) return { ok: false, reason: 'This character has no building.' };
  if (!b.available) return { ok: false, reason: `${config.name} is closed.` };
  if (b.completion < d.threshold) return { ok: false, reason: `${config.name} is ${Math.round(b.completion)}% complete. The ${d.role.toLowerCase()} starts work at ${d.threshold}%.` };
  if (!valid) return { ok: false, reason: `The ${d.role.toLowerCase()} is not available.` };
  if (!onShift(d, t)) return { ok: false, reason: `The ${d.role.toLowerCase()} works ${d.hours.from}–${d.hours.to}.` };
  return { ok: true };
}

// ------------------------------------------------------------------ the director (authoritative state)
const cm = v => Math.round(v * 100) / 100, fail = reason => ({ ok: false, reason });
/**
 * One authority for the whole cast. The room server runs one for everyone; an offline client runs its own.
 * Players are `{ id, key?, x, z, y?, seat?, ball?, vehicle?, space? }` (`key` survives reconnects: the session token).
 */
export function createNpcDirector({ overrides = {}, definitions = NPCS, deep = false, now = () => Date.now() } = {}) {
  const buildings = createBuildingState(overrides), byId = new Map(definitions.map(d => [d.id, d]));
  const valid = new Map(definitions.map(d => [d.id, validateNpc(d, { deep }).length === 0]));
  /** @type {Map<string, NpcState>} */
  const npcs = new Map();
  const spawns = new Map(), orders = new Map(), greeted = new Map(), lastGreet = new Map(), pose = {};
  let revision = 0, orderSeq = 0;
  const touch = () => { revision++; };
  const poseOf = (d, t) => npcPose(d, npcs.get(d.id), t, pose);
  /** Bring the cast in line with the buildings (and hours) at time t. Returns the ids that came or went. */
  function sync(t = now()) {
    const changed = [];
    for (const d of definitions) {
      const ok = eligibility(d, buildings, t, valid.get(d.id)).ok;
      if (ok && !npcs.has(d.id)) {
        // Start somewhere in the first wait at home, offset per character, so arrivals look natural.
        npcs.set(d.id, { mode: 'routine', epoch: t - npcSeed(d.id) % (d.routine[0][1] * 1000), since: t, gesture: null });
        spawns.set(d.id, (spawns.get(d.id) ?? 0) + 1); changed.push(d.id);
      } else if (!ok && npcs.has(d.id)) { npcs.delete(d.id); changed.push(d.id); }
    }
    if (changed.length) touch();
    return changed;
  }
  /** Stop talking: back to the routine, walking home first from wherever the conversation happened. */
  function resume(d, s, t) {
    const length = Math.hypot(d.home.x - s.x, d.home.z - s.z);
    npcs.set(d.id, { mode: 'routine', epoch: t + travelMs(length), from: length > .01 ? { x: s.x, z: s.z, at: t } : null, since: s.since, gesture: s.gesture });
  }
  /** End a player's conversation (closing the dialogue). Harmless to repeat. */
  function leave(p, id, t = now()) {
    const d = typeof id === 'string' ? byId.get(id) : undefined, s = d && npcs.get(d.id);
    if (!s || s.mode !== 'engaged' || !s.by.some(b => b.id === p.id)) return { ok: true, replayed: true };
    s.by = s.by.filter(b => b.id !== p.id);
    if (!s.by.length) resume(d, s, t);
    touch(); return { ok: true };
  }
  /** Take characters' states from the room, as sent (unknown ids and malformed states are ignored). */
  function apply(list) {
    for (const s of Array.isArray(list) ? list : []) {
      if (!byId.has(s?.id)) continue;
      if (s.mode === 'gone') { npcs.delete(s.id); continue; }
      const ok = s.mode === 'routine' && Number.isFinite(s.epoch) && (!s.from || finite(s.from.x, s.from.z, s.from.at)) || s.mode === 'engaged' && finite(s.x, s.z, s.yaw) && Array.isArray(s.by);
      if (ok) { const { id, ...rest } = s; npcs.set(id, rest); }
    }
  }
  /** @param {string} id @param {string} kind @param {number} t @param {string | null} [to] */
  function gesture(id, kind, t, to = null) { const s = npcs.get(id); if (!s) return false; s.gesture = { kind, at: t, to }; touch(); return true; }
  const busyReason = p => p.vehicle ? 'Leave the vehicle first.' : p.seat ? 'Stand up first, then you can talk.' : p.ball ? 'Put the ball down first, then you can talk.' : p.space ? 'Come back out to the common room first.' : (p.y ?? 0) > .3 ? 'Land first.' : null;
  /** Can `p` speak to character `d` right now? null, or why not. */
  function reachFor(d, p, t) {
    const at = poseOf(d, t);
    if (Math.hypot(p.x - at.x, p.z - at.z) > d.talk.range + TALK_SLACK) return 'Move a little closer to talk.';
    if (!lineClear(p.x, p.z, at.x, at.z)) return `You can’t reach ${d.name} from here.`;
    return null;
  }
  const lookup = (id, t) => {
    const d = typeof id === 'string' ? byId.get(id) : undefined; if (!d) return { error: 'There’s nobody by that name here.' };
    if (!npcs.has(d.id)) return { error: eligibility(d, buildings, t, valid.get(d.id)).reason ?? `${d.name} isn’t here right now.` };
    return { d, s: npcs.get(d.id) };
  };
  sync(now());
  return {
    buildings, spawns, npcs,
    get revision() { return revision; },
    definition: id => byId.get(id),
    valid: id => valid.get(id) === true,
    sync,
    pose: (id, t = now()) => { const d = byId.get(id); return d ? { ...npcPose(d, npcs.get(id), t) } : null; },
    /** Change a building's completion or availability (validated); the cast follows at once. */
    setBuilding(id, change, t = now()) {
      const r = buildings.set(id, change); if (!r.ok) return r;
      const before = new Set(npcs.keys()), came = sync(t);
      return { ok: true, changed: r.changed, arrived: came.filter(x => !before.has(x)), left: came.filter(x => before.has(x)) };
    },
    /** Start (or rejoin) a conversation. The character stops where it is and turns to the first player talking to it. */
    talk(p, id, t = now()) {
      const { d, s, error } = lookup(id, t); if (error) return fail(error);
      const busy = busyReason(p); if (busy) return fail(busy);
      const far = reachFor(d, p, t); if (far) return fail(far);
      if (s.mode === 'engaged') {
        if (s.by.some(b => b.id === p.id)) return { ok: true, npc: d.id, first: s.by[0].id === p.id, replayed: true };
        if (s.by.length >= MAX_ATTENDING) return fail(`${d.name} is helping other people. Try again in a moment.`);
        s.by.push({ id: p.id, at: t }); touch();
        return { ok: true, npc: d.id, first: false };
      }
      const at = poseOf(d, t);
      npcs.set(d.id, { mode: 'engaged', x: cm(at.x), z: cm(at.z), yaw: at.yaw, at: t, by: [{ id: p.id, at: t }], since: s.since, gesture: { kind: 'wave', at: t, to: p.id } });
      lastGreet.set(d.id, t); greeted.set(`${d.id}:${p.id}`, t); touch();
      return { ok: true, npc: d.id, first: true };
    },
    leave,
    /** A player left the room: every conversation they were in ends. */
    release(p, t = now()) { let changed = false; for (const [id, s] of [...npcs]) if (s.mode === 'engaged' && s.by.some(b => b.id === p.id)) { leave(p, id, t); changed = true; } return changed; },
    /**
     * A demo café order, from the counter fixture (`via: 'counter'`) or the vendor (`via: 'vendor'`). Nothing
     * is charged. `req` is the client's own id for this order: the same request again returns the same order.
     */
    order(p, { items, req, via } = {}, t = now()) {
      if (typeof req !== 'string' || !/^[A-Za-z0-9-]{6,40}$/.test(req)) return fail('That order could not be read. Try again.');
      const key = `${p.key || p.id}:${req}`, done = orders.get(key); if (done) return { ...done, replayed: true };
      const checked = validateOrder(items); if (!checked.ok) return checked;
      if (p.vehicle || p.space) return fail(busyReason(p));
      const vendor = byId.get('vendor'), counter = POINTS.find(f => f.id === 'cafe-counter');
      if (via === 'vendor') { const { error } = lookup('vendor', t); if (error) return fail(error); const far = reachFor(vendor, p, t); if (far) return fail(far); }
      else if (via === 'counter') { if (!canTalk(p, counter.x, counter.z, counter.range + TALK_SLACK)) return fail('Walk up to the café counter to order.'); }
      else return fail('Order at the café counter.');
      const served = npcs.has('vendor'), result = { ok: true, number: 10 + (orderSeq++ % 90), items: checked.items, total: checked.total, readyAt: t + ORDER_READY_S * 1000, served };
      orders.set(key, result); if (orders.size > 500) orders.delete(orders.keys().next().value);
      if (served) gesture('vendor', 'serve', t, p.id);
      return result;
    },
    gesture,
    /** A world event (a basket): characters that react to it do. */
    react(event, t = now()) { let changed = false; for (const [id, s] of npcs) { const g = byId.get(id).reacts?.[event?.type]; if (g && !(s.gesture && t - s.gesture.at < GESTURE_MS)) changed = gesture(id, g, t) || changed; } return changed; },
    /**
     * Twice a second: working hours, conversations whose player went away, and greetings. Returns whether
     * anything changed (the room then sends the new state).
     */
    step(players, t = now()) {
      const before = revision; sync(t);
      const here = new Map(players.map(p => [p.id, p]));
      for (const [id, s] of npcs) {
        const d = byId.get(id);
        if (s.mode === 'engaged') {
          const keep = s.by.filter(b => { const p = here.get(b.id); return p && !p.vehicle && !p.space && t - b.at < ATTENTION_MS && Math.hypot(p.x - s.x, p.z - s.z) <= LEAVE_RANGE; });
          if (keep.length !== s.by.length) { s.by = keep; if (!keep.length) resume(d, s, t); touch(); }
          continue;
        }
        if (!d.greet || t - (lastGreet.get(id) ?? -Infinity) < GREET_COOLDOWN_MS) continue;
        const at = poseOf(d, t);
        for (const p of players) {
          if (p.vehicle || p.space || p.seat || Math.hypot(p.x - at.x, p.z - at.z) > GREET_RADIUS) continue;
          const k = `${id}:${p.id}`; if (t - (greeted.get(k) ?? -Infinity) < GREET_REPEAT_MS || !lineClear(p.x, p.z, at.x, at.z)) continue;
          greeted.set(k, t); lastGreet.set(id, t); gesture(id, 'wave', t, p.id); break;
        }
      }
      if (greeted.size > 2000) for (const [k, at] of greeted) if (t - at > GREET_REPEAT_MS) greeted.delete(k);
      return revision !== before;
    },
    /** What clients need to draw the cast and explain who is where. */
    snapshot(t = now()) {
      return { version: 1, at: t, buildings: buildings.snapshot(), npcs: [...npcs].map(([id, s]) => ({ id, ...s, ...(s.by ? { by: s.by.map(b => ({ ...b })) } : {}) })) };
    },
    /** Client side: replace the cast with a room's snapshot (unknown ids and malformed states are dropped). */
    load(snap) {
      if (!snap || typeof snap !== 'object') return false;
      buildings.load(snap.buildings);
      npcs.clear(); apply(snap.npcs);
      touch(); return true;
    },
    /** Client side: a room's changes to some characters ({ id, mode: 'gone' } when one went off duty). */
    apply(changes) { apply(changes); touch(); },
    /** The room went away: every conversation ends here too, and each character walks back to work. */
    releaseAll(t = now()) { for (const [id, s] of [...npcs]) if (s.mode === 'engaged') resume(byId.get(id), s, t); touch(); },
  };
}
