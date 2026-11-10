// Loadout editor: five loadouts, each a primary and secondary weapon, lethal and tactical equipment,
// two perks and earned weapon finishes. Locked items show the level that unlocks them. Signed-in
// players' loadouts are saved to their account (validated by the database), guests' on this device;
// the arena server validates the one in use either way.
import { useMemo, useState } from 'react';
import { X, Lock, Check } from 'lucide-react';
import { WEAPONS, LETHALS, TACTICALS, PERKS, SKINS, CATEGORIES, WEAPON_BY_ID, damageAt, weaponOwned, weaponItem } from '../../shared/arena/weapons.mjs';
import { formatNaira, priceOf } from '../../shared/shop.mjs';
import { useShop } from '../account/shop';
import { validateLoadout, PRESETS } from '../../shared/arena/rules.mjs';
import { useArena, saveDeviceLoadouts, type Loadout } from './store';
import { request } from './net';
import { getCommunityService } from '../services/community';
import { sfx } from './audio';

type Weapon = typeof WEAPONS[number];
/** Comparable 0–100 ratings from the real numbers. */
export function ratings(w: Weapon) {
  if (w.fire === 'melee') return { damage: 100, rate: 30, range: 4, mobility: Math.round(w.moveMul * 90), control: 100 };
  const dps = damageAt(w, 10) * w.pellets * (w.fire === 'burst' ? (w.burstRpm ?? w.rpm ?? 0) * .7 : w.rpm ?? 0) / 60;
  return {
    damage: Math.min(100, Math.round(damageAt(w, 0) * w.pellets / 1.6)),
    rate: Math.min(100, Math.round(dps / 3.6)),
    range: Math.min(100, Math.round((w.damage.at(-1)?.[0] ?? 0) * 1.2 + damageAt(w, 40) * w.pellets * .5)),
    mobility: Math.min(100, Math.round(w.moveMul * 70 + (1 - w.ads / 30) * 30)),
    control: Math.min(100, Math.round(100 - (w.recoil?.kick ?? 0) * 2500 - (w.spread?.hip ?? 0) * 300)),
  };
}

