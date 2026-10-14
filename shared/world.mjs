// Authoritative interaction rules: seats, doors and basketballs. The room server runs one instance
// for everyone; the client runs its own instance when exploring offline, so the rules are identical.
import { SEAT_BY_ID, DOOR_BY_ID, BALLS, seatApproach, STAND_EXIT, SEAT_RANGE, BALL_PICKUP_RANGE } from './interactions.mjs';
import { blocked, setDoorOpen, doorOpen } from './campus.mjs';
import { newBall, stepBall, planShot, resetBall } from './ball.mjs';

const fail = reason => ({ ok: false, reason }), ok = { ok: true };
const near = (p, x, z, r) => Math.hypot(p.x - x, p.z - z) <= r;
/** Is o inside the area a door leaf sweeps when it swings towards `dir` (+1 / -1 along z)? */
const inArc = (o, d, dir) => d.leaves.some(l => { const a = (o.x - l.hx) * l.dir, b = (o.z - l.hz) * dir; return a > -.3 && b > -.1 && Math.hypot(Math.max(0, a), Math.max(0, b)) < l.len + .35; });
const inWay = (o, c) => Math.abs(o.x - c.x) < c.w / 2 + .25 && Math.abs(o.z - c.z) < c.d / 2 + .25;

export function createWorld() {
  const seats = new Map(); // seat id -> player id
  const balls = BALLS.map(newBall);
  // Balls reserved for a match (ball id -> player id): only that player may pick them up or reset them.
  const reserved = new Map();
  let shotId = 0, revision = 0;
  const changed = () => { revision++; };

  return {
    seats, balls, doors: doorOpen, reserved,
    get revision() { return revision; },
    snapshot() { return { doors: { ...doorOpen }, seats: Object.fromEntries(seats), balls: balls.map(packBall) }; },
    /** Apply a server snapshot (client side). */
    load(s) {
      for (const [id, open] of Object.entries(s.doors ?? {})) setDoorOpen(id, open);
      seats.clear(); for (const [k, v] of Object.entries(s.seats ?? {})) seats.set(k, v);
      for (const b of s.balls ?? []) { const ball = balls.find(x => x.id === b.id); if (ball) Object.assign(ball, unpackBall(b)); }
      changed();
    },

    sit(p, seatId) {
      const s = SEAT_BY_ID.get(seatId);
      if (!s) return fail('That is not a seat.');
      if (p.seat) return fail('You are already sitting.');
      if (p.ball) return fail('Put the ball down first.');
      if (p.y > .05) return fail('Land first, then sit.');
      if (seats.has(seatId) && seats.get(seatId) !== p.id) return fail('That seat is taken.');
      if (!near(p, s.x, s.z, SEAT_RANGE + .6)) return fail('Move a little closer to sit.');
      seats.set(seatId, p.id); p.seat = seatId; p.vx = p.vz = 0; p.x = s.x; p.z = s.z; p.yaw = s.yaw; changed();
      return ok;
    },

    stand(p) {
      const s = SEAT_BY_ID.get(p.seat);
      if (!s) return fail('You are not sitting.');
      // Prefer stepping forward; fall back to either side or behind if something is in the way.
      const f = [Math.sin(s.yaw), Math.cos(s.yaw)], r = [Math.cos(s.yaw), -Math.sin(s.yaw)];
      const ahead = STAND_EXIT - (s.pull ?? 0), options = [[f[0] * ahead, f[1] * ahead], [r[0] * .8, r[1] * .8], [-r[0] * .8, -r[1] * .8], [f[0] * .9, f[1] * .9], [-f[0] * .8, -f[1] * .8]];
      const spot = options.map(([dx, dz]) => ({ x: s.x + dx, z: s.z + dz })).find(o => !blocked(o.x, o.z));
      if (!spot) return fail('There is no room to stand up here.');
      seats.delete(p.seat); p.seat = null; p.x = spot.x; p.z = spot.z; changed();
      return { ok: true, x: spot.x, z: spot.z };
    },

    door(p, id, open, players = []) {
      const d = DOOR_BY_ID.get(id);
      if (!d) return fail('There is no door here.');
      if (!near(p, d.x, d.z, 2.6)) return fail('Move closer to the door.');
      if (d.locked) return fail(`Locked · ${d.locked}`);
      if (!!doorOpen[id] === !!open) return ok;
      const others = [...players.filter(o => o.id !== p.id), ...balls];
      if (open) {
        // Swing away from the opener; never through someone standing on the far side.
        const side = Math.sign(p.z - d.z) || 1, dir = d.double ? -side : d.swing;
        if (side === dir && inArc(p, d, dir)) return fail('Step back so the door can swing open.');
        if (others.some(o => inArc(o, d, dir))) return fail('Someone is on the other side of the door.');
        setDoorOpen(id, dir);
      } else {
        const dir = doorOpen[id];
        if ([p, ...others].some(o => inWay(o, d.collider) || inArc(o, d, dir))) return fail('Something is in the doorway.');
        setDoorOpen(id, 0);
      }
      changed();
      return ok;
    },

    pickup(p, ballId) {
      const b = balls.find(x => x.id === ballId);
      if (!b) return fail('There is no ball here.');
      if (reserved.has(ballId) && reserved.get(ballId) !== p.id) return fail('That ball is being used in a Court Duel.');
      if (p.seat) return fail('Stand up first.');
      if (p.ball) return fail('You are already holding a ball.');
      if (b.state === 'held') return fail(b.holder === p.id ? 'You already have it.' : 'Someone else has that ball.');
      if (b.y > 1.7 || !near(p, b.x, b.z, BALL_PICKUP_RANGE + .3)) return fail('Get closer to the ball.');
      b.state = 'held'; b.holder = p.id; b.shot = null; b.vx = b.vy = b.vz = 0; b.rest = 0; p.ball = b.id; changed();
      return ok;
    },

    drop(p) {
      const b = balls.find(x => x.id === p.ball && x.holder === p.id);
      if (!b) return fail('You are not holding a ball.');
      const yaw = p.yaw ?? 0;
      Object.assign(b, { state: 'free', holder: null, x: p.x + Math.sin(yaw) * .45, y: 1, z: p.z + Math.cos(yaw) * .45, vx: Math.sin(yaw) * .8, vy: .5, vz: Math.cos(yaw) * .8, rest: 0 });
      p.ball = null; changed();
      return ok;
    },

    shoot(p, yaw, charge) {
      const b = balls.find(x => x.id === p.ball && x.holder === p.id);
      if (!b) return fail('You need the ball to shoot.');
      if (!Number.isFinite(yaw) || !Number.isFinite(charge)) return fail('Invalid shot.');
      const launch = planShot(p.x, p.z, yaw, Math.max(0, Math.min(1, charge)));
      Object.assign(b, launch, { state: 'flight', holder: null, rest: 0, shot: { id: ++shotId, by: p.id, from: [p.x, p.z], scored: false } });
      p.ball = null; p.yaw = yaw; changed();
      return { ok: true, shot: b.shot.id, hoop: launch.hoop };
    },

    resetBall(p, ballId) {
      const b = balls.find(x => x.id === ballId);
      if (!b || (b.state === 'held' && b.holder !== p.id)) return fail('That ball is in use.');
      if (reserved.has(ballId) && reserved.get(ballId) !== p.id) return fail('That ball is being used in a Court Duel.');
      if (b.holder === p.id) p.ball = null;
      resetBall(b); changed();
      return ok;
    },

    /** Reserve a ball for one player (a match), or clear the reservation with null. */
    reserve(ballId, playerId) { if (playerId) reserved.set(ballId, playerId); else reserved.delete(ballId); changed(); },
    /** Put a ball straight into a player's hands (the start of a match). The caller makes any current holder drop it first. */
    give(p, ballId) {
      const b = balls.find(x => x.id === ballId);
      if (!b || (b.state === 'held' && b.holder !== p.id) || p.seat || p.ball) return fail('The ball could not be handed over.');
      Object.assign(b, { state: 'held', holder: p.id, shot: null, vx: 0, vy: 0, vz: 0, rest: 0 }); p.ball = b.id; changed();
      return ok;
    },
    /** Release everything a player holds (leaving, disconnecting or being removed). */
    release(p) {
      if (p.seat && seats.get(p.seat) === p.id) { seats.delete(p.seat); p.seat = null; changed(); }
      if (p.ball) this.drop(p);
    },

    /** Advance balls; held balls travel with their holder. Returns gameplay events. */
    step(dt, players) {
      const events = [];
      for (const b of balls) {
        if (b.state === 'held') {
          const h = players.find(p => p.id === b.holder);
          if (!h) { Object.assign(b, { state: 'free', holder: null, vy: 0, rest: 0 }); changed(); continue; }
          b.x = h.x; b.y = 1 + (h.y ?? 0); b.z = h.z;
        } else stepBall(b, dt, events);
      }
      return events;
    },
  };
}

const r3 = v => Math.round(v * 1000) / 1000;
export function packBall(b) { return { id: b.id, x: r3(b.x), y: r3(b.y), z: r3(b.z), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz), state: b.state, holder: b.holder, rest: r3(b.rest), shot: b.shot ? { ...b.shot } : null }; }
export function unpackBall(b) { return { ...b, shot: b.shot ? { ...b.shot } : null }; }
