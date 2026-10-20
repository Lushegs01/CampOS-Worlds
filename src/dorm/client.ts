// Rooms in Palm House (shared/dorm.mjs): your own room, and friends' rooms you visit. Entering, leaving,
// visiting, inviting and saving all go through the room server, which decides everything; this keeps the
// client's view of it: whose room we are in, its layout (shown and collided with), visitors, invitations.
import { create } from 'zustand';
import { input, player, trail, useGame } from '../state';
import { onRoomMessage, send, selfConnection } from '../network/client';
import { registerCandidates } from '../interaction/controller';
import { DORM_DOOR, nearDormDoor } from '../../shared/dorm.mjs';

export type DormItem = { t: string; x: number; z: number; r: number; c: number };
export type DormLayout = { items: DormItem[] };
export type Person = { id: string; name: string; handle: string | null };
export type RoomInvite = { host: string; from: Person; expires: number };
type Action = 'enter' | 'leave' | 'save' | 'invite' | 'visit' | 'showOut';
type Result = { ok: boolean; ref?: number | null; reason?: string; layout?: DormLayout; saved?: 'account' | 'session'; keeps?: 'account' | 'session'; x?: number; z?: number; yaw?: number; host?: string; hostName?: string; to?: string; visitors?: Person[] };

interface DormState {
  /** In a room: our own (host is our connection id) or a friend's. */
  inside: boolean; host: string; hostName: string; layout: DormLayout | null; keeps: 'account' | 'session'; busy: boolean;
  /** People visiting our room (we are its resident). */ visitors: Person[];
  /** Invitations to friends' rooms. */ invites: RoomInvite[];
}
export const useDorm = create<DormState>(() => ({ inside: false, host: '', hostName: '', layout: null, keeps: 'session', busy: false, visitors: [], invites: [] }));
/** In our own room (not visiting someone else's). */
export const isResident = (s: DormState) => s.inside && s.host === selfConnection();

/** The furniture we are walking among (null outside a room): read every movement substep. */
export const dormLayout = () => { const s = useDorm.getState(); return s.inside ? s.layout : null; };
/** The space whose players we draw: the room we are in (named by its resident), otherwise the campus (''). */
export const mySpace = () => { const s = useDorm.getState(); return s.inside ? s.host : ''; };

