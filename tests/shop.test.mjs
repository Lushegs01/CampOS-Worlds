// The campus store without a database: the catalogue, prices, who may wear what, Bachs webhook signatures,
// and the checkout and fulfilment rules of server/shop.mjs against stand-ins for Bachs and the database.
// tests/shop-accounts.test.mjs runs a whole purchase through real PostgreSQL and a room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { SHOP_ITEMS, PREMIUM_MODELS, PREMIUM_ACCESSORIES, DEFAULT_PRICES, shopPrices, priceOf, formatNaira, bachsAmount } from '../shared/shop.mjs';
import { MODELS, ACCESSORIES, FREE_MODELS, sanitizeAvatar, displayAvatar } from '../shared/campus.mjs';
import { createShop, verifyWebhook } from '../server/shop.mjs';

const SECRET = 'whsec_test_secret';
const sign = (body, ts = Math.floor(Date.now() / 1000), secret = SECRET) => createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const v2 = (body, ts = Math.floor(Date.now() / 1000), secrets = [SECRET]) => ({ 'x-bachs-signature-v2': `t=${ts},${secrets.map(s => `v1=${sign(body, ts, s)}`).join(',')}` });
const ORDER = '7b0c0f5e-8a3e-4d8e-9a43-2f1d0c7e9b11';

test('the catalogue: three characters and three accessories, at ₦3,000 and ₦1,000, mirrored by the database', () => {
  assert.deepEqual(PREMIUM_MODELS, ['emeka', 'folake', 'seun']);
  assert.deepEqual(PREMIUM_ACCESSORIES, ['cap', 'beanie', 'shades']);
  for (const id of PREMIUM_MODELS) assert.ok(MODELS.includes(id)); for (const id of PREMIUM_ACCESSORIES) assert.ok(ACCESSORIES.includes(id));
  assert.equal(priceOf('emeka'), 3000); assert.equal(priceOf('cap'), 1000); assert.equal(priceOf('tunde'), null);
  assert.equal(formatNaira(3000), '₦3,000'); assert.equal(bachsAmount(3000), '3000.00'); assert.equal(bachsAmount(1499.5), '1499.50');
  const sql = readdirSync('supabase/migrations').sort().map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).filter(s => s.includes('insert into public.shop_items')).at(-1);
  const rows = [...sql.matchAll(/\('([a-z0-9-]+)', '(character|accessory)', '([^']+)'\)/g)].map(m => ({ id: m[1], kind: m[2], name: m[3] }));
  assert.deepEqual(rows, SHOP_ITEMS.map(({ id, kind, name }) => ({ id, kind, name })), 'shop_items matches shared/shop.mjs');
});

test('prices are a server setting: whole naira, anything invalid falls back to the defaults', () => {
  assert.deepEqual(shopPrices(), DEFAULT_PRICES);
  assert.deepEqual(shopPrices({ character: '3500', item: '1200' }), { character: 3500, item: 1200 });
  for (const bad of ['', '0', '-5', '12.5', 'abc', '2000000', undefined, NaN]) assert.deepEqual(shopPrices({ character: bad, item: bad }), DEFAULT_PRICES, String(bad));
  assert.equal(priceOf('seun', shopPrices({ character: '4000' })), 4000);
});

test('store items are worn only by an account that owns them; other players see what the room approved', () => {
  const premium = { model: 'emeka', accessory: 'cap', accent: '#506b96', skin: 'natural' };
  assert.deepEqual(sanitizeAvatar(premium), { model: FREE_MODELS[0], skin: 'natural', accent: '#506b96', accessory: 'backpack' }, 'a guest, or an account without them');
  assert.deepEqual(sanitizeAvatar(premium, ['cap']), { model: FREE_MODELS[0], skin: 'natural', accent: '#506b96', accessory: 'cap' }, 'owning one item unlocks only that item');
  assert.deepEqual(sanitizeAvatar(premium, ['emeka', 'cap']), premium);
  assert.equal(sanitizeAvatar({ model: 'mel' }).model, 'mel', 'free characters need nothing');
  assert.deepEqual(displayAvatar(premium), premium);
});

