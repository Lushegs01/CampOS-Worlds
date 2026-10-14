// Court Duel: a one-versus-one basketball shootout at The Courts, run by the room server on the
// same ball physics as free play. Clients only ask (challenge, accept, decline, concede); the room
// decides who holds which ball, which shots count, the score, the clock and the result.
//
// Rules (also shown in the game):
// * Two players on The Courts. One challenges, the other accepts within 30 seconds.
// * A 3-second countdown, then each player is handed their own ball: the two court balls are
//   reserved for the match, so nobody else can pick them up.
// * 60 seconds of play. A basket counts when it goes in from the player's own ball and the shot was
//   released from inside the court: 2 points, or 3 from beyond 6.75 m (the existing scoring).
// * A shot in the air at the buzzer still counts if it drops within 3 seconds.
// * Highest score wins; equal scores are a draw.
// * Leaving the court for more than 6 seconds, conceding or disconnecting during play forfeits.
//   Leaving or disconnecting during the countdown cancels the match with no result.
// * One duel at a time: the court has two balls. Free shooting resumes when it ends.
import { randomUUID } from 'node:crypto';
import { COURT } from '../shared/ball.mjs';

export const DUEL_RULES = { challengeMs: 30_000, countdownMs: 3000, playMs: 60_000, settleMs: 3000, outsideMs: 6000, margin: 1.5, showResultMs: 10_000, balls: ['ball-1', 'ball-2'] };
export const onCourt = (p, margin = 0) => p.x > COURT.x0 - margin && p.x < COURT.x1 + margin && p.z > COURT.z0 - margin && p.z < COURT.z1 + margin;

/**
 * @param {{ world: any, players: () => any[], byId: (id: string) => any, send: (c: any, m: object) => void, broadcast: (m: object) => void,
 *   describe: (c: any) => object, record?: (match: object) => void, rules?: typeof DUEL_RULES, now?: () => number }} options
 */
