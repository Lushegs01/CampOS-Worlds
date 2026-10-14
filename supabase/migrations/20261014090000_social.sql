-- CampOS Worlds · friends, blocks, privacy settings, private messages and player reports.
--
-- Relationships live in the database and change only through the security-definer functions
-- below. Each one identifies the caller with auth.uid() and re-checks eligibility on every call, so
-- a modified client cannot befriend, message or read on someone else's behalf.
--
-- * A friendship is ONE row per pair (user_a < user_b): symmetric by construction, never half-made.
-- * Operations on a pair take a transaction-scoped advisory lock, so two players adding each other
--   at the same moment serialise (the second request simply completes the friendship).
-- * Private messages are readable only by the two members of their conversation. Every function
--   returns the same "not available" error for a conversation that does not exist and one the
--   caller is not in, so identifiers cannot be probed.
-- * Sends are idempotent: the client attaches a UUID to each message and a retry returns the
--   stored message instead of a duplicate.
-- * Tables have RLS enabled with member-only read policies as a second line of defence; nothing is
--   writable directly through the API.

-- ---------------------------------------------------------------- helpers
create table public.rate_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (user_id, action, at);

-- Sliding-window rate limit for one player and action. Returns false when the budget is spent.
-- Rows written by a request that later fails roll back with it, so only completed actions count.
create or replace function public.take_rate(p_user uuid, p_action text, p_max integer, p_window interval) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('rate:' || p_user::text || ':' || p_action, 0));
  delete from public.rate_events where user_id = p_user and action = p_action and at < now() - p_window;
  select count(*) into n from public.rate_events where user_id = p_user and action = p_action;
  if n >= p_max then return false; end if;
  insert into public.rate_events (user_id, action) values (p_user, p_action);
  return true;
end $$;

create or replace function public.require_profile(p_user uuid, p_what text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is null then raise exception using errcode = '42501', message = format('Sign in to %s.', p_what); end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception using errcode = '42501', message = format('Create your profile to %s.', p_what); end if;
end $$;

-- Serialise every relationship change between two players (order-independent key).
create or replace function public.lock_pair(p_a uuid, p_b uuid) returns void
language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('pair:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0))
$$;

-- Text a player writes for other players: strip bidirectional-override and zero-width characters
-- (used to disguise text or impersonate), normalise line endings, trim.
create or replace function public.clean_text(p_text text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), '[​-‏‪-‮⁦-⁩﻿]', '', 'g'))
$$;

-- Prefix search on handles uses this index whatever the database collation is.
create index profiles_handle_prefix_idx on public.profiles (handle text_pattern_ops);

-- ---------------------------------------------------------------- privacy settings
create table public.player_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  friend_requests text not null default 'everyone',
  direct_messages text not null default 'friends',
  party_invites text not null default 'friends',
  appear_offline boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint player_settings_friend_requests check (friend_requests in ('everyone', 'nobody')),
  constraint player_settings_direct_messages check (direct_messages in ('friends', 'nobody')),
  constraint player_settings_party_invites check (party_invites in ('everyone', 'friends', 'nobody'))
);
create trigger player_settings_touch before update on public.player_settings for each row execute function public.touch_updated_at();

-- Every profile has settings (created with it), so lookups never need defaults.
create or replace function public.profiles_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.player_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger profiles_settings after insert on public.profiles for each row execute function public.profiles_settings();
insert into public.player_settings (user_id) select id from public.profiles on conflict do nothing;

-- ---------------------------------------------------------------- friends and blocks
create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b)
);
create index friendships_user_b_idx on public.friendships (user_b);

-- Pending requests, plus answered ones: a declined request blocks an immediate re-send for 24
-- hours, and an accepted one lets a retried "accept" succeed instead of failing. Cancelling or
-- blocking deletes the row.
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles (id) on delete cascade,
  recipient uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (sender <> recipient),
  constraint friend_requests_status check (status in ('pending', 'declined', 'accepted')),
  constraint friend_requests_pair unique (sender, recipient)
);
create index friend_requests_recipient_idx on public.friend_requests (recipient, status, created_at desc);

create table public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_not_self check (blocker <> blocked)
);
create index blocks_blocked_idx on public.blocks (blocked);

create or replace function public.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b))
$$;
create or replace function public.blocked_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a))
$$;

