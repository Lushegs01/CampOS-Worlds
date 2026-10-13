// Database-level tests for profiles, progression, clubs and events against a real PostgreSQL 17
// server prepared like a Supabase project (see tests/support). Each call runs as the API role a
// real request would use, so Row Level Security, grants and the RPC functions are exercised.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, rpc, asRole } from './support/postgres.mjs';
import { MODELS, SKINS, ACCENTS, ACCESSORIES, LOCATIONS } from '../shared/campus.mjs';

let db;
before(async () => { db = await startDatabase({ name: 'community' }); }, { timeout: 180000 });
after(async () => { await db?.stop(); });

let seq = 0;
async function user(handle) {
  const email = `${handle ?? 'player'}-${++seq}-${Date.now()}@example.test`;
  const { rows } = await db.pool.query(`insert into auth.users (email, encrypted_password) values ($1, 'x') returning id`, [email]);
  const claims = { sub: rows[0].id, role: 'authenticated' };
  if (handle) await rpc(db.pool, 'save_profile', { p_handle: handle, p_display_name: handle[0].toUpperCase() + handle.slice(1), p_bio: '', p_avatar: {} }, claims);
  return claims;
}
const SERVICE = { role: 'service_role' };
const rejects = (promise, pattern) => assert.rejects(promise, e => { assert.match(e.message, pattern); return true; });
const unique = prefix => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);

// ---------------------------------------------------------------- profiles
test('a player creates, reads and edits their own profile', async () => {
  const ada = await user(), handle = unique('ada_');
  assert.equal(await rpc(db.pool, 'my_profile', {}, ada), null, 'no profile before onboarding');
  const created = await rpc(db.pool, 'save_profile', { p_handle: handle.toUpperCase(), p_display_name: '  Ada   Obi ', p_bio: 'Design student.', p_avatar: { model: 'ada', skin: '#7a4a31', accent: '#506b96', accessory: 'glasses' } }, ada);
  assert.equal(created.handle, handle, 'handles are stored lower-case');
  assert.equal(created.display_name, 'Ada Obi', 'display names are trimmed and whitespace collapsed');
  assert.deepEqual(created.progress, { keepsakes: [], landmarks: [] });
  const edited = await rpc(db.pool, 'save_profile', { p_handle: handle, p_display_name: 'Ada O.', p_bio: 'Design and code.', p_avatar: { model: 'amara' } }, ada);
  assert.equal(edited.bio, 'Design and code.');
  const card = await rpc(db.pool, 'get_profile', { p_handle: handle });
  assert.equal(card.display_name, 'Ada O.'); assert.equal(card.avatar.model, 'amara'); assert.ok(card.created_at);
  assert.equal(card.progress, undefined, 'private progress is not part of the public card');
});

test('handles are validated and unique, and reserved handles are refused', async () => {
  const a = await user(), b = await user(), handle = unique('tobi_');
  await rpc(db.pool, 'save_profile', { p_handle: handle, p_display_name: 'Tobi' }, a);
  await rejects(rpc(db.pool, 'save_profile', { p_handle: handle.toUpperCase(), p_display_name: 'Other Tobi' }, b), /taken/);
  assert.deepEqual(await rpc(db.pool, 'check_handle', { p_handle: handle }, b), { available: false, reason: 'That handle is taken.' });
  assert.equal((await rpc(db.pool, 'check_handle', { p_handle: handle }, a)).available, true, 'your own handle counts as available to you');
  for (const bad of ['ab', 'has space', 'émile', 'x'.repeat(21), 'dash-not-ok']) await rejects(rpc(db.pool, 'save_profile', { p_handle: bad, p_display_name: 'X' }, b), /3–20/);
  await rejects(rpc(db.pool, 'save_profile', { p_handle: 'admin', p_display_name: 'X' }, b), /reserved/);
  await rejects(rpc(db.pool, 'save_profile', { p_handle: unique('ok_'), p_display_name: '' }, b), /Display names/);
  await rejects(rpc(db.pool, 'save_profile', { p_handle: unique('ok_'), p_display_name: 'X', p_bio: 'b'.repeat(281) }, b), /280/);
  await rejects(rpc(db.pool, 'save_profile', { p_handle: unique('ok_'), p_display_name: 'X', p_avatar: { model: '../../etc/passwd' } }, b), /appearance/);
  await rejects(rpc(db.pool, 'save_profile', { p_handle: unique('ok_'), p_display_name: 'X', p_avatar: { model: 'ada', extra: 'x' } }, b), /appearance/);
});

