// A whole store purchase without a browser: real PostgreSQL (supabase/migrations) behind the local Supabase
// stand-in, a room with the store configured, a stand-in for Bachs' checkout API, and signed webhooks
// delivered to the room as Bachs delivers them (at least once, either event first).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { startDatabase } from './support/postgres.mjs';
import { startLocalSupabase } from './support/local-supabase.mjs';
import { createRoom } from '../server/room.mjs';
import { createAccounts } from '../server/accounts.mjs';

const SECRET = 'whsec_campus_store_test', quiet = { warn() {}, log() {}, error() {} };
let db, supa, room, port, bachs, bachsUrl;
const sessions = [];
before(async () => {
  db = await startDatabase({ name: 'shop' });
  supa = await startLocalSupabase({ pool: db.pool });
  // Bachs' checkout API, as far as the room uses it: one session per Idempotency-Key.
  const byKey = new Map();
  bachs = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.method !== 'POST' || req.url !== '/v1/checkout-sessions' || !/^Bearer sk_sandbox_/.test(req.headers.authorization ?? '')) { res.writeHead(401); res.end('{}'); return; }
    const key = req.headers['idempotency-key'];
    if (!byKey.has(key)) { const n = byKey.size + 1; byKey.set(key, { checkout_id: `chk_${n}`, checkout_url: `https://checkout.bachs.test/chk_${n}`, status: 'open', expires_at: new Date(Date.now() + 3.6e6).toISOString() }); }
    sessions.push({ key, body: JSON.parse(body) });
    res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(byKey.get(key)));
  });
  await new Promise(r => bachs.listen(0, '127.0.0.1', r)); bachsUrl = `http://127.0.0.1:${bachs.address().port}`;
  room = createRoom({ port: 0, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey, log: quiet }),
    shop: { secretKey: 'sk_sandbox_test', webhookSecret: SECRET, appUrl: 'http://localhost:5173', apiUrl: bachsUrl, log: quiet } });
  port = (await room.start()).port;
}, { timeout: 180000 });
after(async () => { await room?.close(); await new Promise(r => bachs?.close(r)); await supa?.close(); await db?.stop(); });

