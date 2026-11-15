// Combat Arena HUD building blocks shared by the live HUD (Hud.tsx, Touch.tsx) and the HUD Customization
// Studio (HudEditor.tsx), so the editor previews exactly what the match draws. Views take plain values; the
// live HUD feeds them from the match, the editor from a sample.
//
// <Slot> places one element where the player's layout puts it (viewport-relative, inside the safe area; see
// shared/arena/hud.mjs) at its size, opacity and alignment.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Crosshair as CrosshairIcon, Radar, Package, Target, Wifi, RotateCw, ArrowUp, ChevronsDown, Repeat, Bomb, Sparkles, Swords, Menu, ListOrdered, Zap, Footprints } from 'lucide-react';
import { HUD_ELEMENT_BY_ID, drawnScale } from '../../shared/arena/hud.mjs';
import { STREAKS, EMBLEM_BY_ID } from '../../shared/arena/weapons.mjs';
import type { Layout } from './hudLayout';
import { WeaponGlyph } from './WeaponGlyph';

/** The size of the area slots are laid out in (the screen, or the editor's device frame). */
export function useViewport(): { w: number; h: number } {
  const read = () => ({ w: typeof window === 'undefined' ? 1280 : window.innerWidth, h: typeof window === 'undefined' ? 720 : window.innerHeight });
  const [v, setV] = useState(read);
  useEffect(() => { const on = () => setV(read()); window.addEventListener('resize', on); window.addEventListener('orientationchange', on); return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); }; }, []);
  return v;
}

/** Variables every slot container needs (overall opacity, contrast, button transparency, icon size). */
export function layoutVars(layout: Layout): CSSProperties {
  return { '--hud-op': layout.global.opacity, '--btn-op': layout.global.buttonOpacity, '--icon': layout.global.iconScale } as CSSProperties;
}

export function Slot({ id, layout, view, children, className = '', interactive = false, style, ...rest }: { id: string; layout: Layout; view: { w: number; h: number }; children: ReactNode; className?: string; interactive?: boolean; style?: CSSProperties } & Record<string, unknown>) {
  const e = layout.elements[id], def = HUD_ELEMENT_BY_ID.get(id);
  if (!e || !def || !e.visible) return null;
  const scale = drawnScale(def, e, view.w, view.h) * (def.text ? layout.global.textScale : 1);
  const vars = { '--x': e.x, '--y': e.y, '--s': scale, opacity: e.opacity, ...style } as CSSProperties;
  return <div className={`ar-slot ar-slot-${id}${def.movable === false ? ' fixed' : ''}${e.align ? ` al-${e.align}` : ''}${interactive ? ' live' : ''} ${className}`} style={vars} data-hud={id} {...rest}>
    <div className="ar-slot-in">{children}</div>
  </div>;
}

