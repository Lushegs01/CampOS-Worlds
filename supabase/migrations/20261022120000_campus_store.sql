-- CampOS Worlds · the campus store: premium characters and accessories bought with real money.
--
-- * Catalogue: shop_items mirrors SHOP_ITEMS in shared/shop.mjs (tests keep them in step). Prices are not
--   stored here: they are a room-server setting, and each order records the amount it was opened for.
-- * Payment: the room server opens an order (shop_create_order), creates a Bachs hosted checkout for it and
--   records the checkout (shop_open_order). Bachs then calls the room's webhook; only after verifying the
--   webhook's signature does the room call shop_fulfil, which records the event once and grants the item
--   once. Players never write to any of these tables, and a redirect back from the checkout grants nothing.
-- * Wearing: valid_avatar() knows the premium choices; profiles_guard (a trigger, so every write path is
--   covered) refuses a premium character or accessory its owner has not bought. The room re-checks it.

-- ---------------------------------------------------------------- catalogue, orders, ownership
create table public.shop_items (
  id text primary key,
  kind text not null,
  name text not null,
  constraint shop_items_id check (id ~ '^[a-z0-9-]{1,32}$'),
  constraint shop_items_kind check (kind in ('character', 'accessory'))
);
insert into public.shop_items (id, kind, name) values
  ('emeka', 'character', 'Emeka'),
  ('folake', 'character', 'Folake'),
  ('seun', 'character', 'Seun'),
  ('cap', 'accessory', 'Snapback cap'),
  ('beanie', 'accessory', 'Knit beanie'),
  ('shades', 'accessory', 'Gold aviators');

create table public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  item text not null references public.shop_items (id),
  amount numeric(12, 2) not null,
  currency text not null,
  status text not null default 'created',
  checkout_id text unique,
  charge_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint shop_orders_amount check (amount > 0),
  constraint shop_orders_currency check (currency ~ '^[A-Z]{3}$'),
  constraint shop_orders_status check (status in ('created', 'open', 'paid')),
  constraint shop_orders_checkout check (checkout_id is null or char_length(checkout_id) between 1 and 128)
);
create index shop_orders_user_idx on public.shop_orders (user_id, created_at desc);

create table public.shop_ownership (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item text not null references public.shop_items (id),
  order_id uuid references public.shop_orders (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, item)
);

-- Bachs delivers each event at least once: its id is recorded so a repeat is recognised.
create table public.shop_webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  constraint shop_webhook_events_id check (char_length(id) between 1 and 128)
);

alter table public.shop_items enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_ownership enable row level security;
alter table public.shop_webhook_events enable row level security;
create policy "The store catalogue is public" on public.shop_items for select to anon, authenticated using (true);
create policy "Players see their own orders" on public.shop_orders for select to authenticated using (user_id = auth.uid());
create policy "Players see what they own" on public.shop_ownership for select to authenticated using (user_id = auth.uid());
revoke all on public.shop_items, public.shop_orders, public.shop_ownership, public.shop_webhook_events from anon, authenticated;
grant select on public.shop_items to anon, authenticated;
grant select on public.shop_orders, public.shop_ownership to authenticated;

create or replace function public.owns_item(p_user uuid, p_item text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shop_ownership where user_id = p_user and item = p_item)
$$;
create or replace function public.owned_items(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(item order by item) from public.shop_ownership where user_id = p_user), '[]'::jsonb)
$$;

-- ---------------------------------------------------------------- room server: orders and fulfilment
-- An order for an item the player does not own yet, at the amount the room charges for it. Pressing "Buy"
-- again within 50 minutes returns the same open order (its checkout lasts an hour), so the room asks Bachs
-- for the same checkout rather than starting a second payment.
create or replace function public.shop_create_order(p_user uuid, p_item text, p_amount numeric, p_currency text) returns uuid
language plpgsql security definer set search_path = public as $$
declare order_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception using errcode = 'P0002', message = 'Create your profile before buying from the store.';
  end if;
  if not exists (select 1 from public.shop_items where id = p_item) then
    raise exception using errcode = '22023', message = 'That item is not in the store.';
  end if;
  if public.owns_item(p_user, p_item) then
    raise exception using errcode = '22023', message = 'You already own this.';
  end if;
  select id into order_id from public.shop_orders
  where user_id = p_user and item = p_item and status in ('created', 'open') and amount = p_amount and currency = upper(p_currency) and created_at > now() - interval '50 minutes'
  order by created_at desc limit 1;
  if order_id is null then
    insert into public.shop_orders (user_id, item, amount, currency) values (p_user, p_item, p_amount, upper(p_currency)) returning id into order_id;
  end if;
  return order_id;