test('webhook signatures: HMAC-SHA256 over "timestamp.raw body", fresh, constant-time, either header format', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'collection.succeeded', data: {} }), raw = Buffer.from(body), now = Date.now(), ts = Math.floor(now / 1000);
  assert.equal(verifyWebhook(v2(body, ts), raw, SECRET, now), true);
  assert.equal(verifyWebhook({ 'x-bachs-timestamp': String(ts), 'x-bachs-signature': sign(body, ts) }, raw, SECRET, now), true, 'the original pair of headers');
  assert.equal(verifyWebhook(v2(body, ts, ['whsec_old', SECRET]), raw, SECRET, now), true, 'any matching v1 while a secret is rotated');
  assert.equal(verifyWebhook(v2(body, ts, ['whsec_other']), raw, SECRET, now), false, 'another secret');
  assert.equal(verifyWebhook(v2(body, ts), Buffer.from(body.replace('evt_1', 'evt_2')), SECRET, now), false, 'a changed body');
  assert.equal(verifyWebhook(v2(body, ts - 301), raw, SECRET, now), false, 'more than five minutes old');
  assert.equal(verifyWebhook(v2(body, ts + 301), raw, SECRET, now), false, 'more than five minutes ahead');
  for (const h of [{}, { 'x-bachs-signature-v2': 't=,v1=' }, { 'x-bachs-signature-v2': `v1=${sign(body, ts)}` }, { 'x-bachs-signature-v2': `t=${ts},v1=zz` }, { 'x-bachs-signature': sign(body, ts) }])
    assert.equal(verifyWebhook(h, raw, SECRET, now), false, JSON.stringify(h));
  assert.equal(verifyWebhook(v2(body, ts), raw, '', now), false, 'never without a secret');
  assert.equal(verifyWebhook(v2(body, ts), body, SECRET, now), false, 'only the raw bytes are checked');
});

/** A stand-in for server/accounts.mjs, recording what the store asks the database to do. */
function fakeAccounts(over = {}) {
  const calls = [];
  return { calls, enabled: true,
    createOrder: async (...a) => { calls.push(['createOrder', ...a]); return ORDER; },
    openOrder: async (...a) => { calls.push(['openOrder', ...a]); },
    fulfilOrder: async f => { calls.push(['fulfilOrder', f]); return { outcome: 'granted', user_id: 'user-1', item: 'emeka' }; },
    ...over };
}
const settings = { secretKey: 'sk_sandbox_abc', webhookSecret: SECRET, appUrl: 'https://worlds.example.edu/', apiUrl: 'https://bachs.test', log: { warn() {}, log() {} } };

test('checkout: one Bachs session per order, at the server’s price, with the order as its reference', async () => {
  const requests = [], accounts = fakeAccounts();
  const fetchImpl = async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ checkout_id: 'chk_1', checkout_url: 'https://pay.bachs.test/chk_1', status: 'open' }), { status: 201 }); };
  const shop = createShop({ ...settings, accounts, fetchImpl });
  assert.equal(shop.enabled, true); assert.deepEqual(shop.catalogue(), { enabled: true, currency: 'NGN', prices: { character: 3000, item: 1000 } });
  const r = await shop.checkout('user-1', 'emeka', { email: 'ada@example.test', name: 'Ada' });
  assert.equal(r.url, 'https://pay.bachs.test/chk_1'); assert.equal(r.amount, 3000);
  const [q] = requests;
  assert.equal(q.url, 'https://bachs.test/v1/checkout-sessions'); assert.equal(q.init.method, 'POST');
  assert.equal(q.init.headers.Authorization, 'Bearer sk_sandbox_abc'); assert.equal(q.init.headers['Idempotency-Key'], ORDER);
  assert.deepEqual(q.body.pricing, { currency: 'NGN', amount: '3000.00' });
  assert.equal(q.body.reference, ORDER); assert.deepEqual(q.body.metadata, { app: 'campos-worlds', order: ORDER, item: 'emeka', account: 'user-1' });
  assert.equal(q.body.success_url, 'https://worlds.example.edu/shop-return.html?status=paid'); assert.equal(q.body.cancel_url, 'https://worlds.example.edu/shop-return.html?status=cancelled');
  assert.deepEqual(q.body.customer, { email: 'ada@example.test', name: 'Ada' });
  assert.deepEqual(accounts.calls[0], ['createOrder', 'user-1', 'emeka', 3000, 'NGN']); assert.deepEqual(accounts.calls[1], ['openOrder', ORDER, 'chk_1']);
  await shop.checkout('user-1', 'shades');
  assert.equal(requests[1].body.pricing.amount, '1000.00', 'items are ₦1,000');
});

