// Combat Arena, loaded only when a player opens it from the campus (its code and assets are a separate
// chunk). While it is open the campus scene stops rendering and campus controls are paused; the player
// keeps their campus connection, account and identity, and returns to the same spot.
import { Suspense, lazy, useEffect, useState } from 'react';
import { X, Play, Settings2, Backpack, LogOut, Home, Users, LayoutDashboard, Crosshair, Zap } from 'lucide-react';
import { stopAmbience } from '../audio/ambience';
import { closeSocial } from '../social/store';
import { useCommunity } from '../community/store';
import { useGame } from '../state';
import { useArena, emptyHud } from './store';
import { connect, disconnect, request } from './net';
import { releaseAll, controls } from './input';
import Lobby from './Lobby';
import Hud from './Hud';
import Results from './Results';
import TouchControls from './Touch';
import LoadoutEditor from './Loadout';
import { toggleAutoFire } from './net';
import { recommendQuality } from './device';
import './arena.css';

const Scene = lazy(() => import('./Scene'));
// Opened rarely: their code downloads only when first opened.
const HudEditor = lazy(() => import('./HudEditor'));
const Armory = lazy(() => import('./Armory'));

export default function ArenaApp() {
  const phase = useArena(s => s.phase), map = useArena(s => s.match?.map), editor = useArena(s => s.editor), menu = useArena(s => s.menu), settings = useArena(s => s.settingsOpen), status = useArena(s => s.status);
  const hudEditor = useArena(s => s.hudEditor), armory = useArena(s => s.armory);
  useEffect(() => {
    useArena.getState().set({ open: true, phase: 'lobby', error: '', hud: emptyHud() });
    stopAmbience(); closeSocial(); useCommunity.getState().toggle(false); connect();
    // Escape closes the arena's own sheets (and opens the pause menu while playing without pointer lock).
    const esc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const a = useArena.getState();
      if (a.hudEditor) return; // the studio asks about unsaved changes itself
      if (a.armory !== null) a.set({ armory: null }); else if (a.settingsOpen) a.set({ settingsOpen: false }); else if (a.editor) a.set({ editor: false });
      else if (a.phase === 'match' && !controls.locked) a.set({ menu: !a.menu });
    };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); disconnect(); releaseAll(); useArena.getState().set({ open: false, phase: 'lobby', menu: false, editor: false, settingsOpen: false, hudEditor: false, armory: null }); };
  }, []);
  const exit = () => { document.exitPointerLock?.(); useGame.getState().set({ panel: null }); };
  return <div className="ar-root" data-phase={phase}>
    {phase === 'match' && map && <Suspense fallback={<div className="ar-loading">Loading the simulation…</div>}><Scene mapId={map} /></Suspense>}
    {phase === 'match' && <SceneLoading />}
    {phase === 'match' && <Hud />}
    {phase === 'match' && <TouchControls />}
    {phase === 'match' && !menu && !editor && !settings && !hudEditor && armory === null && <ClickToPlay />}
    {phase === 'lobby' && <Lobby />}
    {phase === 'results' && <Results onExit={exit} />}
    {phase === 'lobby' && <button className="ar-exit" onClick={exit} aria-label="Return to campus"><X size={18} /><span>Campus</span></button>}
    {menu && phase === 'match' && <PauseMenu onExit={exit} />}
    {editor && <LoadoutEditor />}
    {settings && <ArenaSettings />}
    {armory !== null && <Suspense fallback={<div className="ar-loading">Opening the Armory…</div>}><Armory /></Suspense>}
    {hudEditor && <Suspense fallback={<div className="ar-loading">Opening HUD customization…</div>}><HudEditor /></Suspense>}
    {status === 'replaced' && <div className="ar-modal"><div className="ar-sheet small"><h2>Combat Arena is open in another window</h2><p>Only one window can play at a time.</p><button className="ar-primary" onClick={exit}>Return to campus</button></div></div>}
  </div>;
}

