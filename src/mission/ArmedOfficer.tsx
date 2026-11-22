// An officer out of cover with a drawn weapon: the authored soldier rig (weapon IK, crouch-to-cover, death fall,
// muzzle flash), re-dressed in Metro Police navy. Loaded on demand (lazy) the first time officers deploy.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { flashTexture } from '../arena/scene/fx';
import { Soldier } from '../arena/scene/soldiers';
import { loadModel } from '../world/assets';
import { surfaceHeight } from '../world/layout';
import { registerMovingCaster } from '../world/shadows';
import { player, useGame } from '../state';
import { onMissionEvent, useGetaway } from './client';

const ASSET = { priority: 1 as const, retries: 2, stallMs: 12000, timeoutMs: 45000 };
const kits = new Map<string, Promise<{ scene: THREE.Group; clips: Record<string, THREE.AnimationClip>; teamB: Record<string, THREE.Texture> }>>();
function kit(type: string, mobile: boolean) {
  const key = type + mobile;
  if (!kits.has(key)) kits.set(key, Promise.all([
    loadModel(`arena/${mobile ? 'mobile/' : ''}characters/${type}.glb`, ASSET), loadModel('characters/anim-m.glb', ASSET),
  ]).then(([body, anim]) => ({ scene: body.scene, clips: Object.fromEntries(anim.animations.map(c => [c.name, c])), teamB: {} })));
  return kits.get(key)!;
}
const NAVY = new THREE.Color('#3a4f6e'), TACTICAL = new THREE.Color('#3b3f45');

export default function ArmedOfficer({ id, onReady }: { id: string; onReady?: (ready: boolean) => void }) {
  const mobile = useGame(s => s.quality === 'low');
  const [soldier, setSoldier] = useState<Soldier | null>(null);
  const first = useGetaway.getState().mission?.officers?.find(o => o.id === id);
  const tactical = first?.weapon === 'vanguard';
  const s = useRef({ at: new THREE.Vector3(first?.x ?? 0, 0, first?.z ?? 0), yaw: first?.yaw ?? 0, shotAt: -Infinity, hp: first?.hp ?? 100, hurt: 0 });
  useEffect(() => {
    let live = true, model: Soldier | null = null, unregister: (() => void) | undefined;
    void kit(tactical ? 'soldier-m2' : 'soldier-m1', mobile).then(k => {
      if (!live) return;
      model = new Soldier(k, 0, null, flashTexture());
      // Re-dress the fatigues: navy uniform (grey for the tactical team), skin untouched.
      model.root.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && !/skin|face|head|eye/i.test(m.name)) m.color.multiply(tactical ? TACTICAL : NAVY).multiplyScalar(1.6); });
      model.root.name = 'getaway:officer-armed:' + id;
      unregister = registerMovingCaster(model.root);
      setSoldier(model); onReady?.(true);
    }).catch(() => onReady?.(false));
    return () => { live = false; unregister?.(); model?.dispose(); onReady?.(false); };
  }, [id, mobile, tactical, onReady]);
  useEffect(() => onMissionEvent(e => { if (e.kind === 'enemyShot' && Math.hypot(e.x - s.current.at.x, e.z - s.current.at.z) < 1.2) s.current.shotAt = performance.now(); }), []);
  useFrame((_, raw) => {
    if (!soldier) return;
    const o = useGetaway.getState().mission?.officers?.find(o => o.id === id), st = s.current, dt = Math.min(raw, .12);
    const show = !!o && ['deploy', 'cover', 'aim', 'fire', 'down'].includes(o.mode) && Math.hypot(o.x - player.x, o.z - player.z) < 110;
    soldier.root.visible = show;
    if (!o || !show) return;
    if (st.at.distanceTo(new THREE.Vector3(o.x, st.at.y, o.z)) > 6) st.at.set(o.x, 0, o.z);
    st.at.x = THREE.MathUtils.damp(st.at.x, o.x, 14, dt); st.at.z = THREE.MathUtils.damp(st.at.z, o.z, 14, dt); st.at.y = surfaceHeight(st.at.x, st.at.z);
    st.yaw += Math.atan2(Math.sin(o.yaw - st.yaw), Math.cos(o.yaw - st.yaw)) * (1 - Math.exp(-dt * 12));
    if (o.hp < st.hp) st.hurt = 1; st.hp = o.hp; st.hurt *= Math.exp(-dt * 8);
    soldier.setWeapon(o.weapon ?? 'sparrow');
    const flash = performance.now() - st.shotAt < 80 && !useGame.getState().reducedMotion;
    // Flags: 2 = crouched in cover.
    soldier.update(dt, st.at, st.yaw + Math.PI, -.12 * st.hurt, o.mode === 'cover' ? 2 : 0, o.mode === 'down' || o.hp <= 0, flash, true);
  });
  return soldier ? <primitive object={soldier.root}/> : null;
}
