// The room's side of the campus characters (shared/npcs.mjs): one director for everyone, the messages
// that talk to it, and what clients are told. Characters are never players: they have no connection, no
// account and no place in the player list, the online count, parties, friends or rankings.
//
// Clients draw each character from its definition and the room clock, so the room sends state only when
// it changes (a conversation, a greeting, a served order, a building's completion), never positions.
import { createNpcDirector, NPCS } from '../shared/npcs.mjs';
import { ORDER_READY_S } from '../shared/cafe.mjs';

const str = v => typeof v === 'string' ? v : '';
/**
 * `send(c, message)` to one client, `broadcast(message)` to everyone, `later(fn, ms)` for timers the room
 * cancels when it closes, `session(token)` for the joined client holding a session now (after a reconnect),
 * `overrides` for building completion (shared/buildings.mjs parseCompletionOverrides).
 */
export function createNpcService({ overrides = {}, send, broadcast, later = setTimeout, session = () => null, now = Date.now, log = () => {} } = {}) {
  const director = createNpcDirector({ overrides, deep: true, now });
  for (const d of NPCS) if (!director.valid(d.id)) log(`Campus character ${d.id} has an invalid definition and stays off duty.`);
  const metrics = { talks: 0, orders: 0, refused: 0 };
  // What every client last heard, per character, and the building revision: changes go out as small deltas.
  let sentBuildings = director.buildings.revision, sentRevision = director.revision;
  const sentState = new Map(director.snapshot().npcs.map(s => [s.id, JSON.stringify(s)]));
  /** A room client as the director sees it (its session token keeps orders idempotent across reconnects). */
  const view = c => ({ id: c.id, key: c.token, x: c.x, z: c.z, y: c.y, seat: c.seat, ball: c.ball, vehicle: c.vehicle, space: c.dorm ? c.dorm.host.id : undefined });
  function flush() {
    if (director.revision === sentRevision) return;
    sentRevision = director.revision;
    const snap = director.snapshot();
    if (director.buildings.revision !== sentBuildings) {
      sentBuildings = director.buildings.revision; sentState.clear();
      for (const s of snap.npcs) sentState.set(s.id, JSON.stringify(s));
      broadcast({ type: 'npcs', ...snap }); return;
    }
    const changes = [], live = new Set();
    for (const s of snap.npcs) { live.add(s.id); const raw = JSON.stringify(s); if (sentState.get(s.id) !== raw) { sentState.set(s.id, raw); changes.push(s); } }
    for (const id of [...sentState.keys()]) if (!live.has(id)) { sentState.delete(id); changes.push({ id, mode: 'gone' }); }
    if (changes.length) broadcast({ type: 'npcState', at: snap.at, changes });
  }
  return {
    director, metrics,
    snapshot: () => director.snapshot(),
    /** { type: 'npc', action: 'talk' | 'leave', id, ref } */
    handle(c, m) {
      const ref = Number.isSafeInteger(m.ref) ? m.ref : null, id = str(m.id).slice(0, 40), action = str(m.action);
      const r = action === 'talk' ? director.talk(view(c), id) : action === 'leave' ? director.leave(view(c), id) : { ok: false, reason: 'Unknown action.' };
      if (action === 'talk') { if (r.ok && !r.replayed) metrics.talks++; else if (!r.ok) metrics.refused++; }
      send(c, { type: 'npcResult', ref, action: action.slice(0, 8), id, ...r }); flush();
    },
    /** { type: 'cafeOrder', ref, req, items, via }: a demo order, numbered by the room and called when ready. */
    order(c, m) {
      const ref = Number.isSafeInteger(m.ref) ? m.ref : null, r = director.order(view(c), { items: m.items, req: m.req, via: m.via });
      send(c, { type: 'cafeOrderResult', ref, ...r });
      if (r.ok && !r.replayed) {
        metrics.orders++;
        const token = c.token, number = r.number;
        later(() => {
          // The same session, even after a reconnect, hears its number called; nobody else does.
          const here = c.joined ? c : session(token);
          if (here) send(here, { type: 'cafeOrderReady', number });
          if (r.served && director.npcs.has('vendor')) director.gesture('vendor', 'wave', now(), here?.id ?? null);
          flush();
        }, ORDER_READY_S * 1000);
      } else if (!r.ok) metrics.refused++;
      flush();
    },
    /** Twice a second from the room's tick: conversations, greetings and working hours. */
    step(players) { director.step(players.map(view)); flush(); },
    /** World events from the tick (a basket earns the coach's cheer). */
    react(events) { for (const e of events) if (e.type === 'score') director.react(e); flush(); },
    /** A player left: their conversations end. */
    release(c) { director.release(view(c)); flush(); },
    /** Admin: change a building's completion or availability. */
    setBuilding(id, change) { const r = director.setBuilding(str(id), change); flush(); return r; },
  };
}
