// The campus store's payments, through Bachs (bachs.io) hosted checkout.
//
// Buying: the room opens an order in the database, creates a Bachs checkout session for exactly that order
// and amount (the order id is the checkout's `reference`, so a retried request never makes a second
// checkout), and sends the player to Bachs' payment page. Coming back from that page grants nothing.
//
// Being paid: Bachs POSTs signed events to the room's webhook (`/shop/webhook`). The signature is an
// HMAC-SHA256 of "<timestamp>.<raw body>" with the endpoint's signing secret, checked in constant time on the
// raw bytes before anything is parsed, and events more than five minutes old or ahead are refused. Only then
// is the order fulfilled in the database (once per event id, once per item).
//
// Configuration (server only, never in the browser bundle): BACHS_SECRET_KEY (sk_sandbox_… or sk_live_…),
// BACHS_WEBHOOK_SECRET (the webhook endpoint's signing secret), PUBLIC_APP_URL (where players return after
// paying), and optionally SHOP_PRICE_CHARACTER / SHOP_PRICE_ITEM (whole naira) and BACHS_API_URL.
// Keys, secrets and signatures are never logged.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SHOP_BY_ID, SHOP_CURRENCY, shopPrices, priceOf, bachsAmount } from '../shared/shop.mjs';

export const WEBHOOK_PATH = '/shop/webhook';
const TOLERANCE_S = 300, MAX_BODY = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Payment statuses on `collection.succeeded` that mean the money arrived (OVERPAID: more than asked). */
const PAID = new Set(['SUCCEEDED', 'ACCEPTED', 'OVERPAID']);
const apiBase = key => (key.startsWith('sk_live_') ? 'https://api.bachs.io' : 'https://sandbox-api.bachs.io');

/**
 * Verify a Bachs webhook. `headers` are Node's lower-cased request headers; `raw` is the body exactly as
 * received (a Buffer). Accepts X-Bachs-Signature-V2 (`t=<ts>,v1=<sig>[,v1=<sig>]`, any matching v1 during a
 * secret rotation) or the older X-Bachs-Timestamp + X-Bachs-Signature pair.
 */
