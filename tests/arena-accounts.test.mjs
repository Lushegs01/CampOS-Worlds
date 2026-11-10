// Database tests for Combat Arena persistence (supabase/migrations/*_combat_arena.sql) against a real
// PostgreSQL 17 prepared like a Supabase project: only the arena server records results, each match
// counts once (even submitted concurrently), statistics are validated, experience matches the game's
// formula, loadouts are checked against unlocks, and the leaderboard and history read back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startDatabase, rpc, asRole } from './support/postgres.mjs';
import { CATALOG } from '../shared/arena/weapons.mjs';
import { matchXp, xpForLevel, levelFor, weaponLevel, weaponXp } from '../shared/arena/rules.mjs';

let db;
before(async () => { db = await startDatabase({ name: 'arena' }); }, { timeout: 180000 });
after(async () => { await db?.stop(); });

let seq = 0;
const unique = prefix => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
async function player(prefix = 'ar_') {
  const handle = unique(prefix);
  const { rows } = await db.pool.query(`insert into auth.users (email, encrypted_password) values ($1, 'x') returning id`, [`${handle}@example.test`]);
  const claims = { sub: rows[0].id, role: 'authenticated', handle };
  await rpc(db.pool, 'save_profile', { p_handle: handle, p_display_name: handle, p_bio: '', p_avatar: {} }, claims);
  return claims;
}
const SERVICE = { role: 'service_role' };
const rejects = (promise, pattern) => assert.rejects(promise, e => { assert.match(e.message, pattern); return true; });
const ago = m => new Date(Date.now() - m * 60000).toISOString();
const line = (user, team, extra = {}) => ({ user, team, kills: 0, deaths: 0, assists: 0, headshots: 0, captures: 0, neutralizes: 0, defends: 0, score: 0, damage: 0, best_streak: 0, completed: true, weapons: {}, ...extra });
function record(players, extra = {}) {
  return rpc(db.pool, 'record_arena_match', { p_match: randomUUID(), p_mode: 'tdm', p_map: 'foundry', p_started_at: ago(8), p_ended_at: ago(1), p_winner: 0, p_score_a: 30, p_score_b: 22, p_outcome: 'score', p_players: players, ...extra }, SERVICE);
}
const stats = async p => (await db.pool.query('select * from public.arena_stats where user_id = $1', [p.sub])).rows[0];

