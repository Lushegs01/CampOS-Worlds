// The Combat Arena Armory: every weapon with its role, trade-offs and measured statistics, a 3D inspection
// of the real game model (downloaded only when inspected), what the player owns, and buying premium weapons
// through the campus store (Bachs hosted checkout, src/account/shop.ts). Nothing here grants a weapon: it
// unlocks only when the room has verified the payment webhook, and the arena server and the database check
// ownership whenever a loadout is equipped or saved.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { X, ShoppingBag, Lock, Check, Receipt, Crosshair, RotateCw } from 'lucide-react';
import { WEAPONS, WEAPON_BY_ID, CATEGORIES, weaponItem, weaponOwned, isFirearm } from '../../shared/arena/weapons.mjs';
import { formatNaira, SHOP_BY_ID } from '../../shared/shop.mjs';
import { timeToKill } from '../../shared/arena/rules.mjs';
import { buy, usePrice, useShop } from '../account/shop';
import { onRoomMessage } from '../network/messages';
import { useGame } from '../state';
import { getCommunityService } from '../services/community';
import { initLoaders } from '../world/assets';
import { useArena } from './store';
import { request } from './net';
import { preloadWeapon, weaponModel, disposeWeapon } from './scene/weapons';
import { ratings } from './Loadout';

/** Catalogue entries with their Armory fields (added in shared/arena/weapons.mjs). */
type Weapon = typeof WEAPONS[number] & { access: 'free' | 'premium' | 'earned'; armory: string; role: string; tradeoff: string };
const ALL = WEAPONS as Weapon[], byId = (id: string) => WEAPON_BY_ID.get(id) as Weapon | undefined;
const ORDER: Record<string, number> = { free: 0, premium: 1, earned: 2 };

export default function Armory() {
  const focus = useArena(s => s.armory), owned = useArena(s => s.owned), me = useArena(s => s.me);
  const [tab, setTab] = useState<'weapons' | 'history'>('weapons');
  const list = useMemo(() => [...ALL].sort((a, b) => ORDER[a.access] - ORDER[b.access] || (isFirearm(a) ? 0 : 1) - (isFirearm(b) ? 0 : 1)), []);
  const [selected, setSelected] = useState<string>(focus && byId(focus) ? focus : 'vanguard');
  const close = () => useArena.getState().set({ armory: null });
  // A purchase confirmed on campus while the Armory is open: ask the arena server to re-read ownership too
  // (it normally hears at once; this covers a room on another server process).
  useEffect(() => onRoomMessage(m => { if (m.type === 'shopGranted' || m.type === 'shopRevoked') void request({ t: 'owned' }).then(r => { if (Array.isArray(r.owned)) useArena.getState().set({ owned: r.owned as string[] }); }); }), []);
  const w = byId(selected)!;
  return <div className="ar-modal" role="dialog" aria-modal="true" aria-labelledby="ar-armory-title"><div className="ar-sheet ar-armory">
    <header><div><span className="ar-eyebrow">THREE FREE FIREARMS · PREMIUM PLAYSTYLES</span><h2 id="ar-armory-title">Armory</h2></div><button className="ar-icon" aria-label="Close the Armory" onClick={close}><X size={18} /></button></header>
    <nav className="ar-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'weapons'} className={tab === 'weapons' ? 'on' : ''} onClick={() => setTab('weapons')}><Crosshair size={15} />Weapons</button>
      <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}><Receipt size={15} />Purchase history</button>
    </nav>
    {tab === 'weapons' ? <>
      <Inspect weapon={w} owned={owned} verified={!!me?.verified} level={me?.level ?? 1} />
      <div className="ar-armory-grid">{list.map(x => <WeaponCard key={x.id} w={x} owned={owned} level={me?.level ?? 1} on={x.id === selected} onClick={() => setSelected(x.id)} />)}</div>
      <p className="ar-fine">Premium weapons unlock other ways to play, not stronger ones: each trades something away, and the free Vanguard AR-7, Wasp SMG-9 and SIG Sauer M7 stay competitive at every range. No random rewards: you pay once for exactly the weapon you choose, and it is yours on this account on every device.</p>
    </> : <PurchaseHistory verified={!!me?.verified} />}
  </div></div>;
}

