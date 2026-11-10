-- CampOS Worlds · Combat Arena Armory (premium weapons bought through the campus store), purchase history,
-- refunds, and account-synchronised arena preferences (settings and the player's HUD layouts).
-- Additive: existing tables gain columns and wider checks, functions are replaced with supersets.
--
-- Armory
-- * Exactly two firearms are free (Vanguard AR-7, Wasp SMG-9; shared/arena/weapons.mjs FREE_FIREARMS). Every
--   other firearm is `premium` in arena_catalog and sold as the store item `weapon-<id>` through the existing
--   Bachs pipeline (shop_create_order → hosted checkout → signed webhook → shop_fulfil). Nothing a client sends
--   grants a weapon.
-- * Premium weapons need ownership, not a level (their unlock level becomes 1). save_arena_loadout refuses a
--   premium weapon the account does not own; the arena server refuses it too (validateLoadout).
-- * Accounts that were already using a weapon that is now premium (it is in a saved loadout, or they have shot
--   with it) keep it: a 'legacy' ownership row, so this update takes nothing away from anyone.
-- * Refunds and chargebacks: shop_revoke() reverses one paid order (ownership removed, order 'refunded',
--   recorded in shop_revocations); a late duplicate payment event for a refunded order grants nothing.
--
-- Preferences
-- * arena_preferences holds the player's arena settings and versioned HUD layouts (validated by the client
--   before use: shared/arena/hud.mjs). Only the owner reads or writes them, through the functions below.

-- ---------------------------------------------------------------- store: weapons as items
alter table public.shop_items drop constraint shop_items_kind;
alter table public.shop_items add constraint shop_items_kind check (kind in ('character', 'accessory', 'weapon'));
insert into public.shop_items (id, kind, name) values
  ('weapon-halcyon', 'weapon', 'Halcyon BR-3'),
  ('weapon-kestrel', 'weapon', 'Kestrel K-45'),
  ('weapon-bastion', 'weapon', 'Bastion 12G'),
  ('weapon-rampart', 'weapon', 'Rampart Auto'),
  ('weapon-longbow', 'weapon', 'Longbow SR'),
  ('weapon-talon', 'weapon', 'Talon DMR'),
  ('weapon-anvil', 'weapon', 'Anvil LMG'),
  ('weapon-sparrow', 'weapon', 'Sparrow P9'),
  ('weapon-thorn', 'weapon', 'Thorn .44');

-- How an item came to be owned: a verified purchase, or kept from before it was sold ('legacy').
alter table public.shop_ownership add column source text not null default 'purchase';
alter table public.shop_ownership add constraint shop_ownership_source check (source in ('purchase', 'legacy'));

-- Orders can be reversed.
alter table public.shop_orders drop constraint shop_orders_status;
alter table public.shop_orders add constraint shop_orders_status check (status in ('created', 'open', 'paid', 'refunded'));
alter table public.shop_orders add column refunded_at timestamptz;

create table public.shop_revocations (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  item text not null references public.shop_items (id),
  order_id uuid references public.shop_orders (id) on delete set null,
  reason text not null,
  revoked_at timestamptz not null default now(),
  constraint shop_revocations_reason check (char_length(reason) between 1 and 120)
);
create index shop_revocations_user_idx on public.shop_revocations (user_id, revoked_at desc);
alter table public.shop_revocations enable row level security;
create policy "Players see their own reversals" on public.shop_revocations for select to authenticated using (user_id = auth.uid());
revoke all on public.shop_revocations from anon, authenticated;
grant select on public.shop_revocations to authenticated;

-- ---------------------------------------------------------------- arena catalogue: premium weapons
alter table public.arena_catalog add column premium boolean not null default false;
update public.arena_catalog set premium = true, unlock_level = 1
  where id in ('halcyon', 'kestrel', 'bastion', 'rampart', 'longbow', 'talon', 'anvil', 'sparrow', 'thorn');
alter table public.arena_catalog add constraint arena_catalog_premium check (not premium or kind = 'weapon');

