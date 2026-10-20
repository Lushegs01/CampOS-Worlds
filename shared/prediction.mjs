// Sequenced on-foot commands. A snapshot acknowledges the exact commands it includes; the client
// replays only the rest. Network delay must never be interpreted as a position error.
import { stepFrame, WALK_SPEED, SPRINT_SPEED, JUMP_SPEED, MAX_STEP } from './movement.mjs';

export const MOTION_VERSION = 1;
const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz'];
const copy = w => Object.fromEntries(FIELDS.map(k => [k, w[k]]));
const MAX_FRAME = MAX_STEP + 1, BUDGET = 4;

// Compact tuples keep high-refresh-rate input batches within the room's message size limit.
// [sequence, seconds, x input, z input, sprint (0/1), jump (0/1/2: none/normal/shot), facing]
export function validCommand(c) {
  return Array.isArray(c) && c.length === 7 && c.every(Number.isFinite) &&
    Number.isSafeInteger(c[0]) && c[0] > 0 && c[1] > 0 && c[1] <= MAX_FRAME &&
    Math.hypot(c[2], c[3]) <= 1.000001 && [0, 1].includes(c[4]) && [0, 1, 2].includes(c[5]);
}
export function applyCommand(w, c, allow) {
  if (c[5] && w.y === 0) w.vy = c[5] === 2 ? 4.4 : JUMP_SPEED;
  const speed = c[4] ? SPRINT_SPEED : WALK_SPEED;
  stepFrame(w, c[2] * speed, c[3] * speed, c[1], allow);
  w.yaw = c[6] % (Math.PI * 2);
}

/** Server authority. Time is supplied by the server, never by a client clock. */
export function createMotionAuthority(w, now = 0) {
  let epoch = 1, seq = 0, at = now, budget = .2, expected = copy(w), tag;
  function checkpoint(context, t) {
    if (tag !== undefined && (context !== tag || FIELDS.some(k => w[k] !== expected[k]))) {
      // Transitions invalidate old commands, but cannot mint another time allowance.
      epoch++; seq = 0; budget = Math.min(BUDGET, budget + Math.max(0, t - at) / 1000); at = t;
    }
    tag = context; expected = copy(w);
  }
  return {
    snapshot(context, t) { checkpoint(context, t); return { version: MOTION_VERSION, epoch, seq, ...copy(w) }; },
    receive(message, context, t, allow, locked = false) {
      checkpoint(context, t);
      if (message.epoch !== epoch || !Array.isArray(message.commands) || !message.commands.length ||
          message.commands.length > 32 || !message.commands.every(validCommand)) return false;
      budget = Math.min(BUDGET, budget + Math.max(0, t - at) / 1000); at = t;
      for (const c of message.commands) {
        if (c[0] <= seq) continue; // retransmission cannot move someone twice
        if (c[0] !== seq + 1) { epoch++; seq = 0; return false; }
        if (c[1] > budget + 1e-6) {
          // A forged clock cannot buy movement time. Start a new generation so the client can recover.
          epoch++; seq = 0; expected = copy(w); return false;
        }
        budget = Math.max(0, budget - c[1]);
        const x = w.x, z = w.z;
        if (!locked) applyCommand(w, c, allow);
        w.moving = Math.hypot(w.x - x, w.z - z) / c[1] > .2;
        w.sprinting = !!c[4]; seq = c[0]; expected = copy(w);
      }
      return true;
    },
  };
}

/** Client prediction; deliberately has no transport, React, or clock dependencies. */
export function createPrediction(w) {
  let epoch = 0, seq = 0, acknowledged = 0, sent = 0, pending = [], allow, first = true;
  return {
    get active() { return epoch !== 0; },
    get pending() { return pending.length; },
    collision(fn) { allow = fn; },
    stop() { epoch = seq = acknowledged = sent = 0; pending = []; w.vx = w.vz = w.vy = 0; },
    receive(s) {
      if (!s || s.version !== MOTION_VERSION || !Number.isSafeInteger(s.epoch) || s.epoch < epoch ||
          !Number.isSafeInteger(s.seq) || !FIELDS.every(k => Number.isFinite(s[k]))) return false;
      if (s.epoch === epoch && s.seq <= acknowledged) return false;
      if (s.epoch !== epoch) { epoch = s.epoch; seq = s.seq; pending = []; sent = s.seq; first = true; }
      else pending = pending.filter(c => c[0] > s.seq);
      acknowledged = s.seq; Object.assign(w, copy(s));
      for (const c of pending) applyCommand(w, c, allow);
      return true;
    },
    frame(dt, dx, dz, sprint, jump, yaw) {
      // The elapsed render frame can predate a welcome or teleport received between frames.
      if (first) { first = false; return 0; }
      // Bound history during a silent connection loss. Reconnection supplies a fresh generation.
      if (!epoch || pending.length >= 1024 || !Number.isFinite(dt) || dt <= 0) return 0;
      const c = [++seq, Math.min(dt, MAX_FRAME), dx, dz, Number(!!sprint), Number(!!jump), yaw];
      if (!validCommand(c)) { seq--; return 0; }
      pending.push(c); applyCommand(w, c, allow); return c[1];
    },
    hop() {
      // A jump shot can be released between render frames. Sequence its impulse before the shot
      // action, so a pre-release snapshot cannot erase the jump or apply it twice during replay.
      if (!epoch || w.y !== 0 || pending.length >= 1024) return false;
      const c = [++seq, 1e-6, 0, 0, 0, 2, w.yaw];
      pending.push(c); applyCommand(w, c, allow); return true;
    },
    batch() { return { type: 'move', epoch, commands: pending.filter(c => c[0] > sent).slice(0, 16) }; },
    didSend(batch) { if (batch.epoch === epoch && batch.commands.length) sent = batch.commands.at(-1)[0]; },
  };
}
