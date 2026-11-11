// Robust downloads (used by Combat Arena): every model, texture and sound the arena fetches goes through here, so none of them can
// hold a player on the deployment screen forever.
//
// * Priority queue: gameplay-critical files (priority 1) are always started before nearby detail (2) and optional
//   files (3), with a bounded number in flight, so optional art never competes with what the player needs to play.
// * Timeouts: a request that stops receiving bytes for `stallMs`, or exceeds `timeoutMs` overall, is aborted.
// * Retries: network errors, timeouts and server errors (5xx, 408, 429) are retried with exponential backoff and
//   jitter; permanent failures (404, 403, …) are not. Each attempt and failure is recorded for diagnostics.
// * Progress: bytes received are reported as they arrive, so the deployment screen can show real progress.
// * Cancellation: an AbortSignal (leaving the match) cancels queued and running requests.

export type Priority = 1 | 2 | 3;
export interface FetchOptions { priority?: Priority; timeoutMs?: number; stallMs?: number; retries?: number; signal?: AbortSignal; label?: string }
export class FetchError extends Error {
  readonly url: string; readonly permanent: boolean; readonly status: number;
  constructor(message: string, url: string, permanent: boolean, status = 0) { super(message); this.name = 'FetchError'; this.url = url; this.permanent = permanent; this.status = status; }
}

/** Live totals for the deployment screen and diagnostics. */
export const traffic = { started: 0, finished: 0, failed: 0, retries: 0, bytes: 0, expected: 0, active: 0, lastByteAt: 0, failures: [] as { url: string; reason: string; at: number }[],
  /** The same counts for priority-1 files only: what the player is waiting for. */
  critical: { started: 0, finished: 0, bytes: 0 } };
const listeners = new Set<() => void>();
export function onTraffic(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
let notifyQueued = false;
function notify() { if (notifyQueued) return; notifyQueued = true; queueMicrotask(() => { notifyQueued = false; listeners.forEach(l => l()); }); }
/** Reset the counters at the start of a deployment (requests already in flight keep counting). */
export function resetTraffic() { Object.assign(traffic, { started: 0, finished: 0, failed: 0, retries: 0, bytes: 0, expected: 0, lastByteAt: performance.now(), failures: [], critical: { started: 0, finished: 0, bytes: 0 } }); notify(); }

// Everything the arena downloads belongs to the arena session: leaving the arena cancels what is still queued or running.
let session = new AbortController();
export function endSession() { session.abort(); session = new AbortController(); queue.length = 0; }
function combined(signal?: AbortSignal) {
  if (!signal) return session.signal;
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([signal, session.signal]);
  const c = new AbortController(), stop = () => c.abort();
  if (signal.aborted || session.signal.aborted) c.abort(); else { signal.addEventListener('abort', stop, { once: true }); session.signal.addEventListener('abort', stop, { once: true }); }
  return c.signal;
}

const MAX_ACTIVE = 6;
type Job = { priority: Priority; seq: number; run: () => void };
const queue: Job[] = [];
const activeBy: Record<Priority, number> = { 1: 0, 2: 0, 3: 0 };
let seq = 0;
/**
 * Start queued jobs in priority order. Strict: a lower-priority file does not start while a more important one is
 * still downloading, so on a slow connection the files the player is waiting for get all of the bandwidth.
 */
function pump() {
  queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  while (traffic.active < MAX_ACTIVE && queue.length) {
    const job = queue[0];
    if (([1, 2, 3] as Priority[]).some(p => p < job.priority && activeBy[p] > 0)) break;
    queue.shift(); traffic.active++; activeBy[job.priority]++; job.run();
  }
}
/** Wait for a slot in the queue (priority order), then run `task`. */
function slot<T>(priority: Priority, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = { priority, seq: seq++, run: () => { signal?.removeEventListener('abort', cancel); task().then(resolve, reject).finally(() => { traffic.active--; activeBy[priority]--; pump(); }); } };
    const cancel = () => { const i = queue.indexOf(job); if (i >= 0) { queue.splice(i, 1); reject(new DOMException('Aborted', 'AbortError')); } };
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    queue.push(job); pump();
  });
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});
/** Exponential backoff with full jitter: 0.4 s, 0.8 s, 1.6 s … (±50 %), capped at 6 s. */
export const backoff = (attempt: number, random = Math.random) => Math.min(6000, 400 * 2 ** attempt) * (.5 + random());
const retryable = (status: number) => status >= 500 || status === 408 || status === 429;

