// The Courtyard Café's sample menu and demo orders. Shared so the counter panel, the vendor's dialogue
// and the room server (which numbers orders) agree on what can be ordered. Demo only: nothing is charged,
// no payment details are ever requested and no transaction is recorded.

/** Prices are shown in naira for flavour; they are never charged. */
export const CAFE_MENU = Object.freeze([
  { id: 'jollof', name: 'Jollof rice bowl', detail: 'Smoky party-style jollof, plantain, coleslaw', price: 2500 },
  { id: 'plantain', name: 'Plantain bites', detail: 'Sweet dodo with pepper sauce', price: 1200 },
  { id: 'moimoi', name: 'Moi moi', detail: 'Steamed bean pudding, egg', price: 900 },
  { id: 'puffpuff', name: 'Puff-puff (6)', detail: 'Warm and dusted with sugar', price: 600 },
  { id: 'zobo', name: 'Zobo', detail: 'Chilled hibiscus with ginger and pineapple', price: 700 },
  { id: 'chapman', name: 'Chapman', detail: 'Citrus, cucumber and bitters', price: 900 },
  { id: 'coffee', name: 'Coffee', detail: 'Single origin from the Mambilla Plateau', price: 1000 },
].map(i => Object.freeze(i)));
export const MENU_BY_ID = new Map(CAFE_MENU.map(i => [i.id, i]));
/** At most this many items in one demo order. */
export const MAX_ORDER_ITEMS = 12;
/** Seconds until the counter calls an order's number. */
export const ORDER_READY_S = 9;

/** Check a list of menu ids: { ok, items, total } or { ok: false, reason }. */
export function validateOrder(items) {
  if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'Choose something from the menu first.' };
  if (items.length > MAX_ORDER_ITEMS) return { ok: false, reason: `Up to ${MAX_ORDER_ITEMS} items in one order, please.` };
  if (!items.every(id => typeof id === 'string' && MENU_BY_ID.has(id))) return { ok: false, reason: 'That isn’t on the menu.' };
  return { ok: true, items: [...items], total: items.reduce((sum, id) => sum + MENU_BY_ID.get(id).price, 0) };
}
