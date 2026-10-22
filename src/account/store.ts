import { create } from 'zustand';
import { sanitizeAvatar } from '../../shared/campus.mjs';
import { useGame, type AvatarConfig } from '../state';
import { getCommunityService, communityConfigured, ServiceError, toServiceError } from '../services/community';
import { ACHIEVEMENTS, type AchievementId, type MyProfile, type ProfileInput } from '../services/types';
import { registerAccountBridge, sendAccountIdentity } from '../network/client';

// Account state lives outside the 3D scene: signing in, out or editing a profile updates this store
// and the player's name/appearance, and never remounts the world or resets the player's position.

export type AccountStatus = 'unconfigured' | 'loading' | 'guest' | 'signed-in';
interface AccountState {
  status: AccountStatus;
  email: string | null;
  /** The saved profile; null while signed in means the player still needs to create one. */
  profile: MyProfile | null;
  profileState: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  /** Whether the room has verified this account for multiplayer, and why not. */
  room: { bound: boolean; message: string };
  set: (v: Partial<AccountState>) => void;
}
export const useAccount = create<AccountState>(set => ({
  status: communityConfigured ? 'loading' : 'unconfigured', email: null, profile: null, profileState: 'idle', error: '',
  room: { bound: false, message: '' }, set: v => set(v),
}));

const GUEST_KEY = 'campos-guest-identity';
/** What this profile may wear beyond the free choices: earned accents and bought store items. */
export const unlockedBy = (profile: MyProfile | null) => profile ? [...profile.achievements.map(a => a.id), ...(profile.owned ?? [])] : [];
/** Show the saved profile in the world; remember the guest identity so signing out restores it. */
function applyProfile(profile: MyProfile) {
  const game = useGame.getState();
  try { if (!localStorage.getItem(GUEST_KEY)) localStorage.setItem(GUEST_KEY, JSON.stringify({ name: game.name, avatar: game.avatar })); } catch { /* storage unavailable */ }
  game.set({ name: profile.display_name, avatar: sanitizeAvatar(profile.avatar, unlockedBy(profile)) });
}
function restoreGuest() {
  try {
    const saved = JSON.parse(localStorage.getItem(GUEST_KEY) ?? 'null') as { name?: unknown; avatar?: unknown } | null;
    localStorage.removeItem(GUEST_KEY);
    if (saved) useGame.getState().set({ name: typeof saved.name === 'string' ? saved.name.slice(0, 24) : 'New explorer', avatar: sanitizeAvatar(saved.avatar ?? {}) });
  } catch { /* storage unavailable */ }
}
const signedInWithProfile = () => { const s = useAccount.getState(); return s.status === 'signed-in' && !!s.profile; };
async function token(): Promise<string | null> { return signedInWithProfile() ? (await getCommunityService()).accessToken() : null; }
/** Tell the room who we are now (verified account, or guest). */
function syncRoom() {
  const s = useAccount.getState();
  if (signedInWithProfile()) void token().then(t => { if (t) sendAccountIdentity(t); });
  else { const g = useGame.getState(); sendAccountIdentity(null, g.name, g.avatar); if (s.room.bound) s.set({ room: { bound: false, message: '' } }); }
}

async function loadProfile() {
  const service = await getCommunityService();
  useAccount.getState().set({ profileState: 'loading' });
  try {
    const before = useAccount.getState().profile;
    const profile = await service.myProfile();
    useAccount.getState().set({ profile, profileState: 'ready', error: '' });
    // Badges awarded by the database itself (a first friendship, event check-ins) show up on reload.
    if (before && profile && before.id === profile.id) for (const a of profile.achievements) if (!before.achievements.some(b => b.id === a.id) && ACHIEVEMENTS[a.id]) useGame.getState().notify(`Badge earned: ${ACHIEVEMENTS[a.id].name}. Saved to your profile.`);
    if (profile) applyProfile(profile);
    syncRoom();
  } catch (e) {
    const err = toServiceError(e);
    if (err.kind === 'auth') { await endSession('Your session has expired. Please sign in again.'); return; }
    useAccount.getState().set({ profileState: 'error', error: err.message });
  }
}
async function endSession(message = '') {
  useAccount.getState().set({ status: 'guest', email: null, profile: null, profileState: 'idle', error: message, room: { bound: false, message: '' } });
  restoreGuest(); syncRoom();
  if (message) useGame.getState().notify(message);
}

