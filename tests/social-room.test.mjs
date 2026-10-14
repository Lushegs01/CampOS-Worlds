// Parties, chat channels, blocks and social nudges over real WebSockets. Guest flows use a plain
// room; account flows use the local Supabase stand-in on a real PostgreSQL with the migrations, so
// friendships, blocks and privacy settings come from the database exactly as in production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { startDatabase } from './support/postgres.mjs';
import { startLocalSupabase } from './support/local-supabase.mjs';
import { createRoom } from '../server/room.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { blocked } from '../shared/campus.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function next(ws, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(new Error('Message timeout')); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
/** Resolves true if a matching message arrives within `ms`, false otherwise. */
const arrives = (ws, predicate, ms = 400) => next(ws, predicate, ms).then(() => true, () => false);
async function join(url, name, extra = {}) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  // Keep everything that arrives, so a message sent in the same packet as the welcome is not missed.
  const log = []; ws.on('message', raw => log.push(JSON.parse(raw)));
  const welcome = next(ws, m => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', name, avatar: {}, ...extra }));
  const w = await welcome;
  const c = { ws, id: w.id, token: w.token, welcome: w, log, send: m => ws.send(JSON.stringify(m)) };
  c.party = (action, args = {}) => { const r = next(ws, m => m.type === 'partyResult' && m.action === action); c.send({ type: 'party', action, ...args }); return r; };
  return c;
}
const close = (...cs) => cs.forEach(c => c?.ws.close());

// ---------------------------------------------------------------- guests
let room, url;
before(async () => { room = createRoom({ port: 0, partyLimits: { size: 3, inviteMs: 600, graceMs: 700, invitesPerTarget: 5 }, meetCooldownMs: 1500 }); url = `ws://127.0.0.1:${(await room.start()).port}/ws`; });
after(async () => { await room?.close(); });

test('guests form a party: invite, accept, decline, expiry, size limit, leave and leadership', async () => {
  const a = await join(url, 'Ada'), b = await join(url, 'Tobi'), c = await join(url, 'Chi'), d = await join(url, 'Dayo');
  try {
    assert.equal(a.welcome.room.id, 'courtyard', 'the room names its instance so parties can be scoped to it');
    const invited = next(b.ws, m => m.type === 'partyInvite');
    assert.equal((await a.party('invite', { id: b.id })).ok, true, 'inviting creates the party');
    const inv = (await invited).invite;
    assert.equal(inv.from.name, 'Ada'); assert.ok(inv.expires > Date.now());
    assert.equal((await a.party('invite', { id: b.id })).ok, true, 're-inviting refreshes the same invitation');
    const joined = next(a.ws, m => m.type === 'party' && m.party?.members.length === 2);
    assert.equal((await b.party('respond', { party: inv.party, accept: true })).ok, true);
    const view = (await joined).party;
    assert.deepEqual(view.members.map(m => m.name), ['Ada', 'Tobi']); assert.equal(view.leader, a.id);
    assert.equal((await b.party('respond', { party: inv.party, accept: true })).ok, false, 'an invitation is used once');
    // Decline.
    const cInvite = next(c.ws, m => m.type === 'partyInvite');
    await a.party('invite', { id: c.id });
    const declined = next(a.ws, m => m.type === 'notice' && /declined/.test(m.text));
    await c.party('respond', { party: (await cInvite).invite.party, accept: false });
    await declined;
    // Expiry (600 ms here).
    const gone = next(c.ws, m => m.type === 'partyInviteGone' && /expired/.test(m.reason), 3000);
    await b.party('invite', { id: c.id }); await gone;
    assert.equal((await c.party('respond', { party: inv.party, accept: true })).ok, false, 'an expired invitation cannot be accepted');
    // Size limit is 3 in this room: two members plus one pending invitation fills it.
    await a.party('invite', { id: c.id });
    assert.match((await a.party('invite', { id: d.id })).reason, /full/);
    await c.party('respond', { party: inv.party, accept: true });
    // Only the leader removes members or hands over leadership.
    assert.match((await b.party('kick', { id: c.id })).reason, /Only the party leader/);
    assert.equal((await a.party('promote', { id: b.id })).ok, true);
    const kicked = next(c.ws, m => m.type === 'party' && m.party === null);
    assert.equal((await b.party('kick', { id: c.id })).ok, true); await kicked;
    // Leaving as leader passes leadership on.
    const handed = next(a.ws, m => m.type === 'party' && m.party?.leader === a.id);
    await b.party('leave'); await handed;
    assert.equal(room.parties.parties.size, 1);
    await a.party('leave');
    assert.equal(room.parties.parties.size, 0, 'an empty party ends');
  } finally { close(a, b, c, d); }
});

test('a dropped member keeps their place briefly and a reconnect with the same session restores it', async () => {
  const a = await join(url, 'Lead'), b = await join(url, 'Member'), c = await join(url, 'Third');
  try {
    const inv = next(b.ws, m => m.type === 'partyInvite'); await a.party('invite', { id: b.id });
    await b.party('respond', { party: (await inv).invite.party, accept: true });
    const inv2 = next(c.ws, m => m.type === 'partyInvite'); await a.party('invite', { id: c.id });
    await c.party('respond', { party: (await inv2).invite.party, accept: true });
    // The leader drops: leadership passes at once; their place is held.
    const away = next(b.ws, m => m.type === 'party' && m.party?.members.some(x => x.name === 'Lead' && x.away));
    a.ws.close();
    const v = (await away).party;
    assert.equal(v.leader, b.id, 'the longest-standing connected member leads');
    const back = await join(url, 'Lead', { token: a.token });
    await sleep(100);
    const restored = back.log.find(m => m.type === 'party' && m.party);
    assert.ok(restored?.party.members.some(x => x.id === back.id && !x.away), 'the same session rejoins its party');
    // Someone who stays away longer than the grace period (700 ms here) is removed.
    const lapsed = next(back.ws, m => m.type === 'party' && m.party?.members.length === 2, 3000);
    c.ws.close(); await lapsed;
    close(back);
  } finally { close(b, c); }
});

test('party chat reaches only the party; room chat is labelled, cleaned and resists flooding and impersonation', async () => {
  const a = await join(url, 'Admin'), b = await join(url, 'Bola ✓'), out = await join(url, 'Outsider');
  try {
    const inv = next(b.ws, m => m.type === 'partyInvite'); await a.party('invite', { id: b.id });
    await b.party('respond', { party: (await inv).invite.party, accept: true });
    const leak = arrives(out.ws, m => m.type === 'chat' && m.channel === 'party');
    const got = next(b.ws, m => m.type === 'chat' && m.channel === 'party');
    a.send({ type: 'partyChat', text: 'Courts in 5?' });
    const msg = await got;
    assert.equal(msg.text, 'Courts in 5?'); assert.equal(msg.name, 'Explorer', 'guests cannot take staff-like names');
    assert.equal(await leak, false, 'party chat never reaches non-members');
    const notice = next(out.ws, m => m.type === 'notice' && /party/.test(m.text)); out.send({ type: 'partyChat', text: 'hi' }); await notice;
    const room1 = next(out.ws, m => m.type === 'chat' && m.channel === 'room');
    b.send({ type: 'chat', text: 'hello ‮everyone' });
    const seen = await room1;
    assert.equal(seen.text, 'hello everyone', 'direction-override characters are stripped'); assert.equal(seen.name, 'Bola', 'guests cannot fake a verified mark');
    assert.equal(seen.verified, false); assert.equal(seen.handle, null);
    b.send({ type: 'chat', text: 'spam' }); b.send({ type: 'chat', text: 'SPAM' });
    const refused = next(b.ws, m => m.type === 'notice' && /repeat/.test(m.text)); b.send({ type: 'chat', text: 'spam ' }); await refused;
  } finally { close(a, b, out); }
});

test('meet up travels only to a party member, to a clear reachable spot, with a cooldown', async () => {
  const a = await join(url, 'Walker'), b = await join(url, 'Friend'), stranger = await join(url, 'Stranger');
  try {
    const meet = (who, id) => { const r = next(who.ws, m => m.type === 'meetUpResult'); who.send({ type: 'meetUp', id }); return r; };
    assert.match((await meet(a, stranger.id)).reason, /members of your party/);
    const inv = next(b.ws, m => m.type === 'partyInvite'); await a.party('invite', { id: b.id });
    await b.party('respond', { party: (await inv).invite.party, accept: true });
    const pb = room.clients.get(b.id); Object.assign(pb, { x: -30, z: -12 }); // inside the library
    const r = await meet(a, b.id);
    assert.equal(r.ok, true, r.reason);
    const pa = room.clients.get(a.id);
    assert.ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) < 4.5); assert.equal(blocked(pa.x, pa.z), false);
    assert.ok(pa.z < -4.3 && pa.x > -41.8 && pa.x < -18.2, 'the spot is inside the same room, not through the wall');
    assert.match((await meet(a, b.id)).reason, /travel again/);
    pa.ball = 'ball-1'; await sleep(1600);
    assert.match((await meet(a, b.id)).reason, /put the ball down/); pa.ball = null;
  } finally { close(a, b, stranger); }
});

