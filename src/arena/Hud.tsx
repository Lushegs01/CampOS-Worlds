// Combat Arena in-match interface, laid out by the player's HUD layout (src/arena/hudLayout.ts; edited in
// the HUD Customization Studio). Per-frame elements (crosshair spread, hit markers, damage direction, flash
// blindness, compass, minimap) update DOM styles directly from requestAnimationFrame; everything else
// re-renders only when its own values change.
import { memo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Skull } from 'lucide-react';
import { DISTRICTS, districtAt } from '../../shared/arena/metropolis.mjs';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { WEAPON_BY_ID, EQUIPMENT_BY_ID, CATEGORIES, EMBLEM_BY_ID } from '../../shared/arena/weapons.mjs';
import { MODE_BY_ID, MEDALS } from '../../shared/arena/rules.mjs';
import { weaponOf, B } from '../../shared/arena/sim.mjs';
import { useArena, useBanners, useFeedback } from './store';
import { live, currentSpread, useStreak } from './net';
import { controls, press } from './input';
import { useActiveLayout, useHudProfile, type Layout } from './hudLayout';
import { cinematic } from './look';
import { Slot, useViewport, layoutVars, CrosshairMarks, TimerView, ScoreView, HealthView, AmmoView, WeaponInfoView, WeaponSlotsView, NetView, ObjectivesView, StreaksView, KillfeedView, BannerView, ElimCardView, ScorePopView, KillCountView, LeadCallView, UnlockToastView, fmtClock } from './hudViews';

const weaponName = (id: string | null) => (id ? WEAPON_BY_ID.get(id)?.name ?? EQUIPMENT_BY_ID.get(id)?.name ?? (id === 'strike' ? 'Tactical Strike' : id === 'melee' ? 'Melee' : id === 'fall' ? 'Fall' : id) : '');
type P = { layout: Layout; view: { w: number; h: number } };

export default function Hud() {
  const phase = useArena(s => s.phase), dead = useArena(s => !s.hud.alive), scoreboard = useArena(s => s.scoreboard), mode = useArena(s => s.match?.mode);
  const ref = cinematic(useArena(s => s.match?.map));
  const layout = useActiveLayout(), view = useViewport(), touch = useHudProfile() !== 'desktop';
  if (phase !== 'match') return null;
  const p = { layout, view };
  return <div className={`ar-hud${layout.global.contrast === 'high' ? ' contrast-high' : ''}${touch ? ' touch' : ''}${ref ? ' cinematic' : ''}`} style={layoutVars(layout)} aria-live="polite">
    <HudFx layout={layout} />
    <Slot id="timer" {...p}><Timer /></Slot>
    <Slot id="score" {...p}><Score /></Slot>
    <Slot id="compass" {...p}><Compass /></Slot>
    {mode === 'dom' && <Slot id="objectives" {...p}><Objectives /></Slot>}
    <Slot id="killfeed" {...p}>{ref ? <div className="ar-feedcol"><ElimCard /><KillFeed /></div> : <KillFeed />}</Slot>
    <Slot id="minimap" {...p}><Minimap /></Slot>
    <Slot id="health" {...p}><Vitals /></Slot>
    <Slot id="weaponSlots" {...p}><WeaponSlots /></Slot>
    <Slot id="weaponInfo" {...p}><WeaponInfo keys={!touch} /></Slot>
    <Slot id="ammo" {...p}><Ammo /></Slot>
    <Slot id="streaks" {...p} interactive><Streaks keys={!touch} /></Slot>
    <Slot id="killNotify" {...p}>{ref ? <div className="ar-notify"><LeadCall /><UnlockToasts /><Banners /></div> : <Banners />}</Slot>
    {ref && layout.elements.killNotify?.visible !== false && <CenterFeedback text={layout.global.textScale} />}
    <Slot id="status" {...p}><Netline /></Slot>
    <MatchStatus />
    {dead && <Respawn />}
    {scoreboard && <Scoreboard />}
  </div>;
}