/** Shown over the match until the arena's models and textures have arrived. */
function SceneLoading() {
  const ready = useArena(s => s.sceneReady);
  return ready ? null : <div className="ar-loading ar-scene-loading"><span className="ar-eyebrow">COMBAT ARENA</span><strong>Deploying…</strong><i /><small>Loading the training ground</small></div>;
}
/** Desktop: a click captures the mouse (pointer lock) before play starts; the hint hides once it has. */
function ClickToPlay() {
  const touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const [locked, setLocked] = useState(() => !!document.pointerLockElement);
  useEffect(() => { const on = () => setLocked(!!document.pointerLockElement); document.addEventListener('pointerlockchange', on); return () => document.removeEventListener('pointerlockchange', on); }, []);
  if (touch || locked || controls.gamepad) return null;
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
    <button className="ar-secondary" onClick={() => useArena.getState().set({ armory: '' })}><Crosshair size={16} />Armory</button>
    <button className="ar-secondary" onClick={() => useArena.getState().set({ hudEditor: true })}><LayoutDashboard size={16} />HUD customization</button>
    <button className="ar-secondary" onClick={toggleAutoFire}><Zap size={16} />Auto-fire: {useArena.getState().settings.autoFire ? 'ON' : 'OFF'}</button>
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
    <header><h2 id="ar-settings-title">Arena settings</h2><button className="ar-icon" aria-label="Close settings" onClick={() => useArena.getState().set({ settingsOpen: false })}><X size={18} /></button></header>
    <fieldset className="ar-autofire"><legend>Auto-fire</legend>
      <div className="ar-chips" role="radiogroup" aria-label="Auto-fire">{([[false, 'OFF'], [true, 'ON']] as const).map(([v, label]) => <button key={label} role="radio" aria-checked={s.autoFire === v} className={s.autoFire === v ? 'on' : ''} onClick={() => set({ autoFire: v })}>{label}</button>)}</div>
      <p className="ar-fine">When enabled, your weapon automatically fires when your manually controlled aim is over a visible enemy. It never aims for you, never fires through cover or at teammates, and the server checks every shot exactly like a manual one. Switch it quickly with <kbd>F</kbd>, the AUTO touch button, or the pause menu.</p>
    </fieldset>
    <fieldset><legend>HUD</legend>
      <button className="ar-secondary" onClick={() => useArena.getState().set({ hudEditor: true, settingsOpen: false })}><LayoutDashboard size={16} />HUD customization</button>
      <p className="ar-fine">Move, resize, hide and restyle every part of the HUD and the touch controls, with separate layouts for desktop, phone landscape and phone portrait.</p>
      <label className="ar-setting check"><span>Touch: fixed movement stick (instead of following your thumb)</span><input type="checkbox" checked={s.fixedStick} onChange={e => set({ fixedStick: e.target.checked })} /></label>
    </fieldset>
    <fieldset><legend>Graphics</legend><div className="ar-chips">{(['low', 'medium', 'high'] as const).map(q => <button key={q} className={s.quality === q ? 'on' : ''} aria-pressed={s.quality === q} onClick={() => set({ quality: q })}>{q[0].toUpperCase() + q.slice(1)}{recommendQuality().quality === q ? ' · recommended' : ''}</button>)}</div>
      <p className="ar-fine">Every profile uses the same models and materials. Low (phones) keeps a static sun shadow and no post-processing; Medium adds bloom, grading and sharper shadows; High adds ambient occlusion, full-rate 4K shadows and full resolution. Recommended for this device from its GPU, memory and screen{recommendQuality().gpu ? ` (${recommendQuality().gpu.slice(0, 60)})` : ''}.</p>
      <label className="ar-setting check"><span>Adaptive performance: lower the resolution, then the profile, if the frame rate drops</span><input type="checkbox" checked={s.adaptive} onChange={e => set({ adaptive: e.target.checked })} /></label>
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