export default function LoadoutEditor() {
  const me = useArena(s => s.me), stored = useArena(s => s.loadouts), active = useArena(s => s.loadout), inMatch = useArena(s => s.phase === 'match'), owned = useArena(s => s.owned), prices = useShop(s => s.prices);
  const level = me?.level ?? 1, weaponLevels = me?.weaponLevels ?? {};
  const [slots, setSlots] = useState<Loadout[]>(() => Array.from({ length: 5 }, (_, i) => ({ ...(stored[i] ?? PRESETS[i] ?? PRESETS[0]) })));
  const [index, setIndex] = useState(() => Math.max(0, stored.findIndex(l => JSON.stringify(l) === JSON.stringify(active))));
  const [msg, setMsg] = useState(''), [saving, setSaving] = useState(false);
  const cur = slots[index];
  const patch = (v: Partial<Loadout>) => { setSlots(list => list.map((l, i) => (i === index ? { ...l, ...v } : l))); setMsg(''); };
  const check = useMemo(() => validateLoadout(cur, level, weaponLevels, owned), [cur, level, weaponLevels, owned]);
  const close = () => useArena.getState().set({ editor: false });
  async function equip() {
    if (!check.ok) { setMsg(check.reason ?? 'Check this loadout.'); return; }
    const chosen = check.loadout as Loadout;
    setSaving(true); sfx.ui();
    const r = await request({ t: 'loadout', loadout: chosen });
    if (!r.ok) { setSaving(false); setMsg(String(r.reason)); return; }
    const list = slots.map((l, i) => (i === index ? chosen : l));
    useArena.getState().set({ loadout: chosen, loadouts: list });
    if (me?.verified) {
      try { const svc = await getCommunityService(); await svc.saveArenaLoadout(index + 1, chosen); }
      catch (e) { setSaving(false); setMsg(`Equipped for this session, but not saved to your account: ${(e as Error).message}`); return; }
    } else saveDeviceLoadouts(list);
    setSaving(false);
    setMsg(inMatch ? (r.next === 'spawn' ? 'Equipped. It takes effect when you next deploy.' : 'Equipped.') : me?.verified ? 'Saved to your account and equipped.' : 'Saved on this device and equipped.');
  }
  const pick = (kind: 'primary' | 'secondary') => <div className="ar-weapons">{Object.entries(CATEGORIES).map(([cat, label]) => {
    const list = WEAPONS.filter(w => w.slot === kind && w.category === cat); if (!list.length) return null;
    return <div key={cat}><span className="ar-eyebrow">{label}</span>{list.map(w => {
      const premium = !weaponOwned(w.id, owned), locked = premium || w.unlock > level, on = cur[kind] === w.id, r = ratings(w);
      // Premium weapons not yet owned open the Armory (preview, numbers, purchase) instead of being equipped.
      return <button key={w.id} className={`ar-wcard${on ? ' on' : ''}${premium ? ' premium' : ''}`} disabled={!premium && locked} aria-pressed={on} onClick={() => (premium ? useArena.getState().set({ armory: w.id, editor: false }) : patch({ [kind]: w.id }))}>
        <b>{w.name}{premium ? <span className="ar-lock"><Lock size={12} />Armory · {formatNaira(priceOf(weaponItem(w.id), prices) ?? 0)}</span> : locked && <span className="ar-lock"><Lock size={12} />Level {w.unlock}</span>}</b>
        {w.fire !== 'melee' ? <small>{w.fire === 'auto' ? 'Automatic' : w.fire === 'burst' ? `${w.burst}-round burst` : w.fire === 'bolt' ? 'Bolt action' : 'Semi-automatic'} · {w.rpm} rpm · {w.mag} rounds{w.pellets > 1 ? ` · ${w.pellets} pellets` : ''}{w.penetration >= .5 ? ' · penetrates cover' : ''}</small> : <small>One hit eliminates · {w.reach} m reach</small>}
        <span className="ar-bars">{Object.entries(r).map(([k, v]) => <i key={k} title={`${k}: ${v}`}><em style={{ width: `${v}%` }} /><span>{k}</span></i>)}</span>
      </button>;
    })}</div>;
  })}</div>;
  const choose = <T extends { id: string; name: string; unlock: number }>(list: T[], value: string, set: (id: string) => void, text?: (x: T) => string) =>
    <div className="ar-chips">{list.map(x => <button key={x.id} disabled={x.unlock > level} className={value === x.id ? 'on' : ''} aria-pressed={value === x.id} onClick={() => set(x.id)} title={text?.(x)}>{x.name}{x.unlock > level && <span className="ar-lock"><Lock size={11} />{x.unlock}</span>}</button>)}</div>;
  return <div className="ar-modal" role="dialog" aria-modal="true" aria-labelledby="ar-loadout-title">
    <div className="ar-sheet ar-loadout">
      <header><div><span className="ar-eyebrow">LOADOUTS · LEVEL {level}</span><h2 id="ar-loadout-title">Build your loadout</h2></div><button className="ar-icon" aria-label="Close loadouts" onClick={close}><X size={18} /></button></header>
      <nav className="ar-slotbar">{slots.map((l, i) => <button key={i} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>{l.name}</button>)}</nav>
      <label className="ar-name">Name<input value={cur.name} maxLength={24} onChange={e => patch({ name: e.target.value })} /></label>
      <h3>Primary</h3>{pick('primary')}
      <h3>Secondary</h3>{pick('secondary')}
      <div className="ar-row2"><div><h3>Lethal</h3>{choose(LETHALS, cur.lethal, id => patch({ lethal: id }))}</div><div><h3>Tactical</h3>{choose(TACTICALS, cur.tactical, id => patch({ tactical: id }))}</div></div>
      <h3>Perks <small>choose two</small></h3>
      <div className="ar-chips perks">{PERKS.map(p => { const on = cur.perks.includes(p.id), locked = p.unlock > level; return <button key={p.id} disabled={locked} className={on ? 'on' : ''} aria-pressed={on}
        onClick={() => patch({ perks: on ? cur.perks.filter(x => x !== p.id) : [...cur.perks, p.id].slice(-2) })}><b>{p.name}{locked && <span className="ar-lock"><Lock size={11} />{p.unlock}</span>}</b><small>{p.text}</small></button>; })}</div>
      <h3>Weapon finishes <small>earned with eliminations</small></h3>
      <div className="ar-skins">{[cur.primary, cur.secondary].map(id => { const wl = weaponLevels[id] ?? 1; return <div key={id}><span>{WEAPON_BY_ID.get(id)?.name} · weapon level {wl}</span><div className="ar-chips">{SKINS.map(k => { const locked = k.weaponLevel > wl, on = (cur.skins?.[id] ?? 'standard') === k.id; return <button key={k.id} disabled={locked} className={on ? 'on' : ''} onClick={() => patch({ skins: { ...(cur.skins ?? {}), [id]: k.id } })}><i className="ar-swatch" style={{ background: `linear-gradient(135deg, ${k.colors[0]}, ${k.colors[1]})` }} />{k.name}{locked && <span className="ar-lock"><Lock size={11} />{k.weaponLevel}</span>}</button>; })}</div></div>; })}</div>
      <footer>{msg && <span className={check.ok ? 'ar-ok' : 'ar-error'}>{msg}</span>}{!check.ok && !msg && <span className="ar-error">{check.reason}</span>}
        <button className="ar-primary" disabled={saving || !check.ok} onClick={equip}><Check size={16} />{saving ? 'Saving…' : 'Equip'}</button></footer>
    </div>
  </div>;
}
