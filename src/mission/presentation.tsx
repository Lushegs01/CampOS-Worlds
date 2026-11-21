import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';
import { LOADOUT, O, WAREHOUSE } from '../../shared/getaway.mjs';
import { TICK_RATE, WEAPON_BY_ID } from '../../shared/arena/weapons.mjs';
import { input, player, useGame } from '../state';
import { FirstPersonArms, disposeWeapon, preloadArms, preloadWeapon, weaponModel } from '../arena/scene/weapons';
import { ViewmodelAnimator } from '../arena/scene/viewmodel';
import { MuzzleFX } from '../arena/scene/muzzle';
import { flashTexture } from '../arena/scene/fx';
import { softTexture } from '../arena/scene/world';
import { Soldier } from '../arena/scene/soldiers';
import { loadModel } from '../world/assets';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { surfaceHeight } from '../world/layout';
import { registerMovingCaster } from '../world/shadows';
import { activeCombat, combatView, onMissionEvent, useGetaway } from './client';

const GETAWAY_ASSET = { priority: 1 as const, retries: 2, stallMs: 12000, timeoutMs: 45000 };
async function soldierKit(type: string, mobile: boolean) {
  const [body, animation] = await Promise.all([
    loadModel(`arena/${mobile ? 'mobile/' : ''}characters/${type}.glb`, GETAWAY_ASSET),
    loadModel('characters/anim-m.glb', GETAWAY_ASSET),
  ]);
  return { scene: body.scene, clips: Object.fromEntries(animation.animations.map(clip => [clip.name, clip])), teamB: {} };
}

/** Download the approach's first rigs while the player crosses the yard. The selected viewmodel stays on demand. */
function useCombatPreload(stage: number | null) {
  const mobile = useGame(s => s.quality === 'low');
  const inMission = stage !== null && stage <= O.ambush;
  useEffect(() => {
    if (!inMission) return;
    for (const type of ['soldier-m1', 'soldier-m2']) void soldierKit(type, mobile).catch(() => {});
    for (const id of LOADOUT.slice(0, 2)) void preloadWeapon(id, true, GETAWAY_ASSET).catch(() => {});
    void preloadArms(GETAWAY_ASSET).catch(() => {});
  }, [inMission, mobile]);
}

