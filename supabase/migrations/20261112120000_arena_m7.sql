-- M7 is free for every player, per the final product decision. Additive: no existing
-- loadout, entitlement, weapon statistics or stable network weapon index is changed.
insert into public.arena_catalog (id, kind, slot, category, unlock_level, premium)
values ('m7', 'weapon', 'primary', 'battle', 1, false)
on conflict (id) do update set category = excluded.category, unlock_level = 1, premium = false;
-- Intentionally no shop item or legacy/purchase grant: this weapon needs no purchase.
