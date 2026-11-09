// Combat Arena multiplayer over real WebSockets against the real room server (server/room.mjs with
// server/arena). Short timings keep the suite fast; every rule is the game's. Tests place players
// server-side (as if they had walked there) and then send the same input commands a client sends.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { step, spawnState, unpackState, quantize, encodeCommand, B, EYE } from '../shared/arena/sim.mjs';
import { createWorld } from '../shared/arena/physics.mjs';
import { MAP_BY_ID } from '../shared/arena/maps.mjs';
import { WEAPON_BY_ID } from '../shared/arena/weapons.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RULES = { countdownMs: 150, fillWaitMs: 0, spawnProtectMs: 0, reconnectMs: 4000, abandonMs: 1500, resultsMs: 400, regenDelayMs: 60000, mode: { respawnMs: 400, scoreLimit: 3, captureMs: 600, tickMs: 300 } };
const recorded = [];
// A stand-in for the account service: tokens "token-<id>" belong to account <id>.
const accounts = {
  enabled: true,
  verify: async t => (typeof t === 'string' && t.startsWith('token-') ? { id: t.slice(6), email: '' } : { error: 'invalid' }),
  snapshot: async id => ({ handle: 'h' + id.slice(0, 6), display_name: 'Player ' + id.slice(0, 4), avatar: {}, achievements: [], social: {} }),
  arenaSnapshot: async () => ({ xp: 0, emblem: 'recruit', weapons: [], loadouts: [] }),
  recordArenaMatch: async m => { recorded.push(m); return { recorded: true, players: m.players.map(p => ({ user: p.user, xp: 100, total_xp: 100, level: 1, level_before: 1, unlocked: [], weapon_levels: [] })) }; },
};
let room, url;
before(async () => { room = createRoom({ port: 0, accounts, arena: { rules: RULES, minRecordMs: 0 } }); url = `ws://127.0.0.1:${(await room.start()).port}/arena`; });
after(async () => { await room?.close(); });
// Each test starts with no open matches, so Quick Play cannot place a client into an earlier test's match.
afterEach(() => { for (const m of [...room.arena.matches.values()]) m.close('test'); });

/** A test client: connects, says hello, records every message, and can wait for one. */
async function client(name, { access, loadout } = {}) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const c = { ws, name, msgs: [], events: [], seq: 0, ref: 0, waiters: new Set() };
  ws.on('message', raw => {
    const m = JSON.parse(raw); c.msgs.push(m); if (m.t === 'e') c.events.push(...m.l); if (m.t === 's') c.snap = m;
    for (const w of [...c.waiters]) { const hit = w.pred(m); if (hit) { c.waiters.delete(w); w.resolve(hit === true ? m : hit); } }
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.wait = (pred, timeout = 4000, what = 'message') => new Promise((resolve, reject) => {
    const w = { pred, resolve }; c.waiters.add(w);
    setTimeout(() => { if (c.waiters.delete(w)) reject(new Error(`${name}: timed out waiting for ${what}`)); }, timeout);
  });
  c.event = (pred, timeout, what) => c.wait(m => m.t === 'e' && m.l.find(pred), timeout, what);
  c.request = data => { const ref = ++c.ref; const r = c.wait(m => m.t === 'reply' && m.ref === ref, 4000, data.t); c.send({ ...data, ref }); return r; };
  const ready = c.wait(m => m.t === 'ready', 4000, 'ready');
  c.send({ t: 'hello', name, ...(access ? { access } : {}) });
  c.ready = await ready;
  if (loadout) assert.equal((await c.request({ t: 'loadout', loadout })).ok, true);
  return c;
}
const SNIPER = { name: 'S', primary: 'longbow', secondary: 'sparrow', lethal: 'frag', tactical: 'flash', perks: ['fleet', 'steady'] };
const matchOf = c => room.arena.matches.get(c.matchId);
const playerOf = c => matchOf(c).players.find(p => p.num === c.num);
async function queue(c, mode = 'tdm', map = 'quad') {
  const joined = c.wait(m => m.t === 'match', 4000, 'match');
  const r = await c.request({ t: 'queue', mode, map }); assert.equal(r.ok, true, r.reason);
  const m = await joined; c.matchId = m.match.id; c.num = m.you.num; c.team = m.you.team; c.key = m.you.key;
  return m;
}
const playing = c => c.wait(m => m.t === 's' && m.st === 'playing', 4000, 'playing');
/** Put a player at a spot, facing a direction, standing still. */
function place(c, x, z, yaw = 0) { const p = playerOf(c); Object.assign(p.sim, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, grounded: true, stance: 0 }); p.history = []; }
/** Send `ticks` commands at the real rate (60/s), built by `make(i)`. */
async function drive(c, ticks, make) {
  for (let i = 0; i < ticks; i += 4) {
    const batch = []; for (let k = i; k < Math.min(ticks, i + 4); k++) batch.push(encodeCommand(quantize({ seq: ++c.seq, b: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, ...make(k) })));
    c.send({ t: 'c', rt: Date.now() + 1000, c: batch }); await sleep(66);
  }
}
/** View angles from a player's eye to a point (yaw 0 faces −z). */
const aimAt = (from, x, y, z) => ({ yaw: Math.atan2(-(x - from.x), -(z - from.z)), pitch: Math.atan2(y - (from.y + EYE[0]), Math.hypot(x - from.x, z - from.z)) });
/** Raise the weapon (47 ticks after a spawn), aim down sights at the target's chest (22 ticks), then fire once. */
async function snipe(c, target, { settle = 80 } = {}) {
  const me = playerOf(c).sim, t = playerOf(target).sim, aim = aimAt(me, t.x, t.y + 1.15, t.z);
  await drive(c, settle, () => ({ b: B.ADS, ...aim }));
  await drive(c, 4, i => ({ b: B.ADS | (i === 0 ? B.FIRE : 0), ...aim }));
}

