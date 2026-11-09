// Combat Arena in-match interface. Per-frame elements (crosshair spread, hit markers, damage
// direction, flash blindness, minimap) update DOM styles directly from requestAnimationFrame;
// everything else re-renders only when its own values change.
import { memo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Crosshair, Radar, Package, Target, Skull, Wifi } from 'lucide-react';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { WEAPON_BY_ID, EQUIPMENT_BY_ID, STREAKS, CATEGORIES, EMBLEM_BY_ID } from '../../shared/arena/weapons.mjs';
import { MODE_BY_ID } from '../../shared/arena/rules.mjs';
import { weaponOf } from '../../shared/arena/sim.mjs';
import { useArena, useBanners } from './store';
import { live, currentSpread, useStreak } from './net';
import { controls } from './input';

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const weaponName = (id: string | null) => (id ? WEAPON_BY_ID.get(id)?.name ?? EQUIPMENT_BY_ID.get(id)?.name ?? (id === 'strike' ? 'Tactical Strike' : id === 'melee' ? 'Melee' : id === 'fall' ? 'Fall' : id) : '');

export default function Hud() {
  const phase = useArena(s => s.phase), dead = useArena(s => !s.hud.alive), scoreboard = useArena(s => s.scoreboard), mode = useArena(s => s.match?.mode);
  if (phase !== 'match') return null;
  return <div className="ar-hud" aria-live="polite">
    <HudFx />
    <TopBar />
    {mode === 'dom' && <Objectives />}
    <KillFeed />
    <Minimap />
    <Vitals />
    <WeaponPanel />
    <Streaks />
    <Banners />
    <MatchStatus />
    {dead && <Respawn />}
    {scoreboard && <Scoreboard />}
    <Netline />
  </div>;
}

/** Crosshair, hit markers, damage direction, flash and the sniper scope: driven every frame. */
const HudFx = memo(function HudFx() {
  const cross = useRef<HTMLDivElement>(null!), hit = useRef<HTMLDivElement>(null!), dmg = useRef<HTMLDivElement>(null!), blind = useRef<HTMLDivElement>(null!), scope = useRef<HTMLDivElement>(null!), hurt = useRef<HTMLDivElement>(null!);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now(), s = live.sim, alive = live.alive && !!s;
      const w = s ? weaponOf(s) : null, ads = s?.ads ?? 0;
      // Crosshair gap from the real spread cone (radians → pixels at the current field of view).
      const fov = useArena.getState().settings.fov * Math.PI / 180, px = Math.tan(currentSpread()) / Math.tan(fov / 2) * window.innerHeight / 2;
      cross.current.style.setProperty('--gap', `${Math.min(80, 4 + px)}px`);
      cross.current.style.opacity = !alive || s!.sprint || (ads > .6 && w?.category !== 'shotgun') ? '0' : '1';
      cross.current.classList.toggle('melee', w?.fire === 'melee');
      const h = now - live.hit.at;
      hit.current.style.opacity = h < (live.hit.kill ? 420 : 200) ? '1' : '0';
      hit.current.className = `ar-hitmarker${live.hit.kill ? ' kill' : live.hit.head ? ' head' : ''}`;
      dmg.current.innerHTML = live.damage.filter(d => now - d.at < 1400).map(d => `<i style="transform:rotate(${(d.angle + controls.yaw) * -180 / Math.PI}deg);opacity:${1 - (now - d.at) / 1400}"></i>`).join('');
      const b = live.blindUntil - now; blind.current.style.opacity = b > 0 ? String(Math.min(1, b / Math.max(400, live.blindMs * .5))) : '0';
      scope.current.style.display = alive && w?.category === 'sniper' && ads > .85 ? 'block' : 'none';
      const hp = useArena.getState().hud.hp, recent = now - live.hurtAt;
      hurt.current.style.opacity = String(Math.max(alive ? Math.max(0, (60 - hp) / 60) * .8 : 0, recent < 400 ? .6 * (1 - recent / 400) : 0));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <>
    <div ref={hurt} className="ar-hurt" />
    <div ref={scope} className="ar-scope"><i /></div>
    <div ref={cross} className="ar-crosshair"><i /><i /><i /><i /><b /></div>
    <div ref={hit} className="ar-hitmarker"><i /><i /><i /><i /></div>
    <div ref={dmg} className="ar-damage" />
    <div ref={blind} className="ar-blind" />
  </>;
});

