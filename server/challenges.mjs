// Challenge runs (shared/challenges.mjs), timed and checked by the room server. A player starts a run,
// then the room watches its own record of their position each tick: checkpoints must be reached in
// order, in the right mode (on foot, or as the driver), inside the time limit. Clients only ask to
// start or cancel; they never report progress.
import { CHALLENGE_BY_ID } from '../shared/challenges.mjs';

/**
 * @param {{ send: (c: any, m: object) => void, record?: (c: any, challenge: object, ms: number) => void, now?: () => number }} options
 */
export function createChallenges({ send, record = () => {}, now = () => Date.now() }) {
  const fail = reason => ({ ok: false, reason });
  const view = c => c.run && { id: c.run.id, next: c.run.next, total: CHALLENGE_BY_ID.get(c.run.id).checkpoints.length, startedAt: c.run.startedAt, deadline: c.run.deadline, elapsed: now() - c.run.started };
  const inMode = (c, ch) => (ch.mode === 'drive' ? !!c.vehicle && c.vehicleSeat === 0 : !c.vehicle);
  function end(c, message, ok = false) {
    const run = c.run; c.run = null;
    send(c, { type: 'challenge', run: null, ended: { id: run.id, ok, message } });
  }
  return {
    start(c, id) {
      const ch = CHALLENGE_BY_ID.get(id);
      if (!ch) return fail('Unknown challenge.');
      if (c.duel) return fail('Finish your Court Duel first.');
      if (!inMode(c, ch)) return fail(ch.mode === 'drive' ? 'Get into the driver’s seat of a vehicle to start.' : 'Step out of the vehicle: this challenge is on foot.');
      const t = now();
      c.run = { id, next: 0, started: t, startedAt: new Date(t).toISOString(), deadline: t + ch.timeLimitMs };
      send(c, { type: 'challenge', run: view(c) });
      return { ok: true };
    },
    cancel(c) { if (!c.run) return fail('You’re not doing a challenge.'); end(c, 'Challenge cancelled.'); return { ok: true }; },
    release(c) { c.run = null; },
    /** Called on room ticks with the joined players. */
    step(players) {
      const t = now();
      for (const c of players) {
        if (!c.run) continue;
        const ch = CHALLENGE_BY_ID.get(c.run.id);
        if (t > c.run.deadline) { end(c, `Time’s up. ${ch.name} must be finished in ${Math.round(ch.timeLimitMs / 60000)} minutes.`); continue; }
        if (!inMode(c, ch)) { end(c, ch.mode === 'drive' ? 'You left the driver’s seat, so the run ended.' : 'You got into a vehicle, so the on-foot run ended.'); continue; }
        const cp = ch.checkpoints[c.run.next];
        if (Math.hypot(c.x - cp.x, c.z - cp.z) > ch.radius) continue;
        c.run.next++;
        if (c.run.next < ch.checkpoints.length) { send(c, { type: 'challenge', run: view(c), reached: cp.name }); continue; }
        const ms = t - c.run.started;
        if (ms < ch.minMs) { end(c, 'That run was too fast to be valid and was not counted.'); continue; }
        end(c, `${ch.name} complete in ${(ms / 1000).toFixed(1)} s.`, true);
        record(c, ch, ms);
      }
    },
    view,
  };
}
