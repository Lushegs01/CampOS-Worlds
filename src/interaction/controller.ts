import { vehicleInteract, useVehicle, nearestDoor } from '../vehicles/client';
import { SEATS, SEAT_BY_ID, DOORS, POINTS as POINT_DATA, BALLS, seatApproach, SEAT_RANGE, BALL_PICKUP_RANGE } from '../../shared/interactions.mjs';
import { LOCATIONS } from '../../shared/campus.mjs';
import { newBall, planShot, stepBall, targetHoop } from '../../shared/ball.mjs';
import { input, player, useGame, type Gesture } from '../state';
import { interact } from '../network/client';
import { me, onWorldEvent, request, selfIdNow, useInteraction, world, type WorldEvent } from './world';
import { sfx } from './sound';

type Point = { id: string; kind: string; label: string; x: number; z: number; range: number; seat?: string };
const POINTS = POINT_DATA as Point[];

// The local player's interaction state machine. Exactly one activity is active at a time and each
// action checks it first, so conflicting actions (sitting while holding a ball, shooting mid-stand,
// opening a door while seated) are refused on the client before the server refuses them too.
export type Activity = 'free' | 'approach' | 'sitting' | 'seated' | 'standing' | 'holding' | 'charging' | 'busy';
let pending = false, afterSit: string | null = null;
export function activity(): Activity {
  const s = player.sit;
  if (s && s.phase !== 'done') return s.phase === 'approach' || s.phase === 'request' ? 'approach' : s.phase === 'down' ? 'sitting' : s.phase === 'seated' ? 'seated' : 'standing';
  if (pending) return 'busy';
  if (player.charge != null) return 'charging';
  if (me.ball) return 'holding';
  return 'free';
}
const notify = (text?: string) => { if (text) useGame.getState().notify(text); };
const nowS = () => performance.now() / 1000;
const gesture = (kind: Gesture['kind']) => { player.gesture = { kind, start: nowS() }; };
const face = (x: number, z: number) => { player.yaw = Math.atan2(x - player.x, z - player.z); };

// ------------------------------------------------------------------ actions
export function beginSit(id: string, then: string | null = null) {
  if (activity() !== 'free') return;
  const seat = SEAT_BY_ID.get(id); if (!seat) return;
  const holder = world.seats.get(id);
  if (holder && holder !== me.id) { notify('That seat is taken.'); sfx('deny'); return; }
  player.sit = { seat: id, phase: 'approach', t: 0, path: routeTo(seat) }; afterSit = then;
}
/** From behind a chair, walk round its side (squeezing between neighbours in a row) to the front. */
function routeTo(seat: typeof SEATS[number]) {
  const f = [Math.sin(seat.yaw), Math.cos(seat.yaw)], r = [Math.cos(seat.yaw), -Math.sin(seat.yaw)];
  const dx = player.x - seat.x, dz = player.z - seat.z, front = f[0] * dx + f[1] * dz, lat = r[0] * dx + r[1] * dz;
  if (seat.kind !== 'chair' || front > .05) return [];
  const side = lat >= 0 ? 1 : -1;
  let room = .58;
  for (const o of SEATS) if (o !== seat && Math.abs(o.x - seat.x) < 1.2 && Math.abs(o.z - seat.z) < 1.2) {
    const ol = r[0] * (o.x - seat.x) + r[1] * (o.z - seat.z), of = f[0] * (o.x - seat.x) + f[1] * (o.z - seat.z);
    if (Math.sign(ol) === side && Math.abs(of) < .5) room = Math.min(room, Math.abs(ol) / 2);
  }
  const at = (l: number, fw: number) => ({ x: seat.x + r[0] * side * l + f[0] * fw, z: seat.z + r[1] * side * l + f[1] * fw });
  return front < -.3 ? [at(room, -.3), at(room, .25)] : [at(room, .25)];
}
/** Called by the player controller once it stands on the approach point, facing away from the seat. */
export function requestSit() {
  const sit = player.sit; if (!sit || sit.phase !== 'approach') return;
  sit.phase = 'request';
  void request('sit', { seat: sit.seat }).then(r => {
    if (player.sit !== sit) return;
    if (!r.ok) { player.sit = null; afterSit = null; notify(r.reason); sfx('deny'); return; }
    const seat = SEAT_BY_ID.get(sit.seat)!;
    player.x = seat.x; player.z = seat.z; player.yaw = seat.yaw; sit.phase = 'down'; sit.t = 0; sfx('sit', seat);
  });
}
export function cancelApproach() { if (player.sit?.phase === 'approach') { player.sit = null; afterSit = null; } }
export function standUp() {
  const sit = player.sit; if (!sit || sit.phase !== 'seated' || pending) return;
  pending = true;
  void request('stand').then(r => {
    pending = false;
    if (!r.ok) { notify(r.reason); sfx('deny'); return; }
    sit.exit = { x: r.x ?? player.x, z: r.z ?? player.z }; sit.phase = 'up'; sit.t = 0;
    if (useGame.getState().panel?.startsWith('fixture:')) useGame.getState().set({ panel: null });
  });
}