-- How `p_me` relates to `p_other`. Internal: callers only ever learn their own relationships.
create or replace function public.relationship(p_me uuid, p_other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_me is null or p_other is null then 'none'
    when p_me = p_other then 'self'
    when exists (select 1 from public.blocks where blocker = p_me and blocked = p_other) then 'blocked'
    when public.are_friends(p_me, p_other) then 'friends'
    when exists (select 1 from public.friend_requests where sender = p_me and recipient = p_other and status = 'pending') then 'outgoing'
    when exists (select 1 from public.friend_requests where sender = p_other and recipient = p_me and status = 'pending') then 'incoming'
    else 'none' end
$$;
create or replace function public.my_relationship(p_other uuid) returns text
language sql stable security definer set search_path = public as $$
  select public.relationship(auth.uid(), p_other)
$$;

create or replace function public.make_friends(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.friendships (user_a, user_b) values (least(p_a, p_b), greatest(p_a, p_b)) on conflict do nothing;
  update public.friend_requests set status = 'accepted', responded_at = now()
  where ((sender = p_a and recipient = p_b) or (sender = p_b and recipient = p_a)) and status = 'pending';
end $$;

-- ---------------------------------------------------------------- private messages
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  -- The newest message id each member has read.
  a_read_id bigint not null default 0,
  b_read_id bigint not null default 0,
  constraint conversations_ordered check (user_a < user_b),
  constraint conversations_pair unique (user_a, user_b)
);
create index conversations_a_recent_idx on public.conversations (user_a, last_message_at desc nulls last);
create index conversations_b_recent_idx on public.conversations (user_b, last_message_at desc nulls last);

create table public.direct_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  constraint direct_messages_body check (char_length(body) between 1 and 1000 and body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
  constraint direct_messages_idempotent unique (sender, client_id)
);
create index direct_messages_conversation_idx on public.direct_messages (conversation_id, id desc);

-- ---------------------------------------------------------------- reports
create table public.player_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references public.profiles (id) on delete set null,
  target uuid not null references public.profiles (id) on delete cascade,
  context text not null,
  reason text not null,
  details text not null default '',
  -- The single reported private message, copied so a moderator can review it. Nothing else from
  -- the conversation is stored.
  message_id bigint,
  evidence text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint player_reports_context check (context in ('profile', 'direct-message', 'room-chat', 'party', 'club', 'event')),
  constraint player_reports_reason check (reason in ('harassment', 'spam', 'impersonation', 'inappropriate', 'other')),
  constraint player_reports_details check (char_length(details) <= 500),
  constraint player_reports_status check (status in ('open', 'reviewed', 'dismissed'))
);
create index player_reports_open_idx on public.player_reports (status, created_at desc);
create index player_reports_target_idx on public.player_reports (target, created_at desc);

-- ---------------------------------------------------------------- row level security
alter table public.rate_events enable row level security;
alter table public.player_settings enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_requests enable row level security;
alter table public.blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.direct_messages enable row level security;
alter table public.player_reports enable row level security;

create policy "Players read their own settings" on public.player_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "Players read their own friendships" on public.friendships for select to authenticated using ((select auth.uid()) in (user_a, user_b));
create policy "Players read requests they sent or received" on public.friend_requests for select to authenticated using ((select auth.uid()) in (sender, recipient) and (status = 'pending' or sender <> (select auth.uid())));
create policy "Players read their own block list" on public.blocks for select to authenticated using (blocker = (select auth.uid()));
create policy "Members read their conversations" on public.conversations for select to authenticated using ((select auth.uid()) in (user_a, user_b));
create policy "Members read their messages" on public.direct_messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)));
-- rate_events and player_reports have no policies: only the functions below and service_role use them.

revoke all on public.rate_events, public.player_settings, public.friendships, public.friend_requests, public.blocks,
  public.conversations, public.direct_messages, public.player_reports from anon, authenticated;
grant select on public.player_settings, public.friendships, public.friend_requests, public.blocks, public.conversations, public.direct_messages to authenticated;

-- ---------------------------------------------------------------- shapes
create or replace function public.settings_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('friend_requests', s.friend_requests, 'direct_messages', s.direct_messages, 'party_invites', s.party_invites, 'appear_offline', s.appear_offline)
  from public.player_settings s where s.user_id = p_user
$$;

