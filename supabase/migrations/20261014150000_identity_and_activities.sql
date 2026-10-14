-- CampOS Worlds · titles, earned cosmetics, profile privacy, in-game event check-in and challenges.
--
-- * Titles: a player may show the title of one achievement they have earned under their name.
-- * Earned accents: some avatar accent colours unlock with an achievement (achievement_catalog.accent).
--   save_profile() refuses a locked colour, and the room server re-checks it.
-- * Interests: up to five from a fixed list (shared/profile.mjs).
-- * Profile visibility: "friends" shows the bio and interests to friends only. Bio and interests are
--   no longer readable by direct table access at all (column privileges); badges, game records and
--   club memberships stay public, because rankings and club pages show them.
-- * Event check-in: attendance at an event INSIDE THE GAME, recorded by the room server when a
--   signed-in player is at the event's campus location while it is on. It is gameplay attendance
--   only and never academic or official attendance.
-- * Challenges: completion times recorded by the room server, which timed the run itself.

-- ---------------------------------------------------------------- titles, interests, accents, visibility
alter table public.profiles add column title text references public.achievement_catalog (id);
alter table public.profiles add column interests text[] not null default '{}';
alter table public.profiles add constraint profiles_interests check (cardinality(interests) <= 5 and interests <@ array['basketball','music','art','design','technology','reading','film','photography','gaming','fitness','cooking','volunteering','debate','dance','fashion','entrepreneurship']::text[]);
alter table public.player_settings add column profile_visibility text not null default 'public';
alter table public.player_settings add constraint player_settings_profile_visibility check (profile_visibility in ('public', 'friends'));
update public.achievement_catalog set rule = 'Drive the Campus Loop: pass every district’s shuttle stop in order as the driver, in under 12 minutes.' where id = 'road-tripper';

-- Any accent the game knows, base or earned (whether this player has earned it is checked separately).
create or replace function public.valid_avatar(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(a) = 'object'
    and not exists (select 1 from jsonb_object_keys(a) k where k not in ('model', 'skin', 'accent', 'accessory'))
    and coalesce(a ->> 'model', 'tunde') in ('tunde', 'amara', 'chidi', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada')
    and coalesce(a ->> 'skin', 'natural') in ('natural', '#3a2219', '#5b3424', '#7a4a31', '#a66b46', '#cb9168')
    and coalesce(a ->> 'accent', '#353c4c') in ('#353c4c', '#537d70', '#b05f49', '#506b96', '#e8b95e', '#eee9df', '#3f7f8c', '#c9a24a', '#7a4f9a', '#9b5b2a')
    and coalesce(a ->> 'accessory', 'backpack') in ('none', 'backpack', 'headphones', 'glasses')
$$;

-- Bio and interests are read only through get_profile(), which applies the owner's visibility.
revoke select on public.profiles from anon, authenticated;
grant select (id, handle, display_name, avatar, title, created_at) on public.profiles to anon, authenticated;
grant insert (id, handle, display_name, bio, avatar, title, interests) on public.profiles to authenticated;
grant update (handle, display_name, bio, avatar, title, interests) on public.profiles to authenticated;

create or replace function public.profile_brief(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'avatar', p.avatar, 'title', p.title)
  from public.profiles p where p.id = p_id
$$;

drop function public.save_profile(text, text, text, jsonb);
create or replace function public.save_profile(p_handle text, p_display_name text, p_bio text default '', p_avatar jsonb default '{}'::jsonb, p_title text default null, p_interests jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  h text := lower(btrim(coalesce(p_handle, '')));
  n text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  b text := btrim(coalesce(p_bio, ''));
  check_result jsonb;
  locked text;
  wanted text[];
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in to save your profile.'; end if;
  check_result := public.check_handle(h);
  if not (check_result ->> 'available')::boolean then raise exception using errcode = '22023', message = check_result ->> 'reason'; end if;
  if char_length(n) not between 1 and 32 or n ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'Display names are 1–32 characters.'; end if;
  if char_length(b) > 280 or b ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then raise exception using errcode = '22023', message = 'Bios are up to 280 characters.'; end if;
  if p_avatar is null or not public.valid_avatar(p_avatar) then raise exception using errcode = '22023', message = 'That appearance is not available.'; end if;
  -- Earned accents need their achievement; titles must be earned.
  select c.name into locked from public.achievement_catalog c where c.accent = p_avatar ->> 'accent' and not public.has_achievement(uid, c.id);
  if locked is not null then raise exception using errcode = '42501', message = format('That colour unlocks with the %s badge.', locked); end if;
  if p_title is not null and not public.has_achievement(uid, p_title) then raise exception using errcode = '42501', message = 'You can show a title once you have earned its badge.'; end if;
  if p_interests is not null and jsonb_typeof(p_interests) <> 'array' then raise exception using errcode = '22023', message = 'Choose up to five interests from the list.'; end if;
  wanted := coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_interests, '[]'::jsonb))), '{}');
  if cardinality(wanted) > 5 or not wanted <@ array['basketball','music','art','design','technology','reading','film','photography','gaming','fitness','cooking','volunteering','debate','dance','fashion','entrepreneurship']::text[] then
    raise exception using errcode = '22023', message = 'Choose up to five interests from the list.';
  end if;
  wanted := (select coalesce(array_agg(distinct i order by i), '{}') from unnest(wanted) i);
  -- Values come from the variables, not `excluded`: reading excluded.bio would need SELECT on bio,
  -- which players deliberately do not have.
  insert into public.profiles (id, handle, display_name, bio, avatar, title, interests) values (uid, h, n, b, p_avatar, p_title, wanted)
  on conflict (id) do update set handle = h, display_name = n, bio = b, avatar = p_avatar, title = p_title, interests = wanted;
  return public.my_profile();
