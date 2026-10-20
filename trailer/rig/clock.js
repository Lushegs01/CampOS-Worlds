// Injected before the game loads (Playwright addInitScript). It makes a capture deterministic:
//
// - Time is virtual once `__clock.manual()` is called: performance.now() and Date.now() only move when
//   the renderer steps a frame, and requestAnimationFrame callbacks wait for that step. A frame that
//   takes 4 s to draw in software WebGL still advances the world by exactly 1/30 s.
// - Math.random is seeded, so the vertical and horizontal renders of a shot match.
// - The room socket never connects: staged players live in the client's own peer list, and a failed
//   reconnect would clear it (src/network/client.ts). Vite's own socket is left alone.
(() => {
  const realNow = performance.now.bind(performance), realDate = Date.now, realRaf = window.requestAnimationFrame.bind(window), realCaf = window.cancelAnimationFrame.bind(window);
  let manual = false, virtual = 0, dateBase = 0, nextId = 1e7;
  const queue = new Map();
  performance.now = () => manual ? virtual : realNow();
  Date.now = () => manual ? Math.round(dateBase + virtual) : realDate();
  window.requestAnimationFrame = cb => { if (!manual) return realRaf(cb); const id = nextId++; queue.set(id, cb); return id; };
  window.cancelAnimationFrame = id => { if (!queue.delete(id)) realCaf(id); };
  window.__clock = {
    get manual() { return manual; },
    manual() { if (manual) return; virtual = realNow(); dateBase = realDate() - virtual; manual = true; },
    now: () => performance.now(),
    /** Advance virtual time and run one animation frame (synchronously: the WebGL frame is drawn on return). */
    step(ms) {
      virtual += ms;
      const due = [...queue.values()]; queue.clear();
      for (const cb of due) cb(virtual);
      return due.length;
    },
  };

  let seed = 0x2f6e2b1;
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  const NativeSocket = window.WebSocket;
  class OfflineRoom extends EventTarget {
    constructor(url) { super(); this.url = String(url); this.readyState = 0; this.onopen = this.onclose = this.onmessage = this.onerror = null; }
    send() {} close() {}
  }
  window.WebSocket = new Proxy(NativeSocket, { construct(target, args) { return /\/ws(\?|$)/.test(new URL(String(args[0]), location.href).pathname) ? new OfflineRoom(args[0]) : new target(...args); } });
})();
