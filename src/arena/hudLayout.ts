// The player's HUD layouts in the browser: kept on this device at once (so nothing is lost), and for
// signed-in players also in their account (arena_preferences), so they follow the player to other devices.
// Every layout read from either place goes through validateHudStore (shared/arena/hud.mjs) first: a damaged,
// older or foreign layout is repaired element by element and the player is told, never trusted.
// Arena settings (auto-fire, sensitivity, …) are synchronised the same way.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { validateHudStore, defaultHudStore, profileFor, type HUD_VERSION } from '../../shared/arena/hud.mjs';
import { parseArenaSettings, syncedSettings } from '../../shared/arena/settings.mjs';
import { getCommunityService } from '../services/community';
import { useArena, onSettingsChange, type ArenaSettings } from './store';

export type Profile = 'desktop' | 'touchLandscape' | 'touchPortrait';
export type Element = { x: number; y: number; scale: number; opacity: number; visible: boolean; align?: 'left' | 'center' | 'right' };
export type Layout = {
  version: typeof HUD_VERSION; profile: Profile; preset: string;
  global: { opacity: number; textScale: number; iconScale: number; contrast: 'standard' | 'high'; buttonOpacity: number };
  crosshair: { style: string; color: string; thickness: number; outline: boolean };
  elements: Record<string, Element>;
};
export type HudStore = { version: number; layouts: Record<Profile, Layout>; previous: Partial<Record<Profile, Layout>> | null; updatedAt: number };

const KEY = 'campos-arena-hud', SETTINGS_AT = 'campos-arena-settings-at';
function load(): { store: HudStore; repaired: string[] } {
  try { const r = validateHudStore(JSON.parse(localStorage.getItem(KEY) ?? 'null')); return { store: r.store as HudStore, repaired: r.repaired }; }
  catch { return { store: defaultHudStore() as HudStore, repaired: ['store'] }; }
}
const initial = load();
interface HudState {
  store: HudStore;
  /** Set when a saved layout had to be repaired (shown once in the editor and the lobby). */
  notice: string;
  sync: 'local' | 'saving' | 'saved' | 'failed';
  /** Save layouts (the previous saved version is kept for "Restore previous"). */
  save: (layouts: Partial<Record<Profile, Layout>>) => void;
  restorePrevious: (profile: Profile) => boolean;
}
export const useHudLayouts = create<HudState>()((set, get) => ({
  store: initial.store,
  notice: initial.repaired.length ? 'Part of your saved HUD layout could not be used and was reset to its default.' : '',
  sync: 'local',
  save: layouts => {
    const cur = get().store, previous = { ...(cur.previous ?? {}) };
    for (const p of Object.keys(layouts) as Profile[]) previous[p] = cur.layouts[p];
    const store: HudStore = { ...cur, layouts: { ...cur.layouts, ...layouts }, previous, updatedAt: Date.now() };
    writeLocal(store); set({ store }); pushToAccount();
  },
  restorePrevious: profile => {
    const cur = get().store, prev = cur.previous?.[profile]; if (!prev) return false;
    get().save({ [profile]: prev } as Partial<Record<Profile, Layout>>); return true;
  },
}));
function writeLocal(store: HudStore) { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage denied: the layout still applies for this visit */ } }

// ---------------------------------------------------------------- account synchronisation
let hudTimer: ReturnType<typeof setTimeout> | undefined, settingsTimer: ReturnType<typeof setTimeout> | undefined;
const signedIn = () => !!useArena.getState().me?.verified;
function pushToAccount() {
  clearTimeout(hudTimer);
  if (!signedIn()) { useHudLayouts.setState({ sync: 'local' }); return; }
  useHudLayouts.setState({ sync: 'saving' });
  hudTimer = setTimeout(async () => {
    try { const svc = await getCommunityService(); await svc.saveArenaPreferences(null, useHudLayouts.getState().store as unknown as Record<string, unknown>); useHudLayouts.setState({ sync: 'saved' }); }
    catch { useHudLayouts.setState({ sync: 'failed' }); }
  }, 1200);
}
onSettingsChange((s: ArenaSettings) => {
  try { localStorage.setItem(SETTINGS_AT, String(Date.now())); } catch { /* storage denied */ }
  clearTimeout(settingsTimer);
  if (!signedIn()) return;
  settingsTimer = setTimeout(async () => { try { const svc = await getCommunityService(); await svc.saveArenaPreferences(syncedSettings(s), null); } catch { /* kept on this device; retried with the next change */ } }, 1500);
});
/**
 * After a signed-in player connects: take the account's layouts and settings if they are newer than this
 * device's, otherwise send this device's up. Never blocks play; failures leave the device's copy in use.
 */
export async function syncFromAccount() {
  if (!signedIn()) return;
  type Prefs = { settings?: unknown; hud?: unknown; updated_at?: string } | null;
  let prefs: Prefs;
  try { prefs = await (await getCommunityService()).myArenaPreferences() as Prefs; } catch { return; }
  const local = useHudLayouts.getState().store;
  if (prefs?.hud && typeof prefs.hud === 'object' && Object.keys(prefs.hud).length) {
    const r = validateHudStore(prefs.hud), remote = r.store as HudStore;
    if (remote.updatedAt > local.updatedAt) {
      writeLocal(remote); useHudLayouts.setState({ store: remote, sync: 'saved', notice: r.repaired.length ? 'Part of the HUD layout saved in your account could not be used and was reset to its default.' : useHudLayouts.getState().notice });
    } else if (local.updatedAt > remote.updatedAt) pushToAccount();
  } else if (local.updatedAt > 0) pushToAccount();
  const settingsAt = Number((() => { try { return localStorage.getItem(SETTINGS_AT); } catch { return null; } })() ?? 0);
  const remoteAt = prefs?.updated_at ? Date.parse(prefs.updated_at) : 0;
  if (prefs?.settings && typeof prefs.settings === 'object' && remoteAt > settingsAt && Object.keys(prefs.settings).length) {
    const a = useArena.getState(), merged = parseArenaSettings({ ...a.settings, ...syncedSettings(parseArenaSettings({ ...a.settings, ...(prefs.settings as object) })) }, a.settings.quality) as ArenaSettings;
    useArena.setState({ settings: merged });
    try { localStorage.setItem('campos-arena-settings', JSON.stringify(merged)); } catch { /* storage denied */ }
  }
}

// ---------------------------------------------------------------- which layout applies right now
const media = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);
export function currentProfile(): Profile {
  return profileFor({ coarse: !!media('(pointer: coarse)')?.matches || touchSeen, portrait: !!media('(orientation: portrait)')?.matches }) as Profile;
}
let touchSeen = false;
/** The profile in use, following rotation and the first touch (a touchscreen laptop switches to touch controls). */
export function useHudProfile(): Profile {
  const [p, setP] = useState(currentProfile);
  useEffect(() => {
    const update = () => setP(currentProfile());
    const touched = () => { touchSeen = true; update(); };
    const o = media('(orientation: portrait)'), c = media('(pointer: coarse)');
    o?.addEventListener?.('change', update); c?.addEventListener?.('change', update);
    window.addEventListener('resize', update); window.addEventListener('touchstart', touched, { once: true, passive: true });
    return () => { o?.removeEventListener?.('change', update); c?.removeEventListener?.('change', update); window.removeEventListener('resize', update); window.removeEventListener('touchstart', touched); };
  }, []);
  return p;
}
/** The layout to draw for the current profile. */
export function useActiveLayout(): Layout { const profile = useHudProfile(); return useHudLayouts(s => s.store.layouts[profile]); }
