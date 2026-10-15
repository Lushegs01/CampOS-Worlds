// Your room: the card shown while you are in it, and the floor-plan editor for arranging furniture.
// The editor checks layouts with the same rules the room server uses (shared/dorm.mjs), so problems
// show before saving; the room server still checks again and has the last word.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, DoorOpen, Home, LogOut, Palette, RotateCw, Sofa, Trash2, Undo2, UserPlus } from 'lucide-react';
import { livePeers, useGame } from '../state';
import { useDorm, isResident, leaveDorm, saveLayout, inviteToRoom, visitRoom, declineRoomInvite, showOut, type DormItem, type DormLayout } from '../dorm/client';
import { useSocial, presenceOf, saveSettings, refreshOverview } from '../social/store';
import { useAccount } from '../account/store';
import { DEFAULT_LAYOUT, DOOR_CLEARANCE, DORM_DOOR, DORM_ROOM, DORM_W, DORM_D, FURNITURE, FURNITURE_TYPES, MAX_ITEMS, SNAP, TONES, footprint, validateLayout } from '../../shared/dorm.mjs';

type Kind = keyof typeof FURNITURE;
const STEP = .25, round = (v: number) => Math.round(v * 100) / 100;
const keepsText = (keeps: 'account' | 'session') => keeps === 'account' ? 'Saved to your account.' : 'Guest room: kept while you’re on campus. Sign in to keep it.';

/** The card while you are in a room: yours (arrange, invite, leave) or a friend's (leave). */
export function DormHud() {
  const inside = useDorm(s => s.inside), resident = useDorm(isResident), hostName = useDorm(s => s.hostName), keeps = useDorm(s => s.keeps), busy = useDorm(s => s.busy), visitors = useDorm(s => s.visitors), set = useGame(s => s.set);
  if (!inside) return null;
  const open = (panel: string) => { set({ panel }); document.exitPointerLock?.(); };
  if (!resident) return <aside className="dorm-hud" aria-label={`${hostName}’s room`}>
    <span className="eyebrow">VISITING · PALM HOUSE</span><b>{hostName}’s room</b>
    <div><button disabled={busy} onClick={() => void leaveDorm()}><DoorOpen size={15} />Leave room</button></div>
  </aside>;
  return <aside className="dorm-hud" aria-label="Your room">
    <span className="eyebrow">YOUR ROOM · PALM HOUSE</span>
    <small>{visitors.length ? `Visiting: ${visitors.map(v => v.name).join(', ')}` : keepsText(keeps)}</small>
    <div><button aria-label="Arrange room" onClick={() => open('dorm')}><Sofa size={15} />Arrange</button>
      <button aria-label="Invite friends" onClick={() => open('dorm-guests')}><UserPlus size={15} />Invite</button>
      <button aria-label="Leave room" disabled={busy} onClick={() => void leaveDorm()}><DoorOpen size={15} />Leave</button></div>
  </aside>;
}

/** Who is visiting, which friends on campus to invite, and who may come in. */
export function DormGuests() {
  const resident = useDorm(isResident), visitors = useDorm(s => s.visitors), overview = useSocial(s => s.overview), peers = useGame(s => s.peers);
  const member = useAccount(a => a.status === 'signed-in' && !!a.profile), [sent, setSent] = useState<string[]>([]), [saving, setSaving] = useState(false), [choice, setChoice] = useState<'invite' | 'friends' | null>(null), [, tick] = useState(0);
  useEffect(() => { if (member) void refreshOverview(); const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, [member]);
  if (!resident) return <p className="muted">Go to your room in Palm House to invite friends.</p>;
  if (!member) return <p className="muted">Sign in and add friends to invite them to your room. Visits are for friends only.</p>;
  const here = new Set(visitors.map(v => v.id)), visits = choice ?? overview?.settings.room_visits ?? 'invite';
  const online = (overview?.friends ?? []).map(f => ({ f, peer: presenceOf(f.handle, peers) })).filter(x => x.peer);
  return <div className="dorm-guests">
    <h4>In your room · {visitors.length + 1} of 6</h4>
    {visitors.length ? visitors.map(v => <div key={v.id} className="person-row"><span className="person-name"><b>{v.name}</b><small>{v.handle ? `@${v.handle}` : 'Visiting'}</small></span>
      <button className="secondary small" onClick={() => void showOut(v.id)}><LogOut size={14} />Show out</button></div>)
      : <p className="muted small-text">Nobody else is here yet.</p>}
    <h4>Friends on campus</h4>
    {online.length ? online.map(({ f, peer }) => { const there = here.has(peer!.id), away = !!livePeers.get(peer!.id)?.space && !there;
      return <div key={f.id} className="person-row"><span className="person-name"><b>{f.display_name}</b><small>@{f.handle}{away ? ' · in a room' : ''}</small></span>
        <button className="secondary small" disabled={there || sent.includes(f.id)} onClick={() => void inviteToRoom(f.id).then(r => { if (r.ok) setSent(s => [...s, f.id]); })}>{there ? 'Here' : sent.includes(f.id) ? 'Invited' : <><UserPlus size={14} />Invite</>}</button></div>; })
      : <p className="muted small-text">None of your friends are on campus right now. Friends who appear offline aren’t listed.</p>}
    {overview && <fieldset><legend>Who can come in</legend><div className="radio-row" role="radiogroup">{([['invite', 'Friends you invite'], ['friends', 'Any friend, while you’re in']] as const).map(([v, t]) =>
      <label key={v} className={visits === v ? 'selected' : ''}><input type="radio" name="room-visits" checked={visits === v} disabled={saving} onChange={() => { setChoice(v); setSaving(true); void saveSettings({ ...overview.settings, room_visits: v }).catch(() => { setChoice(null); useGame.getState().notify('That setting couldn’t be saved right now.'); }).finally(() => setSaving(false)); }} />{t}</label>)}</div>
      <small className="muted">Only friends can visit, and only while you’re in your room. Blocking someone always keeps them out. You can show anyone out.</small></fieldset>}
  </div>;
}

/** Invitations to friends' rooms: go now, or not. */
export function DormInvites() {
  const invites = useDorm(s => s.invites), phase = useGame(s => s.phase), [, tick] = useState(0);
  useEffect(() => { if (!invites.length) return; const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, [invites.length]);
  const live = invites.filter(i => i.expires > Date.now());
  if (!live.length || phase !== 'playing') return null;
  return <div className="party-invites room-invites" role="region" aria-label="Room invitations">{live.map(i => <div key={i.host} className="party-invite" role="alertdialog" aria-label={`Room invitation from ${i.from.name}`}>
    <Home size={18} /><span><b>{i.from.name}{i.from.handle ? ` (@${i.from.handle})` : ''}</b> invited you to their room<small>Palm House · {Math.max(0, Math.ceil((i.expires - Date.now()) / 1000))} s</small></span>
    <button className="primary small" onClick={() => void visitRoom(i.host)}>Go</button><button className="secondary small" onClick={() => declineRoomInvite(i.host)}>Not now</button>
  </div>)}</div>;
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
  const resident = useDorm(isResident);
  if (!inside) return <p className="muted">Go to your room in Palm House to arrange it.</p>;
  if (!resident) return <p className="muted">Only the resident can arrange this room.</p>;
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
