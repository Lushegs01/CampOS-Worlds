import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CircleDot, Coffee, LogOut, Monitor, RotateCcw, Search } from 'lucide-react';
import { POINTS } from '../../shared/interactions.mjs';
import { player, useGame } from '../state';
import { activate, drop, releaseShot, startCharge } from '../interaction/controller';
import { request, useInteraction, world } from '../interaction/world';

/** The single contextual action prompt ("E — Sit", "E — Open door", …). Click or tap works too. */
export function InteractionPrompt() {
  const focus = useInteraction(s => s.focus), ball = useInteraction(s => s.ball);
  if (!focus || ball) return null;
  return <button className={`interact-prompt${focus.disabled ? ' disabled' : ''}`} onClick={activate} aria-label={focus.label}>
    <kbd>{focus.key}</kbd><span>{focus.hint && <small>{focus.hint}</small>}{focus.label}</span>{!focus.disabled && <ArrowRight size={18} />}
  </button>;
}

const COURT = { x0: 32.6, x1: 55.4, z0: 8.6, z1: 39.4 };
/** Score, round of five, shot feedback and the charge meter. Shown while holding a ball or on the court. */
export function BasketballHUD() {
  const ball = useInteraction(s => s.ball), hoops = useInteraction(s => s.hoops), charging = useInteraction(s => s.charging), zone = useInteraction(s => s.zone), target = useInteraction(s => s.target);
  const [onCourt, setOnCourt] = useState(false), needle = useRef<HTMLSpanElement>(null);
  useEffect(() => { const t = setInterval(() => setOnCourt(player.x > COURT.x0 && player.x < COURT.x1 && player.z > COURT.z0 && player.z < COURT.z1), 400); return () => clearInterval(t); }, []);
  useEffect(() => { if (!charging) return; let f = 0; const tick = () => { if (needle.current) needle.current.style.left = `${(player.charge ?? 0) * 100}%`; f = requestAnimationFrame(tick); }; f = requestAnimationFrame(tick); return () => cancelAnimationFrame(f); }, [charging]);
  const recent = Date.now() - hoops.lastAt < 3500;
  const [, refresh] = useState(0); useEffect(() => { if (!recent) return; const t = setTimeout(() => refresh(n => n + 1), 3600); return () => clearTimeout(t); }, [hoops.lastAt, recent]);
  if (!ball && !onCourt && !recent) return null;
  const round = hoops.round.length >= 5 && !recent ? [] : hoops.round, total = round.reduce((a, b) => a + b, 0);
  const lost = world.balls.filter(b => b.state !== 'held' && (b.x < COURT.x0 - 1 || b.x > COURT.x1 + 1 || b.z < COURT.z0 - 1 || b.z > COURT.z1 + 1));
  return <aside className="hoops-hud" aria-live="polite">
    <div className="hoops-score"><span className="eyebrow">THE COURTS · ROUND OF FIVE</span><b>{String(total).padStart(2, '0')}<small> PTS</small></b>
      <div className="hoops-dots">{[0, 1, 2, 3, 4].map(i => <i key={i} className={i < round.length ? (round[i] ? 'made' : 'miss') : ''} />)}</div>
      <small>Best {Math.max(hoops.best, useGame.getState().bestScore)} · {hoops.made}/{hoops.shots} made today</small></div>
    {recent && hoops.last && <p className="hoops-last">{hoops.last}</p>}
    {charging && <div className="hoops-meter" role="meter" aria-label="Shot power" aria-valuemin={0} aria-valuemax={100}>
      {zone && <span className="zone" style={{ left: `${zone[0] * 100}%`, width: `${(zone[1] - zone[0]) * 100}%` }} />}<span ref={needle} className="needle" />
      <small>{target ? `Aiming at the ${target} hoop · release in the gold` : 'Turn towards a hoop to aim'}</small></div>}
    {ball ? <div className="hoops-keys"><span><kbd>Space</kbd> Hold to shoot</span><span><kbd>Q</kbd> Drop</span><button onClick={() => { drop(); }}><LogOut size={14} />Leave court</button></div>
      : <div className="hoops-keys"><span>Walk up to a ball and press <kbd>E</kbd></span>{lost.length > 0 && <button onClick={() => lost.forEach(b => void request('ballReset', { ball: b.id }))}><RotateCcw size={14} />Retrieve ball{lost.length > 1 ? 's' : ''}</button>}</div>}
  </aside>;
}

/** Touch: the contextual action, plus Shoot (press and hold) and Drop while holding a ball. */
export function TouchInteract() {
  const focus = useInteraction(s => s.focus), ball = useInteraction(s => s.ball);
  if (ball) return <>
    <button className="touch-shoot" aria-label="Hold to shoot" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startCharge(); }} onPointerUp={releaseShot} onPointerCancel={releaseShot}><CircleDot size={22} /><span>Shoot</span></button>
    <button aria-label="Drop the ball" onClick={drop}><RotateCcw size={18} /><span>Drop</span></button>
  </>;
  if (!focus) return null;
  return <button className={`touch-action${focus.disabled ? ' disabled' : ''}`} aria-label={focus.label} onClick={activate}><span>{focus.label}</span></button>;
}

