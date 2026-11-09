-- CampOS Worlds · Combat Arena: catalogue, player progression, weapon progression, loadouts and
-- match records. Additive: no existing table or function changes.
--
-- Who writes what
-- * Match results, experience, weapon statistics and unlocks are written only by the arena server
--   (service_role) through record_arena_match(), which re-validates every number, recomputes
--   experience itself and is idempotent on the match id (a retried or repeated result counts once).
-- * Players write only their own loadouts and emblem, through save_arena_loadout() and
--   set_arena_emblem(), which check every item against the catalogue and what their level unlocks.
-- * Statistics and match history are public (like Court Duel results); loadouts are private.
--
-- High-frequency gameplay (movement, shots) never reaches the database: one row per match per
-- signed-in player, written when the match ends.

-- ---------------------------------------------------------------- catalogue (mirrors shared/arena/weapons.mjs)
create table public.arena_catalog (
  id text primary key,
  kind text not null,
  slot text,
  category text,
  -- Player level that unlocks it; for weapon finishes ('skin'), the weapon level.
  unlock_level smallint not null,
  constraint arena_catalog_id check (id ~ '^[a-z0-9-]{1,24}$'),
  constraint arena_catalog_kind check (kind in ('weapon', 'lethal', 'tactical', 'perk', 'streak', 'skin', 'emblem')),
  constraint arena_catalog_slot check ((kind = 'weapon') = (slot is not null) and (slot is null or slot in ('primary', 'secondary'))),
  constraint arena_catalog_unlock check (unlock_level between 1 and 30)
);
insert into public.arena_catalog (id, kind, slot, category, unlock_level) values
  ('vanguard', 'weapon', 'primary', 'ar', 1),
  ('halcyon', 'weapon', 'primary', 'ar', 6),
  ('wasp', 'weapon', 'primary', 'smg', 1),
  ('kestrel', 'weapon', 'primary', 'smg', 4),
  ('bastion', 'weapon', 'primary', 'shotgun', 1),
  ('rampart', 'weapon', 'primary', 'shotgun', 8),
  ('longbow', 'weapon', 'primary', 'sniper', 1),
  ('talon', 'weapon', 'primary', 'sniper', 10),
  ('anvil', 'weapon', 'primary', 'lmg', 1),
  ('sparrow', 'weapon', 'secondary', 'pistol', 1),
  ('thorn', 'weapon', 'secondary', 'pistol', 5),
  ('knife', 'weapon', 'secondary', 'melee', 1),
  ('hammer', 'weapon', 'secondary', 'melee', 7),
  ('frag', 'lethal', null, null, 1),
  ('tack', 'lethal', null, null, 3),
  ('flash', 'tactical', null, null, 1),
  ('smoke', 'tactical', null, null, 2),
  ('fleet', 'perk', null, null, 1),
  ('steady', 'perk', null, null, 1),
  ('pockets', 'perk', null, null, 2),
  ('mend', 'perk', null, null, 3),
  ('hardline', 'perk', null, null, 5),
  ('ghost', 'perk', null, null, 9),
  ('recon', 'streak', null, null, 1),
  ('supply', 'streak', null, null, 1),
  ('strike', 'streak', null, null, 4),
  ('standard', 'skin', null, null, 1),
  ('tidewater', 'skin', null, null, 3),
  ('ember', 'skin', null, null, 5),
  ('verdigris', 'skin', null, null, 7),
  ('gilded', 'skin', null, null, 10),
  ('recruit', 'emblem', null, null, 1),
  ('chevron', 'emblem', null, null, 3),
  ('sun', 'emblem', null, null, 6),
  ('compass', 'emblem', null, null, 10),
  ('crown', 'emblem', null, null, 15),
  ('orisun', 'emblem', null, null, 25);

-- ---------------------------------------------------------------- progression formulas (mirror shared/arena/rules.mjs)
-- Experience needed to reach a level: each level costs 800 + 200 × the previous level; level 30 is the cap.
create or replace function public.arena_xp_for_level(p_level integer) returns integer
language sql immutable set search_path = public as $$
  select coalesce(sum(800 + 200 * k), 0)::integer from generate_series(1, least(greatest(p_level, 1), 30) - 1) k
