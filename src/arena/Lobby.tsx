// Combat Arena lobby: your identity and level, Quick Play for each mode (matchmaking), private matches
// with an invitation code, Training against labelled bots, your loadout, and the arena rankings.
import { useEffect, useState } from 'react';
import { Swords, Users, Bot, Trophy, KeyRound, Play, Map as MapIcon, Shield, Settings2, ChevronRight, Lock } from 'lucide-react';
import { MODES, xpForLevel, MAX_LEVEL } from '../../shared/arena/rules.mjs';
import { MAPS } from '../../shared/arena/maps.mjs';
import { WEAPON_BY_ID, EQUIPMENT_BY_ID, PERK_BY_ID, EMBLEM_BY_ID, EMBLEMS } from '../../shared/arena/weapons.mjs';
import { useArena } from './store';
import { request } from './net';
import { getCommunityService } from '../services/community';
import { useAccount } from '../account/store';
import { sfx } from './audio';

type Tab = 'play' | 'private' | 'training' | 'rankings';
export default function Lobby() {
  const me = useArena(s => s.me), status = useArena(s => s.status), error = useArena(s => s.error), loadout = useArena(s => s.loadout), online = useArena(s => s.online);
  const [tab, setTab] = useState<Tab>('play'), [map, setMap] = useState('any'), [busy, setBusy] = useState(''), [msg, setMsg] = useState('');
  const [code, setCode] = useState(''), [privMode, setPrivMode] = useState('tdm'), [privMap, setPrivMap] = useState('foundry'), [size, setSize] = useState(4);
  const [tMode, setTMode] = useState('tdm'), [tMap, setTMap] = useState('foundry'), [bots, setBots] = useState(5), [difficulty, setDifficulty] = useState('normal');
  const run = async (label: string, data: Record<string, unknown>) => {
    setBusy(label); setMsg(''); sfx.ui();
    const r = await request(data); setBusy('');
    if (!r.ok) setMsg(String(r.reason ?? 'That did not work. Try again.'));
  };
  const ready = status === 'ready';
  const level = me?.level ?? 1, xp = me?.xp ?? 0, floor = xpForLevel(level), ceil = xpForLevel(level + 1), pct = level >= MAX_LEVEL ? 100 : Math.round((xp - floor) / Math.max(1, ceil - floor) * 100);
  const emblem = EMBLEM_BY_ID.get(me?.emblem ?? 'recruit');
  return <div className="ar-lobby">
    <header className="ar-lobby-head">
      <div className="ar-brand"><Swords size={22} /><div><span className="ar-eyebrow">CAMPOS COMBAT SIMULATION</span><h1>Combat Arena</h1></div></div>
      <div className="ar-player">
        <span className="ar-emblem" style={{ color: emblem?.color }}>{emblem?.glyph}</span>
        <div><b>{me?.name ?? '…'}{me?.verified && <em className="ar-verified" title="Signed-in account">✓</em>}</b>
          <div className="ar-level"><span>Level {level}</span><div className="ar-xpbar"><i style={{ width: `${pct}%` }} /></div><small>{level >= MAX_LEVEL ? 'Max level' : `${xp - floor} / ${ceil - floor} XP`}</small></div></div>
      </div>
      <div className="ar-head-actions">
        <span className="ar-online"><i className={ready ? 'on' : ''} />{ready ? `${online} in the arena` : status === 'connecting' ? 'Connecting…' : status === 'replaced' ? 'Open in another window' : 'Offline'}</span>
        <button className="ar-icon" aria-label="Arena settings" onClick={() => useArena.getState().set({ settingsOpen: true })}><Settings2 size={18} /></button>
      </div>
    </header>
    {!me?.verified && ready && <p className="ar-note"><Shield size={15} /> Playing as a guest: matches work fully, but experience, statistics and loadouts are kept only for signed-in accounts. Sign in from the campus to keep your progress.</p>}
    {(error || msg) && <p className="ar-error" role="alert">{msg || error}</p>}
    <nav className="ar-tabs" role="tablist">
      {([['play', 'Quick Play', Swords], ['private', 'Private match', KeyRound], ['training', 'Training', Bot], ['rankings', 'Rankings', Trophy]] as const).map(([id, label, Icon]) =>
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setMsg(''); }}><Icon size={16} />{label}</button>)}
    </nav>
    <div className="ar-lobby-body">
      <section className="ar-main">
        {tab === 'play' && <>
          <div className="ar-modes">{MODES.map(m => <article key={m.id} className="ar-mode">
            <span className="ar-eyebrow">{m.short} · 6 v 6</span><h2>{m.name}</h2><p>{m.text}</p>
            <button className="ar-primary" disabled={!ready || !!busy} onClick={() => run(m.id, { t: 'queue', mode: m.id, map })}>{busy === m.id ? 'Finding a match…' : <><Play size={16} />Quick Play</>}</button>
          </article>)}</div>
          <MapChooser value={map} onChange={setMap} any />
          <p className="ar-fine">Quick Play puts you in the fullest open match of that mode, or opens a new one. Teams are balanced as players join. Live matches contain only connected players: there are no bots outside Training.</p>
        </>}
        {tab === 'private' && <div className="ar-private">
          <article><h2>Create a private match</h2><p>Share the code with friends. You start the match when everyone is in. Private matches do not award experience.</p>
            <label>Mode<select value={privMode} onChange={e => setPrivMode(e.target.value)}>{MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Map<select value={privMap} onChange={e => setPrivMap(e.target.value)}>{MAPS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Team size<select value={size} onChange={e => setSize(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} v {n}</option>)}</select></label>
            <button className="ar-primary" disabled={!ready || !!busy} onClick={() => run('create', { t: 'private', action: 'create', mode: privMode, map: privMap, size })}><Users size={16} />Create match</button></article>
          <article><h2>Join with a code</h2><p>Six letters and numbers, from the match host.</p>
            <input className="ar-code" value={code} maxLength={6} placeholder="ABC234" aria-label="Match code" onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <button className="ar-primary" disabled={!ready || code.length !== 6 || !!busy} onClick={() => run('join', { t: 'private', action: 'join', code })}><KeyRound size={16} />Join match</button></article>
        </div>}
        {tab === 'training' && <div className="ar-training">
          <article><h2>Training</h2><p>Practise against simulation units. Bots are clearly labelled <em className="ar-bot">SIM</em>, follow the same rules as players (they see only what is in their line of sight) and never appear in Quick Play. Training does not award experience.</p>
            <label>Mode<select value={tMode} onChange={e => setTMode(e.target.value)}>{MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Map<select value={tMap} onChange={e => setTMap(e.target.value)}>{MAPS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Bots<select value={bots} onChange={e => setBots(Number(e.target.value))}>{[1, 3, 5, 7, 9].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>Difficulty<select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label>
            <button className="ar-primary" disabled={!ready || !!busy} onClick={() => run('training', { t: 'training', mode: tMode, map: tMap, bots, difficulty })}><Bot size={16} />{busy === 'training' ? 'Starting…' : 'Start training'}</button></article>
        </div>}
        {tab === 'rankings' && <Rankings />}
      </section>
      <aside className="ar-side">
        <div className="ar-loadout-card">
          <span className="ar-eyebrow">LOADOUT · {loadout.name}</span>
          <ul>
            <li><b>{WEAPON_BY_ID.get(loadout.primary)?.name}</b><small>Primary</small></li>
            <li><b>{WEAPON_BY_ID.get(loadout.secondary)?.name}</b><small>Secondary</small></li>
            <li><b>{EQUIPMENT_BY_ID.get(loadout.lethal)?.name} · {EQUIPMENT_BY_ID.get(loadout.tactical)?.name}</b><small>Equipment</small></li>
            <li><b>{loadout.perks.map(p => PERK_BY_ID.get(p)?.name).join(' · ')}</b><small>Perks</small></li>
          </ul>
          <button className="ar-secondary" onClick={() => useArena.getState().set({ editor: true })}>Edit loadouts<ChevronRight size={16} /></button>
        </div>
        <Controls />
      </aside>
    </div>
  </div>;
}

export function MapChooser({ value, onChange, any = false }: { value: string; onChange: (v: string) => void; any?: boolean }) {
  return <div className="ar-maps" role="radiogroup" aria-label="Map">
    {any && <button role="radio" aria-checked={value === 'any'} className={value === 'any' ? 'on' : ''} onClick={() => onChange('any')}><MapIcon size={16} /><b>Any map</b><small>Fastest match</small></button>}
    {MAPS.map(m => <button key={m.id} role="radio" aria-checked={value === m.id} className={value === m.id ? 'on' : ''} onClick={() => onChange(m.id)}><MapIcon size={16} /><b>{m.name}</b><small>{m.blurb}</small></button>)}
  </div>;
}

function Controls() {
  return <div className="ar-controls"><span className="ar-eyebrow">CONTROLS</span>
    <dl><dt>WASD</dt><dd>Move</dd><dt>Mouse</dt><dd>Aim · left fire · right aim down sights</dd><dt>Shift</dt><dd>Sprint</dd><dt>C / Ctrl</dt><dd>Crouch · while sprinting: slide</dd><dt>Space</dt><dd>Jump</dd><dt>R</dt><dd>Reload</dd>
      <dt>1 2 · wheel</dt><dd>Switch weapon</dd><dt>V</dt><dd>Melee</dd><dt>G · Q</dt><dd>Lethal · tactical</dd><dt>3 4 5</dt><dd>Scorestreaks</dd><dt>Tab</dt><dd>Scoreboard</dd><dt>Esc</dt><dd>Menu</dd></dl>
    <p className="ar-fine">Gamepads: sticks to move and aim, triggers to aim and fire, A jump, B crouch/slide, X reload, Y switch, bumpers for equipment, d-pad for streaks. Touch screens get on-screen controls.</p>
  </div>;
}

type BoardRow = { handle: string; display_name: string; rank: number; xp: number; level: number; emblem: string; kills: number; deaths: number; wins: number; matches: number; kd: number };
function Rankings() {
  const configured = useAccount(a => a.status !== 'unconfigured'), signedIn = useAccount(a => a.status === 'signed-in'), userId = useAccount(a => a.userId);
  const [history, setHistory] = useState<{ id: string; mode: string; map: string; ended_at: string; result: string; kills: number; deaths: number; assists: number; captures: number; xp: number; scores: number[]; team: number }[]>([]);
  const [board, setBoard] = useState<{ ranked: BoardRow[]; me: { xp: number; level: number; matches: number; rank: number | null } | null } | null>(null), [mine, setMine] = useState<Record<string, any> | null>(null), [err, setErr] = useState('');
  useEffect(() => {
    if (!configured) return;
    void getCommunityService().then(async svc => {
      try {
        setBoard(await svc.arenaLeaderboard() as typeof board);
        if (signedIn) setMine(await svc.myArena() as Record<string, any>);
        if (signedIn && userId) setHistory(((await svc.arenaProfile(userId)) as { history?: typeof history } | null)?.history ?? []);
      }
      catch (e) { setErr((e as Error).message); }
    });
  }, [configured, signedIn, userId]);
  if (!configured) return <div className="ar-empty"><Lock size={22} /><p>Rankings and statistics need accounts, which are not set up on this deployment. Matches still work.</p></div>;
  if (err) return <p className="ar-error">{err}</p>;
  if (!board) return <p className="ar-fine">Loading rankings…</p>;
  const st = mine?.stats;
  return <div className="ar-rankings">
    {st && <div className="ar-mystats">{[['Level', st.level], ['Matches', st.matches], ['Wins', st.wins], ['Eliminations', st.kills], ['K/D', (st.kills / Math.max(1, st.deaths)).toFixed(2)], ['Assists', st.assists], ['Headshots', st.headshots], ['Best streak', st.best_streak]].map(([k, v]) => <div key={k}><b>{v}</b><small>{k}</small></div>)}</div>}
    {mine?.weapons?.length > 0 && <table className="ar-table"><thead><tr><th>Weapon</th><th>Level</th><th>Eliminations</th><th>Headshots</th><th>Accuracy</th></tr></thead><tbody>
      {mine!.weapons.map((w: { weapon: string; level: number; kills: number; headshots: number; shots: number; hits: number }) => <tr key={w.weapon}><td>{WEAPON_BY_ID.get(w.weapon)?.name}</td><td>{w.level}</td><td>{w.kills}</td><td>{w.headshots}</td><td>{w.shots ? Math.round(w.hits / w.shots * 100) + '%' : '—'}</td></tr>)}</tbody></table>}
    {mine && <EmblemPicker level={st?.level ?? 1} current={mine.emblem} />}
    {signedIn && <table className="ar-table" aria-label="Your recent matches"><thead><tr><th>Recent match</th><th>Result</th><th>Score</th><th>E</th><th>D</th><th>A</th><th>XP</th></tr></thead><tbody>
      {history.length ? history.map(h => <tr key={h.id}><td>{MODES.find(m => m.id === h.mode)?.name} · {MAPS.find(m => m.id === h.map)?.name}<br /><small>{new Date(h.ended_at).toLocaleString()}</small></td>
        <td className={h.result === 'win' ? 'ar-ok' : h.result === 'loss' ? 'ar-error' : ''}>{h.result === 'win' ? 'Victory' : h.result === 'loss' ? 'Defeat' : 'Draw'}</td><td>{h.scores[h.team]}–{h.scores[1 - h.team]}</td><td>{h.kills}</td><td>{h.deaths}</td><td>{h.assists}</td><td>+{h.xp}</td></tr>)
        : <tr><td colSpan={7}>Your Quick Play matches will appear here.</td></tr>}</tbody></table>}
    <table className="ar-table"><thead><tr><th>#</th><th>Player</th><th>Level</th><th>XP</th><th>Wins</th><th>K/D</th></tr></thead><tbody>
      {board.ranked.length ? board.ranked.map(r => <tr key={r.handle}><td>{r.rank}</td><td><span style={{ color: EMBLEM_BY_ID.get(r.emblem)?.color }}>{EMBLEM_BY_ID.get(r.emblem)?.glyph}</span> {r.display_name} <small>@{r.handle}</small></td><td>{r.level}</td><td>{r.xp}</td><td>{r.wins}/{r.matches}</td><td>{r.kd}</td></tr>)
        : <tr><td colSpan={6}>No ranked players yet. Finish a Quick Play match while signed in to appear here.</td></tr>}</tbody></table>
    {board.me?.rank && <p className="ar-fine">You are ranked #{board.me.rank}.</p>}
  </div>;
}
function EmblemPicker({ level, current }: { level: number; current: string }) {
  const [value, setValue] = useState(current), [msg, setMsg] = useState('');
  return <div className="ar-emblems"><span className="ar-eyebrow">EMBLEM</span><div>{EMBLEMS.map(e => <button key={e.id} disabled={e.level > level} className={value === e.id ? 'on' : ''} title={e.level > level ? `${e.name}: level ${e.level}` : e.name} style={{ color: e.color }}
    onClick={async () => { try { const svc = await getCommunityService(); await svc.setArenaEmblem(e.id); setValue(e.id); setMsg('Emblem saved. It shows from your next match.'); } catch (x) { setMsg((x as Error).message); } }}>{e.glyph}</button>)}</div>{msg && <small>{msg}</small>}</div>;
}
