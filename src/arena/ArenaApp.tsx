// Combat Arena, loaded only when a player opens it from the campus (its code and assets are a separate
// chunk). While it is open the campus scene stops rendering and campus controls are paused; the player
// keeps their campus connection, account and identity, and returns to the same spot.
import { Component, Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { X, Play, Settings2, Backpack, LogOut, Home, Users, LayoutDashboard, Crosshair, Zap } from 'lucide-react';
import { stopAmbience } from '../audio/ambience';
import { closeSocial } from '../social/store';
import { useCommunity } from '../community/store';
import { useGame } from '../state';
import { useArena, emptyHud } from './store';
import { connect, disconnect, request, leaveMatch, onRetryAssets } from './net';
import DeployScreen from './Deploy';
import * as deploy from './deploy';
import { recentDeployments } from './deploy';
import { endSession } from '../world/fetcher';
import { releaseAll, controls } from './input';
import Lobby from './Lobby';
import Hud from './Hud';
import Results from './Results';
import TouchControls from './Touch';
import LoadoutEditor from './Loadout';
import { toggleAutoFire } from './net';
import { recommendQuality } from './device';
import { sfx, prepareInterface } from './audio';
import './arena.css';

// Interface sounds for the arena's menus (never the in-match touch controls or the HUD): a click on buttons, a
// selection sound on tabs and choices, a toggle on switches; a soft tick while dragging a slider (throttled).
let tickAt = 0;
const uiTick = () => { const t = performance.now(); if (t - tickAt > 80) { tickAt = t; sfx.ui('tick'); } };
function uiPress(e: PointerEvent) {
  const t = e.target as Element | null, el = t?.closest?.('button, [role=tab], [role=radio], input[type=checkbox], select, a[href]');
  if (!el || !el.closest('.ar-root') || el.closest('.ar-touch, .ar-hud, .ar-editor-canvas') || (el as HTMLButtonElement).disabled) return;
  const role = el.getAttribute('role');
  sfx.ui(role === 'tab' || role === 'radio' || el.getAttribute('aria-pressed') != null ? 'select' : (el as HTMLInputElement).type === 'checkbox' ? 'toggle' : /close|back|cancel/i.test(el.getAttribute('aria-label') ?? el.textContent ?? '') ? 'back' : 'click');
}
let hoverAt = 0;
function uiHover(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return;
  const el = (e.target as Element | null)?.closest?.('.ar-root .ar-primary, .ar-root .ar-secondary, .ar-root [role=tab]');
  const t = performance.now(); if (el && t - hoverAt > 120) { hoverAt = t; sfx.ui('hover'); }
}

// The 3D scene's code: a failed download is reported to the deployment (with Retry) instead of closing the arena,
// and a retry makes a fresh lazy component (React keeps a failed one failed).
let sceneCode: Promise<{ default: ComponentType<{ mapId: string }>; releaseArena: () => void }> | null = null;
const sceneModule = () => (sceneCode ??= import('./Scene').catch(e => { sceneCode = null; throw e; }));
class SceneBoundary extends Component<{ children: (Scene: ComponentType<{ mapId: string }>) => ReactNode }, { error: boolean; Scene: ComponentType<{ mapId: string }> }> {
  state = { error: false, Scene: lazy(sceneModule) };
  private off: (() => void) | null = null;
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(e: Error) { console.error('Arena scene could not load.', e); deploy.fail('The arena’s 3D code could not be downloaded.', 'assets', String(e?.message ?? e).slice(0, 160)); }
  componentDidMount() { this.off = onRetryAssets(() => { if (this.state.error) this.setState({ error: false, Scene: lazy(sceneModule) }); }); }
  componentWillUnmount() { this.off?.(); }
  render() { return this.state.error ? null : this.props.children(this.state.Scene); }
}
// Opened rarely: their code downloads only when first opened.
const HudEditor = lazy(() => import('./HudEditor'));
const Armory = lazy(() => import('./Armory'));

export default function ArenaApp() {
  const phase = useArena(s => s.phase), map = useArena(s => s.match?.map), editor = useArena(s => s.editor), menu = useArena(s => s.menu), settings = useArena(s => s.settingsOpen), status = useArena(s => s.status);
  const hudEditor = useArena(s => s.hudEditor), armory = useArena(s => s.armory);
  useEffect(() => {
    useArena.getState().set({ open: true, phase: 'lobby', error: '', hud: emptyHud() });
    stopAmbience(); closeSocial(); useCommunity.getState().toggle(false); connect(); prepareInterface();
    document.addEventListener('pointerdown', uiPress, true); document.addEventListener('pointerover', uiHover, true);
    // Escape closes the arena's own sheets (and opens the pause menu while playing without pointer lock).
    const esc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const a = useArena.getState();
      if (a.hudEditor) return; // the studio asks about unsaved changes itself
      if (a.armory !== null) a.set({ armory: null }); else if (a.settingsOpen) a.set({ settingsOpen: false }); else if (a.editor) a.set({ editor: false });
      else if (a.phase === 'match' && !controls.locked) a.set({ menu: !a.menu });
    };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('keydown', esc); disconnect(); releaseAll();
      document.removeEventListener('pointerdown', uiPress, true); document.removeEventListener('pointerover', uiHover, true);
      // Leaving the arena: cancel its downloads and let go of its models and textures (the HTTP cache keeps the files).
      endSession(); void sceneCode?.then(m => m.releaseArena(), () => null);
      useArena.getState().set({ open: false, phase: 'lobby', menu: false, editor: false, settingsOpen: false, hudEditor: false, armory: null, sceneReady: false });
    };
  }, []);
  const exit = () => { document.exitPointerLock?.(); useGame.getState().set({ panel: null }); };
  return <div className="ar-root" data-phase={phase}>
    {phase === 'match' && map && <SceneBoundary>{Scene => <Suspense fallback={null}><Scene mapId={map} /></Suspense>}</SceneBoundary>}
    {phase === 'match' && <DeployScreen />}
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

