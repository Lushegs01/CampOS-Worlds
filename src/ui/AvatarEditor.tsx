import { Suspense, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Avatar, { loadCharacterManifest, preloadCharacter, type CharacterInfo } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { useGame, type AvatarConfig } from '../state';
import { MODELS, SKINS, ACCENTS, ACCESSORIES, EARNED_ACCENTS } from '../../shared/campus.mjs';
import { LOCKED_ACCENTS, ACHIEVEMENT_BY_ID } from '../../shared/achievements.mjs';
import { Lock, ShoppingBag, X } from 'lucide-react';
import { SHOP_BY_ID, formatNaira, priceOf } from '../../shared/shop.mjs';
import { buy, usePrice, useShop } from '../account/shop';
import { useAccount } from '../account/store';
import { send } from '../network/client';
import { assetUrl, initLoaders } from '../world/assets';

function Stage({ children }: { children: React.ReactNode }) {
  const { gl } = useThree();
  initLoaders(gl, 4);
  return <>{children}</>;
}

function Preview({ avatar }: { avatar: AvatarConfig }) {
  return <Canvas shadows camera={{ position: [0, 1.45, 3.6], fov: 30 }} dpr={[1, 2]} gl={{ toneMapping: THREE.AgXToneMapping, antialias: true }} onCreated={({ camera, size }) => { camera.position.z = size.width < 200 ? 5.2 : 3.6; camera.lookAt(0, 1.0, 0); }}>
    <hemisphereLight args={['#f4efe4', '#5d5040', 1.6]} />
    <directionalLight position={[2.5, 4, 3]} intensity={3.2} color="#fff1dc" castShadow shadow-mapSize={[1024, 1024]} />
    <directionalLight position={[-3, 2, -2.5]} intensity={1.6} color="#bcd4ff" />
    <Stage><AvatarBoundary accent={avatar.accent}><Suspense fallback={null}><group position={[0, 0, 0]}><Avatar config={avatar} preview /></group></Suspense></AvatarBoundary></Stage>
    <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[.9, 64]} /><meshStandardMaterial color="#c9bb98" roughness={.9} /></mesh>
  </Canvas>;
}

/**
 * A store item tried on in the preview, shown under the row it was chosen from: its price and how to buy it. Buying needs a signed-in account with a
 * saved profile and a room with the store open; the item unlocks once the payment is confirmed (src/account/shop.ts).
 */
function StoreOffer({ id, onClose }: { id: string; onClose: () => void }) {
  const item = SHOP_BY_ID.get(id)!, price = usePrice(id) ?? 0, enabled = useShop(s => s.enabled), buying = useShop(s => s.buying);
  const account = useAccount(s => s.status), hasProfile = useAccount(s => !!s.profile), online = useGame(s => s.status === 'connected'), set = useGame(s => s.set);
  const blocked = account === 'unconfigured' ? 'Buying needs an account, and accounts are not set up on this campus.' : account !== 'signed-in' ? '' : !hasProfile ? 'Save your profile first, then buy.' : !online ? 'Connect to campus to buy.' : !enabled ? 'The store is not open on this server yet.' : '';
  return <aside className="store-offer" aria-label={`${item.name} in the store`}>
    <button type="button" className="store-offer-close" aria-label="Stop trying this on" onClick={onClose}><X size={14} /></button>
    <span className="eyebrow">CAMPUS STORE</span><b>{item.name}</b><span>{item.detail}</span>
    {account === 'guest' || account === 'loading' ? <button type="button" className="primary" onClick={() => set({ panel: 'account' })}><ShoppingBag size={15} />Sign in to buy · {formatNaira(price)}</button>
      : blocked ? <><button type="button" className="primary" disabled><ShoppingBag size={15} />{formatNaira(price)}</button><small>{blocked}</small></>
      : <button type="button" className="primary" disabled={!!buying} onClick={() => void buy(id)}><ShoppingBag size={15} />{buying === id ? 'Opening checkout…' : `Buy for ${formatNaira(price)}`}</button>}
    <small>One payment, securely through Bachs. Yours on this account for good.</small>
  </aside>;
}

/**
 * Appearance editor. Without props it edits the guest's own avatar live (saved on this device).
 * With `value`/`onChange` it edits a draft (the account profile editor previews before saving).
 * Store items the account does not own can be tried on in the preview, never chosen.
 */
