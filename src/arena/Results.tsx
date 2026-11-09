// Post-match screen: victory or defeat, final scores, everyone's statistics, your experience and what
// it unlocked, and whether the result was saved to your account.
import { Trophy, Repeat, ArrowLeft, Home, Crosshair } from 'lucide-react';
import { MODE_BY_ID, matchXp, XP, xpForLevel, MAX_LEVEL, levelFor } from '../../shared/arena/rules.mjs';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { WEAPON_BY_ID, EQUIPMENT_BY_ID, PERK_BY_ID, STREAK_BY_ID, EMBLEM_BY_ID } from '../../shared/arena/weapons.mjs';
import { useArena } from './store';
import { request } from './net';

const itemName = (id: string) => (id.startsWith('emblem:') ? `${EMBLEM_BY_ID.get(id.slice(7))?.name} emblem` : WEAPON_BY_ID.get(id)?.name ?? EQUIPMENT_BY_ID.get(id)?.name ?? PERK_BY_ID.get(id)?.name ?? STREAK_BY_ID.get(id)?.name ?? EMBLEM_BY_ID.get(id)?.name ?? id);

export default function Results({ onExit }: { onExit: () => void }) {
  const result = useArena(s => s.result), you = useArena(s => s.you), progress = useArena(s => s.progress), record = useArena(s => s.record), me = useArena(s => s.me);
  if (!result || !you) return null;
  const mine = result.players.find(p => p.num === you.num), team = mine?.team ?? you.team;
  const won = result.winner === team, draw = result.winner === null;
  const kd = mine ? (mine.kills / Math.max(1, mine.deaths)).toFixed(2) : '0';
  const breakdown = mine ? [['Eliminations', mine.kills * XP.kill], ['Headshots', mine.headshots * XP.headshot], ['Assists', mine.assists * XP.assist], ['Captures', mine.captures * XP.capture], ['Neutralised', mine.neutralizes * XP.neutralize], ['Defends', mine.defends * XP.defend],
    ['Match ' + (mine.result === 'win' ? 'win' : mine.result === 'draw' ? 'draw' : 'completed'), mine.completed ? (mine.result === 'win' ? XP.win : mine.result === 'draw' ? XP.draw : XP.loss) : 0]].filter(([, v]) => v) as [string, number][] : [];
  const earned = progress?.xp ?? (mine ? matchXp(mine) : 0);
  const total = progress?.total_xp ?? me?.xp ?? 0, level = progress?.level ?? levelFor(total), floor = xpForLevel(level), ceil = xpForLevel(level + 1);
  const rows = (t: number) => result.players.filter(p => p.team === t).sort((a, b) => b.score - a.score);
  const playAgain = async () => { const r = await request(result.kind === 'training' ? { t: 'training', mode: result.mode, map: result.map, bots: Math.max(1, result.players.filter(p => p.bot).length) } : { t: 'queue', mode: result.mode, map: 'any' }); if (!r.ok) useArena.getState().set({ phase: 'lobby', error: String(r.reason) }); };
  return <div className="ar-results" role="dialog" aria-labelledby="ar-result-title">
    <header className={draw ? 'draw' : won ? 'win' : 'loss'}>
      <span className="ar-eyebrow">{MODE_BY_ID.get(result.mode)?.name} · {MAP_BY_ID.get(result.map)?.name}{result.kind !== 'quick' ? ` · ${result.kind === 'training' ? 'Training' : 'Private'}` : ''}</span>
      <h1 id="ar-result-title"><Trophy size={28} />{draw ? 'Draw' : won ? 'Victory' : 'Defeat'}</h1>
      <div className="ar-final"><b className="friend">{result.scores[team]}</b><span>—</span><b className="enemy">{result.scores[1 - team]}</b></div>
      <small>{result.outcome === 'score' ? 'Score limit reached' : result.outcome === 'time' ? 'Time limit reached' : result.outcome === 'forfeit' ? 'The other team left the match' : 'Match abandoned'}</small>
    </header>
    <div className="ar-results-body">
      <section className="ar-you">
        <div className="ar-mystats">{[['K/D', kd], ['Eliminations', mine?.kills ?? 0], ['Deaths', mine?.deaths ?? 0], ['Assists', mine?.assists ?? 0], ...(result.mode === 'dom' ? [['Captures', mine?.captures ?? 0], ['Defends', mine?.defends ?? 0]] : [['Headshots', mine?.headshots ?? 0]]), ['Score', mine?.score ?? 0], ['Best streak', mine?.bestStreak ?? 0]].map(([k, v]) => <div key={String(k)}><b>{v}</b><small>{k}</small></div>)}</div>
        <div className="ar-xp">
          <span className="ar-eyebrow">EXPERIENCE</span>
          <ul>{breakdown.map(([k, v]) => <li key={k}><span>{k}</span><b>+{v}</b></li>)}</ul>
          <p className="ar-xptotal">+{earned} XP</p>
          {record?.state === 'saved' || progress ? <>
            <div className="ar-level"><span>Level {level}</span><div className="ar-xpbar"><i style={{ width: `${level >= MAX_LEVEL ? 100 : Math.round((total - floor) / Math.max(1, ceil - floor) * 100)}%` }} /></div></div>
            {progress && progress.level > progress.level_before && <p className="ar-levelup">Level up! {progress.level_before} → {progress.level}</p>}
            {progress?.unlocked?.length ? <p className="ar-unlocks">Unlocked: {progress.unlocked.map(itemName).join(', ')}</p> : null}
            {progress?.weapon_levels?.filter(w => w.level > w.before).map(w => <p key={w.weapon} className="ar-unlocks">{WEAPON_BY_ID.get(w.weapon)?.name} reached weapon level {w.level}</p>)}
            <p className="ar-ok">Saved to your account.</p></> :
            <p className={record?.state === 'failed' ? 'ar-error' : 'ar-fine'}>{record?.state === 'saving' ? 'Saving to your account…' : record?.reason ?? 'Waiting for the result to be recorded…'}</p>}
        </div>
      </section>
      <section className="ar-teams">{[team, 1 - team].map(t => <div key={t} className={t === team ? 'friend' : 'enemy'}><header><b>{t === team ? 'Your team' : 'Enemy team'}</b><strong>{result.scores[t]}</strong></header>
        <table><thead><tr><th>Player</th><th>Score</th><th>E</th><th>D</th><th>A</th>{result.mode === 'dom' && <th>Cap</th>}<th>XP</th></tr></thead><tbody>
          {rows(t).map(p => <tr key={p.num} className={p.num === you.num ? 'me' : ''}><td>{p.name}{p.bot && <em className="ar-bot">SIM</em>}{p.headshots > 0 && <span title="Headshots" className="ar-hs"><Crosshair size={11} />{p.headshots}</span>}</td><td>{p.score}</td><td>{p.kills}</td><td>{p.deaths}</td><td>{p.assists}</td>{result.mode === 'dom' && <td>{p.captures}</td>}<td>{p.bot ? '—' : p.xp}</td></tr>)}
        </tbody></table></div>)}</section>
    </div>
    <footer>
      <button className="ar-primary" onClick={playAgain}><Repeat size={16} />Play again</button>
      <button className="ar-secondary" onClick={() => { void request({ t: 'leave' }); useArena.getState().set({ phase: 'lobby', result: null, match: null }); }}><ArrowLeft size={16} />Lobby</button>
      <button className="ar-secondary" onClick={onExit}><Home size={16} />Return to campus</button>
    </footer>
  </div>;
}
