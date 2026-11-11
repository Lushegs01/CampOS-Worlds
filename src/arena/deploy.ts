// Combat Arena deployment: the explicit lifecycle from pressing Quick Play (or Training, a private match, a
// rejoin) until the player is in the match, spawned and in control. Every stage has an entry condition (the call
// that enters it), a completion condition (the call that leaves it), a failure condition and a time budget
// watched by `watchdog()`, so no stage can hold a player indefinitely:
//
//   requesting     the request is sent              → done on the server's 'match'   → fails on refusal / no answer (12 s)
//   loading-code   the arena's 3D code downloads    → done when the scene mounts    → fails after 45 s without it
//   preparing      required art downloads           → done when it can be drawn     → fails after 45 s without a byte
//                                                                                     arriving, or when an essential
//                                                                                     file fails after its retries
//   synchronizing  told the server we are loaded    → done when we are spawned and  → recovers (rejoin) after 12 s,
//                                                      have the server's state         fails after a second 12 s
//   deployed       playing
//   recovering     connection lost while deploying  → back to the stage it left when reconnected and rejoined
//   failed         shown with the real reason and, when it can help, Retry
//
// Correlation: each attempt has an id (`cid`) sent with the request; the server's trace of the same attempt
// carries it (server/arena/service.mjs, createDeployTraces). One structured `[arena-deploy]` line is logged per
// attempt and the timings are reported to the server (no names or account details in either).
import { create } from 'zustand';
import { traffic, resetTraffic, onTraffic } from '../world/fetcher';

export type Stage = 'idle' | 'requesting' | 'loading-code' | 'preparing' | 'synchronizing' | 'deployed' | 'recovering' | 'failed';
export type DeployKind = 'queue' | 'private' | 'training' | 'rejoin';
export interface DeployFailure { message: string; detail?: string; retry: 'request' | 'assets' | 'rejoin' | null }
export interface DeployState {
  cid: string; kind: DeployKind | null; stage: Stage; resumeStage: Stage | null; startedAt: number; stageAt: number;
  /** Milliseconds from the start at which each stage was reached. */
  marks: Record<string, number>;
  /** Real download progress: required (priority-1) files done of those requested, all bytes received, and the
   *  bytes of required files received (`expected` is kept for the trace). */
  files: { done: number; total: number; failed: number }; bytes: number; expected: number; retries: number;
  /** The current stage is taking longer than it should (the screen says so and offers a way out). */
  slow: boolean; failure: DeployFailure | null;
  /** What is still being prepared (for the screen: 'environment', 'weapon', 'soldiers' …). */
  pending: string[]; tier: 'mobile' | 'full';
}
const fresh = (): DeployState => ({ cid: '', kind: null, stage: 'idle', resumeStage: null, startedAt: 0, stageAt: 0, marks: {}, files: { done: 0, total: 0, failed: 0 }, bytes: 0, expected: 0, retries: 0, slow: false, failure: null, pending: [], tier: 'full' });
export const useDeploy = create<DeployState>()(() => fresh());
const get = () => useDeploy.getState(), set = (v: Partial<DeployState>) => useDeploy.setState(v);
const now = () => performance.now();

/** Time budgets (ms): when a stage shows as slow, and when it fails. */
export const BUDGET: Record<string, { slow: number; fail: number }> = {
  requesting: { slow: 4000, fail: 12000 },
  'loading-code': { slow: 8000, fail: 45000 },
  // Preparing is judged by progress, not duration: slow phones on slow networks are allowed as long as bytes arrive.
  preparing: { slow: 15000, fail: 45000 },
  synchronizing: { slow: 5000, fail: 12000 },
  recovering: { slow: 6000, fail: 70000 },
};

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
let inFlight = false;
/** True while a deployment request is outstanding (duplicate taps and clicks are ignored). */
export const deploying = () => inFlight || (get().stage !== 'idle' && get().stage !== 'deployed' && get().stage !== 'failed');

