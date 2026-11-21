insert into public.campus_locations (id, name)
values ('harbour-exchange', 'Harbour Exchange')
on conflict (id) do update set name = excluded.name;
