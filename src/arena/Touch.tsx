// Combat Arena touch controls: a floating movement stick on the left half (push to the top edge to
// sprint), drag anywhere on the right half to aim, and thumb-sized buttons. The fire button also aims
// while held, as in most mobile shooters. Page scrolling, zooming and pull-to-refresh are blocked
// while playing.
import { useEffect, useRef, useState } from 'react';
import { Crosshair, RotateCw, ArrowUp, ChevronsDown, Repeat, Bomb, Sparkles, Radar, Package, Target, Swords, Menu, ListOrdered } from 'lucide-react';
import { B, weaponOf } from '../../shared/arena/sim.mjs';
import { STREAKS } from '../../shared/arena/weapons.mjs';
import { useArena } from './store';
import { controls, press, hold, look, aimScale } from './input';
import { live, useStreak } from './net';

const coarse = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function TouchControls() {
  const [enabled, setEnabled] = useState(coarse);
  const phase = useArena(s => s.phase), alive = useArena(s => s.hud.alive), earned = useArena(s => s.hud.earned), ads = useArena(s => s.hud.ads > .5), crouch = useRef(false);
  const [crouched, setCrouched] = useState(false);
  useEffect(() => { const t = () => setEnabled(true); window.addEventListener('touchstart', t, { once: true, passive: true }); return () => window.removeEventListener('touchstart', t); }, []);
  // Block browser gestures (scroll, pinch, pull-to-refresh, long-press menus) while the controls are up.
  useEffect(() => {
    if (!enabled || phase !== 'match') return;
    const stop = (e: TouchEvent) => { if (e.touches.length > 1 || (e.target as HTMLElement)?.closest?.('.ar-touch')) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    document.documentElement.classList.add('ar-locked');
    return () => { document.removeEventListener('touchmove', stop); document.documentElement.classList.remove('ar-locked'); };
  }, [enabled, phase]);
  if (!enabled || phase !== 'match') return null;
  const toggleCrouch = () => {
    const s = live.sim;
    if (s?.sprint) { press(B.CROUCH); return; } // a tap while sprinting slides
    crouch.current = !crouch.current; controls.touchCrouch = crouch.current; setCrouched(crouch.current);
  };
  return <div className="ar-touch" onContextMenu={e => e.preventDefault()}>
    <Stick />
    <LookPad />
    <div className="ar-tbtns">
      <FireButton />
      <Btn cls="ads" label="Aim down sights" active={ads} onDown={() => { controls.touchAds = !controls.touchAds; }}><Crosshair size={22} /></Btn>
      <Btn cls="jump" label="Jump" onDown={() => press(B.JUMP)}><ArrowUp size={22} /></Btn>
      <Btn cls="crouch" label="Crouch, or slide while sprinting" active={crouched} onDown={toggleCrouch}><ChevronsDown size={22} /></Btn>
      <Btn cls="reload" label="Reload" onDown={() => press(B.RELOAD)}><RotateCw size={20} /></Btn>
      <Btn cls="swap" label="Switch weapon" onDown={() => press(B.SWAP)}><Repeat size={20} /></Btn>
      <Btn cls="melee" label="Melee" onDown={() => press(B.MELEE)}><Swords size={18} /></Btn>
      <Btn cls="lethal" label="Throw lethal" onDown={() => press(B.LETHAL)}><Bomb size={18} /></Btn>
      <Btn cls="tactical" label="Throw tactical" onDown={() => press(B.TACTICAL)}><Sparkles size={18} /></Btn>
    </div>
    <div className="ar-tstreaks">{STREAKS.filter(s => earned.includes(s.id)).map(s => { const Icon = s.id === 'recon' ? Radar : s.id === 'supply' ? Package : Target; return <button key={s.id} className="ar-tbtn streak" aria-label={`Use ${s.name}`} onPointerDown={e => { e.preventDefault(); useStreak(s.id); }}><Icon size={20} /></button>; })}</div>
    <div className="ar-ttop">
      <button className="ar-tbtn small" aria-label="Scoreboard" onPointerDown={() => useArena.getState().set({ scoreboard: true })} onPointerUp={() => useArena.getState().set({ scoreboard: false })} onPointerCancel={() => useArena.getState().set({ scoreboard: false })}><ListOrdered size={18} /></button>
      <button className="ar-tbtn small" aria-label="Menu" onClick={() => useArena.getState().set({ menu: true })}><Menu size={18} /></button>
    </div>
    {!alive && <div className="ar-tdead" />}
  </div>;
}

function Btn({ cls, label, children, onDown, active = false }: { cls: string; label: string; children: React.ReactNode; onDown: () => void; active?: boolean }) {
  return <button className={`ar-tbtn ${cls}${active ? ' on' : ''}`} aria-label={label} aria-pressed={active}
    onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onDown(); }}>{children}</button>;
}