-- Why `p_me` may not message `p_other` right now (null when they may).
create or replace function public.message_block_reason(p_me uuid, p_other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.blocks where blocker = p_me and blocked = p_other) then 'You blocked this player. Unblock them to send messages.'
    when exists (select 1 from public.blocks where blocker = p_other and blocked = p_me) then 'You can’t message this player.'
    when not public.are_friends(p_me, p_other) then 'You can message friends only. Send a friend request first.'
    when (select direct_messages from public.player_settings where user_id = p_me) = 'nobody' then 'You have turned off private messages. Turn them on in Privacy to send one.'
    when (select direct_messages from public.player_settings where user_id = p_other) = 'nobody' then 'This player has turned off private messages.'
    else null end
$$;

create or replace function public.message_json(m public.direct_messages, p_me uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id, 'body', m.body, 'mine', m.sender = p_me, 'sender', m.sender, 'client_id', m.client_id, 'created_at', m.created_at)
$$;

create or replace function public.conversation_json(c public.conversations, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id,
    'other', public.profile_brief(case when c.user_a = p_me then c.user_b else c.user_a end),
    'last_message_at', c.last_message_at,
    'last_message', (select jsonb_build_object('id', m.id, 'preview', left(m.body, 120), 'mine', m.sender = p_me, 'created_at', m.created_at)
                     from public.direct_messages m where m.conversation_id = c.id order by m.id desc limit 1),
    'unread', (select count(*) from public.direct_messages m where m.conversation_id = c.id and m.sender <> p_me
               and m.id > case when c.user_a = p_me then c.a_read_id else c.b_read_id end),
    'block_reason', public.message_block_reason(p_me, case when c.user_a = p_me then c.user_b else c.user_a end))
$$;

