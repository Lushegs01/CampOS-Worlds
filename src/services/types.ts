import type { AvatarConfig } from '../state';

// Shapes returned by the database functions in supabase/migrations (snake_case kept as stored).

export type AchievementId = 'campus-compass' | 'curious-mind' | 'courtside';
export const ACHIEVEMENTS: Record<AchievementId, { name: string; text: string }> = {
  'campus-compass': { name: 'Campus compass', text: 'Visited all five tour stops' },
  'curious-mind': { name: 'Curious mind', text: 'Found all six campus keepsakes' },
  courtside: { name: 'Courtside', text: 'Scored 6 points in one round of five' },
};

export interface ProfileBrief { id: string; handle: string; display_name: string; avatar: Partial<AvatarConfig> }
export type ClubRole = 'owner' | 'organizer' | 'member';
export interface ProfileCard extends ProfileBrief {
  bio: string;
  created_at: string;
  achievements: { id: AchievementId; awarded_at: string }[];
  stats: { best_hoops_round: number; hoops_rounds: number; baskets: number };
  clubs?: { id: string; name: string; color: string; emblem: ClubEmblem; role: ClubRole }[];
}
export interface MyProfile extends ProfileCard { progress: { keepsakes: string[]; landmarks: string[] } }
export interface ProfileInput { handle: string; display_name: string; bio: string; avatar: AvatarConfig }

export const CLUB_CATEGORIES = ['academic', 'arts', 'culture', 'community', 'sports', 'technology', 'wellbeing'] as const;
export type ClubCategory = typeof CLUB_CATEGORIES[number];
export const CLUB_EMBLEMS = ['spark', 'book', 'music', 'code', 'ball', 'leaf', 'camera', 'globe', 'heart', 'palette'] as const;
export type ClubEmblem = typeof CLUB_EMBLEMS[number];
export const CLUB_COLORS = ['#2f4b40', '#506b96', '#b05f49', '#7a4f9a', '#c9a24a', '#3f7f8c', '#9b5b2a', '#41324a'] as const;

export interface Club {
  id: string; name: string; description: string; category: ClubCategory; emblem: ClubEmblem; color: string; created_at: string;
  owner: ProfileBrief | null; member_count: number; upcoming_count: number; my_role: ClubRole | null;
}
export interface ClubDetail extends Club { members: (ProfileBrief & { role: ClubRole; joined_at: string })[]; events: CampusEvent[] }
export interface ClubInput { name: string; description: string; category: ClubCategory; emblem: ClubEmblem; color: string }
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
}
export interface EventDetail extends CampusEvent { attendees: ProfileBrief[] }
export interface EventInput { title: string; description: string; category: EventCategory; location: string; starts_at: string; ends_at: string; capacity: number | null }
export type EventWhen = 'upcoming' | 'past' | 'all';
export interface EventFilter { when?: EventWhen; category?: EventCategory | null; from?: string | null; to?: string | null; club?: string | null; location?: string | null; going?: boolean; limit?: number; offset?: number }

export interface AuthSession { userId: string; email: string }
