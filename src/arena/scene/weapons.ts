// Combat Arena weapons and first-person arms.
// Models are licensed production assets (see docs/ASSETS.md), normalised by scripts/assets/build-arena.mjs
// into public/assets/arena/weapons/: metres, bore along −z with the muzzle at the origin, named moving
// parts (mag, bolt, slide). This module adds what the art does not carry: where the hands go, where the
// sights are, where brass leaves the gun, and a skin tint.
//   Anchors on every model: muzzle, ejection, gripR, gripL, magwell; userData.sightY / adsZ / hands.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadModel } from '../../world/assets';
import type { FetchOptions } from '../../world/fetcher';
import { SKIN_BY_ID } from '../../../shared/arena/weapons.mjs';

/** Hand placement style: how each hand wraps what it holds. */
type Hold = 'rifle' | 'pistol' | 'blade';
interface Spec {
  grip: [number, number]; fore: [number, number]; sight: [number, number]; mag: [number, number];
  eject: [number, number, number] | null; eye: number; hold: Hold;
  /** Red-dot optics: z of the emitter window, where the reticle is drawn. */
  dot?: number;
}
// Measured from the normalised models (y up from the bore, z back from the muzzle, metres).
const SPECS: Record<string, Spec> = {
  m7: { grip: [-.09, .69], fore: [-.035, .4], sight: [.104, .6], mag: [-.13, .58], eject: [.035, .0, .61], eye: .22, hold: 'rifle', dot: .51 },
  vanguard: { grip: [-.09, .58], fore: [-.035, .3], sight: [.0685, .41], mag: [-.12, .38], eject: [.025, 0, .5], eye: .26, hold: 'rifle', dot: .35 },
  halcyon: { grip: [-.09, .66], fore: [-.03, .38], sight: [.053, .4], mag: [-.12, .48], eject: [.025, .01, .55], eye: .17, hold: 'rifle' },
  wasp: { grip: [-.1, .39], fore: [-.03, .14], sight: [.071, .285], mag: [-.12, .17], eject: [.025, .02, .3], eye: .26, hold: 'rifle', dot: .25 },
  kestrel: { grip: [-.075, .55], fore: [-.03, .3], sight: [.122, .47], mag: [-.13, .42], eject: [.03, .04, .45], eye: .26, hold: 'rifle', dot: .405 },
  bastion: { grip: [-.08, .68], fore: [-.035, .32], sight: [.03, .55], mag: [-.04, .5], eject: [.025, 0, .55], eye: .17, hold: 'rifle' },
  rampart: { grip: [-.08, .7], fore: [-.04, .34], sight: [.045, .58], mag: [-.04, .52], eject: [.03, 0, .55], eye: .17, hold: 'rifle' },
  longbow: { grip: [-.1, .78], fore: [-.035, .45], sight: [.1, .86], mag: [-.1, .66], eject: [.03, .02, .7], eye: .1, hold: 'rifle' },
  talon: { grip: [-.1, .76], fore: [-.035, .42], sight: [.11, .8], mag: [-.1, .58], eject: [.03, .02, .68], eye: .1, hold: 'rifle' },
  anvil: { grip: [-.08, .7], fore: [-.05, .36], sight: [.058, .71], mag: [-.12, .55], eject: [.03, 0, .62], eye: .16, hold: 'rifle' },
  sparrow: { grip: [-.072, .165], fore: [-.088, .155], sight: [.008, .19], mag: [-.1, .16], eject: [.012, 0, .12], eye: .45, hold: 'pistol' },
  thorn: { grip: [-.088, .2], fore: [-.1, .19], sight: [.012, .18], mag: [-.03, .1], eject: null, eye: .45, hold: 'pistol' },
  knife: { grip: [.03, .26], fore: [-.3, .3], sight: [0, .2], mag: [-.3, .3], eject: null, eye: .3, hold: 'blade' },
  hammer: { grip: [.085, .33], fore: [-.3, .4], sight: [0, .25], mag: [-.3, .4], eject: null, eye: .3, hold: 'blade' },
};
const specOf = (id: string) => SPECS[id] ?? SPECS.vanguard;
const MOVING = ['mag', 'bolt', 'slide', 'pump', 'cylinder'];

