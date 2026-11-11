// Remote players as realistic soldiers: Microsoft Rocketbox military avatars (MIT) with body, head,
// tactical vest and helmet, in their team's camouflage (woodland or desert, built by
// scripts/assets/build-arena.mjs). The campus' motion-captured clip library drives locomotion (idle,
// walk, jog, run, crouch); two-bone IK puts both hands on a third-person rifle that follows the
// player's aim; eliminations fall procedurally.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadModel, loadTexture } from '../../world/assets';
import { weaponThirdPerson, preloadWeapon } from './weapons';
import { FREE_FIREARMS, WEAPONS } from '../../../shared/arena/weapons.mjs';
import { arenaPath, P2, P3, type Library } from './library';

const MODELS = ['soldier-m1', 'soldier-m2', 'soldier-f1'] as const;
const BODY: Record<string, 'm' | 'f'> = { 'soldier-m1': 'm', 'soldier-m2': 'm', 'soldier-f1': 'f' };
const CAMO = ['body', 'equipment', 'helmet'];
interface Kit { scene: THREE.Group; clips: Record<string, THREE.AnimationClip>; teamB: Record<string, THREE.Texture> }
const kitsByTier = new Map<boolean, Promise<Record<string, Kit>>>();
/**
 * The soldiers (priority 2: they stream while the player is already in the match; until they arrive other players
 * are drawn as StandInSoldier). Phones load the 512² texture tier. The animation libraries are the campus' own
 * files, usually already in memory from the campus.
 */
export function loadSoldiers(mobile = false, signal?: AbortSignal): Promise<Record<string, Kit>> {
  const hit = kitsByTier.get(mobile); if (hit) return hit;
  const libs: Record<string, Promise<Record<string, THREE.AnimationClip>>> = {};
  const lib = (b: 'm' | 'f') => (libs[b] ??= loadModel(`characters/anim-${b}.glb`, { ...P2, signal }).then(g => Object.fromEntries(g.animations.map(c => [c.name, c]))));
  const kits = Promise.all(MODELS.map(async id => {
    const [g, clips, ...b] = await Promise.all([loadModel(arenaPath(`characters/${id}.glb`, mobile), { ...P2, signal }), lib(BODY[id]), ...CAMO.map(p => loadTexture(arenaPath(`characters/${id}-${p}-b.ktx2`, mobile), { ...P2, signal }).catch(() => null))]);
    const teamB: Record<string, THREE.Texture> = {};
    CAMO.forEach((p, i) => { const t = b[i]; if (t) { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; teamB[p] = t; } });
    return [id, { scene: g.scene, clips, teamB }] as const;
  })).then(async list => {
    // The weapons most players carry (the two free firearms and the knife) come with the soldiers, so nobody
    // appears empty-handed; any other weapon's model downloads the first time someone is seen holding it.
    await Promise.all([...FREE_FIREARMS, 'knife'].map(id => preloadWeapon(id, true, { ...P2, signal }).catch(() => null)));
    return Object.fromEntries(list);
  });
  kitsByTier.set(mobile, kits);
  kits.catch(() => { if (kitsByTier.get(mobile) === kits) kitsByTier.delete(mobile); });
  return kits;
}
/** Leaving the arena: forget the parsed soldiers (the HTTP cache keeps the files). */
export function releaseSoldiers() { kitsByTier.clear(); standIn.forEach(v => { v.geometry.dispose(); v.material.dispose(); }); standIn.clear(); }

/** What the scene needs from a drawn player, real model or stand-in. */
export interface SoldierLike { root: THREE.Group; team: number; setWeapon(id: string): void; update(dt: number, pos: THREE.Vector3, yaw: number, pitch: number, flags: number, dead: boolean, flashOn: boolean, ik: boolean): void; dispose(): void }

