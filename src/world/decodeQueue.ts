// Decoding queue (used by src/world/assets.ts for every arena model and texture that goes through the fetcher).
import { deadline, type FetchOptions } from './fetcher.ts';

/**
 * Decoding (glTF parse, meshopt, KTX2 transcoding in the worker pool) is queued by priority, like downloads: what the
 * player is waiting for (priority 1) decodes first, and a background file (soldiers, props, other weapons) waits its
 * turn instead of filling the transcoder pool. A decode's time limit counts from when it starts, not while it queues:
 * 45 s for priority 1 (a deployment must never hang), 120 s otherwise.
 */
const MAX_DECODES = 2;
let decoding = 0, background = 0, decodeSeq = 0;
const decodeQueue: { priority: number; seq: number; run: () => void }[] = [];
/**
 * Start what may start, most important first. One slot is kept for priority 1: background decodes (priority 2–3) use
 * at most MAX_DECODES − 1 at once, so a file the player is waiting for never waits behind one that has already begun.
 */
function pumpDecodes() {
  decodeQueue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  for (let i = 0; i < decodeQueue.length && decoding < MAX_DECODES;) {
    const job = decodeQueue[i];
    if (job.priority > 1 && background >= MAX_DECODES - 1) { i++; continue; }
    decodeQueue.splice(i, 1); decoding++; if (job.priority > 1) background++; job.run();
  }
}
export function decodeSlot<T>(fetch: FetchOptions, what: string, task: () => Promise<T>): Promise<T> {
  const priority = fetch.priority ?? 2, limit = priority <= 1 ? 45000 : 120000;
  return new Promise<T>((resolve, reject) => {
    decodeQueue.push({ priority, seq: decodeSeq++, run: () => { const done = () => { decoding--; if (priority > 1) background--; pumpDecodes(); }; deadline(Promise.resolve().then(task), limit, `decoding ${what} took too long`).then(v => { done(); resolve(v); }, e => { done(); reject(e); }); } });
    pumpDecodes();
  });
}
/** For tests and diagnostics: decodes running and waiting. */
export const decodeState = () => ({ running: decoding, background, queued: decodeQueue.length });
