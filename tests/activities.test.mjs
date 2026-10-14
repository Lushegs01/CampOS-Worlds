// Database tests for titles, earned accents, interests, profile visibility, in-game event check-in,
// event templates, challenge results and room-measured achievements.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startDatabase, rpc, asRole } from './support/postgres.mjs';
import { CHALLENGES } from '../shared/challenges.mjs';
import { INTERESTS } from '../shared/profile.mjs';
import { ACCENTS, EARNED_ACCENTS } from '../shared/campus.mjs';

let db;
before(async () => { db = await startDatabase({ name: 'activities' }); }, { timeout: 180000 });
after(async () => { await db?.stop(); });
let seq = 0;
const unique = prefix => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
async function player(prefix = 'p_', extra = {}) {
  const handle = unique(prefix);
  const { rows } = await db.pool.query(`insert into auth.users (email, encrypted_password) values ($1, 'x') returning id`, [`${handle}@example.test`]);
  const claims = { sub: rows[0].id, role: 'authenticated', handle };
  await rpc(db.pool, 'save_profile', { p_handle: handle, p_display_name: handle, p_bio: 'Hello there.', p_avatar: {}, ...extra }, claims);
  return claims;
}
const SERVICE = { role: 'service_role' };
const rejects = (promise, pattern) => assert.rejects(promise, e => { assert.match(e.message, pattern); return true; });
const award = (p, a) => db.pool.query('insert into public.achievements (user_id, achievement) values ($1, $2) on conflict do nothing', [p.sub, a]);
const save = (p, extra) => rpc(db.pool, 'save_profile', { p_handle: p.handle, p_display_name: p.handle, p_bio: 'Hello there.', p_avatar: {}, ...extra }, p);

test('titles and earned accents must be earned first; interests come from a fixed list', async () => {
  const p = await player('ttl_');
  await rejects(save(p, { p_title: 'court-champion' }), /once you have earned/);
  await rejects(save(p, { p_avatar: { accent: '#c9a24a' } }), /unlocks with the Court Champion badge/);
  await award(p, 'court-champion');
  const saved = await save(p, { p_title: 'court-champion', p_avatar: { accent: '#c9a24a' }, p_interests: ['music', 'basketball', 'music'] });
  assert.equal(saved.title, 'court-champion'); assert.equal(saved.avatar.accent, '#c9a24a');
  assert.deepEqual(saved.interests, ['basketball', 'music'], 'deduplicated and sorted');
  await rejects(save(p, { p_interests: ['basketball', 'hacking'] }), /interests/);
  await rejects(save(p, { p_interests: INTERESTS.slice(0, 6) }), /up to five/);
  await rejects(save(p, { p_title: 'not-a-badge' }), /earned/);
  await rejects(asRole(db.pool, p, `update public.profiles set title = 'road-tripper' where id = $1`, [p.sub]), /earned its badge/, 'a direct update cannot show an unearned title');
  await rejects(asRole(db.pool, p, `update public.profiles set avatar = '{"accent":"#9b5b2a"}' where id = $1`, [p.sub]), /unlocks with the Road Tripper badge/, 'nor wear an unearned accent');
  // The allowlists agree with the game's.
  for (const accent of [...ACCENTS, ...EARNED_ACCENTS]) assert.equal((await db.pool.query('select public.valid_avatar($1)', [{ accent }])).rows[0].valid_avatar, true);
});

