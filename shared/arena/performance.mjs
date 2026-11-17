// Runtime-only visual budgets. Never persist these or use network latency to select them.
// Reduce optional GPU work before trying fewer pixels. Reversible without rebuilding the world.
export function createPerformanceBudget({ target = 30, max = 1, min = .85 } = {}) {
  let level = 0, scale = max, slow = 0, fast = 0, cooldown = 0, trial = null, retry = 0;
  return {
    get level() { return level; },
    get scale() { return scale; },
    sample(fps) {
      const result = changed => ({ level, scale, changed });
      if (!Number.isFinite(fps) || fps <= 0) { slow = fast = 0; return result(false); }
      cooldown = Math.max(0, cooldown - 1); retry = Math.max(0, retry - 1);
      if (cooldown) return result(false);
      if (trial) {
        const previous = trial; trial = null;
        // CPU-limited or refresh-capped: lower resolution did not help. Restore sharpness.
        if (fps < previous.fps * 1.08) { scale = previous.scale; retry = 60; cooldown = 4; return result(true); }
      }
      if (fps < target * .9) { slow++; fast = 0; }
      else if (fps > target * 1.2) { fast++; slow = 0; }
      else { slow = fast = 0; }
      if (slow >= 3) {
        slow = 0; cooldown = 4;
        if (level < 2) { level++; return result(true); }
        if (scale > min + .001 && !retry) {
          trial = { fps, scale }; scale = Math.max(min, scale * .9); return result(true);
        }
      }
      if (fast >= 15) {
        fast = 0; cooldown = 8;
        if (scale < max) { scale = Math.min(max, scale + .1); return result(true); }
        if (level > 0) { level--; return result(true); }
      }
      return result(false);
    },
  };
}
