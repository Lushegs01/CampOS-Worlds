// Connection quality, measured rather than assumed from an open socket: round-trip time and its jitter (pings), lost
// pings, snapshot arrival gaps and their jitter, how often and how far the server corrects our predicted position, and
// reconnections. From these: a grade for the player's indicator, and the remote-player interpolation delay (enough
// buffered snapshots to ride out the measured jitter, no more).
// Network only: nothing here reads or changes graphics settings (tests/net-quality.test.mjs checks the separation).

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const push = (a, v, n) => { a.push(v); if (a.length > n) a.shift(); };

export const GRADES = ['good', 'fair', 'poor', 'critical'];
/** Interpolation delay bounds (ms): the default, and the most the server's rewind allows comfortably. */
export const DELAY = { min: 100, max: 200 };

export function createNetMonitor() {
  const rtts = [], gaps = [], pending = new Map(), corrections = [];
  let lastSnap = 0, sent = 0, lost = 0, reconnects = 0;
  return {
    /** A ping went out (id = its send time). */
    ping(id, now) { pending.set(id, now); sent++; for (const [k, t] of pending) if (now - t > 5000) { pending.delete(k); lost++; } if (sent > 40) { sent = Math.round(sent / 2); lost = Math.round(lost / 2); } },
    pong(id, now) { const t = pending.get(id); if (t == null) return; pending.delete(id); push(rtts, now - t, 16); },
    snapshot(now) { if (lastSnap) push(gaps, now - lastSnap, 60); lastSnap = now; },
    /** The server moved our predicted position by `d` metres. */
    correction(d, now) { if (d > .05) push(corrections, { d, at: now }, 64); },
    reconnected() { reconnects++; lastSnap = 0; gaps.length = 0; },
    report(now) {
      const rtt = median(rtts), jitter = rtts.length > 1 ? median(rtts.slice(1).map((r, i) => Math.abs(r - rtts[i]))) : 0;
      const loss = sent ? lost / sent : 0, gap = lastSnap ? now - lastSnap : 0;
      const g50 = median(gaps), g95 = pct(gaps, .95), snapJitter = Math.max(0, g95 - g50);
      const recent = corrections.filter(c => now - c.at < 30000), perMin = recent.length * 2, worst = recent.reduce((m, c) => Math.max(m, c.d), 0);
      let grade = 0;
      if (rtt > 120 || jitter > 25 || loss > .02 || g95 > 120 || perMin > 6) grade = 1;
      if (rtt > 250 || jitter > 60 || loss > .08 || g95 > 220 || perMin > 20) grade = 2;
      if (gap > 1500 || loss > .3) grade = 3;
      // Buffer enough to cover a typical late snapshot (its gap beyond the usual spacing), within bounds.
      const delayMs = Math.round(Math.min(DELAY.max, Math.max(DELAY.min, g50 + snapJitter * 1.2 + 20)));
      return { rtt: Math.round(rtt), jitter: Math.round(jitter), loss: +loss.toFixed(3), gap: Math.round(gap), snapMs: Math.round(g50), snapJitter: Math.round(snapJitter), corrections: perMin, worstCorrection: +worst.toFixed(2), reconnects, grade: GRADES[grade], delayMs };
    },
  };
}
