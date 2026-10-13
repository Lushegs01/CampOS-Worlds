-- CampOS Worlds · persistent player profiles and server-verified progression.
--
-- Targets a Supabase project: it relies on auth.users, auth.uid() and the anon / authenticated /
-- service_role roles. Players read and write through the functions below (exposed by PostgREST as
-- RPC). Row Level Security stays on for every table, so direct table access through the API is
-- limited to what each policy allows. Progression is written only by the room server (service_role).

-- ---------------------------------------------------------------- shared helpers
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Campus places with stable ids, mirrored from LOCATIONS in shared/campus.mjs. Events and
-- landmark progress reference these ids rather than free-form coordinates.
create table public.campus_locations (
  id text primary key,
  name text not null,
  constraint campus_locations_id_format check (id ~ '^[a-z0-9-]{1,32}$')
);
insert into public.campus_locations (id, name) values
  ('orientation', 'Welcome Pavilion'),
  ('landmark', 'The Confluence'),
  ('library', 'Adunni Learning Commons'),
  ('student', 'The Student House'),
  ('lecture', 'Horizon Auditorium'),
  ('sports', 'The Courts'),
  ('notice', 'Campus Noticeboard'),
  ('services', 'CampOS Connect');

-- Avatar appearance uses the same allowlists as sanitizeAvatar() in shared/campus.mjs
-- (tests/community.test.mjs checks the two stay in step).
create or replace function public.valid_avatar(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(a) = 'object'
    and not exists (select 1 from jsonb_object_keys(a) k where k not in ('model', 'skin', 'accent', 'accessory'))
    and coalesce(a ->> 'model', 'tunde') in ('tunde', 'amara', 'chidi', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada')
    and coalesce(a ->> 'skin', 'natural') in ('natural', '#3a2219', '#5b3424', '#7a4a31', '#a66b46', '#cb9168')
    and coalesce(a ->> 'accent', '#353c4c') in ('#353c4c', '#537d70', '#b05f49', '#506b96', '#e8b95e', '#eee9df')
    and coalesce(a ->> 'accessory', 'backpack') in ('none', 'backpack', 'headphones', 'glasses')
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,
  display_name text not null,
  bio text not null default '',
  avatar jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_handle_reserved check (handle not in ('admin', 'administrator', 'moderator', 'mod', 'campos', 'worlds', 'support', 'system', 'staff', 'official', 'root', 'orisun', 'everyone')),
  constraint profiles_display_name check (char_length(display_name) between 1 and 32 and display_name = btrim(display_name) and display_name !~ '[[:cntrl:]]'),
  constraint profiles_bio check (char_length(bio) <= 280),
  constraint profiles_avatar check (public.valid_avatar(avatar))
);
-- Handles are stored lower-case (enforced above), so this index makes them unique case-insensitively.
create unique index profiles_handle_key on public.profiles (handle);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- server-verified progression
-- Keepsakes collected and landmarks visited, recorded only after the room server has checked the
-- player's position. Unique per player and item, so replays are harmless.
create table public.player_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  item text not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, kind, item),
  constraint player_progress_kind check (kind in ('keepsake', 'landmark')),
  constraint player_progress_item check (item ~ '^[a-z0-9-]{1,32}$')
);

create table public.achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement text not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, achievement),
  constraint achievements_known check (achievement in ('campus-compass', 'curious-mind', 'courtside'))
);
create index achievements_recent on public.achievements (awarded_at desc);

-- Basketball rounds of five shots, scored by the room server's physics (max 5 × 3 points).
create table public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  best_hoops_round smallint not null default 0,
  hoops_rounds integer not null default 0,
  baskets integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint player_stats_best check (best_hoops_round between 0 and 15),
  constraint player_stats_counts check (hoops_rounds >= 0 and baskets >= 0)
);
create trigger player_stats_touch before update on public.player_stats for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- row level security
alter table public.campus_locations enable row level security;
alter table public.profiles enable row level security;
alter table public.player_progress enable row level security;
alter table public.achievements enable row level security;
alter table public.player_stats enable row level security;

