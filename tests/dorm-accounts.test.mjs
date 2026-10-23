// Personal rooms for signed-in players, end to end: the room server saves a validated layout to the
// account (local Supabase stand-in on real PostgreSQL), a later session opens the same room, and
// players cannot read or write room layouts directly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { startDatabase } from './support/postgres.mjs';
import { startLocalSupabase } from './support/local-supabase.mjs';
import { createRoom } from '../server/room.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { DEFAULT_LAYOUT, DORM_OUTSIDE } from '../shared/dorm.mjs';

let db, supa, room, url;
before(async () => {
  db = await startDatabase({ name: 'dorms' });
  supa = await startLocalSupabase({ pool: db.pool });
  room = createRoom({ port: 0, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey, log: { warn() {} } }) });
  url = `ws://127.0.0.1:${(await room.start()).port}/ws`;
}, { timeout: 180000 });
after(async () => { await room?.close(); await supa?.close(); await db?.stop(); });

const client = () => createClient(supa.url, supa.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function account(handle) {
  const sb = client(), { data } = await sb.auth.signUp({ email: `${handle}-${Date.now()}@example.test`, password: 'correct horse battery' });
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: handle, p_bio: '', p_avatar: { model: 'ada' } })).error, null);
  return { sb, token: data.session.access_token, id: data.user.id };
}
function next(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(Error('Message timeout: ' + predicate.toString())); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
async function join(access) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const welcome = next(ws, m => m.type === 'welcome'), auth = access ? next(ws, m => m.type === 'auth') : null;
  ws.send(JSON.stringify({ type: 'join', name: 'Resident', avatar: {}, ...(access ? { access } : {}) }));
  const c = { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) };
  if (auth) assert.equal((await auth).ok, true);
  c.server = () => room.clients.get(c.welcome.id);
  c.dorm = (action, extra = {}) => { const r = next(ws, m => m.type === 'dormResult' && m.action === action); c.send({ type: 'dorm', action, ...extra }); return r; };
  c.enter = () => { Object.assign(c.server(), { x: DORM_OUTSIDE.x, z: DORM_OUTSIDE.z }); return c.dorm('enter'); };
  return c;
}
const MINE = { items: [{ t: 'bed', x: .5, z: 1.5, r: 1, c: 3 }, { t: 'desk', x: 7.2, z: 1.3, r: 3, c: 0 }, { t: 'lamp', x: 6.5, z: .3, r: 0, c: 0 }] };

test('a signed-in resident’s room is saved to their account and opens the same next time', async () => {
  const acct = await account(`dorm_${Date.now().toString(36)}`);
  const first = await join(acct.token);
  const opened = await first.enter();
  assert.equal(opened.ok, true, opened.reason); assert.equal(opened.keeps, 'account');
  assert.deepEqual(opened.layout, DEFAULT_LAYOUT, 'nothing saved yet: the default room');
  const saved = await first.dorm('save', { layout: MINE });
  assert.equal(saved.saved, 'account', saved.reason);
  const row = await db.pool.query('select layout from public.dorm_rooms where user_id = $1', [acct.id]);
  assert.deepEqual(row.rows[0].layout, MINE);
  first.ws.close(); await new Promise(r => setTimeout(r, 200));
  const later = await join(acct.token);
  assert.deepEqual((await later.enter()).layout, MINE, 'a new session opens the saved room');
  // Signing out inside the room: it was the account's room, so the player is shown back to the common room.
  const out = next(later.ws, m => m.type === 'dormResult' && m.action === 'leave');
  later.send({ type: 'auth', token: null, name: 'Guest' });
  assert.match((await out).reason, /signed out/); assert.equal(later.server().dorm, null);
  later.ws.close();
});

test('opening the account in another window moves the first window out of the room, and says so', async () => {
  const acct = await account(`twice_${Date.now().toString(36)}`);
  const first = await join(acct.token);
  assert.equal((await first.enter()).ok, true);
  const moved = next(first.ws, m => m.type === 'dormResult' && m.action === 'leave');
  const second = await join(acct.token);
  assert.match((await moved).reason, /another window/);
  assert.equal(first.server().dorm, null);
  first.ws.close(); second.ws.close();
});

test('guests’ rooms are never written to the database, and players cannot write rooms directly', async () => {
  const before = (await db.pool.query('select count(*)::int as n from public.dorm_rooms')).rows[0].n;
  const guest = await join();
  assert.equal((await guest.enter()).keeps, 'session');
  assert.equal((await guest.dorm('save', { layout: MINE })).saved, 'session');
  assert.equal((await db.pool.query('select count(*)::int as n from public.dorm_rooms')).rows[0].n, before);
  guest.ws.close();
  const acct = await account(`direct_${Date.now().toString(36)}`);
  const write = await acct.sb.rpc('save_dorm_layout', { p_user: acct.id, p_layout: { items: [] } });
  assert.ok(write.error, 'a player cannot call the room server’s save function');
  const read = await acct.sb.rpc('dorm_layout', { p_user: acct.id });
  assert.ok(read.error, 'nor read layouts through it');
  // The table refuses a shape the room would never send (a backstop for the room's own checks).
  await assert.rejects(db.pool.query('insert into public.dorm_rooms (user_id, layout) values ($1, $2)', [acct.id, { items: Array.from({ length: 17 }, () => ({ t: 'plant' })) }]));
});
