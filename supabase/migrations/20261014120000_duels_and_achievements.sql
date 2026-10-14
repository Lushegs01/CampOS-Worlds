-- CampOS Worlds · achievement catalogue, Court Duel results, ratings and the leaderboard.
--
-- Achievements become a catalogue (mirrored from shared/achievements.mjs; tests keep them in step)
-- that the achievements table references, replacing the fixed list in a check constraint.
--
-- Court Duel results are written only by the room server (service_role), which runs the match and
-- computes the score itself. record_duel() is idempotent on the match id, so a retried or repeated
-- submission can never count twice.
--
-- Rating rules (shown in the game):
-- * Everyone starts at 1000. After a rated duel both ratings move by the same amount in opposite
--   directions: round(24 × (result − expected)), where result is 1 for a win, ½ for a draw and 0 for
--   a loss, and expected = 1 / (1 + 10^((opponent − player) / 400)) (the Elo formula).
-- * A duel is rated unless the same two players have already played 3 rated duels in the previous
--   24 hours, or it ended by forfeit within its first 10 seconds. Unrated duels still appear in
--   history and in win / loss counts.
-- * The leaderboard ranks players with at least 3 rated duels by rating; equal ratings share a rank.

-- ---------------------------------------------------------------- achievement catalogue
create table public.achievement_catalog (
  id text primary key,
  name text not null,
  category text not null,
  rule text not null,
  title text not null,
  accent text,
  constraint achievement_catalog_id check (id ~ '^[a-z0-9-]{1,32}$'),
  constraint achievement_catalog_category check (category in ('exploration', 'basketball', 'social', 'community', 'travel'))
);
insert into public.achievement_catalog (id, name, category, rule, title, accent) values
  ('campus-compass', 'Campus Compass', 'exploration', 'Visit all five stops of the campus tour: the Welcome Pavilion, The Confluence, Adunni Learning Commons, The Student House and Horizon Auditorium.', 'Campus Compass', null),
  ('curious-mind', 'Curious Mind', 'exploration', 'Find all six golden campus keepsakes.', 'Curious Mind', null),
  ('campus-explorer', 'Campus Explorer', 'exploration', 'Discover 12 different campus destinations (press E at each one).', 'Campus Explorer', '#3f7f8c'),
  ('courtside', 'Courtside', 'basketball', 'Score 6 or more points in one round of five shots at The Courts.', 'Courtside', null),
  ('good-game', 'Good Game', 'basketball', 'Finish a Court Duel against another signed-in player, win, lose or draw.', 'Good Game', null),
  ('court-champion', 'Court Champion', 'basketball', 'Win 3 rated Court Duels, against at least 2 different opponents.', 'Court Champion', '#c9a24a'),
  ('good-company', 'Good Company', 'social', 'Make your first friend: a friend request that is accepted.', 'Good Company', null),
  ('better-together', 'Better Together', 'social', 'Spend 10 minutes on campus in a party of three or more.', 'Better Together', null),
  ('regular', 'Regular', 'community', 'Check in at 3 different campus events, in the game, while they are happening.', 'Regular', null),
  ('community-builder', 'Community Builder', 'community', 'Organise an event where at least 3 other players check in.', 'Community Builder', '#7a4f9a'),
  ('road-tripper', 'Road Tripper', 'travel', 'Drive the Campus Loop: visit every district’s stop in order as the driver, in under 10 minutes.', 'Road Tripper', '#9b5b2a');

alter table public.achievements drop constraint achievements_known;
alter table public.achievements add constraint achievements_catalog_fk foreign key (achievement) references public.achievement_catalog (id);
alter table public.achievement_catalog enable row level security;
create policy "The achievement catalogue is public" on public.achievement_catalog for select to anon, authenticated using (true);
revoke all on public.achievement_catalog from anon, authenticated;
grant select on public.achievement_catalog to anon, authenticated;