function Hostile({ id, operative }: { id: string; operative: boolean }) {
  const mobile = useGame(s => s.quality === 'low');
  const [soldier, setSoldier] = useState<Soldier | null>(null);
  const gun = operative ? 'vanguard' : 'sparrow', type = operative ? 'soldier-m2' : 'soldier-m1';
  const first = useGetaway.getState().mission?.actors.find(actor => actor.id === id);
  const state = useRef({
    at: new THREE.Vector3(first?.x ?? WAREHOUSE.x, 0, first?.z ?? WAREHOUSE.z), yaw: first?.yaw ?? 0, hp: first?.hp ?? 0,
    hurt: 0, shotAt: -Infinity, tick: 0, poseDt: 0,
  });
  const tag = useRef<THREE.Group>(null!), fallback = useRef<THREE.Group>(null!);
  const contact = useRef<THREE.Mesh>(null!);
  const shadow = useMemo(softTexture, []);
  const fallbackMotion = useRef<AvatarMotion>({ speed: 0, y: 0, vy: 0 });
  const fallbackConfig = useMemo(() => ({ model: operative ? 'ibrahim' : 'chidi', skin: 'natural', accent: '#51594a', accessory: 'none' }), [operative]);
  useEffect(() => {
    let current = true, model: Soldier | null = null, unregister: (() => void) | undefined;
    void soldierKit(type, mobile).then(kit => {
      if (!current) return;
      model = new Soldier(kit, 0, null, flashTexture());
      model.root.name = 'getaway:hostile:' + id;
      unregister = registerMovingCaster(model.root);
      setSoldier(model);
    }).catch(() => {});
    return () => { current = false; unregister?.(); model?.dispose(); setSoldier(null); };
  }, [type, mobile, id]);
  useEffect(() => onMissionEvent(e => {
    const { at } = state.current;
    if (e.kind === 'enemyShot' && Math.hypot(e.x - at.x, e.z - at.z) < 1.35) state.current.shotAt = performance.now();
  }), []);

  useFrame(({ camera }, raw) => {
    const actor = useGetaway.getState().mission?.actors.find(enemy => enemy.id === id), s = state.current;
    const marker = tag.current;
    if (!actor) { if (soldier) soldier.root.visible = false; contact.current.visible = fallback.current.visible = marker.visible = false; return; }
    const dt = Math.min(raw, .12);
    if (Math.hypot(s.at.x - actor.x, s.at.z - actor.z) > 8) s.at.set(actor.x, 0, actor.z);
    const beforeX = s.at.x, beforeZ = s.at.z;
    s.at.x = THREE.MathUtils.damp(s.at.x, actor.x, 15, dt);
    s.at.z = THREE.MathUtils.damp(s.at.z, actor.z, 15, dt);
    s.at.y = surfaceHeight(s.at.x, s.at.z);
    const turn = Math.atan2(Math.sin(actor.yaw - s.yaw), Math.cos(actor.yaw - s.yaw));
    s.yaw += turn * (1 - Math.exp(-dt * 13));
    if (actor.hp < s.hp) s.hurt = 1;
    s.hp = actor.hp;
    s.hurt *= Math.exp(-dt * 8);
    const distance = Math.hypot(player.x - actor.x, player.z - actor.z);
    marker.visible = actor.hp > 0 && distance < 28;
    marker.position.set(s.at.x, s.at.y + 2, s.at.z);
    marker.quaternion.copy(camera.quaternion);
    // The static Performance sun map omits moving figures. A small floor shadow anchors their feet.
    const feet = contact.current;
    feet.visible = mobile && !!soldier && distance < 45;
    if (feet.visible) {
      feet.position.set(s.at.x, Math.max(s.at.y + .018, .032), s.at.z);
      feet.rotation.set(-Math.PI / 2, 0, -s.yaw);
      feet.scale.set(.88, actor.hp > 0 ? .82 : 1.8, 1);
    }
    fallback.current.visible = !soldier && distance < 100;
    if (!soldier) {
      fallback.current.position.copy(s.at);
      fallback.current.rotation.set(actor.hp <= 0 ? Math.PI / 2 : 0, s.yaw, .13 * s.hurt);
      fallbackMotion.current.speed = Math.hypot(s.at.x - beforeX, s.at.z - beforeZ) / Math.max(dt, .001);
      return;
    }
    soldier.root.visible = distance < 100;
    if (!soldier.root.visible) return;
    soldier.setWeapon(gun);
    s.poseDt += dt;
    const interval = distance > 50 ? 4 : distance > 24 && mobile ? 2 : 1;
    if (++s.tick % interval !== 0) { soldier.place(s.at, s.yaw + Math.PI); return; }
    const timeFromShot = performance.now() - s.shotAt;
    const flash = timeFromShot < 80 && !useGame.getState().reducedMotion;
    const flags = actor.mode === 'cover' || actor.mode === 'retreat' ? 2 : 0;
    soldier.update(Math.min(s.poseDt, .2), s.at, s.yaw + Math.PI, -.13 * s.hurt, flags, actor.hp <= 0, flash, distance < 35);
    soldier.root.rotation.z = actor.hp > 0 ? .13 * s.hurt : 0;
    s.poseDt = 0;
  });

  return <>
    {soldier && <primitive object={soldier.root}/>}
    <mesh ref={contact} visible={false} renderOrder={1}>
      <planeGeometry args={[1, 1]}/>
      <meshBasicMaterial map={shadow} color="#151717" transparent opacity={.31} depthWrite={false}/>
    </mesh>
    <group ref={fallback} visible={false}>{!soldier && <AvatarBoundary accent={fallbackConfig.accent}>
      <Suspense fallback={null}><Avatar config={fallbackConfig} id={'getaway-fallback:' + id} motion={() => fallbackMotion.current}/></Suspense>
    </AvatarBoundary>}</group>
    <group ref={tag} visible={false}><mesh><circleGeometry args={[.052, 4]}/><meshBasicMaterial color="#d78964"/></mesh></group>
  </>;
}

