-- CampOS Worlds · clubs, memberships, campus events and RSVPs.
--
-- Ownership rules live in the database. Reads go through Row Level Security; creating clubs,
-- joining them, and creating, editing, publishing or cancelling events go through security-definer
-- functions that re-check the caller's identity and role, so a modified client request cannot edit
-- another player's club or event, and limits cannot be skipped by writing to a table directly.
-- RSVP capacity is enforced inside rsvp_event() while holding a lock on the event row.

-- ---------------------------------------------------------------- clubs
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null,
  emblem text not null default 'spark',
  color text not null default '#2f4b40',
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clubs_name check (char_length(name) between 3 and 48 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint clubs_description check (char_length(description) <= 600),
  constraint clubs_category check (category in ('academic', 'arts', 'culture', 'community', 'sports', 'technology', 'wellbeing')),
  constraint clubs_emblem check (emblem in ('spark', 'book', 'music', 'code', 'ball', 'leaf', 'camera', 'globe', 'heart', 'palette')),
  constraint clubs_color check (color in ('#2f4b40', '#506b96', '#b05f49', '#7a4f9a', '#c9a24a', '#3f7f8c', '#9b5b2a', '#41324a'))
);
create unique index clubs_name_key on public.clubs (lower(name));
create index clubs_owner_idx on public.clubs (owner_id);
create index clubs_category_idx on public.clubs (category, created_at desc);
create trigger clubs_touch before update on public.clubs for each row execute function public.touch_updated_at();

-- One row per player per club (the primary key prevents duplicate memberships). The owner is also a
-- member, with role 'owner'; owners can designate organizers, who may run the club's events.
create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id),
  constraint club_members_role check (role in ('owner', 'organizer', 'member'))
);
create index club_members_user_idx on public.club_members (user_id);
create unique index club_members_single_owner on public.club_members (club_id) where role = 'owner';

-- ---------------------------------------------------------------- events
create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null,
  description text not null default '',
  category text not null,
  location_id text not null references public.campus_locations (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer,
  status text not null default 'draft',
  published_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_title check (char_length(title) between 3 and 80 and title = btrim(title) and title !~ '[[:cntrl:]]'),
  constraint events_description check (char_length(description) <= 1000),
  constraint events_category check (category in ('social', 'academic', 'sports', 'arts', 'career', 'wellbeing', 'club')),
  constraint events_capacity check (capacity is null or capacity between 1 and 500),
  constraint events_status check (status in ('draft', 'published', 'canceled')),
  constraint events_times check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours'),
  constraint events_canceled_at check ((status = 'canceled') = (canceled_at is not null))
);
create index events_status_start_idx on public.events (status, starts_at);
create index events_club_start_idx on public.events (club_id, starts_at);
create index events_location_start_idx on public.events (location_id, starts_at);
create index events_created_by_idx on public.events (created_by, created_at desc);
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();

-- Status transitions are enforced however a row is updated: draft → published → canceled, or
-- draft → canceled. Canceled events are final; an event cannot move to another club.
create or replace function public.events_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Updates made by foreign-key actions (an organizer's profile being deleted) are not edits.
  if pg_trigger_depth() > 1 then return new; end if;
  if old.status = 'canceled' then raise exception using errcode = '22023', message = 'Canceled events cannot be changed.'; end if;
  if new.club_id <> old.club_id or new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501', message = 'An event cannot move to another club or organizer.';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then raise exception using errcode = '22023', message = 'A published event cannot return to draft. Cancel it instead.'; end if;
  if new.status = 'published' and old.status = 'draft' then new.published_at := now(); end if;
  if new.status = 'canceled' then new.canceled_at := now(); end if;
  return new;
end $$;
create trigger events_guard before update on public.events for each row execute function public.events_guard();

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_rsvps_user_idx on public.event_rsvps (user_id, created_at desc);

-- ---------------------------------------------------------------- permission helpers
-- The caller's role in a club (null when not a member). Security definer so policies can consult
-- memberships without recursing through club_members' own policies.
create or replace function public.club_role(p_club uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.club_members where club_id = p_club and user_id = auth.uid()
$$;
create or replace function public.can_manage_events(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.club_role(p_club) in ('owner', 'organizer'), false)
$$;

-- ---------------------------------------------------------------- row level security
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

create policy "Clubs are public" on public.clubs for select to anon, authenticated using (true);
create policy "Owners edit their club" on public.clubs for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete their club" on public.clubs for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Memberships are public" on public.club_members for select to anon, authenticated using (true);
create policy "Players leave clubs they don't own" on public.club_members for delete to authenticated using (user_id = (select auth.uid()) and role <> 'owner');
create policy "Owners remove members" on public.club_members for delete to authenticated
  using (role <> 'owner' and exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = (select auth.uid())));
create policy "Owners designate organizers" on public.club_members for update to authenticated
  using (role <> 'owner' and exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = (select auth.uid())))
  with check (role in ('organizer', 'member'));