$$;
create or replace function public.arena_level(p_xp bigint) returns integer
language sql immutable set search_path = public as $$
  select coalesce(max(l), 1) from generate_series(1, 30) l where public.arena_xp_for_level(l) <= greatest(p_xp, 0)
$$;
create or replace function public.arena_weapon_level(p_kills integer, p_headshots integer) returns integer
language sql immutable set search_path = public as $$
  select least(10, 1 + (greatest(p_kills, 0) * 100 + greatest(p_headshots, 0) * 25) / 500)
$$;
create or replace function public.arena_match_xp(p_kills integer, p_headshots integer, p_assists integer, p_captures integer, p_neutralizes integer, p_defends integer, p_result text, p_completed boolean) returns integer
language sql immutable set search_path = public as $$
  select least(20000, p_kills * 100 + p_headshots * 25 + p_assists * 40 + p_captures * 150 + p_neutralizes * 60 + p_defends * 50 +
    case when not p_completed then 0 when p_result = 'win' then 600 when p_result = 'draw' then 400 else 250 end)
$$;

-- ---------------------------------------------------------------- tables
create table public.arena_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  xp bigint not null default 0,
  level smallint not null default 1,
  matches integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  headshots integer not null default 0,
  captures integer not null default 0,
  defends integer not null default 0,
  score bigint not null default 0,
  damage bigint not null default 0,
  best_streak smallint not null default 0,
  seconds_played bigint not null default 0,
  emblem text not null default 'recruit' references public.arena_catalog (id),
  updated_at timestamptz not null default now(),
  constraint arena_stats_counts check (xp >= 0 and level between 1 and 30 and matches = wins + losses + draws and kills >= 0 and deaths >= 0 and assists >= 0 and headshots between 0 and kills)
);
create index arena_stats_xp_idx on public.arena_stats (xp desc);
create trigger arena_stats_touch before update on public.arena_stats for each row execute function public.touch_updated_at();

create table public.arena_weapon_stats (
  user_id uuid not null references public.profiles (id) on delete cascade,
  weapon text not null references public.arena_catalog (id),
  kills integer not null default 0,
  headshots integer not null default 0,
  shots integer not null default 0,
  hits integer not null default 0,
  primary key (user_id, weapon),
  constraint arena_weapon_stats_counts check (kills >= 0 and headshots between 0 and kills and shots >= 0 and hits >= 0)
);

create table public.arena_loadouts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot smallint not null,
  name text not null,
  primary_weapon text not null references public.arena_catalog (id),
  secondary_weapon text not null references public.arena_catalog (id),
  lethal text not null references public.arena_catalog (id),
  tactical text not null references public.arena_catalog (id),
  perks text[] not null,
  skins jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot),
  constraint arena_loadouts_slot check (slot between 1 and 5),
  constraint arena_loadouts_name check (char_length(name) between 1 and 24 and name !~ '[[:cntrl:]]'),
  constraint arena_loadouts_perks check (cardinality(perks) = 2 and perks[1] <> perks[2]),
  constraint arena_loadouts_skins check (jsonb_typeof(skins) = 'object')
);
create trigger arena_loadouts_touch before update on public.arena_loadouts for each row execute function public.touch_updated_at();

create table public.arena_matches (
  id uuid primary key,
  mode text not null,
  map text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  winner_team smallint,
  score_a integer not null,
  score_b integer not null,
  outcome text not null,
  recorded_at timestamptz not null default now(),
  constraint arena_matches_mode check (mode in ('tdm', 'dom')),
  constraint arena_matches_map check (map in ('foundry', 'quad')),
  constraint arena_matches_outcome check (outcome in ('score', 'time', 'forfeit')),
  constraint arena_matches_winner check (winner_team is null or winner_team in (0, 1)),
  constraint arena_matches_scores check (score_a between 0 and 1000 and score_b between 0 and 1000),
  constraint arena_matches_times check (ended_at >= started_at and ended_at - started_at <= interval '30 minutes')
);
create index arena_matches_ended_idx on public.arena_matches (ended_at desc);