function TopBar() {
  const { scores, timeLeft, state } = useArena(useShallow(s => ({ scores: s.hud.scores, timeLeft: s.hud.timeLeft, state: s.hud.matchState })));
  const match = useArena(s => s.match), team = useArena(s => s.you?.team ?? 0);
  if (!match) return null;
  const ours = scores[team] ?? 0, theirs = scores[1 - team] ?? 0, limit = match.scoreLimit;
  return <div className="ar-topbar">
    <div className="ar-score friend"><b>{ours}</b><span style={{ width: `${Math.min(100, ours / limit * 100)}%` }} /></div>
    <div className="ar-clock"><small>{MODE_BY_ID.get(match.mode)?.short} · {limit}</small><strong>{state === 'playing' ? fmt(timeLeft) : state === 'countdown' ? fmt(timeLeft) : state === 'ended' ? 'END' : 'WARM-UP'}</strong></div>
    <div className="ar-score enemy"><span style={{ width: `${Math.min(100, theirs / limit * 100)}%` }} /><b>{theirs}</b></div>
  </div>;
}

function Objectives() {
  const objectives = useArena(s => s.hud.objectives), team = useArena(s => s.you?.team ?? 0);
  return <div className="ar-objectives">{['A', 'B', 'C'].map((id, i) => {
    const [owner, progress, capTeam, contested] = objectives[i] ?? [-1, 0, -1, 0];
    const tone = owner < 0 ? 'neutral' : owner === team ? 'friend' : 'enemy', cap = capTeam < 0 ? '' : capTeam === team ? 'friend' : 'enemy';
    return <div key={id} className={`ar-obj ${tone}${contested ? ' contested' : ''}`} aria-label={`Zone ${id}: ${tone === 'neutral' ? 'nobody holds it' : tone === 'friend' ? 'your team holds it' : 'the enemy holds it'}${contested ? ', contested' : ''}`}>
      <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" className="track" />{cap && <circle cx="18" cy="18" r="15" className={`prog ${cap}`} style={{ strokeDasharray: `${progress * .942} 94.2` }} />}</svg><b>{id}</b>
    </div>;
  })}</div>;
}

function KillFeed() {
  const feed = useArena(s => s.feed), players = useArena(s => s.match?.players), me = useArena(s => s.you?.num), team = useArena(s => s.you?.team);
  const name = (n: number | null) => { if (n == null) return null; const p = players?.find(x => x.num === n); return p ? { text: p.name + (p.bot ? ' [SIM]' : ''), tone: n === me ? 'me' : p.team === team ? 'friend' : 'enemy' } : { text: 'Player', tone: 'enemy' }; };
  const now = performance.now();
  return <ol className="ar-feed">{feed.filter(f => now - f.at < 7000).map(f => { const k = name(f.killer), v = name(f.victim); return <li key={f.id}>
    {k && f.killer !== f.victim && <b className={k.tone}>{k.text}</b>}<span className="weapon">{f.head && <Crosshair size={12} />}{weaponName(f.weapon)}</span><b className={v?.tone}>{v?.text}</b>
  </li>; })}</ol>;
}

