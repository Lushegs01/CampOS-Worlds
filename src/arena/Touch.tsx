// Combat Arena touch controls, placed by the player's HUD layout (src/arena/hudLayout.ts). A movement stick
// (floating: it appears where the thumb lands on its side of the screen; or fixed where the layout puts it;
// push to the top edge to sprint), drag anywhere else to aim, and thumb-sized buttons. The fire button also
// aims while held, as in most mobile shooters. Page scrolling, zooming and pull-to-refresh are blocked
// while playing. Multitouch: every control tracks its own pointer.
import { useEffect, useRef, useState } from 'react';
import { B, weaponOf } from '../../shared/arena/sim.mjs';
import { HUD_ELEMENT_BY_ID, drawnScale } from '../../shared/arena/hud.mjs';
import { useArena } from './store';
import { controls, press, hold, look, aimScale } from './input';
import { live, toggleAutoFire } from './net';
import { useActiveLayout, useHudProfile, type Layout } from './hudLayout';
import { Slot, useViewport, layoutVars, TOUCH_ICONS, TOUCH_LABELS, MenuButtonsView } from './hudViews';

export default function TouchControls() {
  const profile = useHudProfile(), layout = useActiveLayout(), view = useViewport();
  const phase = useArena(s => s.phase), alive = useArena(s => s.hud.alive), ads = useArena(s => s.hud.ads > .5);
  const autoFire = useArena(s => s.settings.autoFire), allowed = useArena(s => s.match?.autoFire !== false);
  const [crouched, setCrouched] = useState(false), [sprinting, setSprinting] = useState(false);
  const enabled = profile !== 'desktop';
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
    controls.touchCrouch = !controls.touchCrouch; setCrouched(controls.touchCrouch);
  };
  const toggleSprint = () => { controls.touchSprintLock = !controls.touchSprintLock; setSprinting(controls.touchSprintLock); };
  const p = { layout, view };
  const btn = (id: string, onDown: () => void, active = false, disabled = false) => <Slot key={id} id={id} {...p} interactive>
    <Btn cls={id} label={TOUCH_LABELS[id]} active={active} disabled={disabled} onDown={onDown}>{TOUCH_ICONS[id]}</Btn>
  </Slot>;
  return <div className="ar-touch" style={layoutVars(layout)} onContextMenu={e => e.preventDefault()}>
    <LookPad />
    <Stick layout={layout} view={view} />
    <Slot id="fire" {...p} interactive><FireButton /></Slot>
    {btn('ads', () => { controls.touchAds = !controls.touchAds; }, ads)}
    {btn('jump', () => press(B.JUMP))}
    {btn('crouch', toggleCrouch, crouched)}
    {btn('sprint', toggleSprint, sprinting)}
    {btn('reload', () => press(B.RELOAD))}
    {btn('swap', () => press(B.SWAP))}
    {btn('melee', () => press(B.MELEE))}
    {btn('lethal', () => press(B.LETHAL))}
    {btn('tactical', () => press(B.TACTICAL))}
    {btn('autofire', toggleAutoFire, autoFire && allowed, !allowed)}
    <Slot id="menu" {...p} interactive><MenuButtonsView onScoreboard={open => useArena.getState().set({ scoreboard: open })} onMenu={() => useArena.getState().set({ menu: true })} /></Slot>
    {!alive && <div className="ar-tdead" />}
  </div>;
}

function Btn({ cls, label, children, onDown, active = false, disabled = false }: { cls: string; label: string; children: React.ReactNode; onDown: () => void; active?: boolean; disabled?: boolean }) {
  return <button className={`ar-tbtn ${cls}${active ? ' on' : ''}`} aria-label={label} aria-pressed={active} disabled={disabled}
    onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onDown(); }}>{children}</button>;
}

/** Fire: hold to shoot; dragging from the button also aims. */
function FireButton() {
  const last = useRef<{ id: number; x: number; y: number } | null>(null);
  const up = () => { last.current = null; hold(B.FIRE, false); };
  return <button className="ar-tbtn fire" aria-label="Fire"
    onPointerDown={e => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); last.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; hold(B.FIRE, true); }}
    onPointerMove={e => { const l = last.current; if (!l || l.id !== e.pointerId) return; drag(e.clientX - l.x, e.clientY - l.y); l.x = e.clientX; l.y = e.clientY; }}
    onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>{TOUCH_ICONS.fire}</button>;
}
function drag(dx: number, dy: number) {
  const s = useArena.getState().settings, ads = live.sim?.ads ?? 0, zoom = live.sim ? weaponOf(live.sim).zoom ?? 1.35 : 1;
  const k = .0052 * s.touch * aimScale(ads, zoom);
  look(dx * k, dy * k * .85 * (s.invertY ? -1 : 1));
}

