import { useEffect, useState } from 'react';
import { Flag, Medal, Swords, Trophy, X } from 'lucide-react';
import { COURT } from '../../shared/ball.mjs';
import { livePeers, player, useGame } from '../state';
import { selfConnection } from '../network/client';
import { useAccount } from '../account/store';
import { communityConfigured } from '../services/community';
import { answerChallenge, challenge, concede, loadDuelHistory, loadLeaderboard, useDuel, type DuelView } from '../duel/store';
import { Failure, Loading, useLoad } from './async';
import { Portrait } from './Account';

const near = (x: number, z: number, m = 0) => x > COURT.x0 - m && x < COURT.x1 + m && z > COURT.z0 - m && z < COURT.z1 + m;
/** Re-render on a short interval (positions and clocks live outside React). */
function useTick(ms: number, on = true) { const [, t] = useState(0); useEffect(() => { if (!on) return; const i = setInterval(() => t(n => n + 1), ms); return () => clearInterval(i); }, [ms, on]); }
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const left = (d: DuelView, ms: number) => Math.max(0, ms - (performance.now() - d.at));

/** Game modes when you’re at The Courts: free shooting (the round of five) or a Court Duel. */
export function DuelModes() {
  const duel = useDuel(s => s.duel), peers = useGame(s => s.peers), status = useGame(s => s.status);
  useTick(700);
  const live = duel && (duel.state === 'ready' || duel.state === 'playing');
  if (live || status !== 'connected') return null;
  const onCourt = peers.filter(p => { const l = livePeers.get(p.id); return l && near(l.x, l.z, 3) && !l.vehicle; });
  return <div className="duel-modes">
    <span className="eyebrow"><Swords size={11} /> COURT DUEL · 1 V 1 · 60 S</span>
    {onCourt.length ? onCourt.slice(0, 4).map(p => <div key={p.id} className="duel-opponent"><b>{p.name}</b><button className="secondary small" onClick={() => void challenge(p.id).then(ok => { if (ok) useGame.getState().notify(`Challenge sent to ${p.name}. They have 30 seconds to accept.`); })}>Challenge</button></div>)
      : <small>Nobody else is on the court. Invite a friend to play.</small>}
    <button className="text-button" onClick={() => useGame.getState().set({ panel: 'leaderboard' })}><Trophy size={12} />Rankings and rules</button>
  </div>;
}

/** The live match: names, scores, clock; then the result with rematch. Players and nearby spectators see it. */
export function DuelHud() {
  const duel = useDuel(s => s.duel), record = useDuel(s => s.record), signedIn = useAccount(s => s.status === 'signed-in' && !!s.profile);
  const [confirm, setConfirm] = useState(false);
  useTick(250, !!duel);
  if (!duel) return null;
  const me = selfConnection(), mine = duel.players.findIndex(p => p.id === me);
  if (mine < 0 && !near(player.x, player.z, 12)) return null;
  const [a, b] = duel.players, over = duel.state === 'finished' || duel.state === 'canceled', r = duel.result;
  const opponent = mine >= 0 ? duel.players[1 - mine] : null;
  const headline = duel.state === 'ready' ? `Starts in ${Math.ceil(left(duel, duel.startsIn) / 1000)}…` : duel.state === 'playing' ? clock(left(duel, duel.remaining))
    : duel.state === 'canceled' ? 'Canceled' : !r?.winner ? 'Draw' : r.winner === me ? 'You win!' : `${duel.players.find(p => p.id === r.winner)?.name ?? 'Your opponent'} wins`;
  const saved = r?.recorded === 'pending' ? 'Saving the result…' : r?.recorded === 'failed' ? 'The result couldn’t be saved.' : r?.recorded === 'unrated' ? 'Recorded · unrated' : r?.recorded === 'rated' ? 'Recorded · rated' : r?.recorded === null && over && duel.state === 'finished' ? 'Not recorded: both players need accounts' : '';
  return <aside className={`duel-hud state-${duel.state}`} aria-live="polite" aria-label="Court Duel">
    <span className="eyebrow"><Swords size={11} /> COURT DUEL{mine < 0 ? ' · WATCHING' : ''}</span>
    <div className="duel-score">
      <span className={mine === 0 ? 'me' : ''}><b>{a.name}</b><strong>{duel.scores[0]}</strong></span>
      <em>{headline}</em>
      <span className={mine === 1 ? 'me' : ''}><strong>{duel.scores[1]}</strong><b>{b.name}</b></span>
    </div>
    {duel.state === 'ready' && mine >= 0 && <small>You’ll be handed your ball. Baskets count from inside the court; 3 points beyond 6.75 m.</small>}
    {duel.state === 'playing' && mine >= 0 && (confirm ? <div className="duel-actions"><small>Concede? It counts as a loss.</small><button className="danger small" onClick={() => { setConfirm(false); void concede(); }}>Concede</button><button className="secondary small" onClick={() => setConfirm(false)}>Keep playing</button></div>
      : <button className="text-button" onClick={() => setConfirm(true)}><Flag size={12} />Concede</button>)}
    {over && <>
      {r?.reason && <small>{r.reason}</small>}
      {saved && <small className="duel-saved">{saved}{record?.id === duel.id && record.rated ? ` · rating ${record.rating} (${record.change >= 0 ? '+' : ''}${record.change})` : ''}</small>}
      {mine >= 0 && !signedIn && duel.state === 'finished' && <small>Sign in to keep results and appear in the rankings.</small>}
      <div className="duel-actions">{opponent && duel.state === 'finished' && <button className="secondary small" onClick={() => void challenge(opponent.id)}>Rematch</button>}<button className="text-button" onClick={() => useGame.getState().set({ panel: 'leaderboard' })}><Trophy size={12} />Rankings</button></div>
    </>}
  </aside>;
}