export function verifyWebhook(headers, raw, secret, now = Date.now()) {
  if (!secret || !Buffer.isBuffer(raw)) return false;
  let ts = null, signatures = [];
  const v2 = typeof headers['x-bachs-signature-v2'] === 'string' ? headers['x-bachs-signature-v2'] : '';
  if (v2) for (const part of v2.split(',')) { const [k, v] = part.split('=').map(s => s?.trim()); if (k === 't') ts = v; else if (k === 'v1' && v) signatures.push(v); }
  else { ts = typeof headers['x-bachs-timestamp'] === 'string' ? headers['x-bachs-timestamp'].trim() : null; if (typeof headers['x-bachs-signature'] === 'string') signatures = [headers['x-bachs-signature'].trim()]; }
  if (!ts || !/^\d{1,12}$/.test(ts) || !signatures.length) return false;
  if (Math.abs(now / 1000 - Number(ts)) > TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.`).update(raw).digest();
  return signatures.some(s => { if (!/^[0-9a-f]{64}$/i.test(s)) return false; const given = Buffer.from(s, 'hex'); return given.length === expected.length && timingSafeEqual(given, expected); });
}

/** Reads a request body up to `limit` bytes as a Buffer (null if larger). */
async function rawBody(req, limit = MAX_BODY) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) return null; chunks.push(chunk); }
  return Buffer.concat(chunks);
}

/**
 * The store service. `accounts` is server/accounts.mjs (orders and ownership live in Supabase). `granted`
 * is called with (accountId, itemId) when a payment grants an item, so the room can tell the player at once.
 */
export function createShop({ secretKey = '', webhookSecret = '', appUrl = '', apiUrl = '', prices: priceSettings = {}, accounts = { enabled: false }, granted = () => {}, fetchImpl = globalThis.fetch, timeoutMs = 10000, log = console } = {}) {
  const prices = shopPrices(priceSettings), base = (apiUrl || (secretKey ? apiBase(secretKey) : '')).replace(/\/+$/, '');
  const returnTo = appUrl.replace(/\/+$/, '');
  const enabled = !!(secretKey && webhookSecret && returnTo && accounts.enabled);
  const catalogue = () => ({ enabled, currency: SHOP_CURRENCY, prices });

  /** Create a Bachs checkout for one item. Resolves to { url } or rejects with a player-facing `reason`. */
  async function checkout(accountId, itemId, customer = {}) {
    const refuse = reason => Object.assign(new Error(reason), { reason });
    if (!enabled) throw refuse('The store is not open on this server yet.');
    const item = SHOP_BY_ID.get(itemId); if (!item) throw refuse('That item is not in the store.');
    const amount = priceOf(itemId, prices);
    let order;
    try { order = await accounts.createOrder(accountId, itemId, amount, SHOP_CURRENCY); }
    catch (e) { throw refuse(e?.reason ?? 'The store could not start your order right now.'); }
    if (typeof order !== 'string' || !UUID.test(order)) throw refuse('The store could not start your order right now.');
    const body = {
      pricing: { currency: SHOP_CURRENCY, amount: bachsAmount(amount) },
      // A small page of its own (public/shop-return.html): returning to the game itself in the checkout tab
      // would open campus twice with one account.
      success_url: `${returnTo}/shop-return.html?status=paid`, cancel_url: `${returnTo}/shop-return.html?status=cancelled`,
      reference: order, expires_in_minutes: 60,
      metadata: { app: 'campos-worlds', order, item: itemId, account: accountId },
      ...(customer.email ? { customer: { email: customer.email, ...(customer.name ? { name: customer.name } : {}) } } : {}),
    };
    let response, data = null;
    try {
      response = await fetchImpl(`${base}/v1/checkout-sessions`, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': order },
        body: JSON.stringify(body),
      });
      data = await response.json().catch(() => null);
    } catch (e) {
      log.warn?.(`Store checkout unavailable: ${e?.name === 'TimeoutError' ? 'timed out' : 'network error'}`);
      throw refuse('The payment service could not be reached. Please try again.');
    }
    if (!response.ok || typeof data?.checkout_url !== 'string' || !/^https:\/\//.test(data.checkout_url) || typeof data?.checkout_id !== 'string') {
      log.warn?.(`Store checkout refused by Bachs (${response.status})`);
      throw refuse('The payment service could not start your checkout. Please try again.');
    }
    await accounts.openOrder(order, data.checkout_id).catch(() => log.warn?.('Store order could not record its checkout; the webhook matches it by reference.'));
    return { url: data.checkout_url, order, amount, currency: SHOP_CURRENCY };
  }

  /** Fulfil a verified event. Returns the HTTP status to answer Bachs with. */
  async function fulfil(event) {
    const type = typeof event?.type === 'string' ? event.type : '', data = event?.data && typeof event.data === 'object' ? event.data : {};
    if (typeof event?.id !== 'string' || !event.id || event.id.length > 128) return 400;
    if (type !== 'collection.succeeded' && type !== 'checkout.completed') return 200; // nothing to do for other events
    const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    const reference = typeof data.reference === 'string' ? data.reference : typeof meta.order === 'string' ? meta.order : '';
    const order = UUID.test(reference) ? reference : null, checkoutId = typeof data.checkout_id === 'string' && data.checkout_id.length <= 128 ? data.checkout_id : null;
    // Events for other products on the same Bachs account are not ours.
    if (!order && meta.app !== 'campos-worlds') return 200;
    let amount = null, currency = null, charge = null;
    if (type === 'collection.succeeded') {
      if (typeof data.status !== 'string' || !PAID.has(data.status.toUpperCase())) return 200;
      amount = typeof data.amount === 'string' && /^\d+(\.\d+)?$/.test(data.amount) ? data.amount : typeof data.amount === 'number' && Number.isFinite(data.amount) && data.amount >= 0 ? String(data.amount) : null;
      if (amount === null) return 200;
      currency = typeof data.currency === 'string' ? data.currency : null; charge = typeof data.charge_id === 'string' ? data.charge_id.slice(0, 128) : null;
    }
    // checkout.completed: the checkout was created by this server at the item's price, so its completion is
    // a full payment for that order (matched by reference, or by its checkout id).
    let r;
    try { r = await accounts.fulfilOrder({ event: event.id, type, order, checkout: checkoutId, amount, currency, charge }); }
    catch { log.warn?.('Store fulfilment could not reach the database; Bachs will retry.'); return 503; }
    if (r?.outcome === 'granted') { log.log?.(`Store item granted: ${r.item}`); granted(r.user_id, r.item); }
    // An order not in the database yet may be a checkout that is still being recorded: retried by Bachs.
    else if (r?.outcome === 'unknown-order') return order ? 503 : 200;
    else if (r?.outcome === 'mismatch' || r?.outcome === 'underpaid') log.warn?.(`Store event not fulfilled (${r.outcome}).`);
    return 200;
  }

  /** The room's HTTP handler for Bachs webhooks. */
  async function handle(req, res) {
    const answer = (status, body = {}) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') return answer(405);
    if (!enabled) return answer(503, { error: 'store not configured' });
    const raw = await rawBody(req).catch(() => null);
    if (!raw) return answer(413);
    if (!verifyWebhook(req.headers, raw, webhookSecret)) return answer(400, { error: 'invalid signature' });
    let event; try { event = JSON.parse(raw.toString('utf8')); } catch { return answer(400, { error: 'invalid body' }); }
    const status = await fulfil(event);
    return answer(status, status < 300 ? { received: true } : {});
  }

  return { enabled, prices, catalogue, checkout, handle, fulfil };
}