/** Crosshair, hit markers, damage direction, flash and the sniper scope: driven every frame. */
const HudFx = memo(function HudFx({ layout }: { layout: Layout }) {
  const cross = useRef<HTMLDivElement>(null), hit = useRef<HTMLDivElement>(null!), dmg = useRef<HTMLDivElement>(null!), blind = useRef<HTMLDivElement>(null!), scope = useRef<HTMLDivElement>(null!), hurt = useRef<HTMLDivElement>(null!);
  const hm = layout.elements.hitmarker;
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now(), s = live.sim, alive = live.alive && !!s;
      const w = s ? weaponOf(s) : null, ads = s?.ads ?? 0;
      // Crosshair gap from the real spread cone (radians → pixels at the current field of view).
      if (cross.current) {
        const fov = useArena.getState().settings.fov * Math.PI / 180, px = Math.tan(currentSpread()) / Math.tan(fov / 2) * window.innerHeight / 2;
        cross.current.style.setProperty('--gap', `${Math.min(80, 4 + px)}px`);
        cross.current.style.visibility = !alive || s!.sprint || (ads > .6 && w?.category !== 'shotgun') ? 'hidden' : 'visible';
        cross.current.classList.toggle('melee', w?.fire === 'melee');
      }
      const h = now - live.hit.at;
      hit.current.style.visibility = h < (live.hit.kill ? 420 : 200) ? 'visible' : 'hidden';
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
    <CrosshairMarks layout={layout} innerRef={cross} />
    <div ref={hit} className="ar-hitmarker" style={{ visibility: 'hidden', display: hm?.visible === false ? 'none' : undefined, '--hms': hm?.scale ?? 1, '--hm-op': hm?.opacity ?? 1 } as React.CSSProperties}><i /><i /><i /><i /></div>
    <div ref={dmg} className="ar-damage" />
    <div ref={blind} className="ar-blind" />
  </>;
});

function Timer() {
  const { timeLeft, state } = useArena(useShallow(s => ({ timeLeft: s.hud.timeLeft, state: s.hud.matchState })));
  const match = useArena(s => s.match);
  if (!match) return null;
  return <TimerView mode={MODE_BY_ID.get(match.mode)?.short ?? ''} limit={match.scoreLimit} label={state === 'playing' || state === 'countdown' ? fmtClock(timeLeft) : state === 'ended' ? 'END' : 'WARM-UP'} />;
}
function Score() {
  const scores = useArena(s => s.hud.scores), limit = useArena(s => s.match?.scoreLimit ?? 1), team = useArena(s => s.you?.team ?? 0);
  return <ScoreView ours={scores[team] ?? 0} theirs={scores[1 - team] ?? 0} limit={limit} />;
}