/** Incoming challenges, answered in place. */
export function DuelChallenges() {
  const challenges = useDuel(s => s.challenges), phase = useGame(s => s.phase);
  useTick(1000, challenges.length > 0);
  if (!challenges.length || phase !== 'playing') return null;
  return <div className="party-invites duel-challenges" role="region" aria-label="Court Duel challenges">{challenges.map(c => <div key={c.id} className="party-invite" role="alertdialog" aria-label={`Court Duel challenge from ${c.from.name}`}>
    <Swords size={18} /><span><b>{c.from.name}{c.from.handle ? ` (@${c.from.handle})` : ''}</b> challenged you to a Court Duel<small>60 seconds, one ball each · {Math.max(0, Math.ceil((c.expires - Date.now()) / 1000))} s to answer</small></span>
    <button className="primary small" onClick={() => void answerChallenge(c, true)}>Accept</button><button className="secondary small" aria-label="Decline" onClick={() => void answerChallenge(c, false)}><X size={14} /></button>
  </div>)}</div>;
}

/** Rankings, the rules they follow, and your own recent duels. */
export function Leaderboard() {
  const me = useAccount(s => (s.status === 'signed-in' ? s.profile : null));
  const board = useLoad(async () => (communityConfigured ? loadLeaderboard() : null), []);
  const history = useLoad(async () => (me ? loadDuelHistory(me.id) : []), [me?.id]);
  return <div className="leaderboard">
    <div className="note small-text"><b>How Court Duel works</b><p>Two players at The Courts, one ball each, 60 seconds. Baskets count from inside the court with your own ball: 2 points, 3 beyond 6.75 m. Highest score wins; equal scores draw. Leaving the court, conceding or disconnecting during play forfeits.</p>
      <p>Duels between two signed-in players are recorded. Ratings start at 1000 and follow the Elo formula (K = 24). A duel is unrated if the same two players already played 3 rated duels in the last 24 hours, or if it ended by forfeit in its first 10 seconds. Players appear in the rankings after 3 rated duels; equal ratings share a rank.</p></div>
    {!communityConfigured ? <p className="muted">Rankings need accounts, which aren’t set up for this deployment. Guest duels are still fun, but not recorded.</p>
      : board.loading && !board.data ? <Loading label="Loading rankings…" /> : board.error ? <Failure message={board.error} retry={board.reload} /> : board.data && <>
        {board.data.me && <div className="detail-grid"><div><strong>{board.data.me.rank ?? '—'}</strong><span>{board.data.me.rank ? 'Your rank' : `Ranked after ${Math.max(0, 3 - board.data.me.rated_matches)} more rated`}</span></div><div><strong>{board.data.me.rating}</strong><span>Rating</span></div><div><strong>{board.data.me.wins}–{board.data.me.losses}–{board.data.me.draws}</strong><span>Won–lost–drawn</span></div></div>}
        <h3><Trophy size={17} /> Rankings</h3>
        {board.data.ranked.length ? <ol className="rank-list">{board.data.ranked.map(r => <li key={r.id} className={r.id === me?.id ? 'me' : ''}><span className="rank">{r.rank <= 3 ? <Medal size={15} className={`medal-${r.rank}`} /> : r.rank}</span><Portrait person={r as never} size={28} /><span className="person-name"><b>{r.display_name}</b><small>@{r.handle} · {r.wins}–{r.losses}–{r.draws}</small></span><strong>{r.rating}</strong></li>)}</ol>
          : <div className="empty-state"><Trophy size={26} /><p>No ranked players yet.</p><small>Be the first: play 3 rated Court Duels with other signed-in players.</small></div>}
        {board.data.provisional > 0 && <p className="muted small-text">{board.data.provisional} more player{board.data.provisional === 1 ? ' has' : 's have'} played but not yet 3 rated duels.</p>}
      </>}
    {me && <><h3>Your recent duels</h3>{history.loading && !history.data ? <Loading /> : history.error ? <Failure message={history.error} retry={history.reload} /> : history.data?.length ? <ul className="duel-history">{history.data.map(h => <li key={h.id}><span className={`result ${h.result}`}>{h.result}</span><span>{h.score}–{h.opponent_score} vs {h.opponent.display_name}{h.outcome === 'forfeit' ? ' (forfeit)' : ''}</span><small>{h.rated ? `${h.rating_change >= 0 ? '+' : ''}${h.rating_change}` : 'unrated'} · {new Date(h.ended_at).toLocaleDateString()}</small></li>)}</ul> : <p className="muted small-text">No duels yet. Challenge someone at The Courts.</p>}</>}
    <p className="muted small-text">Court Duel results are gameplay records only. They have no academic, attendance or official meaning.</p>
  </div>;
}
