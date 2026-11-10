// Combat Arena Armory, end to end on real PostgreSQL 17 (supabase/migrations, including
// 20261110120000_arena_armory_and_preferences.sql) with the real room, arena and store code and a stand-in for
// Bachs' checkout API: a premium weapon is refused until it is bought, a verified payment grants it to the
// account (and to its open arena connection at once), the purchase shows in the player's history, a refund
// takes it away again and a late duplicate payment event cannot bring it back. Also: the account-synchronised
// arena preferences (settings and HUD layouts) are private to their owner and size-limited.
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
import { PRESETS } from '../shared/arena/rules.mjs';
import { FREE_FIREARMS, PREMIUM_WEAPONS } from '../shared/arena/weapons.mjs';
import { defaultHudStore, validateHudStore } from '../shared/arena/hud.mjs';

const SECRET = 'whsec_armory_test', ADMIN = 'admin-token-armory', quiet = { warn() {}, log() {}, error() {} };
let db, supa, room, port, bachs;
const sessions = [];
before(async () => {
  db = await startDatabase({ name: 'armory' });
  supa = await startLocalSupabase({ pool: db.pool });
  const byKey = new Map();
  bachs = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.method !== 'POST' || req.url !== '/v1/checkout-sessions') { res.writeHead(401); res.end('{}'); return; }
    const key = req.headers['idempotency-key'];
    if (!byKey.has(key)) { const n = byKey.size + 1; byKey.set(key, { checkout_id: `chk_a${n}`, checkout_url: `https://checkout.bachs.test/chk_a${n}`, status: 'open' }); }
    sessions.push({ key, body: JSON.parse(body) });
    res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(byKey.get(key)));
  });
  await new Promise(r => bachs.listen(0, '127.0.0.1', r));
  room = createRoom({ port: 0, adminToken: ADMIN, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey, log: quiet }),
    shop: { secretKey: 'sk_sandbox_test', webhookSecret: SECRET, appUrl: 'http://localhost:5173', apiUrl: `http://127.0.0.1:${bachs.address().port}`, refundEvents: 'collection.refunded', log: quiet } });
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
/** A socket that records everything and can wait for a message. */
async function socket(path, hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin: 'http://localhost:5173' });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const c = { ws, msgs: [], waiters: new Set(), ref: 0 };
  ws.on('message', raw => { const m = JSON.parse(raw); c.msgs.push(m); for (const w of [...c.waiters]) if (w.pred(m)) { c.waiters.delete(w); w.resolve(m); } });
  c.send = m => ws.send(JSON.stringify(m));
  c.seen = pred => c.msgs.find(pred);
  c.wait = (pred, timeout = 6000) => new Promise((resolve, reject) => { const w = { pred, resolve }; c.waiters.add(w); setTimeout(() => { if (c.waiters.delete(w)) reject(new Error(`timed out on ${path}; last: ${JSON.stringify(c.msgs.slice(-3)).slice(0, 600)}`)); }, timeout); });
  c.request = data => { const ref = ++c.ref; const r = c.wait(m => m.t === 'reply' && m.ref === ref); c.send({ ...data, ref }); return r; };
  if (hello) { const ready = c.wait(hello.until); c.send(hello.message); c.ready = await ready; }
  return c;
}
const arena = a => socket('/arena', { message: { t: 'hello', name: 'Buyer', access: a.token }, until: m => m.t === 'ready' });
const campus = async a => {
  const c = await socket('/ws', { message: { type: 'join', name: 'Buyer', avatar: {}, access: a.token }, until: m => m.type === 'welcome' });
  if (!c.seen(m => m.type === 'auth')) await c.wait(m => m.type === 'auth');
  return c;
};
/** Run SQL as a signed-in player (row security applies), as PostgREST would. */
async function asPlayer(a, sql) {
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: a.id, role: 'authenticated' })]);
    await client.query('set local role authenticated');
    return await client.query(sql);
  } finally { await client.query('rollback').catch(() => {}); client.release(); }
}
async function deliver(event) {
  const ts = Math.floor(Date.now() / 1000), body = JSON.stringify(event), sig = createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  return (await fetch(`http://127.0.0.1:${port}/shop/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bachs-Signature-V2': `t=${ts},v1=${sig}` }, body })).status;
}
const paid = (order, checkout, amount, id = `evt_${Math.random().toString(36).slice(2)}`) => ({ id, type: 'collection.succeeded',
  data: { charge_id: `ch_${id}`, checkout_id: checkout, reference: order, status: 'SUCCEEDED', amount, currency: 'NGN', metadata: { app: 'campos-worlds', order } } });
const TALON = { name: 'Marksman', primary: 'talon', secondary: 'knife', lethal: 'frag', tactical: 'flash', perks: ['steady', 'fleet'] };

test('the free experience: exactly two free firearms, playable by anyone; premium weapons refused everywhere until bought', async () => {
  assert.deepEqual(FREE_FIREARMS, ['vanguard', 'wasp']);
  const a = await account('freeplayer'), c = await arena(a);
  assert.deepEqual(c.ready.owned, []);
  for (const primary of FREE_FIREARMS) assert.equal((await c.request({ t: 'loadout', loadout: { ...PRESETS[0], primary } })).ok, true, primary);
  for (const w of PREMIUM_WEAPONS) {
    const slot = w === 'sparrow' || w === 'thorn' ? 'secondary' : 'primary';
    // The arena server (rate-limited to six loadout changes in five seconds: a sample) …
    if (['halcyon', 'sparrow', 'longbow'].includes(w)) {
      const r = await c.request({ t: 'loadout', loadout: { ...PRESETS[0], [slot]: w } });
      assert.equal(r.ok, false, `${w} must be refused`); assert.match(r.reason, /Armory/); assert.equal(r.locked, w);
    }
    // … and the database (every premium weapon).
    const db1 = await a.sb.rpc('save_arena_loadout', { p_slot: 1, p_loadout: { ...PRESETS[0], [slot]: w } });
    assert.match(db1.error?.message ?? '', /Armory weapon you do not own/, `${w}: the database refuses it too`);
  }
  // Guests own nothing and cannot buy.
  const guest = await socket('/arena', { message: { t: 'hello', name: 'Guest' }, until: m => m.t === 'ready' });
  assert.equal((await guest.request({ t: 'loadout', loadout: TALON })).ok, false);
  // A forged ownership claim from the client changes nothing.
  const forged = await c.request({ t: 'loadout', loadout: { ...TALON, owned: ['weapon-talon'] }, owned: ['weapon-talon'] });
  assert.equal(forged.ok, false);
  // The client cannot write ownership itself.
  await assert.rejects(asPlayer(a, `insert into public.shop_ownership (user_id, item) values ('${a.id}', 'weapon-talon')`), /permission denied/);
  await assert.rejects(asPlayer(a, `update public.arena_catalog set premium = false`), /permission denied/);
  for (const s of [c, guest]) s.ws.close();
});

test('buying a weapon: verified payment grants it once, the open arena connection learns at once, and it can be equipped and saved', async () => {
  const a = await account('armorybuyer'), c = await arena(a), p = await campus(a);
  assert.equal((await c.request({ t: 'loadout', loadout: TALON })).ok, false);
  // Checkout through the campus connection, at the weapon price.
  const reply = p.wait(m => m.type === 'shopCheckout'); p.send({ type: 'shopCheckout', item: 'weapon-talon', ref: 3 });
  const r = await reply; assert.equal(r.ok, true, r.reason); assert.equal(r.amount, 1500);
  const order = sessions.at(-1).body.reference, checkout = r.url.split('/').pop();
  assert.deepEqual(sessions.at(-1).body.pricing, { currency: 'NGN', amount: '1500.00' });
  // Coming back from the checkout page, or claiming it, grants nothing.
  assert.equal((await c.request({ t: 'owned' })).owned.length, 0);
  // Underpayment is not a purchase.
  assert.equal(await deliver(paid(order, checkout, '1000.00')), 200);
  assert.equal((await c.request({ t: 'loadout', loadout: TALON })).ok, false);
  // The real payment.
  const owned = c.wait(m => m.t === 'owned' && m.owned.includes('weapon-talon')), granted = p.wait(m => m.type === 'shopGranted');
  const event = paid(order, checkout, '1500.00');
  assert.equal(await deliver(event), 200);
  assert.equal((await granted).item, 'weapon-talon'); await owned;
  assert.equal((await c.request({ t: 'loadout', loadout: TALON })).ok, true, 'equippable after purchase');
  assert.equal((await a.sb.rpc('save_arena_loadout', { p_slot: 1, p_loadout: TALON })).error, null, 'saved to the account');
  // Repeated event: still one ownership row.
  assert.equal(await deliver(event), 200);
  assert.equal((await db.pool.query(`select count(*)::int n from public.shop_ownership where user_id = $1 and item = 'weapon-talon'`, [a.id])).rows[0].n, 1);
  // Persistent across sessions and devices: a new arena connection owns it from the start.
  const again = await arena(a);
  assert.deepEqual(again.ready.owned, ['weapon-talon']); assert.equal(again.ready.loadout.primary, 'talon');
  // Purchase history.
  const history = (await a.sb.rpc('my_purchases')).data;
  assert.equal(history.orders[0].item, 'weapon-talon'); assert.equal(history.orders[0].status, 'paid'); assert.equal(Number(history.orders[0].amount), 1500);
  assert.deepEqual(history.owned.map(o => [o.item, o.source]), [['weapon-talon', 'purchase']]);
  // Buying what you own is refused.
  const dup = p.wait(m => m.type === 'shopCheckout'); p.send({ type: 'shopCheckout', item: 'weapon-talon', ref: 4 });
  assert.equal((await dup).reason, 'You already own this.');

  // A refund (verified webhook): ownership goes, the loadout falls back to a free one at the next deployment.
  const reset = again.wait(m => m.t === 'loadoutReset'), lost = again.wait(m => m.t === 'owned' && !m.owned.includes('weapon-talon'));
  assert.equal(await deliver({ id: 'evt_refund_1', type: 'collection.refunded', data: { reference: order, checkout_id: checkout, metadata: { app: 'campos-worlds', order } } }), 200);
  await lost; assert.ok(FREE_FIREARMS.includes((await reset).loadout.primary));
  assert.equal((await again.request({ t: 'loadout', loadout: TALON })).ok, false, 'refused again after the refund');
  assert.match((await a.sb.rpc('save_arena_loadout', { p_slot: 2, p_loadout: TALON })).error?.message ?? '', /do not own/);
  // A late or repeated payment event for the refunded order grants nothing.
  assert.equal(await deliver(event), 200);
  assert.equal(await deliver(paid(order, checkout, '1500.00')), 200);
  assert.equal((await db.pool.query(`select count(*)::int n from public.shop_ownership where user_id = $1`, [a.id])).rows[0].n, 0);
  const o = (await db.pool.query('select status, refunded_at is not null as refunded from public.shop_orders where id = $1', [order])).rows[0];
  assert.deepEqual(o, { status: 'refunded', refunded: true });
  assert.equal((await a.sb.rpc('my_purchases')).data.orders[0].status, 'refunded');
  // The operator endpoint is idempotent and needs the admin token.
  const admin = body => fetch(`http://127.0.0.1:${port}/admin/shop/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify(body) });
  assert.equal((await (await admin({ order, reason: 'chargeback' })).json()).outcome, 'already-revoked');
  assert.equal((await fetch(`http://127.0.0.1:${port}/admin/shop/revoke`, { method: 'POST', body: JSON.stringify({ order }) })).status, 403);
  assert.equal((await admin({ order: 'not-a-uuid' })).status, 400);
  for (const s of [c, p, again]) s.ws.close();
});

test('arena preferences: settings and HUD layouts sync to the account, privately, with a size limit', async () => {
  const a = await account('hudowner'), b = await account('hudother');
  assert.equal((await a.sb.rpc('my_arena_preferences')).data, null);
  const hud = defaultHudStore(); hud.layouts.touchLandscape.elements.fire.scale = 1.4;
  const saved = await a.sb.rpc('save_arena_preferences', { p_settings: { autoFire: true, quality: 'low' }, p_hud: hud });
  assert.equal(saved.error, null);
  const back = (await a.sb.rpc('my_arena_preferences')).data;
  assert.equal(back.settings.autoFire, true);
  const restored = validateHudStore(back.hud);
  assert.equal(restored.store.layouts.touchLandscape.elements.fire.scale, 1.4); assert.deepEqual(restored.repaired, []);
  // Settings alone keep the HUD.
  assert.equal((await a.sb.rpc('save_arena_preferences', { p_settings: { autoFire: false } })).error, null);
  assert.equal(validateHudStore((await a.sb.rpc('my_arena_preferences')).data.hud).store.layouts.touchLandscape.elements.fire.scale, 1.4);
  // Others cannot read them; nobody can write the table directly; oversized layouts are refused.
  assert.equal((await b.sb.rpc('my_arena_preferences')).data, null);
  assert.equal((await asPlayer(b, 'select * from public.arena_preferences')).rows.length, 0, 'others cannot read them');
  assert.equal((await asPlayer(a, 'select * from public.arena_preferences')).rows.length, 1, 'the owner can');
  await assert.rejects(asPlayer(a, `update public.arena_preferences set hud = '{}'`), /permission denied/, 'no direct writes');
  assert.match((await a.sb.rpc('save_arena_preferences', { p_hud: { junk: 'x'.repeat(60000) } })).error?.message ?? '', /too large/);
  assert.match((await a.sb.rpc('save_arena_preferences', { p_settings: [] })).error?.message ?? '', /could not be saved/);
});

test('players already using a weapon when it joined the Armory keep it (the migration’s legacy grant)', async () => {
  const a = await account('veteran'), b = await account('newcomer');
  // Data as it stood before the migration: a saved loadout with the Anvil, shots fired with the Longbow.
  await db.pool.query(`insert into public.arena_loadouts (user_id, slot, name, primary_weapon, secondary_weapon, lethal, tactical, perks) values ($1, 1, 'Old', 'anvil', 'knife', 'frag', 'flash', '{fleet,steady}')`, [a.id]);
  await db.pool.query(`insert into public.arena_weapon_stats (user_id, weapon, kills, headshots, shots, hits) values ($1, 'longbow', 0, 0, 12, 3), ($1, 'vanguard', 4, 1, 90, 30)`, [a.id]);
  const sql = (await import('node:fs')).readFileSync('supabase/migrations/20261110120000_arena_armory_and_preferences.sql', 'utf8');
  const legacy = sql.slice(sql.indexOf('insert into public.shop_ownership (user_id, item, source)'), sql.indexOf('on conflict do nothing;', sql.indexOf('insert into public.shop_ownership (user_id, item, source)')) + 'on conflict do nothing;'.length);
  await db.pool.query(legacy); await db.pool.query(legacy); // idempotent
  const owned = (await a.sb.rpc('my_purchases')).data.owned.map(o => [o.item, o.source]).sort();
  assert.deepEqual(owned, [['weapon-anvil', 'legacy'], ['weapon-longbow', 'legacy']], 'free weapons need no grant; premium ones in use are kept');
  assert.deepEqual((await b.sb.rpc('my_purchases')).data.owned, [], 'nobody else gains anything');
  const c = await arena(a);
  assert.deepEqual([...c.ready.owned].sort(), ['weapon-anvil', 'weapon-longbow']); assert.equal(c.ready.loadout.primary, 'anvil', 'their saved loadout still works');
  c.ws.close();
});
