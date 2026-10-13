// Accounts end to end, without a browser: supabase-js (the same client library the app uses) talks
// to the local Supabase stand-in backed by real PostgreSQL, and real WebSocket clients join a room
// that verifies identity through server/accounts.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { startDatabase } from './support/postgres.mjs';
import { startLocalSupabase } from './support/local-supabase.mjs';
import { createRoom } from '../server/room.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { TOKENS } from '../shared/campus.mjs';
import { HOOPS } from '../shared/interactions.mjs';

let db, supa, room, url;
const logged = [];
const log = { warn: (...a) => logged.push(a.join(' ')), log: (...a) => logged.push(a.join(' ')), error: (...a) => logged.push(a.join(' ')) };
before(async () => {
  db = await startDatabase({ name: 'accounts' });
  supa = await startLocalSupabase({ pool: db.pool });
  room = createRoom({ port: 0, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey, log }) });
  url = `ws://127.0.0.1:${(await room.start()).port}/ws`;
}, { timeout: 180000 });
after(async () => { await room?.close(); await supa?.close(); await db?.stop(); });

const client = () => createClient(supa.url, supa.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
let seq = 0;
async function account(handle, displayName = handle) {
  const sb = client(), email = `${handle}-${++seq}-${Date.now()}@example.test`;
  const { data, error } = await sb.auth.signUp({ email, password: 'correct horse battery' });
  assert.equal(error, null); assert.ok(data.session, 'sign-up returns a session when confirmation is off');
  const saved = await sb.rpc('save_profile', { p_handle: handle, p_display_name: displayName, p_bio: '', p_avatar: { model: 'ada', accent: '#506b96' } });
  assert.equal(saved.error, null, saved.error?.message);
  return { sb, email, token: data.session.access_token, id: data.user.id };
}
const unique = p => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
function next(ws, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(new Error('Message timeout')); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
async function join(name, extra = {}) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const welcome = next(ws, m => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', name, avatar: {}, ...extra }));
  return { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) };
}
const self = (state, id) => state.players.find(p => p.id === id);

test('sign-up, sign-in and invalid credentials through the Supabase client', async () => {
  const handle = unique('reg_'), { email } = await account(handle);
  const sb = client();
  const bad = await sb.auth.signInWithPassword({ email, password: 'wrong password' });
  assert.equal(bad.data.session, null); assert.match(bad.error.message, /Invalid login credentials/);
  const dup = await sb.auth.signUp({ email, password: 'correct horse battery' });
  assert.match(dup.error.message, /already registered/);
  const weak = await sb.auth.signUp({ email: `weak-${Date.now()}@example.test`, password: 'short' });
  assert.match(weak.error.message, /at least 8/);
  const good = await sb.auth.signInWithPassword({ email, password: 'correct horse battery' });
  assert.equal(good.error, null);
  const mine = await sb.rpc('my_profile');
  assert.equal(mine.data.handle, handle, 'the profile persists and loads in a new session');
  await sb.auth.signOut();
  const after = await sb.rpc('my_profile');
  assert.equal(after.data, null, 'signed out, there is no profile');
});

test('guests join exactly as before; a verified account replaces the client’s claimed identity', async () => {
  const guest = await join('Wanderer');
  assert.equal(guest.welcome.accounts, true);
  const handle = unique('ada_'), acct = await account(handle, 'Ada Verified');
  const player = await join('Spoofed Name', { access: acct.token });
  const auth = await next(player.ws, m => m.type === 'auth');
  assert.equal(auth.ok, true); assert.equal(auth.account.handle, handle);
  const seen = await next(guest.ws, m => m.type === 'state' && self(m, player.welcome.id)?.handle === handle);
  const me = self(seen, player.welcome.id);
  assert.equal(me.name, 'Ada Verified', 'the display name comes from the saved profile'); assert.equal(me.avatar.model, 'ada');
  assert.equal(self(seen, guest.welcome.id).handle, null, 'guests have no handle');
  // A signed-in client cannot rename itself or change its look by message: the room reloads the profile.
  player.send({ type: 'profile', name: 'Impostor', avatar: { model: 'tunde' } });
  await new Promise(r => setTimeout(r, 300));
  const still = self(await next(guest.ws, m => m.type === 'state'), player.welcome.id);
  assert.equal(still.name, 'Ada Verified'); assert.equal(still.avatar.model, 'ada');
  // Saving the profile (as the app does) and nudging the room propagates the change to everyone.
  await new Promise(r => setTimeout(r, 2100));
  assert.equal((await acct.sb.rpc('save_profile', { p_handle: handle, p_display_name: 'Ada Renamed', p_bio: '', p_avatar: { model: 'amara' } })).error, null);
  player.send({ type: 'profile' });
  const renamed = await next(guest.ws, m => m.type === 'state' && self(m, player.welcome.id)?.name === 'Ada Renamed');
  assert.equal(self(renamed, player.welcome.id).avatar.model, 'amara');
  // Signing out reverts to a temporary guest identity without reconnecting.
  player.send({ type: 'auth', token: null, name: 'Back to guest', avatar: {} });
  const out = await next(guest.ws, m => m.type === 'state' && self(m, player.welcome.id)?.handle === null);
  assert.equal(self(out, player.welcome.id).name, 'Back to guest');
  guest.ws.close(); player.ws.close();
});

test('invalid, forged and expired tokens are rejected safely and the player stays a guest', async () => {
  const handle = unique('exp_'), acct = await account(handle);
  const player = await join('Guesty');
  for (const token of ['not-a-token', `${acct.token.slice(0, -4)}AAAA`, supa.token(acct.id, -60)]) {
    player.send({ type: 'auth', token });
    const r = await next(player.ws, m => m.type === 'auth');
    assert.equal(r.ok, false); assert.equal(r.code, 'expired'); assert.match(r.reason, /sign in again/);
  }
  const state = await next(player.ws, m => m.type === 'state');
  assert.equal(self(state, player.welcome.id).handle, null); assert.equal(self(state, player.welcome.id).name, 'Guesty');
  player.ws.close();
});

test('one account appears once: a newer window takes over and the older one becomes a guest', async () => {
  const handle = unique('dup_'), acct = await account(handle);
  const a = await join('A', { access: acct.token }); assert.equal((await next(a.ws, m => m.type === 'auth')).ok, true);
  const replaced = next(a.ws, m => m.type === 'auth');
  const b = await join('B', { access: acct.token }); assert.equal((await next(b.ws, m => m.type === 'auth')).ok, true);
  const r = await replaced; assert.equal(r.ok, false); assert.equal(r.code, 'replaced');
  const state = await next(b.ws, m => m.type === 'state');
  assert.equal(state.players.filter(p => p.handle === handle).length, 1, 'the handle appears once');
  assert.equal(self(state, b.welcome.id).handle, handle);
  a.ws.close(); b.ws.close();
});

test('an account without a profile stays a guest until the profile exists', async () => {
  const sb = client(), { data } = await sb.auth.signUp({ email: `noprof-${Date.now()}@example.test`, password: 'correct horse battery' });
  const p = await join('Fresh', { access: data.session.access_token });
  const r = await next(p.ws, m => m.type === 'auth'); assert.equal(r.code, 'no-profile');
  await sb.rpc('save_profile', { p_handle: unique('fresh_'), p_display_name: 'Fresh Face' });
  p.send({ type: 'auth', token: data.session.access_token });
  assert.equal((await next(p.ws, m => m.type === 'auth')).ok, true);
  p.ws.close();
});

test('the room records verified progress for accounts only, and awards badges', async () => {
  const handle = unique('prog_'), acct = await account(handle);
  const player = await join('Collector', { access: acct.token }); await next(player.ws, m => m.type === 'auth' && m.ok);
  const guest = await join('Guest collector');
  const c = room.clients.get(player.welcome.id), g = room.clients.get(guest.welcome.id);
  // Far away: refused, nothing recorded.
  player.send({ type: 'collect', id: 't1' }); await new Promise(r => setTimeout(r, 200));
  assert.equal((await acct.sb.rpc('my_profile')).data.progress.keepsakes.length, 0);
  // (The room allows six collect requests a second; a walking player is far slower than that.)
  for (const t of TOKENS) {
    await new Promise(r => setTimeout(r, 220));
    Object.assign(c, { x: t.x, z: t.z }); Object.assign(g, { x: t.x, z: t.z });
    const p = next(player.ws, m => m.type === 'progress' && m.item === t.id);
    player.send({ type: 'collect', id: t.id }); guest.send({ type: 'collect', id: t.id });
    const progress = await p.catch(e => { throw new Error(`no progress for ${t.id}: ${e.message}`); });
    if (t.id === 't6') assert.deepEqual(progress.awarded, ['curious-mind']);
  }
  const mine = (await acct.sb.rpc('my_profile')).data;
  assert.equal(mine.progress.keepsakes.length, 6); assert.deepEqual(mine.achievements.map(a => a.id), ['curious-mind']);
  const others = await db.pool.query('select count(*)::int as n from public.player_progress where user_id <> $1', [acct.id]);
  assert.equal(others.rows[0].n, 0, 'guest collections are not written to any account');
  // Five free throws from the line: scored by the room's physics, recorded as a round.
  const hoop = HOOPS.find(h => h.id === 'south');
  const roundResult = next(player.ws, m => m.type === 'progress' && m.kind === 'hoops', 40000);
  const rack = { x: 34.2, z: 22.6 };
  for (let i = 0; i < 5; i++) {
    // Return the ball to the rack first, so every pickup starts from the same place however it bounced.
    Object.assign(c, { x: rack.x + .6, z: rack.z, y: 0, vx: 0, vz: 0 });
    player.send({ type: 'ballReset', ball: 'ball-1', ref: 100 + i }); await next(player.ws, m => m.type === 'result' && m.ref === 100 + i);
    player.send({ type: 'pickup', ball: 'ball-1', ref: i * 2 + 1 }); assert.equal((await next(player.ws, m => m.type === 'result' && m.ref === i * 2 + 1)).ok, true);
    Object.assign(c, { x: hoop.x, z: hoop.z + 4.6, vx: 0, vz: 0 });
    player.send({ type: 'shoot', yaw: Math.PI, charge: .5, ref: i * 2 + 2 });
    const shot = await next(player.ws, m => m.type === 'result' && m.ref === i * 2 + 2); assert.equal(shot.ok, true);
    // Wait for this shot's basket (a well-timed free throw scores), or give it time to land.
    await next(player.ws, m => m.type === 'events' && m.list.some(e => e.type === 'score' && e.shot === shot.shot), 6000).catch(() => {});
  }
  const round = await roundResult;
  assert.ok(Number(round.item) >= 6, `a well-timed round scores (got ${round.item})`); assert.deepEqual(round.awarded, ['courtside']);
  player.ws.close(); guest.ws.close();
});

test('no access token appears in URLs or logs', async () => {
  const handle = unique('priv_'), acct = await account(handle);
  const p = await join('Private', { access: acct.token }); await next(p.ws, m => m.type === 'auth');
  p.ws.close();
  for (const r of supa.requests) { assert.ok(!r.search.includes(acct.token) && !r.path.includes(acct.token), `token in URL ${r.path}`); }
  for (const line of logged) assert.ok(!line.includes(acct.token) && !line.includes(supa.serviceKey), 'no secrets in logs');
});