/** North-up tactical map: teammates always; enemies only while visible and firing, or revealed by Recon Pulse. */
const Minimap = memo(function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null!), mapId = useArena(s => s.match?.map ?? 'foundry'), mode = useArena(s => s.match?.mode);
  useEffect(() => {
    const map = MAP_BY_ID.get(mapId)!, c = ref.current, g = c.getContext('2d')!, size = 168, ratio = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = size * ratio; g.scale(ratio, ratio);
    const [x0, z0, x1, z1] = map.bounds, span = Math.max(x1 - x0, z1 - z0) * 1.05, k = size / span, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const P = (x: number, z: number) => [size / 2 + (x - cx) * k, size / 2 + (z - cz) * k];
    const base = document.createElement('canvas'); base.width = base.height = size; const bg = base.getContext('2d')!;
    bg.fillStyle = 'rgba(16,22,26,.78)'; bg.fillRect(0, 0, size, size);
    for (const b of map.boxes) { if (b.max[1] - b.min[1] < 1.4 && b.max[1] < 2.5) continue; const [a1, b1] = P(b.min[0], b.min[2]), [a2, b2] = P(b.max[0], b.max[2]); bg.fillStyle = b.min[1] > 2.5 ? 'rgba(160,170,175,.18)' : 'rgba(185,195,200,.55)'; bg.fillRect(a1, b1, a2 - a1, b2 - b1); }
    let timer = 0;
    const draw = () => {
      const now = performance.now(), a = useArena.getState();
      g.clearRect(0, 0, size, size); g.drawImage(base, 0, 0);
      if (mode === 'dom') map.objectives.forEach((o: { id: string; x: number; z: number }, i: number) => { const [px, py] = P(o.x, o.z), owner = a.hud.objectives[i]?.[0] ?? -1; g.fillStyle = owner < 0 ? '#f2efe6' : owner === live.team ? '#4fb3ff' : '#ff5a48'; g.font = '700 11px Manrope Variable, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.id, px, py); });
      for (const r of live.remotes.values()) {
        if (!(r.flags & 1) || !r.seenAt) continue;
        const friend = r.team === live.team;
        if (!friend && !(r.flags & 64)) continue;
        const [px, py] = P(r.pos.x, r.pos.z); g.fillStyle = friend ? '#4fb3ff' : '#ff5a48'; g.beginPath(); g.arc(px, py, 3.2, 0, 6.3); g.fill();
      }
      for (const [, x, z] of live.radar) { const [px, py] = P(x / 100, z / 100); g.fillStyle = '#ff5a48'; g.beginPath(); g.arc(px, py, 3.4, 0, 6.3); g.fill(); g.strokeStyle = 'rgba(255,90,72,.5)'; g.beginPath(); g.arc(px, py, 5 + (now / 120 % 4), 0, 6.3); g.stroke(); }
      for (const s of live.strikes) { const [px, py] = P(s.x, s.z); g.strokeStyle = '#ff3b2f'; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, s.r * k, 0, 6.3); g.stroke(); }
      if (live.sim) {
        const [px, py] = P(live.sim.x, live.sim.z), yaw = controls.yaw;
        g.save(); g.translate(px, py); g.rotate(-yaw); g.fillStyle = '#ffe9a8'; g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath(); g.fill(); g.restore();
      }
      if (live.reconUntil > now) { g.strokeStyle = 'rgba(79,179,255,.6)'; g.lineWidth = 2; g.strokeRect(1, 1, size - 2, size - 2); }
    };
    timer = window.setInterval(draw, 100); draw();
    return () => clearInterval(timer);
  }, [mapId, mode]);
  return <canvas ref={ref} className="ar-minimap" style={{ width: 168, height: 168 }} aria-label="Tactical map" />;
});

function Vitals() {
  const hp = useArena(s => s.hud.hp), alive = useArena(s => s.hud.alive), emblem = useArena(s => s.me?.emblem), name = useArena(s => s.me?.name);
  const e = EMBLEM_BY_ID.get(emblem ?? 'recruit');
  return <div className="ar-vitals"><div className="ar-ident"><span style={{ color: e?.color }}>{e?.glyph}</span>{name}</div>
    <div className={`ar-health${hp < 35 ? ' low' : ''}`}><span style={{ width: `${alive ? hp : 0}%` }} /><b>{alive ? Math.ceil(hp) : 0}</b></div></div>;
}

