-- A ninth selectable character, Mel (Microsoft Rocketbox Female_Adult_11, MIT; docs/ASSETS.md).
-- Profiles may now save her: the same allowlist as before plus 'mel' (kept in step with
-- MODELS in shared/campus.mjs, which the room server and the client use).
create or replace function public.valid_avatar(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(a) = 'object'
    and not exists (select 1 from jsonb_object_keys(a) k where k not in ('model', 'skin', 'accent', 'accessory'))
    and coalesce(a ->> 'model', 'tunde') in ('tunde', 'amara', 'chidi', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada', 'mel')
    and coalesce(a ->> 'skin', 'natural') in ('natural', '#3a2219', '#5b3424', '#7a4a31', '#a66b46', '#cb9168')
    and coalesce(a ->> 'accent', '#353c4c') in ('#353c4c', '#537d70', '#b05f49', '#506b96', '#e8b95e', '#eee9df', '#3f7f8c', '#c9a24a', '#7a4f9a', '#9b5b2a')
    and coalesce(a ->> 'accessory', 'backpack') in ('none', 'backpack', 'headphones', 'glasses')
$$;