-- Award once; true when this call awarded it.
create or replace function public.award(p_user uuid, p_achievement text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.achievements (user_id, achievement) values (p_user, p_achievement) on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Keepsakes and landmarks, now also awarding Campus Explorer (12 distinct destinations).
create or replace function public.record_progress(p_user uuid, p_kind text, p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare awarded text[] := '{}';
begin
  if p_kind = 'keepsake' and p_item not in ('t1', 't2', 't3', 't4', 't5', 't6') then raise exception using errcode = '22023', message = 'Unknown keepsake.'; end if;
  if p_kind = 'landmark' and not exists (select 1 from public.campus_locations where id = p_item) then raise exception using errcode = '22023', message = 'Unknown landmark.'; end if;
  if p_kind not in ('keepsake', 'landmark') then raise exception using errcode = '22023', message = 'Unknown progress kind.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('recorded', false, 'awarded', '[]'::jsonb); end if;
  insert into public.player_progress (user_id, kind, item) values (p_user, p_kind, p_item) on conflict do nothing;
  if p_kind = 'keepsake' and (select count(*) from public.player_progress where user_id = p_user and kind = 'keepsake') >= 6 and public.award(p_user, 'curious-mind') then awarded := array_append(awarded, 'curious-mind'); end if;
  if p_kind = 'landmark' and (select count(*) from public.player_progress where user_id = p_user and kind = 'landmark' and item in ('orientation', 'landmark', 'library', 'student', 'lecture')) = 5
     and public.award(p_user, 'campus-compass') then awarded := array_append(awarded, 'campus-compass'); end if;
  if p_kind = 'landmark' and (select count(*) from public.player_progress where user_id = p_user and kind = 'landmark') >= 12 and public.award(p_user, 'campus-explorer') then awarded := array_append(awarded, 'campus-explorer'); end if;
  return jsonb_build_object('recorded', true, 'awarded', to_jsonb(awarded));
end $$;

-- A first friendship awards Good Company to both players.
create or replace function public.make_friends(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.friendships (user_a, user_b) values (least(p_a, p_b), greatest(p_a, p_b)) on conflict do nothing;
  update public.friend_requests set status = 'accepted', responded_at = now()
  where ((sender = p_a and recipient = p_b) or (sender = p_b and recipient = p_a)) and status = 'pending';
  perform public.award(p_a, 'good-company'); perform public.award(p_b, 'good-company');
end $$;

-- ---------------------------------------------------------------- Court Duel
create table public.duel_matches (
  id uuid primary key,
  mode text not null default 'court-duel',
  player_a uuid not null references public.profiles (id) on delete cascade,
  player_b uuid not null references public.profiles (id) on delete cascade,
  score_a smallint not null,
  score_b smallint not null,
  winner uuid references public.profiles (id) on delete set null,
  outcome text not null,
  forfeit_by uuid references public.profiles (id) on delete set null,
  rated boolean not null,
  -- Rating change for player_a (player_b moved by the opposite amount); 0 when unrated.
  rating_change smallint not null default 0,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint duel_matches_mode check (mode in ('court-duel')),
  constraint duel_matches_players check (player_a <> player_b),
  constraint duel_matches_scores check (score_a between 0 and 200 and score_b between 0 and 200),
  constraint duel_matches_outcome check (outcome in ('time', 'forfeit') and ((outcome = 'forfeit') = (forfeit_by is not null))),
  constraint duel_matches_times check (ended_at >= started_at and ended_at - started_at <= interval '10 minutes')
);
create index duel_matches_a_idx on public.duel_matches (player_a, ended_at desc);
create index duel_matches_b_idx on public.duel_matches (player_b, ended_at desc);

create table public.duel_ratings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  rating integer not null default 1000,
  rated_matches integer not null default 0,
  matches integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  points_for integer not null default 0,
  points_against integer not null default 0,
  best_score smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint duel_ratings_counts check (rated_matches >= 0 and matches >= rated_matches and wins >= 0 and losses >= 0 and draws >= 0 and wins + losses + draws = matches)
);
create trigger duel_ratings_touch before update on public.duel_ratings for each row execute function public.touch_updated_at();

alter table public.duel_matches enable row level security;
alter table public.duel_ratings enable row level security;
create policy "Duel results are public" on public.duel_matches for select to anon, authenticated using (true);
create policy "Duel records are public" on public.duel_ratings for select to anon, authenticated using (true);
revoke all on public.duel_matches, public.duel_ratings from anon, authenticated;
grant select on public.duel_matches, public.duel_ratings to anon, authenticated;

create or replace function public.record_duel(p_match uuid, p_player_a uuid, p_player_b uuid, p_score_a integer, p_score_b integer, p_outcome text, p_forfeit_by uuid,
  p_started_at timestamptz, p_ended_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  existing public.duel_matches;
  ra public.duel_ratings; rb public.duel_ratings;
  win uuid; is_rated boolean; delta integer := 0; expected numeric; result numeric;
  awarded_a text[] := '{}'; awarded_b text[] := '{}';
begin
  if p_match is null or p_player_a is null or p_player_b is null or p_player_a = p_player_b then raise exception using errcode = '22023', message = 'Invalid duel players.'; end if;
  if p_score_a not between 0 and 200 or p_score_b not between 0 and 200 then raise exception using errcode = '22023', message = 'Invalid duel score.'; end if;
  if p_outcome not in ('time', 'forfeit') or (p_outcome = 'forfeit') <> (p_forfeit_by is not null) or (p_forfeit_by is not null and p_forfeit_by not in (p_player_a, p_player_b)) then
    raise exception using errcode = '22023', message = 'Invalid duel outcome.';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at < p_started_at or p_ended_at - p_started_at > interval '10 minutes' then raise exception using errcode = '22023', message = 'Invalid duel times.'; end if;
  -- The same match reported again (a retry) changes nothing.
  select * into existing from public.duel_matches where id = p_match;
  if found then
    return jsonb_build_object('recorded', false, 'duplicate', true, 'rated', existing.rated,
      'a', (select jsonb_build_object('rating', rating, 'change', existing.rating_change) from public.duel_ratings where user_id = existing.player_a),
      'b', (select jsonb_build_object('rating', rating, 'change', -existing.rating_change) from public.duel_ratings where user_id = existing.player_b), 'awarded_a', '[]'::jsonb, 'awarded_b', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.profiles where id = p_player_a) or not exists (select 1 from public.profiles where id = p_player_b) then
    return jsonb_build_object('recorded', false, 'rated', false);
  end if;
  -- Lock both rating rows in a fixed order, so concurrent results for the same players queue.
  insert into public.duel_ratings (user_id) values (p_player_a), (p_player_b) on conflict do nothing;
  perform 1 from public.duel_ratings where user_id in (p_player_a, p_player_b) order by user_id for update;
  -- Lost a race with a concurrent identical submission? Then it is a duplicate.
  if exists (select 1 from public.duel_matches where id = p_match) then return public.record_duel(p_match, p_player_a, p_player_b, p_score_a, p_score_b, p_outcome, p_forfeit_by, p_started_at, p_ended_at); end if;
  select * into ra from public.duel_ratings where user_id = p_player_a;
  select * into rb from public.duel_ratings where user_id = p_player_b;
  win := case when p_outcome = 'forfeit' then case when p_forfeit_by = p_player_a then p_player_b else p_player_a end
              when p_score_a > p_score_b then p_player_a when p_score_b > p_score_a then p_player_b else null end;
  is_rated := not (p_outcome = 'forfeit' and p_ended_at - p_started_at < interval '10 seconds')
    and (select count(*) from public.duel_matches where rated and ended_at > p_ended_at - interval '24 hours'
         and least(player_a, player_b) = least(p_player_a, p_player_b) and greatest(player_a, player_b) = greatest(p_player_a, p_player_b)) < 3;
  if is_rated then
    expected := 1.0 / (1.0 + power(10.0, (rb.rating - ra.rating)::numeric / 400.0));
    result := case when win = p_player_a then 1.0 when win = p_player_b then 0.0 else 0.5 end;
    delta := round(24 * (result - expected));
  end if;
  insert into public.duel_matches (id, player_a, player_b, score_a, score_b, winner, outcome, forfeit_by, rated, rating_change, started_at, ended_at)
  values (p_match, p_player_a, p_player_b, p_score_a, p_score_b, win, p_outcome, p_forfeit_by, is_rated, delta, p_started_at, p_ended_at);
  update public.duel_ratings set rating = rating + delta, rated_matches = rated_matches + is_rated::int, matches = matches + 1,
    wins = wins + coalesce(win = p_player_a, false)::int, losses = losses + coalesce(win = p_player_b, false)::int, draws = draws + (win is null)::int,
    points_for = points_for + p_score_a, points_against = points_against + p_score_b, best_score = greatest(best_score, p_score_a)
  where user_id = p_player_a;
  update public.duel_ratings set rating = rating - delta, rated_matches = rated_matches + is_rated::int, matches = matches + 1,
    wins = wins + coalesce(win = p_player_b, false)::int, losses = losses + coalesce(win = p_player_a, false)::int, draws = draws + (win is null)::int,
    points_for = points_for + p_score_b, points_against = points_against + p_score_a, best_score = greatest(best_score, p_score_b)
  where user_id = p_player_b;
  if public.award(p_player_a, 'good-game') then awarded_a := array_append(awarded_a, 'good-game'); end if;
  if public.award(p_player_b, 'good-game') then awarded_b := array_append(awarded_b, 'good-game'); end if;
  -- Court Champion: 3 rated wins against at least 2 different opponents.
  if win is not null and is_rated and (select count(*) >= 3 and count(distinct case when player_a = win then player_b else player_a end) >= 2 from public.duel_matches where rated and winner = win)
     and public.award(win, 'court-champion') then
    if win = p_player_a then awarded_a := array_append(awarded_a, 'court-champion'); else awarded_b := array_append(awarded_b, 'court-champion'); end if;
  end if;
  return jsonb_build_object('recorded', true, 'rated', is_rated, 'winner', win,
    'a', jsonb_build_object('rating', ra.rating + delta, 'change', delta), 'b', jsonb_build_object('rating', rb.rating - delta, 'change', -delta),
    'awarded_a', to_jsonb(awarded_a), 'awarded_b', to_jsonb(awarded_b));
end $$;

-- The leaderboard: players with 3+ rated duels, by rating. Equal ratings share a rank; within a tie,
-- more wins first, then handle. Reads only validated results.
create or replace function public.duel_leaderboard(p_limit integer default 20) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ranked', coalesce((select jsonb_agg(row_json order by rank_no, wins desc, handle) from (
      select public.profile_brief(r.user_id) || jsonb_build_object('rank', rank() over (order by r.rating desc), 'rating', r.rating, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws, 'rated_matches', r.rated_matches) as row_json,
             rank() over (order by r.rating desc) as rank_no, r.wins, p.handle
      from public.duel_ratings r join public.profiles p on p.id = r.user_id
      where r.rated_matches >= 3
      order by r.rating desc, r.wins desc, p.handle
      limit least(greatest(coalesce(p_limit, 20), 1), 100)) t), '[]'::jsonb),
    'provisional', (select count(*) from public.duel_ratings where matches > 0 and rated_matches < 3),
    'me', (select jsonb_build_object('rating', r.rating, 'rated_matches', r.rated_matches, 'matches', r.matches, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws, 'best_score', r.best_score,
                                     'rank', case when r.rated_matches >= 3 then (select count(*) + 1 from public.duel_ratings o where o.rated_matches >= 3 and o.rating > r.rating) end)
           from public.duel_ratings r where r.user_id = auth.uid()))