function WeaponPanel() {
  const h = useArena(useShallow(s => ({ weapon: s.hud.weapon, mag: s.hud.mag, reserve: s.hud.reserve, magSize: s.hud.magSize, phase: s.hud.phase, slot: s.hud.slot, lethal: s.hud.lethal, tactical: s.hud.tactical })));
  const loadout = useArena(s => s.loadout);
  const w = WEAPON_BY_ID.get(h.weapon), melee = w?.fire === 'melee', low = !melee && h.mag <= Math.ceil(h.magSize * .25);
  return <div className="ar-weapon">
    <div className="ar-slots"><span className={h.slot === 0 ? 'on' : ''}>1 · {WEAPON_BY_ID.get(loadout.primary)?.name}</span><span className={h.slot === 1 ? 'on' : ''}>2 · {WEAPON_BY_ID.get(loadout.secondary)?.name}</span></div>
    <div className="ar-wname">{w?.name}<small>{w ? CATEGORIES[w.category as keyof typeof CATEGORIES] : ''}</small></div>
    {!melee ? <div className={`ar-ammo${low ? ' low' : ''}`}><b>{h.mag}</b><span>/ {h.reserve}</span></div> : <div className="ar-ammo"><b>∞</b></div>}
    <div className="ar-state">{h.phase === 'reload' ? 'RELOADING' : h.phase === 'switch' ? 'SWITCHING' : !melee && h.mag === 0 && h.reserve === 0 ? 'NO AMMO' : !melee && low ? 'RELOAD [R]' : ''}</div>
    <div className="ar-equip"><span title={EQUIPMENT_BY_ID.get(loadout.lethal)?.name}>◆ {h.lethal} <kbd>G</kbd></span><span title={EQUIPMENT_BY_ID.get(loadout.tactical)?.name}>◇ {h.tactical} <kbd>Q</kbd></span></div>
  </div>;
}

function Streaks() {
  const earned = useArena(s => s.hud.earned), pts = useArena(s => s.hud.streakPts), level = useArena(s => s.me?.level ?? 1), perks = useArena(s => s.loadout.perks);
  const icons = { recon: Radar, supply: Package, strike: Target } as const;
  return <div className="ar-streaks">{STREAKS.map((s, i) => {
    const cost = Math.max(1, s.cost - (perks.includes('hardline') ? 1 : 0)), ready = earned.includes(s.id), locked = s.unlock > level, Icon = icons[s.id as keyof typeof icons];
    return <button key={s.id} className={`ar-streak${ready ? ' ready' : ''}${locked ? ' locked' : ''}`} disabled={!ready} onClick={() => useStreak(s.id)} aria-label={`${s.name}: ${ready ? 'ready' : locked ? `unlocks at level ${s.unlock}` : `${Math.min(pts, cost)} of ${cost} points`}`}>
      <Icon size={18} /><span className="pips">{Array.from({ length: cost }, (_, k) => <i key={k} className={k < pts || ready ? 'on' : ''} />)}</span><kbd>{i + 3}</kbd>
    </button>;
  })}</div>;
}

function Banners() {
  const list = useBanners(s => s.list);
  return <div className="ar-banners">{list.slice(-3).map(b => <div key={b.id} className={`ar-banner ${b.tone}`}><strong>{b.text}</strong>{b.sub && <span>{b.sub}</span>}</div>)}</div>;
}