test('a friends-only profile shows bio and interests to friends only, and bio is never readable directly', async () => {
  const owner = await player('vis_', { p_interests: ['film'] }), friend = await player('vf_'), stranger = await player('vs_');
  await rpc(db.pool, 'save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: false, p_profile_visibility: 'friends' }, owner);
  await rpc(db.pool, 'send_friend_request', { p_handle: owner.handle }, friend);
  const req = (await rpc(db.pool, 'social_overview', {}, owner)).incoming[0];
  await rpc(db.pool, 'respond_friend_request', { p_request: req.id, p_accept: true }, owner);
  const asStranger = await rpc(db.pool, 'get_profile', { p_handle: owner.handle }, stranger), asAnon = await rpc(db.pool, 'get_profile', { p_handle: owner.handle });
  for (const card of [asStranger, asAnon]) { assert.equal(card.limited, true); assert.equal(card.bio, ''); assert.deepEqual(card.interests, []); assert.equal(card.display_name, owner.handle); }
  const asFriend = await rpc(db.pool, 'get_profile', { p_handle: owner.handle }, friend);
  assert.equal(asFriend.limited, false); assert.equal(asFriend.bio, 'Hello there.'); assert.deepEqual(asFriend.interests, ['film']);
  assert.equal((await rpc(db.pool, 'my_profile', {}, owner)).bio, 'Hello there.', 'you always see your own');
  await rejects(asRole(db.pool, stranger, 'select bio from public.profiles where id = $1', [owner.sub]), /permission denied/);
  await rejects(asRole(db.pool, null, 'select interests from public.profiles'), /permission denied/);
  assert.equal((await asRole(db.pool, stranger, 'select handle from public.profiles where id = $1', [owner.sub])).rows[0].handle, owner.handle, 'public columns stay readable');
});

// ---------------------------------------------------------------- events
const minutes = m => new Date(Date.now() + m * 60000).toISOString();
const clubs = new Map();
async function liveEvent(owner, { starts = -5, ends = 60, location = 'sports', template = 'basketball-tournament' } = {}) {
  if (!clubs.has(owner.sub)) clubs.set(owner.sub, await rpc(db.pool, 'create_club', { p_name: unique('Club '), p_description: '', p_category: 'sports' }, owner));
  const club = clubs.get(owner.sub);
  // Created in the future (the API refuses past starts), then moved to the wanted time directly.
  const ev = await rpc(db.pool, 'create_event', { p_club: club.id, p_title: 'Pick-up games', p_description: '', p_category: 'sports', p_location: location, p_starts_at: minutes(30), p_ends_at: minutes(90), p_publish: true, p_template: template }, owner);
  await db.pool.query('update public.events set starts_at = $2, ends_at = $3 where id = $1', [ev.id, minutes(starts), minutes(ends)]);
  return ev;
}
const checkin = (p, ev, location = 'sports') => rpc(db.pool, 'record_event_checkin', { p_user: p.sub, p_event: ev.id, p_location: location }, SERVICE);

test('in-game check-in: only the room server, only at the right place and time, once per player', async () => {
  const org = await player('org_'), a = await player('att_');
  const ev = await liveEvent(org);
  assert.equal(ev.template, 'basketball-tournament');
  await rejects(rpc(db.pool, 'record_event_checkin', { p_user: a.sub, p_event: ev.id, p_location: 'sports' }, a), /permission denied/);
  await rejects(checkin(a, ev, 'library'), /another campus location/);
  const first = await checkin(a, ev);
  assert.equal(first.checked_in, true); assert.equal(first.new, true);
  assert.equal((await checkin(a, ev)).new, false, 'checking in twice is harmless');
  const card = await rpc(db.pool, 'get_event', { p_id: ev.id }, a);
  assert.equal(card.checked_in, true); assert.equal(card.checked_in_count, 1); assert.equal(card.checked_in_players[0].id, a.sub);
  const early = await liveEvent(org, { starts: 30, ends: 90 }), ended = await liveEvent(org, { starts: -120, ends: -60 }), soon = await liveEvent(org, { starts: 10, ends: 70 });
  await rejects(checkin(a, early), /opens 15 minutes before/);
  await rejects(checkin(a, ended), /has ended/);
  assert.equal((await checkin(a, soon)).checked_in, true, 'check-in opens 15 minutes early');
  const canceled = await liveEvent(org);
  await rpc(db.pool, 'set_event_status', { p_id: canceled.id, p_status: 'canceled' }, org);
  await rejects(checkin(a, canceled), /canceled/);
  await rejects(rpc(db.pool, 'create_event', { p_club: clubs.get(org.sub).id, p_title: 'Odd', p_description: '', p_category: 'social', p_location: 'sports', p_starts_at: minutes(30), p_ends_at: minutes(60), p_template: 'rave' }, org), /template/);
});

test('Regular after 3 events; Community Builder for the organiser when 3 others check in', async () => {
  const org = await player('cb_'), players = [await player('r_'), await player('r_'), await player('r_')];
  const ev = await liveEvent(org);
  assert.equal((await checkin(org, ev)).organizer, null, 'the organiser’s own check-in does not count');
  const results = [];
  for (const p of players) results.push(await checkin(p, ev));
  assert.equal(results[2].organizer, org.sub, 'the third other player completes it');
  assert.ok((await db.pool.query(`select 1 from public.achievements where user_id = $1 and achievement = 'community-builder'`, [org.sub])).rowCount);
  const regular = players[0];
  await checkin(regular, await liveEvent(org, { location: 'library', template: 'study-group' }), 'library');
  assert.deepEqual((await checkin(regular, await liveEvent(org, { location: 'student', template: 'club-meetup' }), 'student')).awarded, ['regular']);
  assert.equal((await rpc(db.pool, 'get_profile', { p_id: regular.sub })).events_attended, 3);
});

// ---------------------------------------------------------------- challenges and room achievements
test('challenge times: limits match the game, repeats of a run count once, Road Tripper on the Campus Loop', async () => {
  const p = await player('ch_');
  for (const ch of CHALLENGES) {
    await rejects(rpc(db.pool, 'record_challenge', { p_user: p.sub, p_challenge: ch.id, p_ms: ch.minMs - 1, p_run: randomUUID() }, SERVICE), /Invalid challenge time/);
    await rejects(rpc(db.pool, 'record_challenge', { p_user: p.sub, p_challenge: ch.id, p_ms: ch.timeLimitMs + 1, p_run: randomUUID() }, SERVICE), /Invalid challenge time/);
  }
  await rejects(rpc(db.pool, 'record_challenge', { p_user: p.sub, p_challenge: 'moon-landing', p_ms: 60000, p_run: randomUUID() }, SERVICE), /Unknown challenge/);
  await rejects(rpc(db.pool, 'record_challenge', { p_user: p.sub, p_challenge: 'campus-loop', p_ms: 300000, p_run: randomUUID() }, p), /permission denied/);
  const run = randomUUID();
  const first = await rpc(db.pool, 'record_challenge', { p_user: p.sub, p_challenge: 'campus-loop', p_ms: 400000, p_run: run }, SERVICE);
  assert.deepEqual(first.awarded, ['road-tripper']); assert.equal(first.personal_best, true);
  const again = await rpc(db.pool, 'record_challenge', { p_user: p.sub, p_challenge: 'campus-loop', p_ms: 400000, p_run: run }, SERVICE);
  assert.equal(again.duplicate, true);
  const faster = await rpc(db.pool, 'record_challenge', { p_user: p.sub, p_challenge: 'campus-loop', p_ms: 350000, p_run: randomUUID() }, SERVICE);
  assert.equal(faster.best_ms, 350000); assert.equal(faster.personal_best, true); assert.deepEqual(faster.awarded, []);
  const row = (await db.pool.query(`select * from public.challenge_results where user_id = $1`, [p.sub])).rows[0];
  assert.equal(row.completions, 2, 'the repeated report did not count'); assert.equal(row.best_ms, 350000);
  const board = await rpc(db.pool, 'challenge_board', { p_challenge: 'campus-loop' }, p);
  assert.equal(board.me.best_ms, 350000); assert.ok(board.best.some(r => r.id === p.sub));
});

test('room-measured achievements are limited to the ones the room can measure', async () => {
  const p = await player('bt_');
  await rejects(rpc(db.pool, 'record_room_achievement', { p_user: p.sub, p_achievement: 'better-together' }, p), /permission denied/);
  await rejects(rpc(db.pool, 'record_room_achievement', { p_user: p.sub, p_achievement: 'court-champion' }, SERVICE), /Not a room achievement/);
  assert.deepEqual((await rpc(db.pool, 'record_room_achievement', { p_user: p.sub, p_achievement: 'better-together' }, SERVICE)).awarded, ['better-together']);
  assert.deepEqual((await rpc(db.pool, 'record_room_achievement', { p_user: p.sub, p_achievement: 'better-together' }, SERVICE)).awarded, []);
});