/** Desktop: a click captures the mouse (pointer lock) before play starts; the hint hides once it has. */
function ClickToPlay() {
  const touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const [locked, setLocked] = useState(() => !!document.pointerLockElement);
  const deployed = deploy.useDeploy(d => d.stage === 'deployed' || d.stage === 'idle');
  useEffect(() => { const on = () => setLocked(!!document.pointerLockElement); document.addEventListener('pointerlockchange', on); return () => document.removeEventListener('pointerlockchange', on); }, []);
  if (touch || locked || controls.gamepad || !deployed) return null;
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
  const leave = () => leaveMatch();
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
  const slider = (label: string, key: 'mouse' | 'ads' | 'touch' | 'pad' | 'fov' | 'renderScale', min: number, max: number, stepv: number, fmt = (v: number) => v.toFixed(2)) =>
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
    <fieldset><legend>Graphics</legend><div className="ar-chips">{(['low', 'medium', 'high', 'ultra'] as const).map(q => <button key={q} className={s.quality === q ? 'on' : ''} aria-pressed={s.quality === q} onClick={() => set({ quality: q })}>{q[0].toUpperCase() + q.slice(1)}{recommendQuality().quality === q ? ' · recommended' : ''}</button>)}</div>
      <p className="ar-fine">Every profile uses the same models and materials. Low (phones) keeps a static sun shadow and no post-processing; Medium adds bloom, grading and sharper shadows; High adds ambient occlusion, full-rate 4K shadows and full resolution; Ultra adds full-resolution ambient occlusion, 16× texture filtering, more real light fittings and a longer view. Recommended for this device from its GPU, memory and screen{recommendQuality().gpu ? ` (${recommendQuality().gpu.slice(0, 60)})` : ''}.</p>
      <label className="ar-setting check"><span>Adaptive performance: lower the resolution, then the profile, if the frame rate drops</span><input type="checkbox" checked={s.adaptive} onChange={e => set({ adaptive: e.target.checked })} /></label>
      {slider('Resolution scale', 'renderScale', .5, 1, .05, v => `${Math.round(v * 100)}%`)}
      {slider('Field of view', 'fov', 60, 100, 1, v => `${v}°`)}
      <label className="ar-setting check"><span>Show frame rate</span><input type="checkbox" checked={s.showFps} onChange={e => set({ showFps: e.target.checked })} /></label></fieldset>
    <fieldset><legend>Controls</legend>
      {slider('Mouse sensitivity', 'mouse', .2, 3, .05)}{slider('Aiming sensitivity (multiplier)', 'ads', .3, 1.5, .05)}
      {slider('Touch sensitivity', 'touch', .3, 3, .05)}{slider('Gamepad sensitivity', 'pad', .3, 3, .05)}
      <label className="ar-setting check"><span>Invert vertical look</span><input type="checkbox" checked={s.invertY} onChange={e => set({ invertY: e.target.checked })} /></label>
      <label className="ar-setting check"><span>Touch: push the stick to the top to sprint</span><input type="checkbox" checked={s.autoSprint} onChange={e => set({ autoSprint: e.target.checked })} /></label></fieldset>
    <fieldset><legend>Sound</legend>
      <div className="ar-mix">
        <label className="ar-setting"><span>Master volume<b>{Math.round(volume * 100)}%</b></span><input type="range" min={0} max={1} step={.05} value={volume} onChange={e => useGame.getState().set({ volume: Number(e.target.value) })} /></label>
        {([['volWeapons', 'Weapons and reloads'], ['volExplosions', 'Explosions and bullet impacts'], ['volFootsteps', 'Movement and footsteps'], ['volCharacter', 'Character reactions and breathing'], ['volEnvironment', 'Environment'], ['volUi', 'Interface'], ['volVoice', 'Announcer and radio']] as const).map(([key, label]) =>
          <label key={key} className="ar-setting"><span>{label}<b>{Math.round(s[key] * 100)}%</b></span><input type="range" min={0} max={1} step={.05} value={s[key]} onChange={e => { set({ [key]: Number(e.target.value) }); uiTick(); }} /></label>)}
        <label className="ar-setting"><span>Voice chat<b>—</b></span><input type="range" disabled min={0} max={1} value={0} aria-describedby="ar-voice-note" /><small id="ar-voice-note" className="ar-fine">Combat Arena has no voice chat yet.</small></label>
      </div>
      <button className="ar-secondary" onClick={() => useGame.getState().set({ volume: volume ? 0 : .7 })}>{volume ? 'Mute' : 'Unmute'}</button>
      <p className="ar-fine">Footsteps of other players carry gameplay information: lowering them makes enemies harder to hear. The mix is limited, so loud firefights never distort.</p></fieldset>
    <fieldset><legend>Diagnostics</legend>
      <p className="ar-fine">Your last deployments on this device (stage timings in milliseconds). Nothing personal is included; you can share it if support asks.</p>
      <pre className="ar-diag">{recentDeployments().slice(-3).map(d => `${d.ok ? 'OK ' : 'FAIL'} ${d.kind ?? ''} ${(d.total / 1000).toFixed(1)} s · ${(d.bytes / 1e6).toFixed(1)} MB · ${d.files} files${d.retries ? ` · ${d.retries} retries` : ''}${d.failure ? ` · ${d.failure}` : ''}\n  ${Object.entries(d.stages).map(([k, v]) => `${k} ${v}`).join(' · ')}`).join('\n') || 'No deployments yet.'}</pre>
    </fieldset>
  </div></div>;
}
