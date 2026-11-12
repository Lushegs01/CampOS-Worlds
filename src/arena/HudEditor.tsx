// HUD Customization Studio: drag, resize, hide and restyle every HUD element and touch control, for each
// profile (desktop, touch landscape, touch portrait), on a live preview drawn with the same components the
// match uses. Nothing in here can fire, aim or move: the preview's controls are inert and gameplay input is
// paused while the studio is open (inputPaused in store.ts).
//
// Changes are a draft until "Save": the draft itself is kept on this device as you work (so a closed tab or
// a crash loses nothing), "Save" applies it and stores it (on this device at once, and in the account for
// signed-in players), and the layout it replaced can be restored.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { X, Undo2, Redo2, Grid3x3, RotateCcw, Save, Eye, EyeOff, PanelRight, PanelLeft, Crosshair, Play, History, Monitor, Smartphone } from 'lucide-react';
import {
  HUD_ELEMENTS, HUD_ELEMENT_BY_ID, PRESETS, PRESET_NAMES, PROFILE_NAMES, CROSSHAIR_STYLES, CROSSHAIR_NAMES, CROSSHAIR_COLORS, elementsFor, isTouchProfile, presetLayout,
  moveElement, resizeElement, updateElement, updateGlobal, updateCrosshair, resetElement, alignGuides, touchOverlaps, minScale, createHistory, pushHistory, undo, redo, validateLayout,
} from '../../shared/arena/hud.mjs';
import { useArena } from './store';
import { request } from './net';
import { useHudLayouts, currentProfile, type Layout, type Profile } from './hudLayout';
import { drawMinimap } from './Hud';
import {
  Slot, layoutVars, CrosshairMarks, TimerView, ScoreView, HealthView, AmmoView, WeaponInfoView, WeaponSlotsView, NetView, ObjectivesView, StreaksView, KillfeedView, BannerView, CompassStatic,
  TOUCH_ICONS, MenuButtonsView, StickView,
} from './hudViews';

const REF: Record<Profile, { w: number; h: number }> = { desktop: { w: 1280, h: 720 }, touchLandscape: { w: 844, h: 390 }, touchPortrait: { w: 390, h: 844 } };
const DRAFT = 'campos-arena-hud-draft';
type Drag = { id: string; mode: 'move' | 'resize'; px: number; py: number; rect: DOMRect; safe: { x: number; y: number; w: number; h: number }; scale: number; k: number };

function readDraft(profile: Profile): Layout | null {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? 'null'); return d?.[profile] ? validateLayout(d[profile], profile).layout as Layout : null; } catch { return null; }
}
function writeDraft(profile: Profile, layout: Layout | null) {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? '{}') ?? {}; if (layout) d[profile] = layout; else delete d[profile]; localStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* storage denied */ }
}