test('two players are matched into the same match on opposite teams and see each other in sync', async () => {
  const a = await client('Ada'), b = await client('Tobi');
  try {
    await queue(a); await queue(b);
    assert.equal(a.matchId, b.matchId, 'Quick Play groups them'); assert.notEqual(a.team, b.team, 'balanced onto opposite teams');
    await playing(a);
    place(a, -20, -6, -Math.PI / 2); place(b, -12, -6, Math.PI / 2);
    const s = await a.wait(m => m.t === 's' && m.p.some(e => e[0] === b.num && Math.abs(e[1] - -1200) < 2), 3000, 'b in a snapshot');
    const seen = s.p.find(e => e[0] === b.num), real = playerOf(b).sim;
    assert.deepEqual([seen[1], seen[3]], [Math.round(real.x * 100), Math.round(real.z * 100)], 'A sees B where the server has B');
    assert.equal(seen[8], -1, 'enemy health is not sent'); assert.ok(seen[6] & 1, 'alive flag');
    // B moves; A's later snapshots follow.
    await drive(b, 30, () => ({ mz: 1, yaw: Math.PI / 2 }));
    const moved = await a.wait(m => m.t === 's' && (m.p.find(e => e[0] === b.num)?.[1] ?? 0) < -1240, 3000, 'b moved');
    assert.ok(moved.p.find(e => e[0] === b.num)[1] < -1240);
    assert.ok(a.snap.me && a.snap.me.ack === a.seq, 'each player gets its own authoritative state and acknowledgement');
  } finally { a.ws.close(); b.ws.close(); }
});

