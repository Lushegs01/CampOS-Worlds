-- Metropolitan City: the off-campus world reached through the South Gate (shared/metro.mjs METRO_LOCATIONS).
-- Additive only; the Getaway contact keeps its id with its new name.
insert into public.campus_locations (id, name) values
  ('metro-entrance', 'Metropolitan City'),
  ('metro-downtown', 'Downtown'),
  ('metro-police', 'Metro Police Central'),
  ('metro-residential', 'Residential District'),
  ('industrial-contact', 'The Getaway · Contact')
on conflict (id) do update set name = excluded.name;