/** Put the player where the room put us, facing `yaw`, with the camera behind them. */
function arrive(r: Result) {
  if (typeof r.x !== 'number' || typeof r.z !== 'number') return;
  Object.assign(player, { x: r.x, z: r.z, y: 0, vy: 0, reconcile: null }); trail.clear();
  if (typeof r.yaw === 'number') { player.yaw = r.yaw; input.yaw = r.yaw + Math.PI; }
}
// Correlate replies even after a request timed out and the same action was retried.
let requestRef = 0;
const pending: { ref: number; action: Action; done: (r: Result) => void }[] = [];
function request(action: Action, extra: Record<string, unknown> = {}): Promise<Result> {
  const ref = ++requestRef;
  if (useGame.getState().status !== 'connected' || !send({ type: 'dorm', ref, action, ...extra })) return Promise.resolve({ ok: false, reason: 'Rooms open when you’re connected to the campus.' });
  useDorm.setState({ busy: true });
  return new Promise(resolve => {
    const entry = { ref, action, done: (r: Result) => { clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { const i = pending.indexOf(entry); if (i >= 0) pending.splice(i, 1); useDorm.setState({ busy: pending.length > 0 }); resolve({ ok: false, reason: 'The campus didn’t answer. Try again in a moment.' }); }, 8000);
    pending.push(entry);
  });
}
const notifyFailure = (r: Result, fallback: string) => { if (!r.ok) useGame.getState().notify(r.reason ?? fallback); return r; };

export const enterDorm = async () => notifyFailure(await request('enter'), 'Your room could not be opened.');
export const leaveDorm = async () => notifyFailure(await request('leave'), 'You couldn’t leave the room just now.');
/** Save a new arrangement of our room. The room checks it and answers with the clean layout, or a reason. */
export const saveLayout = (layout: DormLayout) => request('save', { layout });
/** Invite a friend (by account id) while we are in our room. */
export async function inviteToRoom(accountId: string) {
  const r = await request('invite', { to: accountId });
  useGame.getState().notify(r.ok ? `Invitation sent to ${r.to}.` : r.reason ?? 'The invitation could not be sent.');
  return r;
}
/** Go to a friend's room (they invited us, or they let friends drop in while they are in). */
export async function visitRoom(host: string) {
  const r = notifyFailure(await request('visit', { host }), 'That room isn’t open right now.');
  useDorm.setState(s => ({ invites: s.invites.filter(i => i.host !== host) }));
  return r;
}
export const declineRoomInvite = (host: string) => useDorm.setState(s => ({ invites: s.invites.filter(i => i.host !== host) }));
/** Show a visitor out of our room. */
export const showOut = async (id: string) => notifyFailure(await request('showOut', { id }), 'That visitor couldn’t be shown out.');

function closeRoomPanels() { const panel = useGame.getState().panel; if (panel === 'dorm' || panel === 'dorm-guests') useGame.getState().set({ panel: null }); }
onRoomMessage(m => {
  if (m.type === 'dormResult') {
    const r = m as Result & { action: Action };
    // A leave the room decided on its own (the resident left, we were shown out) comes with a reason and answers no request.
    const i = r.action === 'leave' && r.ok && r.reason && r.ref == null ? -1 : typeof r.ref === 'number' ? pending.findIndex(p => p.ref === r.ref) : pending.findIndex(p => p.action === r.action), resolve = i >= 0 ? pending.splice(i, 1)[0].done : null;
    if (r.ok && (r.action === 'enter' || r.action === 'visit')) {
      useDorm.setState({ inside: true, host: r.host ?? selfConnection(), hostName: r.action === 'visit' ? r.hostName ?? '' : '', layout: r.layout ?? null, keeps: r.keeps ?? 'session', visitors: [] });
      arrive(r); useGame.getState().set({ panel: null });
    }
    if (r.ok && r.action === 'leave') { useDorm.setState({ inside: false, host: '', hostName: '', visitors: [] }); arrive(r); closeRoomPanels(); if (!resolve && r.reason) useGame.getState().notify(r.reason); }
    if (r.ok && r.action === 'save' && r.layout) useDorm.setState({ layout: r.layout });
    if (r.ok && r.action === 'showOut' && r.visitors) useDorm.setState({ visitors: r.visitors });
    useDorm.setState({ busy: pending.length > 0 });
    resolve?.(r);
  }
  if (m.type === 'dormLayout' && useDorm.getState().inside) useDorm.setState({ layout: m.layout });
  if (m.type === 'dormVisitors') useDorm.setState({ visitors: m.visitors });
  if (m.type === 'dormInvite') useDorm.setState(s => ({ invites: [...s.invites.filter(i => i.host !== m.host), { host: m.host, from: m.from, expires: m.expires }] }));
  // A new session starts outside (rooms reopen on request); travelling to a party member leaves the room.
  if (m.type === 'welcome' || m.type === 'disconnected' || (m.type === 'meetUpResult' && m.ok)) {
    closeRoomPanels();
    if (m.type !== 'meetUpResult') pending.splice(0).forEach(p => p.done({ ok: false, reason: 'The connection to the campus was interrupted.' }));
    useDorm.setState({ inside: false, host: '', hostName: '', visitors: [], busy: false, ...(m.type === 'meetUpResult' ? {} : { invites: [] }) });
  }
});

// The residents' door: "Go to your room" from the common room, "Back to the common room" from inside.
registerCandidates(rank => {
  const s = useDorm.getState();
  if (!nearDormDoor(player.x, player.z, s.inside)) return [];
  const z = s.inside ? DORM_DOOR.insideFace : DORM_DOOR.outsideFace;
  return [s.inside
    ? { id: 'dorm-leave', kind: 'dorm', label: 'Back to the common room', key: 'E', hint: s.hostName ? `${s.hostName}’s room` : 'Your room', disabled: s.busy, score: rank(6, DORM_DOOR.x, z), run: () => void leaveDorm() }
    : { id: 'dorm-enter', kind: 'dorm', label: 'Go to your room', key: 'E', hint: 'Palm House · Residents', disabled: s.busy, score: rank(6, DORM_DOOR.x, z), run: () => void enterDorm() }];
});
