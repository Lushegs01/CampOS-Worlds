// Visits to players' rooms, end to end: real friendships and privacy settings in PostgreSQL (local
// Supabase stand-in), real WebSocket clients in a room that checks them. Invitations, dropping in when
// the resident allows it, what visitors may do, being shown out, blocks, and the resident leaving.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { startDatabase } from './support/postgres.mjs';
import { startLocalSupabase } from './support/local-supabase.mjs';
import { createRoom } from '../server/room.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { DEFAULT_LAYOUT, DORM_OUTSIDE, inDormRoom } from '../shared/dorm.mjs';

let db, supa, room, url;
before(async () => {
  db = await startDatabase({ name: 'visits' });
  supa = await startLocalSupabase({ pool: db.pool });
  room = createRoom({ port: 0, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey, log: { warn() {} } }) });
  url = `ws://127.0.0.1:${(await room.start()).port}/ws`;
}, { timeout: 180000 });
after(async () => { await room?.close(); await supa?.close(); await db?.stop(); });

const delay = ms => new Promise(r => setTimeout(r, ms));
let seq = 0;
async function account(name) {
  const sb = createClient(supa.url, supa.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const handle = `${name.toLowerCase()}_${Date.now().toString(36)}${++seq}`;
  const { data } = await sb.auth.signUp({ email: `${handle}@example.test`, password: 'correct horse battery' });
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: name, p_bio: '', p_avatar: { model: 'ada' } })).error, null);
  return { sb, handle, token: data.session.access_token, id: data.user.id };
}
async function befriend(a, b) {
  assert.equal((await a.sb.rpc('send_friend_request', { p_handle: b.handle })).error, null);
  const req = (await b.sb.rpc('social_overview')).data.incoming.find(r => r.player.id === a.id);
  assert.equal((await b.sb.rpc('respond_friend_request', { p_request: req.id, p_accept: true })).error, null);
}
const settings = (a, room_visits) => a.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: false, p_profile_visibility: 'public', p_room_visits: room_visits });
function next(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(Error('Message timeout')); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
async function join(acct) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const welcome = next(ws, m => m.type === 'welcome'), auth = next(ws, m => m.type === 'auth');
  ws.send(JSON.stringify({ type: 'join', name: 'Player', avatar: {}, access: acct.token }));
  const c = { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) }; assert.equal((await auth).ok, true);
  c.id = c.welcome.id; c.server = () => room.clients.get(c.id);
  c.dorm = (action, extra = {}) => { const r = next(ws, m => m.type === 'dormResult' && m.action === action); c.send({ type: 'dorm', action, ...extra }); return r; };
  c.enter = () => { Object.assign(c.server(), { x: DORM_OUTSIDE.x, z: DORM_OUTSIDE.z }); return c.dorm('enter'); };
  c.refresh = () => c.send({ type: 'socialRefresh' });
  c.space = async id => (await next(ws, m => m.type === 'state')).players.find(p => p.id === id)?.space;
  return c;
}
/** Friends both see the friendship (the room re-reads it after a social change, debounced). */
async function settle(...clients) { for (const c of clients) c.refresh(); await delay(600); }

