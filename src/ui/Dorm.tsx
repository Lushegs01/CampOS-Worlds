// Your room: the card shown while you are in it, and the floor-plan editor for arranging furniture.
// The editor checks layouts with the same rules the room server uses (shared/dorm.mjs), so problems
// show before saving; the room server still checks again and has the last word.
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, DoorOpen, Palette, RotateCw, Sofa, Trash2, Undo2 } from 'lucide-react';
import { useGame } from '../state';
import { useDorm, leaveDorm, saveLayout, type DormItem, type DormLayout } from '../dorm/client';
import { DEFAULT_LAYOUT, DOOR_CLEARANCE, DORM_DOOR, DORM_ROOM, DORM_W, DORM_D, FURNITURE, FURNITURE_TYPES, MAX_ITEMS, SNAP, TONES, footprint, validateLayout } from '../../shared/dorm.mjs';

type Kind = keyof typeof FURNITURE;
const STEP = .25, round = (v: number) => Math.round(v * 100) / 100;
const keepsText = (keeps: 'account' | 'session') => keeps === 'account' ? 'Saved to your account.' : 'Guest room: kept while you’re on campus. Sign in to keep it.';

/** The card while you are in your room. */
export function DormHud() {
  const inside = useDorm(s => s.inside), keeps = useDorm(s => s.keeps), busy = useDorm(s => s.busy), set = useGame(s => s.set);
  if (!inside) return null;
  return <aside className="dorm-hud" aria-label="Your room">
    <span className="eyebrow">YOUR ROOM · PALM HOUSE</span>
    <small>{keepsText(keeps)}</small>
    <div><button onClick={() => { set({ panel: 'dorm' }); document.exitPointerLock?.(); }}><Sofa size={15} />Arrange room</button>
      <button disabled={busy} onClick={() => void leaveDorm()}><DoorOpen size={15} />Leave room</button></div>
  </aside>;
}

const SHORT: Record<Kind, string> = { bed: 'Bed', nightstand: 'Side', desk: 'Desk', chair: 'Chair', wardrobe: 'Wardrobe', shelf: 'Shelf', beanbag: 'Bag', lamp: 'Lamp', plant: 'Plant', rug: 'Rug' };
const FILL: Record<Kind, string> = { bed: '#c9a27a', nightstand: '#a7825e', desk: '#b38b62', chair: '#3d4a44', wardrobe: '#8f6a48', shelf: '#9b7652', beanbag: '#5b7fa6', lamp: '#e5c27a', plant: '#5f8a55', rug: '#b05f49' };
const fill = (it: DormItem) => FURNITURE[it.t as Kind].tones ? TONES[it.c] : FILL[it.t as Kind];

