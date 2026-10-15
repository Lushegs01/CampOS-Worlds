import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthSession, CampusEvent, Club, ClubDetail, ClubFilter, ClubInput, ClubRole, Conversation, DirectMessage, EventDetail, EventFilter, EventInput, FriendState, MessagePage, MyProfile, PlayerResult, ProfileCard, ProfileInput, ReportContext, ReportReason, SocialOverview, SocialSettings, UnreadSummary } from './types';

// The single boundary between the interface and the account/community backend. Components call
// these typed functions; only this file knows that the backend is Supabase (Auth + PostgreSQL via
// RPC functions in supabase/migrations). Swap the implementation here to change provider.

export type ServiceErrorKind = 'not-configured' | 'network' | 'auth' | 'validation' | 'permission' | 'conflict' | 'not-found' | 'limit' | 'unknown';
export class ServiceError extends Error {
  constructor(public kind: ServiceErrorKind, message: string) { super(message); this.name = 'ServiceError'; }
}
export const NOT_CONFIGURED = 'Accounts and community features are not set up for this deployment yet. You can keep exploring as a guest.';

export interface CommunityService {
  readonly configured: boolean;
  session(): Promise<AuthSession | null>;
  /** Called when the session changes outside an explicit sign-in/out (expiry, another tab). */
  onSessionChange(listener: (session: AuthSession | null, reason: 'signed-in' | 'signed-out' | 'expired') => void): () => void;
  accessToken(): Promise<string | null>;
  signUp(email: string, password: string): Promise<{ session: AuthSession | null; needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  myProfile(): Promise<MyProfile | null>;
  checkHandle(handle: string): Promise<{ available: boolean; reason?: string }>;
  saveProfile(input: ProfileInput): Promise<MyProfile>;
  profile(handle: string): Promise<ProfileCard | null>;
  listClubs(filter?: ClubFilter): Promise<Club[]>;
  club(id: string): Promise<ClubDetail | null>;
  createClub(input: ClubInput): Promise<ClubDetail>;
  updateClub(id: string, input: ClubInput): Promise<ClubDetail>;
  deleteClub(id: string): Promise<void>;
  joinClub(id: string, message?: string): Promise<ClubDetail>;
  cancelJoinRequest(id: string): Promise<ClubDetail>;
  respondJoinRequest(club: string, user: string, accept: boolean): Promise<ClubDetail>;
  leaveClub(id: string): Promise<ClubDetail>;
  setMemberRole(club: string, user: string, role: Exclude<ClubRole, 'owner'>): Promise<ClubDetail>;
  removeMember(club: string, user: string): Promise<ClubDetail>;
  listEvents(filter?: EventFilter): Promise<CampusEvent[]>;
  event(id: string): Promise<EventDetail | null>;
  createEvent(club: string, input: EventInput, publish: boolean): Promise<CampusEvent>;
  updateEvent(id: string, input: EventInput): Promise<CampusEvent>;
  setEventStatus(id: string, status: 'published' | 'canceled'): Promise<CampusEvent>;
  deleteEvent(id: string): Promise<void>;
  rsvp(id: string): Promise<CampusEvent>;
  cancelRsvp(id: string): Promise<CampusEvent>;
  // Friends, blocks, privacy and private messages (signed-in players).
  searchPlayers(query: string): Promise<PlayerResult[]>;
  socialOverview(): Promise<SocialOverview>;
  sendFriendRequest(handle: string): Promise<FriendState>;
  respondFriendRequest(request: string, accept: boolean): Promise<FriendState>;
  cancelFriendRequest(user: string): Promise<FriendState>;
  removeFriend(user: string): Promise<FriendState>;
  blockPlayer(user: string): Promise<FriendState>;
  unblockPlayer(user: string): Promise<FriendState>;
  saveSocialSettings(settings: SocialSettings): Promise<SocialSettings>;
  unreadSummary(): Promise<UnreadSummary>;
  listConversations(): Promise<Conversation[]>;
  openConversation(user: string): Promise<Conversation>;
  listMessages(conversation: string, before?: number | null): Promise<MessagePage>;
  sendMessage(conversation: string, body: string, clientId: string): Promise<DirectMessage>;
  markRead(conversation: string, upTo: number): Promise<UnreadSummary>;
  reportPlayer(user: string, reason: ReportReason, context: ReportContext, details?: string, message?: number | null): Promise<void>;
  // Court Duel rankings and history (read-only; results are written by the room server).
  duelLeaderboard(): Promise<unknown>;
  duelHistory(user: string): Promise<unknown[]>;
  challengeBoard(challenge: string): Promise<{ best: (ProfileCard & { best_ms: number; completions: number; rank: number })[]; me: { best_ms: number; completions: number } | null }>;
}

// ---------------------------------------------------------------- error normalisation
type BackendError = { message?: string; code?: string; status?: number; name?: string };
const AUTH_MESSAGES: Record<string, [ServiceErrorKind, string]> = {
  invalid_credentials: ['auth', 'That email and password don’t match an account.'],
  user_already_exists: ['conflict', 'An account with this email already exists. Sign in instead.'],
  email_exists: ['conflict', 'An account with this email already exists. Sign in instead.'],
  email_not_confirmed: ['auth', 'Confirm your email address first, using the link we sent you.'],
  weak_password: ['validation', 'Choose a longer password: at least 8 characters.'],
  validation_failed: ['validation', 'Check the email address.'],
  over_request_rate_limit: ['limit', 'Too many attempts. Please wait a minute and try again.'],
  over_email_send_rate_limit: ['limit', 'Too many emails sent. Please wait a little and try again.'],
  refresh_token_not_found: ['auth', 'Your session has expired. Please sign in again.'],
  session_not_found: ['auth', 'Your session has expired. Please sign in again.'],
};
export function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  const e = (typeof error === 'object' && error !== null ? error : { message: String(error) }) as BackendError;
  const message = e.message ?? 'Something went wrong.';
  if (e.name === 'AuthRetryableFetchError' || /Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED/i.test(message)) return new ServiceError('network', 'Can’t reach the campus service. Check your connection and try again.');
  if (e.code && AUTH_MESSAGES[e.code]) return new ServiceError(...AUTH_MESSAGES[e.code]);
  switch (e.code) {
    case 'PGRST301': case 'PGRST303': return new ServiceError('auth', 'Your session has expired. Please sign in again.');
    case '42501': return new ServiceError('permission', message);
    case '23505': return new ServiceError('conflict', message);
    case '22023': case '23514': case '23503': case '22P02': case '22007': case '22008': return new ServiceError('validation', /invalid input syntax/i.test(message) ? 'Check the values you entered.' : message);
    case '54000': return new ServiceError('limit', message);
    case 'P0002': return new ServiceError('not-found', message);
    case 'PGRST202': return new ServiceError('not-configured', 'The campus database is missing its latest update. Ask the operator to apply the migrations.');
  }
  if (e.status === 429) return new ServiceError('limit', 'Too many requests. Please wait a moment and try again.');
  return new ServiceError('unknown', message);
}