end $$;

-- The Bachs checkout created for an order.
create or replace function public.shop_open_order(p_order uuid, p_checkout text) returns void
language sql security definer set search_path = public as $$
  update public.shop_orders set checkout_id = p_checkout, status = 'open' where id = p_order and status = 'created'
$$;

-- Called only after the room has verified a webhook's signature. Matches the order by its id (the checkout's
-- reference) or its checkout, checks what was paid, and grants the item once. Outcomes: 'granted', 'owned'
-- (already granted: a repeated or second event), 'unknown-order', 'mismatch' (the event names another
-- order's checkout) and 'underpaid' (less than the order's amount, or another currency).
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

-- ---------------------------------------------------------------- what players may wear
create or replace function public.valid_avatar(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(a) = 'object'
    and not exists (select 1 from jsonb_object_keys(a) k where k not in ('model', 'skin', 'accent', 'accessory'))
    and coalesce(a ->> 'model', 'tunde') in ('tunde', 'amara', 'chidi', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada', 'mel', 'emeka', 'folake', 'seun')
    and coalesce(a ->> 'skin', 'natural') in ('natural', '#3a2219', '#5b3424', '#7a4a31', '#a66b46', '#cb9168')
    and coalesce(a ->> 'accent', '#353c4c') in ('#353c4c', '#537d70', '#b05f49', '#506b96', '#e8b95e', '#eee9df', '#3f7f8c', '#c9a24a', '#7a4f9a', '#9b5b2a')
    and coalesce(a ->> 'accessory', 'backpack') in ('none', 'backpack', 'headphones', 'glasses', 'cap', 'beanie', 'shades')
$$;

-- As before (titles and earned accents), plus: a premium character or accessory needs buying first.
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
  if tg_op = 'INSERT' or new.avatar ->> 'model' is distinct from old.avatar ->> 'model' or new.avatar ->> 'accessory' is distinct from old.avatar ->> 'accessory' then
    select i.name into locked from public.shop_items i
    where i.id in (new.avatar ->> 'model', new.avatar ->> 'accessory') and not public.owns_item(new.id, i.id) limit 1;
    if locked is not null then raise exception using errcode = '42501', message = format('%s is in the store. Buy it to use it.', locked); end if;
  end if;
  return new;
end $$;

-- Players' own profile and the room's account snapshot now say what they own.
create or replace function public.my_profile() returns jsonb
language sql stable set search_path = public as $$
  select public.get_profile(null, auth.uid()) || jsonb_build_object(
    'progress', jsonb_build_object(
      'keepsakes', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = auth.uid() and kind = 'keepsake'), '[]'::jsonb),
      'landmarks', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = auth.uid() and kind = 'landmark'), '[]'::jsonb)),
    -- Read as the player: row security shows them their own purchases only.
    'owned', coalesce((select jsonb_agg(item order by item) from public.shop_ownership where user_id = auth.uid()), '[]'::jsonb))
  where auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid())
$$;
create or replace function public.account_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.get_profile(null, p_user) || jsonb_build_object(
    'progress', jsonb_build_object(
      'keepsakes', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = p_user and kind = 'keepsake'), '[]'::jsonb),
      'landmarks', coalesce((select jsonb_agg(item order by item) from public.player_progress where user_id = p_user and kind = 'landmark'), '[]'::jsonb)),
    'social', public.social_snapshot(p_user),
    'owned', public.owned_items(p_user))
  where exists (select 1 from public.profiles where id = p_user)
$$;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.owns_item(uuid, text), public.owned_items(uuid), public.shop_create_order(uuid, text, numeric, text),
  public.shop_open_order(uuid, text), public.shop_fulfil(text, text, uuid, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.owned_items(uuid), public.shop_create_order(uuid, text, numeric, text), public.shop_open_order(uuid, text),
  public.shop_fulfil(text, text, uuid, text, numeric, text, text) to service_role;