export default function AvatarEditor({ value, onChange, earned = [], owned = [] }: { value?: AvatarConfig; onChange?: (next: AvatarConfig) => void; earned?: string[]; owned?: string[] } = {}) {
  const guestAvatar = useGame(s => s.avatar), name = useGame(s => s.name), set = useGame(s => s.set), prices = useShop(s => s.prices);
  const controlled = !!value && !!onChange, avatar = value ?? guestAvatar;
  const [cast, setCast] = useState<CharacterInfo[]>([]), [trying, setTrying] = useState<string | null>(null);
  useEffect(() => { loadCharacterManifest().then(m => setCast(MODELS.map(id => m.characters.find(c => c.id === id)!).filter(Boolean))); }, []);
  const change = (patch: Partial<AvatarConfig>) => { const next = { ...avatar, ...patch }; if (controlled) { onChange(next); return; } set({ avatar: next }); send({ type: 'profile', name, avatar: next }); };
  // Locked store items are worn only in the preview; anything else is chosen as before.
  const locked = (id: string) => SHOP_BY_ID.has(id) && !(controlled && owned.includes(id));
  const choose = (id: string, patch: Partial<AvatarConfig>) => { if (locked(id)) { setTrying(id); return; } setTrying(null); change(patch); };
  const tried = trying ? SHOP_BY_ID.get(trying)! : null, shown = tried ? { ...avatar, ...(tried.kind === 'character' ? { model: tried.id } : { accessory: tried.id }) } : avatar;
  const price = (id: string) => formatNaira(priceOf(id, prices) ?? 0);
  return <div className="avatar-layout"><div className="avatar-preview"><span className="eyebrow">UNIQUELY YOU</span><Preview avatar={shown} /><span>{cast.find(c => c.id === shown.model)?.style ?? 'Ready for a world of possibility.'}</span></div><div className="avatar-options">
    {!controlled && <label className="field">What should we call you?<input value={name} maxLength={24} onChange={e => set({ name: e.target.value })} onBlur={() => send({ type: 'profile', name, avatar })} placeholder="Your display name" /></label>}
    <fieldset><legend>Choose your student</legend><div className="character-grid">{cast.map(c => { const lock = locked(c.id);
      return <button type="button" key={c.id} aria-pressed={shown.model === c.id} aria-label={lock ? `${c.name}, ${c.style}, in the store for ${price(c.id)}` : `${c.name}, ${c.style}`} className={(shown.model === c.id ? 'selected' : '') + (lock ? ' premium' : '')} onPointerEnter={() => preloadCharacter(c.id)} onClick={() => choose(c.id, { model: c.id })}><img src={assetUrl(`characters/${c.id}.webp`)} alt="" loading="lazy" />{lock && <i className="price-tag"><Lock size={9} />{price(c.id)}</i>}<span>{c.name}</span></button>; })}</div>
      {tried?.kind === 'character' && <StoreOffer id={tried.id} onClose={() => setTrying(null)} />}</fieldset>
    <fieldset><legend>Skin tone</legend><div className="swatches">{SKINS.map((color, i) => <button type="button" key={color} aria-label={color === 'natural' ? 'Natural skin tone' : `Skin tone ${i}`} aria-pressed={avatar.skin === color} className={(avatar.skin === color ? 'selected ' : '') + (color === 'natural' ? 'natural' : '')} style={{ background: color === 'natural' ? undefined : color }} onClick={() => change({ skin: color })}>{color === 'natural' ? 'Aa' : ''}</button>)}</div></fieldset>
    <fieldset><legend>Accent colour</legend><div className="swatches">{ACCENTS.map((color, i) => <button type="button" key={color} aria-label={`Accent ${i + 1}`} aria-pressed={avatar.accent === color} className={avatar.accent === color ? 'selected' : ''} style={{ background: color }} onClick={() => change({ accent: color })} />)}
      {/* Earned colours: each unlocks with a badge (checked again by the database and the room). */}
      {EARNED_ACCENTS.map(color => { const badge = ACHIEVEMENT_BY_ID.get(LOCKED_ACCENTS[color])!, open = controlled && earned.includes(badge.id);
        return <button type="button" key={color} aria-label={open ? `${badge.name} colour` : `${badge.name} colour, locked: ${badge.rule}`} title={open ? `Earned with ${badge.name}` : `Unlocks with the ${badge.name} badge: ${badge.rule}`} aria-pressed={avatar.accent === color} disabled={!open} className={`earned-swatch${avatar.accent === color ? ' selected' : ''}`} style={{ background: color }} onClick={() => change({ accent: color })}>{!open && <Lock size={11} />}</button>; })}</div>
      <small className="muted">{controlled ? 'Colours with a lock are earned with badges.' : 'Colours with a lock are earned with badges on a signed-in account.'}</small></fieldset>
    <fieldset><legend>A little extra</legend><div className="segments wrap">{ACCESSORIES.map(a => { const lock = locked(a);
      return <button type="button" key={a} aria-pressed={shown.accessory === a} aria-label={lock ? `${SHOP_BY_ID.get(a)!.name}, in the store for ${price(a)}` : undefined} className={(shown.accessory === a ? 'selected' : '') + (lock ? ' premium' : '')} onClick={() => choose(a, { accessory: a })}>{a}{lock && <small className="price-tag"><Lock size={9} />{price(a)}</small>}</button>; })}</div>
      {tried?.kind === 'accessory' ? <StoreOffer id={tried.id} onClose={() => setTrying(null)} /> : <small className="muted">Items with a price are in the campus store: tap one to try it on.</small>}</fieldset>
    <p className="muted small-text">{controlled ? 'Preview only until you save your profile.' : 'Saved on this device.'} Your display name and appearance are visible to others in the room. Characters: Microsoft Rocketbox (MIT).</p>
  </div></div>;
}