// ---------------------------------------------------------------- stand-in while the soldier models download
const standIn = new Map<number, { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }>();
/** A soldier-proportioned figure (helmet, vest, limbs) in the team's camouflage colour, one draw call. */
function standInParts(team: number) {
  let hit = standIn.get(team);
  if (!hit) {
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => { g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
    add(new THREE.CapsuleGeometry(.17, .5, 4, 10), 0, 1.18, 0);                     // torso
    add(new THREE.BoxGeometry(.42, .42, .27), 0, 1.22, .01);                         // plate carrier
    add(new THREE.SphereGeometry(.11, 12, 10), 0, 1.62, 0);                          // head
    add(new THREE.SphereGeometry(.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.65, 0); // helmet
    for (const sx of [-1, 1]) {
      add(new THREE.CapsuleGeometry(.075, .72, 4, 8), sx * .1, .48, 0);              // legs
      add(new THREE.CapsuleGeometry(.055, .5, 4, 8), sx * .24, 1.16, -.12, -.9, sx * .1); // arms forward to the weapon
    }
    const geometry = mergeGeometries(parts.map(g => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }))!;
    parts.forEach(g => g.dispose());
    const material = new THREE.MeshStandardMaterial({ color: team === 1 ? '#9a8660' : '#4f5b3e', roughness: .92, metalness: 0 });
    standIn.set(team, hit = { geometry, material });
  }
  return hit;
}
/** Drawn for a player whose soldier model has not downloaded yet (they are never invisible). */
export class StandInSoldier implements SoldierLike {
  root = new THREE.Group(); team: number; private body: THREE.Mesh; private gun = new THREE.Group(); private weapon = ''; private fall = 0;
  constructor(team: number) {
    this.team = team;
    const { geometry, material } = standInParts(team);
    this.body = new THREE.Mesh(geometry, material); this.body.castShadow = true; this.body.receiveShadow = true;
    this.root.add(this.body, this.gun);
  }
  setWeapon(id: string) { if (this.weapon === id) return; const g = weaponThirdPerson(id); if (!g) return; this.weapon = id; this.gun.clear(); this.gun.add(g); }
  update(dt: number, pos: THREE.Vector3, yaw: number, pitch: number, flags: number, dead: boolean) {
    this.root.position.copy(pos); this.root.rotation.set(0, yaw, 0);
    const crouch = !!(flags & 6);
    this.body.scale.y += ((crouch ? .72 : 1) - this.body.scale.y) * Math.min(1, dt * 12);
    this.fall = dead ? Math.min(1, this.fall + dt * 2.4) : 0;
    this.body.rotation.x = this.fall * 1.4;
    this.gun.position.set(.14, (crouch ? .86 : 1.22), -.36); this.gun.rotation.set(pitch, 0, 0); this.gun.visible = !dead;
  }
  dispose() { /* geometry and material are shared per team */ }
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
/** One soldier instance. */
export class Soldier implements SoldierLike {
  root = new THREE.Group(); private rig: THREE.Object3D; private mixer: THREE.AnimationMixer; private actions: Record<string, THREE.AnimationAction> = {};
  private bones: Record<string, THREE.Bone> = {}; private gun: THREE.Group; private flash: THREE.Sprite; private current = 'idle';
  team = -1; weapon = ''; private fall = 0; private lenUpper = .28; private lenFore = .26; private lastPos = new THREE.Vector3(); private speed = 0;
  constructor(kit: Kit, team: number, lib: Library | null, flashTexture: THREE.Texture) {
    this.rig = cloneSkinned(kit.scene);
    this.rig.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.envMapIntensity = .8;
        if (team === 1 && kit.teamB[mat.name]) mat.map = kit.teamB[mat.name];
        m.material = mat;
      }
    });
    this.team = team;
    this.root.add(this.rig);
    this.mixer = new THREE.AnimationMixer(this.rig);
    for (const name of ['idle', 'walk', 'jog', 'run', 'crouch', 'look']) {
      const clip = kit.clips[name]; if (!clip) continue;
      // The clip poses the whole body; near soldiers then have their arms put on the weapon by IK.
      const a = this.mixer.clipAction(clip); a.play(); a.weight = name === 'idle' ? 1 : 0; this.actions[name] = a;
    }
    this.gun = new THREE.Group(); this.root.add(this.gun);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture, color: '#ffcf8a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(.5); this.flash.visible = false; this.root.add(this.flash);
    const b = this.bones;
    if (b.Bip01_R_UpperArm && b.Bip01_R_Forearm && b.Bip01_R_Hand) {
      this.rig.updateMatrixWorld(true);
      this.lenUpper = b.Bip01_R_UpperArm.getWorldPosition(tmpV).distanceTo(b.Bip01_R_Forearm.getWorldPosition(tmpV2));
      this.lenFore = b.Bip01_R_Forearm.getWorldPosition(tmpV).distanceTo(b.Bip01_R_Hand.getWorldPosition(tmpV2));
    }
    void lib;
  }
  setWeapon(id: string) {
    if (this.weapon === id) return;
    const g = weaponThirdPerson(id); if (!g) return; // still downloading: try again next frame
    this.weapon = id; this.gun.clear(); this.gun.add(g);
  }
  /** Pose for this frame. flags: crouch 2, slide 4, sprint 8, ads 16. */
  update(dt: number, pos: THREE.Vector3, yaw: number, pitch: number, flags: number, dead: boolean, flashOn: boolean, ik: boolean) {
    this.root.position.copy(pos);
    // Rocketbox models face +z; the arena's yaw 0 faces −z.
    this.root.rotation.set(0, yaw + Math.PI, 0);
    const v = dt > 0 ? tmpV.copy(pos).sub(this.lastPos).setY(0).length() / dt : 0; this.lastPos.copy(pos);
    this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 8);
    const crouch = !!(flags & 2), slide = !!(flags & 4);
    const target = dead ? this.current : crouch || slide ? 'crouch' : this.speed < .4 ? 'idle' : this.speed < 2.8 ? 'walk' : this.speed < 5.2 ? 'jog' : 'run';
    if (target !== this.current) this.current = target;
    for (const [name, a] of Object.entries(this.actions)) a.weight += ((name === this.current ? 1 : 0) - a.weight) * Math.min(1, dt * 10);
    const base: Record<string, number> = { walk: 1.55, jog: 3.4, run: 5.6 };
    if (base[this.current]) this.actions[this.current].timeScale = THREE.MathUtils.clamp(this.speed / base[this.current], .6, 1.5);
    if (!dead) this.mixer.update(dt);
    // Elimination: fall backwards and settle.
    this.fall = dead ? Math.min(1, this.fall + dt * 2.4) : 0;
    this.rig.rotation.x = -this.fall * 1.45 * (1 - (1 - this.fall) * (1 - this.fall) * .3);
    this.rig.position.y = this.fall * .12;
    this.root.updateMatrixWorld(true);
    // Upper body follows the aim pitch.
    const b = this.bones, spine = b.Bip01_Spine2, head = b.Bip01_Head;
    if (spine && !dead) { spine.rotateOnAxis(tmpV.set(0, 0, 1), -pitch * .5); spine.updateMatrixWorld(true); }
    if (head && !dead) { head.rotateOnAxis(tmpV.set(0, 0, 1), -pitch * .4); head.updateMatrixWorld(true); }
    // The rifle: held at the chest, pointing where the player aims.
    const chest = spine ? spine.getWorldPosition(tmpV2) : tmpV2.set(pos.x, pos.y + 1.35, pos.z);
    const fwd = tmpV.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // Worked out in world space, then expressed in the soldier's own (yawed) frame, since the gun is its child.
    const gunAt = chest.clone().addScaledVector(right, .14).addScaledVector(fwd, .34).add(tmpV2.set(0, dead ? -.5 : -.12, 0));
    this.gun.position.copy(this.root.worldToLocal(gunAt));
    this.gun.quaternion.setFromRotationMatrix(tmpM.lookAt(new THREE.Vector3(), fwd, new THREE.Vector3(0, 1, 0))).premultiply(this.root.getWorldQuaternion(tmpQ).invert()); // −z (the muzzle) along the aim
    this.gun.visible = !dead || this.fall < .5;
    this.gun.updateMatrixWorld(true);
    const muzzle = this.gun.getObjectByName('muzzle');
    this.flash.visible = flashOn && !dead; if (muzzle && this.flash.visible) { muzzle.getWorldPosition(this.flash.position); this.root.worldToLocal(this.flash.position); this.flash.material.rotation = Math.random() * 6; }
    if (ik && !dead) for (const side of ['R', 'L'] as const) {
      const anchor = this.gun.getObjectByName(side === 'R' ? 'gripR' : 'gripL'); if (!anchor) continue;
      this.solveArm(side, anchor.getWorldPosition(new THREE.Vector3()), side === 'R' ? right.clone().multiplyScalar(.3).add(tmpV2.set(0, -.6, 0)) : right.clone().multiplyScalar(-.4).add(tmpV2.set(0, -.6, 0)));
    }
  }
  /** Two-bone IK on the Biped arm (rotations applied in world space, then converted to local). */
  private solveArm(side: 'R' | 'L', target: THREE.Vector3, poleOffset: THREE.Vector3) {
    const up = this.bones[`Bip01_${side}_UpperArm`], fore = this.bones[`Bip01_${side}_Forearm`], hand = this.bones[`Bip01_${side}_Hand`]; if (!up || !fore || !hand) return;
    const s = up.getWorldPosition(new THREE.Vector3()), e = fore.getWorldPosition(new THREE.Vector3()), w = hand.getWorldPosition(new THREE.Vector3());
    const l1 = this.lenUpper, l2 = this.lenFore, d = Math.min(target.distanceTo(s), l1 + l2 - 1e-3), dir = target.clone().sub(s).normalize();
    const pole = s.clone().add(poleOffset), bend = pole.sub(s); bend.sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize();
    const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const elbow = s.clone().addScaledVector(dir, Math.cos(a) * l1).addScaledVector(bend, Math.sin(a) * l1);
    const aim = (bone: THREE.Bone, from: THREE.Vector3, current: THREE.Vector3, want: THREE.Vector3) => {
      const q = tmpQ.setFromUnitVectors(current.clone().sub(from).normalize(), want.clone().sub(from).normalize());
      const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion()), worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ))); bone.updateMatrixWorld(true);
    };
    aim(up, s, e, elbow);
    const e2 = fore.getWorldPosition(new THREE.Vector3()), w2 = hand.getWorldPosition(new THREE.Vector3());
    aim(fore, e2, w2, target);
    void w;
  }
  dispose() { this.mixer.stopAllAction(); this.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); }); }
}
export const soldierModelFor = (num: number) => MODELS[num % MODELS.length];

/**
 * After the match is on screen, fetch the remaining third-person weapon models quietly — but only where it is
 * cheap (not on Low, not with data saver on), so phones download only what they actually see.
 */
export function prefetchRemainingWeapons(allowed: boolean) {
  if (!allowed) return;
  const rest = (WEAPONS as { id: string }[]).map(w => w.id).filter(id => ![...FREE_FIREARMS, 'knife'].includes(id));
  const idle = (cb: () => void) => ((window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(cb);
  let i = 0;
  const next = () => { if (i >= rest.length) return; void preloadWeapon(rest[i++], true, P3).catch(() => null).finally(() => idle(next)); };
  setTimeout(() => idle(next), 8000);
}
