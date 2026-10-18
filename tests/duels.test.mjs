// Court Duel over real WebSockets, scored by the room's own ball physics. Short timings keep the
// suite fast; the rules are the same as in the game (server/duels.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { HOOPS } from '../shared/interactions.mjs';

const RULES = { challengeMs: 1500, countdownMs: 300, playMs: 2500, settleMs: 1500, outsideMs: 600, margin: 1.5, showResultMs: 300, balls: ['ball-1', 'ball-2'] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function next(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject(new Error('Message timeout')); }, timeout);
    const h = raw => { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(t); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
let room, url;
async function join(name) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173' });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const welcome = next(ws, m => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', name, avatar: {} }));
  const w = await welcome, c = { ws, id: w.id, welcome: w, send: m => ws.send(JSON.stringify(m)) };
  c.state = () => room.clients.get(c.id);
  c.duel = (action, args = {}) => { const r = next(ws, m => m.type === 'duelResult' && m.action === action); c.send({ type: 'duel', action, ...args }); return r; };
  c.place = (x, z) => Object.assign(c.state(), { x, z, vx: 0, vz: 0, y: 0 });
  return c;
}
const south = HOOPS.find(h => h.id === 'south'), north = HOOPS.find(h => h.id === 'north');
/** Challenge and accept; resolves when play starts. */
async function startDuel(a, b) {
  a.place(44, 20); b.place(44, 28);
  const invited = next(b.ws, m => m.type === 'duelChallenge');
  assert.equal((await a.duel('challenge', { id: b.id })).ok, true);
  const { challenge } = await invited;
  const playing = next(a.ws, m => m.type === 'duel' && m.duel?.state === 'playing');
  assert.equal((await b.duel('respond', { challenge: challenge.id, accept: true })).started, true);
  return (await playing).duel;
}
/** A free throw: from the line, facing the hoop, with the ideal release. */
async function freeThrow(c, hoop, ref) {
  c.place(hoop.x, hoop.z + (hoop.id === 'south' ? 4.6 : -4.6));
  c.send({ type: 'shoot', yaw: hoop.id === 'south' ? Math.PI : 0, charge: .5, ref });
  return next(c.ws, m => m.type === 'result' && m.ref === ref);
}

before(async () => { room = createRoom({ port: 0, duelRules: RULES }); url = `ws://127.0.0.1:${(await room.start()).port}/ws`; });
after(async () => { await room?.close(); });

test('a full duel: challenge, countdown, own balls handed over, physics-scored baskets, buzzer, result', async () => {
  const a = await join('Ada'), b = await join('Tobi'), watcher = await join('Watcher');
  try {
    // Challenges need both players at The Courts.
    a.place(0, 30); b.place(44, 28);
    assert.match((await a.duel('challenge', { id: b.id })).reason, /Go to The Courts/);
    const view = await startDuel(a, b);
    assert.deepEqual(view.players.map(p => p.name), ['Ada', 'Tobi']); assert.deepEqual(view.scores, [0, 0]);
    assert.ok(view.remaining > 2000 && view.remaining <= RULES.playMs);
    assert.equal(a.state().ball, 'ball-1'); assert.equal(b.state().ball, 'ball-2', 'each player starts with their own ball');
    // A spectator cannot pick up a match ball, and nobody can start a second duel.
    a.send({ type: 'drop', ref: 1 }); await next(a.ws, m => m.type === 'result' && m.ref === 1);
    const ball = room.world.balls.find(x => x.id === 'ball-1'); watcher.place(ball.x + .3, ball.z);
    watcher.send({ type: 'pickup', ball: 'ball-1', ref: 2 });
    assert.match((await next(watcher.ws, m => m.type === 'result' && m.ref === 2)).reason, /Court Duel/);
    const c2 = await join('Third'); c2.place(44, 25);
    assert.match((await c2.duel('challenge', { id: watcher.id })).reason, /being played/);
    c2.ws.close();
    a.place(ball.x, ball.z);
    a.send({ type: 'pickup', ball: 'ball-1', ref: 4 }); assert.equal((await next(a.ws, m => m.type === 'result' && m.ref === 4)).ok, true, 'the owner can pick up their match ball');
    // Ada scores a free throw; Tobi's shot from the same kind of spot also counts for him.
    const scored = next(watcher.ws, m => m.type === 'duel' && m.duel?.scores[0] === 2, 4000);
    const shot = await freeThrow(a, south, 5); assert.equal(shot.ok, true);
    await scored;
    await freeThrow(b, north, 6);
    const done = await next(watcher.ws, m => m.type === 'duel' && m.duel?.state === 'finished', 8000);
    assert.equal(done.duel.result.outcome, 'time');
    const [sa, sb] = done.duel.scores;
    assert.equal(sa, 2); assert.ok(sb === 0 || sb === 2);
    assert.equal(done.duel.result.winner, sb === 2 ? null : a.id, 'higher score wins; equal is a draw');
    assert.equal(done.duel.result.recorded, null, 'guest duels are not recorded');
    assert.equal(room.world.reserved.size, 0, 'the balls are free for everyone again');
    assert.equal(a.state().duel, null);
  } finally { a.ws.close(); b.ws.close(); watcher.ws.close(); await sleep(400); }
});