test('the database avatar allowlist matches the game’s', async () => {
  for (const model of MODELS) for (const accessory of ACCESSORIES) assert.equal((await db.pool.query('select public.valid_avatar($1)', [{ model, accessory }])).rows[0].valid_avatar, true);
  for (const skin of SKINS) assert.equal((await db.pool.query('select public.valid_avatar($1)', [{ skin }])).rows[0].valid_avatar, true);
  for (const accent of ACCENTS) assert.equal((await db.pool.query('select public.valid_avatar($1)', [{ accent }])).rows[0].valid_avatar, true);
  const ids = (await db.pool.query('select id from public.campus_locations order by id')).rows.map(r => r.id);
  assert.deepEqual(ids, LOCATIONS.map(l => l.id).sort(), 'campus_locations mirrors LOCATIONS');
});

test('one player cannot edit another’s profile, and guests cannot write at all', async () => {
  const owner = await user(unique('own_')), intruder = await user(unique('int_'));
  const result = await asRole(db.pool, intruder, `update public.profiles set display_name = 'Hacked' where id = $1`, [owner.sub]);
  assert.equal(result.rowCount, 0, 'RLS hides other players’ rows from updates');
  await rejects(asRole(db.pool, intruder, `update public.profiles set created_at = now() - interval '9 years' where id = $1`, [intruder.sub]), /permission denied/);
  await rejects(asRole(db.pool, intruder, `insert into public.profiles (id, handle, display_name) values ($1, 'sneaky_one', 'S')`, [owner.sub]), /row-level security|duplicate key/);
  await rejects(rpc(db.pool, 'save_profile', { p_handle: unique('anon_'), p_display_name: 'Anon' }), /permission denied|Sign in/);
  assert.equal((await rpc(db.pool, 'get_profile', { p_id: owner.sub })).display_name.startsWith('Own'), true);
});

// ---------------------------------------------------------------- server-verified progression
test('players cannot award themselves progress or badges; the room server can', async () => {
  const p = await user(unique('prog_'));
  await rejects(rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'keepsake', p_item: 't1' }, p), /permission denied/);
  await rejects(rpc(db.pool, 'record_hoops_round', { p_user: p.sub, p_points: 15, p_made: 5 }, p), /permission denied/);
  await rejects(asRole(db.pool, p, `insert into public.achievements (user_id, achievement) values ($1, 'courtside')`, [p.sub]), /permission denied/);
  await rejects(asRole(db.pool, p, `insert into public.player_progress (user_id, kind, item) values ($1, 'keepsake', 't1')`, [p.sub]), /permission denied/);
  let awarded = [];
  for (const t of ['t1', 't2', 't3', 't4', 't5']) awarded.push(...(await rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'keepsake', p_item: t }, SERVICE)).awarded);
  assert.deepEqual(awarded, []);
  assert.deepEqual((await rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'keepsake', p_item: 't6' }, SERVICE)).awarded, ['curious-mind']);
  assert.deepEqual((await rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'keepsake', p_item: 't6' }, SERVICE)).awarded, [], 'replays award nothing');
  for (const l of ['orientation', 'landmark', 'library', 'student']) await rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'landmark', p_item: l }, SERVICE);
  assert.deepEqual((await rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'landmark', p_item: 'lecture' }, SERVICE)).awarded, ['campus-compass']);
  await rejects(rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'keepsake', p_item: 't9' }, SERVICE), /Unknown keepsake/);
  assert.deepEqual((await rpc(db.pool, 'record_hoops_round', { p_user: p.sub, p_points: 4, p_made: 2 }, SERVICE)).awarded, []);
  const round = await rpc(db.pool, 'record_hoops_round', { p_user: p.sub, p_points: 7, p_made: 3 }, SERVICE);
  assert.deepEqual(round.awarded, ['courtside']); assert.equal(round.best, 7);
  await rejects(rpc(db.pool, 'record_hoops_round', { p_user: p.sub, p_points: 40, p_made: 5 }, SERVICE), /Invalid round/);
  const mine = await rpc(db.pool, 'my_profile', {}, p);
  assert.deepEqual(mine.achievements.map(a => a.id).sort(), ['campus-compass', 'courtside', 'curious-mind']);
  assert.equal(mine.progress.keepsakes.length, 6); assert.equal(mine.stats.best_hoops_round, 7); assert.equal(mine.stats.hoops_rounds, 2);
  const other = await user(unique('peek_'));
  assert.equal((await asRole(db.pool, other, 'select * from public.player_progress where user_id = $1', [p.sub])).rowCount, 0, 'progress detail is private');
  assert.equal((await rpc(db.pool, 'get_profile', { p_id: p.sub }, other)).achievements.length, 3, 'badges are public');
});

