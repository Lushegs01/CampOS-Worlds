// Campus characters on the client (shared/npcs.mjs). Online, the room is authoritative: it says who is on
// duty and who is talking to whom, and this mirrors it. Offline, the same director runs here. Either way the
// scene draws every character from its definition and the room clock, so nothing here changes per frame.
import { create } from 'zustand';
import { createNpcDirector, eligibility, lineClear, NPC_BY_ID, NPCS, npcKey, npcPose } from '../../shared/npcs.mjs';
import { POINTS } from '../../shared/interactions.mjs';
import { BUILDING_BY_ID } from '../../shared/buildings.mjs';
import { ORDER_READY_S } from '../../shared/cafe.mjs';
import { onRoomMessage } from '../network/messages';
import { send, selfConnection } from '../network/client';
import { registerCandidates } from '../interaction/controller';
import { me, onWorldEvent } from '../interaction/world';
import { sfx } from '../interaction/sound';
import { mySpace } from '../dorm/client';
import { livePeers, player, roomPlayback, useGame } from '../state';
import { QA_HOOKS } from '../qa';

export type NpcDef = typeof NPCS[number];
export type NpcState = { mode: 'routine' | 'engaged'; epoch?: number; from?: { x: number; z: number; at: number } | null; x?: number; z?: number; yaw?: number; by?: { id: string; at: number }[]; gesture?: { kind: string; at: number; to: string | null } | null; since?: number };
export type Result = { ok: boolean; reason?: string; replayed?: boolean; first?: boolean; number?: number; items?: string[]; total?: number; readyAt?: number; served?: boolean };

/**
 * The room time the cast is drawn at: the same playback point as other players, kept after a disconnect so
 * nobody jumps by this device's clock error; this device's clock if the room was never reached.
 */
export const npcNow = () => roomPlayback.time(performance.now()) ?? Date.now();
/** One director for the cast: loaded from the room while connected, run here while exploring offline. */
const director = createNpcDirector({ now: npcNow });
const online = () => useGame.getState().status === 'connected';
export const npcState = (id: string) => director.npcs.get(id) as NpcState | undefined;
export const npcDef = (id: string) => NPC_BY_ID.get(id) as NpcDef | undefined;
/** Who we are in conversations: our room connection, or 'local' offline. */
const myId = () => online() ? selfConnection() : me.id;
/** The local player as the director sees them. */
const meView = () => ({ id: myId(), key: 'local', x: player.x, z: player.z, y: player.y, seat: me.seat, ball: me.ball, vehicle: me.vehicle, space: mySpace() || undefined });

// React-visible slice: who is on duty (the scene mounts one character per id) and a revision for dialogues.
interface NpcUi { active: string[]; revision: number; talking: string | null; busy: string | null; /** The dialogue topic to open with. */ topic: string | null }
export const useNpcs = create<NpcUi>(() => ({ active: [...director.npcs.keys()], revision: 0, talking: null, busy: null, topic: null }));
function refresh() {
  const active = NPCS.map(d => d.id).filter(id => director.npcs.has(id)), s = useNpcs.getState();
  useNpcs.setState({ active: active.join() === s.active.join() ? s.active : active, revision: director.revision });
  // A character who went off duty mid-conversation: close the dialogue and say why.
  const talking = s.talking;
  if (talking && !director.npcs.has(talking)) {
    const d = npcDef(talking)!, why = eligibility(d, director.buildings, npcNow()).reason;
    useNpcs.setState({ talking: null });
    if (useGame.getState().panel === `npc:${talking}`) useGame.getState().set({ panel: null });
    useGame.getState().notify(`${d.name} has stepped away. ${why ?? ''}`.trim());
  }
}
/** How complete a building is, and whether a character's threshold is met (the dialogues explain availability). */
export const buildingStatus = (id: string) => director.buildings.get(id);
export const npcEligibility = (id: string) => eligibility(npcDef(id)!, director.buildings, npcNow(), director.valid(id));

// ------------------------------------------------------------------ requests
let ref = 0;
const pending = new Map<number, (r: Result) => void>();
function call(type: 'npc' | 'cafeOrder', payload: Record<string, unknown>): Promise<Result> {
  const r = ++ref;
  return new Promise(resolve => {
    if (!send({ type, ref: r, ...payload })) { resolve({ ok: false, reason: 'Not connected to the campus.' }); return; }
    pending.set(r, resolve);
    setTimeout(() => { if (pending.delete(r)) resolve({ ok: false, reason: 'The campus did not respond. Try again.' }); }, 5000);
  });
}
onRoomMessage(m => {
  if (m.type === 'npcs' || (m.type === 'welcome' && m.npcs)) { director.load(m.type === 'npcs' ? m : m.npcs); refresh(); }
  else if (m.type === 'npcState') { director.apply(m.changes); refresh(); }
  else if (m.type === 'npcResult' || m.type === 'cafeOrderResult') { const done = pending.get(m.ref); pending.delete(m.ref); done?.(m as Result); }
  else if (m.type === 'cafeOrderReady' && Number.isInteger(m.number)) useGame.getState().notify(`Order #${m.number} is ready at the café counter. Enjoy!`);
  else if (m.type === 'disconnected') {
    for (const done of pending.values()) done({ ok: false, reason: 'The connection to the campus was interrupted.' });
    pending.clear(); director.releaseAll(); refresh();
  }
});

/** Offline, the local director plays the room's part; its order "ready" call is a local timer. */
function local(type: 'talk' | 'leave' | 'order', id: string, args: Record<string, unknown> = {}): Result {
  const r = type === 'talk' ? director.talk(meView(), id) : type === 'leave' ? director.leave(meView(), id) : director.order(meView(), args as never);
  if (type === 'order' && r.ok && !r.replayed) setTimeout(() => { useGame.getState().notify(`Order #${r.number} is ready at the café counter. Enjoy!`); if (r.served) director.gesture('vendor', 'wave', Date.now(), myId()); refresh(); }, ORDER_READY_S * 1000);
  refresh(); return r as Result;
}