let started = false, lastRetry = 0;
/** Restore any saved session once at start-up (no-op without configuration). */
export async function initAccount() {
  if (started) return; started = true;
  registerAccountBridge({
    access: token,
    verified: signedInWithProfile,
    onAuth: m => {
      const s = useAccount.getState();
      if (m.ok) { s.set({ room: { bound: !!m.account, message: '' } }); return; }
      // The room could not verify us: stay a guest in the room and say why, without signing out
      // (an expired token is refreshed by the client and retried once).
      s.set({ room: { bound: false, message: m.reason ?? 'Playing as a guest in this room.' } });
      // Retry at most once a minute, so a room that cannot verify tokens never causes a loop.
      if (m.code === 'expired' && signedInWithProfile() && Date.now() - lastRetry > 60000 && (lastRetry = Date.now())) void getCommunityService().then(async svc => { try { await svc.myProfile(); syncRoom(); } catch (e) { if (toServiceError(e).kind === 'auth') await endSession('Your session has expired. Please sign in again.'); } });
    },
    onProgress: m => {
      const s = useAccount.getState(); if (!s.profile) return;
      const progress = { ...s.profile.progress }, awarded = (m.awarded ?? []).filter((a): a is AchievementId => a in ACHIEVEMENTS);
      if (m.kind === 'duel') void loadProfile().catch(() => {});
      if (m.kind === 'keepsake' && !progress.keepsakes.includes(m.item)) { progress.keepsakes = [...progress.keepsakes, m.item]; if (!awarded.length) useGame.getState().notify(`Campus keepsake found · ${progress.keepsakes.length} / 6 · saved to your profile`); }
      if (m.kind === 'landmark' && !progress.landmarks.includes(m.item)) progress.landmarks = [...progress.landmarks, m.item];
      const stats = m.kind === 'hoops' ? { ...s.profile.stats, best_hoops_round: Math.max(s.profile.stats.best_hoops_round, m.best ?? 0), hoops_rounds: s.profile.stats.hoops_rounds + 1 } : s.profile.stats;
      const now = new Date().toISOString();
      const achievements = [...s.profile.achievements, ...awarded.filter(a => !s.profile!.achievements.some(x => x.id === a)).map(id => ({ id, awarded_at: now }))];
      s.set({ profile: { ...s.profile, progress, stats, achievements } });
      for (const a of awarded) useGame.getState().notify(`Badge earned: ${ACHIEVEMENTS[a].name}. Saved to your profile.`);
    },
  });
  if (!communityConfigured) return;
  const service = await getCommunityService();
  service.onSessionChange((session, reason) => {
    if (!session) { if (useAccount.getState().status === 'signed-in') void endSession(reason === 'expired' ? 'You were signed out. Sign in again to keep your profile with you.' : ''); return; }
    if (useAccount.getState().status !== 'signed-in') { useAccount.getState().set({ status: 'signed-in', email: session.email, error: '' }); void loadProfile(); }
  });
  try {
    const session = await service.session();
    if (session) { useAccount.getState().set({ status: 'signed-in', email: session.email }); await loadProfile(); }
    else useAccount.getState().set({ status: 'guest' });
  } catch { useAccount.getState().set({ status: 'guest' }); }
}

export async function signIn(email: string, password: string) {
  const service = await getCommunityService();
  const session = await service.signIn(email.trim(), password);
  useAccount.getState().set({ status: 'signed-in', email: session.email, error: '' });
  await loadProfile();
}
/** Returns true when the account needs its email confirmed before signing in. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const service = await getCommunityService();
  const result = await service.signUp(email.trim(), password);
  if (!result.session) return true;
  useAccount.getState().set({ status: 'signed-in', email: result.session.email, profile: null, profileState: 'ready', error: '' });
  return false;
}
export async function signOut() {
  const service = await getCommunityService();
  try { await service.signOut(); } finally { await endSession(); }
}
export async function saveProfile(input: ProfileInput): Promise<MyProfile> {
  const service = await getCommunityService();
  const first = !useAccount.getState().profile;
  const profile = await service.saveProfile(input);
  useAccount.getState().set({ profile, profileState: 'ready' });
  applyProfile(profile);
  // The room re-reads the saved profile (it never takes names from the client for accounts).
  if (first) syncRoom(); else sendAccountIdentity('refresh', profile.display_name, sanitizeAvatar(profile.avatar, unlockedBy(profile)));
  return profile;
}
export function reloadProfile() { return loadProfile(); }
/** Keepsakes shown as collected: the account's verified ones while signed in, otherwise this device's. */
export function useKeepsakes(): string[] {
  const account = useAccount(s => (s.status === 'signed-in' && s.profile ? s.profile.progress.keepsakes : null)), local = useGame(s => s.tokens);
  return account ?? local;
}
export function currentKeepsakes(): string[] { const a = useAccount.getState(); return a.status === 'signed-in' && a.profile ? a.profile.progress.keepsakes : useGame.getState().tokens; }
export async function checkHandle(handle: string) { return (await getCommunityService()).checkHandle(handle); }
export { ServiceError };
export type { AvatarConfig };