const loads = new Map<string, Promise<THREE.Group>>(), ready = new Map<string, THREE.Group>();
/** On-demand downloads (a weapon first seen in someone's hands) are priority 2: nearby detail. */
const ON_DEMAND: FetchOptions = { priority: 2, retries: 3, stallMs: 20000, timeoutMs: 180000 };
function request(file: string, fetch: FetchOptions = ON_DEMAND) {
  let p = loads.get(file);
  if (!p) {
    p = loadModel(`arena/weapons/${file}.glb`, fetch).then(g => {
      g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; const mat = m.material as THREE.MeshStandardMaterial; mat.envMapIntensity = 1; } });
      ready.set(file, g.scene); return g.scene;
    });
    p.catch(() => loads.delete(file)); loads.set(file, p);
  }
  return p;
}
/** Start downloading a weapon (and its third-person LOD). Resolves when the first-person model is usable. */
export function preloadWeapon(id: string, lod = false, fetch?: FetchOptions) { return request(lod ? `${id}-lod` : id, fetch); }
/** Skin-tinted materials and parsed models (released with a match's renderer). */
export const weaponResources = () => ({ materials: [...tints.values()], scenes: [...ready.values()] });
/** Leaving the arena: forget the parsed models (the HTTP cache keeps the files). */
export function releaseWeapons() { loads.clear(); ready.clear(); tints.forEach(m => m.dispose()); tints.clear(); armsLoad = null; }
export function weaponLoaded(id: string, lod = false) { return ready.has(lod ? `${id}-lod` : id); }

const tints = new Map<string, THREE.Material>();
/** A skin is a tint over the photographed finish, so wear and markings survive. */
function skinned(mat: THREE.Material, skin: string) {
  if (skin === 'standard' || !SKIN_BY_ID.get(skin)) return mat;
  const key = mat.uuid + skin; let hit = tints.get(key);
  if (!hit) {
    const m = (mat as THREE.MeshStandardMaterial).clone(), [base] = SKIN_BY_ID.get(skin)!.colors as [string, string];
    m.color.set(base).convertSRGBToLinear().lerp(new THREE.Color(1, 1, 1), .25).multiplyScalar(2.2); hit = m; tints.set(key, m);
  }
  return hit;
}
function anchor(g: THREE.Object3D, name: string, x: number, y: number, z: number) { const a = new THREE.Object3D(); a.name = name; a.position.set(x, y, z); g.add(a); return a; }

/**
 * A weapon in the viewmodel frame: forward −z, origin 8.5 cm ahead of the pistol grip (where the old
 * procedural receivers sat, so the hip and aim poses carry over). Null until the model has downloaded.
 */
