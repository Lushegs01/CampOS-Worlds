// Parties: small invite-only groups inside one room.
//
// A party lives in the room server's memory. It exists while its members are connected, with a
// short grace period so a reload or a dropped connection rejoins it, and it is never persisted:
// this room is one bounded process, so parties do not span rooms or survive a restart. Members are
// keyed by their room session token (stable across reconnects, never sent to clients); everything
// a client sees is keyed by its current connection id.
//
// The room decides WHO may be invited (privacy settings, blocks) before calling invite(); this
// module enforces everything about the party itself: membership, size, leadership and expiry.
import { randomUUID } from 'node:crypto';

export const PARTY_LIMITS = { size: 6, inviteMs: 60_000, graceMs: 45_000, invitesPerTarget: 5 };

/**
 * @param {{ send: (client: any, message: object) => void, describe: (client: any) => { id: string, name: string, handle: string | null }, limits?: typeof PARTY_LIMITS, now?: () => number }} options
 */
export function createParties({ send, describe, limits = PARTY_LIMITS, now = () => Date.now() }) {
  const parties = new Map();
  const fail = reason => ({ ok: false, reason });
  const partyOf = c => { const p = c?.party ? parties.get(c.party) : null; return p && p.members.get(c.token)?.client === c ? p : null; };
  const memberById = (p, id) => [...p.members.values()].find(m => m.client?.id === id);
  const enter = (p, c) => { p.members.set(c.token, { key: c.token, client: c, joinedAt: now(), awayUntil: 0, ...describe(c) }); c.party = p.id; };

  function view(p) {
    return {
      id: p.id, max: limits.size,
      leader: p.members.get(p.leader)?.client?.id ?? null,
      members: [...p.members.values()].sort((a, b) => a.joinedAt - b.joinedAt).map(m => ({ ...(m.client ? describe(m.client) : { id: null, name: m.name, handle: m.handle }), leader: m.key === p.leader, away: !m.client })),
      invites: [...p.invites.entries()].map(([id, i]) => ({ id, name: i.name, expires: i.expires })),
    };
  }
  function broadcast(p) {
    for (const m of p.members.values()) if (m.client) Object.assign(m, describe(m.client));
    const v = view(p);
    for (const m of p.members.values()) if (m.client) send(m.client, { type: 'party', party: v });
  }
  /** Pass leadership to the longest-standing connected member (or anyone, if all are away). */
  function succeed(p) {
    const order = [...p.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    p.leader = (order.find(m => m.client) ?? order[0])?.key ?? null;
  }
  function dissolve(p) {
    for (const [id, inv] of p.invites) if (inv.target) send(inv.target, { type: 'partyInviteGone', party: p.id, reason: 'That party has ended.' });
    parties.delete(p.id);
  }
  function remove(p, key) {
    const m = p.members.get(key); if (!m) return;
    p.members.delete(key);
    if (m.client) { m.client.party = null; send(m.client, { type: 'party', party: null }); }
    if (!p.members.size) { dissolve(p); return; }
    const wasLeader = p.leader === key;
    if (wasLeader) succeed(p);
    for (const o of p.members.values()) if (o.client) send(o.client, { type: 'notice', text: wasLeader ? `${m.name} left the party. ${p.members.get(p.leader)?.name} now leads it.` : `${m.name} left the party.` });
    broadcast(p);
  }
  function create(c) {
    if (partyOf(c)) return fail('You’re already in a party.');
    const p = { id: randomUUID(), leader: c.token, members: new Map(), invites: new Map(), created: now() };
    enter(p, c); parties.set(p.id, p); broadcast(p);
    return { ok: true, party: p.id };
  }

  return {
    parties, partyOf, view,
    sameParty: (a, b) => { const p = partyOf(a); return !!p && p === partyOf(b); },
    create,
    /** Invite `target` to the caller's party (creating one when needed). Permission is the room's job. */
    invite(c, target) {
      if (!target || target === c) return fail('Choose another player to invite.');
      let p = partyOf(c);
      if (p && p.members.has(target.token)) return fail(`${target.name} is already in your party.`);
      const existing = p?.invites.get(target.id);
      if (p && !existing && p.members.size + p.invites.size >= limits.size) return fail(`Your party is full (${limits.size}).`);
      if (!existing && [...parties.values()].filter(o => o.invites.has(target.id)).length >= limits.invitesPerTarget) return fail(`${target.name} has several invitations waiting. Try again in a minute.`);
      if (!p) { create(c); p = partyOf(c); }
      const inv = { by: c.token, name: target.name, target, expires: now() + limits.inviteMs };
      p.invites.set(target.id, inv);
      send(target, { type: 'partyInvite', invite: { party: p.id, from: describe(c), size: p.members.size, expires: inv.expires } });
      broadcast(p);
      return { ok: true, party: p.id };
    },
    respond(c, partyId, accept) {
      const p = parties.get(partyId), inv = p?.invites.get(c.id);
      if (!p || !inv) return fail('That invitation has expired.');
      p.invites.delete(c.id);
      const inviter = p.members.get(inv.by)?.client;
      if (!accept) {
        if (inviter) send(inviter, { type: 'notice', text: `${c.name} declined your party invitation.` });
        broadcast(p); return { ok: true, joined: false };
      }
      if (p.members.size >= limits.size) { broadcast(p); return fail('That party is full now.'); }
      const old = partyOf(c);
      if (old) remove(old, c.token);
      enter(p, c);
      for (const m of p.members.values()) if (m.client && m.client !== c) send(m.client, { type: 'notice', text: `${c.name} joined the party.` });
      broadcast(p);
      return { ok: true, joined: true, party: p.id };
    },
    leave(c) { const p = partyOf(c); if (!p) return fail('You’re not in a party.'); remove(p, c.token); return { ok: true }; },
    kick(c, id) {
      const p = partyOf(c); if (!p) return fail('You’re not in a party.');
      if (p.leader !== c.token) return fail('Only the party leader can remove members.');
      // Members who lost connection cannot be picked out by id; their place lapses after the grace period.
      const m = memberById(p, id);
      if (!m || m.key === c.token) return fail('That player isn’t in your party.');
      if (m.client) send(m.client, { type: 'notice', text: 'The party leader removed you from the party.' });
      remove(p, m.key); return { ok: true };
    },
    promote(c, id) {
      const p = partyOf(c); if (!p) return fail('You’re not in a party.');
      if (p.leader !== c.token) return fail('Only the party leader can hand over leadership.');
      const m = memberById(p, id); if (!m || m.key === c.token) return fail('That player isn’t in your party.');
      p.leader = m.key; send(m.client, { type: 'notice', text: 'You now lead the party.' }); broadcast(p);
      return { ok: true };
    },
    /** Cancel an invitation the caller's party sent. */
    uninvite(c, id) {
      const p = partyOf(c), inv = p?.invites.get(id);
      if (!inv) return fail('That invitation has already ended.');
      p.invites.delete(id); send(inv.target, { type: 'partyInviteGone', party: p.id, reason: 'The invitation was withdrawn.' }); broadcast(p);
      return { ok: true };
    },
    /** A member disconnected: keep their place for the grace period; hand over leadership now. */
    disconnect(c) {
      for (const p of parties.values()) if (p.invites.delete(c.id)) broadcast(p);
      const p = partyOf(c); if (!p) return;
      const m = p.members.get(c.token); m.client = null; m.awayUntil = now() + limits.graceMs;
      if (p.leader === c.token && [...p.members.values()].some(o => o.client)) { succeed(p); const lead = p.members.get(p.leader); send(lead.client, { type: 'notice', text: `${m.name} lost connection, so you lead the party for now.` }); }
      broadcast(p);
    },
    /** A reconnecting session (same token) takes its place back. */
    reconnect(c) {
      for (const p of parties.values()) {
        const m = p.members.get(c.token);
        if (m && !m.client) { m.client = c; m.awayUntil = 0; c.party = p.id; broadcast(p); return true; }
      }
      return false;
    },
    /** Names or handles changed (profile edits, sign-in): refresh what members see. */
    touch(c) { const p = partyOf(c); if (p) broadcast(p); },
    step() {
      const t = now();
      for (const p of [...parties.values()]) {
        let changed = false;
        for (const [id, inv] of p.invites) if (inv.expires <= t) {
          p.invites.delete(id); changed = true;
          send(inv.target, { type: 'partyInviteGone', party: p.id, reason: 'The invitation expired.' });
          const by = p.members.get(inv.by)?.client; if (by) send(by, { type: 'notice', text: `Your party invitation to ${inv.name} expired.` });
        }
        for (const m of [...p.members.values()]) if (!m.client && m.awayUntil <= t) { remove(p, m.key); changed = false; if (!parties.has(p.id)) break; }
        if (changed && parties.has(p.id)) broadcast(p);
      }
    },
  };
}