exception when unique_violation then
  raise exception using errcode = '23505', message = 'That handle is taken. Try another.';
end $$;

create or replace function public.has_achievement(p_user uuid, p_achievement text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.achievements where user_id = p_user and achievement = p_achievement)
$$;

-- Enforced on the table itself, so no write path (save_profile, a direct update) can show an
-- unearned title or wear an unearned accent.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare locked text;
begin
  if new.title is not null and (tg_op = 'INSERT' or new.title is distinct from old.title) and not public.has_achievement(new.id, new.title) then
    raise exception using errcode = '42501', message = 'You can show a title once you have earned its badge.';
  end if;
  if tg_op = 'INSERT' or new.avatar ->> 'accent' is distinct from old.avatar ->> 'accent' then
    select c.name into locked from public.achievement_catalog c where c.accent = new.avatar ->> 'accent' and not public.has_achievement(new.id, c.id);
    if locked is not null then raise exception using errcode = '42501', message = format('That colour unlocks with the %s badge.', locked); end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before insert or update on public.profiles for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------- events: templates and in-game check-in
alter table public.events add column template text;
alter table public.events add constraint events_template check (template is null or template in ('basketball-tournament', 'scavenger-hunt', 'club-meetup', 'discovery-challenge', 'campus-festival', 'study-group'));

create table public.event_checkins (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_checkins_user_idx on public.event_checkins (user_id, checked_in_at desc);
alter table public.event_checkins enable row level security;
create policy "Check-ins at visible events are public" on public.event_checkins for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.status <> 'draft'));
revoke all on public.event_checkins from anon, authenticated;
grant select on public.event_checkins to anon, authenticated;

create or replace function public.event_json(e public.events) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description, 'category', e.category, 'template', e.template,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'capacity', e.capacity, 'status', e.status,
    'published_at', e.published_at, 'canceled_at', e.canceled_at,
    'location', jsonb_build_object('id', l.id, 'name', l.name),
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'emblem', c.emblem),
    'organizer', public.profile_brief(e.created_by),
    'attendee_count', (select count(*) from public.event_rsvps r where r.event_id = e.id),
    'going', exists (select 1 from public.event_rsvps r where r.event_id = e.id and r.user_id = auth.uid()),
    'checked_in_count', (select count(*) from public.event_checkins k where k.event_id = e.id),
    'checked_in', exists (select 1 from public.event_checkins k where k.event_id = e.id and k.user_id = auth.uid()),
    'can_manage', public.can_manage_events(e.club_id))
  from public.campus_locations l, public.clubs c
  where l.id = e.location_id and c.id = e.club_id
$$;