// ---------------------------------------------------------------- clubs
const hours = h => new Date(Date.now() + h * 3600e3).toISOString();
async function club(owner, name = unique('Club ')) {
  return rpc(db.pool, 'create_club', { p_name: name, p_description: 'We meet weekly.', p_category: 'community', p_emblem: 'music', p_color: '#506b96' }, owner);
}

test('owners create, edit and delete their clubs; others cannot', async () => {
  const owner = await user(unique('own_')), other = await user(unique('oth_'));
  const c = await club(owner, unique('Chess '));
  assert.equal(c.my_role, 'owner'); assert.equal(c.member_count, 1); assert.equal(c.members[0].role, 'owner');
  const edited = await rpc(db.pool, 'update_club', { p_id: c.id, p_name: c.name + ' Society', p_description: 'Blitz on Fridays.', p_category: 'academic', p_emblem: 'book', p_color: '#2f4b40' }, owner);
  assert.equal(edited.category, 'academic');
  await rejects(rpc(db.pool, 'update_club', { p_id: c.id, p_name: 'Hijacked', p_description: '', p_category: 'arts', p_emblem: 'spark', p_color: '#2f4b40' }, other), /Only the club owner/);
  assert.equal((await asRole(db.pool, other, `update public.clubs set name = 'Hijacked' where id = $1`, [c.id])).rowCount, 0, 'RLS hides other owners clubs from updates');
  await rejects(asRole(db.pool, owner, `update public.clubs set owner_id = $2 where id = $1`, [c.id, other.sub]), /permission denied/);
  await rejects(rpc(db.pool, 'delete_club', { p_id: c.id }, other), /Only the club owner/);
  await rejects(rpc(db.pool, 'create_club', { p_name: c.name.toUpperCase() + ' SOCIETY', p_description: '', p_category: 'arts' }, other), /already exists/);
  await rejects(rpc(db.pool, 'create_club', { p_name: 'x', p_description: '', p_category: 'arts' }, other), /3–48/);
  await rejects(rpc(db.pool, 'create_club', { p_name: unique('Nope '), p_description: '', p_category: 'arts' }), /permission denied|Sign in/);
  assert.equal((await rpc(db.pool, 'delete_club', { p_id: c.id }, owner)).deleted, true);
  assert.equal(await rpc(db.pool, 'get_club', { p_id: c.id }), null);
});

test('memberships: join and leave are idempotent, duplicates are impossible, owners stay', async () => {
  const owner = await user(unique('own_')), a = await user(unique('mem_'));
  const c = await club(owner);
  await rpc(db.pool, 'join_club', { p_id: c.id }, a);
  const again = await rpc(db.pool, 'join_club', { p_id: c.id }, a);
  assert.equal(again.member_count, 2, 'joining twice keeps one membership'); assert.equal(again.my_role, 'member');
  await rejects(asRole(db.pool, a, `insert into public.club_members (club_id, user_id) values ($1, $2)`, [c.id, a.sub]), /permission denied/);
  await rejects(db.pool.query(`insert into public.club_members (club_id, user_id) values ($1, $2)`, [c.id, a.sub]), /duplicate key/);
  await rejects(rpc(db.pool, 'leave_club', { p_id: c.id }, owner), /Owners cannot leave/);
  assert.equal((await rpc(db.pool, 'leave_club', { p_id: c.id }, a)).member_count, 1);
  assert.equal((await rpc(db.pool, 'leave_club', { p_id: c.id }, a)).member_count, 1, 'leaving twice is harmless');
  const guest = await rpc(db.pool, 'get_club', { p_id: c.id });
  assert.equal(guest.my_role, null); assert.equal(guest.members.length, 1, 'clubs and members are readable without signing in');
});

