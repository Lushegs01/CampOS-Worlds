// Variation without repetition for the arena's sounds (src/arena/sound/engine.ts).
//
// A shuffle bag plays every variant once in a random order before any repeats, and never plays the same variant
// twice in a row across refills. Footsteps, gunshots and impacts therefore never stutter on one recording, while
// each variant still comes up as often as the others.

/** A small seeded PRNG (mulberry32): deterministic in tests, Math.random-like in the game. */
export function prng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A shuffle bag over `n` variants. `next()` returns an index. */
export function createBag(n, rand = Math.random) {
  let order = [], last = -1;
  const refill = () => {
    order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    // The first of the new round must differ from the last of the previous one.
    if (n > 1 && order[order.length - 1] === last) [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]];
  };
  return {
    next() { if (n <= 1) return 0; if (!order.length) refill(); last = order.pop(); return last; },
    get size() { return n; },
  };
}

/** Bags per key (one per sound, or per sound and emitter), created on first use. */
export function createBags(rand = Math.random) {
  const bags = new Map();
  return { next(key, n) { let b = bags.get(key); if (!b || b.size !== n) bags.set(key, b = createBag(n, rand)); return b.next(); }, clear() { bags.clear(); } };
}

/**
 * Natural variation in playback: rate within ±`rate` (a fraction) and level within ±`db` decibels, both drawn from a
 * triangular distribution (most variations are small, extremes are rare), so a repeated sound varies the way the
 * same action does, never wildly.
 */
export function jitter(rand, rate = .02, db = 1) {
  const tri = () => (rand() + rand()) - 1;
  return { rate: 1 + tri() * rate, gain: 10 ** (tri() * db / 20) };
}
