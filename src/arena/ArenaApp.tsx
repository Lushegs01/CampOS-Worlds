// Combat Arena, loaded only when a player opens it from the campus (its code and assets are a separate
// chunk). While it is open the campus scene stops rendering and campus controls are paused; the player
// keeps their campus connection, account and identity, and returns to the same spot.
import { Suspense, lazy, useEffect } from 'react';
import { X, Play, Settings2, Backpack, LogOut, Home, Users } from 'lucide-react';
import { stopAmbience } from '../audio/ambience';
import { useGame } from '../state';
import { useArena, emptyHud } from './store';
import { connect, disconnect, request } from './net';
import { releaseAll, controls } from './input';
import Lobby from './Lobby';
import Hud from './Hud';
import Results from './Results';
import TouchControls from './Touch';
import LoadoutEditor from './Loadout';
import './arena.css';

const Scene = lazy(() => import('./Scene'));

export default function ArenaApp() {
  const phase = useArena(s => s.phase), map = useArena(s => s.match?.map), editor = useArena(s => s.editor), menu = useArena(s => s.menu), settings = useArena(s => s.settingsOpen), status = useArena(s => s.status);
  useEffect(() => {
    useArena.getState().set({ open: true, phase: 'lobby', error: '', hud: emptyHud() });
    stopAmbience(); connect();
    return () => { disconnect(); releaseAll(); useArena.getState().set({ open: false, phase: 'lobby', menu: false, editor: false, settingsOpen: false }); };
  }, []);
  const exit = () => { document.exitPointerLock?.(); useGame.getState().set({ panel: null }); };
  return <div className="ar-root" data-phase={phase}>
    {phase === 'match' && map && <Suspense fallback={<div className="ar-loading">Loading the simulation…</div>}><Scene mapId={map} /></Suspense>}
    {phase === 'match' && <Hud />}
    {phase === 'match' && <TouchControls />}
    {phase === 'match' && !menu && !editor && !settings && <ClickToPlay />}
    {phase === 'lobby' && <Lobby />}
    {phase === 'results' && <Results onExit={exit} />}
    {phase === 'lobby' && <button className="ar-exit" onClick={exit} aria-label="Return to campus"><X size={18} /><span>Campus</span></button>}
    {menu && phase === 'match' && <PauseMenu onExit={exit} />}
    {editor && <LoadoutEditor />}
    {settings && <ArenaSettings />}
    {status === 'replaced' && <div className="ar-modal"><div className="ar-sheet small"><h2>Combat Arena is open in another window</h2><p>Only one window can play at a time.</p><button className="ar-primary" onClick={exit}>Return to campus</button></div></div>}
  </div>;
}

/** Desktop: a click captures the mouse (pointer lock) before play starts. */
function ClickToPlay() {
  const touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (touch || controls.locked || controls.gamepad) return null;
  return <LockHint />;
}
function LockHint() {
  const alive = useArena(s => s.hud.alive);
  return <div className={`ar-clickhint${alive ? '' : ' dim'}`}>Click to play · Esc for the menu</div>;
}

function PauseMenu({ onExit }: { onExit: () => void }) {
  const match = useArena(s => s.match), you = useArena(s => s.you);
  const host = match?.kind === 'private' && match.players[0]?.num === you?.num && match.state === 'waiting';
  const close = () => { useArena.getState().set({ menu: false }); const c = document.querySelector<HTMLCanvasElement>('.ar-canvas canvas'); if (c && !matchMedia('(pointer: coarse)').matches) void c.requestPointerLock?.(); };
  const leave = async () => { await request({ t: 'leave' }); useArena.getState().set({ phase: 'lobby', menu: false, match: null, result: null }); };
  return <div className="ar-modal" role="dialog" aria-modal="true" aria-labelledby="ar-menu-title"><div className="ar-sheet small ar-menu">
    <h2 id="ar-menu-title">Paused<small>The match keeps running while you are in this menu.</small></h2>
    <button className="ar-primary" onClick={close}><Play size={16} />Resume</button>
    {host && <button className="ar-secondary" onClick={async () => { const r = await request({ t: 'private', action: 'start' }); if (r.ok) close(); else alert(String(r.reason)); }}><Users size={16} />Start match</button>}
    <button className="ar-secondary" onClick={() => useArena.getState().set({ editor: true })}><Backpack size={16} />Loadouts</button>
    <button className="ar-secondary" onClick={() => useArena.getState().set({ settingsOpen: true })}><Settings2 size={16} />Settings</button>
    <button className="ar-secondary" onClick={leave}><LogOut size={16} />Leave match</button>
    <button className="ar-secondary" onClick={onExit}><Home size={16} />Return to campus</button>
  </div></div>;
}

function ArenaSettings() {
  const s = useArena(x => x.settings), set = useArena(x => x.setSettings), volume = useGame(g => g.volume);
  const slider = (label: string, key: 'mouse' | 'ads' | 'touch' | 'pad' | 'fov', min: number, max: number, stepv: number, fmt = (v: number) => v.toFixed(2)) =>
    <label className="ar-setting"><span>{label}<b>{fmt(s[key])}</b></span><input type="range" min={min} max={max} step={stepv} value={s[key]} onChange={e => set({ [key]: Number(e.target.value) })} /></label>;
  return <div className="ar-modal" role="dialog" aria-modal="true" aria-labelledby="ar-settings-title"><div className="ar-sheet ar-settings">
    <header><h2 id="ar-settings-title">Arena settings</h2><button className="ar-icon" aria-label="Close" onClick={() => useArena.getState().set({ settingsOpen: false })}><X size={18} /></button></header>
    <fieldset><legend>Graphics</legend><div className="ar-chips">{(['low', 'medium', 'high'] as const).map(q => <button key={q} className={s.quality === q ? 'on' : ''} aria-pressed={s.quality === q} onClick={() => set({ quality: q })}>{q[0].toUpperCase() + q.slice(1)}</button>)}</div>
      <p className="ar-fine">Low suits most phones (no shadows, simple materials, fewer effects); High adds real-time shadows and full resolution. Chosen automatically on first visit.</p>
      {slider('Field of view', 'fov', 60, 100, 1, v => `${v}°`)}
      <label className="ar-setting check"><span>Show frame rate</span><input type="checkbox" checked={s.showFps} onChange={e => set({ showFps: e.target.checked })} /></label></fieldset>
    <fieldset><legend>Controls</legend>
      {slider('Mouse sensitivity', 'mouse', .2, 3, .05)}{slider('Aiming sensitivity (multiplier)', 'ads', .3, 1.5, .05)}
      {slider('Touch sensitivity', 'touch', .3, 3, .05)}{slider('Gamepad sensitivity', 'pad', .3, 3, .05)}
      <label className="ar-setting check"><span>Invert vertical look</span><input type="checkbox" checked={s.invertY} onChange={e => set({ invertY: e.target.checked })} /></label>
      <label className="ar-setting check"><span>Touch: push the stick to the top to sprint</span><input type="checkbox" checked={s.autoSprint} onChange={e => set({ autoSprint: e.target.checked })} /></label></fieldset>
    <fieldset><legend>Sound</legend>
      <label className="ar-setting"><span>Volume<b>{Math.round(volume * 100)}%</b></span><input type="range" min={0} max={1} step={.05} value={volume} onChange={e => useGame.getState().set({ volume: Number(e.target.value) })} /></label>
      <button className="ar-secondary" onClick={() => useGame.getState().set({ volume: volume ? 0 : .7 })}>{volume ? 'Mute' : 'Unmute'}</button></fieldset>
  </div></div>;
}