// ---------------------------------------------------------------- views
export const fmtClock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Crosshair markup; the gap is set live from the spread cone (`--gap`). */
export function CrosshairMarks({ layout, innerRef, melee = false }: { layout: Layout; innerRef?: React.Ref<HTMLDivElement>; melee?: boolean }) {
  const c = layout.crosshair, e = layout.elements.crosshair;
  if (!e?.visible) return null;
  const style = { '--ch': c.color, '--th': `${c.thickness}px`, '--chs': e.scale, opacity: e.opacity, '--ch-shadow': c.outline ? '0 0 0 1px rgba(0,0,0,.75)' : 'none' } as CSSProperties;
  return <div ref={innerRef} className={`ar-crosshair cs-${c.style}${melee ? ' melee' : ''}`} style={style} data-hud="crosshair"><i /><i /><i /><i /><b /><s /></div>;
}
export function TimerView({ mode, limit, label }: { mode: string; limit: number; label: string }) {
  return <div className="ar-clock"><small>{mode} · {limit}</small><strong>{label}</strong></div>;
}
export function ScoreView({ ours, theirs, limit }: { ours: number; theirs: number; limit: number }) {
  return <div className="ar-topbar">
    <div className="ar-score friend"><b>{ours}</b><span style={{ width: `${Math.min(100, ours / Math.max(1, limit) * 100)}%` }} /></div>
    <div className="ar-score enemy"><span style={{ width: `${Math.min(100, theirs / Math.max(1, limit) * 100)}%` }} /><b>{theirs}</b></div>
  </div>;
}
export function HealthView({ hp, alive, name, emblem }: { hp: number; alive: boolean; name: string; emblem: string }) {
  const e = EMBLEM_BY_ID.get(emblem ?? 'recruit');
  return <div className="ar-vitals"><div className="ar-ident"><span style={{ color: e?.color }}>{e?.glyph}</span>{name}</div>
    <div className={`ar-health${hp < 35 ? ' low' : ''}`}><span style={{ width: `${alive ? hp : 0}%` }} /><b>{alive ? Math.ceil(hp) : 0}</b></div></div>;
}
export function AmmoView({ mag, reserve, magSize, melee }: { mag: number; reserve: number; magSize: number; melee: boolean }) {
  const low = !melee && mag <= Math.ceil(magSize * .25);
  return <div className="ar-wammo">
    {!melee ? <div className={`ar-ammo${low ? ' low' : ''}`}><b>{mag}</b><span>/ {reserve}</span></div> : <div className="ar-ammo"><b>∞</b></div>}
    {!melee && magSize > 0 && <div className={`ar-magbar${low ? ' low' : ''}`} aria-hidden="true">{magSize <= 40 ? Array.from({ length: magSize }, (_, i) => <i key={i} className={i < mag ? 'on' : ''} />) : <span style={{ width: `${mag / magSize * 100}%` }} />}</div>}
  </div>;
}
export function WeaponInfoView({ name, category, state, lethal, tactical, lethalName, tacticalName, keys, id }: { name: string; category: string; state: string; lethal: number; tactical: number; lethalName?: string; tacticalName?: string; keys: boolean; id?: string }) {
  return <div className="ar-winfo">
    {/* The silhouette sits on the name's line, so the element keeps its height in every saved layout. */}
    <div className="ar-wname">{id && <WeaponGlyph id={id} width={42} className="ar-wglyph" />}{name}<small>{category}</small></div>
    <div className="ar-state">{state}</div>
    <div className="ar-equip"><span title={lethalName}>◆ {lethal}{keys && <kbd>G</kbd>}</span><span title={tacticalName}>◇ {tactical}{keys && <kbd>Q</kbd>}</span></div>
  </div>;
}
export function WeaponSlotsView({ slot, primary, secondary }: { slot: number; primary: string; secondary: string }) {
  return <div className="ar-slots"><span className={slot === 0 ? 'on' : ''}>1 · {primary}</span><span className={slot === 1 ? 'on' : ''}>2 · {secondary}</span></div>;
}
export function NetView({ ping, fps, showFps, ok, autoFire }: { ping: number; fps: number; showFps: boolean; ok: boolean; autoFire: boolean }) {
  return <div className={`ar-net${ok ? '' : ' bad'}`}><Wifi size={12} />{ok ? `${ping} ms` : 'reconnecting'}{showFps && ` · ${fps} fps`}{autoFire && <em className="ar-af-tag">AUTO-FIRE</em>}</div>;
}
export function ObjectivesView({ objectives, team }: { objectives: [number, number, number, number][]; team: number }) {
  return <div className="ar-objectives">{['A', 'B', 'C'].map((id, i) => {
    const [owner, progress, capTeam, contested] = objectives[i] ?? [-1, 0, -1, 0];
    const tone = owner < 0 ? 'neutral' : owner === team ? 'friend' : 'enemy', cap = capTeam < 0 ? '' : capTeam === team ? 'friend' : 'enemy';
    return <div key={id} className={`ar-obj ${tone}${contested ? ' contested' : ''}`} aria-label={`Zone ${id}: ${tone === 'neutral' ? 'nobody holds it' : tone === 'friend' ? 'your team holds it' : 'the enemy holds it'}${contested ? ', contested' : ''}`}>
      <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" className="track" />{cap && <circle cx="18" cy="18" r="15" className={`prog ${cap}`} style={{ strokeDasharray: `${progress * .942} 94.2` }} />}</svg><b>{id}</b>
    </div>;
  })}</div>;
}
const STREAK_ICONS = { recon: Radar, supply: Package, strike: Target } as const;
export function StreaksView({ earned, pts, level, hardline, onUse, keys }: { earned: string[]; pts: number; level: number; hardline: boolean; onUse?: (id: string) => void; keys: boolean }) {
  return <div className="ar-streaks">{STREAKS.map((s, i) => {
    const cost = Math.max(1, s.cost - (hardline ? 1 : 0)), ready = earned.includes(s.id), locked = s.unlock > level, Icon = STREAK_ICONS[s.id as keyof typeof STREAK_ICONS];
    return <button key={s.id} className={`ar-streak${ready ? ' ready' : ''}${locked ? ' locked' : ''}`} disabled={!ready || !onUse} onClick={() => onUse?.(s.id)} aria-label={`${s.name}: ${ready ? 'ready' : locked ? `unlocks at level ${s.unlock}` : `${Math.min(pts, cost)} of ${cost} points`}`}>
      <Icon size={18} /><span className="pips">{Array.from({ length: cost }, (_, k) => <i key={k} className={k < pts || ready ? 'on' : ''} />)}</span>{keys && <kbd>{i + 3}</kbd>}
    </button>;
  })}</div>;
}
export function KillfeedView({ rows }: { rows: { id: number | string; killer?: { text: string; tone: string } | null; victim?: { text: string; tone: string } | null; weapon: string; weaponId?: string | null; head: boolean }[] }) {
  return <ol className="ar-feed">{rows.map(f => <li key={f.id}>
    {f.killer && <b className={f.killer.tone}>{f.killer.text}</b>}<span className="weapon" title={f.weapon}>{f.head && <CrosshairIcon size={12} aria-label="Headshot" />}{f.weaponId ? <WeaponGlyph id={f.weaponId} width={42} title={f.weapon} /> : f.weapon}</span><b className={f.victim?.tone}>{f.victim?.text}</b>
  </li>)}</ol>;
}
export function BannerView({ list }: { list: { id: number | string; text: string; sub?: string; tone: string }[] }) {
  return <div className="ar-banners">{list.map(b => <div key={b.id} className={`ar-banner ${b.tone}`}><strong>{b.text}</strong>{b.sub && <span>{b.sub}</span>}</div>)}</div>;
}
// ---------------------------------------------------------------- combat feedback
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH'}`;
/** Labels for experience popups: medals by name, plus the objective actions that are not medals. */
const POP_LABELS: Record<string, string> = { neutralize: 'Neutralised', capture: 'Zone captured', assist: 'Assist', defend: 'Defender' };
/** The card of the player you just eliminated: their emblem, name and level on a plate in their emblem's colour. */
export function ElimCardView({ card }: { card: { id: number | string; name: string; level: number; emblem: string; bot: boolean; head: boolean } | null }) {
  if (!card) return null;
  const e = EMBLEM_BY_ID.get(card.emblem) ?? EMBLEM_BY_ID.get('recruit')!;
  // The plate's pattern follows the emblem, so each player's card looks like theirs.
  const angle = 100 + (card.emblem.length * 37) % 60;
  return <div key={card.id} className="ar-elimcard" style={{ '--em': e.color, '--ang': `${angle}deg` } as CSSProperties}>
    <span className="ar-elimcard-tag">{card.head && <CrosshairIcon size={11} aria-label="Headshot" />}Enemy eliminated</span>
    <div className="ar-elimcard-plate"><i className="ar-elimcard-glyph" aria-hidden="true">{e.glyph}</i><b>{card.name}</b>{card.bot && <em className="ar-bot">SIM</em>}<span className="ar-elimcard-lvl" aria-label={`Level ${card.level}`}>{card.level}</span></div>
  </div>;
}
/** Experience beside the crosshair, with the medals that came with it. Re-keyed so each addition pops. */
export function ScorePopView({ pop, medals }: { pop: { id: number | string; xp: number; tags: string[]; kill: boolean } | null; medals: Record<string, string> }) {
  if (!pop) return null;
  return <div key={`${pop.id}:${pop.xp}:${pop.tags.length}`} className={`ar-pop${pop.kill ? ' kill' : ''}`} aria-live="off">
    {pop.kill && <span className="ar-pop-confirm">Eliminated</span>}
    {pop.xp > 0 && <b>+{pop.xp}<small>XP</small></b>}
    {pop.tags.length > 0 && <ul>{pop.tags.map(t => <li key={t}>{medals[t] ?? POP_LABELS[t] ?? t}</li>)}</ul>}
  </div>;
}
/** Eliminations this life ("2ND KILL"), shown from the second. */
export function KillCountView({ count }: { count: { id: number | string; n: number } | null }) {
  if (!count) return null;
  return <div key={count.id} className="ar-kcount"><b>{ordinal(count.n)}</b> kill</div>;
}
const LEAD_TEXT = { taken: ['Taken the lead', 'Your team is ahead'], back: ['Back on top', 'Your team regained the lead'], lost: ['Lead lost', 'The enemy team is ahead'] } as const;
/** A lead change, worded for your side, under a team crest. */
export function LeadCallView({ lead }: { lead: { id: number | string; kind: 'taken' | 'back' | 'lost' } | null }) {
  if (!lead) return null;
  const [text, sub] = LEAD_TEXT[lead.kind];
  return <div key={lead.id} className={`ar-lead ${lead.kind}`} role="status">
    <svg className="ar-lead-crest" viewBox="0 0 48 56" aria-hidden="true">
      <path d="M24 2 44 9v17c0 13-8.6 22.8-20 28C12.6 48.8 4 39 4 26V9z" className="shield" />
      <path d="M24 8 39 13.4V26c0 9.8-6.2 17.6-15 22.2C15.2 43.6 9 35.8 9 26V13.4z" className="inner" />
      {lead.kind === 'lost' ? <path d="m16 22 8 9 8-9" className="mark" /> : <path d="m16 32 8-9 8 9M16 25l8-9 8 9" className="mark" />}
    </svg>
    <strong>{text}</strong><span>{sub}</span>
  </div>;
}
/** Unlocks reached mid-match: a finish (its swatch) or a player level. */
export function UnlockToastView({ list }: { list: { id: number | string; title: string; sub: string; colors?: string[]; glyph?: string }[] }) {
  if (!list.length) return null;
  return <div className="ar-unlockt">{list.map(u => <div key={u.id} className="ar-unlockt-item">
    <i className="ar-unlockt-icon" style={u.colors ? { background: `linear-gradient(135deg, ${u.colors[0]}, ${u.colors[1]})` } : undefined}>{u.glyph}</i>
    <div><b>{u.title}</b><small>{u.sub}</small></div>
  </div>)}</div>;
}