/** Fire: hold to shoot; dragging from the button also aims. */
function FireButton() {
  const last = useRef<{ id: number; x: number; y: number } | null>(null);
  return <button className="ar-tbtn fire" aria-label="Fire"
    onPointerDown={e => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); last.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; hold(B.FIRE, true); }}
    onPointerMove={e => { const l = last.current; if (!l || l.id !== e.pointerId) return; drag(e.clientX - l.x, e.clientY - l.y); l.x = e.clientX; l.y = e.clientY; }}
    onPointerUp={() => { last.current = null; hold(B.FIRE, false); }} onPointerCancel={() => { last.current = null; hold(B.FIRE, false); }}>
    <span className="ring" /><Crosshair size={30} /></button>;
}
function drag(dx: number, dy: number) {
  const s = useArena.getState().settings, ads = live.sim?.ads ?? 0, zoom = live.sim ? weaponOf(live.sim).zoom ?? 1.35 : 1;
  const k = .0052 * s.touch * aimScale(ads, zoom);
  look(dx * k, dy * k * .85 * (s.invertY ? -1 : 1));
}

/** Movement: a stick that appears where the thumb lands on the left half. */
function Stick() {
  const base = useRef<HTMLDivElement>(null!), knob = useRef<HTMLDivElement>(null!), origin = useRef<{ id: number; x: number; y: number } | null>(null);
  const R = 56;
  const end = () => { origin.current = null; controls.touchMx = controls.touchMz = 0; controls.touchSprint = false; base.current.classList.remove('on'); knob.current.style.transform = ''; };
  return <div className="ar-stickzone"
    onPointerDown={e => { if (origin.current) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); origin.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; const r = base.current.parentElement!.getBoundingClientRect(); base.current.style.left = `${e.clientX - r.left}px`; base.current.style.top = `${e.clientY - r.top}px`; base.current.classList.add('on'); }}
    onPointerMove={e => {
      const o = origin.current; if (!o || o.id !== e.pointerId) return;
      let dx = e.clientX - o.x, dy = e.clientY - o.y; const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
      controls.touchMx = dx / R; controls.touchMz = -dy / R;
      // Push to the top edge to sprint (when enabled in settings).
      controls.touchSprint = useArena.getState().settings.autoSprint && -dy / R > .92 && Math.abs(dx) < R * .4 && l >= R * .98;
      base.current.classList.toggle('sprint', controls.touchSprint);
    }}
    onPointerUp={end} onPointerCancel={end}>
    <div ref={base} className="ar-stick"><div ref={knob} className="ar-knob" /></div>
  </div>;
}

/** Aim: drag anywhere on the right half. */
function LookPad() {
  const last = useRef<Map<number, { x: number; y: number }>>(new Map());
  return <div className="ar-lookzone"
    onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); last.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
    onPointerMove={e => { const l = last.current.get(e.pointerId); if (!l) return; drag(e.clientX - l.x, e.clientY - l.y); l.x = e.clientX; l.y = e.clientY; }}
    onPointerUp={e => last.current.delete(e.pointerId)} onPointerCancel={e => last.current.delete(e.pointerId)} />;
}