-- ---------------------------------------------------------------- friends API
create or replace function public.search_players(p_query text, p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q text := regexp_replace(lower(btrim(coalesce(p_query, ''))), '^@', '');
begin
  perform public.require_profile(uid, 'find players');
  if q !~ '^[a-z0-9_]{1,20}$' then return '[]'::jsonb; end if;
  -- Players who blocked the caller are left out of results.
  return coalesce((
    select jsonb_agg(public.profile_brief(p.id) || jsonb_build_object('relationship', public.relationship(uid, p.id)) order by p.exact desc, p.handle)
    from (select pr.id, pr.handle, pr.handle = q as exact from public.profiles pr
          where pr.handle like replace(q, '_', '\_') || '%' and pr.id <> uid
            and not exists (select 1 from public.blocks b where b.blocker = pr.id and b.blocked = uid)
          order by pr.handle = q desc, pr.handle
          limit least(greatest(coalesce(p_limit, 10), 1), 20)) p), '[]'::jsonb);
end $$;

-- What the caller sees about another player after a friend action.
create or replace function public.friend_state(p_me uuid, p_other uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(public.profile_brief(p_other), jsonb_build_object('id', p_other)) || jsonb_build_object('relationship', public.relationship(p_me, p_other))
$$;

create or replace function public.send_friend_request(p_handle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target uuid;
  prior public.friend_requests;
begin
  perform public.require_profile(uid, 'add friends');
  select id into target from public.profiles where handle = regexp_replace(lower(btrim(coalesce(p_handle, ''))), '^@', '');
  if target is null then raise exception using errcode = 'P0002', message = 'No player has that handle.'; end if;
  if target = uid then raise exception using errcode = '22023', message = 'You can’t add yourself as a friend.'; end if;
  perform public.lock_pair(uid, target);
  if exists (select 1 from public.blocks where blocker = uid and blocked = target) then raise exception using errcode = '22023', message = 'Unblock this player before sending a friend request.'; end if;
  if exists (select 1 from public.blocks where blocker = target and blocked = uid) then raise exception using errcode = '42501', message = 'You can’t send a friend request to this player.'; end if;
  if public.are_friends(uid, target) then return public.friend_state(uid, target); end if;
  -- They already asked: this completes the friendship.
  if exists (select 1 from public.friend_requests where sender = target and recipient = uid and status = 'pending') then
    perform public.make_friends(uid, target);
    return public.friend_state(uid, target) || jsonb_build_object('accepted', true);
  end if;
  select * into prior from public.friend_requests where sender = uid and recipient = target;
  if found and prior.status = 'pending' then return public.friend_state(uid, target); end if;
  if found and prior.status = 'declined' and prior.responded_at > now() - interval '24 hours' then
    raise exception using errcode = '54000', message = 'You can send this player another request later.';
  end if;
  if (select friend_requests from public.player_settings where user_id = target) = 'nobody' then
    raise exception using errcode = '42501', message = 'This player isn’t accepting friend requests.';
  end if;
  if (select count(*) from public.friend_requests where sender = uid and status = 'pending') >= 50 then
    raise exception using errcode = '54000', message = 'You have 50 requests waiting. Cancel some before sending more.';
  end if;
  if (select count(*) from public.friendships where uid in (user_a, user_b)) >= 300 then
    raise exception using errcode = '54000', message = 'You have reached 300 friends.';
  end if;
  if not public.take_rate(uid, 'friend-request', 20, interval '1 hour') then
    raise exception using errcode = '54000', message = 'You have sent a lot of friend requests this hour. Please try again later.';
  end if;
  insert into public.friend_requests (sender, recipient) values (uid, target)
  on conflict (sender, recipient) do update set status = 'pending', created_at = now(), responded_at = null;
  return public.friend_state(uid, target);
end $$;

create or replace function public.respond_friend_request(p_request uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  from_user uuid;
begin
  perform public.require_profile(uid, 'answer friend requests');
  select sender into from_user from public.friend_requests where id = p_request and recipient = uid;
  if from_user is null then raise exception using errcode = 'P0002', message = 'That request is no longer available.'; end if;
  perform public.lock_pair(uid, from_user);
  if not exists (select 1 from public.friend_requests where id = p_request and recipient = uid and status = 'pending') then
    if public.are_friends(uid, from_user) then return public.friend_state(uid, from_user); end if;
    raise exception using errcode = 'P0002', message = 'That request is no longer available.';
  end if;
  if coalesce(p_accept, false) then
    if public.blocked_between(uid, from_user) then raise exception using errcode = '42501', message = 'Unblock this player first.'; end if;
    if (select count(*) from public.friendships where uid in (user_a, user_b)) >= 300 then
      raise exception using errcode = '54000', message = 'You have reached 300 friends.';
    end if;
    perform public.make_friends(uid, from_user);
  else
    update public.friend_requests set status = 'declined', responded_at = now() where id = p_request;
  end if;
  return public.friend_state(uid, from_user);
end $$;

create or replace function public.cancel_friend_request(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'manage friend requests');
  perform public.lock_pair(uid, p_user);
  delete from public.friend_requests where sender = uid and recipient = p_user and status = 'pending';
  return public.friend_state(uid, p_user);
end $$;

create or replace function public.remove_friend(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'manage friends');
  perform public.lock_pair(uid, p_user);
  delete from public.friendships where user_a = least(uid, p_user) and user_b = greatest(uid, p_user);
  return public.friend_state(uid, p_user);
end $$;

-- Blocking ends any friendship and pending requests both ways. Blocks are private to the blocker.
create or replace function public.block_player(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'block players');
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then raise exception using errcode = 'P0002', message = 'That player no longer exists.'; end if;
  if p_user = uid then raise exception using errcode = '22023', message = 'You can’t block yourself.'; end if;
  perform public.lock_pair(uid, p_user);
  if (select count(*) from public.blocks where blocker = uid) >= 500 then raise exception using errcode = '54000', message = 'Your block list is full (500).'; end if;
  insert into public.blocks (blocker, blocked) values (uid, p_user) on conflict do nothing;
  delete from public.friendships where user_a = least(uid, p_user) and user_b = greatest(uid, p_user);
  delete from public.friend_requests where (sender = uid and recipient = p_user) or (sender = p_user and recipient = uid);
  return public.friend_state(uid, p_user);
end $$;

create or replace function public.unblock_player(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'manage blocked players');
  perform public.lock_pair(uid, p_user);
  delete from public.blocks where blocker = uid and blocked = p_user;
  return public.friend_state(uid, p_user);
end $$;

-- Everything the social panel shows, in one call.
create or replace function public.social_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'see your friends');
  return jsonb_build_object(
    'friends', coalesce((select jsonb_agg(public.profile_brief(f.other) || jsonb_build_object('since', f.created_at) order by lower(p.display_name))
      from (select case when user_a = uid then user_b else user_a end as other, created_at from public.friendships where uid in (user_a, user_b)) f
      join public.profiles p on p.id = f.other), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'player', public.profile_brief(r.sender), 'created_at', r.created_at) order by r.created_at desc)
      from public.friend_requests r where r.recipient = uid and r.status = 'pending'), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'player', public.profile_brief(r.recipient), 'created_at', r.created_at) order by r.created_at desc)
      from public.friend_requests r where r.sender = uid and r.status = 'pending'), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(public.profile_brief(b.blocked) || jsonb_build_object('since', b.created_at) order by b.created_at desc)
      from public.blocks b where b.blocker = uid), '[]'::jsonb),
    'settings', public.settings_json(uid));
