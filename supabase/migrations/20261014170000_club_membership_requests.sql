-- CampOS Worlds · clubs that review new members.
--
-- A club is either open (anyone signed in joins at once, as before) or "request": players ask to
-- join and the club's owner or organizers approve or decline. Requests are visible only to the
-- player who asked and to the club's managers, and every change goes through the functions below,
-- which check the caller's role in the database (a modified client cannot approve itself).

alter table public.clubs add column join_policy text not null default 'open';
alter table public.clubs add constraint clubs_join_policy check (join_policy in ('open', 'request'));
grant update (name, description, category, emblem, color, join_policy) on public.clubs to authenticated;

create table public.club_join_requests (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null default '',
  created_at timestamptz not null default now(),
  primary key (club_id, user_id),
  constraint club_join_requests_message check (char_length(message) <= 200)
);
create index club_join_requests_user_idx on public.club_join_requests (user_id);
alter table public.club_join_requests enable row level security;
create policy "Requesters and club managers read requests" on public.club_join_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_events(club_id));
revoke all on public.club_join_requests from anon, authenticated;
grant select on public.club_join_requests to authenticated;

create or replace function public.club_json(c public.clubs) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'category', c.category, 'emblem', c.emblem, 'color', c.color,
    'created_at', c.created_at, 'owner', public.profile_brief(c.owner_id), 'join_policy', c.join_policy,
    'member_count', (select count(*) from public.club_members m where m.club_id = c.id),
    'upcoming_count', (select count(*) from public.events e where e.club_id = c.id and e.status = 'published' and e.ends_at > now()),
    'my_role', public.club_role(c.id),
    'my_request', exists (select 1 from public.club_join_requests r where r.club_id = c.id and r.user_id = auth.uid()),
    'pending_requests', case when public.can_manage_events(c.id) then (select count(*) from public.club_join_requests r where r.club_id = c.id) end)
$$;

create or replace function public.get_club(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.club_json(c) || jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(public.profile_brief(m.user_id) || jsonb_build_object('role', m.role, 'joined_at', m.joined_at)
                       order by case m.role when 'owner' then 0 when 'organizer' then 1 else 2 end, m.joined_at)
      from (select * from public.club_members where club_id = c.id
            order by case role when 'owner' then 0 when 'organizer' then 1 else 2 end, joined_at limit 60) m), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(public.event_json(e) order by e.starts_at)
      from public.events e join (select id from public.events where club_id = c.id and ends_at > now() order by starts_at limit 12) page on page.id = e.id), '[]'::jsonb),
    -- Only the club's owner and organizers see who is waiting.
    'requests', case when public.can_manage_events(c.id) then coalesce((
      select jsonb_agg(public.profile_brief(r.user_id) || jsonb_build_object('message', r.message, 'created_at', r.created_at) order by r.created_at)
      from (select * from public.club_join_requests where club_id = c.id order by created_at limit 50) r), '[]'::jsonb) else '[]'::jsonb end)
  from public.clubs c where c.id = p_id
$$;