let seq = 0;
async function account(handle) {
  const sb = createClient(supa.url, supa.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signUp({ email: `${handle}-${++seq}@example.test`, password: 'correct horse battery' });
  assert.equal(error, null);
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: handle, p_bio: '', p_avatar: { model: 'ada' } })).error, null);
  return { sb, token: data.session.access_token, id: data.user.id, handle };
}
function next(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(new Error('Message timeout')); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
async function join(extra = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://localhost:5173' }); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const welcome = next(ws, m => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', name: 'Shopper', avatar: {}, ...extra }));
  return { ws, welcome: await welcome, send: m => ws.send(JSON.stringify(m)) };
}
/** Deliver a webhook to the room as Bachs does: raw JSON, signed over "timestamp.body". */
async function deliver(event, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event), sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const r = await fetch(`http://127.0.0.1:${port}/shop/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bachs-Timestamp': String(ts), 'X-Bachs-Signature': sig, 'X-Bachs-Signature-V2': `t=${ts},v1=${sig}` }, body });
  return r.status;
}
const paid = (order, checkout, amount = '3000.00', id = `evt_${Math.random().toString(36).slice(2)}`) => ({ id, type: 'collection.succeeded', created_at: new Date().toISOString(), organization_id: 'org_test',
  data: { charge_id: `ch_${id}`, checkout_id: checkout, reference: order, status: 'SUCCEEDED', amount, currency: 'NGN', metadata: { app: 'campos-worlds', order } } });

test('premium items cannot be saved before they are bought; guests cannot buy', async () => {
  const a = await account('nobuy');
  for (const avatar of [{ model: 'emeka' }, { model: 'ada', accessory: 'shades' }]) {
    const r = await a.sb.rpc('save_profile', { p_handle: 'nobuy', p_display_name: 'No Buy', p_bio: '', p_avatar: avatar });
    assert.match(r.error?.message ?? '', /is in the store\. Buy it to use it\./, JSON.stringify(avatar));
  }
  assert.deepEqual((await a.sb.rpc('my_profile')).data.owned, []);
  const guest = await join();
  assert.deepEqual(guest.welcome.shop, { enabled: true, currency: 'NGN', prices: { character: 3000, item: 1000 } });
  const reply = next(guest.ws, m => m.type === 'shopCheckout'); guest.send({ type: 'shopCheckout', item: 'emeka', ref: 1 });
  assert.deepEqual(await reply, { type: 'shopCheckout', ref: 1, item: 'emeka', ok: false, reason: 'Sign in to buy from the store.' });
  guest.ws.close();
});

test('a purchase end to end: checkout, a signed webhook grants the item once, and the player can wear it', async () => {
  const a = await account('buyer'), p = await join({ access: a.token });
  assert.equal((await next(p.ws, m => m.type === 'auth')).ok, true);
  // Checkout: the room opens an order and a Bachs session for it at ₦3,000.
  const r1 = next(p.ws, m => m.type === 'shopCheckout'); p.send({ type: 'shopCheckout', item: 'emeka', ref: 7 });
  const reply = await r1;
  assert.equal(reply.ok, true, reply.reason); assert.equal(reply.ref, 7); assert.match(reply.url, /^https:\/\/checkout\.bachs\.test\/chk_\d+$/); assert.equal(reply.amount, 3000);
  const session = sessions.at(-1), order = session.body.reference, checkout = reply.url.split('/').pop();
  assert.deepEqual(session.body.pricing, { currency: 'NGN', amount: '3000.00' }); assert.equal(session.key, order);
  // Pressing Buy again returns the same order, so Bachs returns the same checkout.
  const r2 = next(p.ws, m => m.type === 'shopCheckout'); p.send({ type: 'shopCheckout', item: 'emeka', ref: 8 });
  assert.equal((await r2).url, reply.url); assert.equal(sessions.at(-1).body.reference, order);
  // A forged or stale webhook is refused before anything is read.
  assert.equal(await deliver(paid(order, checkout), { secret: 'whsec_wrong' }), 400);
  assert.equal(await deliver(paid(order, checkout), { ts: Math.floor(Date.now() / 1000) - 600 }), 400);
  assert.deepEqual((await a.sb.rpc('my_profile')).data.owned, [], 'nothing granted by a bad signature');
  // Less than the price is not a purchase.
  assert.equal(await deliver(paid(order, checkout, '300.00')), 200);
  assert.deepEqual((await a.sb.rpc('my_profile')).data.owned, []);
  // The real payment: the player hears at once, and owns it on their profile.
  const granted = next(p.ws, m => m.type === 'shopGranted'), event = paid(order, checkout);
  assert.equal(await deliver(event), 200);
  assert.deepEqual(await granted, { type: 'shopGranted', item: 'emeka' });
  assert.deepEqual((await a.sb.rpc('my_profile')).data.owned, ['emeka']);
  // Delivered again, and the other event for the same payment: still one item, one grant.
  assert.equal(await deliver(event), 200);
  assert.equal(await deliver({ id: 'evt_checkout_done', type: 'checkout.completed', created_at: new Date().toISOString(), data: { checkout_id: checkout, reference: order, status: 'completed' } }), 200);
  const rows = await db.pool.query('select count(*)::int as n from public.shop_ownership where user_id = $1', [a.id]);
  assert.equal(rows.rows[0].n, 1);
  const o = await db.pool.query('select status, amount::text, currency, checkout_id from public.shop_orders where id = $1', [order]);
  assert.deepEqual(o.rows[0], { status: 'paid', amount: '3000.00', currency: 'NGN', checkout_id: checkout });
  // Now it can be saved and worn, and the room shows it.
  assert.equal((await a.sb.rpc('save_profile', { p_handle: 'buyer', p_display_name: 'buyer', p_bio: '', p_avatar: { model: 'emeka' } })).error, null);
  await new Promise(r => setTimeout(r, 2100)); p.send({ type: 'profile' });
  await next(p.ws, m => m.type === 'state' && m.players.find(x => x.id === p.welcome.id)?.avatar.model === 'emeka');
  // Buying what you own is refused.
  const r3 = next(p.ws, m => m.type === 'shopCheckout'); p.send({ type: 'shopCheckout', item: 'emeka', ref: 9 });
  assert.equal((await r3).reason, 'You already own this.');
  p.ws.close();
});

test('a webhook that arrives before its checkout is recorded is retried; other products’ events are ignored', async () => {
  const a = await account('early'), p = await join({ access: a.token });
  await next(p.ws, m => m.type === 'auth');
  const r = next(p.ws, m => m.type === 'shopCheckout'); p.send({ type: 'shopCheckout', item: 'cap', ref: 1 });
  const reply = await r, order = sessions.at(-1).body.reference;
  assert.equal(sessions.at(-1).body.pricing.amount, '1000.00');
  // An order id the database does not know (yet): Bachs is asked to retry; not ours at all: acknowledged.
  assert.equal(await deliver(paid('0b9e1c4a-5f2d-4c8e-9f1a-3e2d1c0b9a87', 'chk_unknown', '1000.00')), 503);
  assert.equal(await deliver({ id: 'evt_other', type: 'collection.succeeded', data: { reference: 'invoice-42', status: 'SUCCEEDED', amount: '5.00', currency: 'NGN', metadata: {} } }), 200);
  // checkout.completed alone (matched by reference) grants it too.
  const granted = next(p.ws, m => m.type === 'shopGranted');
  assert.equal(await deliver({ id: 'evt_done_first', type: 'checkout.completed', data: { checkout_id: reply.url.split('/').pop(), reference: order } }), 200);
  assert.equal((await granted).item, 'cap');
  assert.deepEqual((await a.sb.rpc('my_profile')).data.owned, ['cap']);
  p.ws.close();
});

test('players can read only their own orders and ownership, and cannot write them', async () => {
  const a = await account('reader'), b = await account('other');
  await db.pool.query(`insert into public.shop_ownership (user_id, item) values ($1, 'seun')`, [b.id]);
  // As Supabase runs a signed-in player's queries: the authenticated role, with their id in the JWT claims.
  const c = await db.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: a.id, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    assert.equal((await c.query('select * from public.shop_ownership')).rows.length, 0, 'another player’s purchase is not visible');
    assert.equal((await c.query('select * from public.shop_items')).rows.length, 6, 'the catalogue is public');
    for (const sql of [`insert into public.shop_ownership (user_id, item) values ('${a.id}', 'seun')`, `insert into public.shop_orders (user_id, item, amount, currency) values ('${a.id}', 'seun', 1, 'NGN')`]) {
      await c.query('savepoint s'); await assert.rejects(c.query(sql), /permission denied/); await c.query('rollback to savepoint s');
    }
    await c.query('savepoint s'); await assert.rejects(c.query(`select public.shop_fulfil('evt_x', 'checkout.completed', null, 'chk_1', null, null, null)`), /permission denied/); await c.query('rollback to savepoint s');
  } finally { await c.query('rollback'); c.release(); }
  for (const fn of ['shop_create_order', 'shop_open_order', 'shop_fulfil']) assert.ok((await a.sb.rpc(fn, {})).error, `${fn} is not callable by players`);
  assert.deepEqual((await a.sb.rpc('my_profile')).data.owned, []);
});