end $$;

create or replace function public.save_social_settings(p_friend_requests text, p_direct_messages text, p_party_invites text, p_appear_offline boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'change privacy settings');
  if p_friend_requests not in ('everyone', 'nobody') or p_direct_messages not in ('friends', 'nobody') or p_party_invites not in ('everyone', 'friends', 'nobody') or p_appear_offline is null then
    raise exception using errcode = '22023', message = 'Choose one of the listed privacy options.';
  end if;
  update public.player_settings set friend_requests = p_friend_requests, direct_messages = p_direct_messages, party_invites = p_party_invites, appear_offline = p_appear_offline
  where user_id = uid;
  return public.settings_json(uid);
end $$;

-- ---------------------------------------------------------------- messages API
create or replace function public.list_conversations(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'read messages');
  return coalesce((select jsonb_agg(public.conversation_json(c, uid) order by c.last_message_at desc nulls last, c.created_at desc)
    from (select * from public.conversations where uid in (user_a, user_b)
          order by last_message_at desc nulls last, created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 50)) c), '[]'::jsonb);
end $$;

-- Find or start the conversation with a player. Existing conversations stay readable after a
-- friendship ends; starting a new one needs the same eligibility as sending.
create or replace function public.open_conversation(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  conv public.conversations;
  reason text;
begin
  perform public.require_profile(uid, 'send messages');
  if p_user is null or p_user = uid or not exists (select 1 from public.profiles where id = p_user) then raise exception using errcode = 'P0002', message = 'That player isn’t available.'; end if;
  select * into conv from public.conversations where user_a = least(uid, p_user) and user_b = greatest(uid, p_user);
  if not found then
    reason := public.message_block_reason(uid, p_user);
    if reason is not null then raise exception using errcode = '42501', message = reason; end if;
    insert into public.conversations (user_a, user_b) values (least(uid, p_user), greatest(uid, p_user)) on conflict (user_a, user_b) do nothing;
    select * into conv from public.conversations where user_a = least(uid, p_user) and user_b = greatest(uid, p_user);
  end if;
  return public.conversation_json(conv, uid);
end $$;

create or replace function public.send_direct_message(p_conversation uuid, p_body text, p_client_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  conv public.conversations;
  msg public.direct_messages;
  other uuid;
  reason text;
  body text := public.clean_text(p_body);
begin
  perform public.require_profile(uid, 'send messages');
  if p_client_id is null then raise exception using errcode = '22023', message = 'Missing message id.'; end if;
  -- The row lock orders concurrent sends in one conversation.
  select * into conv from public.conversations where id = p_conversation and uid in (user_a, user_b) for update;
  if not found then raise exception using errcode = 'P0002', message = 'That conversation isn’t available.'; end if;
  -- A retry of a message that was already stored returns it unchanged.
  select * into msg from public.direct_messages where sender = uid and client_id = p_client_id;
  if found then
    if msg.conversation_id <> conv.id then raise exception using errcode = '23505', message = 'That message id was already used.'; end if;
    return public.message_json(msg, uid) || jsonb_build_object('duplicate', true);
  end if;
  other := case when conv.user_a = uid then conv.user_b else conv.user_a end;
  reason := public.message_block_reason(uid, other);
  if reason is not null then raise exception using errcode = '42501', message = reason; end if;
  if char_length(body) = 0 then raise exception using errcode = '22023', message = 'Write a message first.'; end if;
  if char_length(body) > 1000 then raise exception using errcode = '22023', message = 'Messages are up to 1,000 characters.'; end if;
  if body ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception using errcode = '22023', message = 'That message contains characters that can’t be sent.'; end if;
  if not public.take_rate(uid, 'dm-burst', 5, interval '5 seconds') or not public.take_rate(uid, 'dm-minute', 30, interval '1 minute') then
    raise exception using errcode = '54000', message = 'You’re sending messages quickly. Wait a moment and try again.';
  end if;
  insert into public.direct_messages (conversation_id, sender, body, client_id) values (conv.id, uid, body, p_client_id) returning * into msg;
  -- Sending marks everything before it as read for the sender.
  update public.conversations set last_message_at = msg.created_at,
    a_read_id = case when user_a = uid then msg.id else a_read_id end,
    b_read_id = case when user_b = uid then msg.id else b_read_id end
  where id = conv.id;
  return public.message_json(msg, uid);
end $$;

-- A page of messages, newest page first (returned oldest → newest), with a cursor for older ones.
create or replace function public.list_messages(p_conversation uuid, p_before bigint default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  conv public.conversations;
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  page jsonb;
  total integer;
begin
  perform public.require_profile(uid, 'read messages');
  select * into conv from public.conversations where id = p_conversation and uid in (user_a, user_b);
  if not found then raise exception using errcode = 'P0002', message = 'That conversation isn’t available.'; end if;
  select coalesce(jsonb_agg(public.message_json(m, uid) order by m.id), '[]'::jsonb), count(*) into page, total
  from (select * from public.direct_messages where conversation_id = conv.id and (p_before is null or id < p_before) order by id desc limit lim + 1) m;
  -- One row more than the page size was read only to learn whether older messages exist; it is
  -- the oldest, so drop it from the front.
  if total > lim then page := page - 0; end if;
  return jsonb_build_object('conversation', public.conversation_json(conv, uid), 'messages', page, 'has_more', total > lim);
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid, p_up_to bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  newest bigint;
begin
  perform public.require_profile(uid, 'read messages');
  if not exists (select 1 from public.conversations where id = p_conversation and uid in (user_a, user_b)) then
    raise exception using errcode = 'P0002', message = 'That conversation isn’t available.';
  end if;
  select coalesce(max(id), 0) into newest from public.direct_messages where conversation_id = p_conversation and id <= coalesce(p_up_to, 0);
  update public.conversations set
    a_read_id = case when user_a = uid then greatest(a_read_id, newest) else a_read_id end,
    b_read_id = case when user_b = uid then greatest(b_read_id, newest) else b_read_id end
  where id = p_conversation;
  return public.unread_summary();
end $$;

-- Counts for the interface's badges; cheap enough to poll.
create or replace function public.unread_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'read messages');
  return (select jsonb_build_object(
    'requests', (select count(*) from public.friend_requests where recipient = uid and status = 'pending'),
    'messages', coalesce(sum(u.n), 0),
    'conversations', count(*) filter (where u.n > 0))
  from (select (select count(*) from public.direct_messages m where m.conversation_id = c.id and m.sender <> uid
                 and m.id > case when c.user_a = uid then c.a_read_id else c.b_read_id end) as n
        from public.conversations c where uid in (c.user_a, c.user_b)) u);
end $$;

-- ---------------------------------------------------------------- reports
create or replace function public.report_player(p_user uuid, p_reason text, p_context text, p_details text default '', p_message bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  quoted text;
begin
  perform public.require_profile(uid, 'report players');
  if p_user is null or p_user = uid or not exists (select 1 from public.profiles where id = p_user) then raise exception using errcode = 'P0002', message = 'That player isn’t available.'; end if;
  if p_reason not in ('harassment', 'spam', 'impersonation', 'inappropriate', 'other') or p_context not in ('profile', 'direct-message', 'room-chat', 'party', 'club', 'event') then
    raise exception using errcode = '22023', message = 'Choose a reason for the report.';
  end if;
  if char_length(public.clean_text(p_details)) > 500 then raise exception using errcode = '22023', message = 'Keep the details under 500 characters.'; end if;
  if p_message is not null then
    -- Only a message the reported player sent, in a conversation the reporter belongs to.
    select m.body into quoted from public.direct_messages m join public.conversations c on c.id = m.conversation_id
    where m.id = p_message and m.sender = p_user and uid in (c.user_a, c.user_b);
    if quoted is null then raise exception using errcode = 'P0002', message = 'That message can’t be reported.'; end if;
  end if;
  if not public.take_rate(uid, 'report', 5, interval '1 hour') then raise exception using errcode = '54000', message = 'You have sent several reports this hour. Please try again later.'; end if;
  insert into public.player_reports (reporter, target, context, reason, details, message_id, evidence)
  values (uid, p_user, p_context, p_reason, public.clean_text(p_details), p_message, quoted);
  return jsonb_build_object('reported', true);
end $$;

-- ---------------------------------------------------------------- room server
-- Who a signed-in player's friends and blocked players are, and their privacy choices. The room
-- uses this to enforce blocks in public chat and invitations, and party-invite privacy.
create or replace function public.social_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(case when user_a = p_user then user_b else user_a end) from public.friendships where p_user in (user_a, user_b)), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(blocked) from public.blocks where blocker = p_user), '[]'::jsonb),
    'settings', public.settings_json(p_user))
  where exists (select 1 from public.profiles where id = p_user)