create table public.arena_match_players (
  match_id uuid not null references public.arena_matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team smallint not null,
  result text not null,
  completed boolean not null,
  kills smallint not null, deaths smallint not null, assists smallint not null, headshots smallint not null,
  captures smallint not null, neutralizes smallint not null, defends smallint not null,
  score integer not null, damage integer not null, best_streak smallint not null,
  xp integer not null,
  primary key (match_id, user_id),
  constraint arena_match_players_team check (team in (0, 1)),
  constraint arena_match_players_result check (result in ('win', 'loss', 'draw'))
);
create index arena_match_players_user_idx on public.arena_match_players (user_id);

alter table public.arena_catalog enable row level security;
alter table public.arena_stats enable row level security;
alter table public.arena_weapon_stats enable row level security;
alter table public.arena_loadouts enable row level security;
alter table public.arena_matches enable row level security;
alter table public.arena_match_players enable row level security;
create policy "The arena catalogue is public" on public.arena_catalog for select to anon, authenticated using (true);
create policy "Arena statistics are public" on public.arena_stats for select to anon, authenticated using (true);
create policy "Arena weapon statistics are public" on public.arena_weapon_stats for select to anon, authenticated using (true);
create policy "Arena results are public" on public.arena_matches for select to anon, authenticated using (true);
create policy "Arena result lines are public" on public.arena_match_players for select to anon, authenticated using (true);
create policy "Players read their own loadouts" on public.arena_loadouts for select to authenticated using (user_id = auth.uid());
revoke all on public.arena_catalog, public.arena_stats, public.arena_weapon_stats, public.arena_loadouts, public.arena_matches, public.arena_match_players from anon, authenticated;
grant select on public.arena_catalog, public.arena_stats, public.arena_weapon_stats, public.arena_matches, public.arena_match_players to anon, authenticated;
grant select on public.arena_loadouts to authenticated;