/** One attempt: stream the body, aborting if no bytes arrive for stallMs or the whole takes longer than timeoutMs. */
async function attempt(url: string, o: Required<Pick<FetchOptions, 'timeoutMs' | 'stallMs' | 'priority'>> & { signal?: AbortSignal }): Promise<ArrayBuffer> {
  const ctrl = new AbortController(), outer = () => ctrl.abort(o.signal?.reason);
  o.signal?.addEventListener('abort', outer, { once: true });
  let why = '';
  const kill = (reason: string) => { why = reason; ctrl.abort(); };
  const total = setTimeout(() => kill(`timed out after ${Math.round(o.timeoutMs / 1000)} s`), o.timeoutMs);
  let stall = setTimeout(() => kill(`no data for ${Math.round(o.stallMs / 1000)} s`), o.stallMs);
  const alive = () => { clearTimeout(stall); stall = setTimeout(() => kill(`no data for ${Math.round(o.stallMs / 1000)} s`), o.stallMs); };
  let counted = 0, expected = 0;
  try {
    const init: RequestInit & { priority?: string } = { signal: ctrl.signal, priority: o.priority === 1 ? 'high' : o.priority === 3 ? 'low' : 'auto' };
    const res = await fetch(url, init);
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, url, !retryable(res.status), res.status);
    alive();
    expected = Number(res.headers.get('content-length')) || 0;
    if (expected) { traffic.expected += expected; notify(); }
    if (!res.body) { const b = await res.arrayBuffer(); traffic.bytes += b.byteLength; traffic.lastByteAt = performance.now(); notify(); return b; }
    const reader = res.body.getReader(), chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); counted += value.byteLength; traffic.bytes += value.byteLength; if (o.priority === 1) traffic.critical.bytes += value.byteLength; traffic.lastByteAt = performance.now(); alive(); notify();
    }
    const out = new Uint8Array(counted); let at = 0; for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out.buffer;
  } catch (e) {
    // Undo this attempt's share of the totals so progress never runs past 100 % when it is retried.
    traffic.bytes -= counted; if (o.priority === 1) traffic.critical.bytes -= counted; if (expected) traffic.expected -= expected; notify();
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (e instanceof FetchError) throw e;
    throw new FetchError(why || (e as Error)?.message || 'network error', url, false);
  } finally { clearTimeout(total); clearTimeout(stall); o.signal?.removeEventListener('abort', outer); }
}

/**
 * Download a file with priority, timeouts and retries. Rejects with a FetchError (permanent: true for missing
 * files) or an AbortError when cancelled.
 */
export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<ArrayBuffer> {
  const o = { priority: opts.priority ?? 2, timeoutMs: opts.timeoutMs ?? 90000, stallMs: opts.stallMs ?? 15000, signal: combined(opts.signal) } as const;
  const retries = opts.retries ?? 3, critical = o.priority === 1;
  traffic.started++; if (critical) traffic.critical.started++; notify();
  for (let n = 0; ; n++) {
    try {
      const b = await slot(o.priority, o.signal, () => attempt(url, o));
      traffic.finished++; if (critical) traffic.critical.finished++; notify();
      return b;
    } catch (e) {
      if ((e as Error).name === 'AbortError') { traffic.started--; if (critical) traffic.critical.started--; notify(); throw e; }
      const err = e as FetchError, short = url.replace(/^.*\/assets\//, '').replace(/\?.*$/, '');
      traffic.failures.push({ url: short, reason: err.message, at: Math.round(performance.now()) }); if (traffic.failures.length > 20) traffic.failures.shift();
      if (err.permanent || n >= retries) { traffic.failed++; if (critical) traffic.critical.started--; notify(); throw new FetchError(`${short}: ${err.message}`, url, err.permanent, err.status); }
      traffic.retries++; notify();
      await sleep(backoff(n), o.signal);
    }
  }
}

/** Reject with `message` if `p` has not settled within `ms` (decoding a file must not hang a deployment either). */
export function deadline<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(t));
}