test('checkout refusals are short and player-facing; nothing works without the full configuration', async () => {
  const ok = async () => new Response(JSON.stringify({ checkout_id: 'chk_1', checkout_url: 'https://pay.bachs.test/chk_1' }), { status: 201 });
  for (const missing of ['secretKey', 'webhookSecret', 'appUrl']) {
    const shop = createShop({ ...settings, [missing]: '', accounts: fakeAccounts(), fetchImpl: ok });
    assert.equal(shop.enabled, false); await assert.rejects(shop.checkout('user-1', 'emeka'), { reason: 'The store is not open on this server yet.' });
  }
  assert.equal(createShop({ ...settings, accounts: { enabled: false }, fetchImpl: ok }).enabled, false, 'purchases need accounts');
  const shop = createShop({ ...settings, accounts: fakeAccounts(), fetchImpl: ok });
  await assert.rejects(shop.checkout('user-1', 'tunde'), { reason: 'That item is not in the store.' });
  const owned = createShop({ ...settings, accounts: fakeAccounts({ createOrder: async () => { throw Object.assign(new Error('x'), { reason: 'You already own this.' }); } }), fetchImpl: ok });
  await assert.rejects(owned.checkout('user-1', 'emeka'), { reason: 'You already own this.' });
  const down = createShop({ ...settings, accounts: fakeAccounts(), fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.checkout('user-1', 'emeka'), { reason: 'The payment service could not be reached. Please try again.' });
  const refused = createShop({ ...settings, accounts: fakeAccounts(), fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 422 }) });
  await assert.rejects(refused.checkout('user-1', 'emeka'), { reason: 'The payment service could not start your checkout. Please try again.' });
  const odd = createShop({ ...settings, accounts: fakeAccounts(), fetchImpl: async () => new Response(JSON.stringify({ checkout_id: 'chk_1', checkout_url: 'javascript:alert(1)' }), { status: 201 }) });
  await assert.rejects(odd.checkout('user-1', 'emeka'), /could not start/, 'only an https payment page is ever sent to a player');
  assert.equal(createShop({ ...settings, apiUrl: '', secretKey: 'sk_live_x', accounts: fakeAccounts() }).enabled, true);
});

test('fulfilment: only paid collections and completed checkouts for our orders grant; the database decides once', async () => {
  const accounts = fakeAccounts(), granted = [], shop = createShop({ ...settings, accounts, granted: (u, i) => granted.push([u, i]) });
  const event = (type, data, id = `evt_${Math.random()}`) => ({ id, type, created_at: new Date().toISOString(), data });
  assert.equal(await shop.fulfil(event('collection.succeeded', { reference: ORDER, checkout_id: 'chk_1', status: 'SUCCEEDED', amount: '3000.00', currency: 'NGN', charge_id: 'ch_1' })), 200);
  assert.deepEqual(accounts.calls.at(-1)[1], { event: accounts.calls.at(-1)[1].event, type: 'collection.succeeded', order: ORDER, checkout: 'chk_1', amount: '3000.00', currency: 'NGN', charge: 'ch_1' });
  assert.deepEqual(granted, [['user-1', 'emeka']]);
  const before = accounts.calls.length;
  for (const status of ['PENDING', 'FAILED', 'UNDERPAID']) assert.equal(await shop.fulfil(event('collection.succeeded', { reference: ORDER, status, amount: '3000.00', currency: 'NGN' })), 200);
  assert.equal(await shop.fulfil(event('charge.refunded', { reference: ORDER })), 200);
  assert.equal(await shop.fulfil(event('checkout.completed', { reference: 'someone-elses-order', checkout_id: 'chk_9' })), 200, 'not ours');
  assert.equal(accounts.calls.length, before, 'none of these reach the database');
  assert.equal(await shop.fulfil(event('checkout.completed', { checkout_id: 'chk_1', metadata: { app: 'campos-worlds', order: ORDER } })), 200);
  assert.equal(accounts.calls.at(-1)[1].amount, null, 'a completed checkout was created at the price: no amount to compare');
  assert.equal(await shop.fulfil({ type: 'checkout.completed', data: {} }), 400, 'an event needs its id');
  const later = createShop({ ...settings, accounts: fakeAccounts({ fulfilOrder: async () => ({ outcome: 'unknown-order' }) }) });
  assert.equal(await later.fulfil(event('collection.succeeded', { reference: ORDER, status: 'SUCCEEDED', amount: '3000.00', currency: 'NGN' })), 503, 'an order not recorded yet: Bachs retries');
  const offline = createShop({ ...settings, accounts: fakeAccounts({ fulfilOrder: async () => { throw new Error('down'); } }) });
  assert.equal(await offline.fulfil(event('checkout.completed', { reference: ORDER })), 503, 'the database unreachable: Bachs retries');
});