function useDoor(id: string) {
  const d = DOORS.find(x => x.id === id); if (!d || activity() === 'busy') return;
  face(d.x, d.z);
  if (d.locked) { gesture('door-push'); setTimeout(() => sfx('locked', d), 350); notify(`Locked · ${d.locked}`); return; }
  const open = !world.doors[id];
  gesture(open ? 'door-push' : 'door-pull'); pending = true;
  // The leaf moves when the hand reaches it, not when the key is pressed.
  setTimeout(() => void request('door', { id, open }).then(r => { pending = false; if (!r.ok) { notify(r.reason); sfx('deny'); } }), open ? 420 : 300);
}

function pickUp(id: string) {
  const b = world.balls.find(x => x.id === id); if (!b || activity() !== 'free') return;
  face(b.x, b.z); gesture('pickup'); pending = true;
  setTimeout(() => void request('pickup', { ball: id }).then(r => { pending = false; if (!r.ok) { notify(r.reason); sfx('deny'); } else sfx('pickup'); }), 330);
}
export function drop() { if (activity() !== 'holding') return; pending = true; void request('drop').then(r => { pending = false; if (!r.ok) notify(r.reason); }); }

function usePoint(id: string) {
  const p = POINTS.find(x => x.id === id); if (!p) return;
  if (p.seat && player.sit?.seat !== p.seat) { beginSit(p.seat, `fixture:${id}`); return; }
  useGame.getState().set({ panel: `fixture:${id}` }); document.exitPointerLock?.();
}

// ------------------------------------------------------------------ shooting
const CHARGE_PERIOD = 1.15; // seconds for the meter to sweep from empty to full
let chargeStart = 0, zoneAt = { x: 0, z: 0, yaw: 99, t: 0 };
export function startCharge() {
  if (activity() !== 'holding') return;
  player.charge = 0; chargeStart = nowS(); zoneAt = { x: 0, z: 0, yaw: 99, t: 0 };
}
export function cancelCharge() { player.charge = null; }
export function releaseShot() {
  if (player.charge == null) return;
  const charge = player.charge, ball = me.ball, zone = useInteraction.getState().zone;
  player.charge = null; player.release = nowS();
  if (player.y === 0) player.vy = 4.4; // a small jump shot
  pending = true; sfx('shot');
  void request('shoot', { yaw: player.yaw, charge }).then(r => {
    pending = false;
    if (!r.ok) { notify(r.reason); return; }
    if (r.shot != null) shots.set(r.shot, { at: nowS(), ball: ball ?? '', rim: false, board: false, charge, zone, aimed: !!r.hoop });
  });
}
/** Charges that would score from here, found by running the same physics the server runs. */
function scoringZone(x: number, z: number, yaw: number): [number, number] | null {
  if (!targetHoop(x, z, yaw)) return null;
  const hits: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const c = i / 40, b = Object.assign(newBall(BALLS[0]), planShot(x, z, yaw, c), { state: 'flight', shot: { id: 0, by: '', from: [x, z], scored: false } });
    const ev: { type: string }[] = [];
    for (let k = 0; k < 75 && !ev.some(e => e.type === 'score'); k++) stepBall(b, 1 / 30, ev);
    if (ev.some(e => e.type === 'score')) hits.push(c);
  }
  if (!hits.length) return null;
  // The contiguous run of scoring charges closest to the middle of the meter.
  const runs: [number, number][] = []; for (const c of hits) { const r = runs[runs.length - 1]; if (r && c - r[1] < .03) r[1] = c; else runs.push([c, c]); }
  runs.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - .5) - Math.abs((b[0] + b[1]) / 2 - .5));
  return [Math.max(0, runs[0][0] - .0125), Math.min(1, runs[0][1] + .0125)];
}