create policy "Published and canceled events are public; drafts to their organizers" on public.events for select to anon, authenticated
  using (status <> 'draft' or public.can_manage_events(club_id));

create policy "Attendance of visible events is public" on public.event_rsvps for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id and (e.status <> 'draft' or public.can_manage_events(e.club_id))));
create policy "Players cancel their own RSVP" on public.event_rsvps for delete to authenticated using (user_id = (select auth.uid()));

-- Clubs, memberships, events and RSVPs are created only through the functions below (security
-- definer, each re-checking the caller's identity and role), so creation limits, time rules and
-- capacity checks cannot be skipped. Edits that need no extra rules (club details, organizer
-- roles, leaving, removing members, cancelling an RSVP) use the policies above.
revoke all on public.clubs, public.club_members, public.events, public.event_rsvps from anon, authenticated;
grant select on public.clubs, public.club_members, public.events, public.event_rsvps to anon, authenticated;
grant update (name, description, category, emblem, color) on public.clubs to authenticated;
grant delete on public.clubs to authenticated;
grant update (role) on public.club_members to authenticated;
grant delete on public.club_members to authenticated;
grant delete on public.event_rsvps to authenticated;

-- ---------------------------------------------------------------- shared shapes
create or replace function public.profile_brief(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'avatar', p.avatar)
  from public.profiles p where p.id = p_id
$$;

create or replace function public.event_json(e public.events) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description, 'category', e.category,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'capacity', e.capacity, 'status', e.status,
    'published_at', e.published_at, 'canceled_at', e.canceled_at,
    'location', jsonb_build_object('id', l.id, 'name', l.name),
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'emblem', c.emblem),
    'organizer', public.profile_brief(e.created_by),
    'attendee_count', (select count(*) from public.event_rsvps r where r.event_id = e.id),
    'going', exists (select 1 from public.event_rsvps r where r.event_id = e.id and r.user_id = auth.uid()),
    'can_manage', public.can_manage_events(e.club_id))
  from public.campus_locations l, public.clubs c
  where l.id = e.location_id and c.id = e.club_id
$$;

create or replace function public.club_json(c public.clubs) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'category', c.category, 'emblem', c.emblem, 'color', c.color,
    'created_at', c.created_at, 'owner', public.profile_brief(c.owner_id),
    'member_count', (select count(*) from public.club_members m where m.club_id = c.id),
    'upcoming_count', (select count(*) from public.events e where e.club_id = c.id and e.status = 'published' and e.ends_at > now()),
    'my_role', public.club_role(c.id))
$$;

-- ---------------------------------------------------------------- clubs API
create or replace function public.list_clubs(p_search text default null, p_category text default null, p_mine boolean default false, p_limit integer default 24, p_offset integer default 0) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(public.club_json(c) order by c.created_at desc), '[]'::jsonb)
  from public.clubs c join (
    select c.id from public.clubs c
    where (p_search is null or c.name ilike '%' || replace(replace(replace(left(p_search, 48), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_category is null or c.category = p_category)
      and (not coalesce(p_mine, false) or exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid()))
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
  ) page on page.id = c.id
$$;

create or replace function public.get_club(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select public.club_json(c) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(public.profile_brief(m.user_id) || jsonb_build_object('role', m.role, 'joined_at', m.joined_at)
                       order by case m.role when 'owner' then 0 when 'organizer' then 1 else 2 end, m.joined_at)
      from (select * from public.club_members where club_id = c.id
            order by case role when 'owner' then 0 when 'organizer' then 1 else 2 end, joined_at limit 60) m), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(public.event_json(e) order by e.starts_at)
      from public.events e join (select id from public.events where club_id = c.id and ends_at > now() order by starts_at limit 12) page on page.id = e.id), '[]'::jsonb))
  from public.clubs c where c.id = p_id
$$;

