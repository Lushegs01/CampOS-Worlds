import { create } from 'zustand';
import { getCommunityService, toServiceError, type CommunityService } from '../services/community';
import type { Conversation, DirectMessage, FriendState, ReportContext, ReportReason, SocialOverview, SocialSettings, UnreadSummary } from '../services/types';
import { useAccount, reloadProfile } from '../account/store';
import { useCommunity } from '../community/store';
import { onRoomMessage, send } from '../network/client';
import { useGame, type Peer } from '../state';

// Friends, private messages and parties, outside the 3D scene.
//
// Friends, requests, blocks, privacy and private messages are persistent and live in the account
// service (Supabase, src/services). Parties are live and belong to the room server. The room also
// relays content-free nudges ("you have something new") between signed-in players; the client then
// re-reads its own inbox through the access-controlled service. Unread counts are polled as well, so
// nothing depends on a nudge arriving.

export type SocialTab = 'friends' | 'requests' | 'messages' | 'party' | 'privacy';
export interface PartyMember { id: string | null; name: string; handle: string | null; verified: boolean; leader: boolean; away: boolean }
export interface PartyView { id: string; max: number; leader: string | null; members: PartyMember[]; invites: { id: string; name: string; expires: number }[] }
export interface PartyInvite { party: string; from: { id: string; name: string; handle: string | null }; size: number; expires: number }
export type ThreadMessage = DirectMessage & { status?: 'sending' | 'failed'; error?: string };
export interface Thread { conversation: Conversation | null; messages: ThreadMessage[]; hasMore: boolean; loading: boolean; error: string }
type Result = { ok: boolean; reason?: string };

interface SocialState {
  open: boolean; tab: SocialTab; conversation: string | null;
  overview: SocialOverview | null; overviewState: 'idle' | 'loading' | 'ready' | 'error'; overviewError: string;
  unread: UnreadSummary;
  conversations: Conversation[] | null; conversationsError: string;
  threads: Record<string, Thread>;
  party: PartyView | null; invites: PartyInvite[];
  /** Guests choose who may invite them for this session (accounts use their privacy settings). */
  guestInvites: 'everyone' | 'nobody';
  /** Friend-request and message notifications on this device. They never show message text. */
  notifications: boolean;
  /** Which live channel the chat panel shows: public room chat or party chat. */
  chatChannel: 'room' | 'party';
}
const PREFS = 'campos-social-prefs';
const savedPrefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { notifications?: boolean }; } catch { return {}; } })();
const EMPTY: UnreadSummary = { requests: 0, messages: 0, conversations: 0 };
export const useSocial = create<SocialState>(() => ({
  open: false, tab: 'friends', conversation: null,
  overview: null, overviewState: 'idle', overviewError: '', unread: EMPTY, conversations: null, conversationsError: '', threads: {},
  party: null, invites: [], guestInvites: 'everyone', notifications: savedPrefs.notifications !== false, chatChannel: 'room',
}));
const set = useSocial.setState, get = useSocial.getState, svc = getCommunityService;
export const isMember = () => { const a = useAccount.getState(); return a.status === 'signed-in' && !!a.profile; };
const notify = (text: string) => useGame.getState().notify(text);
export function setNotifications(on: boolean) { set({ notifications: on }); try { localStorage.setItem(PREFS, JSON.stringify({ notifications: on })); } catch { /* storage unavailable */ } }

// ---------------------------------------------------------------- drawer
export function openSocial(tab?: SocialTab, conversation?: string | null) {
  useCommunity.getState().toggle(false);
  set(s => ({ open: true, tab: tab ?? s.tab, conversation: conversation === undefined ? s.conversation : conversation }));
  if (isMember()) { void refreshOverview(); void refreshUnread(false); if ((tab ?? get().tab) === 'messages') void loadConversations(); }
}
export const closeSocial = () => set({ open: false });
export const toggleSocial = () => (get().open ? closeSocial() : openSocial());

// ---------------------------------------------------------------- friends
let overviewRun = 0;
export async function refreshOverview() {
  if (!isMember()) return;
  const run = ++overviewRun;
  set(s => ({ overviewState: s.overview ? s.overviewState : 'loading' }));
  try { const overview = await (await svc()).socialOverview(); if (run === overviewRun && isMember()) set({ overview, overviewState: 'ready', overviewError: '' }); }
  catch (e) { if (run === overviewRun) set({ overviewState: 'error', overviewError: toServiceError(e).message }); }
}