/**
 * Start a conversation: the character (and the room) must agree, then the dialogue opens (at `topic`, if
 * given). `fallback` is a panel to open instead if they can't talk (the fixture they serve at).
 */
export async function talkTo(id: string, topic: string | null = null, fallback: string | null = null) {
  const s = useNpcs.getState(); if (s.busy) return;
  useNpcs.setState({ busy: id });
  const r = online() ? await call('npc', { action: 'talk', id }) : local('talk', id);
  useNpcs.setState({ busy: null });
  if (!r.ok && fallback) { useGame.getState().set({ panel: fallback }); document.exitPointerLock?.(); return; }
  if (!r.ok) { useGame.getState().notify(r.reason ?? 'They can’t talk right now.'); sfx('deny'); return; }
  const pose = npcPose(npcDef(id)!, npcState(id), npcNow());
  player.yaw = Math.atan2(pose.x - player.x, pose.z - player.z);
  useNpcs.setState({ talking: id, topic });
  useGame.getState().set({ panel: `npc:${id}` }); document.exitPointerLock?.();
}
/** End our conversation (the dialogue closed). */
function leave(id: string) { if (online()) void call('npc', { action: 'leave', id }); else local('leave', id); }
// Offline the local rules score baskets here; online the room makes the coach cheer.
onWorldEvent(e => { if (!online() && e.type === 'score' && director.react(e)) refresh(); });
// Offline the local director also keeps time: greetings, the end of conversations, working hours.
setInterval(() => { if (!online() && useGame.getState().phase === 'playing' && director.step([meView()])) refresh(); }, 500);
// Closing the dialogue, by any route (Escape, the close button, another panel), ends the conversation.
useGame.subscribe((s, prev) => {
  const was = prev.panel?.startsWith('npc:') ? prev.panel.slice(4) : null;
  if (was && s.panel !== prev.panel) { leave(was); if (useNpcs.getState().talking === was) useNpcs.setState({ talking: null }); }
});

/**
 * A demo café order (src/ui/Interaction.tsx Counter). `req` identifies this attempt: sending the same one
 * again (after a timeout) returns the same order instead of placing a second.
 */
export function placeOrder(items: string[], via: 'counter' | 'vendor', req: string): Promise<Result> {
  return online() ? call('cafeOrder', { items, via, req }) : Promise.resolve(local('order', '', { items, via, req }));
}

// ------------------------------------------------------------------ prompts
const pose = {} as ReturnType<typeof npcPose>;
/** Where the player who started a conversation stands (they are faced), or null. */
export function engager(s: NpcState | undefined) {
  const id = s?.mode === 'engaged' ? s.by?.[0]?.id : null; if (!id) return null;
  if (id === myId()) return player;
  const p = livePeers.get(id); return p && !p.space ? p : null;
}
registerCandidates(rank => {
  if (player.y > .05 || mySpace()) return [];
  const out = [], t = npcNow(), mine = myId(), busy = useNpcs.getState().busy;
  for (const [id, s] of director.npcs) {
    const d = npcDef(id)!; npcPose(d, s, t, pose);
    if (Math.abs(pose.x - player.x) > 5 || Math.abs(pose.z - player.z) > 5 || Math.hypot(pose.x - player.x, pose.z - player.z) > d.talk.range || !lineClear(player.x, player.z, pose.x, pose.z)) continue;
    const others = s.mode === 'engaged' && !s.by?.some(b => b.id === mine);
    out.push({ id: npcKey(id), kind: 'npc', label: d.talk.label, key: 'E', hint: others ? `${d.name} · helping someone, you can still ask` : `${d.name} · ${d.role}`, disabled: busy === id, score: rank(d.talk.priority, pose.x, pose.z), run: () => void talkTo(id) });
  }
  // A character serving at a fixture answers its prompt (same label, just ahead of the fixture's own).
  for (const id of director.npcs.keys()) {
    const serves = npcDef(id)!.serves, f = serves && POINTS.find(p => p.id === serves.fixture);
    if (!f || Math.hypot(f.x - player.x, f.z - player.z) > f.range) continue;
    out.push({ id: `${npcKey(id)}:${f.id}`, kind: 'npc', label: f.label, key: 'E', hint: `${npcDef(id)!.name} · ${npcDef(id)!.role}`, disabled: busy === id, score: rank(4, f.x, f.z) + 1.05, run: () => void talkTo(id, serves.topic, `fixture:${f.id}`) });
  }
  return out;
});

// QA builds: inspect the cast and, offline, change a building's completion.
if (QA_HOOKS) (window as unknown as Record<string, unknown>).__campusNpcs = {
  list: () => [...director.npcs.keys()].map(id => ({ id, ...npcPose(npcDef(id)!, npcState(id), npcNow()), mode: npcState(id)!.mode, by: npcState(id)!.by?.map(b => b.id) ?? [] })),
  pose: (id: string) => ({ ...npcPose(npcDef(id)!, npcState(id), npcNow()) }),
  buildings: () => director.buildings.snapshot(),
  setBuilding: (id: string, completion: number) => { if (online()) return { ok: false, reason: 'Online the room decides: use the admin endpoint.' }; const r = director.setBuilding(id, { completion }); refresh(); return r; },
  talk: (id: string) => talkTo(id), talking: () => useNpcs.getState().talking, spawns: () => Object.fromEntries(director.spawns),
  building: (id: string) => BUILDING_BY_ID.get(id),
};
