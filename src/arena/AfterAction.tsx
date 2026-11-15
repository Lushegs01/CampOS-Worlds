// After-action report: once a recorded match is saved, each weapon that reached a new weapon level is shown with
// what that unlocked (its finishes), then a player level-up with its unlocks, before the full results. Every card
// is something the account really has now: the pages come from the database's reply (`progress`), never from the
// client's own count. Continue (click, Space or Enter) moves on; Skip (Escape) closes the report.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight, Shield, Sparkles, Package, Bomb, Radar, Target, Award } from 'lucide-react';
import { WEAPON_BY_ID, CATEGORIES, skinsBetween } from '../../shared/arena/weapons.mjs';
import type { Progress } from './store';
import { unlockInfo, type UnlockInfo } from './unlocks';
import { WeaponGlyph } from './WeaponGlyph';
import { sfx } from './audio';

type Page = { key: string; kind: 'weapon' | 'level'; title: string; name: string; sub: string; level: number; before: number; weapon?: string; cards: UnlockInfo[] };

/** The report's pages for a saved result: weapons that levelled up (with their finishes), then the player's level. */
export function reportPages(progress: Progress | null): Page[] {
  if (!progress) return [];
  const pages: Page[] = [];
  for (const w of progress.weapon_levels ?? []) {
    const def = WEAPON_BY_ID.get(w.weapon);
    if (!def || !(w.level > w.before)) continue;
    pages.push({ key: 'w:' + w.weapon, kind: 'weapon', title: 'Weapon unlocks', name: def.name, sub: CATEGORIES[def.category as keyof typeof CATEGORIES] ?? '', level: w.level, before: w.before, weapon: w.weapon,
      cards: skinsBetween(w.before, w.level).map(k => ({ ...unlockInfo(k.id), weapon: w.weapon })) });
  }
  if (progress.level > progress.level_before) pages.push({ key: 'level', kind: 'level', title: 'Level up', name: `Level ${progress.level}`, sub: `From level ${progress.level_before}`, level: progress.level, before: progress.level_before,
    cards: (progress.unlocked ?? []).map(unlockInfo) });
  return pages;
}

const KIND_ICON: Record<string, typeof Shield> = { Perk: Award, Lethal: Bomb, Tactical: Sparkles, Scorestreak: Target, Weapon: Package };
function CardArt({ card }: { card: UnlockInfo }) {
  if (card.kind === 'Finish' && card.colors) return <span className="ar-aar-finish" style={{ '--f0': card.colors[0], '--f1': card.colors[1] } as CSSProperties}><WeaponGlyph id={card.weapon ?? 'vanguard'} width={118} /></span>;
  if (card.kind === 'Weapon' && card.weapon) return <WeaponGlyph id={card.weapon} width={118} />;
  if (card.kind === 'Emblem') return <span className="ar-aar-emblem" style={{ color: card.color }}>{card.glyph}</span>;
  const Icon = card.id === 'recon' ? Radar : KIND_ICON[card.kind] ?? Shield;
  return <Icon size={40} strokeWidth={1.6} />;
}

export default function AfterAction({ progress, onDone }: { progress: Progress; onDone: () => void }) {
  const pages = useMemo(() => reportPages(progress), [progress]);
  const [i, setI] = useState(0);
  const page = pages[i];
  const next = () => { if (i + 1 >= pages.length) onDone(); else { setI(i + 1); sfx.ui('select'); } };
  // Each page holds long enough to read its cards, then moves on by itself.
  useEffect(() => {
    if (!page) { onDone(); return; }
    sfx.ui(page.kind === 'level' ? 'streak' : 'medal');
    const t = setTimeout(next, 3600 + page.cards.length * 450);
    return () => clearTimeout(t);
  }, [i, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onDone(); } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  if (!page) return null;
  return <div className="ar-aar" role="dialog" aria-modal="true" aria-labelledby="ar-aar-title" onClick={next}>
    <span className="ar-aar-eyebrow">After-action report</span>
    <div key={page.key} className={`ar-aar-page ${page.kind}`}>
      <header>
        <h2 id="ar-aar-title">{page.title}</h2>
        <p className="ar-aar-name">{page.name}</p>
      </header>
      <div className="ar-aar-hero">
        {page.weapon ? <WeaponGlyph id={page.weapon} width={340} className="ar-aar-weapon" /> : <span className="ar-aar-rank" aria-label={`Level ${page.level}`}><Shield size={96} strokeWidth={1.2} /><b>{page.level}</b></span>}
        {page.weapon && <span className="ar-aar-badge" aria-label={`Weapon level ${page.level}`}><small>Weapon level</small><b>{page.level}</b></span>}
      </div>
      <div className="ar-aar-cards">
        <i className="ar-aar-scan" aria-hidden="true" />
        {page.cards.length ? page.cards.map((c, n) => <article key={c.id} className="ar-aar-card" style={{ '--n': n } as CSSProperties}>
          <header><b>{c.name}</b><small>{c.kind}</small></header>
          <div className="ar-aar-art"><CardArt card={c} /></div>
          <footer>{c.kind === 'Finish' ? `Level ${c.detail.replace(/\D+/g, '')}` : c.kind === 'Emblem' || c.kind === 'Weapon' ? c.detail : `Level ${page.level}`}</footer>
        </article>) : <p className="ar-aar-none">{page.sub}</p>}
      </div>
    </div>
    <footer className="ar-aar-foot" onClick={e => e.stopPropagation()}>
      <span className="ar-aar-dots" aria-label={`Page ${i + 1} of ${pages.length}`}>{pages.map((p, n) => <i key={p.key} className={n === i ? 'on' : n < i ? 'done' : ''} />)}</span>
      <button className="ar-secondary" onClick={onDone}>Skip <kbd>Esc</kbd></button>
      <button className="ar-primary" onClick={next}>{i + 1 >= pages.length ? 'Results' : 'Continue'}<ChevronRight size={16} /></button>
    </footer>
  </div>;
}