let unreadRun = 0;
/** Refresh badge counts; with `announce`, say when something new arrived (never its content). */
export async function refreshUnread(announce = true) {
  if (!isMember()) return;
  const run = ++unreadRun;
  let unread: UnreadSummary;
  try { unread = await (await svc()).unreadSummary(); } catch { return; }
  if (run !== unreadRun || !isMember()) return;
  const before = get().unread; set({ unread });
  if (!announce || !get().notifications) return;
  if (unread.requests > before.requests) { await refreshOverview(); const r = get().overview?.incoming[0]; notify(r ? `${r.player.display_name} (@${r.player.handle}) sent you a friend request.` : 'You have a new friend request.'); }
  if (unread.messages > before.messages) {
    await loadConversations();
    const s = get(), c = s.conversations?.find(c => c.unread > 0 && !(s.open && s.conversation === c.id));
    if (c) notify(`New private message from ${c.other.display_name} (@${c.other.handle}).`);
  }
}

/** Run a friend change, then tell the other player's client (via the room) to refresh. */
async function friendAction(fn: (s: CommunityService) => Promise<FriendState>, nudge: boolean) {
  const result = await fn(await svc());
  if (nudge && result.id) send({ type: 'socialNotify', to: result.id, kind: 'friend' });
  // The room re-reads our own friends and blocks too (party-invite permissions, chat blocks).
  send({ type: 'socialRefresh' });
  await refreshOverview(); void refreshUnread(false);
  // A new friendship can award a badge in the database (Good Company): reload to show it.
  if (result.relationship === 'friends') void reloadProfile();
  return result;
}
export const sendFriendRequest = (handle: string) => friendAction(s => s.sendFriendRequest(handle), true);
export const respondFriendRequest = (id: string, accept: boolean) => friendAction(s => s.respondFriendRequest(id, accept), accept);
export const cancelFriendRequest = (user: string) => friendAction(s => s.cancelFriendRequest(user), true);
export const removeFriend = (user: string) => friendAction(s => s.removeFriend(user), true);
// Blocking is silent: the blocked player is not nudged.
export const blockPlayer = (user: string) => friendAction(s => s.blockPlayer(user), false);
export const unblockPlayer = (user: string) => friendAction(s => s.unblockPlayer(user), false);
export async function saveSettings(settings: SocialSettings) {
  const saved = await (await svc()).saveSocialSettings(settings);
  const o = get().overview; if (o) set({ overview: { ...o, settings: saved } });
  send({ type: 'socialRefresh' });
  return saved;
}
export async function reportPlayer(user: string, reason: ReportReason, context: ReportContext, details = '', message: number | null = null) {
  await (await svc()).reportPlayer(user, reason, context, details, message);
}
export function setGuestInvites(value: 'everyone' | 'nobody') { set({ guestInvites: value }); send({ type: 'prefs', partyInvites: value }); }

/** Is this room player a friend, a party member, or neither (for name tags and lists)? */
export function bond(s: Pick<SocialState, 'party' | 'overview'>, id: string, handle?: string | null): 'party' | 'friend' | null {
  if (s.party?.members.some(m => m.id === id)) return 'party';
  if (handle && s.overview?.friends.some(f => f.handle === handle)) return 'friend';
  return null;
}
/** A friend's presence in this room: present (with their handle shown) or not. */
export const presenceOf = (handle: string, peers: Peer[]) => peers.find(p => p.handle === handle) ?? null;

// ---------------------------------------------------------------- private messages
export async function loadConversations() {
  if (!isMember()) return;
  try { set({ conversations: await (await svc()).listConversations(), conversationsError: '' }); }
  catch (e) { set({ conversationsError: toServiceError(e).message }); }
}
const blankThread = (): Thread => ({ conversation: null, messages: [], hasMore: false, loading: false, error: '' });
function patchThread(id: string, patch: Partial<Thread> | ((t: Thread) => Partial<Thread>)) {
  set(s => { const t = s.threads[id] ?? blankThread(); return { threads: { ...s.threads, [id]: { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } } }; });
}
const byId = (a: ThreadMessage, b: ThreadMessage) => (a.id < 0 ? Infinity : a.id) - (b.id < 0 ? Infinity : b.id) || a.created_at.localeCompare(b.created_at);
/** Merge stored messages into a thread: no duplicates, unsent ones stay at the end. */
function merge(current: ThreadMessage[], incoming: DirectMessage[]) {
  const map = new Map<string, ThreadMessage>();
  for (const m of current) map.set(m.client_id + ':' + m.mine, m);
  for (const m of incoming) map.set(m.client_id + ':' + m.mine, m);
  return [...map.values()].sort(byId);
}

