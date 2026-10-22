// The campus store: premium characters and accessories bought with real money (Bachs checkout,
// server/shop.mjs). Shared by the client, the room server and the tests; the database mirrors the item
// list (shop_items in the newest store migration) and tests keep the two in step.
//
// An item is worn only by an account that owns it: the client shows it locked with its price, the room
// replaces it when sanitising an avatar (shared/campus.mjs), and the database refuses to save it.

/** Prices are set on the room server (SHOP_PRICE_CHARACTER / SHOP_PRICE_ITEM, in naira); these are the defaults. */
export const SHOP_CURRENCY = 'NGN';
/** @type {Readonly<{ character: number, item: number }>} */
export const DEFAULT_PRICES = Object.freeze({ character: 3000, item: 1000 });

/** @typedef {{ id: string, kind: 'character' | 'accessory', name: string, detail: string }} ShopItem */
/** @type {readonly ShopItem[]} */
export const SHOP_ITEMS = Object.freeze([
  { id: 'emeka', kind: 'character', name: 'Emeka', detail: 'Tailored suit' },
  { id: 'folake', kind: 'character', name: 'Folake', detail: 'Evening outfit' },
  { id: 'seun', kind: 'character', name: 'Seun', detail: 'Football kit' },
  { id: 'cap', kind: 'accessory', name: 'Snapback cap', detail: 'In your accent colour' },
  { id: 'beanie', kind: 'accessory', name: 'Knit beanie', detail: 'In your accent colour' },
  { id: 'shades', kind: 'accessory', name: 'Gold aviators', detail: 'Tinted lenses, gold frames' },
].map(i => Object.freeze(/** @type {ShopItem} */ (i))));
/** @type {Map<string, ShopItem>} */
export const SHOP_BY_ID = new Map(SHOP_ITEMS.map(i => [i.id, i]));
export const PREMIUM_MODELS = SHOP_ITEMS.filter(i => i.kind === 'character').map(i => i.id);
export const PREMIUM_ACCESSORIES = SHOP_ITEMS.filter(i => i.kind === 'accessory').map(i => i.id);

/** A price in whole naira: positive, at most ₦1,000,000. */
const validPrice = v => Number.isSafeInteger(v) && v > 0 && v <= 1e6;
/** Prices from the server's settings, falling back to the defaults for anything missing or invalid. */
export function shopPrices({ character, item } = {}) {
  const read = (v, d) => { const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v; return validPrice(n) ? n : d; };
  return { character: read(character, DEFAULT_PRICES.character), item: read(item, DEFAULT_PRICES.item) };
}
/** The price of one item in naira, by its kind (characters, or accessories and other items). */
export const priceOf = (id, prices = DEFAULT_PRICES) => { const i = SHOP_BY_ID.get(id); return i ? (i.kind === 'character' ? prices.character : prices.item) : null; };
/** "₦3,000" */
export const formatNaira = n => `₦${Math.round(n).toLocaleString('en-NG')}`;
/** Bachs takes amounts as decimal strings in major units: 3000 → "3000.00". */
export const bachsAmount = n => (Math.round(n * 100) / 100).toFixed(2);