/** Without configuration every call explains that accounts are not set up (never a fake success). */
const unavailable = async (): Promise<never> => { throw new ServiceError('not-configured', NOT_CONFIGURED); };
const unconfigured: CommunityService = {
  configured: false, session: async () => null, onSessionChange: () => () => {}, accessToken: async () => null,
  signUp: unavailable, signIn: unavailable, signOut: unavailable, myProfile: unavailable, checkHandle: unavailable, saveProfile: unavailable, profile: unavailable,
  listClubs: unavailable, club: unavailable, createClub: unavailable, updateClub: unavailable, deleteClub: unavailable, joinClub: unavailable, leaveClub: unavailable, cancelJoinRequest: unavailable, respondJoinRequest: unavailable,
  setMemberRole: unavailable, removeMember: unavailable, listEvents: unavailable, event: unavailable, createEvent: unavailable, updateEvent: unavailable,
  setEventStatus: unavailable, deleteEvent: unavailable, rsvp: unavailable, cancelRsvp: unavailable,
  searchPlayers: unavailable, socialOverview: unavailable, sendFriendRequest: unavailable, respondFriendRequest: unavailable, cancelFriendRequest: unavailable,
  removeFriend: unavailable, blockPlayer: unavailable, unblockPlayer: unavailable, saveSocialSettings: unavailable, unreadSummary: unavailable,
  listConversations: unavailable, openConversation: unavailable, listMessages: unavailable, sendMessage: unavailable, markRead: unavailable, reportPlayer: unavailable,
  duelLeaderboard: unavailable, duelHistory: unavailable, challengeBoard: unavailable,
};

// Responses come from the SQL functions in supabase/migrations; check their top-level shape before
// handing them to the interface, so a mismatched database surfaces as a clear error, not a crash.
type Shape = 'object' | 'array' | 'nullable';
function matches(data: unknown, shape: Shape) {
  if (shape === 'array') return Array.isArray(data);
  if (data === null) return shape === 'nullable';
  return typeof data === 'object' && !Array.isArray(data);
}