create or replace function public.create_club(p_name text, p_description text, p_category text, p_emblem text default 'spark', p_color text default '#2f4b40') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in to create a club.'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception using errcode = '42501', message = 'Create your profile before starting a club.'; end if;
  if (select count(*) from public.clubs where owner_id = uid) >= 3 then raise exception using errcode = '54000', message = 'You can run up to three clubs.'; end if;
  if (select count(*) from public.clubs where owner_id = uid and created_at > now() - interval '1 hour') >= 2 then
    raise exception using errcode = '54000', message = 'You have started two clubs this hour. Please try again later.';
  end if;
  insert into public.clubs (name, description, category, emblem, color, owner_id)
  values (btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), btrim(coalesce(p_description, '')), p_category, coalesce(p_emblem, 'spark'), coalesce(p_color, '#2f4b40'), uid)
  returning id into new_id;
  insert into public.club_members (club_id, user_id, role) values (new_id, uid, 'owner');
  return public.get_club(new_id);
exception
  when unique_violation then raise exception using errcode = '23505', message = 'A club with that name already exists.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the club name (3–48 characters), description (up to 600), category and colours.';
end $$;

create or replace function public.update_club(p_id uuid, p_name text, p_description text, p_category text, p_emblem text, p_color text) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  update public.clubs set name = btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), description = btrim(coalesce(p_description, '')),
    category = p_category, emblem = p_emblem, color = p_color
  where id = p_id;
  if not found then raise exception using errcode = '42501', message = 'Only the club owner can edit this club.'; end if;
  return public.get_club(p_id);
exception
  when unique_violation then raise exception using errcode = '23505', message = 'A club with that name already exists.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the club name (3–48 characters), description (up to 600), category and colours.';
end $$;

