-- Visits to players' rooms in Palm House (docs/DORM-ROOMS.md): who may come in is a privacy setting.
--   'invite'  only friends the resident invites (the default)
--   'friends' any friend may also drop in while the resident is in their room
-- Visits are always friends only, never while either player has blocked the other, and only while the
-- resident is in. The room server enforces them; this stores the choice with the other privacy settings.

alter table public.player_settings add column room_visits text not null default 'invite';
alter table public.player_settings add constraint player_settings_room_visits check (room_visits in ('invite', 'friends'));

create or replace function public.settings_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('friend_requests', s.friend_requests, 'direct_messages', s.direct_messages, 'party_invites', s.party_invites,
    'appear_offline', s.appear_offline, 'profile_visibility', s.profile_visibility, 'room_visits', s.room_visits)
  from public.player_settings s where s.user_id = p_user
$$;

-- The same function with one more, optional choice. Left out (an older client), room_visits keeps its value.
drop function public.save_social_settings(text, text, text, boolean, text);
create or replace function public.save_social_settings(p_friend_requests text, p_direct_messages text, p_party_invites text, p_appear_offline boolean,
  p_profile_visibility text default 'public', p_room_visits text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.require_profile(uid, 'change privacy settings');
  if p_friend_requests not in ('everyone', 'nobody') or p_direct_messages not in ('friends', 'nobody') or p_party_invites not in ('everyone', 'friends', 'nobody')
     or p_appear_offline is null or p_profile_visibility not in ('public', 'friends') or (p_room_visits is not null and p_room_visits not in ('invite', 'friends')) then
    raise exception using errcode = '22023', message = 'Choose one of the listed privacy options.';
  end if;
  update public.player_settings set friend_requests = p_friend_requests, direct_messages = p_direct_messages, party_invites = p_party_invites,
    appear_offline = p_appear_offline, profile_visibility = p_profile_visibility, room_visits = coalesce(p_room_visits, room_visits)
  where user_id = uid;
  return public.settings_json(uid);
end $$;

revoke all on function public.save_social_settings(text, text, text, boolean, text, text) from public, anon;
grant execute on function public.save_social_settings(text, text, text, boolean, text, text) to authenticated;