test('owners designate organizers; only owners and organizers run events', async () => {
  const owner = await user(unique('own_')), org = await user(unique('org_')), mem = await user(unique('mem_')), out = await user(unique('out_'));
  const c = await club(owner);
  for (const p of [org, mem]) await rpc(db.pool, 'join_club', { p_id: c.id }, p);
  await rejects(rpc(db.pool, 'set_member_role', { p_club: c.id, p_user: mem.sub, p_role: 'organizer' }, org), /Only the club owner/);
  await rpc(db.pool, 'set_member_role', { p_club: c.id, p_user: org.sub, p_role: 'organizer' }, owner);
  await rejects(rpc(db.pool, 'set_member_role', { p_club: c.id, p_user: owner.sub, p_role: 'member' }, owner), /Only the club owner/, 'the owner row cannot be demoted');
  const args = { p_club: c.id, p_title: 'Open mic night', p_description: '', p_category: 'arts', p_location: 'student', p_starts_at: hours(24), p_ends_at: hours(26), p_capacity: null, p_publish: true };
  const ev = await rpc(db.pool, 'create_event', args, org);
  assert.equal(ev.status, 'published'); assert.equal(ev.organizer.id, org.sub); assert.ok(ev.can_manage);
  for (const p of [mem, out]) await rejects(rpc(db.pool, 'create_event', args, p), /owner and organizers/);
  await rejects(rpc(db.pool, 'update_event', { p_id: ev.id, p_title: 'Mine now', p_description: '', p_category: 'arts', p_location: 'student', p_starts_at: ev.starts_at, p_ends_at: ev.ends_at }, out), /owner and organizers/);
  await rejects(rpc(db.pool, 'set_event_status', { p_id: ev.id, p_status: 'canceled' }, mem), /owner and organizers/);
  await rejects(asRole(db.pool, org, `update public.events set title = 'Direct' where id = $1`, [ev.id]), /permission denied/, 'events change only through the checked functions');
  await rejects(asRole(db.pool, org, `insert into public.events (club_id, created_by, title, category, location_id, starts_at, ends_at) values ($1, $2, 'Sneaky', 'social', 'student', now() - interval '3 days', now() - interval '2 days')`, [c.id, org.sub]), /permission denied/);
  await rejects(rpc(db.pool, 'remove_member', { p_club: c.id, p_user: owner.sub }, org), /Only the club owner/);
  assert.equal((await rpc(db.pool, 'remove_member', { p_club: c.id, p_user: mem.sub }, owner)).member_count, 2);
});

test('creation limits: two clubs an hour and three per owner', async () => {
  const owner = await user(unique('lim_'));
  await club(owner); await club(owner);
  await rejects(club(owner), /this hour/);
  await db.pool.query(`update public.clubs set created_at = now() - interval '2 hours' where owner_id = $1`, [owner.sub]);
  await club(owner);
  await rejects(club(owner), /up to three clubs/);
});

// ---------------------------------------------------------------- events
async function event(manager, clubId, extra = {}) {
  return rpc(db.pool, 'create_event', { p_club: clubId, p_title: unique('Event '), p_description: 'All welcome.', p_category: 'social', p_location: 'landmark', p_starts_at: hours(2), p_ends_at: hours(3), p_capacity: null, p_publish: true, ...extra }, manager);
}

test('publication states: drafts stay private, canceled events stay visible and close RSVPs', async () => {
  const owner = await user(unique('own_')), viewer = await user(unique('view_'));
  const c = await club(owner);
  const draft = await event(owner, c.id, { p_publish: false });
  assert.equal(draft.status, 'draft');
  assert.equal(await rpc(db.pool, 'get_event', { p_id: draft.id }, viewer), null, 'drafts are invisible to others');
  assert.equal(await rpc(db.pool, 'get_event', { p_id: draft.id }), null, 'and to guests');
  await rejects(rpc(db.pool, 'rsvp_event', { p_id: draft.id }, viewer), /not available/);
  const published = await rpc(db.pool, 'set_event_status', { p_id: draft.id, p_status: 'published' }, owner);
  assert.equal(published.status, 'published'); assert.ok(published.published_at);
  assert.equal((await rpc(db.pool, 'get_event', { p_id: draft.id })).title, draft.title, 'published events are readable without signing in');
  await rpc(db.pool, 'rsvp_event', { p_id: draft.id }, viewer);
  const canceled = await rpc(db.pool, 'set_event_status', { p_id: draft.id, p_status: 'canceled' }, owner);
  assert.equal(canceled.status, 'canceled'); assert.ok(canceled.canceled_at);
  assert.equal((await rpc(db.pool, 'get_event', { p_id: draft.id }, viewer)).status, 'canceled', 'canceled events remain visible');
  await rejects(rpc(db.pool, 'rsvp_event', { p_id: draft.id }, await user(unique('late_'))), /canceled/);
  await rejects(rpc(db.pool, 'set_event_status', { p_id: draft.id, p_status: 'published' }, owner), /Canceled events cannot be changed/);
  await rejects(rpc(db.pool, 'update_event', { p_id: draft.id, p_title: 'Back on', p_description: '', p_category: 'social', p_location: 'landmark', p_starts_at: canceled.starts_at, p_ends_at: canceled.ends_at }, owner), /Canceled events cannot be changed/);
  await rejects(rpc(db.pool, 'delete_event', { p_id: draft.id }, owner), /Only drafts/);
  const another = await event(owner, c.id, { p_publish: false });
  assert.equal((await rpc(db.pool, 'delete_event', { p_id: another.id }, owner)).deleted, true);
});

