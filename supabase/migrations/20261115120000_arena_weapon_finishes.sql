-- CampOS Worlds · Combat Arena: a weapon finish at every weapon level.
--
-- Weapon levels 2 to 10 now each unlock a finish (the game's catalogue, shared/arena/weapons.mjs `SKINS`), so
-- every level-up has something to show in the after-action report. Additive: the five existing finishes keep
-- their ids and levels; save_arena_loadout already checks any finish against arena_catalog and the weapon's
-- level, and record_arena_match already leaves finishes out of player-level unlocks.
insert into public.arena_catalog (id, kind, slot, category, unlock_level) values
  ('slate', 'skin', null, null, 2),
  ('dune', 'skin', null, null, 4),
  ('fieldcraft', 'skin', null, null, 6),
  ('cobalt', 'skin', null, null, 8),
  ('arctic', 'skin', null, null, 9)
on conflict (id) do update set kind = excluded.kind, unlock_level = excluded.unlock_level;