/** A static compass strip (the live one moves with the view). */
export function CompassStatic() {
  const marks = [], WIDTH = 360, SPAN = 120;
  for (let a = -60; a <= 60; a += 15) { const n = ((a % 360) + 360) % 360, label = ({ 0: 'N', 45: 'NE', 315: 'NW' } as Record<number, string>)[n]; marks.push(<span key={a} className={label ? (label.length === 1 ? 'card' : 'inter') : ''} style={{ left: a * WIDTH / SPAN }}>{label ?? n}</span>); }
  return <div className="ar-compass"><div className="ar-compass-window"><div className="ar-compass-strip">{marks}</div></div><b>000</b></div>;
}

// ---------------------------------------------------------------- touch controls
export const TOUCH_ICONS: Record<string, ReactNode> = {
  fire: <><span className="ring" /><CrosshairIcon size={30} /></>, ads: <CrosshairIcon size={22} />, jump: <ArrowUp size={22} />, crouch: <ChevronsDown size={22} />,
  reload: <RotateCw size={20} />, swap: <Repeat size={20} />, melee: <Swords size={18} />, lethal: <Bomb size={18} />, tactical: <Sparkles size={18} />,
  firemode: <><Repeat size={18} /><small>SEMI/A</small></>, inspect: <RotateCw size={20} />,
  sprint: <Footprints size={20} />, autofire: <><Zap size={16} /><small>AUTO</small></>,
};
export const TOUCH_LABELS: Record<string, string> = {
  firemode: 'Change fire mode', inspect: 'Inspect weapon',
  fire: 'Fire', ads: 'Aim down sights', jump: 'Jump', crouch: 'Crouch, or slide while sprinting', reload: 'Reload', swap: 'Switch weapon', melee: 'Melee',
  lethal: 'Throw lethal', tactical: 'Throw tactical', sprint: 'Sprint', autofire: 'Auto-fire on or off',
};
export function MenuButtonsView({ onScoreboard, onMenu }: { onScoreboard?: (open: boolean) => void; onMenu?: () => void }) {
  return <div className="ar-tmenu">
    <button className="ar-tbtn small" aria-label="Scoreboard" onPointerDown={() => onScoreboard?.(true)} onPointerUp={() => onScoreboard?.(false)} onPointerCancel={() => onScoreboard?.(false)}><ListOrdered size={18} /></button>
    <button className="ar-tbtn small" aria-label="Menu" onClick={() => onMenu?.()}><Menu size={18} /></button>
  </div>;
}
/** The movement stick's resting look (the live one moves its knob). */
export function StickView() { return <div className="ar-stick rest"><div className="ar-knob" /></div>; }