test('hits and eliminations are decided by the server: damage, hit markers, kill feed, score and respawn', async () => {
  const a = await client('Shooter', { loadout: SNIPER }), b = await client('Target', { loadout: SNIPER });
  try {
    await queue(a, 'tdm', 'quad'); await queue(b, 'tdm', 'quad'); await playing(a);
    place(a, -20, -6, -Math.PI / 2); place(b, -12, -6, Math.PI / 2);
    const hit = a.event(e => e.k === 'hit', 4000, 'hit'), dmg = b.event(e => e.k === 'dmg', 4000, 'dmg'), kill = b.event(e => e.k === 'kill', 4000, 'kill feed');
    await snipe(a, b);
    const [h, d, k] = await Promise.all([hit, dmg, kill]);
    const pa = playerOf(a), pb = playerOf(b);
    assert.equal(h.kill, true); assert.equal(d.dmg, WEAPON_BY_ID.get('longbow').damage[0][1], 'a Longbow body shot does 110');
    assert.deepEqual([k.a, k.v, k.w], [a.num, b.num, 'longbow']);
    assert.equal(pa.stats.kills, 1); assert.equal(pb.stats.deaths, 1); assert.equal(matchOf(a).scores[pa.team], 1, 'team deathmatch scores the elimination');
    assert.equal(pa.sim.wpn[0].mag, WEAPON_BY_ID.get('longbow').mag - 1, 'one round used');
    const life = pb.life;
    await b.event(e => e.k === 'spawn', 3000, 'respawn');
    assert.equal(pb.life, life + 1); assert.equal(pb.hp, 100); assert.equal(pb.alive, true);
  } finally { a.ws.close(); b.ws.close(); }
});

test('clients cannot cheat: no damage claims, no fast firing, no replayed or malformed commands', async () => {
  const a = await client('Cheat', { loadout: SNIPER }), b = await client('Honest', { loadout: SNIPER });
  try {
    await queue(a); await queue(b); await playing(a);
    place(a, -20, -6, -Math.PI / 2); place(b, -12, -6, Math.PI / 2);
    // Claims the server never accepts.
    a.send({ t: 'hit', target: b.num, damage: 1000 }); a.send({ t: 'kill', victim: b.num }); a.send({ t: 'score', team: a.team, points: 100 });
    a.send({ t: 'c', c: [[1, 99999, 0, 0, 0, 0], ['x'], [2, 0, 5000, 0, 0, 0]] });
    await sleep(200);
    assert.equal(playerOf(b).hp, 100); assert.equal(matchOf(a).scores[a.team], 0);
    // 600 commands with the trigger held, all at once: the token bucket simulates only a burst's worth.
    const me = playerOf(a).sim, t = playerOf(b).sim, aim = aimAt(me, t.x, t.y + 1.15, t.z);
    const flood = Array.from({ length: 600 }, () => encodeCommand(quantize({ seq: ++a.seq, b: B.FIRE | B.ADS, mx: 0, mz: 0, ...aim })));
    for (let i = 0; i < flood.length; i += 12) a.send({ t: 'c', c: flood.slice(i, i + 12) });
    await sleep(300);
    const shots = playerOf(a).stats.shots;
    assert.ok(shots <= 1, `at most one bolt-action shot from a 10-second flood delivered at once (fired ${shots})`);
    assert.equal(playerOf(a).lastSeq, a.seq, 'flooded commands are consumed, not queued for later');
    // Replays: commands with old sequence numbers do nothing.
    const before = { ...playerOf(a).sim };
    a.send({ t: 'c', c: [encodeCommand(quantize({ seq: 5, b: B.FIRE, mx: 1, mz: 1, yaw: 0, pitch: 0 }))] });
    await sleep(100);
    assert.equal(playerOf(a).sim.x, before.x); assert.equal(playerOf(a).stats.shots, shots);
    assert.ok(room.arena.matches.size >= 1, 'the server is still running');
  } finally { a.ws.close(); b.ws.close(); }
});