-- Whether an account may use a weapon: free and earned weapons yes, premium ones once owned.
create or replace function public.arena_weapon_owned(p_user uuid, p_weapon text) returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select premium from public.arena_catalog where id = p_weapon), false)
      or public.owns_item(p_user, 'weapon-' || p_weapon)
$$;

-- Keep what people were already using.
insert into public.shop_ownership (user_id, item, source)
select distinct u.user_id, 'weapon-' || u.weapon, 'legacy' from (
    select user_id, primary_weapon as weapon from public.arena_loadouts
    union select user_id, secondary_weapon from public.arena_loadouts
    union select user_id, weapon from public.arena_weapon_stats where shots > 0 or kills > 0
  ) u
  join public.arena_catalog c on c.id = u.weapon and c.premium
  join public.profiles p on p.id = u.user_id
on conflict do nothing;

-- ---------------------------------------------------------------- fulfilment and reversal
-- As before, plus: an order that has been refunded is never granted again by a late or repeated event.
create or replace function public.shop_fulfil(p_event text, p_type text, p_order uuid, p_checkout text, p_amount numeric, p_currency text, p_charge text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.shop_orders;
  repeated boolean;
begin
  insert into public.shop_webhook_events (id, type) values (p_event, p_type) on conflict do nothing;
  repeated := not found;
  if p_order is not null then select * into o from public.shop_orders where id = p_order for update;
  elsif p_checkout is not null then select * into o from public.shop_orders where checkout_id = p_checkout for update;
  end if;
  if o.id is null then return jsonb_build_object('outcome', 'unknown-order', 'repeated', repeated); end if;
  if o.status = 'refunded' then return jsonb_build_object('outcome', 'refunded', 'order', o.id, 'repeated', repeated); end if;
  if p_checkout is not null and o.checkout_id is not null and o.checkout_id <> p_checkout then
    return jsonb_build_object('outcome', 'mismatch', 'order', o.id, 'repeated', repeated);
  end if;
  if p_amount is not null and (p_amount < o.amount or upper(coalesce(p_currency, '')) <> o.currency) then
    return jsonb_build_object('outcome', 'underpaid', 'order', o.id, 'repeated', repeated);
  end if;
  update public.shop_orders set status = 'paid', paid_at = coalesce(paid_at, now()), checkout_id = coalesce(checkout_id, p_checkout), charge_id = coalesce(p_charge, charge_id)
  where id = o.id;
  insert into public.shop_ownership (user_id, item, order_id) values (o.user_id, o.item, o.id) on conflict do nothing;
  return jsonb_build_object('outcome', case when found then 'granted' else 'owned' end, 'order', o.id, 'user_id', o.user_id, 'item', o.item, 'repeated', repeated);
end $$;

-- Reverse one paid order (a refund or chargeback, from a verified webhook or an operator). Removes only what
-- this order granted, once. Outcomes: 'revoked', 'not-granted' (paid, but the item was owned another way),
-- 'already-revoked', 'not-paid', 'unknown-order'.
create or replace function public.shop_revoke(p_order uuid, p_reason text, p_event text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; removed integer;
begin
  if p_event is not null then insert into public.shop_webhook_events (id, type) values (left(p_event, 128), 'reversal') on conflict do nothing; end if;
  select * into o from public.shop_orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('outcome', 'unknown-order'); end if;
  if o.status = 'refunded' then return jsonb_build_object('outcome', 'already-revoked', 'order', o.id, 'item', o.item); end if;
  if o.status <> 'paid' then return jsonb_build_object('outcome', 'not-paid', 'order', o.id, 'item', o.item); end if;
  delete from public.shop_ownership where user_id = o.user_id and item = o.item and order_id = o.id;
  get diagnostics removed = row_count;
  update public.shop_orders set status = 'refunded', refunded_at = now() where id = o.id;
  insert into public.shop_revocations (user_id, item, order_id, reason) values (o.user_id, o.item, o.id, left(coalesce(nullif(btrim(p_reason), ''), 'refund'), 120));
  return jsonb_build_object('outcome', case when removed > 0 then 'revoked' else 'not-granted' end, 'order', o.id, 'user_id', o.user_id, 'item', o.item);
end $$;

-- The player's own purchase history (orders, what they own and how, reversals).
create or replace function public.my_purchases() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'item', o.item, 'kind', i.kind, 'name', i.name, 'amount', o.amount, 'currency', o.currency,
        'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at, 'refunded_at', o.refunded_at) order by o.created_at desc)
      from (select * from public.shop_orders where user_id = auth.uid() order by created_at desc limit 50) o join public.shop_items i on i.id = o.item), '[]'::jsonb),
    'owned', coalesce((select jsonb_agg(jsonb_build_object('item', s.item, 'source', s.source, 'granted_at', s.granted_at) order by s.granted_at desc)
      from public.shop_ownership s where s.user_id = auth.uid()), '[]'::jsonb)) end