test('only the player’s own ball, released from inside the court, scores', async () => {
  const a = await join('Shooter'), b = await join('Rival');
  try {
    await startDuel(a, b);
    // Feed the duel synthetic physics events: a basket by Ada with Tobi's ball, and one with a shot
    // that was never released on court, must not count.
    const d = room.duels.current, before = [...d.scores];
    room.duels.step([{ type: 'score', by: a.id, ball: 'ball-2', shot: 999, points: 3 }, { type: 'score', by: a.id, ball: 'ball-1', shot: 12345, points: 3 }]);
    assert.deepEqual(d.scores, before);
    room.duels.onShot(a.state(), 777, 'ball-1');
    room.duels.step([{ type: 'score', by: a.id, ball: 'ball-1', shot: 777, points: 3 }, { type: 'score', by: a.id, ball: 'ball-1', shot: 777, points: 3 }]);
    assert.deepEqual(d.scores, [3, 0], 'counted once');
    const outside = a.state(); outside.x = 70; room.duels.onShot(outside, 778, 'ball-1');
    room.duels.step([{ type: 'score', by: a.id, ball: 'ball-1', shot: 778, points: 2 }]);
    assert.deepEqual(d.scores, [3, 0], 'a shot released off the court does not count');
    a.place(44, 20);
    // Listening before conceding: the result to Ada and the broadcast to Tobi can arrive in either order.
    const finished = next(b.ws, m => m.type === 'duel' && m.duel?.state === 'finished');
    assert.equal((await a.duel('concede')).ok, true);
    const end = await finished;
    assert.equal(end.duel.result.outcome, 'forfeit'); assert.equal(end.duel.result.winner, b.id, 'conceding loses, whatever the score');
  } finally { a.ws.close(); b.ws.close(); await sleep(400); }
});

test('leaving the court or disconnecting forfeits during play and cancels during the countdown', async () => {
  let a = await join('Leaver'), b = await join('Stayer');
  try {
    await startDuel(a, b);
    const warned = next(a.ws, m => m.type === 'notice' && /Get back on the court/.test(m.text));
    a.place(10, 30); await warned;
    const end = await next(b.ws, m => m.type === 'duel' && m.duel?.state === 'finished', 3000);
    assert.equal(end.duel.result.winner, b.id); assert.match(end.duel.result.reason, /left the court/);
    await sleep(400);
    // Disconnect during play.
    await startDuel(a, b);
    const gone = next(b.ws, m => m.type === 'duel' && m.duel?.state === 'finished');
    a.ws.close();
    assert.match((await gone).duel.result.reason, /disconnected/);
    await sleep(400);
    // Leaving during the countdown cancels with no result.
    a = await join('Leaver again');
    a.place(44, 20); b.place(44, 28);
    const invited = next(b.ws, m => m.type === 'duelChallenge'); await a.duel('challenge', { id: b.id });
    const { challenge } = await invited;
    const canceled = next(b.ws, m => m.type === 'duel' && m.duel?.state === 'canceled');
    await b.duel('respond', { challenge: challenge.id, accept: true });
    a.place(0, 30);
    const c = await canceled;
    assert.equal(c.duel.result.winner, null); assert.match(c.duel.result.reason, /No result/);
    assert.equal(room.world.reserved.size, 0);
    // Expired and declined challenges.
    await sleep(500);
    a.place(44, 20);
    const expired = next(b.ws, m => m.type === 'duelChallengeGone', 4000); await a.duel('challenge', { id: b.id }); await expired;
    const invite2 = next(b.ws, m => m.type === 'duelChallenge'); await a.duel('challenge', { id: b.id });
    const declined = next(a.ws, m => m.type === 'notice' && /declined/.test(m.text));
    await b.duel('respond', { challenge: (await invite2).challenge.id, accept: false }); await declined;
  } finally { a.ws.close(); b.ws.close(); await sleep(400); }
});

