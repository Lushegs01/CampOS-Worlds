-- Reuse existing location authorization for discovery, events and account-backed progress.
-- Economic balances/evidence are room-server records, never client-writable profile data.
insert into public.campus_locations (id,name) values
  ('economic-lab','Economic Simulation Lab')
on conflict (id) do update set name=excluded.name;