test('simultaneous eliminations: shots already fired when a player is eliminated still count (a trade)', async () => {
  const a = await client('Left', { loadout: SNIPER }), b = await client('Right', { loadout: SNIPER });
  try {
    await queue(a); await queue(b); await playing(a);
    place(a, -20, -6, -Math.PI / 2); place(b, -12, -6, Math.PI / 2);
    const pa = playerOf(a).sim, pb = playerOf(b).sim, aimA = aimAt(pa, pb.x, 1.15, pb.z), aimB = aimAt(pb, pa.x, 1.15, pa.z);
    await Promise.all([drive(a, 80, () => ({ b: B.ADS, ...aimA })), drive(b, 80, () => ({ b: B.ADS, ...aimB }))]);
    const fire = (c, aim) => c.send({ t: 'c', rt: Date.now(), c: [encodeCommand(quantize({ seq: ++c.seq, b: B.ADS | B.FIRE, mx: 0, mz: 0, ...aim }))] });
    const kills = [a.event(e => e.k === 'kill' && e.v === b.num, 3000, 'b eliminated'), a.event(e => e.k === 'kill' && e.v === a.num, 3000, 'a eliminated')];
    fire(a, aimA); fire(b, aimB);
    await Promise.all(kills);
    assert.equal(playerOf(a).stats.kills, 1); assert.equal(playerOf(b).stats.kills, 1);
    assert.equal(playerOf(a).stats.deaths, 1); assert.equal(playerOf(b).stats.deaths, 1);
    assert.equal(a.events.filter(e => e.k === 'kill').length, 2, 'each elimination reported exactly once');
  } finally { a.ws.close(); b.ws.close(); }
});

test('a dropped connection keeps the player’s place; reconnecting with the match key restores team, statistics and play', async () => {
  const a = await client('Stays'), b = await client('Drops', { access: 'token-11111111-1111-4111-8111-111111111111' });
  try {
    await queue(a); await queue(b); await playing(a);
    const pb = playerOf(b); pb.stats.kills = 2; const team = pb.team, num = b.num;
    b.ws.terminate();
    await a.event(e => e.k === 'roster' && e.players.some(p => p.num === num && !p.connected), 3000, 'shown as reconnecting');
    // A different account cannot take the place with the key.
    const thief = await client('Thief', { access: 'token-22222222-2222-4222-8222-222222222222' });
    assert.equal((await thief.request({ t: 'rejoin', match: b.matchId, key: b.key })).ok, false); thief.ws.close();
    const back = await client('Drops', { access: 'token-11111111-1111-4111-8111-111111111111' });
    const joined = back.wait(m => m.t === 'match', 3000, 'match view');
    assert.equal((await back.request({ t: 'rejoin', match: b.matchId, key: b.key })).ok, true);
    const view = await joined;
    assert.equal(view.rejoined, true); assert.equal(view.you.num, num); assert.equal(view.you.team, team);
    assert.equal(playerOf(b).stats.kills, 2, 'statistics kept');
    await back.event(e => e.k === 'spawn', 3000, 'redeployed');
    back.seq = playerOf(b).lastSeq; back.num = num; back.matchId = b.matchId;
    await drive(back, 20, () => ({ mz: 1 }));
    assert.equal(playerOf(b).lastSeq, back.seq, 'commands continue after reconnecting');
    back.ws.close();
  } finally { a.ws.close(); }
});

test('a match ends at the score limit; results go to everyone and signed-in players’ results are recorded once', async () => {
  const before = recorded.length;
  const a = await client('Winner', { access: 'token-33333333-3333-4333-8333-333333333333', loadout: SNIPER }), b = await client('Loser', { access: 'token-44444444-4444-4444-8444-444444444444', loadout: SNIPER });
  try {
    await queue(a, 'tdm', 'foundry'); await queue(b, 'tdm', 'foundry'); await playing(a);
    const ended = b.event(e => e.k === 'end', 15000, 'end');
    for (let i = 0; i < 3; i++) {
      await b.wait(m => m.t === 's' && m.me?.alive, 3000, 'b alive');
      place(a, -25, -4, -Math.PI / 2); place(b, -17, -4, Math.PI / 2);
      const killed = a.event(e => e.k === 'kill' && e.v === b.num, 4000, 'kill');
      await snipe(a, b, { settle: i ? 90 : 80 }); // a bolt-action rechambers for 78 ticks between shots
      await killed;
    }
    const { result } = await ended;
    assert.equal(result.winner, a.team); assert.equal(result.outcome, 'score'); assert.equal(result.scores[a.team], 3);
    assert.equal(result.players.find(p => p.num === a.num).kills, 3);
    // The result is often recorded within the same socket read as the end of the match.
    const progress = b.msgs.find(m => m.t === 'progress') ?? await b.wait(m => m.t === 'progress', 3000, 'progress');
    assert.equal(progress.match, a.matchId); assert.equal(progress.user, '44444444-4444-4444-8444-444444444444');
    const mine = recorded.slice(before);
    assert.equal(mine.length, 1, 'recorded once'); assert.equal(mine[0].id, a.matchId);
    const row = mine[0].players.find(p => p.user.startsWith('3333'));
    assert.equal(row.kills, 3); assert.equal(row.weapons.longbow.kills, 3); assert.equal(row.result, 'win');
    // After the results the match closes and players can queue again.
    await sleep(600);
    assert.equal(room.arena.matches.has(a.matchId), false);
  } finally { a.ws.close(); b.ws.close(); }
});

