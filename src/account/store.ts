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
  userId: string | null;
  /** The saved profile; null while signed in means the player still needs to create one. */
  profile: MyProfile | null;
  profileState: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  /** Whether the room has verified this account for multiplayer, and why not. */
  room: { bound: boolean; message: string };
  set: (v: Partial<AccountState>) => void;
}
export const useAccount = create<AccountState>(set => ({
  status: communityConfigured ? 'loading' : 'unconfigured', email: null, userId: null, profile: null, profileState: 'idle', error: '',
  room: { bound: false, message: '' }, set: v => set(v),
}));

const GUEST_KEY = 'campos-guest-identity';
const initialGuest = useGame.getState();
let guestIdentity = { name: initialGuest.name, avatar: initialGuest.avatar };
function readGuestIdentity() {
  let raw: string | null;
  try { raw = localStorage.getItem(GUEST_KEY); } catch { return; }
  if (raw === null) return;
  try {
    const saved = JSON.parse(raw) as { name?: unknown; avatar?: unknown } | null;
    if (!saved || typeof saved.name !== 'string' || !saved.name.trim()) throw new Error('Invalid guest identity');
    guestIdentity = { name: saved.name.trim().slice(0, 32), avatar: sanitizeAvatar(saved.avatar ?? {}) };
  } catch { guestIdentity = { name: 'New explorer', avatar: sanitizeAvatar() }; }
}
readGuestIdentity();
// Keep the guest backup current without ever saving an account's appearance as a guest.
// It stays available for every tab: one tab signing out must not delete another tab's backup.
useGame.subscribe((now, before) => {
  if (!['guest', 'unconfigured'].includes(useAccount.getState().status) || now.name === before.name && now.avatar === before.avatar) return;
  guestIdentity = { name: now.name, avatar: now.avatar };
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(guestIdentity)); } catch { /* memory fallback */ }
});
/** What this profile may wear beyond the free choices: earned accents and bought store items. */
export const unlockedBy = (profile: MyProfile | null) => profile ? [...profile.achievements.map(a => a.id), ...(profile.owned ?? [])] : [];
/** Show the saved profile in the world; remember the guest identity so signing out restores it. */
function applyProfile(profile: MyProfile) {
  const game = useGame.getState();
  try { if (!localStorage.getItem(GUEST_KEY)) localStorage.setItem(GUEST_KEY, JSON.stringify(guestIdentity)); } catch { /* storage unavailable */ }
  game.set({ name: profile.display_name, avatar: sanitizeAvatar(profile.avatar, unlockedBy(profile)) });
}
function restoreGuest() {
  readGuestIdentity();
  useGame.getState().set({ name: guestIdentity.name, avatar: sanitizeAvatar(guestIdentity.avatar) });
}
const signedInWithProfile = () => { const s = useAccount.getState(); return s.status === 'signed-in' && !!s.profile && s.profile.id === s.userId; };
let profileRequest = 0;
async function token(): Promise<string | null> { return signedInWithProfile() ? (await getCommunityService()).accessToken() : null; }
/** Tell the room who we are now (verified account, or guest). */
function syncRoom() {
  const s = useAccount.getState();
  const request = profileRequest, email = s.email;
  const current = () => request === profileRequest && signedInWithProfile() && useAccount.getState().email === email;
  if (signedInWithProfile()) void token().then(t => { if (t && current()) sendAccountIdentity(t); }).catch(() => {
    if (current()) useAccount.getState().set({ room: { bound: false, message: 'Your account could not be verified. Reconnect to try again.' } });
  });
  else { const g = useGame.getState(); sendAccountIdentity(null, g.name, g.avatar); if (s.room.bound) s.set({ room: { bound: false, message: '' } }); }
}