/** Arrange your room on a floor plan (north at the top, the door at the bottom), then save. */
export function DormEditor() {
  const saved = useDorm(s => s.layout), keeps = useDorm(s => s.keeps), busy = useDorm(s => s.busy), inside = useDorm(s => s.inside);
  const [draft, setDraft] = useState<DormLayout>(() => structuredClone(saved ?? DEFAULT_LAYOUT));
  const [selected, setSelected] = useState<number | null>(null), [placing, setPlacing] = useState<Kind | null>(null), [message, setMessage] = useState('');
  const svg = useRef<SVGSVGElement>(null!);
  const check = useMemo(() => validateLayout(draft), [draft]);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  if (!inside) return <p className="muted">Go to your room in Palm House to arrange it.</p>;
  const counts = draft.items.reduce<Record<string, number>>((n, it) => ({ ...n, [it.t]: (n[it.t] ?? 0) + 1 }), {});
  const update = (i: number, patch: Partial<DormItem>) => { setDraft(d => ({ items: d.items.map((it, k) => k === i ? { ...it, ...patch } : it) })); setMessage(''); };
  const place = (e: React.PointerEvent) => {
    if (!placing) { setSelected(null); return; }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current.getScreenCTM()!.inverse());
    const f = FURNITURE[placing], snap = (v: number, half: number, max: number) => round(Math.min(Math.floor((max - half) / SNAP + 1e-6) * SNAP, Math.max(Math.ceil(half / SNAP - 1e-6) * SNAP, Math.round(v / STEP) * STEP)));
    // Snapped to the 25 cm grid and kept inside the walls; overlaps are reported, not silently moved.
    const item: DormItem = { t: placing, x: snap(p.x, f.w / 2, DORM_W), z: snap(p.y, f.d / 2, DORM_D), r: 0, c: 0 };
    setDraft(d => ({ items: [...d.items, item] })); setSelected(draft.items.length); setPlacing(null); setMessage('');
  };
  const nudge = (dx: number, dz: number) => { if (selected == null) return; const it = draft.items[selected]; update(selected, { x: round(it.x + dx), z: round(it.z + dz) }); };
  const save = async () => {
    const r = await saveLayout(draft);
    if (r.ok) { setMessage(r.reason ?? (r.saved === 'account' ? 'Saved to your account.' : 'Saved for this visit.')); if (r.layout) setDraft(structuredClone(r.layout)); }
    else setMessage(r.reason ?? 'Your room could not be saved.');
  };
  const sel = selected != null ? draft.items[selected] : null;
  const door = DORM_DOOR.x - DORM_ROOM.x0;
  return <div className="dorm-editor">
    <p className="muted small-text">Tap a piece to move, turn or recolour it. To add one, choose it below, then tap the floor. North is at the top; the door is at the bottom. {keepsText(keeps)}</p>
    <svg ref={svg} className="dorm-plan" viewBox={`-0.15 -0.15 ${DORM_W + .3} ${DORM_D + .3}`} role="group" aria-label="Floor plan of your room" onPointerDown={place}>
      <rect x={-.15} y={-.15} width={DORM_W + .3} height={DORM_D + .3} className="wall" />
      <rect x={0} y={0} width={DORM_W} height={DORM_D} className="floor" />
      {Array.from({ length: Math.floor(DORM_W) }, (_, i) => <line key={'x' + i} x1={i + 1} x2={i + 1} y1={0} y2={DORM_D} className="grid" />)}
      {Array.from({ length: Math.floor(DORM_D) }, (_, i) => <line key={'z' + i} x1={0} x2={DORM_W} y1={i + 1} y2={i + 1} className="grid" />)}
      <rect x={DOOR_CLEARANCE.x0} y={DOOR_CLEARANCE.z0} width={DOOR_CLEARANCE.x1 - DOOR_CLEARANCE.x0} height={DOOR_CLEARANCE.z1 - DOOR_CLEARANCE.z0} className="clearance" />
      <rect x={door - .5} y={DORM_D - .02} width={1} height={.17} className="door" /><rect x={3.1} y={-.15} width={1.6} height={.13} className="window" />
      {draft.items.map((it, i) => ({ it, i })).sort((a, b) => Number(!FURNITURE[a.it.t as Kind].floor) - Number(!FURNITURE[b.it.t as Kind].floor)).map(({ it, i }) => {
        const b = footprint(it), f = FURNITURE[it.t as Kind], front = [[b.x0, b.z1, b.x1, b.z1], [b.x1, b.z0, b.x1, b.z1], [b.x0, b.z0, b.x1, b.z0], [b.x0, b.z0, b.x0, b.z1]][it.r];
        return <g key={i} role="button" tabIndex={0} aria-label={`${f.name}${selected === i ? ' (selected)' : ''}`} className={`piece${selected === i ? ' selected' : ''}${f.floor ? ' floor-piece' : ''}`}
          onPointerDown={e => { e.stopPropagation(); setSelected(i); setPlacing(null); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i); } }}>
          <rect x={b.x0} y={b.z0} width={b.x1 - b.x0} height={b.z1 - b.z0} rx={.05} style={{ fill: fill(it) }} />
          {!f.floor && <line x1={front[0]} y1={front[1]} x2={front[2]} y2={front[3]} className="front" />}
          <text x={it.x} y={it.z} dominantBaseline="middle" textAnchor="middle">{SHORT[it.t as Kind]}</text>
        </g>;
      })}
    </svg>
    {sel ? <div className="dorm-tools" aria-label={`${FURNITURE[sel.t as Kind].name} tools`}>
      <b>{FURNITURE[sel.t as Kind].name}</b>
      <button aria-label="Move north" onClick={() => nudge(0, -STEP)}><ArrowUp size={15} /></button><button aria-label="Move south" onClick={() => nudge(0, STEP)}><ArrowDown size={15} /></button>
      <button aria-label="Move west" onClick={() => nudge(-STEP, 0)}><ArrowLeft size={15} /></button><button aria-label="Move east" onClick={() => nudge(STEP, 0)}><ArrowRight size={15} /></button>
      <button onClick={() => update(selected!, { r: (sel.r + 1) % 4 })}><RotateCw size={15} />Turn</button>
      {FURNITURE[sel.t as Kind].tones && <button onClick={() => update(selected!, { c: (sel.c + 1) % TONES.length })}><Palette size={15} />Colour</button>}
      <button onClick={() => { setDraft(d => ({ items: d.items.filter((_, k) => k !== selected) })); setSelected(null); setMessage(''); }}><Trash2 size={15} />Remove</button>
    </div> : <div className="dorm-catalogue" aria-label="Add furniture">
      {FURNITURE_TYPES.map(t => { const f = FURNITURE[t as Kind], n = counts[t] ?? 0, full = n >= f.max || draft.items.length >= MAX_ITEMS;
        return <button key={t} className={placing === t ? 'selected' : ''} disabled={full} aria-pressed={placing === t} onClick={() => setPlacing(placing === t ? null : t as Kind)}>{f.name}<small>{n}/{f.max}</small></button>; })}
    </div>}
    <p className={`dorm-status${check.ok ? '' : ' problem'}`} role="status">{placing ? `Tap the floor plan to place the ${FURNITURE[placing].name.toLowerCase()}.` : !check.ok ? check.reason : message || `${draft.items.length} of ${MAX_ITEMS} pieces.`}</p>
    <div className="dorm-actions">
      <button className="text-button" onClick={() => { setDraft(structuredClone(DEFAULT_LAYOUT)); setSelected(null); setMessage(''); }}><Undo2 size={14} />Start from the default room</button>
      <button className="primary" disabled={!check.ok || !changed || busy} onClick={() => void save()}>{busy ? 'Saving…' : changed ? 'Save room' : 'Saved'}</button>
    </div>
  </div>;
}
