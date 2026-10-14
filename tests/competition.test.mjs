// Database tests for the achievement catalogue, Court Duel results, ratings and the leaderboard,
// against a real PostgreSQL 17 prepared like a Supabase project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startDatabase, rpc, asRole } from './support/postgres.mjs';
import { ACHIEVEMENTS } from '../shared/achievements.mjs';
import { LOCATIONS } from '../shared/campus.mjs';

let db;
before(async () => { db = await startDatabase({ name: 'competition' }); }, { timeout: 180000 });
after(async () => { await db?.stop(); });

let seq = 0;
const unique = prefix => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
async function player(prefix = 'p_') {
  const handle = unique(prefix);
  const { rows } = await db.pool.query(`insert into auth.users (email, encrypted_password) values ($1, 'x') returning id`, [`${handle}@example.test`]);
  const claims = { sub: rows[0].id, role: 'authenticated', handle };
  await rpc(db.pool, 'save_profile', { p_handle: handle, p_display_name: handle, p_bio: '', p_avatar: {} }, claims);
  return claims;
}
const SERVICE = { role: 'service_role' };
const rejects = (promise, pattern) => assert.rejects(promise, e => { assert.match(e.message, pattern); return true; });
const minutesAgo = m => new Date(Date.now() - m * 60000).toISOString();
function duel(a, b, scoreA, scoreB, extra = {}) {
  return rpc(db.pool, 'record_duel', { p_match: randomUUID(), p_player_a: a.sub, p_player_b: b.sub, p_score_a: scoreA, p_score_b: scoreB, p_outcome: 'time', p_forfeit_by: null, p_started_at: minutesAgo(2), p_ended_at: minutesAgo(1), ...extra }, SERVICE);
}
const rating = async p => (await db.pool.query('select * from public.duel_ratings where user_id = $1', [p.sub])).rows[0];
const badges = async p => (await db.pool.query('select achievement from public.achievements where user_id = $1 order by achievement', [p.sub])).rows.map(r => r.achievement);

test('the database achievement catalogue mirrors the game’s', async () => {
  const rows = (await db.pool.query('select id, name, category, rule, title, accent from public.achievement_catalog order by id')).rows;
  assert.deepEqual(rows, ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, category: a.category, rule: a.rule, title: a.title, accent: a.accent ?? null })).sort((x, y) => x.id.localeCompare(y.id)));
  const p = await player();
  await rejects(db.pool.query(`insert into public.achievements (user_id, achievement) values ($1, 'made-up')`, [p.sub]), /achievements_catalog_fk/);
  assert.equal((await asRole(db.pool, null, 'select count(*)::int as n from public.achievement_catalog')).rows[0].n, ACHIEVEMENTS.length, 'the catalogue is public');
});

test('Campus Explorer is awarded at 12 distinct server-verified destinations, once', async () => {
  const p = await player('exp_'), awarded = [];
  for (const l of LOCATIONS.slice(0, 13)) awarded.push(...(await rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'landmark', p_item: l.id }, SERVICE)).awarded);
  assert.deepEqual(awarded.filter(a => a === 'campus-explorer'), ['campus-explorer']);
  assert.deepEqual((await rpc(db.pool, 'record_progress', { p_user: p.sub, p_kind: 'landmark', p_item: LOCATIONS[0].id }, SERVICE)).awarded, [], 'replays award nothing');
});

test('a first friendship awards Good Company to both players', async () => {
  const a = await player(), b = await player();
  await rpc(db.pool, 'send_friend_request', { p_handle: b.handle }, a);
  const req = (await rpc(db.pool, 'social_overview', {}, b)).incoming[0];
  await rpc(db.pool, 'respond_friend_request', { p_request: req.id, p_accept: true }, b);
  assert.ok((await badges(a)).includes('good-company')); assert.ok((await badges(b)).includes('good-company'));
});

test('duel results: only the room server records them; each match counts once, even when submitted concurrently', async () => {
  const a = await player('da_'), b = await player('db_'), id = randomUUID();
  const args = { p_match: id, p_player_a: a.sub, p_player_b: b.sub, p_score_a: 7, p_score_b: 4, p_outcome: 'time', p_forfeit_by: null, p_started_at: minutesAgo(2), p_ended_at: minutesAgo(1) };
  await rejects(rpc(db.pool, 'record_duel', args, a), /permission denied/);
  await rejects(asRole(db.pool, a, `insert into public.duel_matches (id, player_a, player_b, score_a, score_b, outcome, rated, started_at, ended_at) values ($1, $2, $3, 15, 0, 'time', true, now(), now())`, [randomUUID(), a.sub, b.sub]), /permission denied/);
  await rejects(asRole(db.pool, a, `update public.duel_ratings set rating = 3000 where user_id = $1`, [a.sub]), /permission denied/);
  const results = await Promise.all(Array.from({ length: 5 }, () => rpc(db.pool, 'record_duel', args, SERVICE)));
  assert.equal(results.filter(r => r.recorded).length, 1, 'exactly one submission records the match');
  assert.ok(results.filter(r => !r.recorded).every(r => r.duplicate));
  const ra = await rating(a), rb = await rating(b);
  assert.equal(ra.matches, 1); assert.equal(ra.wins, 1); assert.equal(rb.losses, 1); assert.equal(ra.points_for, 7); assert.equal(rb.points_for, 4);
  assert.equal(ra.rating, 1012); assert.equal(rb.rating, 988, 'equal ratings: the winner gains 24 × (1 − ½) = 12');
  assert.ok((await badges(a)).includes('good-game') && (await badges(b)).includes('good-game'));
  // Validation.
  await rejects(duel(a, a, 1, 0), /Invalid duel players/);
  await rejects(duel(a, b, 999, 0), /score/);
  await rejects(duel(a, b, 1, 0, { p_outcome: 'forfeit' }), /outcome/);
  await rejects(duel(a, b, 1, 0, { p_outcome: 'time', p_forfeit_by: a.sub }), /outcome/);
  await rejects(duel(a, b, 1, 0, { p_started_at: minutesAgo(30) }), /times/);
});

