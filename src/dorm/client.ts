// Your room in Palm House (shared/dorm.mjs): entering and leaving through the room server, the layout
// shown and collided with, and saving a new arrangement. The room server decides everything; this keeps
// the client's view of it.
import { create } from 'zustand';
import { input, player, trail, useGame } from '../state';
import { onRoomMessage, send, selfConnection } from '../network/client';
import { registerCandidates } from '../interaction/controller';
import { DORM_DOOR, nearDormDoor } from '../../shared/dorm.mjs';

export type DormItem = { t: string; x: number; z: number; r: number; c: number };
export type DormLayout = { items: DormItem[] };
type Result = { ok: boolean; reason?: string; layout?: DormLayout; saved?: 'account' | 'session'; keeps?: 'account' | 'session'; x?: number; z?: number; yaw?: number };

interface DormState { inside: boolean; layout: DormLayout | null; keeps: 'account' | 'session'; busy: boolean }
export const useDorm = create<DormState>(() => ({ inside: false, layout: null, keeps: 'session', busy: false }));

/** The furniture we are walking among (null outside the room): read every movement substep. */
export const dormLayout = () => { const s = useDorm.getState(); return s.inside ? s.layout : null; };
/** The space whose players we draw: our own room while inside it, otherwise the campus (''). */
export const mySpace = () => useDorm.getState().inside ? selfConnection() : '';

/** Put the player where the room put us, facing `yaw`, with the camera behind them. */
function arrive(r: Result) {
  if (typeof r.x !== 'number' || typeof r.z !== 'number') return;
  Object.assign(player, { x: r.x, z: r.z, y: 0, vy: 0, reconcile: null }); trail.clear();
  if (typeof r.yaw === 'number') { player.yaw = r.yaw; input.yaw = r.yaw + Math.PI; }
}
let pending: ((r: Result) => void) | null = null;
function request(action: 'enter' | 'leave' | 'save', extra: Record<string, unknown> = {}): Promise<Result> {
  if (useGame.getState().status !== 'connected' || !send({ type: 'dorm', action, ...extra })) return Promise.resolve({ ok: false, reason: 'Your room opens when you’re connected to the campus.' });
  useDorm.setState({ busy: true });
  return new Promise(resolve => {
    const timer = setTimeout(() => { if (pending === done) pending = null; useDorm.setState({ busy: false }); resolve({ ok: false, reason: 'The campus didn’t answer. Try again in a moment.' }); }, 8000);
    const done = (r: Result) => { clearTimeout(timer); resolve(r); };
    pending = done;
  });
}

export async function enterDorm() {
  const r = await request('enter');
  if (!r.ok) useGame.getState().notify(r.reason ?? 'Your room could not be opened.');
  return r;
}
export async function leaveDorm() {
  const r = await request('leave');
  if (!r.ok && r.reason) useGame.getState().notify(r.reason);
  return r;
}
/** Save a new arrangement. The room checks it and answers with the clean layout, or a reason. */
export const saveLayout = (layout: DormLayout) => request('save', { layout });

onRoomMessage(m => {
  if (m.type === 'dormResult') {
    const r = m as Result & { action: string }, resolve = pending; pending = null;
    if (r.ok && r.action === 'enter') { useDorm.setState({ inside: true, layout: r.layout ?? null, keeps: r.keeps ?? 'session' }); arrive(r); useGame.getState().set({ panel: null }); }
    if (r.ok && r.action === 'leave') { useDorm.setState({ inside: false }); arrive(r); if (useGame.getState().panel === 'dorm') useGame.getState().set({ panel: null }); if (!resolve && r.reason) useGame.getState().notify(r.reason); }
    if (r.ok && r.action === 'save' && r.layout) useDorm.setState({ layout: r.layout });
    useDorm.setState({ busy: false });
    resolve?.(r);
  }
  // A new session starts outside (the room reopens on request); travelling to a party member leaves the room.
  if (m.type === 'welcome' || m.type === 'disconnected' || (m.type === 'meetUpResult' && m.ok)) {
    if (useGame.getState().panel === 'dorm') useGame.getState().set({ panel: null });
    useDorm.setState({ inside: false, busy: false });
  }
});

// The residents' door: "Go to your room" from the common room, "Back to the common room" from inside.
registerCandidates(rank => {
  const inside = useDorm.getState().inside, busy = useDorm.getState().busy;
  if (!nearDormDoor(player.x, player.z, inside)) return [];
  const z = inside ? DORM_DOOR.insideFace : DORM_DOOR.outsideFace;
  return [inside
    ? { id: 'dorm-leave', kind: 'dorm', label: 'Back to the common room', key: 'E', hint: 'Your room', disabled: busy, score: rank(6, DORM_DOOR.x, z), run: () => void leaveDorm() }
    : { id: 'dorm-enter', kind: 'dorm', label: 'Go to your room', key: 'E', hint: 'Palm House · Residents', disabled: busy, score: rank(6, DORM_DOOR.x, z), run: () => void enterDorm() }];
});