/** Start a new attempt. Returns its correlation id, or null when one is already running. */
export function begin(kind: DeployKind, force = false): string | null {
  if (!force && kind !== 'rejoin' && deploying()) return null;
  inFlight = kind !== 'rejoin';
  resetTraffic();
  const cid = randomId(), t = now();
  useDeploy.setState({ ...fresh(), cid, kind, stage: 'requesting', startedAt: t, stageAt: t, marks: { requesting: 0 } });
  return cid;
}
/** Enter `stage` (no-op when already there or the attempt has ended). */
export function enter(stage: Stage, extra: Partial<DeployState> = {}) {
  const s = get(); if (s.stage === stage || s.stage === 'idle' || s.stage === 'failed' && stage !== 'requesting') return;
  if (s.stage === 'deployed' && stage !== 'recovering') return;
  const t = now();
  set({ stage, stageAt: t, slow: false, marks: { ...s.marks, [stage]: Math.round(t - s.startedAt) }, ...extra });
  if (stage !== 'requesting') inFlight = false;
}
/** The server put us in a match. */
export function assigned() { const s = get(); if (s.stage === 'requesting' || s.stage === 'recovering' || s.stage === 'idle') { if (s.stage === 'idle') begin('rejoin', true); enter('loading-code'); } }
/** What is still loading, for the screen. */
export function pending(list: string[]) { if (JSON.stringify(list) !== JSON.stringify(get().pending)) set({ pending: list }); }
export function setTier(tier: 'mobile' | 'full') { set({ tier }); }
/** The player is spawned, synchronised and in control. */
export function deployed() {
  const s = get(); if (s.stage === 'deployed' || s.stage === 'idle' || s.stage === 'failed') return;
  enter('deployed'); inFlight = false;
  report(true);
}
/** Stop: the deployment cannot continue. `retry` says what the Retry button does. */
export function fail(message: string, retry: DeployFailure['retry'], detail?: string) {
  const s = get(); if (s.stage === 'idle' || s.stage === 'deployed' || s.stage === 'failed') return;
  inFlight = false;
  set({ stage: 'failed', failure: { message, retry, detail }, slow: false, marks: { ...s.marks, failed: Math.round(now() - s.startedAt) } });
  report(false, s.stage);
}
/** The connection dropped while deploying: remember where we were. */
export function lost() { const s = get(); if (s.stage === 'idle' || s.stage === 'deployed' || s.stage === 'failed' || s.stage === 'recovering') return; set({ resumeStage: s.stage }); enter('recovering'); }
/** Reconnected and back in the match: continue where we left off. */
export function resumed() { const s = get(); if (s.stage !== 'recovering') return; enter(s.resumeStage && s.resumeStage !== 'requesting' ? s.resumeStage : 'preparing', { resumeStage: null }); }
/** Abandon (left the match, closed the arena). */
export function reset() { inFlight = false; useDeploy.setState(fresh()); }

// ---------------------------------------------------------------- progress and the watchdog
onTraffic(() => {
  const s = get(); if (s.stage === 'idle' || s.stage === 'deployed') return;
  set({ files: { done: traffic.critical.finished, total: traffic.critical.started, failed: traffic.failed }, bytes: traffic.bytes, expected: traffic.critical.bytes, retries: traffic.retries });
});
let onTimeout: ((stage: Stage) => void) | null = null;
/** The network layer decides what a timed-out stage means (re-sync, give up). */
export function onStageTimeout(fn: (stage: Stage) => void) { onTimeout = fn; }
/** Called every second while the arena is open. */
export function watchdog() {
  const s = get(), b = BUDGET[s.stage]; if (!b) return;
  const t = now(), inStage = t - s.stageAt;
  // While preparing, the clock that matters is the time since the last byte arrived.
  const idle = s.stage === 'preparing' ? Math.min(inStage, t - Math.max(traffic.lastByteAt, s.stageAt)) : inStage;
  const slow = s.stage === 'preparing' ? inStage > b.slow && (idle > 6000 || inStage > 40000) : inStage > b.slow;
  if (slow !== s.slow) set({ slow });
  if (idle > b.fail) onTimeout?.(s.stage);
}

// ---------------------------------------------------------------- diagnostics
export interface DeployTrace { cid: string; kind: string | null; ok: boolean; stage: Stage; total: number; stages: Record<string, number>; files: number; failed: number; retries: number; bytes: number; tier: string; failures: { url: string; reason: string }[]; failure?: string }
const traces: DeployTrace[] = [];
let reporter: ((t: DeployTrace) => void) | null = null;
/** Where finished traces go (the network layer sends them to the server). */
export function onReport(fn: (t: DeployTrace) => void) { reporter = fn; }
function report(ok: boolean, at?: Stage) {
  const s = get();
  const trace: DeployTrace = { cid: s.cid, kind: s.kind, ok, stage: at ?? s.stage, total: Math.round(now() - s.startedAt), stages: s.marks, files: traffic.finished, failed: traffic.failed, retries: traffic.retries, bytes: traffic.bytes, tier: s.tier,
    failures: traffic.failures.slice(-5).map(({ url, reason }) => ({ url, reason })), ...(s.failure ? { failure: s.failure.message } : {}) };
  traces.push(trace); if (traces.length > 10) traces.shift();
  console.info('[arena-deploy]', JSON.stringify(trace));
  reporter?.(trace);
}
/** The last few deployments on this device (Settings → diagnostics, and the QA suites). */
export const recentDeployments = () => traces.slice();
