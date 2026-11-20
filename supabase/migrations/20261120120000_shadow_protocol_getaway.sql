insert into public.campus_locations (id, name) values ('industrial-contact', 'Industrial District');

-- Campaign rewards are a per-mission ledger. A signed-in player's balance is the sum of their
-- rewards, and the first completion is the permanent receipt for this mission.
create table public.shadow_getaway (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  checkpoint jsonb,
  completion jsonb,
  completed_at timestamptz,
  xp integer not null default 0 check (xp >= 0),
  credits integer not null default 0 check (credits >= 0)
);
alter table public.shadow_getaway enable row level security;
revoke all on public.shadow_getaway from public, anon, authenticated;

create function public.getaway_status(p_user uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('checkpoint',checkpoint,'completion',completion,'xp',xp,'credits',credits)
  from public.shadow_getaway where user_id = p_user
$$;

create function public.getaway_checkpoint(p_user uuid, p_checkpoint jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_checkpoint is not null and
     (jsonb_typeof(p_checkpoint) <> 'object' or coalesce((p_checkpoint->>'stage')::integer, -1) not in (1,4,6,8)) then
    raise exception 'Invalid Getaway checkpoint' using errcode = '22023';
  end if;
  insert into public.shadow_getaway(user_id,checkpoint) values(p_user,p_checkpoint)
  on conflict(user_id) do update set checkpoint = excluded.checkpoint;
end $$;

create function public.getaway_complete(p_user uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare receipt jsonb; first_run boolean;
begin
  if p_report is null or jsonb_typeof(p_report) <> 'object' or
     coalesce((p_report->>'duration')::numeric, 0) <= 0 or
     coalesce((p_report->>'defeated')::integer, 0) <> 5 or
     coalesce((p_report->>'distance')::integer, 0) < 75 then
    raise exception 'Invalid Getaway result' using errcode = '22023';
  end if;
  insert into public.shadow_getaway(user_id) values(p_user) on conflict do nothing;
  select completion into receipt from public.shadow_getaway where user_id=p_user for update;
  first_run := receipt is null;
  if first_run then
    receipt := jsonb_build_object('report',p_report,'xp',500,'credits',250,'chapter',1,
      'milestone','Loose ends','unlock','Shadow Protocol • Next contact','completedAt',now());
    update public.shadow_getaway set completion=receipt,completed_at=now(),checkpoint=null,xp=500,credits=250
      where user_id=p_user;
  else
    update public.shadow_getaway set checkpoint=null where user_id=p_user;
  end if;
  return jsonb_build_object('first',first_run,'completion',receipt);
end $$;

revoke all on function public.getaway_status(uuid), public.getaway_checkpoint(uuid,jsonb), public.getaway_complete(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.getaway_status(uuid), public.getaway_checkpoint(uuid,jsonb), public.getaway_complete(uuid,jsonb) to service_role;
