// Combat Arena adaptive rendering: keeps the frame rate at its target by lowering the render resolution
// first (cheap to change, keeps every material, model and effect), and only if the lowest resolution still
// cannot hold the target, asks to step the graphics profile down one level. When there is headroom again the
// resolution comes back. Input, simulation and networking run at their fixed rates regardless.
//
// Pure logic, fed once a second with the measured frame rate (src/arena/Scene.tsx), tested in
// tests/arena-performance.test.mjs.

/**
 * target: frames per second to hold (30 on phones, 55 on desktops). min: the lowest resolution scale.
 * Returns an object with `sample(fps)` → { scale, changed, stepDown }.
 */
export function createAdaptive({ target = 30, min = .6, max = 1, start = 1 } = {}) {
  let scale = Math.min(max, Math.max(min, start)), slow = 0, fast = 0, stuck = 0, cooldown = 0;
  return {
    get scale() { return scale; },
    sample(fps) {
      let changed = false, stepDown = false;
      if (!Number.isFinite(fps) || fps <= 0) return { scale, changed, stepDown };
      if (cooldown > 0) cooldown--;
      if (fps < target * .9) { slow++; fast = 0; } else if (fps > target * 1.25) { fast++; slow = 0; } else { slow = Math.max(0, slow - 1); fast = 0; }
      // Three slow seconds in a row: 15 % fewer pixels each way.
      if (slow >= 3 && cooldown === 0) {
        if (scale > min + 1e-6) { scale = Math.max(min, Math.round(scale * .85 * 100) / 100); changed = true; slow = 0; cooldown = 2; }
        else if (++stuck >= 2) { stepDown = true; stuck = 0; slow = 0; cooldown = 8; }
        else slow = 0;
      }
      // Ten comfortable seconds: give some resolution back.
      if (fast >= 10 && scale < max && cooldown === 0) { scale = Math.min(max, Math.round((scale + .1) * 100) / 100); changed = true; fast = 0; cooldown = 3; stuck = 0; }
      return { scale, changed, stepDown };
    },
  };
}
/** The frame-rate target for a device. */
export const frameTarget = touch => (touch ? 30 : 55);
