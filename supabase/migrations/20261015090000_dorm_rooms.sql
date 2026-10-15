-- Personal rooms in Palm House (docs/DORM-ROOMS.md). Each signed-in player has one room layout: the
-- furniture they placed. The room server checks every layout against the shared rules
-- (shared/dorm.mjs: catalogue, room bounds, overlaps, a clear doorway) and is the only writer, through
-- the service-role functions below. Players cannot read or write the table directly.

create table public.dorm_rooms (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  layout jsonb not null,
  updated_at timestamptz not null default now(),
  -- A backstop for the room server's checks: an object with at most 16 items, and small.
  constraint dorm_layout_shape check (
    jsonb_typeof(layout) = 'object' and jsonb_typeof(layout -> 'items') = 'array'
    and jsonb_array_length(layout -> 'items') <= 16 and octet_length(layout::text) <= 4096)
);
alter table public.dorm_rooms enable row level security;
revoke all on public.dorm_rooms from anon, authenticated;

create or replace function public.dorm_layout(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select layout from public.dorm_rooms where user_id = p_user
$$;

create or replace function public.save_dorm_layout(p_user uuid, p_layout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception using errcode = 'P0002', message = 'Create your profile to keep your room.';
  end if;
  insert into public.dorm_rooms (user_id, layout) values (p_user, p_layout)
  on conflict (user_id) do update set layout = excluded.layout, updated_at = now();
  return jsonb_build_object('saved', true);
end $$;

revoke all on function public.dorm_layout(uuid), public.save_dorm_layout(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.dorm_layout(uuid), public.save_dorm_layout(uuid, jsonb) to service_role;