create policy "Campus places are public" on public.campus_locations for select to anon, authenticated using (true);
create policy "Profiles are public" on public.profiles for select to anon, authenticated using (true);
create policy "Players create their own profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "Players edit their own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Badges are public" on public.achievements for select to anon, authenticated using (true);
create policy "Basketball records are public" on public.player_stats for select to anon, authenticated using (true);
create policy "Players see their own progress" on public.player_progress for select to authenticated using (user_id = (select auth.uid()));

-- Least privilege: players may only touch the editable profile columns; progression is read-only
-- to them (written by service_role through record_progress / record_hoops_round).
revoke all on public.campus_locations, public.profiles, public.player_progress, public.achievements, public.player_stats from anon, authenticated;
grant select on public.campus_locations, public.profiles, public.achievements, public.player_stats to anon, authenticated;
grant select on public.player_progress to authenticated;
grant insert (id, handle, display_name, bio, avatar) on public.profiles to authenticated;
grant update (handle, display_name, bio, avatar) on public.profiles to authenticated;

-- ---------------------------------------------------------------- profile API
create or replace function public.check_handle(p_handle text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  h text := lower(btrim(coalesce(p_handle, '')));
begin
  if h !~ '^[a-z0-9_]{3,20}$' then
    return jsonb_build_object('available', false, 'reason', 'Use 3–20 lower-case letters, numbers or underscores.');
  elsif h in ('admin', 'administrator', 'moderator', 'mod', 'campos', 'worlds', 'support', 'system', 'staff', 'official', 'root', 'orisun', 'everyone') then
    return jsonb_build_object('available', false, 'reason', 'That handle is reserved.');
  elsif exists (select 1 from public.profiles where handle = h and id is distinct from auth.uid()) then
    return jsonb_build_object('available', false, 'reason', 'That handle is taken.');
  end if;
  return jsonb_build_object('available', true);
end $$;

-- Public profile card: what other players may see.
create or replace function public.get_profile(p_handle text default null, p_id uuid default null) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'bio', p.bio, 'avatar', p.avatar, 'created_at', p.created_at,
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.achievement, 'awarded_at', a.awarded_at) order by a.awarded_at) from public.achievements a where a.user_id = p.id), '[]'::jsonb),
    'stats', coalesce((select jsonb_build_object('best_hoops_round', s.best_hoops_round, 'hoops_rounds', s.hoops_rounds, 'baskets', s.baskets) from public.player_stats s where s.user_id = p.id), jsonb_build_object('best_hoops_round', 0, 'hoops_rounds', 0, 'baskets', 0)))
  from public.profiles p
  where (p_id is not null and p.id = p_id) or (p_id is null and p.handle = lower(btrim(p_handle)))
  limit 1
$$;

-- The signed-in player's own profile plus their private progress (null until a profile exists).
create or replace function public.my_profile() returns jsonb
language sql stable set search_path = public as $$
  select public.get_profile(null, auth.uid()) || jsonb_build_object(
    'progress', jsonb_build_object(
      'keepsakes', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = auth.uid() and kind = 'keepsake'), '[]'::jsonb),
      'landmarks', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = auth.uid() and kind = 'landmark'), '[]'::jsonb)))
  where auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid())
$$;