export function weaponModel(id: string, skin = 'standard', lod = false): THREE.Group | null {
  const src = ready.get(lod ? `${id}-lod` : id); if (!src) { void request(lod ? `${id}-lod` : id); return null; }
  const s = specOf(id), o = s.grip[1] - .085, g = new THREE.Group(), inner = src.clone(true);
  inner.position.z = -o; g.add(inner);
  inner.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh) m.material = skinned(m.material as THREE.Material, skin); });
  // Moving parts (named by the build) are found by name; remember where they rest.
  for (const name of MOVING) { const p = inner.getObjectByName(name); if (p) p.userData.rest = p.position.clone(); }
  const at = (yz: [number, number]) => [yz[0], yz[1] - o] as const;
  anchor(g, 'muzzle', 0, 0, -o);
  const [gy, gz] = at(s.grip), [fy, fz] = at(s.fore), [my, mz] = at(s.mag), [sy, sz] = at(s.sight);
  anchor(g, 'gripR', 0, gy, gz); anchor(g, 'gripL', s.hold === 'pistol' ? -.012 : 0, fy, fz); anchor(g, 'magwell', 0, my, mz);
  if (s.eject) anchor(g, 'ejection', s.eject[0], s.eject[1], s.eject[2] - o);
  if (s.dot != null) {
    // The illuminated dot: drawn over everything, shown only on the sights (see the viewmodel).
    const dot = new THREE.Group(); dot.name = 'reticle'; dot.position.set(0, sy, s.dot - o); dot.visible = false; dot.renderOrder = 20;
    const core = new THREE.Mesh(new THREE.CircleGeometry(.0006, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, .35, .25), toneMapped: false, depthTest: false, transparent: true }));
    const halo = new THREE.Mesh(new THREE.CircleGeometry(.0016, 20), new THREE.MeshBasicMaterial({ color: '#ff3a24', toneMapped: false, depthTest: false, transparent: true, opacity: .28, blending: THREE.AdditiveBlending }));
    core.renderOrder = halo.renderOrder = 20; dot.add(halo, core); g.add(dot);
  }
  g.userData.sightY = sy;
  // Aim: rear sight `eye` metres ahead of the eye.
  g.userData.adsZ = -s.eye - sz;
  g.userData.hold = s.hold;
  return g;
}
// Geometry/materials from GLTF and skin tints belong to the shared asset cache.
// Reticles are instance-owned and must be released when a preview or held weapon changes.
export function disposeWeapon(g: THREE.Object3D) {
  const reticle = g.getObjectByName('reticle');
  reticle?.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  g.removeFromParent();
}
/** The simplified model for other players: a few hundred to a few thousand triangles. */
export function weaponThirdPerson(id: string) { return weaponModel(id, 'standard', true); }

