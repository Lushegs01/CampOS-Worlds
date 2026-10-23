import { onRoomMessage } from '../network/messages';
import { create } from 'zustand';
import {  send } from '../network/client';
import { useGame } from '../state';
import { CHALLENGE_BY_ID } from '../../shared/challenges.mjs';

// Challenge runs are timed and judged by the room server (server/challenges.mjs). This mirrors the
// run for the HUD and points the gold marker at the next checkpoint.
export interface RunView { id: string; next: number; total: number; elapsed: number; at: number }
export const useChallenge = create<{ run: RunView | null }>(() => ({ run: null }));
const notify = (t: string) => useGame.getState().notify(t);
/** A destination the waypoint and map understand: "pt:x:z:name". */
export const pointDestination = (p: { x: number; z: number; name: string }) => `pt:${p.x}:${p.z}:${p.name}`;
function guide(run: RunView | null) {
  const g = useGame.getState(), mine = g.destination?.startsWith('pt:');
  const cp = run ? CHALLENGE_BY_ID.get(run.id)?.checkpoints[run.next] : null;
  if (cp) g.set({ destination: pointDestination(cp) }); else if (mine) g.set({ destination: null });
}
let waiting: ((ok: boolean) => void) | null = null;
function ask(action: 'start' | 'cancel', id?: string) {
  if (useGame.getState().status !== 'connected') { notify('Challenges are timed by the shared room. Reconnect from Settings.'); return Promise.resolve(false); }
  return new Promise<boolean>(resolve => { waiting = resolve; send({ type: 'challenge', action, id }); setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(false); } }, 4000); });
}
export const startChallenge = (id: string) => ask('start', id);
export const cancelChallenge = () => ask('cancel');
/** Milliseconds left in the run, counted from the room's own elapsed time (immune to clock skew). */
export const remaining = (run: RunView) => (CHALLENGE_BY_ID.get(run.id)?.timeLimitMs ?? 0) - run.elapsed - (performance.now() - run.at);

let started = false;
export function initChallenges() {
  if (started) return; started = true;
  onRoomMessage(m => {
    if (m.type === 'challenge') {
      const run = m.run ? { ...m.run, at: performance.now() } as RunView : null;
      useChallenge.setState({ run }); guide(run);
      if (m.reached) notify(`Checkpoint: ${m.reached}. ${run ? `${run.total - run.next} to go.` : ''}`);
      if (m.ended) notify(m.ended.message);
    } else if (m.type === 'challengeResult') { if (!m.ok) notify(m.reason ?? 'That didn’t work.'); const w = waiting; waiting = null; w?.(!!m.ok); }
    else if (m.type === 'progress' && m.kind === 'challenge' && Number.isFinite(m.best)) notify(`Saved to your profile. Your best: ${(m.best / 1000).toFixed(1)} s.`);
    else if (m.type === 'disconnected') { useChallenge.setState({ run: null }); guide(null); }
  });
}