export default function HudEditor() {
  const saved = useHudLayouts(s => s.store), notice = useHudLayouts(s => s.notice), sync = useHudLayouts(s => s.sync);
  const verified = useArena(s => !!s.me?.verified), phase = useArena(s => s.phase), status = useArena(s => s.status);
  const device = currentProfile();
  const [profile, setProfile] = useState<Profile>(device);
  const [draft, setDraft] = useState<Layout>(() => readDraft(device) ?? saved.layouts[device]);
  const [restored, setRestored] = useState(() => !!readDraft(device) && JSON.stringify(readDraft(device)) !== JSON.stringify(saved.layouts[device]));
  const [history, setHistory] = useState(createHistory());
  const [selected, setSelected] = useState<string>(isTouchProfile(device) ? 'fire' : 'crosshair');
  const [grid, setGrid] = useState(true), [guides, setGuides] = useState<{ axis: string; at: number }[]>([]);
  const [panel, setPanel] = useState<'right' | 'left' | 'hidden'>('right'), [confirmClose, setConfirmClose] = useState(false), [msg, setMsg] = useState('');
  const stage = useRef<HTMLDivElement>(null!), wrap = useRef<HTMLDivElement>(null!), drag = useRef<Drag | null>(null), before = useRef<Layout | null>(null);
  const dims = profile === device && typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : REF[profile];
  const [fit, setFit] = useState(1);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.layouts[profile]);

  // Fit the device frame into the space beside the panel.
  useEffect(() => {
    // This device's own layout with the panel hidden is shown at exactly its real size; anything else is fitted with a margin.
    const pad = profile === device ? 0 : 16;
    const measure = () => { const r = wrap.current?.getBoundingClientRect(); if (r) setFit(Math.min(1, (r.width - pad) / dims.w, (r.height - pad) / dims.h)); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(wrap.current); return () => ro.disconnect();
  }, [dims.w, dims.h, panel, profile, device]);
  // The draft is kept on this device as it changes.
  useEffect(() => { const t = setTimeout(() => writeDraft(profile, dirty ? draft : null), 300); return () => clearTimeout(t); }, [draft, profile, dirty]);

  const change = useCallback((next: Layout, record = true) => { if (record) setHistory(h => pushHistory(h, draft)); setDraft(next); setMsg(''); }, [draft]);
  const switchProfile = (p: Profile) => {
    if (dirty) writeDraft(profile, draft);
    const d = readDraft(p); setProfile(p); setDraft(d ?? saved.layouts[p]); setRestored(!!d); setHistory(createHistory());
    setSelected(isTouchProfile(p) ? 'fire' : 'crosshair');
  };
  const save = () => { useHudLayouts.getState().save({ [profile]: draft } as Partial<Record<Profile, Layout>>); writeDraft(profile, null); setRestored(false); setMsg(verified ? 'Saved. Your layout is applied and kept in your account.' : 'Saved on this device and applied. Sign in to keep it on every device.'); };
  const discard = () => { writeDraft(profile, null); setDraft(saved.layouts[profile]); setHistory(createHistory()); setRestored(false); setMsg('Changes discarded.'); };
  const close = () => { if (dirty) { setConfirmClose(true); return; } useArena.getState().set({ hudEditor: false }); };
  const finish = (how: 'save' | 'discard') => { if (how === 'save') save(); else discard(); setConfirmClose(false); useArena.getState().set({ hudEditor: false }); };

  // ---------------------------------------------------------------- dragging and resizing on the preview
  const stageXY = (cx: number, cy: number) => { const r = stage.current.getBoundingClientRect(); return { x: (cx - r.left) / fit, y: (cy - r.top) / fit }; };
  const localRect = (el: Element) => { const r = el.getBoundingClientRect(), s = stage.current.getBoundingClientRect(); return new DOMRect((r.left - s.left) / fit, (r.top - s.top) / fit, r.width / fit, r.height / fit); };
  const onDown = (e: React.PointerEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-hud]'); if (!target) { setSelected(''); return; }
    const id = target.dataset.hud!, mode = (e.target as HTMLElement).classList.contains('ar-hx-handle') ? 'resize' : 'move';
    e.preventDefault(); e.stopPropagation(); stage.current.setPointerCapture(e.pointerId);
    setSelected(id);
    const safeEl = stage.current.querySelector('.ar-hx-safe')!, safe = localRect(safeEl), p = stageXY(e.clientX, e.clientY);
    drag.current = { id, mode, px: p.x, py: p.y, rect: localRect(target), safe: { x: safe.x, y: safe.y, w: safe.width, h: safe.height }, scale: draft.elements[id]?.scale ?? 1, k: fit };
    before.current = draft;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !before.current) return;
    const p = stageXY(e.clientX, e.clientY), dx = p.x - d.px, dy = p.y - d.py;
    if (d.mode === 'resize') { setDraft(resizeElement(before.current, d.id, d.scale * (1 + (dx + dy) / Math.max(20, d.rect.width + d.rect.height)))); return; }
    if (HUD_ELEMENT_BY_ID.get(d.id)?.movable === false) return;
    let x = (d.rect.x + dx - d.safe.x) / Math.max(1, d.safe.w - d.rect.width), y = (d.rect.y + dy - d.safe.y) / Math.max(1, d.safe.h - d.rect.height);
    const g = alignGuides(before.current, d.id, x, y); x = g.x; y = g.y; setGuides(g.guides);
    setDraft(moveElement(before.current, d.id, x, y, { grid: grid && !g.guides.length ? 40 : 0 }));
  };
  const onUp = () => {
    if (drag.current && before.current && JSON.stringify(before.current) !== JSON.stringify(draft)) setHistory(h => pushHistory(h, before.current!));
    drag.current = null; before.current = null; setGuides([]);
  };
  // Keyboard: arrows nudge, + and − resize, Ctrl+Z / Ctrl+Y undo and redo, Escape closes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      const z = (e.ctrlKey || e.metaKey) && e.code === 'KeyZ', y = (e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'));
      if (y) { e.preventDefault(); const r = redo(history, draft); setHistory(r.history); setDraft(r.layout as Layout); return; }
      if (z) { e.preventDefault(); const r = undo(history, draft); setHistory(r.history); setDraft(r.layout as Layout); return; }
      if (e.code === 'Escape') { e.stopPropagation(); close(); return; }
      const el = draft.elements[selected]; if (!el) return;
      const step = e.shiftKey ? .02 : .005;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.code]) { e.preventDefault(); change(moveElement(draft, selected, el.x + moves[e.code][0], el.y + moves[e.code][1])); }
      else if (e.key === '+' || e.key === '=') change(resizeElement(draft, selected, el.scale + .05));
      else if (e.key === '-') change(resizeElement(draft, selected, el.scale - .05));
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  });

  const def = HUD_ELEMENT_BY_ID.get(selected), sel = draft.elements[selected];
  const overlaps = useMemo(() => (isTouchProfile(profile) ? touchOverlaps(draft, dims.w, dims.h) : []), [draft, profile, dims.w, dims.h]);
  const name = (id: string) => HUD_ELEMENT_BY_ID.get(id)?.name ?? id;
  const stageStyle = { width: dims.w, height: dims.h, transform: `translate(-50%, -50%) scale(${fit})`, transformOrigin: 'center' } as CSSProperties;
  const preview = { layout: draft, view: dims };
  const startRange = async () => {
    if (dirty) save();
    const r = await request({ t: 'training', mode: 'tdm', map: 'foundry', bots: 0, difficulty: 'easy' });
    if (r.ok) useArena.getState().set({ hudEditor: false, settingsOpen: false }); else setMsg(String(r.reason ?? 'The firing range could not open.'));
  };

  return <div className={`ar-hx panel-${panel}`} role="dialog" aria-modal="true" aria-label="HUD customization" onContextMenu={e => e.preventDefault()}>
    <div ref={wrap} className="ar-hx-stage-wrap">
      <div className="ar-hx-bar">
        <button onClick={() => { const r = undo(history, draft); setHistory(r.history); setDraft(r.layout as Layout); }} disabled={!history.past.length} aria-label="Undo"><Undo2 size={15} /></button>
        <button onClick={() => { const r = redo(history, draft); setHistory(r.history); setDraft(r.layout as Layout); }} disabled={!history.future.length} aria-label="Redo"><Redo2 size={15} /></button>
        <button onClick={() => setGrid(!grid)} aria-pressed={grid} title="Snap to grid"><Grid3x3 size={15} />{grid ? 'Snap on' : 'Snap off'}</button>
        <button onClick={() => setPanel(panel === 'hidden' ? 'right' : 'hidden')} aria-label={panel === 'hidden' ? 'Show panel' : 'Hide panel'}>{panel === 'hidden' ? <PanelRight size={15} /> : <Eye size={15} />}{panel === 'hidden' ? 'Panel' : 'Full view'}</button>
        <button className="primary" onClick={save} disabled={!dirty}><Save size={15} />Save</button>
        <button onClick={close}><X size={15} />{phase === 'match' ? 'Return to game' : 'Close'}</button>
      </div>
      <div ref={stage} className={`ar-hx-stage${profile === device ? '' : ' framed'}`} style={stageStyle} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {grid && <div className="ar-hx-grid" />}
        <div className="ar-hx-safe" />
        <div className={`ar-hud ar-touch ar-hx-hud${draft.global.contrast === 'high' ? ' contrast-high' : ''}`} style={layoutVars(draft)}>
          {elementsFor(profile).map(d => {
            const hidden = !draft.elements[d.id]?.visible, shown = hidden ? { ...draft, elements: { ...draft.elements, [d.id]: { ...draft.elements[d.id], visible: true } } } : draft;
            return <Slot key={d.id} id={d.id} layout={shown} view={dims} className={`${selected === d.id ? 'sel' : ''}${hidden ? ' ghost' : ''}`}>
              <PreviewContent id={d.id} layout={draft} touch={isTouchProfile(profile)} />
              {selected === d.id && <><span className="ar-hx-grip">✥</span><span className="ar-hx-handle" aria-hidden="true" /></>}
            </Slot>;
          })}
        </div>
        {guides.map((g, i) => <div key={i} className={`ar-hx-guide ${g.axis}`} style={g.axis === 'x' ? { left: `calc(10px + ${g.at} * (100% - 20px))` } : { top: `calc(8px + ${g.at} * (100% - 16px))` }} />)}
      </div>
    </div>
    <aside className="ar-hx-panel">
      <h2>HUD customization<button className="ar-icon" onClick={() => setPanel(panel === 'left' ? 'right' : 'left')} aria-label="Move panel to the other side">{panel === 'left' ? <PanelRight size={16} /> : <PanelLeft size={16} />}</button></h2>
      {notice && <p className="ar-hx-warn">{notice} <button className="ar-link" onClick={() => useHudLayouts.setState({ notice: '' })}>OK</button></p>}
      {restored && <p className="ar-hx-ok">Your unsaved changes were restored.</p>}
      <div className="ar-hx-row" role="tablist" aria-label="Layout">
        {(['desktop', 'touchLandscape', 'touchPortrait'] as Profile[]).map(p => <button key={p} role="tab" aria-selected={profile === p} className={profile === p ? 'on' : ''} onClick={() => switchProfile(p)}>
          {p === 'desktop' ? <Monitor size={14} /> : <Smartphone size={14} style={p === 'touchLandscape' ? { transform: 'rotate(90deg)' } : undefined} />}{PROFILE_NAMES[p]}{p === device ? ' ·  this device' : ''}</button>)}
      </div>
      <label className="ar-setting"><span>Preset</span>
        <select value={draft.preset} onChange={e => { const p = e.target.value; if (p !== 'custom') change(presetLayout(profile, p) as Layout); }}>
          {PRESETS.map(p => <option key={p} value={p} disabled={p === 'custom'}>{PRESET_NAMES[p as keyof typeof PRESET_NAMES]}</option>)}
        </select></label>
      <p className="ar-fine">Presets are starting points: drag anything on the preview, drag the gold handle to resize, or use the arrow keys and + / −.</p>

      {def && sel && <section>
        <h3>{def.name}</h3>
        <label className="ar-setting"><span>Size<b>{Math.round(sel.scale * 100)}%</b></span><input type="range" min={minScale(def)} max={def.max} step={.01} value={sel.scale} onChange={e => change(resizeElement(draft, selected, Number(e.target.value)), false)} onPointerDown={() => setHistory(h => pushHistory(h, draft))} /></label>
        <label className="ar-setting"><span>Opacity<b>{Math.round(sel.opacity * 100)}%</b></span><input type="range" min={.2} max={1} step={.05} value={sel.opacity} onChange={e => change(updateElement(draft, selected, { opacity: Number(e.target.value) }), false)} onPointerDown={() => setHistory(h => pushHistory(h, draft))} /></label>
        <div className="ar-hx-row">
          <button onClick={() => change(updateElement(draft, selected, { visible: !sel.visible }))} disabled={def.required && isTouchProfile(profile)}>{sel.visible ? <><EyeOff size={14} />Hide</> : <><Eye size={14} />Show</>}</button>
          <button onClick={() => change(resetElement(draft, selected) as Layout)}><RotateCcw size={14} />Reset element</button>
        </div>
        {def.required && isTouchProfile(profile) && <p className="ar-fine">Always shown: the game cannot be played or left without it.</p>}
        {def.align && <div className="ar-hx-row" aria-label="Alignment">{(['left', 'center', 'right'] as const).map(a => <button key={a} className={sel.align === a ? 'on' : ''} onClick={() => change(updateElement(draft, selected, { align: a }))}>{a[0].toUpperCase() + a.slice(1)}</button>)}</div>}
        {selected === 'crosshair' && <>
          <div className="ar-hx-row">{CROSSHAIR_STYLES.map(st => <button key={st} className={draft.crosshair.style === st ? 'on' : ''} onClick={() => change(updateCrosshair(draft, { style: st }) as Layout)}>{CROSSHAIR_NAMES[st as keyof typeof CROSSHAIR_NAMES]}</button>)}</div>
          <div className="ar-hx-row" aria-label="Colour">{CROSSHAIR_COLORS.map(c => <button key={c} className={`ar-hx-swatch${draft.crosshair.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => change(updateCrosshair(draft, { color: c }) as Layout)} />)}
            <input type="color" value={draft.crosshair.color} aria-label="Custom colour" onChange={e => change(updateCrosshair(draft, { color: e.target.value }) as Layout)} /></div>
          <label className="ar-setting"><span>Thickness<b>{draft.crosshair.thickness} px</b></span><input type="range" min={1} max={4} step={1} value={draft.crosshair.thickness} onChange={e => change(updateCrosshair(draft, { thickness: Number(e.target.value) }) as Layout)} /></label>
          <label className="ar-setting check"><span>Dark outline</span><input type="checkbox" checked={draft.crosshair.outline} onChange={e => change(updateCrosshair(draft, { outline: e.target.checked }) as Layout)} /></label>
        </>}
      </section>}

      <section>
        <h3>Whole HUD</h3>
        {([['opacity', 'HUD opacity', .3, 1], ['textScale', 'Text size', .8, 1.5], ['iconScale', 'Icon size', .7, 1.5], ...(isTouchProfile(profile) ? [['buttonOpacity', 'Button transparency', .2, 1]] : [])] as [keyof Layout['global'], string, number, number][]).map(([k, label, lo, hi]) =>
          <label key={k} className="ar-setting"><span>{label}<b>{Math.round(Number(draft.global[k]) * 100)}%</b></span><input type="range" min={lo} max={hi} step={.05} value={Number(draft.global[k])} onChange={e => change(updateGlobal(draft, { [k]: Number(e.target.value) }) as Layout, false)} onPointerDown={() => setHistory(h => pushHistory(h, draft))} /></label>)}
        <label className="ar-setting check"><span>High contrast</span><input type="checkbox" checked={draft.global.contrast === 'high'} onChange={e => change(updateGlobal(draft, { contrast: e.target.checked ? 'high' : 'standard' }) as Layout)} /></label>
      </section>

      <section>
        <h3>Elements</h3>
        <div className="ar-hx-list">{elementsFor(profile).map(d => <label key={d.id} className={selected === d.id ? 'sel' : ''} onClick={() => setSelected(d.id)}>
          <input type="checkbox" checked={draft.elements[d.id]?.visible ?? false} disabled={d.required && isTouchProfile(profile)} onChange={e => change(updateElement(draft, d.id, { visible: e.target.checked }))} aria-label={`Show ${d.name}`} />
          <span>{d.name}</span><small className="ar-fine">{d.group}</small></label>)}</div>
      </section>

      {overlaps.length > 0 && <p className="ar-hx-warn">Overlapping controls: {overlaps.map(([a, b]) => `${name(a)} and ${name(b)}`).join('; ')}. Overlapping buttons are hard to press.</p>}
      {msg && <p className="ar-hx-ok" role="status">{msg}</p>}
      <p className="ar-fine">{dirty ? 'Unsaved changes (kept on this device until you save or discard them).' : sync === 'saving' ? 'Saving to your account…' : sync === 'failed' ? 'Saved on this device; your account could not be reached. It will try again with your next change.' : verified ? 'Saved in your account.' : 'Saved on this device.'}</p>
      <div className="ar-hx-row">
        <button className="ar-primary" onClick={save} disabled={!dirty}><Save size={14} />Save and apply</button>
        <button onClick={discard} disabled={!dirty}>Discard changes</button>
        <button onClick={() => { if (useHudLayouts.getState().restorePrevious(profile)) { setDraft(useHudLayouts.getState().store.layouts[profile]); setMsg('The previous layout is back.'); } }} disabled={!saved.previous?.[profile]}><History size={14} />Restore previous</button>
        <button onClick={() => change(presetLayout(profile, isTouchProfile(profile) ? 'mobileStandard' : 'classic') as Layout)}><RotateCcw size={14} />Reset layout</button>
      </div>
      {phase !== 'match' && <button className="ar-secondary" disabled={status !== 'ready'} onClick={startRange}><Play size={14} />Try it in the firing range</button>}
      <p className="ar-fine">The firing range is a Training map with nobody shooting back: test your layout, then come back here from the menu.</p>
    </aside>
    {confirmClose && <div className="ar-modal"><div className="ar-sheet small"><h2>Save your HUD changes?</h2>
      <button className="ar-primary" onClick={() => finish('save')}>Save and apply</button>
      <button className="ar-secondary" onClick={() => finish('discard')}>Discard changes</button>
      <button className="ar-secondary" onClick={() => setConfirmClose(false)}>Keep editing</button></div></div>}
  </div>;
}

/** Sample content for one element, drawn with the match's own components. */
function PreviewContent({ id, layout, touch }: { id: string; layout: Layout; touch: boolean }) {
  const me = useArena(s => s.me), autoFire = useArena(s => s.settings.autoFire);
  switch (id) {
    case 'crosshair': return <div className="ar-hx-cross-box" style={{ width: 24, height: 24, position: 'relative', '--gap': '7px' } as CSSProperties}><div className="ar-hx-cross"><CrosshairMarks layout={{ ...layout, elements: { ...layout.elements, crosshair: { ...layout.elements.crosshair, scale: 1, opacity: 1, visible: true } } }} /></div></div>;
    case 'hitmarker': return <div style={{ width: 30, height: 30, position: 'relative' }}><div className="ar-hitmarker head" style={{ left: 15, top: 15, visibility: 'visible' }}><i /><i /><i /><i /></div></div>;
    case 'timer': return <TimerView mode="TDM" limit={40} label="7:42" />;
    case 'score': return <ScoreView ours={14} theirs={11} limit={40} />;
    case 'compass': return <CompassStatic />;
    case 'objectives': return <ObjectivesView objectives={[[0, 100, -1, 0], [-1, 40, 1, 1], [1, 100, -1, 0]]} team={0} />;
    case 'killfeed': return <KillfeedView rows={[{ id: 1, killer: { text: me?.name ?? 'You', tone: 'me' }, victim: { text: 'SIM-Unit 04 [SIM]', tone: 'enemy' }, weapon: 'Vanguard AR-7', weaponId: 'vanguard', head: true }, { id: 2, killer: { text: 'SIM-Unit 02 [SIM]', tone: 'enemy' }, victim: { text: 'Teammate', tone: 'friend' }, weapon: 'Wasp SMG-9', weaponId: 'wasp', head: false }]} />;
    case 'minimap': return <MinimapPreview />;
    case 'health': return <HealthView hp={76} alive name={me?.name ?? 'Explorer'} emblem={me?.emblem ?? 'recruit'} />;
    case 'weaponSlots': return <WeaponSlotsView slot={0} primary="Vanguard AR-7" secondary="Combat Knife" />;
    case 'weaponInfo': return <WeaponInfoView id="vanguard" name="Vanguard AR-7" category="Assault rifle" state="" lethal={1} tactical={2} keys={!touch} />;
    case 'ammo': return <AmmoView mag={18} reserve={90} magSize={30} melee={false} />;
    case 'streaks': return <StreaksView earned={['recon']} pts={2} level={5} hardline={false} keys={!touch} />;
    case 'killNotify': return <BannerView list={[{ id: 1, text: 'Eliminated SIM-Unit 04', sub: 'Headshot · +125', tone: 'good' }]} />;
    case 'status': return <NetView ping={42} fps={60} showFps ok autoFire={autoFire} />;
    case 'stick': return <StickView />;
    case 'menu': return <MenuButtonsView />;
    case 'fire': return <button className="ar-tbtn fire" tabIndex={-1}>{TOUCH_ICONS.fire}</button>;
    default: return HUD_ELEMENT_BY_ID.get(id)?.touch ? <button className={`ar-tbtn ${id}${id === 'autofire' && autoFire ? ' on' : ''}`} tabIndex={-1}>{TOUCH_ICONS[id] ?? <Crosshair size={18} />}</button> : null;
  }
}
function MinimapPreview() {
  const ref = useRef<HTMLCanvasElement>(null!);
  useEffect(() => drawMinimap(ref.current, 'foundry', false, false), []);
  return <canvas ref={ref} className="ar-minimap" style={{ width: 168, height: 168 }} />;
}
export { HUD_ELEMENTS };