$$;

create or replace function public.account_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.get_profile(null, p_user) || jsonb_build_object(
    'progress', jsonb_build_object(
      'keepsakes', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = p_user and kind = 'keepsake'), '[]'::jsonb),
      'landmarks', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = p_user and kind = 'landmark'), '[]'::jsonb)),
    'social', public.social_snapshot(p_user))
  where exists (select 1 from public.profiles where id = p_user)
$$;

-- Profile cards tell a signed-in viewer how they relate to the player.
create or replace function public.get_profile(p_handle text default null, p_id uuid default null) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'bio', p.bio, 'avatar', p.avatar, 'created_at', p.created_at,
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.achievement, 'awarded_at', a.awarded_at) order by a.awarded_at) from public.achievements a where a.user_id = p.id), '[]'::jsonb),
    'stats', coalesce((select jsonb_build_object('best_hoops_round', s.best_hoops_round, 'hoops_rounds', s.hoops_rounds, 'baskets', s.baskets) from public.player_stats s where s.user_id = p.id), jsonb_build_object('best_hoops_round', 0, 'hoops_rounds', 0, 'baskets', 0)),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'emblem', c.emblem, 'role', m.role) order by m.joined_at)
                       from (select * from public.club_members where user_id = p.id order by joined_at limit 30) m join public.clubs c on c.id = m.club_id), '[]'::jsonb),
    'relationship', public.my_relationship(p.id))
  from public.profiles p
  where (p_id is not null and p.id = p_id) or (p_id is null and p.handle = lower(btrim(p_handle)))
  limit 1
