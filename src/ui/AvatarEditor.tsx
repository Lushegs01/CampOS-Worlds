import { Suspense, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Avatar, { loadCharacterManifest, preloadCharacter, type CharacterInfo } from '../avatar/Avatar';
import { useGame, type AvatarConfig } from '../state';
import { MODELS, SKINS, ACCENTS, ACCESSORIES } from '../../shared/campus.mjs';
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
    <Stage><Suspense fallback={null}><group position={[0, 0, 0]}><Avatar config={avatar} preview /></group></Suspense></Stage>
    <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[.9, 64]} /><meshStandardMaterial color="#c9bb98" roughness={.9} /></mesh>
  </Canvas>;
}

/**
 * Appearance editor. Without props it edits the guest's own avatar live (saved on this device).
 * With `value`/`onChange` it edits a draft (the account profile editor previews before saving).
 */
export default function AvatarEditor({ value, onChange }: { value?: AvatarConfig; onChange?: (next: AvatarConfig) => void } = {}) {
  const guestAvatar = useGame(s => s.avatar), name = useGame(s => s.name), set = useGame(s => s.set);
  const controlled = !!value && !!onChange, avatar = value ?? guestAvatar;
  const [cast, setCast] = useState<CharacterInfo[]>([]);
  useEffect(() => { loadCharacterManifest().then(m => setCast(MODELS.map(id => m.characters.find(c => c.id === id)!).filter(Boolean))); }, []);
  const change = (patch: Partial<AvatarConfig>) => { const next = { ...avatar, ...patch }; if (controlled) { onChange(next); return; } set({ avatar: next }); send({ type: 'profile', name, avatar: next }); };
  return <div className="avatar-layout"><div className="avatar-preview"><span className="eyebrow">UNIQUELY YOU</span><Preview avatar={avatar} /><span>{cast.find(c => c.id === avatar.model)?.style ?? 'Ready for a world of possibility.'}</span></div><div className="avatar-options">
    {!controlled && <label className="field">What should we call you?<input value={name} maxLength={24} onChange={e => set({ name: e.target.value })} onBlur={() => send({ type: 'profile', name, avatar })} placeholder="Your display name" /></label>}
    <fieldset><legend>Choose your student</legend><div className="character-grid">{cast.map(c => <button type="button" key={c.id} aria-pressed={avatar.model === c.id} aria-label={`${c.name}, ${c.style}`} className={avatar.model === c.id ? 'selected' : ''} onPointerEnter={() => preloadCharacter(c.id)} onClick={() => change({ model: c.id })}><img src={assetUrl(`characters/${c.id}.webp`)} alt="" loading="lazy" /><span>{c.name}</span></button>)}</div></fieldset>
    <fieldset><legend>Skin tone</legend><div className="swatches">{SKINS.map((color, i) => <button type="button" key={color} aria-label={color === 'natural' ? 'Natural skin tone' : `Skin tone ${i}`} aria-pressed={avatar.skin === color} className={(avatar.skin === color ? 'selected ' : '') + (color === 'natural' ? 'natural' : '')} style={{ background: color === 'natural' ? undefined : color }} onClick={() => change({ skin: color })}>{color === 'natural' ? 'Aa' : ''}</button>)}</div></fieldset>
    <fieldset><legend>Accent colour</legend><div className="swatches">{ACCENTS.map((color, i) => <button type="button" key={color} aria-label={`Accent ${i + 1}`} aria-pressed={avatar.accent === color} className={avatar.accent === color ? 'selected' : ''} style={{ background: color }} onClick={() => change({ accent: color })} />)}</div></fieldset>
    <fieldset><legend>A little extra</legend><div className="segments wrap">{ACCESSORIES.map(a => <button type="button" key={a} aria-pressed={avatar.accessory === a} className={avatar.accessory === a ? 'selected' : ''} onClick={() => change({ accessory: a })}>{a}</button>)}</div></fieldset>
    <p className="muted small-text">{controlled ? 'Preview only until you save your profile.' : 'Saved on this device.'} Your display name and appearance are visible to others in the room. Characters: Microsoft Rocketbox (MIT).</p>
  </div></div>;
}