function access(w: Weapon, owned: string[], level: number): { label: string; cls: string; usable: boolean } {
  if (w.access === 'free') return { label: 'Free', cls: 'free', usable: true };
  if (w.access === 'earned') return level >= w.unlock ? { label: 'Earned', cls: 'earned', usable: true } : { label: `Level ${w.unlock}`, cls: 'earned', usable: false };
  return weaponOwned(w.id, owned) ? { label: 'Owned', cls: 'owned', usable: true } : { label: '', cls: 'price', usable: false };
}
function WeaponCard({ w, owned, level, on, onClick }: { w: Weapon; owned: string[]; level: number; on: boolean; onClick: () => void }) {
  const a = access(w, owned, level), price = usePrice(weaponItem(w.id));
  return <button className={`ar-acard${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>
    <header><b>{w.name}</b><span className={`ar-tag ${a.cls}`}>{a.cls === 'price' ? <><Lock size={10} /> {formatNaira(price ?? 0)}</> : a.label}</span></header>
    <small className="ar-fine">{w.armory}</small>
    <span>{w.role}</span>
  </button>;
}

/** The selected weapon: model, numbers, trade-off, and what you can do with it. */
function Inspect({ weapon: w, owned, verified, level }: { weapon: Weapon; owned: string[]; verified: boolean; level: number }) {
  const a = access(w, owned, level), item = weaponItem(w.id), price = usePrice(item) ?? 0, enabled = useShop(s => s.enabled), buying = useShop(s => s.buying), online = useGame(s => s.status === 'connected');
  const r = ratings(w), firearm = isFirearm(w);
  const blocked = !verified ? 'Sign in on campus (with a saved profile) to buy weapons. Guests can use the free weapons.' : !online ? 'Connect to campus to buy.' : !enabled ? 'The store is not open on this server yet.' : '';
  const equip = () => { useArena.getState().set({ armory: null, editor: true }); };
  return <section className="ar-inspect">
    <div className="ar-inspect-view"><InspectCanvas id={w.id} /><span className="ar-fine"><RotateCw size={11} /> Drag to turn</span></div>
    <div>
      <span className="ar-eyebrow">{[w.armory, CATEGORIES[w.category as keyof typeof CATEGORIES]].filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i).join(' · ').toUpperCase()}</span>
      <h3 className="ar-inspect-name">{w.name}</h3>
      <p>{w.role}</p>
      {w.id === 'm7' && <p className="ar-fine">Formerly XM7 · SIG Sauer MCX SPEAR · 6.8×51mm hybrid-case military ammunition. Suppressed configuration with a 2× optic. Select semi or auto with B; inspect with I.</p>}
      <p className="ar-fine"><b>Trade-off:</b> {w.tradeoff}</p>
      <div className="ar-stats">
        {firearm ? <>
          <span>Damage</span><i><em style={{ width: `${r.damage}%` }} /></i><b>{w.damage.map(([d, v]) => `${v * w.pellets}${w.pellets > 1 ? '' : ''}@${d}m`).join(' → ')}</b>
          <span>Fire rate</span><i><em style={{ width: `${Math.min(100, (w.rpm ?? 0) / 10)}%` }} /></i><b>{w.rpm} rpm{w.fire === 'burst' ? ` · ${w.burst}-round burst` : w.fire === 'bolt' ? ' · bolt' : w.fire === 'semi' ? ' · semi' : ' · auto'}</b>
          <span>Handling</span><i><em style={{ width: `${r.mobility}%` }} /></i><b>aim {(w.ads / 60).toFixed(2)} s · move {Math.round(w.moveMul * 100)}%</b>
          <span>Range</span><i><em style={{ width: `${r.range}%` }} /></i><b>max {w.range} m · falloff from {w.damage[1]?.[0] ?? w.range} m</b>
          <span>Recoil control</span><i><em style={{ width: `${Math.max(4, r.control)}%` }} /></i><b>{r.control >= 70 ? 'steady' : r.control >= 45 ? 'moderate' : 'heavy'}</b>
          <span>Accuracy</span><i><em style={{ width: `${Math.max(0, 100 - (w.spread?.ads ?? 0) * 5000)}%` }} /></i><b>{((w.spread?.ads ?? 0) * 180 / Math.PI).toFixed(2)}° aimed spread</b>
          <span>Magazine</span><i><em style={{ width: `${Math.min(100, (w.mag ?? 0) / .75)}%` }} /></i><b>{w.mag} + {w.reserve} · reload {((w.reload ?? 0) / 60).toFixed(1)} s{w.reloadMode === 'shell' ? ' per shell' : ''}</b>
          <span>Time to eliminate</span><i /><b>{[5, 20, 40].map(d => { const t = timeToKill(w, d); return `${!Number.isFinite(t) ? 'out of range' : t === 0 ? 'one shot' : `${Math.round(t * 1000)} ms`} @${d} m`; }).join(' · ')}</b>
        </> : <><span>Reach</span><i><em style={{ width: `${(w.reach ?? 0) * 30}%` }} /></i><b>{w.reach ?? 0} m · one hit</b></>}
      </div>
      <div className="ar-row">
        {a.usable ? <button className="ar-primary" onClick={equip}><Check size={16} />{w.access === 'free' ? 'Free · equip in a loadout' : 'Owned · equip in a loadout'}</button>
          : w.access === 'earned' ? <button className="ar-secondary" disabled><Lock size={16} />Earned at level {w.unlock}</button>
            : <><button className="ar-primary" disabled={!!blocked || !!buying} onClick={() => void buy(item)}><ShoppingBag size={16} />{buying === item ? 'Opening secure checkout…' : `Buy for ${formatNaira(price)}`}</button>{blocked && <small className="ar-fine">{blocked}</small>}</>}
      </div>
      {!a.usable && w.access === 'premium' && <p className="ar-fine">Checkout opens in a new tab (Bachs). The weapon unlocks here as soon as the payment is confirmed; a match in progress is never interrupted, and a new weapon is used from your next deployment.</p>}
    </div>
  </section>;
}

/** A small, separate 3D view of the weapon's full game model; it is released when the Armory closes. */
function InspectCanvas({ id }: { id: string }) {
  return <Canvas dpr={[1, 1.5]} camera={{ fov: 28, position: [0, .06, 1.9], near: .01, far: 20 }} gl={{ antialias: true, powerPreference: 'low-power', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: .95 }}>
    <Suspense fallback={null}><InspectModel id={id} /></Suspense>
  </Canvas>;
}
function InspectModel({ id }: { id: string }) {
  const { gl, scene } = useThree(), holder = useRef<THREE.Group>(null!), drag = useRef<{ x: number; y: number; vy: number; vx: number; active: boolean }>({ x: 0, y: 0, vy: .35, vx: 0, active: false });
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl), env = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = env; scene.background = null;
    const key = new THREE.DirectionalLight('#fff4e0', 2.4); key.position.set(1.5, 2, 2); const rim = new THREE.DirectionalLight('#9fc4ff', 1.2); rim.position.set(-2, 1, -1.5);
    scene.add(key, rim);
    return () => { scene.remove(key, rim); env.dispose(); pmrem.dispose(); scene.environment = null; };
  }, [gl, scene]);
  useEffect(() => {
    let on = true; setState('loading');
    holder.current.rotation.set(.04, id === 'm7' ? -1.25 : -.6, 0);
    const load = () => preloadWeapon(id).then(() => {
      if (!on) return;
      const g = weaponModel(id); if (!g) { setState('failed'); return; }
      g.traverse(o => { const r = o.getObjectByName?.('reticle'); if (r) r.visible = false; });
      const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
      g.position.sub(centre); const k = 1.1 / Math.max(size.x, size.y, size.z, .2);
      for (const old of [...holder.current.children]) disposeWeapon(old); holder.current.clear(); holder.current.scale.setScalar(k); holder.current.add(g); setState('ready');
    });
    // The game's loaders are normally set up by the campus; if not, set them up with this renderer.
    load().catch(() => { initLoaders(gl, 4); return load(); }).catch(() => { if (on) setState('failed'); });
    return () => { on = false; if (holder.current) for (const old of [...holder.current.children]) disposeWeapon(old); holder.current?.clear(); };
  }, [id, gl]);
  useEffect(() => {
    const el = gl.domElement, d = drag.current;
    const down = (e: PointerEvent) => { d.active = true; d.x = e.clientX; d.y = e.clientY; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!d.active) return; d.vy = (e.clientX - d.x) * .02; d.vx = (e.clientY - d.y) * .01; holder.current.rotation.y += d.vy; holder.current.rotation.x = THREE.MathUtils.clamp(holder.current.rotation.x + d.vx, -.6, .6); d.x = e.clientX; d.y = e.clientY; };
    const up = () => { d.active = false; d.vy = .35 * Math.sign(d.vy || 1); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [gl]);
  useFrame((_, dt) => { if (!drag.current.active && holder.current) holder.current.rotation.y += dt * .35; });
  useEffect(() => { const el = gl.domElement.closest<HTMLElement>('.ar-inspect-view'); if (el) el.dataset.model = state; }, [state, gl]);
  return <group ref={holder} rotation={[0, -.6, 0]} />;
}

type Order = { id: string; item: string; name: string; kind: string; amount: number; currency: string; status: string; created_at: string; paid_at: string | null; refunded_at: string | null };
function PurchaseHistory({ verified }: { verified: boolean }) {
  const [data, setData] = useState<{ orders: Order[]; owned: { item: string; source: string; granted_at: string }[] } | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!verified) return;
    getCommunityService().then(s => s.myPurchases()).then(d => setData((d as typeof data) ?? { orders: [], owned: [] }), e => setError((e as Error).message || 'Your purchases could not be loaded.'));
  }, [verified]);
  if (!verified) return <p className="ar-note">Purchases belong to a signed-in account. Sign in on campus to buy weapons and see your purchase history.</p>;
  if (error) return <p className="ar-error" role="alert">{error}</p>;
  if (!data) return <p className="ar-fine">Loading your purchases…</p>;
  const status = (o: Order) => o.status === 'paid' ? 'Paid' : o.status === 'refunded' ? 'Refunded' : Date.now() - Date.parse(o.created_at) < 3.6e6 ? 'Awaiting payment' : 'Not completed';
  return <>
    <table className="ar-history"><thead><tr><th>Item</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>{data.orders.length ? data.orders.map(o => <tr key={o.id}><td>{o.name}</td><td>{formatNaira(Number(o.amount))}</td><td>{status(o)}</td><td>{new Date(o.paid_at ?? o.created_at).toLocaleDateString()}</td></tr>) : <tr><td colSpan={4}>No purchases yet.</td></tr>}</tbody></table>
    {data.owned.some(o => o.source === 'legacy') && <p className="ar-fine">Weapons marked as kept were already in your loadouts before they joined the Armory: they stay yours, free.</p>}
    <ul className="ar-fine">{data.owned.map(o => <li key={o.item}>{SHOP_BY_ID.get(o.item)?.name ?? o.item} · {o.source === 'legacy' ? 'kept from before the Armory' : 'purchased'} · {new Date(o.granted_at).toLocaleDateString()}</li>)}</ul>
  </>;
}