test('draws, forfeits and the anti-farming rules for rating', async () => {
  const a = await player('ra_'), b = await player('rb_'), c = await player('rc_');
  const draw = await duel(a, b, 4, 4);
  assert.equal(draw.rated, true); assert.equal(draw.a.change, 0); assert.equal(draw.winner, null);
  assert.equal((await rating(a)).draws, 1);
  // A forfeit in the first 10 seconds is recorded but not rated.
  const quick = await duel(a, b, 0, 0, { p_outcome: 'forfeit', p_forfeit_by: b.sub, p_started_at: new Date(Date.now() - 5000).toISOString(), p_ended_at: new Date().toISOString() });
  assert.equal(quick.rated, false); assert.equal(quick.winner, a.sub, 'the forfeiting player loses');
  assert.equal((await rating(a)).wins, 1);
  // A later forfeit is rated as a loss for whoever forfeited.
  assert.equal((await duel(a, b, 2, 6, { p_outcome: 'forfeit', p_forfeit_by: b.sub })).winner, a.sub);
  // The same pair: at most 3 rated duels in 24 hours (draw + forfeit above + one more).
  assert.equal((await duel(a, b, 5, 3)).rated, true);
  const fourth = await duel(a, b, 5, 3);
  assert.equal(fourth.rated, false); assert.equal(fourth.a.change, 0);
  assert.equal((await rating(a)).rated_matches, 3); assert.equal((await rating(a)).matches, 5, 'unrated duels still count as played');
  // Another opponent is rated again.
  assert.equal((await duel(a, c, 5, 3)).rated, true);
});

test('Court Champion needs 3 rated wins against at least 2 different opponents', async () => {
  const champ = await player('ch_'), x = await player('cx_'), y = await player('cy_');
  for (let i = 0; i < 3; i++) await duel(champ, x, 6, 2);
  assert.ok(!(await badges(champ)).includes('court-champion'), 'three wins over one opponent are not enough');
  const r = await duel(y, champ, 1, 8);
  assert.deepEqual(r.awarded_b, ['court-champion']);
  assert.deepEqual((await duel(champ, y, 9, 2)).awarded_a, [], 'awarded once');
});

test('the leaderboard ranks validated results only, shares ranks on ties and lists newcomers honestly', async () => {
  // A fresh group so the ranking is predictable: play rated rounds, then read the board.
  const players = [await player('lb_'), await player('lb_'), await player('lb_'), await player('lb_')], [p1, p2, p3, p4] = players;
  // Replay the published rule (Elo, K = 24, from 1000) to know the exact expected ratings.
  const expected = new Map(players.map(p => [p.sub, 1000]));
  for (const [w, l] of [[p1, p2], [p1, p3], [p1, p4], [p2, p3], [p2, p4], [p3, p4], [p4, p2]]) {
    await duel(w, l, 6, 2);
    const rw = expected.get(w.sub), rl = expected.get(l.sub), delta = Math.round(24 * (1 - 1 / (1 + 10 ** ((rl - rw) / 400))));
    expected.set(w.sub, rw + delta); expected.set(l.sub, rl - delta);
  }
  const board = await rpc(db.pool, 'duel_leaderboard', { p_limit: 100 }, p1);
  const ours = board.ranked.filter(r => expected.has(r.id));
  for (const r of ours) assert.equal(r.rating, expected.get(r.id), `rating for ${r.handle}`);
  assert.deepEqual(ours.map(r => r.id), [...expected.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter(id => ours.some(r => r.id === id)), 'ordered by rating');
  for (const r of board.ranked) assert.ok(r.rated_matches >= 3, 'only players with 3+ rated duels are ranked');
  assert.equal(board.me.rating, (await rating(p1)).rating); assert.ok(board.me.rank >= 1);
  // Ties share a rank.
  const t1 = await player('tie_'), t2 = await player('tie_');
  await db.pool.query(`insert into public.duel_ratings (user_id, rating, rated_matches, matches, wins, losses, draws) values ($1, 1500, 3, 3, 3, 0, 0), ($2, 1500, 3, 3, 2, 1, 0)`, [t1.sub, t2.sub]);
  const top = (await rpc(db.pool, 'duel_leaderboard', { p_limit: 5 })).ranked;
  assert.equal(top[0].rank, 1); assert.equal(top[1].rank, 1); assert.equal(top[0].id, t1.sub, 'within a tie, more wins first');
  assert.equal((await rpc(db.pool, 'duel_leaderboard', {})).me, null, 'anonymous viewers have no record');
  const newcomer = await player('new_');
  await duel(newcomer, t1, 0, 2);
  assert.ok(!(await rpc(db.pool, 'duel_leaderboard', { p_limit: 100 })).ranked.some(r => r.id === newcomer.sub), 'newcomers are not ranked until 3 rated duels');
  const history = await rpc(db.pool, 'duel_history', { p_user: newcomer.sub });
  assert.equal(history[0].result, 'loss'); assert.equal(history[0].opponent.id, t1.sub); assert.equal(history[0].score, 0);
  assert.equal((await rpc(db.pool, 'get_profile', { p_id: newcomer.sub })).duel.matches, 1);
});