// ------------------------------------------------------------------ shot results and round scoring
type Shot = { at: number; ball: string; rim: boolean; board: boolean; charge: number; zone: [number, number] | null; aimed: boolean };
const shots = new Map<number, Shot>();
/** When remote players released their last shot (drives their follow-through animation). */
export const peerRelease = new Map<string, number>();
function record(points: number, text: string) {
  const ui = useInteraction.getState(), h = ui.hoops, round = h.round.length >= 5 ? [points] : [...h.round, points];
  const total = round.reduce((a, b) => a + b, 0), best = round.length === 5 ? Math.max(h.best, total) : h.best;
  ui.set({ hoops: { points: h.points + points, shots: h.shots + 1, made: h.made + (points ? 1 : 0), round, last: text, lastAt: Date.now(), best } });
  if (round.length === 5) {
    const g = useGame.getState();
    if (total > g.bestScore) g.set({ bestScore: total });
    g.notify(total >= 6 ? `Round of five: ${total} points. Courtside badge earned!` : `Round of five: ${total} points. Press Space for another round.`);
  }
}
onWorldEvent((e: WorldEvent) => {
  const ball = world.balls.find(b => b.id === e.ball), at = ball ? { x: ball.x, z: ball.z } : undefined;
  if (e.type === 'bounce') sfx('bounce', at, (e.speed ?? 2) / 3);
  if (e.type === 'rim' || e.type === 'board') {
    sfx(e.type, at, (e.speed ?? 2) / 3);
    for (const s of shots.values()) if (s.ball === e.ball) s[e.type] = true;
  }
  if (e.type === 'shot' && e.by && e.by !== selfIdNow()) peerRelease.set(e.by, nowS());
  if (e.type === 'score') {
    sfx('swish', at);
    const mine = e.shot != null ? shots.get(e.shot) : undefined;
    if (mine && e.by === selfIdNow()) {
      shots.delete(e.shot!);
      const how = !mine.rim && !mine.board ? 'Swish!' : mine.board && !mine.rim ? 'Off the glass!' : 'In off the rim!';
      record(e.points ?? 2, `${how} +${e.points ?? 2}${e.points === 3 ? ' from downtown' : ''}`);
    }
  }
});
function resolveMisses() {
  const t = nowS();
  for (const [id, s] of shots) if (t - s.at > 3.2) {
    shots.delete(id);
    const short = s.zone && s.charge < s.zone[0], long = s.zone && s.charge > s.zone[1];
    const text = !s.aimed ? 'No hoop in front of you. Face a basket to aim.' : s.rim ? (short ? 'Rimmed out: a touch short.' : long ? 'Rimmed out: a touch long.' : 'Rimmed out.') : s.board ? 'Off the backboard.' : short ? 'Air ball: too short.' : long ? 'Too long: over the rim.' : 'Just missed.';
    record(0, text);
  }
}

// ------------------------------------------------------------------ focus: the one prompt on screen
type Candidate = { id: string; kind: string; label: string; key: string; hint?: string; disabled?: boolean; score: number; run: () => void };
let current: Candidate | null = null;
const facingScore = (x: number, z: number) => { const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz) || 1; return (Math.sin(player.yaw) * dx + Math.cos(player.yaw) * dz) / d; };
// What you are closest to and facing wins; priority only breaks near-ties (a ball over a seat beside it).
const rank = (priority: number, x: number, z: number) => priority - Math.hypot(x - player.x, z - player.z) * 2.5 + facingScore(x, z) * 1.2;