test('event validation: times, lengths, capacity and campus locations', async () => {
  const owner = await user(unique('own_')), c = await club(owner);
  await rejects(event(owner, c.id, { p_starts_at: hours(3), p_ends_at: hours(2) }), /end after it starts/);
  await rejects(event(owner, c.id, { p_starts_at: hours(1), p_ends_at: hours(14) }), /12 hours/);
  await rejects(event(owner, c.id, { p_starts_at: hours(-3), p_ends_at: hours(-2) }), /in the future/);
  await rejects(event(owner, c.id, { p_starts_at: hours(24 * 400), p_ends_at: hours(24 * 400 + 1) }), /year ahead/);
  await rejects(event(owner, c.id, { p_title: 'ab' }), /3–80/);
  await rejects(event(owner, c.id, { p_capacity: 0 }), /1–500/);
  await rejects(event(owner, c.id, { p_location: 'mars' }), /campus location/);
  const ok = await event(owner, c.id, { p_capacity: 2 });
  assert.equal(ok.location.name, 'The Confluence');
  for (const p of [await user(unique('a_')), await user(unique('b_'))]) await rpc(db.pool, 'rsvp_event', { p_id: ok.id }, p);
  await rejects(rpc(db.pool, 'update_event', { p_id: ok.id, p_title: ok.title, p_description: '', p_category: 'social', p_location: 'landmark', p_starts_at: ok.starts_at, p_ends_at: ok.ends_at, p_capacity: 1 }, owner), /2 people are already going/);
});

test('RSVP and cancel; capacity is enforced and RSVPs are idempotent', async () => {
  const owner = await user(unique('own_')), c = await club(owner);
  const ev = await event(owner, c.id, { p_capacity: 2 });
  const [a, b, d] = [await user(unique('a_')), await user(unique('b_')), await user(unique('d_'))];
  assert.equal((await rpc(db.pool, 'rsvp_event', { p_id: ev.id }, a)).going, true);
  assert.equal((await rpc(db.pool, 'rsvp_event', { p_id: ev.id }, a)).attendee_count, 1, 'a second RSVP changes nothing');
  await rpc(db.pool, 'rsvp_event', { p_id: ev.id }, b);
  await rejects(rpc(db.pool, 'rsvp_event', { p_id: ev.id }, d), /full/);
  const left = await rpc(db.pool, 'cancel_rsvp', { p_id: ev.id }, a);
  assert.equal(left.going, false); assert.equal(left.attendee_count, 1);
  assert.equal((await rpc(db.pool, 'rsvp_event', { p_id: ev.id }, d)).attendee_count, 2, 'a freed place can be taken');
  await rejects(asRole(db.pool, d, `insert into public.event_rsvps (event_id, user_id) values ($1, $2)`, [ev.id, a.sub]), /permission denied/);
  assert.equal((await asRole(db.pool, d, `delete from public.event_rsvps where event_id = $1 and user_id = $2`, [ev.id, b.sub])).rowCount, 0, 'nobody can cancel someone else’s RSVP');
  const detail = await rpc(db.pool, 'get_event', { p_id: ev.id });
  assert.equal(detail.attendees.length, 2); assert.ok(detail.attendees.every(p => p.handle && !('email' in p)), 'attendee cards are public profiles only');
  await db.pool.query(`update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`, [ev.id]);
  await rpc(db.pool, 'cancel_rsvp', { p_id: ev.id }, b);
  await rejects(rpc(db.pool, 'rsvp_event', { p_id: ev.id }, b), /already ended/);
});

