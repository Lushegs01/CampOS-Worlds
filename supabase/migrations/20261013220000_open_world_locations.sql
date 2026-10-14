-- New destinations reuse the existing event scheduling and location permissions.
insert into public.campus_locations (id,name) values
('academic-0','Senate & Student Services'),
('academic-1','Akinola Lecture Hall'),
('academic-2','Faculty of Engineering'),
('residential-0','Palm House · Common Room'),
('residential-1','Neem House · Common Room'),
('residential-2','Residence Study Lounge'),
('recreation-0','Sports Pavilion'),
('recreation-1','Team House'),
('recreation-2','Recreation Clubhouse'),
('learning-0','Research Reading Room'),
('learning-1','Seminar House'),
('learning-2','Learning Studio'),
('student-life-0','Union Hall & Clubs'),
('student-life-1','Village Café'),
('student-life-2','Arts Workshop'),
('gateway-0','Transport Terminal'),
('gateway-1','Visitors Centre'),
('gateway-2','Campus Discovery Hall')
on conflict (id) do update set name=excluded.name;