$$;

-- ---------------------------------------------------------------- loadouts: premium weapons need ownership
create or replace function public.save_arena_loadout(p_slot integer, p_loadout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); lvl integer; nm text; pri text; sec text; le text; ta text; pk text[]; sk jsonb := '{}'::jsonb; e record; need integer; have integer; locked text;
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
  if not public.arena_weapon_owned(me, pri) or not public.arena_weapon_owned(me, sec) then
    raise exception using errcode = '22023', message = 'That loadout uses an Armory weapon you do not own. Buy it to use it.';
  end if;
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

-- ---------------------------------------------------------------- arena preferences (settings and HUD layouts)
create table public.arena_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  hud jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint arena_preferences_shape check (jsonb_typeof(settings) = 'object' and jsonb_typeof(hud) = 'object'),
  constraint arena_preferences_size check (octet_length(settings::text) <= 4096 and octet_length(hud::text) <= 49152)
);
create trigger arena_preferences_touch before update on public.arena_preferences for each row execute function public.touch_updated_at();
alter table public.arena_preferences enable row level security;
create policy "Players read their own arena preferences" on public.arena_preferences for select to authenticated using (user_id = auth.uid());
revoke all on public.arena_preferences from anon, authenticated;
grant select on public.arena_preferences to authenticated;

create or replace function public.my_arena_preferences() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('settings', settings, 'hud', hud, 'updated_at', updated_at) from public.arena_preferences where user_id = auth.uid()
$$;

-- Save settings and/or HUD layouts (null keeps what is stored). The game validates layouts before applying
-- them (an unknown or damaged layout is repaired element by element, never trusted); here only the shape and
-- size are checked.
create or replace function public.save_arena_preferences(p_settings jsonb default null, p_hud jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.arena_preferences;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception using errcode = '42501', message = 'Create your profile first.'; end if;
  if p_settings is not null and (jsonb_typeof(p_settings) <> 'object' or octet_length(p_settings::text) > 4096) then raise exception using errcode = '22023', message = 'Those settings could not be saved.'; end if;
  if p_hud is not null and (jsonb_typeof(p_hud) <> 'object' or octet_length(p_hud::text) > 49152) then raise exception using errcode = '22023', message = 'That HUD layout is too large to save.'; end if;
  insert into public.arena_preferences as a (user_id, settings, hud) values (me, coalesce(p_settings, '{}'::jsonb), coalesce(p_hud, '{}'::jsonb))
  on conflict (user_id) do update set settings = coalesce(p_settings, a.settings), hud = coalesce(p_hud, a.hud)
  returning * into r;
  return jsonb_build_object('updated_at', r.updated_at);
end $$;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.arena_weapon_owned(uuid, text), public.shop_revoke(uuid, text, text), public.my_purchases(),
  public.my_arena_preferences(), public.save_arena_preferences(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.arena_weapon_owned(uuid, text), public.shop_revoke(uuid, text, text) to service_role;
grant execute on function public.my_purchases(), public.my_arena_preferences(), public.save_arena_preferences(jsonb, jsonb) to authenticated;