-- Create or update the caller's own profile. Runs with the caller's privileges, so RLS and the
-- column grants above apply; validation here gives players readable messages.
create or replace function public.save_profile(p_handle text, p_display_name text, p_bio text default '', p_avatar jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  h text := lower(btrim(coalesce(p_handle, '')));
  n text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  b text := btrim(coalesce(p_bio, ''));
  check_result jsonb;
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in to save your profile.'; end if;
  check_result := public.check_handle(h);
  if not (check_result ->> 'available')::boolean then raise exception using errcode = '22023', message = check_result ->> 'reason'; end if;
  if char_length(n) not between 1 and 32 or n ~ '[[:cntrl:]]' then raise exception using errcode = '22023', message = 'Display names are 1–32 characters.'; end if;
  if char_length(b) > 280 or b ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then raise exception using errcode = '22023', message = 'Bios are up to 280 characters.'; end if;
  if p_avatar is null or not public.valid_avatar(p_avatar) then raise exception using errcode = '22023', message = 'That appearance is not available.'; end if;
  insert into public.profiles (id, handle, display_name, bio, avatar) values (uid, h, n, b, p_avatar)
  on conflict (id) do update set handle = excluded.handle, display_name = excluded.display_name, bio = excluded.bio, avatar = excluded.avatar;
  return public.my_profile();
exception when unique_violation then
  raise exception using errcode = '23505', message = 'That handle is taken. Try another.';
end $$;

-- ---------------------------------------------------------------- progression (room server only)
create or replace function public.record_progress(p_user uuid, p_kind text, p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  awarded text[] := '{}';
  inserted int;
begin
  if p_kind = 'keepsake' and p_item not in ('t1', 't2', 't3', 't4', 't5', 't6') then raise exception using errcode = '22023', message = 'Unknown keepsake.'; end if;
  if p_kind = 'landmark' and not exists (select 1 from public.campus_locations where id = p_item) then raise exception using errcode = '22023', message = 'Unknown landmark.'; end if;
  if p_kind not in ('keepsake', 'landmark') then raise exception using errcode = '22023', message = 'Unknown progress kind.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('recorded', false, 'awarded', '[]'::jsonb); end if;
  insert into public.player_progress (user_id, kind, item) values (p_user, p_kind, p_item) on conflict do nothing;
  if p_kind = 'keepsake' and (select count(*) from public.player_progress where user_id = p_user and kind = 'keepsake') >= 6 then
    insert into public.achievements (user_id, achievement) values (p_user, 'curious-mind') on conflict do nothing;
    get diagnostics inserted = row_count; if inserted > 0 then awarded := array_append(awarded, 'curious-mind'); end if;
  end if;
  if p_kind = 'landmark' and (select count(*) from public.player_progress where user_id = p_user and kind = 'landmark' and item in ('orientation', 'landmark', 'library', 'student', 'lecture')) = 5 then
    insert into public.achievements (user_id, achievement) values (p_user, 'campus-compass') on conflict do nothing;
    get diagnostics inserted = row_count; if inserted > 0 then awarded := array_append(awarded, 'campus-compass'); end if;
  end if;
  return jsonb_build_object('recorded', true, 'awarded', to_jsonb(awarded));
end $$;

create or replace function public.record_hoops_round(p_user uuid, p_points integer, p_made integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  best smallint;
  inserted int := 0;
begin
  if p_points not between 0 and 15 or p_made not between 0 and 5 then raise exception using errcode = '22023', message = 'Invalid round.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('recorded', false, 'awarded', '[]'::jsonb); end if;
  insert into public.player_stats (user_id, best_hoops_round, hoops_rounds, baskets) values (p_user, p_points, 1, p_made)
  on conflict (user_id) do update set best_hoops_round = greatest(public.player_stats.best_hoops_round, excluded.best_hoops_round),
    hoops_rounds = public.player_stats.hoops_rounds + 1, baskets = public.player_stats.baskets + excluded.baskets
  returning best_hoops_round into best;
  if p_points >= 6 then
    insert into public.achievements (user_id, achievement) values (p_user, 'courtside') on conflict do nothing;
    get diagnostics inserted = row_count;
  end if;
  return jsonb_build_object('recorded', true, 'best', best, 'awarded', case when inserted > 0 then '["courtside"]'::jsonb else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.touch_updated_at(), public.valid_avatar(jsonb), public.check_handle(text), public.get_profile(text, uuid),
  public.my_profile(), public.save_profile(text, text, text, jsonb), public.record_progress(uuid, text, text), public.record_hoops_round(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.valid_avatar(jsonb), public.get_profile(text, uuid), public.check_handle(text) to anon, authenticated;
grant execute on function public.my_profile(), public.save_profile(text, text, text, jsonb) to authenticated;
grant execute on function public.record_progress(uuid, text, text), public.record_hoops_round(uuid, integer, integer), public.get_profile(text, uuid) to service_role;