create or replace function public.delete_club(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.clubs where id = p_id;
  if not found then raise exception using errcode = '42501', message = 'Only the club owner can delete this club.'; end if;
  return jsonb_build_object('deleted', true);
end $$;

create or replace function public.join_club(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in to join clubs.'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception using errcode = '42501', message = 'Create your profile before joining clubs.'; end if;
  if not exists (select 1 from public.clubs where id = p_id) then raise exception using errcode = 'P0002', message = 'That club no longer exists.'; end if;
  if not exists (select 1 from public.club_members where club_id = p_id and user_id = uid) then
    if (select count(*) from public.club_members where user_id = uid) >= 30 then raise exception using errcode = '54000', message = 'You can be in up to 30 clubs.'; end if;
    insert into public.club_members (club_id, user_id, role) values (p_id, uid, 'member') on conflict (club_id, user_id) do nothing;
  end if;
  return public.get_club(p_id);
end $$;

create or replace function public.leave_club(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if public.club_role(p_id) = 'owner' then raise exception using errcode = '22023', message = 'Owners cannot leave their own club. Delete the club instead.'; end if;
  delete from public.club_members where club_id = p_id and user_id = auth.uid();
  return public.get_club(p_id);
end $$;

create or replace function public.set_member_role(p_club uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if p_role not in ('organizer', 'member') then raise exception using errcode = '22023', message = 'Members can be organizers or members.'; end if;
  update public.club_members set role = p_role where club_id = p_club and user_id = p_user;
  if not found then raise exception using errcode = '42501', message = 'Only the club owner can change roles.'; end if;
  return public.get_club(p_club);
end $$;

create or replace function public.remove_member(p_club uuid, p_user uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.club_members where club_id = p_club and user_id = p_user and p_user <> auth.uid();
  if not found then raise exception using errcode = '42501', message = 'Only the club owner can remove members.'; end if;
  return public.get_club(p_club);
end $$;

-- ---------------------------------------------------------------- events API
create or replace function public.validate_event_times(p_starts timestamptz, p_ends timestamptz) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_starts is null or p_ends is null then raise exception using errcode = '22023', message = 'Choose a start and end time.'; end if;
  if p_ends <= p_starts then raise exception using errcode = '22023', message = 'The event must end after it starts.'; end if;
  if p_ends - p_starts > interval '12 hours' then raise exception using errcode = '22023', message = 'Events can last up to 12 hours.'; end if;
  if p_starts < now() - interval '5 minutes' then raise exception using errcode = '22023', message = 'Choose a start time in the future.'; end if;
  if p_starts > now() + interval '1 year' then raise exception using errcode = '22023', message = 'Events can be scheduled up to a year ahead.'; end if;
end $$;

create or replace function public.create_event(p_club uuid, p_title text, p_description text, p_category text, p_location text, p_starts_at timestamptz, p_ends_at timestamptz, p_capacity integer default null, p_publish boolean default false) returns jsonb
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
  insert into public.events (club_id, created_by, title, description, category, location_id, starts_at, ends_at, capacity, status)
  values (p_club, uid, btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), btrim(coalesce(p_description, '')), p_category, p_location, p_starts_at, p_ends_at, p_capacity, 'draft')
  returning id into new_id;
  if coalesce(p_publish, false) then update public.events set status = 'published' where id = new_id; end if;
  return (select public.event_json(e) from public.events e where e.id = new_id);
exception
  when foreign_key_violation then raise exception using errcode = '23503', message = 'Choose a campus location from the list.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the title (3–80 characters), description (up to 1,000), category and capacity (1–500).';
end $$;

create or replace function public.update_event(p_id uuid, p_title text, p_description text, p_category text, p_location text, p_starts_at timestamptz, p_ends_at timestamptz, p_capacity integer default null) returns jsonb
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
    category = p_category, location_id = p_location, starts_at = p_starts_at, ends_at = p_ends_at, capacity = p_capacity
  where id = p_id;
  return (select public.event_json(e) from public.events e where e.id = p_id);
exception
  when foreign_key_violation then raise exception using errcode = '23503', message = 'Choose a campus location from the list.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the title (3–80 characters), description (up to 1,000), category and capacity (1–500).';
end $$;

create or replace function public.set_event_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  if p_status not in ('published', 'canceled') then raise exception using errcode = '22023', message = 'Events can be published or canceled.'; end if;
  select * into ev from public.events where id = p_id for update;
  if not found or not public.can_manage_events(ev.club_id) then raise exception using errcode = '42501', message = 'Only the club''s owner and organizers can change this event.'; end if;
  if p_status = 'published' and ev.ends_at <= now() then raise exception using errcode = '22023', message = 'This event has already ended.'; end if;
  if ev.status <> p_status then update public.events set status = p_status where id = p_id; end if;
  return (select public.event_json(e) from public.events e where e.id = p_id);
end $$;

create or replace function public.delete_event(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from public.events e where e.id = p_id and e.status = 'draft' and public.can_manage_events(e.club_id);
  if not found then raise exception using errcode = '42501', message = 'Only drafts can be deleted, by the club''s owner or organizers. Cancel published events instead.'; end if;
  return jsonb_build_object('deleted', true);
end $$;

-- Atomic RSVP: the event row is locked for the duration of the check-and-insert, so concurrent
-- requests for the same event queue behind each other and can never exceed its capacity.
create or replace function public.rsvp_event(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev public.events;
  going integer;
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in to RSVP.'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception using errcode = '42501', message = 'Create your profile before RSVPing.'; end if;
  select * into ev from public.events where id = p_id for update;
  if not found or ev.status = 'draft' then raise exception using errcode = 'P0002', message = 'That event is not available.'; end if;
  if ev.status = 'canceled' then raise exception using errcode = '22023', message = 'This event has been canceled.'; end if;
  if ev.ends_at <= now() then raise exception using errcode = '22023', message = 'This event has already ended.'; end if;
  if exists (select 1 from public.event_rsvps where event_id = p_id and user_id = uid) then
    return (select public.event_json(e) from public.events e where e.id = p_id);
  end if;
  select count(*) into going from public.event_rsvps where event_id = p_id;
  if ev.capacity is not null and going >= ev.capacity then raise exception using errcode = '54000', message = 'This event is full.'; end if;
  if (select count(*) from public.event_rsvps where user_id = uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception using errcode = '54000', message = 'Too many RSVPs this hour. Please try again later.';
  end if;
  insert into public.event_rsvps (event_id, user_id) values (p_id, uid);
  return (select public.event_json(e) from public.events e where e.id = p_id);
end $$;

create or replace function public.cancel_rsvp(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sign in to manage your RSVPs.'; end if;
  delete from public.event_rsvps where event_id = p_id and user_id = auth.uid();
  return (select public.event_json(e) from public.events e where e.id = p_id);
end $$;

-- Upcoming (or past) events visible to the caller, soonest first, with filters and paging.
create or replace function public.list_events(p_when text default 'upcoming', p_category text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_club uuid default null, p_location text default null, p_going boolean default false, p_limit integer default 30, p_offset integer default 0) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(public.event_json(e) order by page.sort_key), '[]'::jsonb)
  from public.events e join (
    select e.id, case when p_when = 'past' then -extract(epoch from e.starts_at) else extract(epoch from e.starts_at) end as sort_key
    from public.events e
    where (p_when = 'all' or (p_when = 'past' and e.ends_at <= now()) or (coalesce(p_when, 'upcoming') = 'upcoming' and e.ends_at > now()))
      and (p_category is null or e.category = p_category)
      and (p_from is null or e.ends_at >= p_from)
      and (p_to is null or e.starts_at < p_to)
      and (p_club is null or e.club_id = p_club)
      and (p_location is null or e.location_id = p_location)
      and (not coalesce(p_going, false) or exists (select 1 from public.event_rsvps r where r.event_id = e.id and r.user_id = auth.uid()))
    order by sort_key
    limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
  ) page on page.id = e.id
$$;

create or replace function public.get_event(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select public.event_json(e) || jsonb_build_object('attendees', coalesce((
    select jsonb_agg(public.profile_brief(r.user_id) order by r.created_at)
    from (select * from public.event_rsvps where event_id = e.id order by created_at limit 60) r), '[]'::jsonb))
  from public.events e where e.id = p_id
$$;

-- Profile cards now include public club memberships.
create or replace function public.get_profile(p_handle text default null, p_id uuid default null) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'bio', p.bio, 'avatar', p.avatar, 'created_at', p.created_at,
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.achievement, 'awarded_at', a.awarded_at) order by a.awarded_at) from public.achievements a where a.user_id = p.id), '[]'::jsonb),
    'stats', coalesce((select jsonb_build_object('best_hoops_round', s.best_hoops_round, 'hoops_rounds', s.hoops_rounds, 'baskets', s.baskets) from public.player_stats s where s.user_id = p.id), jsonb_build_object('best_hoops_round', 0, 'hoops_rounds', 0, 'baskets', 0)),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'emblem', c.emblem, 'role', m.role) order by m.joined_at)
                       from (select * from public.club_members where user_id = p.id order by joined_at limit 30) m join public.clubs c on c.id = m.club_id), '[]'::jsonb))
  from public.profiles p
  where (p_id is not null and p.id = p_id) or (p_id is null and p.handle = lower(btrim(p_handle)))
  limit 1