/** Heading strip: cardinal points every 15°, teammates and visible firing enemies as pips. */
const Compass = memo(function Compass() {
  const strip = useRef<HTMLDivElement>(null!), pips = useRef<HTMLDivElement>(null!), deg = useRef<HTMLElement>(null!);
  const WIDTH = 360, SPAN = 120; // pixels per SPAN degrees
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      // Yaw 0 looks along −z: call that north, east to the right (yaw decreases turning right).
      const heading = ((-controls.yaw * 180 / Math.PI) % 360 + 360) % 360;
      strip.current.style.transform = `translateX(${-heading * WIDTH / SPAN}px)`;
      deg.current.textContent = String(Math.round(heading) % 360).padStart(3, '0');
      const s = live.sim; let html = '';
      if (s) for (const r of live.remotes.values()) {
        if (!(r.flags & 1) || !r.seenAt) continue;
        const friend = r.team === live.team; if (!friend && !(r.flags & 64)) continue;
        const bearing = Math.atan2(r.pos.x - s.x, -(r.pos.z - s.z)) * 180 / Math.PI;
        const d = ((bearing - heading) % 360 + 540) % 360 - 180; if (Math.abs(d) > SPAN / 2) continue;
        html += `<i class="${friend ? 'friend' : 'enemy'}" style="left:calc(50% + ${(d * WIDTH / SPAN).toFixed(1)}px)"></i>`;
      }
      pips.current.innerHTML = html;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  const marks = [];
  for (let a = -180; a <= 540; a += 15) {
    const n = ((a % 360) + 360) % 360, label = ({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' } as Record<number, string>)[n];
    marks.push(<span key={a} className={label ? (label.length === 1 ? 'card' : 'inter') : ''} style={{ left: a * WIDTH / SPAN }}>{label ?? n}</span>);
  }
  return <div className="ar-compass" aria-hidden="true"><div className="ar-compass-window"><div ref={strip} className="ar-compass-strip">{marks}</div><div ref={pips} className="ar-compass-pips" /></div><b ref={deg}>000</b></div>;
});

function Objectives() {
  const objectives = useArena(s => s.hud.objectives), team = useArena(s => s.you?.team ?? 0);
  return <ObjectivesView objectives={objectives} team={team} />;
}

function KillFeed() {
  const feed = useArena(s => s.feed), players = useArena(s => s.match?.players), me = useArena(s => s.you?.num), team = useArena(s => s.you?.team);
  const name = (n: number | null) => { if (n == null) return null; const p = players?.find(x => x.num === n); return p ? { text: p.name + (p.bot ? ' [SIM]' : ''), tone: n === me ? 'me' : p.team === team ? 'friend' : 'enemy' } : { text: 'Player', tone: 'enemy' }; };
  const now = performance.now();
  return <KillfeedView rows={feed.filter(f => now - f.at < 7000).map(f => ({ id: f.id, killer: f.killer !== f.victim ? name(f.killer) : null, victim: name(f.victim), weapon: weaponName(f.weapon), weaponId: f.weapon && WEAPON_BY_ID.has(f.weapon) ? f.weapon : null, head: f.head }))} />;
}

/**
 * Tactical map: teammates always; enemies only while visible and firing, or revealed by Recon Pulse. North-up and
 * square on most maps; on Metropolis (the cinematic HUD) round, centred on the player and turning with their view.
 */
const Minimap = memo(function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null!), mapId = useArena(s => s.match?.map ?? 'foundry'), mode = useArena(s => s.match?.mode);
  const centred = cinematic(mapId);
  useEffect(() => { const stop = drawMinimap(ref.current, mapId, mode === 'dom', true, centred); return stop; }, [mapId, mode, centred]);
  return <canvas ref={ref} className={`ar-minimap${centred ? ' round' : ''}`} style={{ width: 168, height: 168 }} aria-label="Tactical map" />;
});
/** Metres of the map from the centre to the edge of the round, player-centred map. */
const ROUND_RANGE = 42;
/** Draws the tactical map into `c`; when `live` is set it keeps redrawing players ten times a second. */
export function drawMinimap(c: HTMLCanvasElement, mapId: string, dom: boolean, liveMode: boolean, centred = false) {
  const map = MAP_BY_ID.get(mapId) ?? MAP_BY_ID.get('foundry')!, g = c.getContext('2d'); if (!g) return () => {};
  const size = 168, ratio = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = size * ratio; g.setTransform(ratio, 0, 0, ratio, 0, 0);
  const [x0, z0, x1, z1] = map.bounds, span = Math.max(x1 - x0, z1 - z0) * 1.05, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // The base layer: the whole map once (at 3 px a metre when centred, so it stays sharp when turned and scaled).
  const ppm = centred ? 3 : size / span, margin = centred ? ROUND_RANGE : 0;
  const bx0 = centred ? x0 - margin : cx - span / 2, bz0 = centred ? z0 - margin : cz - span / 2;
  const bw = centred ? Math.ceil((x1 - x0 + margin * 2) * ppm) : size, bh = centred ? Math.ceil((z1 - z0 + margin * 2) * ppm) : size;
  const B = (x: number, z: number) => [(x - bx0) * ppm, (z - bz0) * ppm];
  const base = document.createElement('canvas'); base.width = bw; base.height = bh; const bg = base.getContext('2d')!;
  let level = '';
  const drawBase = (next: string) => {
    level = next; bg.clearRect(0, 0, bw, bh); bg.fillStyle = centred ? 'rgba(20,27,31,.9)' : 'rgba(16,22,26,.88)'; bg.fillRect(0, 0, bw, bh);
    if (centred) { const [a1, b1] = B(x0, z0), [a2, b2] = B(x1, z1); bg.fillStyle = 'rgba(58,68,72,.55)'; bg.fillRect(a1, b1, a2 - a1, b2 - b1); }
    for (const b of map.boxes) {
      const street = 'street' in map ? map.street : 0;
      if (mapId === 'metropolis') {
        if (level === 'underground' ? b.min[1] >= 4.4 || b.max[1] <= 1 : b.max[1] <= street) continue;
      } else if (b.max[1] - b.min[1] < 1.4 && b.max[1] < 2.5) continue;
      const [a1, b1] = B(b.min[0], b.min[2]), [a2, b2] = B(b.max[0], b.max[2]);
      bg.fillStyle = b.min[1] > street + 2.5 ? 'rgba(160,170,175,.18)' : centred ? 'rgba(196,204,207,.62)' : 'rgba(185,195,200,.55)'; bg.fillRect(a1, b1, a2 - a1, b2 - b1);
    }
  };
  // Where a map point is drawn: north-up, or turned about the player (their view straight up) and scaled to the range.
  const view = { px: cx, pz: cz, yaw: 0 };
  const s = centred ? size / 2 / ROUND_RANGE : 1;
  const P = (x: number, z: number) => {
    if (!centred) return B(x, z);
    const dx = x - view.px, dz = z - view.pz, cs = Math.cos(view.yaw), sn = Math.sin(view.yaw);
    return [size / 2 + (dx * cs - dz * sn) * s, size / 2 + (dx * sn + dz * cs) * s];
  };
  const arrow = (px: number, py: number, rot: number) => { g.save(); g.translate(px, py); g.rotate(rot); g.fillStyle = '#ffe9a8'; g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath(); g.fill(); g.restore(); };
  const draw = () => {
    const now = performance.now(), a = useArena.getState();
    const district = mapId === 'metropolis' && live.sim ? districtAt(live.sim.x, live.sim.y, live.sim.z) : 'surface';
    const next = district === 'underground' ? district : 'surface'; if (level !== next) drawBase(next);
    if (live.sim) { view.px = live.sim.x; view.pz = live.sim.z; } view.yaw = centred && liveMode ? controls.yaw : 0;
    g.clearRect(0, 0, size, size);
    if (centred) {
      g.save(); g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, 6.2832); g.clip();
      g.translate(size / 2, size / 2); g.rotate(view.yaw); g.scale(s, s); g.translate(-view.px, -view.pz);
      g.drawImage(base, bx0, bz0, bw / ppm, bh / ppm); g.restore();
      g.save(); g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, 6.2832); g.clip();
    } else g.drawImage(base, 0, 0);
    if (mapId === 'metropolis' && !centred) { g.fillStyle = '#f2efe6'; g.font = '600 10px sans-serif'; g.textAlign = 'center'; g.fillText(DISTRICTS.find(d => d.id === district)?.name ?? 'Okun Bay', size / 2, size - 5); }
    if (dom) map.objectives.forEach((o: { id: string; x: number; z: number }, i: number) => { const [px, py] = P(o.x, o.z), owner = a.hud.objectives[i]?.[0] ?? -1; g.fillStyle = owner < 0 ? '#f2efe6' : owner === live.team ? '#4fb3ff' : '#ff5a48'; g.font = '700 11px Manrope Variable, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.id, px, py); });
    if (!liveMode) { const [px, py] = P(cx, cz); arrow(px, py, 0); if (centred) g.restore(); return; }
    for (const r of live.remotes.values()) {
      if (!(r.flags & 1) || !r.seenAt) continue;
      const friend = r.team === live.team;
      if (!friend && !(r.flags & 64)) continue;
      const [px, py] = P(r.pos.x, r.pos.z); g.fillStyle = friend ? '#4fb3ff' : '#ff5a48'; g.beginPath(); g.arc(px, py, 3.2, 0, 6.3); g.fill();
    }
    for (const [, x, z] of live.radar) { const [px, py] = P(x / 100, z / 100); g.fillStyle = '#ff5a48'; g.beginPath(); g.arc(px, py, 3.4, 0, 6.3); g.fill(); g.strokeStyle = 'rgba(255,90,72,.5)'; g.beginPath(); g.arc(px, py, 5 + (now / 120 % 4), 0, 6.3); g.stroke(); }
    for (const st of live.strikes) { const [px, py] = P(st.x, st.z); g.strokeStyle = '#ff3b2f'; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, st.r * (centred ? s : ppm), 0, 6.3); g.stroke(); }
    if (live.sim) { const [px, py] = P(live.sim.x, live.sim.z); arrow(px, py, centred ? 0 : -controls.yaw); }
    if (centred) {
      // The view cone, and north on the rim.
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, 46); grad.addColorStop(0, 'rgba(255,233,168,.22)'); grad.addColorStop(1, 'rgba(255,233,168,0)');
      g.fillStyle = grad; g.beginPath(); g.moveTo(size / 2, size / 2); g.arc(size / 2, size / 2, 46, -Math.PI / 2 - .55, -Math.PI / 2 + .55); g.closePath(); g.fill();
      if (mapId === 'metropolis') { g.fillStyle = 'rgba(242,239,230,.85)'; g.font = '700 8.5px Manrope Variable, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText((DISTRICTS.find(d => d.id === district)?.name ?? 'Okun Bay').toUpperCase(), size / 2, size - 16); }
      g.restore();
      const nx = size / 2 + Math.sin(view.yaw) * (size / 2 - 9), ny = size / 2 - Math.cos(view.yaw) * (size / 2 - 9);
      g.fillStyle = 'rgba(10,14,16,.85)'; g.beginPath(); g.arc(nx, ny, 7, 0, 6.3); g.fill();
      g.fillStyle = '#f2efe6'; g.font = '800 9px Manrope Variable, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny + .5);
    }
    if (live.reconUntil > now) { g.strokeStyle = 'rgba(79,179,255,.6)'; g.lineWidth = 2; if (centred) { g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, 6.3); g.stroke(); } else g.strokeRect(1, 1, size - 2, size - 2); }
  };
  draw();
  if (!liveMode) return () => {};
  // Turning with the view needs a smoother redraw than the north-up map's ten a second.
  let timer = 0, raf = 0;
  if (centred) { const loop = () => { raf = requestAnimationFrame(loop); if (performance.now() - timer >= 33) { timer = performance.now(); draw(); } }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); }
  timer = window.setInterval(draw, 100);
  return () => clearInterval(timer);
}