drop function public.join_club(uuid);
create or replace function public.join_club(p_id uuid, p_message text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  policy text;
  note text := public.clean_text(p_message);
begin
  if uid is null then raise exception using errcode = '42501', message = 'Sign in to join clubs.'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception using errcode = '42501', message = 'Create your profile before joining clubs.'; end if;
  select join_policy into policy from public.clubs where id = p_id;
  if policy is null then raise exception using errcode = 'P0002', message = 'That club no longer exists.'; end if;
  if exists (select 1 from public.club_members where club_id = p_id and user_id = uid) then return public.get_club(p_id); end if;
  if (select count(*) from public.club_members where user_id = uid) >= 30 then raise exception using errcode = '54000', message = 'You can be in up to 30 clubs.'; end if;
  if policy = 'request' then
    if char_length(note) > 200 then raise exception using errcode = '22023', message = 'Keep your note under 200 characters.'; end if;
    if not exists (select 1 from public.club_join_requests where club_id = p_id and user_id = uid) then
      if (select count(*) from public.club_join_requests where user_id = uid) >= 20 then raise exception using errcode = '54000', message = 'You have 20 club requests waiting. Cancel some first.'; end if;
      if not public.take_rate(uid, 'club-request', 10, interval '1 hour') then raise exception using errcode = '54000', message = 'You have asked to join a lot of clubs this hour. Please try again later.'; end if;
    end if;
    insert into public.club_join_requests (club_id, user_id, message) values (p_id, uid, note)
    on conflict (club_id, user_id) do update set message = case when note = '' then public.club_join_requests.message else note end;
  else
    insert into public.club_members (club_id, user_id, role) values (p_id, uid, 'member') on conflict (club_id, user_id) do nothing;
  end if;
  return public.get_club(p_id);
end $$;

create or replace function public.cancel_join_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sign in to manage your clubs.'; end if;
  delete from public.club_join_requests where club_id = p_id and user_id = auth.uid();
  return public.get_club(p_id);
end $$;

create or replace function public.respond_join_request(p_club uuid, p_user uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_events(p_club) then raise exception using errcode = '42501', message = 'Only the club''s owner and organizers can answer requests.'; end if;
  -- Locking the request row makes simultaneous answers from two organizers resolve once.
  perform 1 from public.club_join_requests where club_id = p_club and user_id = p_user for update;
  if not found then raise exception using errcode = 'P0002', message = 'That request has already been answered or withdrawn.'; end if;
  if coalesce(p_accept, false) then
    if (select count(*) from public.club_members where user_id = p_user) >= 30 then raise exception using errcode = '54000', message = 'That player is already in 30 clubs.'; end if;
    insert into public.club_members (club_id, user_id, role) values (p_club, p_user, 'member') on conflict (club_id, user_id) do nothing;
  end if;
  delete from public.club_join_requests where club_id = p_club and user_id = p_user;
  return public.get_club(p_club);
end $$;

drop function public.create_club(text, text, text, text, text);
create or replace function public.create_club(p_name text, p_description text, p_category text, p_emblem text default 'spark', p_color text default '#2f4b40', p_join_policy text default 'open') returns jsonb
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
  insert into public.clubs (name, description, category, emblem, color, owner_id, join_policy)
  values (btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), btrim(coalesce(p_description, '')), p_category, coalesce(p_emblem, 'spark'), coalesce(p_color, '#2f4b40'), uid, coalesce(p_join_policy, 'open'))
  returning id into new_id;
  insert into public.club_members (club_id, user_id, role) values (new_id, uid, 'owner');
  return public.get_club(new_id);
exception
  when unique_violation then raise exception using errcode = '23505', message = 'A club with that name already exists.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the club name (3–48 characters), description (up to 600), category, colours and who can join.';
end $$;

drop function public.update_club(uuid, text, text, text, text, text);
create or replace function public.update_club(p_id uuid, p_name text, p_description text, p_category text, p_emblem text, p_color text, p_join_policy text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  update public.clubs set name = btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), description = btrim(coalesce(p_description, '')),
    category = p_category, emblem = p_emblem, color = p_color, join_policy = coalesce(p_join_policy, join_policy)
  where id = p_id;
  if not found then raise exception using errcode = '42501', message = 'Only the club owner can edit this club.'; end if;
  return public.get_club(p_id);
exception
  when unique_violation then raise exception using errcode = '23505', message = 'A club with that name already exists.';
  when check_violation then raise exception using errcode = '23514', message = 'Check the club name (3–48 characters), description (up to 600), category, colours and who can join.';
end $$;

revoke all on function public.club_json(public.clubs), public.get_club(uuid), public.join_club(uuid, text), public.cancel_join_request(uuid), public.respond_join_request(uuid, uuid, boolean),
  public.create_club(text, text, text, text, text, text), public.update_club(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.club_json(public.clubs), public.get_club(uuid) to anon, authenticated;
grant execute on function public.join_club(uuid, text), public.cancel_join_request(uuid), public.respond_join_request(uuid, uuid, boolean),
  public.create_club(text, text, text, text, text, text), public.update_club(uuid, text, text, text, text, text, text) to authenticated;