// ---------------------------------------------------------------- accounts
let db, supa, aroom, aurl;
before(async () => {
  db = await startDatabase({ name: 'socialroom' });
  supa = await startLocalSupabase({ pool: db.pool });
  aroom = createRoom({ port: 0, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey, log: { warn() {} } }) });
  aurl = `ws://127.0.0.1:${(await aroom.start()).port}/ws`;
}, { timeout: 180000 });
after(async () => { await aroom?.close(); await supa?.close(); await db?.stop(); });

let seq = 0;
async function account(prefix) {
  const sb = createClient(supa.url, supa.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const handle = `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data } = await sb.auth.signUp({ email: `${handle}@example.test`, password: 'correct horse battery' });
  const saved = await sb.rpc('save_profile', { p_handle: handle, p_display_name: handle, p_bio: '', p_avatar: {} });
  assert.equal(saved.error, null, saved.error?.message);
  return { sb, handle, id: data.user.id, token: data.session.access_token };
}
async function online(acct) {
  const c = await join(aurl, 'claimed name', { access: acct.token });
  const auth = await next(c.ws, m => m.type === 'auth'); assert.equal(auth.ok, true, auth.reason);
  return c;
}
async function befriend(a, b) {
  await a.sb.rpc('send_friend_request', { p_handle: b.handle });
  const { data } = await b.sb.rpc('social_overview');
  const r = await b.sb.rpc('respond_friend_request', { p_request: data.incoming[0].id, p_accept: true });
  assert.equal(r.data.relationship, 'friends');
}

test('party invitations follow privacy settings: friends only by default, and friendships made mid-session count', async () => {
  const ada = await account('ada'), tobi = await account('tobi');
  const a = await online(ada), t = await online(tobi);
  try {
    assert.match((await a.party('invite', { id: t.id })).reason, /friends only/);
    await befriend(ada, tobi);
    // Ada's client nudges Tobi's after the change; the room re-reads both friend lists.
    const nudged = next(t.ws, m => m.type === 'social' && m.kind === 'friend');
    a.send({ type: 'socialNotify', to: tobi.id, kind: 'friend' });
    assert.deepEqual(await nudged, { type: 'social', kind: 'friend' }, 'nudges carry no content');
    await sleep(500);
    const inv = next(t.ws, m => m.type === 'partyInvite');
    assert.equal((await a.party('invite', { id: t.id })).ok, true);
    assert.equal((await inv).invite.from.handle, ada.handle);
    // Settings: nobody.
    await tobi.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'nobody', p_appear_offline: false });
    t.send({ type: 'socialRefresh' }); await sleep(500);
    await a.party('leave');
    assert.match((await a.party('invite', { id: t.id })).reason, /isn’t accepting party invitations/);
    // A guest cannot invite an account that only accepts friends.
    const guest = await join(aurl, 'Guest');
    await tobi.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: false });
    t.send({ type: 'socialRefresh' }); await sleep(500);
    assert.match((await guest.party('invite', { id: t.id })).reason, /friends only/);
    close(guest);
  } finally { close(a, t); }
});

test('blocks are enforced by the room: no chat either way, no invitations, no nudges', async () => {
  const ada = await account('blk'), bad = await account('bad'), other = await account('oth');
  const a = await online(ada), b = await online(bad), o = await online(other);
  try {
    const { error } = await ada.sb.rpc('block_player', { p_user: bad.id }); assert.equal(error, null);
    a.send({ type: 'socialRefresh' }); await sleep(500);
    const toAda = arrives(a.ws, m => m.type === 'chat' && m.id === b.id), toOther = next(o.ws, m => m.type === 'chat' && m.id === b.id);
    b.send({ type: 'chat', text: 'can anyone hear me' });
    assert.equal((await toOther).text, 'can anyone hear me', 'other players still hear them');
    assert.equal(await toAda, false, 'the blocker does not receive their chat');
    const toBad = arrives(b.ws, m => m.type === 'chat' && m.id === a.id);
    a.send({ type: 'chat', text: 'hello room' });
    assert.equal(await toBad, false, 'the blocked player does not receive the blocker’s chat either');
    assert.match((await b.party('invite', { id: a.id })).reason, /can’t invite/);
    const nudge = arrives(a.ws, m => m.type === 'social');
    b.send({ type: 'socialNotify', to: ada.id, kind: 'message' });
    assert.equal(await nudge, false, 'nudges from a blocked player are dropped');
    // A block that arrives after an invitation still stops the join.
    for (const acct of [ada, bad, other]) await acct.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'everyone', p_appear_offline: false });
    for (const p of [a, b, o]) p.send({ type: 'socialRefresh' });
    await sleep(500);
    const inviteAda = next(a.ws, m => m.type === 'partyInvite'); await o.party('invite', { id: a.id });
    await a.party('respond', { party: (await inviteAda).invite.party, accept: true });
    const inviteBad = next(b.ws, m => m.type === 'partyInvite');
    assert.equal((await o.party('invite', { id: b.id })).ok, true, 'the inviter has not blocked anyone');
    const refused = await b.party('respond', { party: (await inviteBad).invite.party, accept: true });
    assert.match(refused.reason, /can’t join this party/, 'Ada, already in the party, blocked this player');
    assert.equal(aroom.parties.partyOf(aroom.clients.get(b.id)), null);
    const chat = next(o.ws, m => m.type === 'chat' && m.id === a.id); a.send({ type: 'chat', text: 'verified hello' });
    const seen = await chat; assert.equal(seen.verified, true); assert.equal(seen.handle, ada.handle);
  } finally { close(a, b, o); }
});

test('appear offline withholds the handle from the room roster and chat', async () => {
  const shy = await account('shy'), watcher = await account('wat');
  const s = await online(shy), w = await online(watcher);
  try {
    let state = await next(w.ws, m => m.type === 'state' && m.players.some(p => p.id === s.id && p.handle === shy.handle));
    await shy.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: true });
    s.send({ type: 'socialRefresh' });
    state = await next(w.ws, m => m.type === 'state' && m.players.some(p => p.id === s.id && p.handle === null));
    const me = state.players.find(p => p.id === s.id);
    assert.equal(me.name, shy.handle, 'the avatar and name stay visible: they are present'); assert.equal(me.verified, true);
    const chat = next(w.ws, m => m.type === 'chat' && m.id === s.id); s.send({ type: 'chat', text: 'quietly here' });
    assert.equal((await chat).handle, null);
    assert.equal((await arrives(w.ws, m => m.type === 'social', 300)), false);
    // Nudges are only accepted from signed-in players, to well-formed ids.
    const g = await join(aurl, 'Guest');
    const none = arrives(w.ws, m => m.type === 'social');
    g.send({ type: 'socialNotify', to: watcher.id, kind: 'message' }); w.send({ type: 'socialNotify', to: 'not-a-uuid', kind: 'message' });
    assert.equal(await none, false);
    close(g);
  } finally { close(s, w); }
});