test('independent matches run side by side without sharing anything', async () => {
  const c1 = await client('P1'), c2 = await client('P2'), c3 = await client('P3'), c4 = await client('P4');
  try {
    const priv = await c1.request({ t: 'private', action: 'create', mode: 'dom', map: 'foundry', size: 2 });
    assert.equal(priv.ok, true); assert.match(priv.code, /^[A-Z2-9]{6}$/);
    const m1 = c1.msgs.find(m => m.t === 'match');
    const view2 = c2.wait(m => m.t === 'match');
    assert.equal((await c2.request({ t: 'private', action: 'join', code: priv.code })).ok, true);
    const v2 = await view2;
    assert.equal(v2.match.id, m1.match.id);
    assert.equal((await c2.request({ t: 'private', action: 'start' })).ok, false, 'only the host starts');
    await queue(c3, 'tdm', 'quad'); await queue(c4, 'tdm', 'quad');
    assert.notEqual(c3.matchId, m1.match.id);
    assert.equal((await c1.request({ t: 'private', action: 'start' })).ok, true);
    await c1.wait(m => m.t === 's' && m.st === 'playing'); await c3.wait(m => m.t === 's' && m.st === 'playing');
    const nums = id => new Set(room.arena.matches.get(id).players.map(p => p.id));
    assert.deepEqual([...nums(m1.match.id)].sort(), [c1.ready.id, c2.ready.id].sort());
    assert.ok(!c3.msgs.some(m => m.t === 'e' && m.l.some(e => e.k === 'roster' && e.players.some(p => p.name === 'P1'))), 'no events cross between matches');
    assert.ok(room.arena.matches.size >= 2);
    assert.notEqual(room.arena.matches.get(m1.match.id).mode.id, room.arena.matches.get(c3.matchId).mode.id, 'each match has its own mode, map, clock and players');
  } finally { for (const c of [c1, c2, c3, c4]) c.ws.close(); }
});

test('Domination: standing in a zone captures it, the holder scores over time, and a capture earns streak points', async () => {
  const a = await client('Capper'), b = await client('Away');
  try {
    await queue(a, 'dom', 'foundry'); await queue(b, 'dom', 'foundry'); await playing(a);
    const zone = matchOf(a).objectives[0];
    place(a, zone.x, zone.z); place(b, 30, 20);
    const cap = a.event(e => e.k === 'capture', 4000, 'capture');
    await drive(a, 50, () => ({}));
    const c = await cap;
    assert.equal(c.id, zone.id); assert.equal(c.team, a.team); assert.deepEqual(c.by, [a.num]);
    assert.equal(zone.owner, a.team); assert.equal(playerOf(a).stats.captures, 1); assert.equal(playerOf(a).streakPts, 1);
    // An enemy in the zone contests it: no progress either way.
    place(b, zone.x + 1, zone.z); await sleep(150);
    assert.equal(zone.contested, true); assert.equal(zone.owner, a.team);
    place(b, 30, 20);
    const s0 = matchOf(a).scores[a.team]; await sleep(400);
    assert.ok(matchOf(a).scores[a.team] > s0, 'holding the zone scores');
  } finally { a.ws.close(); b.ws.close(); }
});

