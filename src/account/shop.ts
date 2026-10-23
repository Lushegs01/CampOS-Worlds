import { onRoomMessage } from '../network/messages';
import { create } from 'zustand';
import { DEFAULT_PRICES, SHOP_BY_ID, priceOf, shopPrices } from '../../shared/shop.mjs';
import {  send } from '../network/client';
import { useGame } from '../state';
import { reloadProfile } from './store';

// The campus store in the browser (shared/shop.mjs, server/shop.mjs). The room says whether the store is
// open and what it charges; buying asks the room for a Bachs checkout and opens it in a new tab. Nothing
// here grants anything: an item unlocks when the room, having verified Bachs' payment webhook, says so.

interface ShopState {
  /** The room has payments configured (Bachs keys, webhook secret, return address and accounts). */
  enabled: boolean;
  prices: { character: number; item: number };
  /** The item whose checkout is being prepared. */
  buying: string | null;
}
export const useShop = create<ShopState>(() => ({ enabled: false, prices: { ...DEFAULT_PRICES }, buying: null }));
export const usePrice = (id: string) => useShop(s => priceOf(id, s.prices));

interface CheckoutReply { ok: boolean; url?: string; reason?: string }
const waiting = new Map<number, (m: CheckoutReply) => void>();
let ref = 0, started = false;

export function initShop() {
  if (started) return; started = true;
  onRoomMessage(m => {
    if (m.type === 'welcome' && m.shop) useShop.setState({ enabled: m.shop.enabled === true, prices: shopPrices(m.shop.prices) });
    if (m.type === 'shopCheckout') { waiting.get(m.ref)?.({ ok: !!m.ok, url: typeof m.url === 'string' ? m.url : undefined, reason: m.reason }); waiting.delete(m.ref); }
    if (m.type === 'shopGranted') {
      const item = SHOP_BY_ID.get(m.item);
      if (item) useGame.getState().notify(`${item.name} is yours. Choose ${item.kind === 'character' ? 'them' : 'it'} in Appearance and save your profile.`);
      void reloadProfile().catch(() => {});
    }
    if (m.type === 'disconnected') { for (const w of waiting.values()) w({ ok: false, reason: 'The connection to campus was lost. Please try again.' }); waiting.clear(); }
  });
}

/** Opens a Bachs checkout for `item` in a new tab (or this one, if the browser blocks new tabs). */
export async function buy(item: string) {
  if (useShop.getState().buying) return;
  // Opened now, while the click still counts as the player's own action, so the browser allows it; the
  // checkout address arrives a moment later from the room.
  const tab = window.open('', '_blank');
  if (tab) { tab.opener = null; try { tab.document.title = 'Secure checkout'; tab.document.body.style.cssText = 'font:16px system-ui;padding:2rem;color:#22352d'; tab.document.body.textContent = 'Opening secure checkout…'; } catch { /* not ours to write */ } }
  useShop.setState({ buying: item });
  const id = ++ref;
  const reply = await new Promise<CheckoutReply>(resolve => {
    waiting.set(id, resolve);
    if (!send({ type: 'shopCheckout', item, ref: id })) resolve({ ok: false, reason: 'Connect to campus to buy from the store.' });
    setTimeout(() => resolve({ ok: false, reason: 'The store did not answer. Please try again.' }), 20000);
  });
  waiting.delete(id); useShop.setState({ buying: null });
  const notify = useGame.getState().notify;
  if (!reply.ok || !reply.url) { tab?.close(); notify(reply.reason ?? 'The store is unavailable right now.'); return; }
  if (tab && !tab.closed) { tab.location.replace(reply.url); notify('Checkout opened in a new tab. Your item unlocks here as soon as the payment is confirmed.'); }
  else window.location.assign(reply.url);
}
