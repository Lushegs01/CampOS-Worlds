# Campus store (paid characters and accessories)

Players can buy premium characters and accessories with real money. Payment goes through [Bachs](https://bachs.io) hosted checkout. Everything else in the game stays free.

| Item | Kind | Default price |
|---|---|---|
| Emeka: tailored suit | Character | ₦3,000 |
| Folake: evening outfit | Character | ₦3,000 |
| Seun: football kit | Character | ₦3,000 |
| Snapback cap (in your accent colour) | Accessory | ₦1,000 |
| Knit beanie (in your accent colour) | Accessory | ₦1,000 |
| Gold aviators | Accessory | ₦1,000 |

Characters are Microsoft Rocketbox avatars (MIT, see [ASSETS.md](ASSETS.md)). The accessories are procedural and fitted to each character's own head: the cap and beanie wrap round the hair or headscarf, so they fit everyone.

## For players

Open **Appearance**. Store items show a lock and their price. Tap one to try it on in the preview, and **Buy** appears below it. Buying needs a signed-in account with a saved profile. The Bachs checkout opens in a new tab. After paying, that tab says the payment is being confirmed. Within a minute or so, the game tab shows *"Emeka is yours"*, and the item can then be chosen and saved like any other. A purchase belongs to the account, on every device, for good.

## How payment is verified

| Step | Where | What happens |
|---|---|---|
| 1. Buy | Browser → room (`shopCheckout`) | Only a signed-in account with a profile can buy, and only an item it does not own yet |
| 2. Order | Room → database (`shop_create_order`) | Records the item and the **amount the room charges**. Pressing Buy again within 50 minutes reuses the open order |
| 3. Checkout | Room → Bachs (`POST /v1/checkout-sessions`) | `pricing: { currency: "NGN", amount: "3000.00" }`, `reference` = the order id, `Idempotency-Key` = the order id, and `metadata` with the order, item and account. The player is sent only to the `https://` page Bachs returns |
| 4. Webhook | Bachs → room (`POST /shop/webhook`) | Signature checked on the raw body: HMAC-SHA256 of `"{timestamp}.{body}"` with the endpoint's signing secret, constant-time, `X-Bachs-Signature-V2` (or the older header pair), no more than 5 minutes old or ahead. Invalid → `400` |
| 5. Fulfil | Room → database (`shop_fulfil`) | Records the event id once. Matches the order by reference (or checkout id). A `collection.succeeded` must be `SUCCEEDED`, `ACCEPTED` or `OVERPAID`, in NGN, for at least the order's amount. Grants the item once (`shop_ownership`) |
| 6. Unlock | Room → browser (`shopGranted`) | The player, if online, is told at once; their profile now lists the item |

Neither coming back from the checkout page nor anything the browser sends can grant an item. Webhooks are the source of truth, as Bachs recommends. Either `collection.succeeded` or `checkout.completed` may arrive first, and each may arrive more than once. The first grants the item; the rest change nothing. If the database cannot be reached, or the order is not recorded yet, the room answers `503` and Bachs retries (5 attempts over about 80 minutes). Events for other products on the same Bachs account are acknowledged and ignored.

Wearing is enforced in three places:

- **Browser:** locked items are only tried on in the preview.
- **Room:** `sanitizeAvatar()` in `shared/campus.mjs` drops anything not owned, for guests too.
- **Database:** the `profiles_guard` trigger refuses to save a premium character or accessory its owner has not bought (*"Emeka is in the store. Buy it to use it."*).

Players can read their own orders and purchases through row security. They cannot write to any store table or call the store functions; only the room's service key can.

## Set it up

1. **Database:** apply `supabase/migrations/20261022120000_campus_store.sql` (after the earlier migrations). Purchases need accounts ([ACCOUNTS.md](ACCOUNTS.md)), because they belong to one.
2. **Bachs dashboard:**
   - Create an API secret key: `sk_sandbox_…` to test, `sk_live_…` to take real payments.
   - Add a webhook endpoint at `https://<your room host>/shop/webhook`. This is the same host as the room's WebSocket. If a reverse proxy sits in front of the room, route `/shop/webhook` to it as well as `/ws`.
   - Subscribe the endpoint to `collection.succeeded` and `checkout.completed`, and copy its **signing secret**.
3. **Room server environment** (secrets, never `VITE_`):

   | Variable | Purpose |
   |---|---|
   | `BACHS_SECRET_KEY` | API key. A `sk_sandbox_` key uses `https://sandbox-api.bachs.io`, `sk_live_` uses `https://api.bachs.io` |
   | `BACHS_WEBHOOK_SECRET` | The webhook endpoint's signing secret (not the API key) |
   | `PUBLIC_APP_URL` | The game's public address, e.g. `https://worlds.example.edu`. Bachs returns players to `/shop-return.html` there |
   | `SHOP_PRICE_CHARACTER`, `SHOP_PRICE_ITEM` | Optional, in whole naira (defaults `3000` and `1000`). Change them and restart the room: no code change. Orders keep the amount they were opened at |
   | `BACHS_API_URL` | Optional override of the API address (for testing) |

   Without the first three (or without accounts) the store stays closed. Prices still show, and **Buy** explains that the store is not open on this server yet.
4. **Try it with the sandbox key:** buy an item and pay with a Bachs test payment method. Check that the game tab says the item is yours and that the Bachs dashboard shows the webhook delivered with `200`. Then switch to the live key and the live endpoint's secret.

## Operations

- **Who bought what:** `select * from shop_orders order by created_at desc;` (status `created` → `open` → `paid`) and `shop_ownership`.
- **Refunds** are made in Bachs. To also take the item back, delete the row from `shop_ownership`. The room then drops the item from that player's avatar when they next join.
- **Logs** say only `Store item granted: <item>` or why an event was not fulfilled. Keys, secrets, signatures and emails are never logged. The player's email is sent to Bachs only to pre-fill the checkout.
- Analytics (when enabled) count `shop_checkout` by item. Purchases themselves are in the database.

## Tests

- `tests/shop.test.mjs` covers the catalogue (mirrored by the migration), prices, who may wear what, webhook signatures (both header formats, rotation, tampering, age), and the checkout and fulfilment rules against stand-ins.
- `tests/shop-accounts.test.mjs` runs a whole purchase on real PostgreSQL with a room and a stand-in Bachs API. It covers saves refused before buying, guests refused, checkout reuse, forged and stale webhooks refused, underpayment ignored, one grant despite repeated and second events, wearing the item afterwards, early webhooks retried, other products ignored, and players unable to read others' purchases or write any.

## Before taking real payments

These need your Bachs account and could not be run here:

- [ ] A sandbox purchase end to end against `sandbox-api.bachs.io`, with the webhook reaching the room through your proxy.
- [ ] Confirm the delivered payloads match what the room reads: `data.reference`, `data.checkout_id`, `data.status`, `data.amount` (decimal string), `data.currency`, `data.metadata`. The room ignores anything else.
- [ ] Confirm the success and cancel addresses are accepted with a query string (Bachs adds `checkout_id`).
- [ ] Decide on a refund policy and show it to players where you advertise the store.