test('scorestreaks: earned only through play, validated by the server, and team-wide effects', async () => {
  const a = await client('Streaker', { loadout: SNIPER }), b = await client('Enemy');
  try {
    // Domination: eliminations do not score, so three of them do not end the match.
    await queue(a, 'dom', 'quad'); await queue(b, 'dom', 'quad'); await playing(a);
    const r1 = a.event(e => e.k === 'streakResult', 3000, 'refusal');
    a.send({ t: 'streak', id: 'recon' });
    assert.equal((await r1).ok, false, 'a reward that is not earned is refused');
    // Earn Recon Pulse (3 points) through three eliminations on the real damage path.
    const pa = playerOf(a), earned = a.event(e => e.k === 'earned' && e.id === 'recon', 9000, 'earned');
    for (let i = 0; i < 3; i++) {
      await b.wait(m => m.t === 's' && m.me?.alive, 3000, 'b alive');
      place(a, -20, -6, -Math.PI / 2); place(b, -12, -6, Math.PI / 2);
      const k = a.event(e => e.k === 'kill' && e.v === b.num, 4000, 'kill');
      await snipe(a, b, { settle: i ? 90 : 80 });
      await k;
    }
    await earned;
    const recon = b.event(e => e.k === 'recon', 3000, 'recon');
    a.send({ t: 'streak', id: 'recon' });
    assert.equal((await recon).team, a.team, 'the other team is warned');
    assert.equal(pa.earned.has('recon'), false, 'used once');
    place(b, 30, 20); // out of sight, far away: only the pulse reveals them
    await a.wait(m => m.t === 's' && m.r.some(r => r[0] === b.num), 3000, 'enemy revealed on the radar');
  } finally { a.ws.close(); b.ws.close(); }
});

test('interest management: enemies hidden behind walls are not sent; visible ones are', async () => {
  const a = await client('Looker'), b = await client('Hider');
  try {
    await queue(a, 'tdm', 'quad'); await queue(b, 'tdm', 'quad'); await playing(a);
    // Either side of the west gate wall (solid at z = 7), well apart.
    place(a, -33, 7, -Math.PI / 2); place(b, -18, 7.5, Math.PI / 2);
    await sleep(800);
    const s = await a.wait(m => m.t === 's', 1000);
    assert.equal(s.p.some(e => e[0] === b.num), false, 'not sent through a wall');
    place(a, -33, 1, -Math.PI / 2); place(b, -18, 0); await sleep(150);
    const s2 = await a.wait(m => m.t === 's' && m.p.some(e => e[0] === b.num), 2000, 'visible through the gate');
    assert.ok(s2);
  } finally { a.ws.close(); b.ws.close(); }
});

test('Training uses labelled bots that play by the same rules; Quick Play never adds bots', async () => {
  const a = await client('Learner');
  try {
    const joined = a.wait(m => m.t === 'match');
    assert.equal((await a.request({ t: 'training', mode: 'tdm', map: 'foundry', bots: 3, difficulty: 'hard' })).ok, true);
    const view = (await joined).match;
    assert.equal(view.kind, 'training'); assert.equal(view.players.filter(p => p.bot).length, 3);
    assert.ok(view.players.filter(p => p.bot).every(p => /^SIM-Unit/.test(p.name)));
    const m = room.arena.matches.get(view.id);
    await a.wait(m2 => m2.t === 's' && m2.st === 'playing', 8000, 'training starts');
    const start = m.players.filter(p => p.bot).map(p => [p.sim.x, p.sim.z]);
    await sleep(1500);
    assert.ok(m.players.filter(p => p.bot).some((p, i) => Math.hypot(p.sim.x - start[i][0], p.sim.z - start[i][1]) > 1), 'bots move');
    assert.ok(m.players.filter(p => p.bot).every(p => p.lastSeq > 0), 'bots drive the simulation through commands');
    for (const quick of [...room.arena.matches.values()].filter(x => x.kind === 'quick')) assert.equal(quick.players.filter(p => p.bot).length, 0);
  } finally { a.ws.close(); }
});