$$;

-- A player's recent duels (public, like the results themselves).
create or replace function public.duel_history(p_user uuid, p_limit integer default 10) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'ended_at', m.ended_at, 'opponent', public.profile_brief(case when m.player_a = p_user then m.player_b else m.player_a end),
      'score', case when m.player_a = p_user then m.score_a else m.score_b end, 'opponent_score', case when m.player_a = p_user then m.score_b else m.score_a end,
      'result', case when m.winner is null then 'draw' when m.winner = p_user then 'win' else 'loss' end, 'outcome', m.outcome, 'rated', m.rated,
      'rating_change', case when m.player_a = p_user then m.rating_change else -m.rating_change end) order by m.ended_at desc), '[]'::jsonb)
  from (select * from public.duel_matches where p_user in (player_a, player_b) order by ended_at desc limit least(greatest(coalesce(p_limit, 10), 1), 50)) m
$$;

-- Profile cards gain the duel record.
create or replace function public.get_profile(p_handle text default null, p_id uuid default null) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'bio', p.bio, 'avatar', p.avatar, 'created_at', p.created_at,
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.achievement, 'awarded_at', a.awarded_at) order by a.awarded_at) from public.achievements a where a.user_id = p.id), '[]'::jsonb),
    'stats', coalesce((select jsonb_build_object('best_hoops_round', s.best_hoops_round, 'hoops_rounds', s.hoops_rounds, 'baskets', s.baskets) from public.player_stats s where s.user_id = p.id), jsonb_build_object('best_hoops_round', 0, 'hoops_rounds', 0, 'baskets', 0)),
    'duel', (select jsonb_build_object('rating', r.rating, 'rated_matches', r.rated_matches, 'matches', r.matches, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws, 'best_score', r.best_score) from public.duel_ratings r where r.user_id = p.id),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'emblem', c.emblem, 'role', m.role) order by m.joined_at)
                       from (select * from public.club_members where user_id = p.id order by joined_at limit 30) m join public.clubs c on c.id = m.club_id), '[]'::jsonb),
    'relationship', public.my_relationship(p.id))
  from public.profiles p
  where (p_id is not null and p.id = p_id) or (p_id is null and p.handle = lower(btrim(p_handle)))
  limit 1
$$;

revoke all on function public.award(uuid, text), public.record_progress(uuid, text, text), public.make_friends(uuid, uuid),
  public.record_duel(uuid, uuid, uuid, integer, integer, text, uuid, timestamptz, timestamptz), public.duel_leaderboard(integer), public.duel_history(uuid, integer), public.get_profile(text, uuid)
  from public, anon, authenticated;
grant execute on function public.duel_leaderboard(integer), public.duel_history(uuid, integer), public.get_profile(text, uuid) to anon, authenticated;
grant execute on function public.record_progress(uuid, text, text), public.record_duel(uuid, uuid, uuid, integer, integer, text, uuid, timestamptz, timestamptz), public.get_profile(text, uuid) to service_role;