test('a resident invites a friend, who travels straight in, sees the room and can’t rearrange it', async () => {
  const ada = await account('Ada'), tobi = await account('Tobi'), chi = await account('Chi');
  await befriend(ada, tobi);
  const a = await join(ada), t = await join(tobi), c = await join(chi);
  await settle(a, t);
  Object.assign(t.server(), { x: -12, z: 20 }); // Tobi is far away, out on campus
  assert.match((await a.dorm('invite', { to: tobi.id })).reason, /Go to your room/);
  await a.enter();
  assert.match((await a.dorm('invite', { to: chi.id })).reason, /friends only/, 'not a friend');
  assert.match((await a.dorm('visit', { host: a.id })).reason, /isn’t open|already/);
  // Without an invitation a friend may not come in (the default: by invitation).
  assert.match((await t.dorm('visit', { host: a.id })).reason, /by invitation/);
  const invited = next(t.ws, m => m.type === 'dormInvite');
  assert.equal((await a.dorm('invite', { to: tobi.id })).ok, true);
  const inv = await invited;
  assert.equal(inv.host, a.id); assert.equal(inv.from.handle, ada.handle); assert.ok(inv.expires > Date.now());
  const visitors = next(a.ws, m => m.type === 'dormVisitors' && m.visitors.length === 1);
  const went = await t.dorm('visit', { host: inv.host });
  assert.equal(went.ok, true, went.reason); assert.equal(went.hostName, 'Ada');
  assert.deepEqual(went.layout, DEFAULT_LAYOUT, 'the visitor sees the resident’s room');
  assert.ok(inDormRoom(t.server().x, t.server().z), 'travelled straight into the room');
  assert.ok(Math.hypot(t.server().x - a.server().x, t.server().z - a.server().z) > .7, 'beside the resident, not on top of them');
  assert.equal((await visitors).visitors[0].id, t.id);
  assert.equal(await t.space(t.id), a.id, 'the visitor is in the resident’s space');
  assert.equal(await c.space(a.id), a.id);
  // The visitor can't rearrange; the resident's change reaches the visitor.
  assert.match((await t.dorm('save', { layout: { items: [] } })).reason, /Only the resident/);
  const update = next(t.ws, m => m.type === 'dormLayout');
  assert.equal((await a.dorm('save', { layout: { items: [{ t: 'plant', x: 1, z: 1, r: 0, c: 0 }] } })).ok, true);
  assert.deepEqual((await update).layout.items, [{ t: 'plant', x: 1, z: 1, r: 0, c: 0 }]);
  // The invitation was used once.
  assert.equal((await t.dorm('leave')).ok, true);
  assert.match((await t.dorm('visit', { host: a.id })).reason, /by invitation/);
  // Meet-up never travels into a room.
  const meet = next(t.ws, m => m.type === 'meetUpResult'); t.send({ type: 'meetUp', id: a.id });
  assert.equal((await meet).ok, false);
  [a, t, c].forEach(x => x.ws.close());
});

test('with drop-in visits on, friends come in while the resident is in; showing out, blocks and leaving send them out', async () => {
  const ada = await account('Ada'), tobi = await account('Tobi'), dayo = await account('Dayo');
  await befriend(ada, tobi); await befriend(ada, dayo);
  assert.equal((await settings(ada, 'friends')).data.room_visits, 'friends');
  const a = await join(ada), t = await join(tobi), d = await join(dayo);
  await settle(a, t, d);
  assert.match((await t.dorm('visit', { host: a.id })).reason, /isn’t in/, 'nobody home');
  await a.enter();
  assert.equal((await t.dorm('visit', { host: a.id })).ok, true, 'a friend drops in');
  assert.equal((await d.dorm('visit', { host: a.id })).ok, true);
  // Showing a visitor out.
  const out = next(d.ws, m => m.type === 'dormResult' && m.action === 'leave');
  assert.equal((await a.dorm('showOut', { id: d.id })).ok, true);
  assert.match((await out).reason, /shown you out/); assert.ok(!inDormRoom(d.server().x, d.server().z));
  // A block, either way, ends the visit.
  const blockedOut = next(t.ws, m => m.type === 'dormResult' && m.action === 'leave');
  assert.equal((await ada.sb.rpc('block_player', { p_user: tobi.id })).error, null); a.refresh();
  await blockedOut; assert.equal(t.server().dorm, null);
  assert.match((await t.dorm('visit', { host: a.id })).reason, /can’t visit/);
  // The resident leaving sends everyone out.
  assert.equal((await d.dorm('visit', { host: a.id })).ok, true);
  const left = next(d.ws, m => m.type === 'dormResult' && m.action === 'leave');
  assert.equal((await a.dorm('leave')).ok, true);
  assert.match((await left).reason, /has left their room/);
  // So does the resident disconnecting.
  await a.enter(); assert.equal((await d.dorm('visit', { host: a.id })).ok, true);
  const gone = next(d.ws, m => m.type === 'dormResult' && m.action === 'leave');
  a.ws.close(); await gone; assert.equal(d.server().dorm, null);
  // An older client saving settings without the new choice keeps it.
  assert.equal((await ada.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: false })).data.room_visits, 'friends');
  assert.ok((await settings(ada, 'everyone')).error, 'only the listed choices');
  [t, d].forEach(x => x.ws.close());
});

test('an invitation never reveals a friend who appears offline', async () => {
  const ada = await account('Ada'), tobi = await account('Tobi');
  await befriend(ada, tobi);
  assert.equal((await tobi.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: true })).error, null);
  const a = await join(ada), t = await join(tobi);
  await settle(a, t); await a.enter();
  let invited = false; t.ws.on('message', raw => { if (JSON.parse(raw).type === 'dormInvite') invited = true; });
  assert.match((await a.dorm('invite', { to: tobi.id })).reason, /isn’t on campus/, 'the same answer as for someone who is not here');
  await delay(300); assert.equal(invited, false);
  [a, t].forEach(x => x.ws.close());
});