// ------------------------------------------------------------------ fixture panels
const MENU = [['Jollof rice bowl', 'Smoky party-style jollof, plantain, coleslaw', 2500], ['Plantain bites', 'Sweet dodo with pepper sauce', 1200], ['Moi moi', 'Steamed bean pudding, egg', 900], ['Puff-puff (6)', 'Warm and dusted with sugar', 600], ['Zobo', 'Chilled hibiscus with ginger and pineapple', 700], ['Chapman', 'Citrus, cucumber and bitters', 900], ['Coffee', 'Single origin from the Mambilla Plateau', 1000]] as const;
const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;
const BOOKS = [['Design for Everyday Belonging', 'A. Oyelaran', 'How small choices in shared places help newcomers feel at home.'], ['The Patient Builder', 'K. Eze', 'Notes on making things slowly and well, from furniture to software.'], ['Rivers of the Delta', 'T. Briggs', 'A field guide to the creeks, mangroves and the people who know them.'], ['Questions Worth Asking', 'F. Bello', 'A short book about curiosity, method and changing your mind.'], ['Lagos After Rain', 'M. Adeyemi', 'Photographs of a city washed clean, one morning at a time.']] as const;

function Counter() {
  const [order, setOrder] = useState<string[]>([]), [placed, setPlaced] = useState<number | null>(null), s = useGame();
  const total = order.reduce((sum, name) => sum + (MENU.find(m => m[0] === name)?.[2] ?? 0), 0);
  if (placed) return <div className="fixture-order"><Coffee size={30} /><h3>Order #{placed} is being prepared.</h3><p>{order.join(' · ')}</p><p className="muted small-text">Demo order only: nothing is charged and no payment details are ever requested.</p><button className="secondary" onClick={() => { setOrder([]); setPlaced(null); }}>Order something else</button></div>;
  return <div><p>Choose a few things and the counter will call your number. This is a demonstration: there is no payment and nothing is charged.</p>
    <div className="list-cards">{MENU.map(([name, text, price]) => { const n = order.filter(o => o === name).length; return <button key={name} onClick={() => setOrder([...order, name])}><span className="club-mark">{n || '+'}</span><span><b>{name}</b><small>{text}</small></span><span className="price">{naira(price)}</span></button>; })}</div>
    <div className="fixture-total"><span>{order.length ? `${order.length} item${order.length > 1 ? 's' : ''} · ${naira(total)}` : 'Nothing chosen yet'}</span>{order.length > 0 && <button className="text-button" onClick={() => setOrder([])}>Clear</button>}
      <button className="primary" disabled={!order.length} onClick={() => { const n = 10 + Math.floor(Math.random() * 80); setPlaced(n); setTimeout(() => useGame.getState().notify(`Order #${n} is ready at the café counter. Enjoy!`), 9000); s.notify(`Order #${n} placed (demo, no payment).`); }}>Place demo order<ArrowRight size={16} /></button></div></div>;
}

function Computer() {
  const [q, setQ] = useState(''), [held, setHeld] = useState('');
  const results = BOOKS.filter(([t, a, d]) => !q || `${t} ${a} ${d}`.toLowerCase().includes(q.toLowerCase()));
  return <div><label className="field"><span><Search size={14} /> Search the catalogue</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Title, author or subject" autoFocus /></label>
    <div className="list-cards">{results.map(([t, a]) => <button key={t} onClick={() => setHeld(t)}><BookOpen size={20} /><span><b>{t}</b><small>{a} · {held === t ? 'Held for you at the issue desk (demo)' : 'On the shelf · Tap to place a hold'}</small></span></button>)}{!results.length && <p className="muted">No titles match “{q}”.</p>}</div>
    <p className="muted small-text">A fictional catalogue. No library account is connected and no records are kept.</p></div>;
}

export function FixturePanel({ id }: { id: string }) {
  const p = POINTS.find(x => x.id === id); if (!p) return null;
  if (p.kind === 'MENU') return <div className="fixture-menu">{MENU.map(([name, text, price]) => <div key={name} className="menu-row"><span><b>{name}</b><small>{text}</small></span><i /><span>{naira(price)}</span></div>)}<p className="muted small-text">Sample menu. Order at the counter; demo only, no payments.</p></div>;
  if (p.kind === 'COUNTER') return <Counter />;
  if (p.kind === 'COMPUTER') return <Computer />;
  if (p.kind === 'BOOKS') return <div className="list-cards">{BOOKS.map(([t, a, d]) => <div key={t} className="book-card"><BookOpen size={20} /><span><b>{t}</b><small>{a}</small><p>{d}</p></span></div>)}</div>;
  if (p.kind === 'BOARD') return <div className="reading"><span className="eyebrow">STUDIO D1 · TODAY</span><h3>Make one corner of campus more welcoming.</h3><p>Pick a place you pass every day. Spend ten minutes watching how people use it, sketch one small change, then test it with a friend. Bring your sketch to the next studio.</p><p className="muted small-text">Demo classroom content. No attendance or credit is recorded.</p></div>;
  return null;
}
export const fixtureTitle = (id: string) => { const p = POINTS.find(x => `fixture:${x.id}` === id); return p ? { eyebrow: { MENU: 'COURTYARD CAFÉ', COUNTER: 'COURTYARD CAFÉ', BOOKS: 'LEARNING COMMONS', BOARD: 'SCHOOL OF DESIGN', COMPUTER: 'LEARNING COMMONS' }[p.kind] ?? 'CAMPUS', title: { MENU: 'Today at the café.', COUNTER: 'What can we get you?', BOOKS: 'New arrivals.', BOARD: 'Design brief.', COMPUTER: 'Library catalogue.' }[p.kind] ?? p.label, icon: p.kind === 'COMPUTER' ? Monitor : BookOpen } : null; };