$$;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.events_guard(), public.club_role(uuid), public.can_manage_events(uuid), public.profile_brief(uuid), public.event_json(public.events), public.club_json(public.clubs),
  public.list_clubs(text, text, boolean, integer, integer), public.get_club(uuid), public.create_club(text, text, text, text, text), public.update_club(uuid, text, text, text, text, text),
  public.delete_club(uuid), public.join_club(uuid), public.leave_club(uuid), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.validate_event_times(timestamptz, timestamptz), public.create_event(uuid, text, text, text, text, timestamptz, timestamptz, integer, boolean),
  public.update_event(uuid, text, text, text, text, timestamptz, timestamptz, integer), public.set_event_status(uuid, text), public.delete_event(uuid),
  public.rsvp_event(uuid), public.cancel_rsvp(uuid), public.list_events(text, text, timestamptz, timestamptz, uuid, text, boolean, integer, integer), public.get_event(uuid)
  from public, anon, authenticated;
-- Reads: anyone (published data only, per the policies above).
grant execute on function public.club_role(uuid), public.can_manage_events(uuid), public.profile_brief(uuid), public.event_json(public.events), public.club_json(public.clubs),
  public.list_clubs(text, text, boolean, integer, integer), public.get_club(uuid), public.list_events(text, text, timestamptz, timestamptz, uuid, text, boolean, integer, integer), public.get_event(uuid)
  to anon, authenticated;
-- Writes: signed-in players only; each function checks ownership again.
grant execute on function public.create_club(text, text, text, text, text), public.update_club(uuid, text, text, text, text, text), public.delete_club(uuid), public.join_club(uuid),
  public.leave_club(uuid), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.create_event(uuid, text, text, text, text, timestamptz, timestamptz, integer, boolean), public.update_event(uuid, text, text, text, text, timestamptz, timestamptz, integer),
  public.set_event_status(uuid, text), public.delete_event(uuid), public.rsvp_event(uuid), public.cancel_rsvp(uuid)
  to authenticated;
grant execute on function public.get_profile(text, uuid) to service_role;

-- ---------------------------------------------------------------- room server snapshot
-- What the room server needs when a signed-in player joins: the public card plus the progress it
-- uses to avoid re-recording keepsakes. Callable only with the server's service_role key.
create or replace function public.account_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.get_profile(null, p_user) || jsonb_build_object(
    'progress', jsonb_build_object(
      'keepsakes', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = p_user and kind = 'keepsake'), '[]'::jsonb),
      'landmarks', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = p_user and kind = 'landmark'), '[]'::jsonb)))
  where exists (select 1 from public.profiles where id = p_user)
$$;
revoke all on function public.account_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.account_snapshot(uuid) to service_role;