-- ---------------------------------------------------------------- recording a match (arena server only)
create or replace function public.record_arena_match(p_match uuid, p_mode text, p_map text, p_started_at timestamptz, p_ended_at timestamptz, p_winner integer,
  p_score_a integer, p_score_b integer, p_outcome text, p_players jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  minutes numeric; pl jsonb; uid uuid; v_team integer; res text; v_xp integer; before_xp bigint; after_xp bigint;
  k integer; d integer; a integer; hs integer; cap integer; neu integer; def integer; sc integer; dmg integer; best integer; done boolean;
  w record; wk integer; whs integer; wshots integer; whits integer; wkills_total integer;
  lvl_before integer; lvl_after integer; unlocked jsonb; weapon_levels jsonb; before_w integer; out jsonb := '[]'::jsonb;
begin
  if p_match is null then raise exception using errcode = '22023', message = 'Invalid match.'; end if;
  if p_mode not in ('tdm', 'dom') or p_map not in ('foundry', 'quad') or p_outcome not in ('score', 'time', 'forfeit') then raise exception using errcode = '22023', message = 'Invalid match settings.'; end if;
  if p_winner is not null and p_winner not in (0, 1) then raise exception using errcode = '22023', message = 'Invalid winner.'; end if;
  if p_started_at is null or p_ended_at is null or p_ended_at < p_started_at or p_ended_at - p_started_at > interval '30 minutes' or p_ended_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Invalid match times.';
  end if;
  if p_score_a not between 0 and 1000 or p_score_b not between 0 and 1000 then raise exception using errcode = '22023', message = 'Invalid match score.'; end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) not between 1 and 12 then raise exception using errcode = '22023', message = 'Invalid match players.'; end if;
  -- The same match reported again (a retry) changes nothing and returns what was recorded.
  if exists (select 1 from public.arena_matches where id = p_match) then
    return jsonb_build_object('recorded', false, 'duplicate', true, 'players', coalesce((select jsonb_agg(jsonb_build_object('user', mp.user_id, 'xp', mp.xp, 'total_xp', s.xp, 'level', s.level, 'level_before', s.level, 'unlocked', '[]'::jsonb, 'weapon_levels', '[]'::jsonb))
      from public.arena_match_players mp join public.arena_stats s on s.user_id = mp.user_id where mp.match_id = p_match), '[]'::jsonb));
  end if;
  minutes := greatest(1, extract(epoch from (p_ended_at - p_started_at)) / 60);
  -- Lock every player's statistics row in a fixed order so concurrent results for the same players queue.
  insert into public.arena_stats (user_id) select (e ->> 'user')::uuid from jsonb_array_elements(p_players) e
    where (e ->> 'user') ~* '^[0-9a-f-]{36}$' and exists (select 1 from public.profiles where id = (e ->> 'user')::uuid) on conflict do nothing;
  perform 1 from public.arena_stats where user_id in (select (e ->> 'user')::uuid from jsonb_array_elements(p_players) e where (e ->> 'user') ~* '^[0-9a-f-]{36}$') order by user_id for update;
  if exists (select 1 from public.arena_matches where id = p_match) then
    return public.record_arena_match(p_match, p_mode, p_map, p_started_at, p_ended_at, p_winner, p_score_a, p_score_b, p_outcome, p_players);
  end if;
  insert into public.arena_matches (id, mode, map, started_at, ended_at, winner_team, score_a, score_b, outcome)
  values (p_match, p_mode, p_map, p_started_at, p_ended_at, p_winner, p_score_a, p_score_b, p_outcome);
  for pl in select * from jsonb_array_elements(p_players) loop
    if jsonb_typeof(pl) <> 'object' or (pl ->> 'user') !~* '^[0-9a-f-]{36}$' then raise exception using errcode = '22023', message = 'Invalid match player.'; end if;
    uid := (pl ->> 'user')::uuid;
    if not exists (select 1 from public.profiles where id = uid) then continue; end if;
    if exists (select 1 from public.arena_match_players where match_id = p_match and user_id = uid) then raise exception using errcode = '22023', message = 'A player appears twice.'; end if;
    v_team := (pl ->> 'team')::integer;
    if v_team not in (0, 1) then raise exception using errcode = '22023', message = 'Invalid team.'; end if;
    k := coalesce((pl ->> 'kills')::integer, 0); d := coalesce((pl ->> 'deaths')::integer, 0); a := coalesce((pl ->> 'assists')::integer, 0);
    hs := coalesce((pl ->> 'headshots')::integer, 0); cap := coalesce((pl ->> 'captures')::integer, 0); neu := coalesce((pl ->> 'neutralizes')::integer, 0);
    def := coalesce((pl ->> 'defends')::integer, 0); sc := coalesce((pl ->> 'score')::integer, 0); dmg := coalesce((pl ->> 'damage')::integer, 0);
    best := coalesce((pl ->> 'best_streak')::integer, 0); done := coalesce((pl ->> 'completed')::boolean, false);
    -- Plausibility: nobody eliminates more than 40 players a minute, captures more than 6 zones a minute,
    -- or lands more headshots than eliminations. Anything else is refused, never clipped.
    if least(k, d, a, hs, cap, neu, def, sc, dmg, best) < 0 or k > 40 * minutes or d > 40 * minutes or a > 40 * minutes or hs > k or best > k
       or cap > 6 * minutes or neu > 6 * minutes or def > k or (p_mode = 'tdm' and (cap > 0 or neu > 0 or def > 0)) or dmg > 100000 or sc > 200000 then
      raise exception using errcode = '22023', message = 'Implausible match statistics.';
    end if;
    -- The result follows from the winner, never from what was sent.
    res := case when p_winner is null then 'draw' when p_winner = v_team then 'win' else 'loss' end;
    v_xp := public.arena_match_xp(k, hs, a, cap, neu, def, res, done);
    select s.xp into before_xp from public.arena_stats s where s.user_id = uid;
    insert into public.arena_match_players (match_id, user_id, team, result, completed, kills, deaths, assists, headshots, captures, neutralizes, defends, score, damage, best_streak, xp)
    values (p_match, uid, v_team, res, done, k, d, a, hs, cap, neu, def, sc, dmg, best, v_xp);
    update public.arena_stats set xp = arena_stats.xp + v_xp, matches = matches + 1,
      wins = wins + (res = 'win')::int, losses = losses + (res = 'loss')::int, draws = draws + (res = 'draw')::int,
      kills = kills + k, deaths = deaths + d, assists = assists + a, headshots = headshots + hs, captures = captures + cap, defends = defends + def,
      score = score + sc, damage = damage + dmg, best_streak = greatest(best_streak, best), seconds_played = seconds_played + extract(epoch from (p_ended_at - p_started_at))::bigint
    where user_id = uid returning arena_stats.xp into after_xp;
    lvl_before := public.arena_level(before_xp); lvl_after := public.arena_level(after_xp);
    update public.arena_stats set level = lvl_after where user_id = uid;
    -- Weapon statistics, and the weapon levels (finishes) they unlock.
    weapon_levels := '[]'::jsonb; wkills_total := 0;
    if jsonb_typeof(pl -> 'weapons') = 'object' then
      for w in select key, value from jsonb_each(pl -> 'weapons') loop
        if not exists (select 1 from public.arena_catalog where id = w.key and kind = 'weapon') or jsonb_typeof(w.value) <> 'object' then raise exception using errcode = '22023', message = 'Unknown weapon.'; end if;
        wk := coalesce((w.value ->> 'kills')::integer, 0); whs := coalesce((w.value ->> 'headshots')::integer, 0);
        wshots := coalesce((w.value ->> 'shots')::integer, 0); whits := coalesce((w.value ->> 'hits')::integer, 0);
        if least(wk, whs, wshots, whits) < 0 or whs > wk or wshots > 20000 or whits > 20000 then raise exception using errcode = '22023', message = 'Implausible weapon statistics.'; end if;
        wkills_total := wkills_total + wk;
        select public.arena_weapon_level(ws.kills, ws.headshots) into before_w from public.arena_weapon_stats ws where ws.user_id = uid and ws.weapon = w.key;
        insert into public.arena_weapon_stats as ws (user_id, weapon, kills, headshots, shots, hits) values (uid, w.key, wk, whs, wshots, whits)
        on conflict (user_id, weapon) do update set kills = ws.kills + wk, headshots = ws.headshots + whs, shots = ws.shots + wshots, hits = ws.hits + whits;
        weapon_levels := weapon_levels || jsonb_build_object('weapon', w.key, 'before', coalesce(before_w, 1),
          'level', (select public.arena_weapon_level(ws.kills, ws.headshots) from public.arena_weapon_stats ws where ws.user_id = uid and ws.weapon = w.key));
      end loop;
    end if;
    if wkills_total > k then raise exception using errcode = '22023', message = 'Implausible weapon statistics.'; end if;
    select coalesce(jsonb_agg(id order by unlock_level, id), '[]'::jsonb) into unlocked from public.arena_catalog
      where kind <> 'skin' and unlock_level > lvl_before and unlock_level <= lvl_after;
    out := out || jsonb_build_object('user', uid, 'xp', v_xp, 'total_xp', after_xp, 'level_before', lvl_before, 'level', lvl_after, 'result', res, 'unlocked', unlocked, 'weapon_levels', weapon_levels);
  end loop;
  return jsonb_build_object('recorded', true, 'players', out);