/** Start (or find) the conversation with a player and show it. */
export async function startConversation(user: string) {
  const conversation = await (await svc()).openConversation(user);
  patchThread(conversation.id, { conversation });
  openSocial('messages', conversation.id);
  void loadThread(conversation.id);
  return conversation;
}

/** Load the newest page (merging, without gaps) or, with `older`, the page before the oldest shown. */
export async function loadThread(id: string, older = false) {
  const t = get().threads[id] ?? blankThread();
  if (t.loading) return;
  patchThread(id, { loading: true, error: '' });
  try {
    const stored = t.messages.filter(m => !m.status);
    const page = await (await svc()).listMessages(id, older ? stored[0]?.id ?? null : null);
    patchThread(id, cur => {
      const known = cur.messages.filter(m => !m.status);
      // A newest page that does not reach what we already have would leave a gap: start over from it.
      const gap = !older && page.has_more && known.length > 0 && page.messages.length > 0 && page.messages[0].id > known[known.length - 1].id;
      return { conversation: page.conversation, loading: false, error: '',
        messages: gap ? merge(cur.messages.filter(m => m.status), page.messages) : merge(cur.messages, page.messages),
        hasMore: older || gap || !known.length ? page.has_more : cur.hasMore };
    });
    void markRead(id);
  } catch (e) { patchThread(id, { loading: false, error: toServiceError(e).message }); }
}

let readBusy = false;
/** Mark the open conversation read up to its newest message, when it is on screen. */
export async function markRead(id: string) {
  const s = get(), t = s.threads[id];
  if (!s.open || s.tab !== 'messages' || s.conversation !== id || !t?.conversation?.unread || readBusy) return;
  const newest = Math.max(0, ...t.messages.filter(m => !m.status).map(m => m.id));
  readBusy = true;
  try {
    const unread = await (await svc()).markRead(id, newest);
    set(st => ({ unread, conversations: st.conversations?.map(c => (c.id === id ? { ...c, unread: 0 } : c)) ?? null }));
    patchThread(id, cur => ({ conversation: cur.conversation ? { ...cur.conversation, unread: 0 } : null }));
  } catch { /* retried on the next refresh */ } finally { readBusy = false; }
}

/** A v4 UUID, also where crypto.randomUUID is unavailable (plain-http LAN testing on phones). */
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
let tempId = 0;
/**
 * Send a private message. It shows at once as "sending"; a failure keeps it as "failed" with a
 * retry that reuses the same id, so a send that did reach the server is never stored twice.
 */
export async function sendMessage(conversation: string, body: string, retry?: ThreadMessage) {
  const client_id = retry?.client_id ?? uuid(), id = retry?.id ?? -(++tempId);
  const draft: ThreadMessage = { id, conversation_id: conversation, body, mine: true, sender: '', client_id, created_at: new Date().toISOString(), status: 'sending' };
  patchThread(conversation, t => ({ messages: merge(t.messages.filter(m => m.client_id !== client_id), [draft]) }));
  try {
    const stored = await (await svc()).sendMessage(conversation, body, client_id);
    patchThread(conversation, t => ({ messages: merge(t.messages.filter(m => m.client_id !== client_id), [stored]) }));
    const other = get().threads[conversation]?.conversation?.other.id;
    if (other) send({ type: 'socialNotify', to: other, kind: 'message' });
    void loadConversations();
    return true;
  } catch (e) {
    const err = toServiceError(e);
    patchThread(conversation, t => ({ messages: t.messages.map(m => (m.client_id === client_id ? { ...m, status: 'failed', error: err.message } : m)) }));
    if (err.kind === 'permission') void loadThread(conversation);
    return false;
  }
}
export const discardMessage = (conversation: string, client_id: string) => patchThread(conversation, t => ({ messages: t.messages.filter(m => m.client_id !== client_id || !m.status) }));