test('capacity holds under truly concurrent RSVPs', async () => {
  const owner = await user(unique('own_')), c = await club(owner);
  const ev = await event(owner, c.id, { p_capacity: 10 });
  const people = await Promise.all(Array.from({ length: 25 }, (_, i) => user(unique(`rush${i}_`))));
  // 25 requests race on separate pooled connections; each runs rsvp_event in its own transaction.
  const outcomes = await Promise.allSettled(people.map(p => rpc(db.pool, 'rsvp_event', { p_id: ev.id }, p)));
  const ok = outcomes.filter(o => o.status === 'fulfilled').length, full = outcomes.filter(o => o.status === 'rejected' && /full/.test(o.reason.message)).length;
  assert.equal(ok, 10, 'exactly the capacity got in'); assert.equal(full, 15, 'everyone else was told it is full');
  assert.equal((await db.pool.query('select count(*)::int as n from public.event_rsvps where event_id = $1', [ev.id])).rows[0].n, 10);
});

test('listing: filters, upcoming and past, going, and paging limits', async () => {
  const owner = await user(unique('own_')), fan = await user(unique('fan_')), c = await club(owner, unique('Listing '));
  const sport = await event(owner, c.id, { p_category: 'sports', p_location: 'sports', p_starts_at: hours(5), p_ends_at: hours(6) });
  const talk = await event(owner, c.id, { p_category: 'academic', p_location: 'lecture', p_starts_at: hours(30), p_ends_at: hours(31) });
  const past = await event(owner, c.id, { p_starts_at: hours(1), p_ends_at: hours(2) });
  await db.pool.query(`update public.events set starts_at = now() - interval '5 hours', ends_at = now() - interval '4 hours' where id = $1`, [past.id]);
  await rpc(db.pool, 'rsvp_event', { p_id: talk.id }, fan);
  assert.deepEqual((await rpc(db.pool, 'list_events', { p_club: c.id }, fan)).map(e => e.id), [sport.id, talk.id], 'upcoming, soonest first');
  assert.deepEqual((await rpc(db.pool, 'list_events', { p_when: 'past', p_club: c.id })).map(e => e.id), [past.id]);
  assert.deepEqual((await rpc(db.pool, 'list_events', { p_category: 'sports', p_club: c.id })).map(e => e.id), [sport.id]);
  assert.deepEqual((await rpc(db.pool, 'list_events', { p_location: 'lecture', p_club: c.id })).map(e => e.id), [talk.id]);
  assert.deepEqual((await rpc(db.pool, 'list_events', { p_going: true }, fan)).map(e => e.id), [talk.id]);
  assert.deepEqual((await rpc(db.pool, 'list_events', { p_to: hours(12), p_club: c.id })).map(e => e.id), [sport.id], 'date window');
  assert.ok((await rpc(db.pool, 'list_events', { p_limit: 1000 })).length <= 50, 'page size is capped');
  assert.equal((await rpc(db.pool, 'list_clubs', { p_search: c.name.slice(-6) })).length, 1);
  assert.equal((await rpc(db.pool, 'list_clubs', { p_search: '%' })).every(x => x.name.includes('%')), true, 'search wildcards are literal');
  assert.ok((await rpc(db.pool, 'list_clubs', { p_mine: true }, owner)).some(x => x.id === c.id));
  assert.equal((await rpc(db.pool, 'get_profile', { p_id: owner.sub })).clubs[0].role, 'owner');
});

test('deleting an organizer’s account keeps their club’s events and removes their profile', async () => {
  const owner = await user(unique('own_')), org = await user(unique('org_')), c = await club(owner);
  await rpc(db.pool, 'join_club', { p_id: c.id }, org);
  await rpc(db.pool, 'set_member_role', { p_club: c.id, p_user: org.sub, p_role: 'organizer' }, owner);
  const ev = await event(org, c.id);
  await rpc(db.pool, 'set_event_status', { p_id: ev.id, p_status: 'canceled' }, owner);
  await db.pool.query('delete from auth.users where id = $1', [org.sub]);
  const after = await rpc(db.pool, 'get_event', { p_id: ev.id });
  assert.equal(after.organizer, null); assert.equal(after.status, 'canceled', 'the event survives its organizer’s account');
  assert.equal(await rpc(db.pool, 'get_profile', { p_id: org.sub }), null);
});
