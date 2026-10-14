// Challenges, in-game event check-in and room-measured achievements over real WebSockets, with the
// local Supabase stand-in on a real PostgreSQL for the persistent parts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { startDatabase } from './support/postgres.mjs';
import { startLocalSupabase } from './support/local-supabase.mjs';
import { createRoom } from '../server/room.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { CHALLENGE_BY_ID } from '../shared/challenges.mjs';
import { LOCATIONS } from '../shared/campus.mjs';
import { localPoint } from '../shared/vehicles.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function next(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(new Error('Message timeout waiting for: ' + predicate.toString().slice(0, 120))); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
let db, supa, room, url;
before(async () => {
  db = await startDatabase({ name: 'activitiesroom' });
  supa = await startLocalSupabase({ pool: db.pool });
  room = createRoom({ port: 0, togetherMs: 400, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey, log: { warn() {} } }) });
  url = `ws://127.0.0.1:${(await room.start()).port}/ws`;
}, { timeout: 180000 });
after(async () => { await room?.close(); await supa?.close(); await db?.stop(); });

let seq = 0;
async function account(prefix) {
  const sb = createClient(supa.url, supa.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const handle = `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data } = await sb.auth.signUp({ email: `${handle}@example.test`, password: 'correct horse battery' });
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: handle, p_bio: '', p_avatar: {} })).error, null);
  return { sb, handle, id: data.user.id, token: data.session.access_token };
}
async function join(name, access) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise(r => ws.once('open', r));
  const welcome = next(ws, m => m.type === 'welcome'), auth = access ? next(ws, m => m.type === 'auth') : null;
  ws.send(JSON.stringify({ type: 'join', name, ...(access ? { access } : {}) }));
  const c = { ws, id: (await welcome).id, send: m => ws.send(JSON.stringify(m)) };
  if (auth) assert.equal((await auth).ok, true);
  c.me = () => room.clients.get(c.id); c.place = (x, z) => Object.assign(c.me(), { x, z, vx: 0, vz: 0 });
  c.challenge = (action, id) => { const r = next(ws, m => m.type === 'challengeResult'); c.send({ type: 'challenge', action, id }); return r; };
  return c;
}

test('an on-foot challenge: checkpoints in order, mode and time rules, and implausibly fast runs rejected', async () => {
  const p = await join('Runner'), ch = CHALLENGE_BY_ID.get('courtyard-circuit');
  try {
    p.place(0, 30);
    assert.equal((await p.challenge('start', 'courtyard-circuit')).ok, true);
    // Out of order does nothing; in order advances.
    p.place(ch.checkpoints[2].x, ch.checkpoints[2].z); await sleep(200);
    assert.equal(p.me().run.next, 0, 'checkpoints count only in order');
    for (const [i, cp] of ch.checkpoints.slice(0, -1).entries()) {
      const reached = next(p.ws, m => m.type === 'challenge' && m.reached === cp.name);
      p.place(cp.x, cp.z); assert.equal((await reached).run.next, i + 1);
    }
    const last = ch.checkpoints.at(-1), ended = next(p.ws, m => m.type === 'challenge' && m.ended);
    p.place(last.x, last.z);
    const tooFast = (await ended).ended;
    assert.equal(tooFast.ok, false); assert.match(tooFast.message, /too fast/);
    // A realistic run (its start moved back by the test, as if a minute had passed) completes.
    await p.challenge('start', 'courtyard-circuit');
    p.me().run.started -= 60000;
    const done = next(p.ws, m => m.type === 'notice' && /Sign in to keep your challenge/.test(m.text)), completed = next(p.ws, m => m.type === 'challenge' && m.ended?.ok);
    for (const cp of ch.checkpoints) { p.place(cp.x, cp.z); await sleep(140); }
    assert.match((await completed).ended.message, /Courtyard Circuit complete in 6\d\.\d s/);
    assert.ok(await done, 'guests complete it but are told it is not saved');
    // Getting into a vehicle ends an on-foot run; the clock ends any run.
    await p.challenge('start', 'courtyard-circuit');
    p.me().vehicle = 'courtyard-car';
    assert.match((await next(p.ws, m => m.type === 'challenge' && m.ended)).ended.message, /vehicle/);
    p.me().vehicle = null;
    await p.challenge('start', 'courtyard-circuit'); p.me().run.deadline = Date.now() - 1;
    assert.match((await next(p.ws, m => m.type === 'challenge' && m.ended)).ended.message, /Time’s up/);
    // Meeting up is not a shortcut during a run.
    await p.challenge('start', 'courtyard-circuit');
    const friend = await join('Friend');
    p.send({ type: 'meetUp', id: friend.id });
    assert.match((await next(p.ws, m => m.type === 'meetUpResult')).reason, /party|challenge/);
    assert.equal((await p.challenge('cancel')).ok, true);
    friend.ws.close();
  } finally { p.ws.close(); }
});

test('a driving challenge needs the driver’s seat throughout', async () => {
  const d = await join('Driver');
  try {
    assert.match((await d.challenge('start', 'campus-loop')).reason, /driver’s seat/);
    const car = room.fleet.vehicles.find(v => v.type === 'car'), door = localPoint(car, 1.55, -.02);
    d.place(door.x, door.z);
    const entered = next(d.ws, m => m.type === 'vehicleResult'); d.send({ type: 'vehicleEnter', id: car.id, seat: 0 });
    assert.equal((await entered).ok, true);
    assert.equal((await d.challenge('start', 'campus-loop')).ok, true);
    const ended = next(d.ws, m => m.type === 'challenge' && m.ended); d.send({ type: 'vehicleExit' });
    assert.match((await ended).ended.message, /driver’s seat/);
  } finally { d.ws.close(); }
});

test('signed-in players: challenge times and badges are saved; in-game check-in needs the right place', async () => {
  const runner = await account('run'), org = await account('org');
  const p = await join('x', runner.token), ch = CHALLENGE_BY_ID.get('courtyard-circuit');
  try {
    await p.challenge('start', ch.id); p.me().run.started -= 45000;
    const saved = next(p.ws, m => m.type === 'progress' && m.kind === 'challenge', 8000);
    for (const cp of ch.checkpoints) { p.place(cp.x, cp.z); await sleep(140); }
    const s = await saved;
    assert.ok(s.best >= 45000 && s.best < 60000, `the room's own time is recorded (${s.best})`);
    const row = (await db.pool.query('select * from public.challenge_results where user_id = $1', [runner.id])).rows[0];
    assert.equal(row.best_ms, s.best); assert.equal(row.completions, 1);
    // An event on now at The Courts.
    const club = (await org.sb.rpc('create_club', { p_name: `Hoops ${Date.now().toString(36)}`, p_description: '', p_category: 'sports' })).data;
    const ev = (await org.sb.rpc('create_event', { p_club: club.id, p_title: 'Pick-up games', p_description: '', p_category: 'sports', p_location: 'sports', p_starts_at: new Date(Date.now() + 600000).toISOString(), p_ends_at: new Date(Date.now() + 3600000).toISOString(), p_publish: true, p_template: 'basketball-tournament' })).data;
    await db.pool.query(`update public.events set starts_at = now() - interval '5 minutes' where id = $1`, [ev.id]);
    const courts = LOCATIONS.find(l => l.id === 'sports'), checkin = location => { const r = next(p.ws, m => m.type === 'checkinResult'); p.send({ type: 'checkin', event: ev.id, location }); return r; };
    p.place(0, 30);
    assert.match((await checkin('sports')).reason, /Go to The Courts/);
    p.place(courts.x, courts.z);
    assert.match((await checkin('library')).reason, /Go to Adunni|another campus location/);
    const ok = await checkin('sports');
    assert.equal(ok.ok, true); assert.equal(ok.fresh, true);
    assert.equal((await checkin('sports')).fresh, false, 'checking in twice is harmless');
    assert.equal((await db.pool.query('select count(*)::int as n from public.event_checkins where event_id = $1', [ev.id])).rows[0].n, 1);
    const guest = await join('Guest'), refused = next(guest.ws, m => m.type === 'checkinResult');
    guest.send({ type: 'checkin', event: ev.id, location: 'sports' });
    assert.match((await refused).reason, /Sign in/);
    guest.ws.close();
  } finally { p.ws.close(); }
});

test('Better Together is measured by the room: time in a party of three or more', async () => {
  const [a, b, c] = [await account('bt'), await account('bt'), await account('bt')];
  const pa = await join('x', a.token), pb = await join('x', b.token), pc = await join('x', c.token);
  try {
    // Party invitations default to friends only, so let anyone in the room invite these three.
    for (const acct of [a, b, c]) await acct.sb.rpc('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'everyone', p_appear_offline: false });
    for (const p of [pa, pb, pc]) p.send({ type: 'socialRefresh' });
    await sleep(500);
    for (const p of [pb, pc]) {
      const inv = next(p.ws, m => m.type === 'partyInvite'); pa.send({ type: 'party', action: 'invite', id: p.id });
      const { invite } = await inv; p.send({ type: 'party', action: 'respond', party: invite.party, accept: true });
    }
    const badge = await next(pa.ws, m => m.type === 'progress' && m.kind === 'party', 8000);
    assert.deepEqual(badge.awarded, ['better-together']);
    assert.ok((await db.pool.query(`select 1 from public.achievements where user_id = $1 and achievement = 'better-together'`, [a.id])).rowCount);
  } finally { pa.ws.close(); pb.ws.close(); pc.ws.close(); }
});