// ---------------------------------------------------------------- parties (room server)
let ref = 0;
const pending = new Map<number, (r: Result) => void>();
const roomUp = () => useGame.getState().status === 'connected';
function partyAction(action: 'create' | 'invite' | 'respond' | 'leave' | 'kick' | 'promote' | 'uninvite', args: Record<string, unknown> = {}): Promise<Result> {
  if (!roomUp()) return Promise.resolve({ ok: false, reason: 'Parties need the shared room. Reconnect to continue.' });
  const r = ++ref;
  return new Promise(resolve => {
    pending.set(r, resolve);
    if (!send({ type: 'party', action, ref: r, ...args })) { pending.delete(r); resolve({ ok: false, reason: 'Not connected.' }); }
    setTimeout(() => { if (pending.delete(r)) resolve({ ok: false, reason: 'The room did not respond. Try again.' }); }, 4000);
  });
}
/** Party actions report failures as a notice and resolve to whether they worked. */
async function party(action: Parameters<typeof partyAction>[0], args: Record<string, unknown> = {}) {
  const r = await partyAction(action, args);
  if (!r.ok) notify(r.reason ?? 'That didn’t work.');
  return r.ok;
}
export const inviteToParty = (id: string) => party('invite', { id });
export const leaveParty = () => party('leave');
export const kickFromParty = (id: string) => party('kick', { id });
export const promoteInParty = (id: string) => party('promote', { id });
export const withdrawInvite = (id: string) => party('uninvite', { id });
export async function answerInvite(invite: PartyInvite, accept: boolean) {
  set(s => ({ invites: s.invites.filter(i => i.party !== invite.party) }));
  const ok = await party('respond', { party: invite.party, accept });
  if (ok && accept) notify(`You joined ${invite.from.name}’s party.`);
  return ok;
}
export function meetUp(id: string) {
  if (!roomUp()) { notify('Meeting up needs the shared room.'); return; }
  send({ type: 'meetUp', id });
}
/** Put the gold marker on a player and keep it on them as they move. */
export function findPlayer(id: string, name: string) {
  useGame.getState().set({ destination: 'peer:' + id });
  notify(`Follow the gold marker to ${name}.`);
}

// ---------------------------------------------------------------- wiring
let started = false, poll = 0;
function startSession() {
  void refreshOverview(); void refreshUnread(false); void loadConversations();
  clearInterval(poll);
  poll = window.setInterval(() => { if (!document.hidden) void refreshUnread(); }, 20000);
}
function endSession() {
  clearInterval(poll); overviewRun++; unreadRun++;
  set({ overview: null, overviewState: 'idle', overviewError: '', unread: EMPTY, conversations: null, threads: {}, conversation: null, tab: get().tab === 'party' ? 'party' : 'friends' });
}
/** Connect the social layer to the account and the room (once, at start-up). */
export function initSocial() {
  if (started) return; started = true;
  if (isMember()) startSession();
  useAccount.subscribe((now, before) => {
    const was = before.status === 'signed-in' && !!before.profile, is = now.status === 'signed-in' && !!now.profile;
    if (is && (!was || now.profile?.id !== before.profile?.id)) startSession(); else if (!is && was) endSession();
  });
  // One drawer at a time: opening events and clubs closes this one.
  useCommunity.subscribe((now, before) => { if (now.open && !before.open && get().open) closeSocial(); });
  window.addEventListener('focus', () => { if (isMember()) void refreshUnread(); });
  onRoomMessage(m => {
    if (m.type === 'party') {
      set({ party: m.party });
      if (!m.party && get().chatChannel === 'party') set({ chatChannel: 'room' });
    } else if (m.type === 'partyInvite') {
      const invite = m.invite as PartyInvite;
      set(s => ({ invites: [...s.invites.filter(i => i.party !== invite.party), invite].slice(-4) }));
    } else if (m.type === 'partyInviteGone') set(s => ({ invites: s.invites.filter(i => i.party !== m.party) }));
    else if (m.type === 'partyResult') { const done = pending.get(m.ref); pending.delete(m.ref); done?.({ ok: !!m.ok, reason: m.reason }); }
    else if (m.type === 'meetUpResult') { if (!m.ok) notify(m.reason ?? 'You can’t travel there right now.'); }
    else if (m.type === 'social') {
      if (m.kind === 'friend') { void refreshOverview().then(() => { if (isMember()) void reloadProfile(); }); void refreshUnread(); }
      else { void refreshUnread(); void loadConversations(); const open = get().conversation; if (open && get().open) void loadThread(open); }
    } else if (m.type === 'welcome') { if (!isMember() && get().guestInvites !== 'everyone') send({ type: 'prefs', partyInvites: get().guestInvites }); }
    else if (m.type === 'disconnected') { set({ party: null, invites: [] }); for (const done of pending.values()) done({ ok: false, reason: 'Disconnected.' }); pending.clear(); }
  });
  // Invitations expire on the server; drop them here when their time is up even if the notice is lost.
  setInterval(() => { const t = Date.now(), s = get(); if (s.invites.some(i => i.expires <= t)) set({ invites: s.invites.filter(i => i.expires > t) }); }, 1000);
}