test('a team that leaves forfeits; leaving players do not block the other team', async () => {
  const a = await client('Remains'), b = await client('Quits');
  try {
    await queue(a, 'dom', 'quad'); await queue(b, 'dom', 'quad'); await playing(a);
    const end = a.event(e => e.k === 'end', 6000, 'forfeit');
    assert.equal((await b.request({ t: 'leave' })).ok, true);
    const { result } = await end;
    assert.equal(result.outcome, 'forfeit'); assert.equal(result.winner, a.team);
  } finally { a.ws.close(); b.ws.close(); }
});

test('high latency, jitter and lost batches: the server stays authoritative and client reconciliation converges', async () => {
  const a = await client('Laggy'), b = await client('Peer');
  try {
    await queue(a, 'tdm', 'quad'); await queue(b, 'tdm', 'quad'); await playing(a);
    await a.event(e => e.k === 'spawn', 2000).catch(() => {});
    const map = MAP_BY_ID.get('quad'), world = createWorld(map.boxes, map.bounds), p = playerOf(a);
    // The client predicts from the server's state, sends with jitter, and loses one batch in five.
    const local = spawnState({ x: 0, z: 0 }, p.loadout, p.perks); unpackState(a.snap.me.s, local);
    const pending = []; let sent = 0, lost = 0;
    a.seq = p.lastSeq;
    for (let i = 0; i < 40; i++) {
      const batch = [];
      for (let k = 0; k < 4; k++) { const c = quantize({ seq: ++a.seq, b: k % 2 ? B.SPRINT : 0, mx: Math.sin(i / 5), mz: 1, yaw: i / 10, pitch: 0 }); step(local, c, { world, seed: matchOf(a).seed, num: a.num, perks: p.perks }); pending.push(c); batch.push(encodeCommand(c)); }
      if (i % 5 === 3) { lost++; continue; } // lost on the way (the server never sees these commands)
      sent++;
      setTimeout(() => a.send({ t: 'c', rt: Date.now() - 250, c: batch }), Math.random() * 120);
      await sleep(66);
    }
    await sleep(400);
    const last = a.snap.me;
    // Reconcile exactly as the client does: take the server's state, replay what it has not applied.
    unpackState(last.s, local);
    for (const c of pending.filter(c => c.seq > last.ack)) step(local, c, { world, seed: matchOf(a).seed, num: a.num, perks: p.perks });
    assert.equal(last.ack, a.seq, 'acknowledged up to the newest command (gaps from lost batches skipped)');
    assert.ok(Math.hypot(local.x - p.sim.x, local.z - p.sim.z) < 1e-9, 'the reconciled prediction equals the server state');
    assert.ok(lost > 0 && sent > lost);
  } finally { a.ws.close(); b.ws.close(); }
});

test('a full match of twelve players: everyone receives state at the snapshot rate and messages stay small', async () => {
  const people = await Promise.all(Array.from({ length: 12 }, (_, i) => client('Load' + i)));
  try {
    for (const c of people) await queue(c, 'tdm', 'foundry');
    assert.equal(new Set(people.map(c => c.matchId)).size, 1, 'one full match');
    const m = matchOf(people[0]); assert.deepEqual([0, 1].map(t => m.players.filter(p => p.team === t).length), [6, 6]);
    await playing(people[0]);
    const t0 = Date.now(), counts = people.map(c => c.msgs.filter(x => x.t === 's').length);
    await Promise.all(people.map((c, i) => drive(c, 120, k => ({ b: k % 30 < 10 ? B.FIRE : 0, mx: Math.sin(k / 9 + i), mz: Math.cos(k / 7 + i), yaw: k / 20 + i, pitch: 0 }))));
    const secs = (Date.now() - t0) / 1000;
    for (const [i, c] of people.entries()) {
      const snaps = c.msgs.filter(x => x.t === 's').slice(counts[i]);
      assert.ok(snaps.length / secs > 14, `${c.name} received ${(snaps.length / secs).toFixed(1)} snapshots/s`);
      const size = Math.max(...snaps.map(s => JSON.stringify(s).length));
      assert.ok(size < 3000, `largest snapshot ${size} bytes`);
    }
    assert.ok(room.arena.status().matches.some(x => x.connected === 12));
  } finally { for (const c of people) c.ws.close(); }
});
