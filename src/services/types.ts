import type { AvatarConfig } from '../state';
import { ACHIEVEMENTS as CATALOG } from '../../shared/achievements.mjs';

// Shapes returned by the database functions in supabase/migrations (snake_case kept as stored).

// The achievement catalogue is shared with the room server and mirrored in the database.
export type AchievementId = typeof CATALOG[number]['id'];
export interface AchievementInfo { id: string; name: string; text: string; category: string; title: string; accent?: string }
export const ACHIEVEMENTS: Record<string, AchievementInfo> = Object.fromEntries(CATALOG.map(a => [a.id, { id: a.id, name: a.name, text: a.rule, category: a.category, title: a.title, accent: (a as { accent?: string }).accent }]));

export interface ProfileBrief { id: string; handle: string; display_name: string; avatar: Partial<AvatarConfig>; title?: string | null }
/** How the signed-in viewer relates to another player (null when not signed in). */
export type Relationship = 'self' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'none';
export type ClubRole = 'owner' | 'organizer' | 'member';
export interface ProfileCard extends ProfileBrief {
  bio: string;
  created_at: string;
  achievements: { id: AchievementId; awarded_at: string }[];
  stats: { best_hoops_round: number; hoops_rounds: number; baskets: number };
  duel?: { rating: number; rated_matches: number; matches: number; wins: number; losses: number; draws: number; best_score: number } | null;
  clubs?: { id: string; name: string; color: string; emblem: ClubEmblem; role: ClubRole }[];
  relationship?: Relationship | null;
  interests?: string[];
  /** True when the owner shows their bio and interests to friends only and the viewer is not one. */
  limited?: boolean;
  challenges?: { id: string; best_ms: number; completions: number }[];
  events_attended?: number;
}
export interface MyProfile extends ProfileCard { progress: { keepsakes: string[]; landmarks: string[] } }
export interface ProfileInput { handle: string; display_name: string; bio: string; avatar: AvatarConfig; title: string | null; interests: string[] }

export const CLUB_CATEGORIES = ['academic', 'arts', 'culture', 'community', 'sports', 'technology', 'wellbeing'] as const;
export type ClubCategory = typeof CLUB_CATEGORIES[number];
export const CLUB_EMBLEMS = ['spark', 'book', 'music', 'code', 'ball', 'leaf', 'camera', 'globe', 'heart', 'palette'] as const;
export type ClubEmblem = typeof CLUB_EMBLEMS[number];
export const CLUB_COLORS = ['#2f4b40', '#506b96', '#b05f49', '#7a4f9a', '#c9a24a', '#3f7f8c', '#9b5b2a', '#41324a'] as const;

export interface Club {
  id: string; name: string; description: string; category: ClubCategory; emblem: ClubEmblem; color: string; created_at: string;
  owner: ProfileBrief | null; member_count: number; upcoming_count: number; my_role: ClubRole | null;
  /** 'open': join at once; 'request': the owner or organizers approve each new member. */
  join_policy?: 'open' | 'request'; my_request?: boolean; pending_requests?: number | null;
}
export interface ClubDetail extends Club { members: (ProfileBrief & { role: ClubRole; joined_at: string })[]; events: CampusEvent[]; requests?: (ProfileBrief & { message: string; created_at: string })[] }
export interface ClubInput { name: string; description: string; category: ClubCategory; emblem: ClubEmblem; color: string; join_policy: 'open' | 'request' }
export interface ClubFilter { search?: string; category?: ClubCategory | null; mine?: boolean; limit?: number; offset?: number }

export const EVENT_CATEGORIES = ['social', 'academic', 'sports', 'arts', 'career', 'wellbeing', 'club'] as const;
export type EventCategory = typeof EVENT_CATEGORIES[number];
export type EventStatus = 'draft' | 'published' | 'canceled';
export interface CampusEvent {
  id: string; title: string; description: string; category: EventCategory;
  starts_at: string; ends_at: string; capacity: number | null; status: EventStatus;
  published_at: string | null; canceled_at: string | null;
  location: { id: string; name: string };
  club: { id: string; name: string; color: string; emblem: ClubEmblem };
  organizer: ProfileBrief | null;
  attendee_count: number; going: boolean; can_manage: boolean;
  template?: EventTemplateId | null;
  /** In-game attendance (checked in at the place while it was on). Never academic attendance. */
  checked_in_count?: number; checked_in?: boolean;
}
export interface EventDetail extends CampusEvent { attendees: ProfileBrief[]; checked_in_players?: ProfileBrief[] }
export type EventTemplateId = 'basketball-tournament' | 'scavenger-hunt' | 'club-meetup' | 'discovery-challenge' | 'campus-festival' | 'study-group';
export interface EventInput { title: string; description: string; category: EventCategory; location: string; starts_at: string; ends_at: string; capacity: number | null; template?: EventTemplateId | null }
export type EventWhen = 'upcoming' | 'past' | 'all';
export interface EventFilter { when?: EventWhen; category?: EventCategory | null; from?: string | null; to?: string | null; club?: string | null; location?: string | null; going?: boolean; limit?: number; offset?: number }

export interface AuthSession { userId: string; email: string }

// ---------------------------------------------------------------- social (supabase/migrations/20261014090000_social.sql)
export interface SocialSettings { friend_requests: 'everyone' | 'nobody'; direct_messages: 'friends' | 'nobody'; party_invites: 'everyone' | 'friends' | 'nobody'; appear_offline: boolean; profile_visibility: 'public' | 'friends'; /** Who may visit your room in Palm House (docs/DORM-ROOMS.md). */ room_visits?: 'invite' | 'friends' }
export interface PlayerResult extends ProfileBrief { relationship: Relationship }
export interface FriendRequest { id: string; player: ProfileBrief; created_at: string }
export interface SocialOverview {
  friends: (ProfileBrief & { since: string })[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: (ProfileBrief & { since: string })[];
  settings: SocialSettings;
}
export interface FriendState extends Partial<ProfileBrief> { id: string; relationship: Relationship; accepted?: boolean }
export interface DirectMessage { id: number; conversation_id: string; body: string; mine: boolean; sender: string; client_id: string; created_at: string; duplicate?: boolean }
export interface Conversation {
  id: string; other: ProfileBrief; last_message_at: string | null;
  last_message: { id: number; preview: string; mine: boolean; created_at: string } | null;
  unread: number; block_reason: string | null;
}
export interface MessagePage { conversation: Conversation; messages: DirectMessage[]; has_more: boolean }
export interface UnreadSummary { requests: number; messages: number; conversations: number }
export const REPORT_REASONS = { harassment: 'Harassment or bullying', spam: 'Spam', impersonation: 'Pretending to be someone else', inappropriate: 'Inappropriate content', other: 'Something else' } as const;
export type ReportReason = keyof typeof REPORT_REASONS;
export type ReportContext = 'profile' | 'direct-message' | 'room-chat' | 'party' | 'club' | 'event';