export function createDuels({ world, players, byId, send, broadcast, describe, record = () => {}, onStart = () => {}, onFinish = () => {}, rules = DUEL_RULES, now = () => Date.now() }) {
  const challenges = new Map();
  let duel = null, lastBroadcast = 0;
  const fail = reason => ({ ok: false, reason });
  const live = () => duel && (duel.state === 'ready' || duel.state === 'playing');
  const index = c => (duel ? duel.players.findIndex(p => p === c) : -1);

  function view() {
    if (!duel) return null;
    const t = now();
    return {
      id: duel.id, state: duel.state, scores: [...duel.scores],
      players: duel.names,
      startsIn: duel.state === 'ready' ? Math.max(0, duel.startsAt - t) : 0,
      remaining: duel.state === 'playing' ? Math.max(0, duel.endsAt - t) : 0,
      result: duel.result,
    };
  }
  const publish = () => { lastBroadcast = now(); broadcast({ type: 'duel', duel: view() }); };
  const playable = p => p?.joined && !p.vehicle && !p.seat;

  /** Make whoever holds a ball drop it, then put it back on the rack (keeping any reservation). */
  function clearBall(id) {
    const b = world.balls.find(x => x.id === id); if (!b) return;
    if (b.state === 'held') { const h = byId(b.holder); if (h) world.drop(h); else Object.assign(b, { state: 'free', holder: null }); }
    const owner = world.reserved.get(id); world.reserved.delete(id);
    world.resetBall({ id: null, ball: null }, id);
    if (owner) world.reserved.set(id, owner);
  }
  function endReservations() { for (const id of rules.balls) world.reserve(id, null); for (const p of duel?.players ?? []) if (p.duel === duel.id) p.duel = null; }
  function cancel(reason) {
    if (!duel) return;
    endReservations();
    for (const p of duel.players) send(p, { type: 'notice', text: reason });
    duel = { ...duel, state: 'canceled', result: { outcome: 'canceled', reason, winner: null }, clearAt: now() + 4000 };
    publish();
  }
  function finish(outcome, loser = -1, reason = '') {
    const [a, b] = duel.scores;
    const winner = outcome === 'forfeit' ? 1 - loser : a === b ? -1 : a > b ? 0 : 1;
    duel.state = 'finished'; duel.endedAt = now(); duel.clearAt = now() + rules.showResultMs;
    duel.result = { outcome, winner: winner >= 0 ? duel.names[winner].id : null, reason, recorded: null };
    endReservations();
    const [pa, pb] = duel.players;
    onFinish(duel);
    // Results between two different signed-in players are recorded (and may be rated).
    if (pa.account && pb.account && pa.account.id !== pb.account.id) {
      duel.result.recorded = 'pending';
      record({ id: duel.id, a: pa.account.id, b: pb.account.id, scoreA: a, scoreB: b, outcome, forfeitBy: outcome === 'forfeit' ? duel.players[loser].account.id : null, startedAt: duel.startedAt, endedAt: duel.endedAt, clients: [pa, pb] });
    }
    publish();
  }

  return {
    view, rules,
    get current() { return duel; },
    challenge(c, target) {
      if (!target?.joined || target === c) return fail('Choose another player to challenge.');
      if (!playable(c)) return fail('Stand up and step out of any vehicle first.');
      if (!onCourt(c, 3)) return fail('Go to The Courts to start a Court Duel.');
      if (!onCourt(target, 8) || !playable(target)) return fail(`${target.name} needs to be on The Courts, on foot.`);
      if (live()) return fail('A Court Duel is being played. Wait for it to finish.');
      for (const [id, ch] of challenges) if (ch.from === c) challenges.delete(id);
      const ch = { id: randomUUID(), from: c, to: target, expires: now() + rules.challengeMs };
      challenges.set(ch.id, ch);
      send(target, { type: 'duelChallenge', challenge: { id: ch.id, from: describe(c), expires: ch.expires } });
      return { ok: true, challenge: ch.id };
    },
    respond(c, id, accept) {
      const ch = challenges.get(id);
      if (!ch || ch.to !== c) return fail('That challenge has expired.');
      challenges.delete(id);
      if (!accept) { send(ch.from, { type: 'notice', text: `${c.name} declined your Court Duel.` }); return { ok: true, started: false }; }
      const a = ch.from, b = c;
      const problem = live() ? 'A Court Duel is already being played.' : !a.joined ? `${a.name} has left.` : !onCourt(a, 3) || !playable(a) ? `${a.name} has left the court.` : !onCourt(b, 3) || !playable(b) ? 'Step onto The Courts, on foot, to accept.' : '';
      if (problem) { send(a, { type: 'notice', text: `The duel with ${b.name} couldn’t start: ${problem}` }); return fail(problem); }
      for (const [k, other] of challenges) if ([a, b].includes(other.from) || [a, b].includes(other.to)) { challenges.delete(k); send(other.to, { type: 'duelChallengeGone', id: k }); }
      duel = { id: randomUUID(), players: [a, b], names: [describe(a), describe(b)], scores: [0, 0], state: 'ready', startsAt: now() + rules.countdownMs, endsAt: 0, startedAt: 0, eligible: [new Set(), new Set()], outside: [0, 0], result: null };
      a.duel = b.duel = duel.id;
      rules.balls.forEach((ball, i) => { clearBall(ball); world.reserve(ball, duel.players[i].id); });
      publish();
      return { ok: true, started: true, duel: duel.id };
    },
    /** A player gives up during play (or leaves the countdown, which cancels). */
    concede(c) {
      const i = index(c);
      if (i < 0 || !live()) return fail('You’re not in a Court Duel.');
      if (duel.state === 'ready') cancel(`${c.name} left before the start. No result is recorded.`);
      else finish('forfeit', i, `${c.name} conceded.`);
      return { ok: true };
    },
    /** Remember shots released from inside the court with the player's own ball: only these can score. */
    onShot(c, shot, ball) {
      const i = index(c);
      if (i >= 0 && duel.state === 'playing' && ball === rules.balls[i] && onCourt(c)) duel.eligible[i].add(shot);
    },
    release(c) {
      for (const [id, ch] of challenges) if (ch.from === c || ch.to === c) { challenges.delete(id); const other = ch.from === c ? ch.to : ch.from; if (ch.to !== c) send(other, { type: 'duelChallengeGone', id }); }
      const i = index(c);
      if (i < 0 || !live()) return;
      if (duel.state === 'ready') cancel(`${c.name} disconnected before the start. No result is recorded.`);
      else finish('forfeit', i, `${c.name} disconnected.`);
    },
    /** Called every room tick with that tick's ball events. */
    step(events) {
      const t = now();
      for (const [id, ch] of challenges) if (ch.expires <= t) { challenges.delete(id); send(ch.to, { type: 'duelChallengeGone', id }); send(ch.from, { type: 'notice', text: `Your Court Duel challenge to ${ch.to.name} expired.` }); }
      if (!duel) return;
      if (duel.state === 'canceled' || duel.state === 'finished') { if (t >= duel.clearAt) { duel = null; publish(); } return; }
      const [a, b] = duel.players;
      if (duel.state === 'ready') {
        const gone = duel.players.find(p => !p.joined || !playable(p) || !onCourt(p, rules.margin));
        if (gone) { cancel(`${gone.name} left the court before the start. No result is recorded.`); return; }
        if (t >= duel.startsAt) {
          // Each player starts holding their own ball (they may already have picked it up).
          for (const [i, p] of duel.players.entries()) { const mine = rules.balls[i]; if (p.ball === mine) continue; if (p.ball) world.drop(p); clearBall(mine); world.give(p, mine); }
          duel.state = 'playing'; duel.startedAt = t; duel.endsAt = t + rules.playMs;
          onStart(duel);
          publish();
        }
        return;
      }
      let changed = false;
      for (const e of events) if (e.type === 'score') {
        const i = duel.players.findIndex(p => p.id === e.by);
        if (i >= 0 && e.ball === rules.balls[i] && duel.eligible[i].delete(e.shot)) { duel.scores[i] += e.points; changed = true; }
      }
      for (const [i, p] of [a, b].entries()) {
        if (onCourt(p, rules.margin) && playable(p)) duel.outside[i] = 0;
        else if (!duel.outside[i]) { duel.outside[i] = t; send(p, { type: 'notice', text: `Get back on the court within ${rules.outsideMs / 1000} seconds or you forfeit.` }); }
        else if (t - duel.outside[i] > rules.outsideMs) { finish('forfeit', i, `${p.name} left the court.`); return; }
      }
      if (t >= duel.endsAt) {
        // The buzzer: wait briefly for counting shots still in the air.
        const inFlight = rules.balls.some((id, i) => { const ball = world.balls.find(x => x.id === id); return ball?.state === 'flight' && ball.shot && duel.eligible[i].has(ball.shot.id); });
        if (!inFlight || t >= duel.endsAt + rules.settleMs) { finish('time'); return; }
      }
      if (changed || t - lastBroadcast > 1000) publish();
    },
    /** The account service answered (or failed): tell both players. */
    recorded(id, payload) {
      if (duel?.id === id && duel.result) { duel.result.recorded = payload.ok ? (payload.rated ? 'rated' : 'unrated') : 'failed'; publish(); }
    },
  };
}