// ---------------------------------------------------------------- first-person arms
/** Hand frames in the weapon's own axes: f = wrist → knuckles, p = palm normal. */
const HANDS: Record<Hold, { R: Hand; L: Hand }> = {
  // Right hand round the pistol grip, thumb over the left side; left hand under the handguard, palm up,
  // thumb along the left side and fingers wrapped up the right.
  rifle: { R: { f: [-.35, -.42, -.84], p: [-.9, .1, .35], curl: 1 }, L: { f: [.5, .15, -.85], p: [-.25, .95, .05], curl: .8 } },
  // Support hand cups the firing hand.
  pistol: { R: { f: [-.3, -.35, -.88], p: [-.92, .1, .3], curl: 1 }, L: { f: [.3, -.6, -.75], p: [.85, .25, .25], curl: .8 } },
  blade: { R: { f: [-.9, .37, .22], p: [.42, .77, .45], curl: 1.1 }, L: { f: [.5, .15, -.85], p: [-.25, .95, .05], curl: .4 } },
};
/** The support hand reaching for a magazine: fingers down, palm toward the magazine. */
const MAG_HAND: Hand = { f: [.1, -.95, -.2], p: [.25, .15, -.95], curl: .7 };
interface Hand { f: number[]; p: number[]; curl: number }
const ARM_SCALE = .0105;
/** Viewmodel arms are longer than life (the camera sits ahead of the shoulders); hands stay life-size. */
const UPPER_STRETCH = 1.32, FORE_STRETCH = 1.27;
/** Shoulder midpoint in camera space and the stance turn (left shoulder forward, as when shouldering a rifle). */
const SHOULDERS = new THREE.Vector3(0, -.3, -.03), STANCE = -.3;
let armsLoad: Promise<THREE.Group> | null = null;
export function preloadArms(fetch?: FetchOptions) { const p = (armsLoad ??= loadModel('arena/weapons/arms.glb', fetch).then(g => g.scene)); p.catch(() => { if (armsLoad === p) armsLoad = null; }); return p; }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
interface Side {
  upper: THREE.Bone; fore: THREE.Bone; wrist: THREE.Bone; fingers: THREE.Bone[][]; l1: number; l2: number; handLen: number;
  bindBasis: THREE.Matrix4; bindWrist: THREE.Quaternion; sign: 1 | -1;
}
/** Rigged, gloved first-person arms posed every frame by two-bone IK, with fingers wrapped to the grip. */
export class FirstPersonArms {
  root: THREE.Object3D; private side: Record<'R' | 'L', Side>;
  constructor(src: THREE.Group, team: number) {
    this.root = cloneSkinned(src);
    // The rig faces +z in centimetres: turn it to face −z (the camera's forward) and scale to metres.
    this.root.rotation.y = Math.PI + STANCE; this.root.scale.setScalar(ARM_SCALE); this.root.updateMatrixWorld(true);
    const tint = new THREE.Color(team === 1 ? '#d8c6a4' : '#c2cbb0');
    this.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isMesh) { m.frustumCulled = false; const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.color.multiply(tint); m.material = mat; } });
    this.root.updateMatrixWorld(true);
    const bones: THREE.Bone[] = []; this.root.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    const find = (re: RegExp) => bones.find(b => re.test(b.name))!;
    for (const S of ['L', 'R']) { find(new RegExp(`^${S}_elbow`)).position.multiplyScalar(UPPER_STRETCH); find(new RegExp(`^${S}_wrist`)).position.multiplyScalar(FORE_STRETCH); }
    this.root.updateMatrixWorld(true);
    const mid = find(/^L_arm/).getWorldPosition(new THREE.Vector3()).add(find(/^R_arm/).getWorldPosition(new THREE.Vector3())).multiplyScalar(.5);
    this.root.position.copy(SHOULDERS).sub(mid); this.root.updateMatrixWorld(true);
    const make = (S: 'R' | 'L'): Side => {
      const upper = find(new RegExp(`^${S}_arm`)), fore = find(new RegExp(`^${S}_elbow`)), wrist = find(new RegExp(`^${S}_wrist`));
      const fingers = ['point', 'middle', 'ring', 'pink'].map(f => [1, 2, 3].map(i => bones.find(b => b.name.startsWith(`${S}_${f}${i}`))!).filter(Boolean));
      const w = wrist.getWorldPosition(new THREE.Vector3()), mid = fingers[1][0].getWorldPosition(new THREE.Vector3()), th = find(new RegExp(`^${S}_thumb1`)).getWorldPosition(new THREE.Vector3());
      const f = mid.clone().sub(w), handLen = f.length(); f.normalize();
      const t = th.sub(w); t.addScaledVector(f, -t.dot(f)).normalize();
      // Right hand: palm = −(f × thumb); left hand mirrors it.
      const sign = S === 'R' ? -1 : 1, p = new THREE.Vector3().crossVectors(f, t).multiplyScalar(sign);
      const bindBasis = new THREE.Matrix4().makeBasis(f, p, new THREE.Vector3().crossVectors(f, p));
      return {
        upper, fore, wrist, fingers, handLen, bindBasis, bindWrist: wrist.getWorldQuaternion(new THREE.Quaternion()), sign,
        l1: upper.getWorldPosition(_a).distanceTo(fore.getWorldPosition(_b)), l2: fore.getWorldPosition(_a).distanceTo(w),
      };
    };
    this.side = { R: make('R'), L: make('L') };
    // Remember the bind pose so every frame starts from it.
    for (const b of bones) b.userData.bind = b.quaternion.clone();
  }
  private reset() { this.root.traverse(o => { const b = o as THREE.Bone; if (b.isBone && b.userData.bind) b.quaternion.copy(b.userData.bind as THREE.Quaternion); }); this.root.updateMatrixWorld(true); }
  /**
   * Pose both hands. `grip` positions are palm centres in camera space; `frame` rotates the hold's
   * hand frames (normally the weapon's orientation); `pole` pushes the elbows.
   */
  pose(hold: Hold, gripR: THREE.Vector3, gripL: THREE.Vector3, frame: THREE.Quaternion, reachL = 0) {
    this.reset();
    const h = HANDS[hold];
    this.solve('R', gripR, h.R, frame, _e.set(.9, -1, .2), 1);
    const k = THREE.MathUtils.clamp(reachL, 0, 1), L = k <= 0 ? h.L : { f: h.L.f.map((v, i) => v + (MAG_HAND.f[i] - v) * k), p: h.L.p.map((v, i) => v + (MAG_HAND.p[i] - v) * k), curl: h.L.curl + (MAG_HAND.curl - h.L.curl) * k };
    this.solve('L', gripL, L, frame, _e.set(-.9, -1, .1), 1);
  }
  private solve(S: 'R' | 'L', palm: THREE.Vector3, hand: Hand, frame: THREE.Quaternion, poleDir: THREE.Vector3, curlK: number) {
    const s = this.side[S];
    const f = _a.fromArray(hand.f).normalize().applyQuaternion(frame), p = _b.fromArray(hand.p);
    p.applyQuaternion(frame); p.addScaledVector(f, -p.dot(f)).normalize();
    const f0 = f.clone(), p0 = p.clone();
    // Wrist sits behind the knuckles and off the palm.
    const target = _c.copy(palm).addScaledVector(f0, -s.handLen * .55).addScaledVector(p0, -.022);
    // Two-bone IK.
    const sh = s.upper.getWorldPosition(new THREE.Vector3()), d = Math.min(target.distanceTo(sh), s.l1 + s.l2 - 1e-4), dir = target.clone().sub(sh).normalize();
    const bend = poleDir.clone(); bend.addScaledVector(dir, -bend.dot(dir)).normalize();
    const a = Math.acos(THREE.MathUtils.clamp((s.l1 * s.l1 + d * d - s.l2 * s.l2) / (2 * s.l1 * d), -1, 1));
    const elbow = sh.clone().addScaledVector(dir, Math.cos(a) * s.l1).addScaledVector(bend, Math.sin(a) * s.l1);
    const wristAt = sh.clone().addScaledVector(dir, d);
    this.aim(s.upper, sh, s.fore.getWorldPosition(new THREE.Vector3()), elbow);
    this.aim(s.fore, s.fore.getWorldPosition(new THREE.Vector3()), s.wrist.getWorldPosition(new THREE.Vector3()), wristAt);
    // Wrist orientation: map the bind hand frame onto the wanted one.
    const want = _m.makeBasis(f0, p0, _d.crossVectors(f0, p0)).multiply(_m2.copy(s.bindBasis).transpose());
    const world = new THREE.Quaternion().setFromRotationMatrix(want).multiply(s.bindWrist);
    // Share the wrist's roll with the forearm (as a real radius/ulna does), so the sleeve twists, not the joint.
    const local = s.fore.getWorldQuaternion(_q).invert().multiply(world), rollAxis = _d.copy(s.wrist.position).normalize();
    const proj = rollAxis.multiplyScalar(rollAxis.dot(_e.set(local.x, local.y, local.z)));
    const twist = _q2.set(proj.x, proj.y, proj.z, local.w).normalize();
    s.fore.quaternion.multiply(new THREE.Quaternion().slerp(twist, .6)); s.fore.updateMatrixWorld(true);
    this.setWorld(s.wrist, world);
    // Fingers wrap toward the palm.
    const axis = _d.crossVectors(f0, p0).normalize(), amounts = [.9, 1.0, .7];
    for (const chain of s.fingers) chain.forEach((b, i) => { const wq = b.getWorldQuaternion(_q2); this.setWorld(b, new THREE.Quaternion().setFromAxisAngle(axis, amounts[i] * hand.curl * curlK).multiply(wq)); });
  }
  private aim(bone: THREE.Bone, from: THREE.Vector3, current: THREE.Vector3, want: THREE.Vector3) {
    const q = new THREE.Quaternion().setFromUnitVectors(current.clone().sub(from).normalize(), want.clone().sub(from).normalize());
    this.setWorld(bone, q.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
  }
  private setWorld(bone: THREE.Object3D, world: THREE.Quaternion) {
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world)); bone.updateMatrixWorld(true);
  }
  set visible(v: boolean) { this.root.visible = v; }
  dispose() { this.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); }); }
}
