import { useEffect, useState } from 'react';
import { Car, Flag, Footprints, Timer, Trophy, X } from 'lucide-react';
import { CHALLENGES } from '../../shared/challenges.mjs';
import { player, useGame } from '../state';
import { useVehicle } from '../vehicles/client';
import { useAccount } from '../account/store';
import { communityConfigured, getCommunityService } from '../services/community';
import { cancelChallenge, remaining, startChallenge, useChallenge } from '../challenges/store';
import { bearing, distanceLabel } from '../social/places';
import { Loading, useLoad } from './async';
import { useCommunity } from '../community/store';

const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
function useTick(ms: number, on = true) { const [, t] = useState(0); useEffect(() => { if (!on) return; const i = setInterval(() => t(n => n + 1), ms); return () => clearInterval(i); }, [ms, on]); }

function Board({ id }: { id: string }) {
  const signedIn = useAccount(s => s.status === 'signed-in' && !!s.profile);
  const board = useLoad(async () => (communityConfigured ? (await getCommunityService()).challengeBoard(id) : null), [id]);
  if (!communityConfigured) return <small className="muted">Times are kept for signed-in players when accounts are set up.</small>;
  if (board.loading && !board.data) return <Loading label="Loading best times…" />;
  if (!board.data) return null;
  return <div className="challenge-board">
    {board.data.me ? <small><Trophy size={11} /> Your best {(board.data.me.best_ms / 1000).toFixed(1)} s · completed {board.data.me.completions}×</small> : signedIn ? <small className="muted">You haven’t completed this yet.</small> : <small className="muted">Sign in to keep your times.</small>}
    {board.data.best.length > 0 && <ol>{board.data.best.map(r => <li key={r.id}><span>{r.rank}</span><b>{r.display_name}</b><small>{(r.best_ms / 1000).toFixed(1)} s</small></li>)}</ol>}
  </div>;
}

/** Challenges in the events drawer: what each asks, the best times, and start or cancel. */
export function Challenges() {
  const run = useChallenge(s => s.run), status = useGame(s => s.status), vehicle = useVehicle(s => s.id), seat = useVehicle(s => s.seat);
  return <div className="challenges">
    <p className="muted small-text">Timed by the room from where you actually are. Start whenever you like; there are no streaks and nothing is lost by missing a day.</p>
    {CHALLENGES.map(ch => { const mine = run?.id === ch.id, drive = ch.mode === 'drive';
      const blocker = status !== 'connected' ? 'Connect to the shared room to be timed.' : drive && !(vehicle && seat === 0) ? 'Get into the driver’s seat of a car, cart or shuttle to start.' : !drive && vehicle ? 'Step out of the vehicle: this one is on foot.' : run && !mine ? 'Finish or cancel your current challenge first.' : '';
      return <section key={ch.id} className={`challenge-card${mine ? ' active' : ''}`}>
        <header>{drive ? <Car size={18} /> : <Footprints size={18} />}<b>{ch.name}</b><small><Timer size={11} />{Math.round(ch.timeLimitMs / 60000)} min</small></header>
        <p>{ch.description}</p>
        <ol className="checkpoints">{ch.checkpoints.map((c, i) => <li key={c.id} className={mine && i < run!.next ? 'done' : mine && i === run!.next ? 'next' : ''}>{c.name}</li>)}</ol>
        <Board id={ch.id} />
        {mine ? <button className="secondary" onClick={() => void cancelChallenge()}><X size={14} />Cancel run</button>
          : <><button className="primary" disabled={!!blocker} onClick={() => void startChallenge(ch.id).then(ok => { if (ok) useCommunity.getState().toggle(false); })}><Flag size={14} />Start {ch.name}</button>{blocker && <small className="muted">{blocker}</small>}</>}
      </section>; })}
  </div>;
}

/** The current run: next checkpoint, distance and the clock. */
export function ChallengeHud() {
  const run = useChallenge(s => s.run), phase = useGame(s => s.phase);
  useTick(250, !!run);
  if (!run || phase !== 'playing') return null;
  const ch = CHALLENGES.find(c => c.id === run.id); if (!ch) return null;
  const cp = ch.checkpoints[run.next], b = cp ? bearing(player.x, player.z, cp.x, cp.z) : null, left = Math.max(0, remaining(run));
  return <aside className="challenge-hud" aria-live="polite" aria-label={`${ch.name} in progress`}>
    <span className="eyebrow">{ch.mode === 'drive' ? <Car size={11} /> : <Footprints size={11} />} {ch.name.toUpperCase()} · {run.next}/{run.total}</span>
    <b>{cp?.name}</b>{b && <small>{distanceLabel(b.distance)} {b.distance >= 8 ? b.direction : ''}</small>}
    <strong className={left < 30000 ? 'low' : ''}>{seconds(left)}</strong>
    <button className="text-button" onClick={() => void cancelChallenge()}>Cancel</button>
  </aside>;
}