/**
 * Movement: the stick rests where the layout puts it. Floating (default): a touch anywhere on that side of
 * the screen below the top quarter starts the stick under the thumb. Fixed: only touches on the stick move it.
 */
function Stick({ layout, view }: { layout: Layout; view: { w: number; h: number } }) {
  const base = useRef<HTMLDivElement>(null!), knob = useRef<HTMLDivElement>(null!), origin = useRef<{ id: number; x: number; y: number } | null>(null), zone = useRef<HTMLDivElement>(null!);
  const fixed = useArena(s => s.settings.fixedStick), e = layout.elements.stick, def = HUD_ELEMENT_BY_ID.get('stick')!;
  if (!e) return null;
  const k = drawnScale(def, e, view.w, view.h), R = 56 * k;
  const end = () => { origin.current = null; controls.touchMx = controls.touchMz = 0; controls.touchSprint = false; controls.touchSprintLock = false; base.current?.classList.remove('on', 'sprint'); if (knob.current) knob.current.style.transform = ''; if (base.current) { base.current.style.left = ''; base.current.style.top = ''; } };
  const left = e.x < .5;
  return <>
    {!fixed && <div ref={zone} className={`ar-stickzone ${left ? 'left' : 'right'}`}
      onPointerDown={ev => { if (origin.current) return; (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); begin(ev.pointerId, ev.clientX, ev.clientY, true); }}
      onPointerMove={ev => move(ev.pointerId, ev.clientX, ev.clientY)} onPointerUp={end} onPointerCancel={end} />}
    <Slot id="stick" layout={layout} view={view} interactive>
      <div ref={base} className="ar-stick"
        onPointerDown={ev => { ev.stopPropagation(); if (origin.current) return; (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); begin(ev.pointerId, ev.clientX, ev.clientY, false); }}
        onPointerMove={ev => move(ev.pointerId, ev.clientX, ev.clientY)} onPointerUp={end} onPointerCancel={end}><div ref={knob} className="ar-knob" /></div>
    </Slot>
  </>;
  function begin(id: number, x: number, y: number, floating: boolean) {
    const r = base.current.getBoundingClientRect();
    // Fixed (or a touch on the stick itself): the stick's own centre; floating: under the thumb.
    const cx = floating ? x : r.left + r.width / 2, cy = floating ? y : r.top + r.height / 2;
    origin.current = { id, x: cx, y: cy };
    if (floating) { const sx = r.left + r.width / 2, sy = r.top + r.height / 2; base.current.style.left = `${(cx - sx) / k}px`; base.current.style.top = `${(cy - sy) / k}px`; }
    base.current.classList.add('on'); move(id, x, y);
  }
  function move(id: number, x: number, y: number) {
    const o = origin.current; if (!o || o.id !== id) return;
    let dx = x - o.x, dy = y - o.y; const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.current.style.transform = `translate(${dx / k}px, ${dy / k}px)`;
    controls.touchMx = dx / R; controls.touchMz = -dy / R;
    // Push to the top edge to sprint (when enabled in settings).
    controls.touchSprint = useArena.getState().settings.autoSprint && -dy / R > .92 && Math.abs(dx) < R * .4 && l >= R * .98;
    base.current.classList.toggle('sprint', controls.touchSprint || controls.touchSprintLock);
  }
}

/** Aim: drag anywhere that is not a control. */
function LookPad() {
  const last = useRef<Map<number, { x: number; y: number }>>(new Map());
  return <div className="ar-lookzone"
    onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); last.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
    onPointerMove={e => { const l = last.current.get(e.pointerId); if (!l) return; drag(e.clientX - l.x, e.clientY - l.y); l.x = e.clientX; l.y = e.clientY; }}
    onPointerUp={e => last.current.delete(e.pointerId)} onPointerCancel={e => last.current.delete(e.pointerId)} />;
}