async function loadProfile() {
  const request = ++profileRequest, userId = useAccount.getState().userId;
  const current = () => request === profileRequest && useAccount.getState().status === 'signed-in' && useAccount.getState().userId === userId;
  useAccount.getState().set({ profileState: 'loading' });
  try {
    const service = await getCommunityService();
    const before = useAccount.getState().profile;
    const profile = await service.myProfile();
    if (!current()) return;
    if (profile && profile.id !== userId) throw new ServiceError('auth', 'Your account session changed. Please sign in again.');
    useAccount.getState().set({ profile, profileState: 'ready', error: '' });
    // Badges awarded by the database itself (a first friendship, event check-ins) show up on reload.
    if (before && profile && before.id === profile.id) for (const a of profile.achievements) if (!before.achievements.some(b => b.id === a.id) && ACHIEVEMENTS[a.id]) useGame.getState().notify(`Badge earned: ${ACHIEVEMENTS[a.id].name}. Saved to your profile.`);
    if (profile) applyProfile(profile);
    syncRoom();
  } catch (e) {
    if (!current()) return;
    const err = toServiceError(e);
    if (err.kind === 'auth') { await endSession('Your session has expired. Please sign in again.'); return; }
    useAccount.getState().set({ profileState: 'error', error: err.message });
  }
}
async function endSession(message = '') {
  ++profileRequest;
  useAccount.getState().set({ status: 'guest', email: null, userId: null, profile: null, profileState: 'idle', error: message, room: { bound: false, message: '' } });
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
  if (!communityConfigured) { restoreGuest(); return; }
  try {
   const service = await getCommunityService();
   service.onSessionChange((session, reason) => {
    if (!session) {
      void endSession(reason === 'expired' ? 'You were signed out. Sign in again to keep your profile with you.' : '');
      return;
    }
    const state = useAccount.getState();
    if (state.status !== 'signed-in' || state.userId !== session.userId || state.email !== session.email) {
      ++profileRequest;
      if (state.status === 'signed-in' && state.userId !== session.userId) {
        restoreGuest();
        const guest = useGame.getState(); sendAccountIdentity(null, guest.name, guest.avatar);
      }
      state.set({ status: 'signed-in', email: session.email, userId: session.userId, profile: null, profileState: 'idle', error: '', room: { bound: false, message: '' } });
      void loadProfile();
    }
  });
    const request = profileRequest, session = await service.session();
    if (request !== profileRequest) return;
    if (session) { useAccount.getState().set({ status: 'signed-in', email: session.email, userId: session.userId }); await loadProfile(); }
    else await endSession();
  } catch (error) {
    console.warn('Campus account initialization unavailable.', error);
    await endSession('Accounts could not be reached. You can explore as a guest and try sign-in again later.');
  }
}

export async function signIn(email: string, password: string) {
  const service = await getCommunityService();
  const session = await service.signIn(email.trim(), password);
  const previous = useAccount.getState();
  if (previous.userId !== session.userId) {
    ++profileRequest; restoreGuest(); const guest = useGame.getState(); sendAccountIdentity(null, guest.name, guest.avatar);
    previous.set({ profile: null, profileState: 'idle', room: { bound: false, message: '' } });
  }
  useAccount.getState().set({ status: 'signed-in', email: session.email, userId: session.userId, error: '' });
  await loadProfile();
}
/** Returns true when the account needs its email confirmed before signing in. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const service = await getCommunityService();
  const result = await service.signUp(email.trim(), password);
  if (!result.session) return true;
  useAccount.getState().set({ status: 'signed-in', email: result.session.email, userId: result.session.userId, profile: null, profileState: 'ready', error: '' });
  return false;
}
export async function signOut() {
  const service = await getCommunityService();
  try { await service.signOut(); } finally { await endSession(); }
}
export async function saveProfile(input: ProfileInput): Promise<MyProfile> {
  const userId = useAccount.getState().userId;
  const service = await getCommunityService();
  const first = !useAccount.getState().profile;
  const profile = await service.saveProfile(input);
  if (useAccount.getState().status !== 'signed-in' || useAccount.getState().userId !== userId || profile.id !== userId)
    throw new ServiceError('auth', 'Your session changed. Sign in again before editing your profile.');
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