end $$;

-- ---------------------------------------------------------------- reading (arena server)
create or replace function public.arena_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'xp', coalesce((select xp from public.arena_stats where user_id = p_user), 0),
    'emblem', coalesce((select emblem from public.arena_stats where user_id = p_user), 'recruit'),
    'weapons', coalesce((select jsonb_agg(jsonb_build_object('weapon', weapon, 'kills', kills, 'headshots', headshots)) from public.arena_weapon_stats where user_id = p_user), '[]'::jsonb),
    'loadouts', coalesce((select jsonb_agg(jsonb_build_object('slot', slot, 'name', name, 'primary', primary_weapon, 'secondary', secondary_weapon, 'lethal', lethal, 'tactical', tactical, 'perks', to_jsonb(perks), 'skins', skins) order by slot)
      from public.arena_loadouts where user_id = p_user), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------- the player's own arena data
create or replace function public.my_arena() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then null else
    public.arena_snapshot(auth.uid()) || jsonb_build_object('stats', (select to_jsonb(s) - 'user_id' from public.arena_stats s where s.user_id = auth.uid()),
      'weapons', coalesce((select jsonb_agg(jsonb_build_object('weapon', weapon, 'kills', kills, 'headshots', headshots, 'shots', shots, 'hits', hits, 'level', public.arena_weapon_level(kills, headshots)))
        from public.arena_weapon_stats where user_id = auth.uid()), '[]'::jsonb)) end
$$;

-- Save one of five loadouts, checked against the catalogue and what the player has unlocked.
create or replace function public.save_arena_loadout(p_slot integer, p_loadout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); lvl integer; nm text; pri text; sec text; le text; ta text; pk text[]; sk jsonb := '{}'::jsonb; e record; need integer; have integer;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception using errcode = '42501', message = 'Create your profile first.'; end if;
  if p_slot not between 1 and 5 then raise exception using errcode = '22023', message = 'Choose a loadout slot from 1 to 5.'; end if;
  if jsonb_typeof(p_loadout) <> 'object' then raise exception using errcode = '22023', message = 'Choose a loadout.'; end if;
  lvl := public.arena_level(coalesce((select xp from public.arena_stats where user_id = me), 0));
  nm := btrim(regexp_replace(coalesce(p_loadout ->> 'name', ''), '[[:cntrl:]]', '', 'g')); if nm = '' then nm := 'Custom'; end if; nm := left(nm, 24);
  pri := p_loadout ->> 'primary'; sec := p_loadout ->> 'secondary'; le := p_loadout ->> 'lethal'; ta := p_loadout ->> 'tactical';
  if not exists (select 1 from public.arena_catalog where id = pri and kind = 'weapon' and slot = 'primary') then raise exception using errcode = '22023', message = 'Choose a primary weapon.'; end if;
  if not exists (select 1 from public.arena_catalog where id = sec and kind = 'weapon' and slot = 'secondary') then raise exception using errcode = '22023', message = 'Choose a secondary weapon.'; end if;
  if not exists (select 1 from public.arena_catalog where id = le and kind = 'lethal') then raise exception using errcode = '22023', message = 'Choose lethal equipment.'; end if;
  if not exists (select 1 from public.arena_catalog where id = ta and kind = 'tactical') then raise exception using errcode = '22023', message = 'Choose tactical equipment.'; end if;
  if jsonb_typeof(p_loadout -> 'perks') <> 'array' or jsonb_array_length(p_loadout -> 'perks') <> 2 then raise exception using errcode = '22023', message = 'Choose two different perks.'; end if;
  pk := array(select jsonb_array_elements_text(p_loadout -> 'perks'));
  if pk[1] = pk[2] or (select count(*) from public.arena_catalog where id = any(pk) and kind = 'perk') <> 2 then raise exception using errcode = '22023', message = 'Choose two different perks.'; end if;
  if (select max(unlock_level) from public.arena_catalog where id in (pri, sec, le, ta) or id = any(pk)) > lvl then
    raise exception using errcode = '22023', message = 'That loadout uses something you have not unlocked yet.';
  end if;
  if p_loadout ? 'skins' and jsonb_typeof(p_loadout -> 'skins') = 'object' then
    for e in select key, value from jsonb_each_text(p_loadout -> 'skins') loop
      if e.key not in (pri, sec) then continue; end if;
      select unlock_level into need from public.arena_catalog where id = e.value and kind = 'skin';
      if need is null then raise exception using errcode = '22023', message = 'Unknown weapon finish.'; end if;
      select public.arena_weapon_level(kills, headshots) into have from public.arena_weapon_stats where user_id = me and weapon = e.key;
      if need > coalesce(have, 1) then raise exception using errcode = '22023', message = 'That finish needs a higher weapon level.'; end if;
      if e.value <> 'standard' then sk := sk || jsonb_build_object(e.key, e.value); end if;
    end loop;
  end if;
  insert into public.arena_loadouts as l (user_id, slot, name, primary_weapon, secondary_weapon, lethal, tactical, perks, skins)
  values (me, p_slot, nm, pri, sec, le, ta, pk, sk)
  on conflict (user_id, slot) do update set name = excluded.name, primary_weapon = excluded.primary_weapon, secondary_weapon = excluded.secondary_weapon,
    lethal = excluded.lethal, tactical = excluded.tactical, perks = excluded.perks, skins = excluded.skins;
  return jsonb_build_object('slot', p_slot, 'name', nm, 'primary', pri, 'secondary', sec, 'lethal', le, 'tactical', ta, 'perks', to_jsonb(pk), 'skins', sk);
end $$;

create or replace function public.set_arena_emblem(p_emblem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lvl integer;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception using errcode = '42501', message = 'Create your profile first.'; end if;
  lvl := public.arena_level(coalesce((select xp from public.arena_stats where user_id = me), 0));
  if not exists (select 1 from public.arena_catalog where id = p_emblem and kind = 'emblem' and unlock_level <= lvl) then raise exception using errcode = '22023', message = 'That emblem is not unlocked yet.'; end if;
  insert into public.arena_stats (user_id, emblem) values (me, p_emblem) on conflict (user_id) do update set emblem = excluded.emblem;
  return jsonb_build_object('emblem', p_emblem);
end $$;

-- ---------------------------------------------------------------- public: leaderboard, history, profile
create or replace function public.arena_leaderboard(p_limit integer default 25) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ranked', coalesce((select jsonb_agg(row_json order by rank_no, handle) from (
      select public.profile_brief(s.user_id) || jsonb_build_object('rank', rank() over (order by s.xp desc), 'xp', s.xp, 'level', s.level, 'emblem', s.emblem,
               'kills', s.kills, 'deaths', s.deaths, 'wins', s.wins, 'matches', s.matches, 'kd', round(s.kills::numeric / greatest(s.deaths, 1), 2)) as row_json,
             rank() over (order by s.xp desc) as rank_no, p.handle
      from public.arena_stats s join public.profiles p on p.id = s.user_id
      where s.matches > 0
      order by s.xp desc, p.handle
      limit least(greatest(coalesce(p_limit, 25), 1), 100)) t), '[]'::jsonb),
    'me', (select jsonb_build_object('xp', s.xp, 'level', s.level, 'matches', s.matches, 'rank', case when s.matches > 0 then (select count(*) + 1 from public.arena_stats o where o.matches > 0 and o.xp > s.xp) end)
           from public.arena_stats s where s.user_id = auth.uid()))
