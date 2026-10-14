import { create } from 'zustand';
import { createWorld } from '../../shared/world.mjs';
import { stepBall } from '../../shared/ball.mjs';
import { SEAT_BY_ID, seatApproach, STAND_EXIT } from '../../shared/interactions.mjs';
import { livePeers, player, useGame } from '../state';

// Client view of the interactive world. Online, the room server is authoritative and this mirrors
// its snapshots (with local ball prediction between them). Offline, the same rules run here.
export const world = createWorld();
export type Result = { ok: boolean; reason?: string; x?: number; z?: number; shot?: number; hoop?: string | null };
export type WorldEvent = { type: string; ball?: string; hoop?: string; by?: string; points?: number; distance?: number; shot?: number; kind?: string; speed?: number };

/** Local actor in the shared rules' terms. */
export const me = { id: 'local', get x() { return player.x; }, set x(v: number) { player.x = v; }, get z() { return player.z; }, set z(v: number) { player.z = v; }, get y() { return player.y; }, set y(v: number) { player.y=v; }, get yaw() { return player.yaw; }, set yaw(v: number) { player.yaw = v; }, vehicle:null as string|null, vehicleSeat:null as number|null, seat: null as string | null, ball: null as string | null, vx: 0, vz: 0 };

// React-visible slice for prompts and HUDs (the 3D scene reads `world` directly every frame).
interface InteractionUi {
  focus: { id: string; label: string; hint: string; key: string; disabled: boolean } | null;
  seat: string | null; ball: string | null; charging: boolean; revision: number;
  /** Charges that would score from the current spot and facing, and the hoop being aimed at. */
  zone: [number, number] | null; target: string | null;
  hoops: { points: number; shots: number; made: number; round: number[]; last: string; lastAt: number; best: number };
  panel: { kind: string; id: string } | null;
  set: (v: Partial<InteractionUi>) => void;
}
export const useInteraction = create<InteractionUi>(set => ({
  focus: null, seat: null, ball: null, charging: false, revision: 0, zone: null, target: null,
  hoops: { points: 0, shots: 0, made: 0, round: [], last: '', lastAt: 0, best: 0 }, panel: null,
  set: v => set(v),
}));

const listeners = new Set<(e: WorldEvent) => void>();
export const onWorldEvent = (fn: (e: WorldEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emit(list: WorldEvent[]) { for (const e of list) listeners.forEach(fn => fn(e)); }

let sendFn: ((m: Record<string, unknown>) => boolean) | null = null, selfId = 'local', ref = 0;
const pending = new Map<number, (r: Result) => void>();
export function bindNetwork(send: typeof sendFn, id: string) { sendFn = send; selfId = id; me.id = id; }
export function unbindNetwork() { sendFn = null; selfId = 'local'; me.id = 'local'; for (const r of pending.values()) r({ ok: false, reason: 'Disconnected.' }); pending.clear(); releaseLocal(); }
/**
 * The room lets go of a departing player's seat and ball (standing them up at the seat's exit), and of
 * everyone else's. Match that locally when the connection drops or a new session starts; otherwise the
 * player stayed seated here while the room had them standing, and "Stand up" failed for good.
 */
export function releaseLocal(placed = false) {
  player.charge = null;
  const sit = player.sit, seat = sit ? SEAT_BY_ID.get(sit.seat) : undefined;
  // A new session places us itself (`placed`): no stand-up motion that would end somewhere else.
  if (placed) player.sit = null;
  else if (sit && seat && (sit.phase === 'down' || sit.phase === 'seated')) { sit.exit = seatApproach(seat, STAND_EXIT); sit.phase = 'up'; sit.t = 0; }
  else if (sit && sit.phase !== 'up' && sit.phase !== 'done') player.sit = null;
  me.seat = null; me.ball = null;
  for (const b of world.balls) if (b.state === 'held') Object.assign(b, { state: 'free', holder: null, vy: 0, rest: 0 });
  world.load({ seats: {} });
  syncUi();
}
export const selfIdNow = () => selfId;
const online = () => useGame.getState().status === 'connected' && !!sendFn;

/** Ask for an interaction. Online the server decides; offline the local rules do. */
export function request(action: 'sit' | 'stand' | 'door' | 'pickup' | 'drop' | 'shoot' | 'ballReset', args: Record<string, unknown> = {}): Promise<Result> {
  if (online()) {
    const r = ++ref;
    return new Promise(resolve => {
      pending.set(r, resolve);
      if (!sendFn!({ type: action, ref: r, ...args })) { pending.delete(r); resolve({ ok: false, reason: 'Not connected.' }); }
      setTimeout(() => { if (pending.delete(r)) resolve({ ok: false, reason: 'The campus did not respond.' }); }, 4000);
    });
  }
  const peers = [...livePeers.values()];
  const r: Result = action === 'sit' ? world.sit(me, String(args.seat)) : action === 'stand' ? world.stand(me) : action === 'door' ? world.door(me, String(args.id), args.open === true, peers) :
    action === 'pickup' ? world.pickup(me, String(args.ball)) : action === 'drop' ? world.drop(me) : action === 'shoot' ? world.shoot(me, Number(args.yaw), Number(args.charge)) : world.resetBall(me, String(args.ball));
  if (r.ok && action === 'shoot') emit([{ type: 'shot', by: selfId, shot: r.shot, hoop: r.hoop ?? undefined }]);
  syncUi();
  return Promise.resolve(r);
}

/** Server messages: results, world snapshots, ball state and events. */
export function receive(m: { type: string; [k: string]: unknown }) {
  if (m.type === 'result') {
    const done = pending.get(m.ref as number); pending.delete(m.ref as number);
    me.seat = (m.seat as string) ?? null; me.ball = (m.ball as string) ?? null;
    done?.({ ok: !!m.ok, reason: m.reason as string, x: m.x as number, z: m.z as number, shot: m.shot as number, hoop: m.hoop as string });
    syncUi();
  } else if (m.type === 'world') { world.load({ doors: m.doors as Record<string, boolean>, seats: m.seats as Record<string, string> }); syncUi(); }
  else if (m.type === 'events') emit(m.list as WorldEvent[]);
  else if (m.type === 'balls') {
    const held = me.ball;
    for (const b of m.balls as { id: string; holder: string | null }[]) {
      const ball = world.balls.find(x => x.id === b.id); if (!ball) continue;
      Object.assign(ball, b);
      if (b.holder === selfId) me.ball = b.id; else if (me.ball === b.id) me.ball = null;
    }
    // The room can hand us a ball (the start of a Court Duel) or take it away without a request of
    // ours; keep the HUD and touch controls in step.
    if (me.ball !== held) syncUi();
  }
}
export function loadSnapshot(s: { doors: Record<string, boolean>; seats: Record<string, string>; balls: unknown[] }) { world.load(s); syncUi(); }
export function syncUi() { const s = useInteraction.getState(); if (s.seat !== me.seat || s.ball !== me.ball || s.revision !== world.revision) s.set({ seat: me.seat, ball: me.ball, revision: world.revision }); }

/** Offline: run the authoritative step locally. Online: predict free balls between snapshots. */
export function tickWorld(dt: number) {
  if (online()) { for (const b of world.balls) if (b.state !== 'held') stepBall(b, dt); return; }
  const actors = [me, ...[...livePeers.values()].map(p => ({ id: p.id, x: p.x, z: p.z, y: p.y }))];
  const events = world.step(dt, actors);
  if (events.length) emit(events);
  syncUi();
}