create or replace function public.get_event(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select public.event_json(e) || jsonb_build_object(
    'attendees', coalesce((select jsonb_agg(public.profile_brief(r.user_id) order by r.created_at)
      from (select * from public.event_rsvps where event_id = e.id order by created_at limit 60) r), '[]'::jsonb),
    'checked_in_players', coalesce((select jsonb_agg(public.profile_brief(k.user_id) order by k.checked_in_at)
      from (select * from public.event_checkins where event_id = e.id order by checked_in_at limit 60) k), '[]'::jsonb))
  from public.events e where e.id = p_id
$$;

drop function public.create_event(uuid, text, text, text, text, timestamptz, timestamptz, integer, boolean);
create or replace function public.create_event(p_club uuid, p_title text, p_description text, p_category text, p_location text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_capacity integer default null, p_publish boolean default false, p_template text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in to organize events.'; end if;
  if not public.can_manage_events(p_club) then raise exception using errcode = '42501', message = 'Only the club''s owner and organizers can create its events.'; end if;
  if (select count(*) from public.events where created_by = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception using errcode = '54000', message = 'You have created ten events today. Please try again tomorrow.';
  end if;
  perform public.validate_event_times(p_starts_at, p_ends_at);
  insert into public.events (club_id, created_by, title, description, category, location_id, starts_at, ends_at, capacity, status, template)
  values (p_club, uid, btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), btrim(coalesce(p_description, '')), p_category, p_location, p_starts_at, p_ends_at, p_capacity, 'draft', p_template)
  returning id into new_id;
  if coalesce(p_publish, false) then update public.events set status = 'published' where id = new_id; end if;
  return (select public.event_json(e) from public.events e where e.id = new_id);
exception
  when foreign_key_violation then raise exception using errcode = '23503', message = 'Choose a campus location from the list.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the title (3–80 characters), description (up to 1,000), category, template and capacity (1–500).';
end $$;

drop function public.update_event(uuid, text, text, text, text, timestamptz, timestamptz, integer);
create or replace function public.update_event(p_id uuid, p_title text, p_description text, p_category text, p_location text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_capacity integer default null, p_template text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev public.events;
  going integer;
begin
  select * into ev from public.events where id = p_id for update;
  if not found or not public.can_manage_events(ev.club_id) then raise exception using errcode = '42501', message = 'Only the club''s owner and organizers can edit this event.'; end if;
  if ev.status = 'canceled' then raise exception using errcode = '22023', message = 'Canceled events cannot be changed.'; end if;
  if p_starts_at is distinct from ev.starts_at or p_ends_at is distinct from ev.ends_at then perform public.validate_event_times(p_starts_at, p_ends_at); end if;
  select count(*) into going from public.event_rsvps where event_id = p_id;
  if p_capacity is not null and p_capacity < going then
    raise exception using errcode = '22023', message = format('%s people are already going, so the limit cannot be lower than that.', going);
  end if;
  update public.events set title = btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), description = btrim(coalesce(p_description, '')),
    category = p_category, location_id = p_location, starts_at = p_starts_at, ends_at = p_ends_at, capacity = p_capacity, template = p_template
  where id = p_id;
  return (select public.event_json(e) from public.events e where e.id = p_id);
exception
  when foreign_key_violation then raise exception using errcode = '23503', message = 'Choose a campus location from the list.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the title (3–80 characters), description (up to 1,000), category, template and capacity (1–500).';
end $$;

-- Room server only: the player is at `p_location` (checked by the room against its own positions).
-- Check-in opens 15 minutes before the start and closes at the end. Idempotent.
create or replace function public.record_event_checkin(p_user uuid, p_event uuid, p_location text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev public.events;
  n integer;
  awarded text[] := '{}';
  organizer_awarded boolean := false;
begin
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('checked_in', false, 'reason', 'Create your profile to check in.'); end if;
  select * into ev from public.events where id = p_event;
  if not found or ev.status = 'draft' then raise exception using errcode = 'P0002', message = 'That event is not available.'; end if;
  if ev.status = 'canceled' then raise exception using errcode = '22023', message = 'This event has been canceled.'; end if;
  if ev.location_id <> p_location then raise exception using errcode = '22023', message = 'This event is at another campus location.'; end if;
  if now() < ev.starts_at - interval '15 minutes' then raise exception using errcode = '22023', message = 'Check-in opens 15 minutes before the event starts.'; end if;
  if now() > ev.ends_at then raise exception using errcode = '22023', message = 'This event has ended.'; end if;
  insert into public.event_checkins (event_id, user_id) values (p_event, p_user) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    if (select count(*) from public.event_checkins where user_id = p_user) >= 3 and public.award(p_user, 'regular') then awarded := array_append(awarded, 'regular'); end if;
    if ev.created_by is not null and ev.created_by <> p_user
       and (select count(*) from public.event_checkins where event_id = p_event and user_id <> ev.created_by) >= 3 then
      organizer_awarded := public.award(ev.created_by, 'community-builder');
    end if;
  end if;
  return jsonb_build_object('checked_in', true, 'new', n > 0, 'awarded', to_jsonb(awarded), 'event', ev.title,
    'organizer', case when organizer_awarded then ev.created_by end);
end $$;

-- ---------------------------------------------------------------- challenges
create table public.challenge_results (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge text not null,
  best_ms integer not null,
  completions integer not null default 1,
  first_completed_at timestamptz not null default now(),
  last_completed_at timestamptz not null default now(),
  primary key (user_id, challenge),
  constraint challenge_results_challenge check (challenge in ('courtyard-circuit', 'campus-loop')),
  constraint challenge_results_time check (best_ms > 0 and completions > 0)
);
create index challenge_results_board_idx on public.challenge_results (challenge, best_ms);
-- Every completed run once, by the id the room gave it, so a retried report never counts twice.
create table public.challenge_runs (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge text not null,
  ms integer not null,
  recorded_at timestamptz not null default now()
);
create index challenge_runs_user_idx on public.challenge_runs (user_id, recorded_at desc);
alter table public.challenge_runs enable row level security;
revoke all on public.challenge_runs from anon, authenticated;
alter table public.challenge_results enable row level security;
create policy "Challenge results are public" on public.challenge_results for select to anon, authenticated using (true);
revoke all on public.challenge_results from anon, authenticated;
grant select on public.challenge_results to anon, authenticated;

-- Room server only. Limits mirror shared/challenges.mjs: a time outside [minimum, limit] is invalid.
create or replace function public.record_challenge(p_user uuid, p_challenge text, p_ms integer, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  lim int[];
  prior integer;
  awarded text[] := '{}';
begin
  lim := case p_challenge when 'courtyard-circuit' then array[20000, 180000] when 'campus-loop' then array[120000, 720000] end;
  if lim is null then raise exception using errcode = '22023', message = 'Unknown challenge.'; end if;
  if p_ms is null or p_ms < lim[1] or p_ms > lim[2] then raise exception using errcode = '22023', message = 'Invalid challenge time.'; end if;
  if p_run is null then raise exception using errcode = '22023', message = 'Missing run id.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('recorded', false); end if;
  insert into public.challenge_runs (id, user_id, challenge, ms) values (p_run, p_user, p_challenge, p_ms) on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('recorded', false, 'duplicate', true, 'best_ms', (select best_ms from public.challenge_results where user_id = p_user and challenge = p_challenge), 'awarded', '[]'::jsonb);
  end if;
  select best_ms into prior from public.challenge_results where user_id = p_user and challenge = p_challenge for update;
  insert into public.challenge_results (user_id, challenge, best_ms) values (p_user, p_challenge, p_ms)
  on conflict (user_id, challenge) do update set best_ms = least(public.challenge_results.best_ms, excluded.best_ms), completions = public.challenge_results.completions + 1, last_completed_at = now();
  if p_challenge = 'campus-loop' and public.award(p_user, 'road-tripper') then awarded := array_append(awarded, 'road-tripper'); end if;
  return jsonb_build_object('recorded', true, 'best_ms', least(coalesce(prior, p_ms), p_ms), 'personal_best', prior is null or p_ms < prior, 'awarded', to_jsonb(awarded));
end $$;

create or replace function public.challenge_board(p_challenge text, p_limit integer default 10) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'best', coalesce((select jsonb_agg(row_json order by best_ms, first_completed_at) from (
      select public.profile_brief(r.user_id) || jsonb_build_object('best_ms', r.best_ms, 'completions', r.completions, 'rank', rank() over (order by r.best_ms)) as row_json, r.best_ms, r.first_completed_at
      from public.challenge_results r where r.challenge = p_challenge order by r.best_ms, r.first_completed_at limit least(greatest(coalesce(p_limit, 10), 1), 50)) t), '[]'::jsonb),
    'me', (select jsonb_build_object('best_ms', best_ms, 'completions', completions) from public.challenge_results where challenge = p_challenge and user_id = auth.uid()))
$$;

-- Room-validated social achievement (time in a party of three or more, measured by the room).
create or replace function public.record_room_achievement(p_user uuid, p_achievement text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_achievement not in ('better-together') then raise exception using errcode = '22023', message = 'Not a room achievement.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('awarded', '[]'::jsonb); end if;
  return jsonb_build_object('awarded', case when public.award(p_user, p_achievement) then jsonb_build_array(p_achievement) else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------- profiles with visibility
create or replace function public.get_profile(p_handle text default null, p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  viewer uuid := auth.uid();
  open_to_viewer boolean;
begin
  select * into p from public.profiles where (p_id is not null and id = p_id) or (p_id is null and handle = lower(btrim(p_handle))) limit 1;
  if not found then return null; end if;
  open_to_viewer := coalesce(viewer = p.id, false) or coalesce((select profile_visibility from public.player_settings where user_id = p.id), 'public') = 'public' or public.are_friends(viewer, p.id);
  return jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'avatar', p.avatar, 'title', p.title, 'created_at', p.created_at,
    'bio', case when open_to_viewer then p.bio else '' end, 'interests', case when open_to_viewer then to_jsonb(p.interests) else '[]'::jsonb end,
    'limited', not open_to_viewer,
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.achievement, 'awarded_at', a.awarded_at) order by a.awarded_at) from public.achievements a where a.user_id = p.id), '[]'::jsonb),
    'stats', coalesce((select jsonb_build_object('best_hoops_round', s.best_hoops_round, 'hoops_rounds', s.hoops_rounds, 'baskets', s.baskets) from public.player_stats s where s.user_id = p.id), jsonb_build_object('best_hoops_round', 0, 'hoops_rounds', 0, 'baskets', 0)),
    'duel', (select jsonb_build_object('rating', r.rating, 'rated_matches', r.rated_matches, 'matches', r.matches, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws, 'best_score', r.best_score) from public.duel_ratings r where r.user_id = p.id),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', c.challenge, 'best_ms', c.best_ms, 'completions', c.completions) order by c.challenge) from public.challenge_results c where c.user_id = p.id), '[]'::jsonb),
    'events_attended', (select count(*) from public.event_checkins k where k.user_id = p.id),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'emblem', c.emblem, 'role', m.role) order by m.joined_at)
                       from (select * from public.club_members where user_id = p.id order by joined_at limit 30) m join public.clubs c on c.id = m.club_id), '[]'::jsonb),
    'relationship', public.relationship(viewer, p.id));
