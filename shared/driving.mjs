// Sequenced driving commands, as shared/prediction.mjs does for walking. The driver's browser applies each
// command at once with the shared vehicle physics; the room applies the same command for the same time and
// acknowledges it, and the browser replays only what the room has not seen yet. Network delay is never
// mistaken for a position error, and the room never accepts more driving time than has really passed.

export const DRIVE_VERSION = 1;
// MAX_PENDING: about four seconds at 60 FPS (well over one at 144) of commands the room has not acknowledged.
const MAX_FRAME = .25, MAX_BATCH = 40, MAX_PENDING = 240;
const round = (v, k) => Math.round(v * k) / k;

// [sequence, seconds, throttle -1..1, steer -1..1, brake 0/1]
export function validDrive(c) {
  return Array.isArray(c) && c.length === 5 && c.every(Number.isFinite) && Number.isSafeInteger(c[0]) && c[0] > 0 &&
    c[1] > 0 && c[1] <= MAX_FRAME && Math.abs(c[2]) <= 1 && Math.abs(c[3]) <= 1 && (c[4] === 0 || c[4] === 1);
}
export const driveInput = c => ({ throttle: c[2], steer: c[3], brake: c[4] === 1 });
export const DRIVE_FIELDS = ['x', 'z', 'yaw', 'speed', 'steering', 'wheel'];
export const validDriveState = s => !!s && s.version === DRIVE_VERSION && Number.isSafeInteger(s.epoch) && s.epoch > 0 &&
  Number.isSafeInteger(s.seq) && s.seq >= 0 && DRIVE_FIELDS.every(k => Number.isFinite(s[k]));

/**
 * The driver's side. `advance(vehicle, input, seconds)` is the shared physics step for one vehicle.
 * Free of transport, React and clocks, so it is unit-tested with the room's own authority.
 */
export function createDrivePrediction(advance) {
  let epoch = 0, seq = 0, acknowledged = 0, sent = 0, pending = [];
  return {
    get active() { return epoch !== 0; },
    get pending() { return pending.length; },
    stop() { epoch = seq = acknowledged = sent = 0; pending = []; },
    /** Adopt the room's state for this vehicle, then replay the commands it has not applied yet. */
    receive(s, vehicle) {
      if (!validDriveState(s) || s.epoch < epoch || (s.epoch === epoch && s.seq < acknowledged)) return false;
      if (s.epoch !== epoch) { epoch = s.epoch; seq = sent = s.seq; pending = []; }
      else pending = pending.filter(c => c[0] > s.seq);
      acknowledged = s.seq;
      for (const k of DRIVE_FIELDS) vehicle[k] = s[k];
      for (const c of pending) advance(vehicle, driveInput(c), c[1]);
      return true;
    },
    /** One rendered frame of driving: applied locally at once and queued for the room. */
    frame(vehicle, dt, throttle, steer, brake) {
      if (!epoch || !(dt > 0)) return false;
      // Rounded before use, so the room repeats exactly the same step.
      const c = [++seq, round(Math.min(dt, MAX_FRAME), 1e4), round(Math.max(-1, Math.min(1, throttle)), 1e3), round(Math.max(-1, Math.min(1, steer)), 1e3), brake ? 1 : 0];
      if (!(c[1] > 0)) { seq--; return false; }
      advance(vehicle, driveInput(c), c[1]); pending.push(c);
      // A silent connection: stop accumulating; the room's next state (or a reconnect) resynchronises.
      if (pending.length > MAX_PENDING) this.stop();
      return true;
    },
    /** The commands not yet sent, as one bounded message, or null. */
    outbox() {
      // Oldest first: the room accepts only an unbroken sequence; the rest follow in the next message.
      const out = pending.filter(c => c[0] > sent).slice(0, MAX_BATCH);
      if (!out.length) return null;
      sent = out[out.length - 1][0];
      return { epoch, commands: out };
    },
  };
}
