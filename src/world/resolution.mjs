// Adaptive render resolution. Kept free of React and three.js so the policy is unit-tested
// (tests/resolution.test.mjs); world/World.tsx feeds it frame times and applies its answers.

/**
 * Longer than this between frames is a pause (a backgrounded tab, a frozen page), not a frame rate. It
 * was 0.5 s, which on a device drawing under 2 FPS discarded every frame: the FPS readout and the
 * telemetry never updated and the resolution never adapted, exactly where it matters most.
 */
export const STALL = 3;
const WINDOW = 1.5, SETTLE = .4, LOW_FPS = 50, HIGH_FPS = 59, STEP_DOWN = .85, STEP_UP = 1.04, GAIN = 1.08;

/**
 * Lowers the render scale while frames run long and restores it when there is headroom (with a dead
 * band between, so it does not hunt). A step down that does not make frames faster is undone: on a
 * phone limited by its CPU, or a browser holding the page at 30 FPS to save power, a lower resolution
 * only blurs the picture. After such a revert, lowering waits 20 s, then 40 s, 80 s… up to 5 minutes.
 * @param {number} max @param {number} min
 */
export function createResolution(max, min) {
  let scale = max, frames = 0, time = 0, settle = 0, trial = null, waitUntil = 0, wait = 20, clock = 0;
  const set = next => { scale = next; frames = 0; time = 0; settle = SETTLE; return next; };
  return {
    get scale() { return scale; },
    /** Feed one frame's duration (seconds). Returns the new scale when it should change, otherwise null. */
    frame(dt) {
      if (!(dt > 0) || dt > STALL) { frames = 0; time = 0; return null; }
      clock += dt;
      // The frames right after a resize include reallocating the canvas: leave them out of the measurement.
      if (settle > 0) { settle -= dt; return null; }
      frames++; time += dt;
      if (time < WINDOW) return null;
      const fps = frames / time; frames = 0; time = 0;
      if (trial) {
        const t = trial; trial = null;
        if (fps < t.fps * GAIN) { waitUntil = clock + wait; wait = Math.min(300, wait * 2); return set(t.from); }
      }
      if (fps < LOW_FPS && scale > min + .005 && clock >= waitUntil) { trial = { from: scale, fps }; return set(Math.max(min, scale * STEP_DOWN)); }
      if (fps > HIGH_FPS && scale < max - .005) return set(Math.min(max, scale * STEP_UP));
      return null;
    },
  };
}
