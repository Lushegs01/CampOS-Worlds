import { onRoomMessage } from '../network/messages';
import { create } from 'zustand';
import {  send, selfConnection } from '../network/client';
import { useGame } from '../state';
import { getCommunityService } from '../services/community';

// Court Duel, client side. The room server runs the match (src: server/duels.mjs); this mirrors its
// state for the HUD and sends requests. Nothing here decides a score or a result.

export interface DuelPlayer { id: string; name: string; handle: string | null; verified: boolean }
export interface DuelView {
  id: string; state: 'ready' | 'playing' | 'finished' | 'canceled'; scores: [number, number]; players: [DuelPlayer, DuelPlayer];
  startsIn: number; remaining: number;
  result: { outcome: 'time' | 'forfeit' | 'canceled'; winner: string | null; reason: string; recorded: null | 'pending' | 'rated' | 'unrated' | 'failed' } | null;
  /** performance.now() when this view arrived, to count the clock down between updates. */
  at: number;
}
export interface DuelChallenge { id: string; from: { id: string; name: string; handle: string | null }; expires: number }
export interface LeaderboardRow { id: string; handle: string; display_name: string; avatar: object; rank: number; rating: number; wins: number; losses: number; draws: number; rated_matches: number }
export interface Leaderboard { ranked: LeaderboardRow[]; provisional: number; me: { rating: number; rated_matches: number; matches: number; wins: number; losses: number; draws: number; best_score: number; rank: number | null } | null }
export interface DuelHistoryRow { id: string; ended_at: string; opponent: { handle: string; display_name: string }; score: number; opponent_score: number; result: 'win' | 'loss' | 'draw'; outcome: 'time' | 'forfeit'; rated: boolean; rating_change: number }

interface DuelState {
  duel: DuelView | null; challenges: DuelChallenge[];
  /** Our latest recorded result: rating after it and the change. */
  record: { id: string; rated: boolean; rating: number | null; change: number } | null;
  /** Our last finished duel, kept on screen after the room clears the court until dismissed. */
  kept: DuelView | null;
}
export const useDuel = create<DuelState>(() => ({ duel: null, challenges: [], record: null, kept: null }));
export const dismissResult = () => useDuel.setState({ kept: null });

let ref = 0;
const pending = new Map<number, (r: { ok: boolean; reason?: string }) => void>();
function act(action: 'challenge' | 'respond' | 'concede', args: Record<string, unknown> = {}) {
  if (useGame.getState().status !== 'connected') { useGame.getState().notify('Court Duels need the shared room.'); return Promise.resolve(false); }
  const r = ++ref;
  return new Promise<boolean>(resolve => {
    pending.set(r, res => { if (!res.ok) useGame.getState().notify(res.reason ?? 'That didn’t work.'); resolve(res.ok); });
    if (!send({ type: 'duel', action, ref: r, ...args })) { pending.delete(r); resolve(false); }
    setTimeout(() => { if (pending.delete(r)) { useGame.getState().notify('The room did not respond. Try again.'); resolve(false); } }, 4000);
  });
}
export const challenge = (id: string) => act('challenge', { id });
export function answerChallenge(c: DuelChallenge, accept: boolean) {
  useDuel.setState(s => ({ challenges: s.challenges.filter(x => x.id !== c.id) }));
  return act('respond', { challenge: c.id, accept });
}
export const concede = () => act('concede');

export async function loadLeaderboard(): Promise<Leaderboard> { return (await getCommunityService()).duelLeaderboard() as Promise<Leaderboard>; }
export async function loadDuelHistory(user: string): Promise<DuelHistoryRow[]> { return (await getCommunityService()).duelHistory(user) as Promise<DuelHistoryRow[]>; }

let wired = false;
export function initDuels() {
  if (wired) return; wired = true;
  onRoomMessage(m => {
    if (m.type === 'welcome' || m.type === 'duel') {
      const before = useDuel.getState().duel, next = m.duel ? { ...m.duel, at: performance.now() } as DuelView : null;
      const mine = (d: DuelView | null) => !!d && d.players.some(p => p.id === selfConnection());
      // The room frees the court a few seconds after a result; players keep theirs until they close it.
      if (!next && before && (before.state === 'finished' || before.state === 'canceled') && mine(before)) useDuel.setState({ kept: before });
      if (next && mine(next) && (next.state === 'ready' || next.state === 'playing')) useDuel.setState({ kept: null });
      useDuel.setState({ duel: next });
    }
    else if (m.type === 'duelChallenge') useDuel.setState(s => ({ challenges: [...s.challenges.filter(c => c.id !== m.challenge.id), m.challenge].slice(-3) }));
    else if (m.type === 'duelChallengeGone') useDuel.setState(s => ({ challenges: s.challenges.filter(c => c.id !== m.id) }));
    else if (m.type === 'duelRecorded') useDuel.setState({ record: { id: m.id, rated: !!m.rated, rating: m.rating ?? null, change: m.change ?? 0 } });
    else if (m.type === 'duelResult') { const done = pending.get(m.ref); pending.delete(m.ref); done?.({ ok: !!m.ok, reason: m.reason }); }
    else if (m.type === 'disconnected') { useDuel.setState({ duel: null, challenges: [] }); for (const done of pending.values()) done({ ok: false, reason: 'Disconnected.' }); pending.clear(); }
  });
  setInterval(() => { const t = Date.now(), s = useDuel.getState(); if (s.challenges.some(c => c.expires <= t)) useDuel.setState({ challenges: s.challenges.filter(c => c.expires > t) }); }, 1000);
}