/** The mission's input and reload state drive the existing camera-space weapon animator and hand IK. */
function FirstPerson({ id }: { id: string }) {
  const low = useGame(s => s.quality === 'low');
  const attached = useRef<THREE.Group>(null!);
  const rig = useMemo(() => {
    const presentation = new THREE.Group(), holder = new THREE.Group(), muzzle = new MuzzleFX(true, false);
    presentation.name = 'getaway:viewmodel';
    presentation.add(holder, muzzle.group);
    return { presentation, holder, muzzle, animator: new ViewmodelAnimator() };
  }, []);
  const arms = useRef<FirstPersonArms | null>(null), weapon = useRef<THREE.Group | null>(null);
  const state = useRef({ yaw: input.yaw, pitch: input.pitch, lastReload: 0, reloadTotal: 0, reloadEmpty: false, airborne: false, landingSpeed: 0, lowered: 0 });
  useEffect(() => {
    let current = true, model: FirstPersonArms | null = null;
    void preloadArms(GETAWAY_ASSET).then(source => {
      if (!current) return;
      model = new FirstPersonArms(source, 0);
      rig.presentation.add(model.root);
      arms.current = model;
    }).catch(() => {});
    return () => {
      current = false;
      if (!model) return;
      model.root.removeFromParent();
      model.dispose();
      if (arms.current === model) arms.current = null;
    };
  }, [rig]);
  useEffect(() => {
    let current = true, model: THREE.Group | null = null;
    void preloadWeapon(id, low, GETAWAY_ASSET).then(() => {
      if (!current) return;
      model = weaponModel(id, 'standard', low);
      if (!model) return;
      model.name = 'getaway:weapon:' + id;
      model.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
      rig.holder.add(model);
      weapon.current = model;
      state.current.lowered = .28;
    }).catch(() => {});
    return () => {
      current = false;
      if (model) disposeWeapon(model);
      if (weapon.current === model) weapon.current = null;
    };
  }, [id, low, rig]);
  useEffect(() => () => { rig.presentation.removeFromParent(); rig.muzzle.dispose(); }, [rig]);
  useEffect(() => onMissionEvent(event => {
    if (event.kind !== 'shot') return;
    const gun = WEAPON_BY_ID.get(event.weapon ?? id);
    if (!gun) return;
    const aim = Number(useGetaway.getState().aim), reduced = useGame.getState().reducedMotion;
    if (!reduced) {
      rig.animator.shot(gun, aim);
      rig.muzzle.fire(gun.category === 'shotgun' ? 1.4 : gun.category === 'pistol' ? .65 : 1, aim);
    }
  }), [id, rig]);

  useFrame(({ camera, clock }, raw) => {
    const { mission, aim } = useGetaway.getState(), model = weapon.current, worldFrame = attached.current;
    const gun = WEAPON_BY_ID.get(id);
    const visible = activeCombat(mission) && combatView.blend > .98 && !mission?.failed && !!model && !!gun;
    worldFrame.visible = visible;
    if (!visible || !mission || !model || !gun) return;
    const ms = state.current, dt = Math.min(raw, .08), reduced = useGame.getState().reducedMotion, reload = mission.reloading * TICK_RATE;
    if (reload > ms.lastReload + 1.5 || reload > 0 && ms.lastReload <= 0) {
      // Shell-insert cycles reset the server countdown. Their animator keeps the stance while the hand reloads again.
      if (ms.lastReload <= 0 || gun.reloadMode !== 'shell') { ms.reloadTotal = reload; ms.reloadEmpty = mission.gun.mag === 0; }
    }
    ms.lastReload = reload;
    const inAir = player.y > .04;
    if (!reduced && !inAir && ms.airborne) rig.animator.landed(ms.landingSpeed);
    ms.airborne = inAir;
    ms.landingSpeed = Math.abs(player.vy);
    ms.lowered = Math.max(0, ms.lowered - dt);

    // The shared animator and the IK expect camera-space coordinates. Pose off the world frame before
    // attaching the result to the actual camera transform for the regular campus render pass.
    rig.presentation.removeFromParent();
    rig.presentation.updateMatrixWorld(true);
    const out = rig.animator.update({
      dt, weapon: gun, reloadTotal: ms.reloadTotal, reloadEmpty: ms.reloadEmpty, mag: mission.gun.mag,
      dyaw: reduced ? 0 : input.yaw - ms.yaw, dpitch: reduced ? 0 : input.pitch - ms.pitch,
      bob: reduced ? 0 : clock.elapsedTime * 8,
      sim: { phase: reload > 0 ? 'reload' : ms.lowered > 0 && !reduced ? 'switch' : 'ready',
        pt: reload > 0 ? reload : ms.lowered * TICK_RATE, cool: 0, ads: Number(aim), sprint: !reduced && player.sprinting && player.speed > 3,
        stance: 0, grounded: !inAir, vx: reduced ? 0 : player.vx, vz: reduced ? 0 : player.vz, vy: player.vy, shots: 0 },
    }, model, rig.holder);
    const reticle = model.getObjectByName('reticle');
    if (reticle) reticle.visible = out.ads > .7 && reload <= 0;
    arms.current?.pose(model.userData.hold, out.handR, out.handL, rig.holder.quaternion, out.reachL);
    rig.muzzle.setAmbient(player.z > 1 && player.z < 24 ? .54 : .85);
    rig.muzzle.update(dt, model.getObjectByName('muzzle') ?? null, rig.animator.barrelHeat, rig.holder.quaternion);
    worldFrame.position.copy(camera.position);
    worldFrame.quaternion.copy(camera.quaternion);
    worldFrame.add(rig.presentation);
    ms.yaw = input.yaw;
    ms.pitch = input.pitch;
  });
  return <group ref={attached} visible={false}/>;
}

export default function CombatPresentation({ stage }: { stage: number }) {
  const gun = useGetaway(s => s.mission?.gun.id);
  const actors = useGetaway(useShallow(s => s.mission?.actors.map(a => a.id) ?? []));
  useCombatPreload(stage);
  return <>
    {actors.map(id => <Hostile key={id} id={id} operative={useGetaway.getState().mission?.actors.find(a => a.id === id)?.kind === 'operative'}/>)}
    {gun && stage >= O.combat && stage <= O.ambush && <FirstPerson id={gun}/>}
  </>;
}