test('the database arena catalogue mirrors the game’s', async () => {
  const rows = (await db.pool.query('select id, kind, slot, category, unlock_level from public.arena_catalog order by id')).rows;
  assert.deepEqual(rows, CATALOG.map(c => ({ id: c.id, kind: c.kind, slot: c.slot, category: c.category, unlock_level: c.unlock })).sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal((await asRole(db.pool, null, 'select count(*)::int as n from public.arena_catalog')).rows[0].n, CATALOG.length, 'the catalogue is public');
});

test('level, weapon-level and match-experience formulas are identical in the game and the database', async () => {
  for (const level of [1, 2, 3, 10, 29, 30, 31]) assert.equal((await db.pool.query('select public.arena_xp_for_level($1) as v', [level])).rows[0].v, xpForLevel(level), `xp for level ${level}`);
  for (const xp of [0, 999, 1000, 2199, 2200, 50000, 1e7]) assert.equal((await db.pool.query('select public.arena_level($1) as v', [xp])).rows[0].v, levelFor(xp), `level at ${xp}`);
  for (const [k, h] of [[0, 0], [4, 1], [5, 0], [44, 9], [200, 50]]) assert.equal((await db.pool.query('select public.arena_weapon_level($1, $2) as v', [k, h])).rows[0].v, weaponLevel(weaponXp(k, h)));
  const cases = [{ kills: 12, headshots: 4, assists: 3, captures: 0, neutralizes: 0, defends: 0, result: 'win', completed: true },
    { kills: 3, headshots: 0, assists: 1, captures: 4, neutralizes: 2, defends: 1, result: 'loss', completed: true },
    { kills: 7, headshots: 7, assists: 0, captures: 0, neutralizes: 0, defends: 0, result: 'draw', completed: false },
    { kills: 300, headshots: 300, assists: 100, captures: 0, neutralizes: 0, defends: 0, result: 'win', completed: true }];
  for (const c of cases) {
    const v = (await db.pool.query('select public.arena_match_xp($1,$2,$3,$4,$5,$6,$7,$8) as v', [c.kills, c.headshots, c.assists, c.captures, c.neutralizes, c.defends, c.result, c.completed])).rows[0].v;
    assert.equal(v, matchXp(c));
  }
});

test('only the arena server records matches; results, experience and weapon statistics are stored', async () => {
  const a = await player(), b = await player();
  const players = [line(a.sub, 0, { kills: 9, deaths: 4, assists: 2, headshots: 3, score: 1200, damage: 1100, best_streak: 5, weapons: { vanguard: { kills: 9, headshots: 3, shots: 210, hits: 80 } } }),
    line(b.sub, 1, { kills: 4, deaths: 9, assists: 1, score: 500, damage: 700, weapons: { wasp: { kills: 4, headshots: 0, shots: 150, hits: 50 } } })];
  await rejects(rpc(db.pool, 'record_arena_match', { p_match: randomUUID(), p_mode: 'tdm', p_map: 'foundry', p_started_at: ago(8), p_ended_at: ago(1), p_winner: 0, p_score_a: 30, p_score_b: 22, p_outcome: 'score', p_players: players }, a), /permission denied/);
  const r = await record(players);
  assert.equal(r.recorded, true);
  const ra = r.players.find(x => x.user === a.sub), rb = r.players.find(x => x.user === b.sub);
  assert.equal(ra.result, 'win'); assert.equal(rb.result, 'loss', 'the result follows the winner, not what was sent');
  assert.equal(ra.xp, matchXp({ kills: 9, headshots: 3, assists: 2, result: 'win', completed: true }));
  assert.equal(ra.level, levelFor(ra.xp)); assert.ok(ra.level > 1 && ra.unlocked.length > 0, 'levelling up reports what unlocked');
  const sa = await stats(a);
  assert.equal(Number(sa.xp), ra.xp); assert.equal(sa.kills, 9); assert.equal(sa.wins, 1); assert.equal(sa.matches, 1); assert.equal(sa.best_streak, 5);
  const w = (await db.pool.query('select * from public.arena_weapon_stats where user_id = $1', [a.sub])).rows;
  assert.deepEqual(w.map(x => [x.weapon, x.kills, x.headshots, x.shots, x.hits]), [['vanguard', 9, 3, 210, 80]]);
  // Public reads: profile, history and leaderboard.
  const profile = await rpc(db.pool, 'arena_profile', { p_user: a.sub });
  assert.equal(profile.stats.kills, 9); assert.equal(profile.history.length, 1); assert.equal(profile.history[0].result, 'win');
  const board = await rpc(db.pool, 'arena_leaderboard', { p_limit: 50 }, a);
  assert.ok(board.ranked.some(x => x.handle === a.handle && x.level === ra.level)); assert.equal(board.me.matches, 1);
});

test('each match counts once, even when the same result is submitted concurrently', async () => {
  const a = await player(), b = await player(), id = randomUUID();
  const args = { p_match: id, p_mode: 'dom', p_map: 'quad', p_started_at: ago(9), p_ended_at: ago(1), p_winner: 1, p_score_a: 90, p_score_b: 150, p_outcome: 'score',
    p_players: [line(a.sub, 0, { kills: 5, captures: 2, deaths: 3 }), line(b.sub, 1, { kills: 3, captures: 4, neutralizes: 1, defends: 1, deaths: 5 })] };
  const results = await Promise.all([1, 2, 3].map(() => rpc(db.pool, 'record_arena_match', args, SERVICE)));
  assert.equal(results.filter(r => r.recorded).length, 1, 'exactly one submission records');
  assert.ok(results.filter(r => !r.recorded).every(r => r.duplicate));
  assert.equal((await stats(a)).matches, 1); assert.equal((await stats(b)).matches, 1); assert.equal((await stats(b)).wins, 1);
  assert.equal((await db.pool.query('select count(*)::int as n from public.arena_match_players where match_id = $1', [id])).rows[0].n, 2);
});

test('implausible statistics are refused, not clipped', async () => {
  const a = await player();
  await rejects(record([line(a.sub, 0, { kills: 10, headshots: 11 })]), /Implausible/);
  await rejects(record([line(a.sub, 0, { kills: 500 })]), /Implausible/, 'more than 40 eliminations a minute');
  await rejects(record([line(a.sub, 0, { captures: 2 })]), /Implausible/, 'captures in team deathmatch');
  await rejects(record([line(a.sub, 0, { kills: 2, weapons: { vanguard: { kills: 3, headshots: 0, shots: 10, hits: 3 } } })]), /Implausible/, 'weapon eliminations above the total');
  await rejects(record([line(a.sub, 0, { kills: 1, weapons: { railgun: { kills: 1, headshots: 0, shots: 1, hits: 1 } } })]), /Unknown weapon/);
  await rejects(record([line(a.sub, 0)], { p_mode: 'gungame' }), /Invalid match settings/);
  await rejects(record([line(a.sub, 0)], { p_started_at: ago(60), p_ended_at: ago(1) }), /Invalid match times/);
  await rejects(record([line(a.sub, 3)]), /Invalid team/);
  await rejects(record([line(a.sub, 0), line(a.sub, 1)]), /twice/);
  assert.equal(await stats(a), undefined, 'nothing was stored by refused results');
});

test('loadouts: saved per account, checked against unlocks and weapon levels, private to their owner', async () => {
  const a = await player(), b = await player();
  const loadout = { name: 'Rush', primary: 'wasp', secondary: 'knife', lethal: 'frag', tactical: 'flash', perks: ['fleet', 'steady'] };
  const saved = await rpc(db.pool, 'save_arena_loadout', { p_slot: 1, p_loadout: loadout }, a);
  assert.equal(saved.name, 'Rush'); assert.deepEqual(saved.perks, ['fleet', 'steady']);
  await rejects(rpc(db.pool, 'save_arena_loadout', { p_slot: 2, p_loadout: { ...loadout, secondary: 'hammer' } }, a), /not unlocked/, 'level-7 melee weapon at level 1');
  await rejects(rpc(db.pool, 'save_arena_loadout', { p_slot: 2, p_loadout: { ...loadout, primary: 'talon' } }, a), /Armory weapon you do not own/, 'premium weapon not bought');
  await rejects(rpc(db.pool, 'save_arena_loadout', { p_slot: 2, p_loadout: { ...loadout, primary: 'sparrow' } }, a), /primary weapon/);
  await rejects(rpc(db.pool, 'save_arena_loadout', { p_slot: 2, p_loadout: { ...loadout, perks: ['fleet', 'fleet'] } }, a), /two different perks/);
  await rejects(rpc(db.pool, 'save_arena_loadout', { p_slot: 2, p_loadout: { ...loadout, skins: { wasp: 'gilded' } } }, a), /higher weapon level/);
  await rejects(rpc(db.pool, 'save_arena_loadout', { p_slot: 9, p_loadout: loadout }, a), /slot/);
  await rejects(rpc(db.pool, 'save_arena_loadout', { p_slot: 1, p_loadout: loadout }), /permission denied/, 'guests cannot save');
  // Earn weapon levels, then the finish is allowed.
  await record([line(a.sub, 0, { kills: 30, headshots: 10, weapons: { wasp: { kills: 30, headshots: 10, shots: 900, hits: 300 } } })]);
  const skinned = await rpc(db.pool, 'save_arena_loadout', { p_slot: 2, p_loadout: { ...loadout, skins: { wasp: 'ember', vanguard: 'gilded' } } }, a);
  assert.deepEqual(skinned.skins, { wasp: 'ember' }, 'finishes for weapons not in the loadout are dropped');
  const mine = await rpc(db.pool, 'my_arena', {}, a);
  assert.equal(mine.loadouts.length, 2); assert.ok(mine.stats.level > 1);
  const visible = await asRole(db.pool, b, 'select count(*)::int as n from public.arena_loadouts');
  assert.equal(visible.rows[0].n, 0, 'another player cannot read these loadouts');
  await rejects(asRole(db.pool, a, `update public.arena_stats set xp = 999999 where user_id = '${a.sub}'`), /permission denied/, 'players cannot write their own experience');
  const snap = await rpc(db.pool, 'arena_snapshot', { p_user: a.sub }, SERVICE);
  assert.equal(snap.loadouts[0].primary, 'wasp'); assert.equal(snap.weapons[0].kills, 30);
});

test('emblems unlock with level', async () => {
  const a = await player();
  await rejects(rpc(db.pool, 'set_arena_emblem', { p_emblem: 'crown' }, a), /not unlocked/);
  assert.deepEqual(await rpc(db.pool, 'set_arena_emblem', { p_emblem: 'recruit' }, a), { emblem: 'recruit' });
});