end $$;

create or replace function public.settings_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('friend_requests', s.friend_requests, 'direct_messages', s.direct_messages, 'party_invites', s.party_invites, 'appear_offline', s.appear_offline, 'profile_visibility', s.profile_visibility)
  from public.player_settings s where s.user_id = p_user
$$;
drop function public.save_social_settings(text, text, text, boolean);
create or replace function public.save_social_settings(p_friend_requests text, p_direct_messages text, p_party_invites text, p_appear_offline boolean, p_profile_visibility text default 'public') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'change privacy settings');
  if p_friend_requests not in ('everyone', 'nobody') or p_direct_messages not in ('friends', 'nobody') or p_party_invites not in ('everyone', 'friends', 'nobody') or p_appear_offline is null or p_profile_visibility not in ('public', 'friends') then
    raise exception using errcode = '22023', message = 'Choose one of the listed privacy options.';
  end if;
  update public.player_settings set friend_requests = p_friend_requests, direct_messages = p_direct_messages, party_invites = p_party_invites, appear_offline = p_appear_offline, profile_visibility = p_profile_visibility
  where user_id = uid;
  return public.settings_json(uid);
end $$;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.profiles_guard(), public.valid_avatar(jsonb), public.profile_brief(uuid), public.save_profile(text, text, text, jsonb, text, jsonb), public.has_achievement(uuid, text),
  public.event_json(public.events), public.get_event(uuid), public.create_event(uuid, text, text, text, text, timestamptz, timestamptz, integer, boolean, text),
  public.update_event(uuid, text, text, text, text, timestamptz, timestamptz, integer, text), public.record_event_checkin(uuid, uuid, text),
  public.record_challenge(uuid, text, integer, uuid), public.challenge_board(text, integer), public.record_room_achievement(uuid, text), public.get_profile(text, uuid),
  public.settings_json(uuid), public.save_social_settings(text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.valid_avatar(jsonb), public.profile_brief(uuid), public.has_achievement(uuid, text), public.event_json(public.events), public.get_event(uuid), public.challenge_board(text, integer), public.get_profile(text, uuid) to anon, authenticated;
grant execute on function public.save_profile(text, text, text, jsonb, text, jsonb), public.create_event(uuid, text, text, text, text, timestamptz, timestamptz, integer, boolean, text),
  public.update_event(uuid, text, text, text, text, timestamptz, timestamptz, integer, text), public.save_social_settings(text, text, text, boolean, text) to authenticated;
grant execute on function public.record_event_checkin(uuid, uuid, text), public.record_challenge(uuid, text, integer, uuid), public.record_room_achievement(uuid, text), public.get_profile(text, uuid) to service_role;