function Vitals() {
  const hp = useArena(s => s.hud.hp), alive = useArena(s => s.hud.alive), emblem = useArena(s => s.me?.emblem), name = useArena(s => s.me?.name);
  return <HealthView hp={hp} alive={alive} name={name ?? ''} emblem={emblem ?? 'recruit'} />;
}
function useWeaponHud() { return useArena(useShallow(s => ({ weapon: s.hud.weapon, mag: s.hud.mag, reserve: s.hud.reserve, magSize: s.hud.magSize, phase: s.hud.phase, fireMode: s.hud.fireMode, slot: s.hud.slot, lethal: s.hud.lethal, tactical: s.hud.tactical }))); }
function WeaponSlots() {
  const slot = useArena(s => s.hud.slot), loadout = useArena(s => s.loadout);
  return <WeaponSlotsView slot={slot} primary={WEAPON_BY_ID.get(loadout.primary)?.name ?? ''} secondary={WEAPON_BY_ID.get(loadout.secondary)?.name ?? ''} />;
}
function WeaponInfo({ keys }: { keys: boolean }) {
  const h = useWeaponHud(), loadout = useArena(s => s.loadout);
  const w = WEAPON_BY_ID.get(h.weapon), melee = w?.fire === 'melee', low = !melee && h.mag <= Math.ceil(h.magSize * .25);
  const state = h.phase === 'reload' ? 'RELOADING' : h.phase === 'switch' ? 'SWITCHING' : !melee && h.mag === 0 && h.reserve === 0 ? 'NO AMMO' : !melee && low ? (keys ? 'RELOAD [R]' : 'RELOAD') : '';
  return <WeaponInfoView id={w?.id} name={w?.name ?? ''} category={w ? CATEGORIES[w.category as keyof typeof CATEGORIES] : ''} state={state} lethal={h.lethal} tactical={h.tactical}
    lethalName={EQUIPMENT_BY_ID.get(loadout.lethal)?.name} tacticalName={EQUIPMENT_BY_ID.get(loadout.tactical)?.name} keys={keys} />;
}
function Ammo() {
  const h = useWeaponHud(), w = WEAPON_BY_ID.get(h.weapon);
  return <AmmoView mag={h.mag} reserve={h.reserve} magSize={h.magSize} melee={w?.fire === 'melee'} />;
}
function Streaks({ keys }: { keys: boolean }) {
  const earned = useArena(s => s.hud.earned), pts = useArena(s => s.hud.streakPts), level = useArena(s => s.me?.level ?? 1), perks = useArena(s => s.loadout.perks);
  return <StreaksView earned={earned} pts={pts} level={level} hardline={perks.includes('hardline')} onUse={useStreak} keys={keys} />;
}
function ElimCard() { return <ElimCardView card={useFeedback(s => s.card)} />; }
function LeadCall() { return <LeadCallView lead={useFeedback(s => s.lead)} />; }
function UnlockToasts() { return <UnlockToastView list={useFeedback(s => s.unlocks)} />; }
/** Beside and below the crosshair (fixed, like the crosshair): the experience popup and the count this life. */
function CenterFeedback({ text }: { text: number }) {
  const pop = useFeedback(s => s.pop), count = useFeedback(s => s.count);
  return <div className="ar-center-fb" style={{ '--fb-s': text } as React.CSSProperties}><ScorePopView pop={pop} medals={MEDALS} /><KillCountView count={count} /></div>;
}
function Banners() {
  const list = useBanners(s => s.list);
  return <BannerView list={list.slice(-3)} />;
}

function MatchStatus() {
  const state = useArena(s => s.hud.matchState), match = useArena(s => s.match), timeLeft = useArena(s => s.hud.timeLeft);
  if (!match || (state !== 'waiting' && state !== 'countdown')) return null;
  const people = match.players.filter(p => !p.bot && p.connected).length, host = match.kind === 'private' && match.players[0]?.num === useArena.getState().you?.num;
  const range = match.kind === 'training' && !match.players.some(p => p.bot);
  return <div className="ar-status">
    {state === 'countdown' ? <><strong>{range ? 'Firing range opens in' : 'Match starts in'} {Math.ceil(timeLeft / 1000)}</strong><span>{range ? 'Nobody shoots back: try your controls and HUD layout' : 'Warm-up · no damage yet'}</span></> :
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
  const ping = useArena(s => s.hud.ping), fps = useArena(s => s.hud.fps), show = useArena(s => s.settings.showFps), status = useArena(s => s.status), auto = useArena(s => s.settings.autoFire && s.match?.autoFire !== false);
  return <NetView ping={ping} fps={fps} showFps={show} ok={status === 'ready'} autoFire={auto} />;
}