// ---------------------------------------------------------------- Supabase implementation
function supabaseService(client: SupabaseClient): CommunityService {
  const toSession = (s: { user: { id: string; email?: string } } | null): AuthSession | null => (s ? { userId: s.user.id, email: s.user.email ?? '' } : null);
  /** Call an RPC function; on an expired token, refresh once and retry. */
  async function call<T>(fn: string, args: Record<string, unknown>, shape: Shape): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let result;
      try { result = await client.rpc(fn, args); } catch (e) { throw toServiceError(e); }
      if (!result.error) {
        if (!matches(result.data, shape)) throw new ServiceError('unknown', 'The campus service sent an unexpected response. Please try again later.');
        return result.data as T;
      }
      if (attempt === 0 && (result.error.code === 'PGRST301' || result.error.code === 'PGRST303')) {
        const refreshed = await client.auth.refreshSession();
        if (!refreshed.error) continue;
      }
      throw toServiceError(result.error);
    }
    throw new ServiceError('auth', 'Your session has expired. Please sign in again.');
  }
  const clubArgs = (input: ClubInput) => ({ p_name: input.name, p_description: input.description, p_category: input.category, p_emblem: input.emblem, p_color: input.color, p_join_policy: input.join_policy });
  const eventArgs = (input: EventInput) => ({ p_title: input.title, p_description: input.description, p_category: input.category, p_location: input.location, p_starts_at: input.starts_at, p_ends_at: input.ends_at, p_capacity: input.capacity, p_template: input.template ?? null });
  let explicit = false;
  return {
    configured: true,
    async session() { const { data } = await client.auth.getSession(); return toSession(data.session); },
    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (explicit) return; // sign-in/out initiated here reports through its own promise
        if (event === 'SIGNED_OUT') listener(null, 'expired');
        else if (event === 'SIGNED_IN') listener(toSession(session), 'signed-in');
      });
      return () => data.subscription.unsubscribe();
    },
    async accessToken() { const { data } = await client.auth.getSession(); return data.session?.access_token ?? null; },
    async signUp(email, password) {
      explicit = true;
      try {
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) throw toServiceError(error);
        return { session: toSession(data.session), needsConfirmation: !data.session };
      } finally { explicit = false; }
    },
    async signIn(email, password) {
      explicit = true;
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw toServiceError(error);
        return toSession(data.session)!;
      } finally { explicit = false; }
    },
    async signOut() {
      explicit = true;
      // Local sign-out always succeeds, even offline; the server session simply expires.
      try { await client.auth.signOut({ scope: 'local' }); } finally { explicit = false; }
    },
    myProfile: () => call<MyProfile | null>('my_profile', {}, 'nullable'),
    checkHandle: handle => call<{ available: boolean; reason?: string }>('check_handle', { p_handle: handle }, 'object'),
    saveProfile: input => call<MyProfile>('save_profile', { p_handle: input.handle, p_display_name: input.display_name, p_bio: input.bio, p_avatar: input.avatar, p_title: input.title, p_interests: input.interests }, 'object'),
    profile: handle => call<ProfileCard | null>('get_profile', { p_handle: handle }, 'nullable'),
    listClubs: (f = {}) => call<Club[]>('list_clubs', { p_search: f.search?.trim() || null, p_category: f.category ?? null, p_mine: !!f.mine, p_limit: f.limit ?? 24, p_offset: f.offset ?? 0 }, 'array'),
    club: id => call<ClubDetail | null>('get_club', { p_id: id }, 'nullable'),
    createClub: input => call<ClubDetail>('create_club', clubArgs(input), 'object'),
    updateClub: (id, input) => call<ClubDetail>('update_club', { p_id: id, ...clubArgs(input) }, 'object'),
    deleteClub: async id => { await call('delete_club', { p_id: id }, 'object'); },
    joinClub: (id, message = '') => call<ClubDetail>('join_club', { p_id: id, p_message: message }, 'object'),
    cancelJoinRequest: id => call<ClubDetail>('cancel_join_request', { p_id: id }, 'object'),
    respondJoinRequest: (club, user, accept) => call<ClubDetail>('respond_join_request', { p_club: club, p_user: user, p_accept: accept }, 'object'),
    leaveClub: id => call<ClubDetail>('leave_club', { p_id: id }, 'object'),
    setMemberRole: (club, user, role) => call<ClubDetail>('set_member_role', { p_club: club, p_user: user, p_role: role }, 'object'),
    removeMember: (club, user) => call<ClubDetail>('remove_member', { p_club: club, p_user: user }, 'object'),
    listEvents: (f = {}) => call<CampusEvent[]>('list_events', { p_when: f.when ?? 'upcoming', p_category: f.category ?? null, p_from: f.from ?? null, p_to: f.to ?? null, p_club: f.club ?? null, p_location: f.location ?? null, p_going: !!f.going, p_limit: f.limit ?? 30, p_offset: f.offset ?? 0 }, 'array'),
    event: id => call<EventDetail | null>('get_event', { p_id: id }, 'nullable'),
    createEvent: (club, input, publish) => call<CampusEvent>('create_event', { p_club: club, ...eventArgs(input), p_publish: publish }, 'object'),
    updateEvent: (id, input) => call<CampusEvent>('update_event', { p_id: id, ...eventArgs(input) }, 'object'),
    setEventStatus: (id, status) => call<CampusEvent>('set_event_status', { p_id: id, p_status: status }, 'object'),
    deleteEvent: async id => { await call('delete_event', { p_id: id }, 'object'); },
    rsvp: id => call<CampusEvent>('rsvp_event', { p_id: id }, 'object'),
    cancelRsvp: id => call<CampusEvent>('cancel_rsvp', { p_id: id }, 'nullable'),
    searchPlayers: query => call<PlayerResult[]>('search_players', { p_query: query, p_limit: 10 }, 'array'),
    socialOverview: () => call<SocialOverview>('social_overview', {}, 'object'),
    sendFriendRequest: handle => call<FriendState>('send_friend_request', { p_handle: handle }, 'object'),
    respondFriendRequest: (request, accept) => call<FriendState>('respond_friend_request', { p_request: request, p_accept: accept }, 'object'),
    cancelFriendRequest: user => call<FriendState>('cancel_friend_request', { p_user: user }, 'object'),
    removeFriend: user => call<FriendState>('remove_friend', { p_user: user }, 'object'),
    blockPlayer: user => call<FriendState>('block_player', { p_user: user }, 'object'),
    unblockPlayer: user => call<FriendState>('unblock_player', { p_user: user }, 'object'),
    saveSocialSettings: v => call<SocialSettings>('save_social_settings', { p_friend_requests: v.friend_requests, p_direct_messages: v.direct_messages, p_party_invites: v.party_invites, p_appear_offline: v.appear_offline, p_profile_visibility: v.profile_visibility, ...(v.room_visits ? { p_room_visits: v.room_visits } : {}) }, 'object'),
    unreadSummary: () => call<UnreadSummary>('unread_summary', {}, 'object'),
    listConversations: () => call<Conversation[]>('list_conversations', { p_limit: 30 }, 'array'),
    openConversation: user => call<Conversation>('open_conversation', { p_user: user }, 'object'),
    listMessages: (conversation, before = null) => call<MessagePage>('list_messages', { p_conversation: conversation, p_before: before, p_limit: 30 }, 'object'),
    sendMessage: (conversation, body, clientId) => call<DirectMessage>('send_direct_message', { p_conversation: conversation, p_body: body, p_client_id: clientId }, 'object'),
    markRead: (conversation, upTo) => call<UnreadSummary>('mark_conversation_read', { p_conversation: conversation, p_up_to: upTo }, 'object'),
    reportPlayer: async (user, reason, context, details = '', message = null) => { await call('report_player', { p_user: user, p_reason: reason, p_context: context, p_details: details, p_message: message }, 'object'); },
    duelLeaderboard: () => call('duel_leaderboard', { p_limit: 50 }, 'object'),
    duelHistory: user => call<unknown[]>('duel_history', { p_user: user, p_limit: 10 }, 'array'),
    challengeBoard: challenge => call('challenge_board', { p_challenge: challenge, p_limit: 5 }, 'object'),
  };
}

// ---------------------------------------------------------------- the configured instance
const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '', key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
export const communityConfigured = !!url && !!key;
let instance: Promise<CommunityService> | null = null;
/** The community service, loading the Supabase client on first use (guests who never sign in skip it). */
export function getCommunityService(): Promise<CommunityService> {
  if (!communityConfigured) return Promise.resolve(unconfigured);
  return instance ??= import('@supabase/supabase-js').then(({ createClient }) => supabaseService(createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'campos-worlds-auth' } })));
}