test('results between signed-in players are recorded once, with retries when the account service is briefly down', async () => {
  // A stand-in account service: two players, and a record call that fails twice before succeeding.
  const calls = [];
  const profiles = { 'tok-a': { id: '00000000-0000-4000-8000-00000000000a', handle: 'ada' }, 'tok-b': { id: '00000000-0000-4000-8000-00000000000b', handle: 'tobi' } };
  const accounts = {
    enabled: true,
    verify: async t => (profiles[t] ? { id: profiles[t].id } : { error: 'invalid' }),
    snapshot: async id => { const p = Object.values(profiles).find(p => p.id === id); return { handle: p.handle, display_name: p.handle, avatar: {}, progress: {}, social: { friends: [], blocked: [], settings: {} } }; },
    socialSnapshot: async () => ({ friends: [], blocked: [], settings: {} }),
    recordProgress: async () => ({ awarded: [] }), recordHoopsRound: async () => ({ awarded: [] }),
    recordDuel: async m => { calls.push(m); if (calls.length < 3) throw new Error('unavailable'); return { recorded: true, rated: true, a: { rating: 1012, change: 12 }, b: { rating: 988, change: -12 }, awarded_a: ['good-game'], awarded_b: ['good-game'] }; },
  };
  const r2 = createRoom({ port: 0, duelRules: RULES, accounts }), u2 = `ws://127.0.0.1:${(await r2.start()).port}/ws`;
  const signIn = async token => {
    const ws = new WebSocket(u2, { origin: 'http://localhost:5173' }); await new Promise(r => ws.once('open', r));
    const w = next(ws, m => m.type === 'welcome'), auth = next(ws, m => m.type === 'auth');
    ws.send(JSON.stringify({ type: 'join', name: 'x', access: token.replace('tok', 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc') }));
    const c = { ws, id: (await w).id, send: m => ws.send(JSON.stringify(m)) };
    assert.equal((await auth).ok, true); return c;
  };
  // Tokens must look like JWTs to reach verify(); map them back to the stand-in's keys.
  const verify = accounts.verify; accounts.verify = t => verify(t.startsWith('aaaaaaaaaa.bbbbbbbbbb.cccccccccc') ? 'tok' + t.slice(32) : t);
  const a = await signIn('tok-a'), b = await signIn('tok-b');
  try {
    Object.assign(r2.clients.get(a.id), { x: 44, z: 20 }); Object.assign(r2.clients.get(b.id), { x: 44, z: 28 });
    const invited = next(b.ws, m => m.type === 'duelChallenge'); a.send({ type: 'duel', action: 'challenge', id: b.id });
    const { challenge } = await invited;
    b.send({ type: 'duel', action: 'respond', challenge: challenge.id, accept: true });
    await next(a.ws, m => m.type === 'duel' && m.duel?.state === 'playing');
    const recorded = next(a.ws, m => m.type === 'duelRecorded', 12000), badge = next(b.ws, m => m.type === 'progress' && m.kind === 'duel', 12000);
    a.send({ type: 'duel', action: 'concede' });
    const r = await recorded;
    assert.equal(r.rated, true); assert.equal(r.change, 12, 'Ada is player A'); assert.deepEqual((await badge).awarded, ['good-game']);
    assert.equal(calls.length, 3, 'two failures, then one success');
    assert.equal(new Set(calls.map(c => c.id)).size, 1, 'every retry carries the same match id, so the database counts it once');
    assert.equal(calls[0].outcome, 'forfeit'); assert.equal(calls[0].forfeitBy, profiles['tok-a'].id);
  } finally { a.ws.close(); b.ws.close(); await r2.close(); }
});