$$;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.take_rate(uuid, text, integer, interval), public.require_profile(uuid, text), public.lock_pair(uuid, uuid), public.clean_text(text),
  public.profiles_settings(), public.are_friends(uuid, uuid), public.blocked_between(uuid, uuid), public.relationship(uuid, uuid), public.my_relationship(uuid),
  public.make_friends(uuid, uuid), public.settings_json(uuid), public.message_block_reason(uuid, uuid), public.message_json(public.direct_messages, uuid),
  public.conversation_json(public.conversations, uuid), public.search_players(text, integer), public.friend_state(uuid, uuid), public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean), public.cancel_friend_request(uuid), public.remove_friend(uuid), public.block_player(uuid), public.unblock_player(uuid),
  public.social_overview(), public.save_social_settings(text, text, text, boolean), public.list_conversations(integer), public.open_conversation(uuid),
  public.send_direct_message(uuid, text, uuid), public.list_messages(uuid, bigint, integer), public.mark_conversation_read(uuid, bigint), public.unread_summary(),
  public.report_player(uuid, text, text, text, bigint), public.social_snapshot(uuid), public.account_snapshot(uuid), public.get_profile(text, uuid)
  from public, anon, authenticated;
-- Public profile cards (relationship is null for anonymous viewers).
grant execute on function public.get_profile(text, uuid), public.my_relationship(uuid) to anon, authenticated;
-- Signed-in players; each function identifies the caller itself.
grant execute on function public.search_players(text, integer), public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid), public.remove_friend(uuid), public.block_player(uuid), public.unblock_player(uuid), public.social_overview(),
  public.save_social_settings(text, text, text, boolean), public.list_conversations(integer), public.open_conversation(uuid),
  public.send_direct_message(uuid, text, uuid), public.list_messages(uuid, bigint, integer), public.mark_conversation_read(uuid, bigint),
  public.unread_summary(), public.report_player(uuid, text, text, text, bigint)
  to authenticated;
-- Room server only.
grant execute on function public.social_snapshot(uuid), public.account_snapshot(uuid), public.get_profile(text, uuid) to service_role;