function candidates(): Candidate[] {
  const act = activity(), out: Candidate[] = [];
  if (act === 'seated') {
    const seat = SEAT_BY_ID.get(player.sit!.seat), pc = POINTS.find(p => p.seat === seat?.id);
    if (pc) out.push({ id: pc.id, kind: 'point', label: 'Use computer', key: 'E', hint: 'Move to stand up', score: 100, run: () => usePoint(pc.id) });
    else out.push({ id: 'stand', kind: 'stand', label: 'Stand up', key: 'E', score: 100, run: standUp });
    return out;
  }
  if (act !== 'free' && act !== 'holding') return out;
  const holding = act === 'holding';
  if (!holding) for (const s of SEATS) {
    if (Math.abs(s.x - player.x) > 2.5 || Math.abs(s.z - player.z) > 2.5) continue;
    const a = seatApproach(s), d = Math.hypot(a.x - player.x, a.z - player.z);
    const front = Math.sin(s.yaw) * (player.x - s.x) + Math.cos(s.yaw) * (player.z - s.z);
    // Benches only from the open side; chairs from anywhere nearby (the walk goes round them).
    if (d > SEAT_RANGE + (s.kind === 'chair' ? .5 : 0) || (s.kind === 'bench' && front < -.05) || player.y > .05) continue;
    const taken = world.seats.has(s.id) && world.seats.get(s.id) !== me.id;
    out.push({ id: s.id, kind: 'seat', label: taken ? 'Seat taken' : 'Sit', key: 'E', disabled: taken, score: rank(taken ? 1 : 4, a.x, a.z), run: () => taken ? (notify('That seat is taken.'), sfx('deny')) : beginSit(s.id) });
  }
  for (const d of DOORS) {
    if (Math.hypot(d.x - player.x, d.z - player.z) > 2.3) continue;
    const label = d.locked ? `Locked · ${d.locked}` : world.doors[d.id] ? 'Close door' : 'Open door';
    out.push({ id: d.id, kind: 'door', label, key: 'E', hint: d.label, disabled: !!d.locked, score: rank(5, d.x, d.z), run: () => useDoor(d.id) });
  }
  if (!holding) for (const b of world.balls) {
    if (b.state === 'held' || b.y > 1.7 || Math.hypot(b.x - player.x, b.z - player.z) > BALL_PICKUP_RANGE) continue;
    out.push({ id: b.id, kind: 'ball', label: 'Pick up basketball', key: 'E', score: rank(6, b.x, b.z), run: () => pickUp(b.id) });
  }
  if (!holding) for (const p of POINTS) {
    if (Math.hypot(p.x - player.x, p.z - player.z) > p.range) continue;
    const label = p.kind === 'COMPUTER' ? 'Sit at computer' : p.label;
    out.push({ id: p.id, kind: 'point', label, key: 'E', score: rank(4, p.x, p.z) + 1, run: () => usePoint(p.id) });
  }
  // Vehicles: offered at a free door (driver's door: Drive; others: Ride), ranked like any fixture.
  const car = holding ? null : nearestDoor(useVehicle.getState().near);
  if (car && (car.full || (car.door && car.door.d < 2.6))) {
    const moving = Math.abs(car.v.speed) > .5, label = car.full ? 'Vehicle full' : moving ? 'Wait for it to stop' : car.door!.seat === 0 ? 'Drive' : 'Ride as passenger';
    const at = car.door?.p ?? car.v;
    out.push({ id: car.v.id, kind: 'vehicle', label, key: 'E', hint: car.type.name, disabled: car.full || moving, score: rank(5, at.x, at.z), run: () => { if (!car.full && !moving) vehicleInteract(); } });
  }
  const nearby = useGame.getState().nearby, loc = LOCATIONS.find(l => l.id === nearby);
  if (loc && !holding) out.push({ id: loc.id, kind: 'location', label: loc.id === 'sports' ? 'How to play' : `Explore ${loc.name}`, key: 'E', hint: loc.type, score: rank(3, loc.x, loc.z), run: () => interact(loc.id) });
  return out;
}

export function activate() {
  if (useVehicle.getState().id) { vehicleInteract(); return; }
  if (!current) { if (activity() === 'seated') standUp(); return; }
  current.run();
}

let sense = 0;
/** Per-frame upkeep: charge meter, scoring zone, focus, shot results and post-sit actions. */
export function tickInteractions(dt: number) {
  player.holding = !!me.ball;
  if (player.charge != null) {
    if (!me.ball) player.charge = null;
    else {
      const t = (nowS() - chargeStart) / CHARGE_PERIOD; player.charge = 1 - Math.abs(1 - (t % 2));
      player.yaw = input.yaw + Math.PI; // shots go where the camera looks
      if (Math.abs(zoneAt.yaw - player.yaw) > .015 || Math.hypot(zoneAt.x - player.x, zoneAt.z - player.z) > .1) {
        zoneAt = { x: player.x, z: player.z, yaw: player.yaw, t: nowS() };
        const hoop = targetHoop(player.x, player.z, player.yaw);
        useInteraction.getState().set({ zone: scoringZone(player.x, player.z, player.yaw), target: hoop?.id ?? null });
      }
    }
  }
  if (player.sit?.phase === 'seated' && afterSit) { const panel = afterSit; afterSit = null; useGame.getState().set({ panel }); document.exitPointerLock?.(); }
  resolveMisses();
  sense -= dt; if (sense > 0) return; sense = .1;
  const list = useVehicle.getState().id ? [] : candidates(); list.sort((a, b) => b.score - a.score);
  current = list[0] ?? null;
  const ui = useInteraction.getState(), f = current ? { id: current.id, label: current.label, key: current.key, hint: current.hint ?? '', disabled: !!current.disabled } : null;
  if (JSON.stringify(f) !== JSON.stringify(ui.focus)) ui.set({ focus: f });
  const charging = player.charge != null; if (ui.charging !== charging) ui.set({ charging });
}