function MatchStatus() {
  const state = useArena(s => s.hud.matchState), match = useArena(s => s.match), timeLeft = useArena(s => s.hud.timeLeft);
  if (!match || (state !== 'waiting' && state !== 'countdown')) return null;
  const people = match.players.filter(p => !p.bot && p.connected).length, host = match.kind === 'private' && match.players[0]?.num === useArena.getState().you?.num;
  return <div className="ar-status">
    {state === 'countdown' ? <><strong>Match starts in {Math.ceil(timeLeft / 1000)}</strong><span>Warm-up · no damage yet</span></> :
      match.kind === 'private' ? <><strong>Private match · code <code>{match.code}</code></strong><span>{people} player{people === 1 ? '' : 's'} here. {host ? 'Start when everyone has joined (menu → Start match).' : 'Waiting for the host to start.'}</span></> :
        <><strong>Finding players… {people}/{match.maxPerTeam * 2}</strong><span>Warm up while the lobby fills. The match starts with at least two players.</span></>}
  </div>;
}

function Respawn() {
  const killedBy = useArena(s => s.killedBy), respawnMs = useArena(s => s.hud.respawnMs), players = useArena(s => s.match?.players), state = useArena(s => s.hud.matchState);
  if (state === 'ended') return null;
  const killer = players?.find(p => p.num === killedBy?.num);
  return <div className="ar-respawn"><Skull size={22} /><strong>{killer ? `Eliminated by ${killer.name}${killer.bot ? ' [SIM]' : ''}` : 'Eliminated'}</strong>
    {killedBy?.weapon && <span>{weaponName(killedBy.weapon)}</span>}<em>Redeploying in {Math.max(0, Math.ceil(respawnMs / 1000))}</em></div>;
}

export function Scoreboard() {
  const match = useArena(s => s.match), me = useArena(s => s.you?.num), team = useArena(s => s.you?.team ?? 0), scores = useArena(s => s.hud.scores), board = useArena(s => s.board);
  if (!match) return null;
  const rows = (t: number) => match.players.filter(p => p.team === t).sort((x, y) => (board[y.num]?.[3] ?? 0) - (board[x.num]?.[3] ?? 0));
  const dom = match.mode === 'dom';
  return <div className="ar-scoreboard" role="dialog" aria-label="Scoreboard">
    {[team, 1 - team].map(t => <section key={t} className={t === team ? 'friend' : 'enemy'}><header><b>{t === team ? 'Your team' : 'Enemy team'}</b><strong>{scores[t] ?? 0}</strong></header>
      <table><thead><tr><th>Player</th><th>Score</th><th>E</th><th>D</th><th>A</th>{dom && <th>Obj</th>}<th>Lvl</th></tr></thead><tbody>{rows(t).map(p => <tr key={p.num} className={p.num === me ? 'me' : ''}>
        <td><span style={{ color: EMBLEM_BY_ID.get(p.emblem)?.color }}>{EMBLEM_BY_ID.get(p.emblem)?.glyph}</span> {p.name}{p.bot && <em className="ar-bot">SIM</em>}{p.verified && <em className="ar-verified">✓</em>}{!p.connected && <em className="ar-away">reconnecting</em>}</td><td>{board[p.num]?.[3] ?? 0}</td><td>{board[p.num]?.[0] ?? 0}</td><td>{board[p.num]?.[1] ?? 0}</td><td>{board[p.num]?.[2] ?? 0}</td>{dom && <td>{board[p.num]?.[4] ?? 0}</td>}<td>{p.level}</td>
      </tr>)}</tbody></table></section>)}
    <p className="ar-hint">E eliminations · D deaths · A assists{dom ? ' · Obj captures and defends' : ''}</p>
  </div>;
}

function Netline() {
  const ping = useArena(s => s.hud.ping), fps = useArena(s => s.hud.fps), show = useArena(s => s.settings.showFps), status = useArena(s => s.status);
  return <div className={`ar-net${status !== 'ready' ? ' bad' : ''}`}><Wifi size={12} />{status === 'ready' ? `${ping} ms` : 'reconnecting'}{show && ` · ${fps} fps`}</div>;
}