$$;

create or replace function public.arena_history(p_user uuid, p_limit integer default 10) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(j order by ended desc), '[]'::jsonb) from (
    select jsonb_build_object('id', m.id, 'mode', m.mode, 'map', m.map, 'ended_at', m.ended_at, 'outcome', m.outcome, 'scores', jsonb_build_array(m.score_a, m.score_b),
             'team', mp.team, 'result', mp.result, 'kills', mp.kills, 'deaths', mp.deaths, 'assists', mp.assists, 'captures', mp.captures, 'score', mp.score, 'xp', mp.xp) as j, m.ended_at as ended
    from public.arena_match_players mp join public.arena_matches m on m.id = mp.match_id
    where mp.user_id = p_user order by m.ended_at desc limit least(greatest(coalesce(p_limit, 10), 1), 50)) t
$$;

create or replace function public.arena_profile(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from public.profiles where id = p_user) then null else
    public.profile_brief(p_user) || jsonb_build_object(
      'stats', (select to_jsonb(s) - 'user_id' - 'updated_at' from public.arena_stats s where s.user_id = p_user),
      'weapons', coalesce((select jsonb_agg(jsonb_build_object('weapon', weapon, 'kills', kills, 'headshots', headshots, 'accuracy', case when shots > 0 then round(hits::numeric / shots, 3) end,
        'level', public.arena_weapon_level(kills, headshots)) order by kills desc) from public.arena_weapon_stats where user_id = p_user), '[]'::jsonb),
      'history', public.arena_history(p_user, 10)) end
$$;

revoke all on function public.record_arena_match(uuid, text, text, timestamptz, timestamptz, integer, integer, integer, text, jsonb), public.arena_snapshot(uuid),
  public.my_arena(), public.save_arena_loadout(integer, jsonb), public.set_arena_emblem(text), public.arena_leaderboard(integer), public.arena_history(uuid, integer), public.arena_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.arena_leaderboard(integer), public.arena_history(uuid, integer), public.arena_profile(uuid) to anon, authenticated;
grant execute on function public.my_arena(), public.save_arena_loadout(integer, jsonb), public.set_arena_emblem(text) to authenticated;
grant execute on function public.record_arena_match(uuid, text, text, timestamptz, timestamptz, integer, integer, integer, text, jsonb), public.arena_snapshot(uuid) to service_role;
grant execute on function public.arena_xp_for_level(integer), public.arena_level(bigint), public.arena_weapon_level(integer, integer),
  public.arena_match_xp(integer, integer, integer, integer, integer, integer, text, boolean) to anon, authenticated, service_role;
