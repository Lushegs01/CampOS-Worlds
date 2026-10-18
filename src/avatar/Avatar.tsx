import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AvatarConfig, Gesture, SitState } from '../state';
import { assetUrl, cached, forgetOnFailure, loadModel, suspend } from '../world/assets';
import { SEAT_BY_ID } from '../../shared/interactions.mjs';
import { BALL_R, floorAt } from '../../shared/ball.mjs';
import { avatars } from './registry';
import { registerMovingCaster } from '../world/shadows';
import { chairScrape, footstep, jump, land, sitDown, standUp } from '../audio/foley';

// Realistic, rigged students from the Microsoft Rocketbox library (MIT), converted by
// scripts/assets/build-characters.mjs. Motion-captured clips are blended by speed on a shared,
// phase-aligned gait cycle. Seating uses the captured sit-down / stand-up transitions; holding,
// shooting and dribbling layer arm-only clips over locomotion; jumps and turns are procedural.

export interface CharacterInfo { id: string; name: string; body: 'm' | 'f'; style: string; skinRef: [number, number, number]; height: number; hip: number; source: string }
interface Manifest { characters: CharacterInfo[]; animations: Record<'m' | 'f', { speeds: Record<string, number>; rootHeight: number }> }
let manifest: Promise<Manifest> | null = null;
export const loadCharacterManifest = (): Promise<Manifest> => manifest ??= fetch(assetUrl('characters/manifest.json')).then(r => { if (!r.ok) throw Error(`manifest ${r.status}`); return r.json(); }).catch(e => { setTimeout(() => { manifest = null; }, 5000); throw e; });

export interface AvatarMotion {
  speed: number; y: number; vy: number; emote?: string; emoteUntil?: number; turn?: number;
  vehicleSeatHeight?:number|null; sit?: SitState | null; gesture?: Gesture | null; holding?: boolean; charge?: number | null; release?: number;
}

const LOCO = ['walk', 'jog', 'run'] as const;
/** A transition clip whose horizontal root travel is replayed on the rig instead of the bones. */
interface Transition { start: number; end: number; times: Float32Array; xs: Float32Array; zs: Float32Array; endX: number; endZ: number; rate: number }
interface Library {
  clips: Record<string, THREE.AnimationClip>; contact: Record<string, number>; speeds: Record<string, number>;
  down: Transition; up: Transition; seatHeight: number; tableSeatHeight: number; armsUpTime: number;
}
const libraries = new Map<string, Promise<Library>>();
const ARMS = /^Bip01_[LR]_(Clavicle|UpperArm|Forearm|Hand|Finger\d*)\./, LEFT_ARM = /^Bip01_L_(Clavicle|UpperArm|Forearm|Hand|Finger\d*)\./;

function extractTransition(clip: THREE.AnimationClip): Transition {
  const track = clip.tracks.find(t => t.name === 'Bip01.position')!, n = track.times.length, xs = new Float32Array(n), zs = new Float32Array(n), v = track.values;
  for (let i = 0; i < n; i++) { xs[i] = v[i * 3]; zs[i] = v[i * 3 + 2]; v[i * 3] = 0; v[i * 3 + 2] = 0; }
  // Active window: where the root actually travels (the captures include idle lead-in and tail).
  let first = -1, last = -1;
  for (let i = 1; i < n; i++) { const dt = Math.max(1e-4, track.times[i] - track.times[i - 1]), sp = Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1], v[i * 3 + 1] - v[(i - 1) * 3 + 1]) / dt; if (sp > .05) { if (first < 0) first = i - 1; last = i; } }
  const start = Math.max(0, track.times[Math.max(0, first)] - .12), end = Math.min(clip.duration, track.times[Math.max(0, last)] + .18);
  const tr: Transition = { start, end, times: track.times as Float32Array, xs, zs, endX: 0, endZ: 0, rate: THREE.MathUtils.clamp((end - start) / 2, 1, 1.75) };
  [tr.endX, tr.endZ] = curveAt(tr, end);
  return tr;
}
function curveAt(tr: Transition, t: number): [number, number] {
  const { times, xs, zs } = tr; if (t <= times[0]) return [xs[0], zs[0]];
  for (let i = 1; i < times.length; i++) if (times[i] >= t) { const k = (t - times[i - 1]) / Math.max(1e-6, times[i] - times[i - 1]); return [xs[i - 1] + (xs[i] - xs[i - 1]) * k, zs[i - 1] + (zs[i] - zs[i - 1]) * k]; }
  return [xs[xs.length - 1], zs[zs.length - 1]];
}
const rootY = (clip: THREE.AnimationClip) => clip.tracks.find(t => t.name === 'Bip01.position')!.values[1];

/** Load the clip library for a body type: gait contact phases, seat transitions and arm layers. */
function loadLibrary(body: 'm' | 'f', probe: GLTF): Promise<Library> {
  let p = libraries.get(body);
  if (!p) {
    p = Promise.all([loadModel(`characters/anim-${body}.glb`), loadCharacterManifest()]).then(([anim, info]) => {
      const clips: Record<string, THREE.AnimationClip> = {};
      for (const clip of anim.animations) clips[clip.name] = clip;
      const down = extractTransition(clips.sitDown), up = extractTransition(clips.standUp);
      clips.holdArms = new THREE.AnimationClip('holdArms', clips.holdFront.duration, clips.holdFront.tracks.filter(t => ARMS.test(t.name)));
      clips.leftHold = new THREE.AnimationClip('leftHold', clips.holdFront.duration, clips.holdFront.tracks.filter(t => LEFT_ARM.test(t.name)));
      clips.armsUp = new THREE.AnimationClip('armsUp', clips.cheer.duration, clips.cheer.tracks.filter(t => ARMS.test(t.name)));
      const contact: Record<string, number> = {};
      const rig = cloneSkinned(probe.scene), mixer = new THREE.AnimationMixer(rig), foot = rig.getObjectByName('Bip01_L_Foot')!, hips = rig.getObjectByName('Bip01')!, hand = rig.getObjectByName('Bip01_R_Hand')!, left = rig.getObjectByName('Bip01_L_Hand')!;
      const fp = new THREE.Vector3(), hp = new THREE.Vector3();
      for (const name of LOCO) {
        const action = mixer.clipAction(clips[name]).play(); let best = Infinity, at = 0;
        for (let i = 0; i < 48; i++) {
          const t = clips[name].duration * i / 48; action.time = t; mixer.update(0); rig.updateMatrixWorld(true);
          foot.getWorldPosition(fp); hips.getWorldPosition(hp);
          // Contact: the foot is lowest and furthest forward relative to the hips.
          const score = fp.y * 4 - (fp.z - hp.z); if (score < best) { best = score; at = i / 48; }
        }
        contact[name] = at; action.stop();
      }
      // The moment in the cheer capture with both hands highest: the shot's set pose.
      let armsUpTime = 0, top = -Infinity; const cheer = mixer.clipAction(clips.cheer).play();
      for (let i = 0; i < 40; i++) { const t = clips.cheer.duration * i / 40; cheer.time = t; mixer.update(0); rig.updateMatrixWorld(true); const y = Math.min(hand.getWorldPosition(fp).y, left.getWorldPosition(hp).y); if (y > top) { top = y; armsUpTime = t; } }
      cheer.stop(); mixer.uncacheRoot(rig);
      // Seat height implied by the captures: seated pelvis ~14 cm above the chair surface.
      return { clips, contact, speeds: info.animations[body].speeds, down, up, seatHeight: rootY(clips.sitIdle) - .14, tableSeatHeight: rootY(clips.sitTable) - .14, armsUpTime };
    });
    libraries.set(body, forgetOnFailure(libraries, body, p));
  }
  return p;
}

const skinCache = new Map<string, THREE.Vector3>();
function skinTint(target: string, ref: [number, number, number]) {
  const key = target + ref.join(','); let v = skinCache.get(key);
  if (!v) {
    if (target === 'natural') v = new THREE.Vector3(1, 1, 1);
    else { const c = new THREE.Color(target); v = new THREE.Vector3(c.r / ref[0], c.g / ref[1], c.b / ref[2]).clampScalar(.18, 3.2); }
    skinCache.set(key, v);
  }
  return v;
}

/** Skin-tone shift driven by the baked skin mask in the roughness map's red channel. */
function patchMaterial(material: THREE.MeshStandardMaterial, uniforms: { uSkinTint: { value: THREE.Vector3 } }) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uSkinTint = uniforms.uSkinTint;
    shader.fragmentShader = 'uniform vec3 uSkinTint;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_ROUGHNESSMAP
        float skinMask = smoothstep(.25, .75, texture2D(roughnessMap, vRoughnessMapUv).r);
        diffuseColor.rgb *= mix(vec3(1.), uSkinTint, skinMask);
      #endif`);
  };
  material.customProgramCacheKey = () => 'avatar-skin';
}

function accessoryMeshes(kind: string, accent: string) {
  const group = new THREE.Group(), color = new THREE.Color(accent); group.userData.accessory = true; // disposed by its own effect
  const fabric = new THREE.MeshStandardMaterial({ color, roughness: .85 }), dark = new THREE.MeshStandardMaterial({ color: '#1e2124', roughness: .5, metalness: .3 });
  if (kind === 'backpack') {
    // Daypack in the avatar's local frame (+Z is the wearer's front, so the pack sits at -Z).
    const body = new THREE.Mesh(new RoundedBoxGeometry(.31, .42, .15, 4, .06), fabric);
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(.24, .17, .06, 3, .025), fabric); pocket.position.set(0, -.1, -.09);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(.25, .012, .012), dark); trim.position.set(0, -.015, -.12);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(.035, .008, 6, 16, Math.PI), dark); handle.position.set(0, .21, .01);
    group.add(body, pocket, trim, handle);
    // Shoulder straps curve over the shoulders and down the chest.
    for (const x of [-.085, .085]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, .17, .05), new THREE.Vector3(x * 1.1, .27, .16), new THREE.Vector3(x * 1.2, .24, .3), new THREE.Vector3(x * 1.3, .04, .335), new THREE.Vector3(x * 1.3, -.17, .3)]);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, .014, 5).scale(1, 1, 1), dark));
    }
  } else if (kind === 'headphones') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(.105, .012, 8, 32, Math.PI), dark); band.rotation.y = Math.PI / 2;
    group.add(band);
    for (const z of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .03, 20).rotateX(Math.PI / 2), fabric); cup.position.set(0, -.005, z * .1); group.add(cup); }
  } else if (kind === 'glasses') {
    for (const x of [-1, 1]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(.027, .0035, 6, 24).scale(1.15, 1, 1), dark); rim.position.set(x * .033, 0, 0); group.add(rim); }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(.016, .004, .004), dark); group.add(bridge);
    for (const x of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(.003, .004, .1), dark); arm.position.set(x * .064, .004, -.05); group.add(arm); }
    const lens = new THREE.MeshStandardMaterial({ color: '#9bb', roughness: .05, transparent: true, opacity: .18 });
    for (const x of [-1, 1]) { const l = new THREE.Mesh(new THREE.CircleGeometry(.026, 20).scale(1.15, 1, 1), lens); l.position.set(x * .033, 0, .001); group.add(l); }
  }
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return group;
}


interface Rig { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction>; bones: Record<string, THREE.Bone>; rest: Map<string, THREE.Matrix4>; uniforms: { uSkinTint: { value: THREE.Vector3 } }; info: CharacterInfo; lib: Library; accessory: THREE.Object3D | null }

const TMP_Q = new THREE.Quaternion(), AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);
const rotate = (bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number) => { if (bone && angle) bone.quaternion.multiply(TMP_Q.setFromAxisAngle(axis, angle)); };
// Clips whose playback time the frame loop sets directly (gait phase, transitions, frozen poses).
const SCRUBBED = [...LOCO, 'sitDown', 'standUp', 'holdArms', 'leftHold', 'armsUp', 'doorPush', 'doorPull'];

function useRig(config: AvatarConfig): Rig {
  const all = suspend(loadCharacterManifest());
  const info = all.characters.find(c => c.id === config.model) ?? all.characters[0];
  const gltf = suspend(loadModel(`characters/${info.id}.glb`));
  const lib = suspend(cached(`clips:${info.id}`, () => loadModel(`characters/${info.id}.glb`).then(g => loadLibrary(info.body, g))));
  const rig = useMemo<Rig>(() => {
    const root = cloneSkinned(gltf.scene);
    const uniforms = { uSkinTint: { value: new THREE.Vector3(1, 1, 1) } };
    root.traverse(o => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (m.alphaTest > 0) { m.alphaTest = .4; m.side = THREE.DoubleSide; } else patchMaterial(m, uniforms);
      m.envMapIntensity = .85;
      mesh.material = m;
    });
    const bones: Record<string, THREE.Bone> = {};
    root.traverse(o => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
    // The glTF node transforms are the Y-up rest pose (the inverse-bind matrices are in the
    // original Z-up mesh space, so skeleton.pose() is not a usable reference for attachments).
    const rest = new Map<string, THREE.Matrix4>(); gltf.scene.traverse(o => { if ((o as THREE.Bone).isBone) rest.set(o.name, new THREE.Matrix4().compose(o.position, o.quaternion, o.scale)); });
    const mixer = new THREE.AnimationMixer(root), actions: Record<string, THREE.AnimationAction> = {};
    for (const [name, clip] of Object.entries(lib.clips)) actions[name] = mixer.clipAction(clip);
    for (const n of SCRUBBED) actions[n].timeScale = 0;
    actions.armsUp.time = lib.armsUpTime;
    return { root, mixer, actions, bones, rest, uniforms, info, lib, accessory: null };
  }, [gltf, lib]);
  // (Re)start every clip on mount; StrictMode runs this cleanup once in development, so the
  // cleanup only stops actions and never uncaches the bindings the rig still owns.
  // Cleanup also releases the rig's own GPU resources (cloned materials, the skeleton's bone texture);
  // three.js re-creates them if the rig is shown again, as StrictMode does in development.
  useEffect(() => { for (const [name, a] of Object.entries(rig.actions)) { a.play(); a.setEffectiveWeight(name === 'idle' ? 1 : 0); } rig.actions.armsUp.time = rig.lib.armsUpTime;
    return () => { rig.mixer.stopAllAction(); rig.root.traverse(o => { const mesh = o as THREE.SkinnedMesh; if (!mesh.isMesh || o.parent?.userData.accessory) return; (mesh.material as THREE.Material).dispose(); if (mesh.isSkinnedMesh) mesh.skeleton.dispose(); }); }; }, [rig]);
  // Customization: skin tone uniform and accessory attached to a bone in bind pose.
  useEffect(() => { rig.uniforms.uSkinTint.value.copy(skinTint(config.skin, rig.info.skinRef)); }, [rig, config.skin]);
  useEffect(() => {
    if (config.accessory === 'none') return;
    const boneName = config.accessory === 'backpack' ? 'Bip01_Spine2' : 'Bip01_Head', bone = rig.bones[boneName]; if (!bone) return;
    const mesh = accessoryMeshes(config.accessory, config.accent);
    // Author the accessory against the rest pose in the rig's space, then re-parent it to the bone.
    const saved = Object.values(rig.bones).map(b => [b, b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
    for (const b of Object.values(rig.bones)) rig.rest.get(b.name)?.decompose(b.position, b.quaternion, b.scale);
    const savedRoot = rig.root.position.clone(); rig.root.position.set(0, 0, 0);
    rig.root.updateMatrixWorld(true);
    // Work in the rig's own space: the avatar's parent may be rotated or moved.
    const anchor = rig.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const female = rig.info.body === 'f';
    if (config.accessory === 'backpack') mesh.position.set(0, anchor.y - .08, anchor.z - (female ? .17 : .19));
    else if (config.accessory === 'headphones') mesh.position.set(0, anchor.y + .1, anchor.z + .005);
    else mesh.position.set(0, anchor.y + .065, anchor.z + (female ? .095 : .1));
    rig.root.add(mesh); rig.root.updateMatrixWorld(true); bone.attach(mesh);
    for (const [b, p, q, s] of saved) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(s); }
    rig.root.position.copy(savedRoot);
    rig.accessory = mesh;
    return () => { mesh.removeFromParent(); mesh.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); rig.accessory = null; };
  }, [rig, config.accessory, config.accent]);
  return rig;
}

let contactTexture: THREE.Texture | null = null;
/** Soft radial contact shadow that anchors feet to the ground on every quality tier. */
function contactShadowMaterial() {
  if (!contactTexture) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); for (let i = 0; i <= 8; i++) { const t = i / 8; g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, 2.2).toFixed(3)})`); }
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); contactTexture = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: contactTexture, transparent: true, opacity: .3, depthWrite: false, toneMapped: false });
}

const smooth = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const FRUSTUM = new THREE.Frustum(), VIEW = new THREE.Matrix4(), BOUNDS = new THREE.Sphere(new THREE.Vector3(), 1.8);
let frustumAt = -1;
/** 0: outside the view; otherwise pose the skeleton every n-th frame (1 near, 2 beyond 30 m, 4 beyond 60 m). */
function avatarLod(root: THREE.Object3D, camera: THREE.Camera, frame: number) {
  // One frustum per frame for every avatar. The camera's matrices are refreshed first: at 2 FPS last
  // frame's view can be turned far enough that someone now in front of the camera would be skipped.
  if (frustumAt !== frame) { frustumAt = frame; camera.updateMatrixWorld(); FRUSTUM.setFromProjectionMatrix(VIEW.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); }
  const e = (root.parent ?? root).matrixWorld.elements; BOUNDS.center.set(e[12], e[13] + 1, e[14]);
  if (!FRUSTUM.intersectsSphere(BOUNDS)) return 0;
  const d = BOUNDS.center.distanceTo(camera.position);
  return d > 60 ? 4 : d > 30 ? 2 : 1;
}
/**
 * Textures of other players' characters waiting for the GPU. A character behind the camera is not drawn,
 * so without this its textures were uploaded the first time someone turned towards it: a long frame on a
 * phone, just as a newcomer came into view. They are uploaded when the character arrives, one per frame.
 */
const pendingUploads: THREE.Texture[] = [], queuedUploads = new WeakSet<THREE.Texture>();
let uploadAt = -1;
function queueUploads(root: THREE.Object3D) {
  root.traverse(o => {
    const material = (o as THREE.Mesh).material as THREE.Material | undefined; if (!material) return;
    for (const value of Object.values(material)) { const t = value as THREE.Texture; if (t?.isTexture && !queuedUploads.has(t)) { queuedUploads.add(t); pendingUploads.push(t); } }
  });
}
/** How far each table chair is pulled back from the table (1 = pulled out, 0 = tucked in), by seat id. */
export const chairPull = new Map<string, number>();
const SCOOT = .6;
const GESTURE: Record<string, { clip: string; from: number; to: number }> = { 'door-push': { clip: 'doorPush', from: .1, to: 1.9 }, 'door-pull': { clip: 'doorPull', from: .1, to: 1.9 }, pickup: { clip: 'crouch', from: 0, to: .8 } };
const HAND_L = new THREE.Vector3(), HAND_R = new THREE.Vector3(), FWD = new THREE.Vector3(), RIGHT = new THREE.Vector3(), WQ = new THREE.Quaternion(), WP = new THREE.Vector3(), BOUNCE = new THREE.Vector3();

export default function Avatar({ config, motion, preview = false, id }: { config: AvatarConfig; motion?: () => AvatarMotion; preview?: boolean; id?: string }) {
  const rig = useRig(config);
  const contact = useRef<THREE.Mesh>(null!), contactMat = useMemo(contactShadowMaterial, []);
  const state = useRef({
    phase: 0, weights: { idle: 1, walk: 0, jog: 0, run: 0, emote: 0 } as Record<string, number>, emote: '', air: 0, land: 0, wasAir: false, lean: 0, look: 0, nextLook: 6,
    sitPhase: '', sitSeat: '', sitT: 0, settle: 0, out: 0, sitLook: 0, nextSitLook: 7,
    gesture: -1, gestureKind: '', hold: 0, dribble: 0, dribbleW: 0, raise: 0, poseDt: 0, poseFrame: 0, cast: true, inAir: false,
  });
  const remote = !!id && id !== 'local' && !preview;
  useEffect(() => registerMovingCaster(rig.root), [rig]);
  // Prepare a newcomer before anyone looks at them: textures (queued, see above) and shader programs.
  // (Not compileAsync: it polls the programs on a timer and throws once a player who left quickly has had
  // their materials disposed.) Your own character too: it loads behind the welcome screen, hidden, and was
  // otherwise compiled and uploaded in the frame you entered the campus.
  const { gl, scene, camera } = useThree();
  useEffect(() => { if (preview) return; queueUploads(rig.root); gl.compile(rig.root, camera, scene); }, [rig, preview, gl, scene, camera]);
  useEffect(() => () => contactMat.dispose(), [contactMat]);
  const anchor = useMemo(() => ({ ball: new THREE.Vector3(), holding: false }), []);
  useEffect(() => { if (!id) return; avatars.set(id, anchor); return () => { if (avatars.get(id) === anchor) avatars.delete(id); }; }, [id, anchor]);

  useFrame(({ clock, camera, gl }, raw) => {
    // The queue belongs to the campus renderer: the avatar editor's preview canvas has a context of its own.
    if (!preview && pendingUploads.length && uploadAt !== clock.elapsedTime) { uploadAt = clock.elapsedTime; gl.initTexture(pendingUploads.shift()!); }
    // Real time, up to a quarter second a frame: a 50 ms cap played every animation (and the sit-down and
    // stand-up that gate actions) in slow motion below 20 FPS, ten times slower at 2 FPS.
    const dt = Math.min(raw, .25), m = motion?.() ?? { speed: 0, y: 0, vy: 0 }, s = state.current, { actions, lib } = rig, now = performance.now() / 1000;
    const inVehicle=m.vehicleSeatHeight!=null;
    const sit = inVehicle ? {seat:'vehicle',phase:'seated',t:0} as SitState : preview ? null : m.sit ?? null, seat = inVehicle ? {id:'vehicle',y:m.vehicleSeatHeight!,table:true,pull:0} : sit ? SEAT_BY_ID.get(sit.seat) : undefined;
    const seated = !!(sit && seat && (sit.phase === 'down' || sit.phase === 'seated' || sit.phase === 'up'));
    const speed = preview || seated ? 0 : m.speed;
    // Sound: where this character stands (its parent group), heard from there unless it is you. Players in
    // another space (their own room) are hidden and silent.
    const body = rig.root.parent, audible = !preview && !!body && body.visible, px = body?.position.x ?? 0, pz = body?.position.z ?? 0;
    const at = remote ? { x: px, y: (body?.position.y ?? 0) + .1, z: pz } : null;

    // ------------------------------------------------------------------ seating
    // The parent group stands on the seat anchor facing the seat's direction; the captured root travel
    // is replayed on the rig, so the body steps back onto the seat and forward off it (no teleport).
    let sitW = 0, rx = 0, ry = 0, rz = 0;
    const idleSeat = seat?.table ? 'sitTable' : 'sitIdle';
    if (seated && sit && seat) {
      const pull = seat.pull ?? 0, dy = seat.y - (seat.table ? lib.tableSeatHeight : lib.seatHeight);
      if (s.sitPhase !== sit.phase || s.sitSeat !== seat.id) {
        const was = s.sitPhase; s.sitPhase = sit.phase; s.sitSeat = seat.id; s.sitT = 0; if (sit.phase === 'seated') { actions.sitIdle.reset().play(); actions.sitTable.reset().play(); }
        // Sitting down, the chair scooting in to the table, standing up (pushing it back first).
        if (audible && seat.id !== 'vehicle') {
          const seatAt = { x: seat.x, y: .5, z: seat.z }, info = seat as typeof seat & { kind: string; model?: string }, plastic = info.model === 'monobloc';
          if (sit.phase === 'down') sitDown(info, seatAt, (lib.down.end - lib.down.start) / lib.down.rate * .72);
          else if (sit.phase === 'seated' && was === 'down' && seat.pull) chairScrape(seatAt, SCOOT, plastic);
          else if (sit.phase === 'up' && was) { if (seat.pull) chairScrape(seatAt, SCOOT, plastic); standUp(info, seatAt, seat.pull ? SCOOT : 0); }
        }
      }
      s.sitT += dt; s.out = 0;
      if (sit.phase === 'down') {
        const tr = lib.down, span = (tr.end - tr.start) / tr.rate, t = Math.min(s.sitT, span), clipT = tr.start + t * tr.rate;
        actions.sitDown.time = clipT;
        const [cx, cz] = curveAt(tr, clipT); rx = cx - tr.endX; rz = cz - tr.endZ - pull; ry = dy * smooth(t / span);
        sitW = smooth(s.sitT / .25); s.settle = 0;
        actions.sitDown.setEffectiveWeight(sitW); actions.sitIdle.setEffectiveWeight(0); actions.sitTable.setEffectiveWeight(0);
        if (seat.table) chairPull.set(seat.id, 1);
        if (s.sitT >= span) sit.phase = 'seated';
      } else if (sit.phase === 'seated') {
        // Settle from the end of the transition into the seated idle, then scoot the chair in.
        s.settle = Math.min(1, s.settle + dt / .45); sitW = 1;
        actions.sitDown.time = lib.down.end; actions.sitDown.setEffectiveWeight(1 - s.settle);
        const k = pull ? 1 - smooth(s.sitT / SCOOT) : 0; rz = -pull * k; ry = dy;
        if (seat.table) chairPull.set(seat.id, k);
        // An occasional glance around while seated (benches; at a table the arms rest on the top).
        s.nextSitLook -= dt; if (s.nextSitLook < 0) { s.sitLook = 1; s.nextSitLook = 10 + Math.random() * 9; actions.sitLook.reset().play(); }
        s.sitLook = Math.max(0, s.sitLook - dt / actions.sitLook.getClip().duration);
        const lookW = seat.table ? 0 : Math.sin(Math.min(1, s.sitLook) * Math.PI) * s.settle;
        actions[idleSeat].setEffectiveWeight(s.settle * (1 - lookW)); actions.sitLook.setEffectiveWeight(s.settle * lookW);
        actions[seat.table ? 'sitIdle' : 'sitTable'].setEffectiveWeight(0);
      } else {
        // Scoot the chair back, then the captured stand-up carries the body forward off the seat.
        const tr = lib.up, scoot = pull ? SCOOT : 0, span = (tr.end - tr.start) / tr.rate, t = s.sitT - scoot;
        actions.sitDown.setEffectiveWeight(0); actions.sitLook.setEffectiveWeight(0);
        if (t < 0) { const k = smooth(s.sitT / scoot); rz = -pull * k; ry = dy; sitW = 1; chairPull.set(seat.id, k); actions[idleSeat].setEffectiveWeight(1); actions.standUp.setEffectiveWeight(0); }
        else {
          const tt = Math.min(t, span), clipT = tr.start + tt * tr.rate, [cx, cz] = curveAt(tr, clipT), [sx, sz] = curveAt(tr, tr.start);
          actions.standUp.time = clipT; rx = cx - sx; rz = cz - sz - pull; ry = dy * (1 - smooth(tt / span)); sitW = 1;
          const w = smooth(t / .3); actions.standUp.setEffectiveWeight(w); actions[idleSeat].setEffectiveWeight(1 - w);
          if (seat.table) chairPull.set(seat.id, 1);
          if (t >= span) { sit.phase = 'done'; s.out = 1; }
        }
      }
    } else {
      // Standing again: hand the final stand-up frame over to locomotion.
      if (s.sitPhase) { s.sitPhase = ''; s.sitSeat = ''; if (!s.out) s.out = 1; }
      s.out = Math.max(0, s.out - dt / .35);
      actions.standUp.time = lib.up.end; actions.standUp.setEffectiveWeight(s.out); sitW = s.out;
      for (const n of ['sitDown', 'sitIdle', 'sitTable', 'sitLook']) actions[n].setEffectiveWeight(0);
    }

    // ------------------------------------------------------------------ locomotion
    const nodes = [['idle', 0], ['walk', lib.speeds.walk], ['jog', lib.speeds.jog], ['run', lib.speeds.run]] as const;
    const target: Record<string, number> = { idle: 0, walk: 0, jog: 0, run: 0 };
    if (speed >= nodes[3][1]) target.run = 1;
    else for (let i = 0; i < 3; i++) { const [a, sa] = nodes[i], [b, sb] = nodes[i + 1]; if (speed <= sb) { const t = Math.max(0, (speed - sa) / (sb - sa)); target[a] = 1 - t; target[b] = t; break; } }
    const holding = !preview && !!m.holding;
    const emoteActive = !!m.emote && (m.emoteUntil ?? 0) > Date.now() && speed < .6 && m.y < .05 && !seated && !holding;
    if (emoteActive && s.emote !== m.emote) { s.emote = m.emote!; actions[s.emote]?.reset().play(); }
    s.weights.emote = THREE.MathUtils.damp(s.weights.emote, emoteActive ? 1 : 0, 6, dt);
    for (const k of ['idle', 'walk', 'jog', 'run']) s.weights[k] = THREE.MathUtils.damp(s.weights[k], target[k], 10, dt);
    // Shared gait phase: the blended stride length sets how fast the cycle advances.
    let stride = 0, w = 0;
    for (const n of LOCO) { const len = lib.speeds[n] * lib.clips[n].duration; stride += s.weights[n] * len; w += s.weights[n]; }
    const before = s.phase;
    if (w > .001 && speed > .05) s.phase = (s.phase + dt * speed / (stride / w)) % 1;
    // A footstep as each foot meets the ground: the gait cycle starts at the left foot's contact (lib.contact)
    // and the right foot's is half a cycle later.
    if (audible && speed > .35 && m.y < .05 && (s.phase < before || (before < .5 && s.phase >= .5))) footstep(px, pz, speed, at);
    // Jumping and landing (a shot's hop too).
    if (audible && !s.inAir && m.y > .12) { s.inAir = true; jump(px, pz, at); }
    else if (s.inAir && m.y < .02) { s.inAir = false; if (audible) land(px, pz, at); }
    for (const n of LOCO) { const a = actions[n]; a.time = ((s.phase + lib.contact[n]) % 1) * lib.clips[n].duration; }
    // Idle variety: an occasional glance around.
    s.nextLook -= dt; if (s.nextLook < 0 && speed < .1 && !emoteActive && !seated && !holding) { s.look = 1; s.nextLook = 9 + Math.random() * 8; actions.look.reset().play(); }
    s.look = Math.max(0, s.look - dt / actions.look.getClip().duration);

    // ------------------------------------------------------------------ gestures (doors, picking up)
    const g = !preview && !seated ? m.gesture : null;
    if (g && GESTURE[g.kind] && g.start !== s.gesture) { s.gesture = g.start; s.gestureKind = g.kind; }
    const spec = GESTURE[s.gestureKind], gt = now - s.gesture;
    let gestureW = 0;
    if (spec && gt >= 0 && gt < spec.to - spec.from + .4) {
      const len = spec.to - spec.from; gestureW = smooth(gt / .18) * (1 - smooth((gt - len + .1) / .4)) * (s.gestureKind === 'pickup' ? .85 : 1) * (1 - Math.min(1, speed / 2));
      if (spec.clip !== 'crouch') actions[spec.clip].time = spec.from + Math.min(gt, len);
    }
    for (const k of ['doorPush', 'doorPull', 'crouch']) actions[k].setEffectiveWeight(spec?.clip === k ? gestureW * (1 - sitW) : 0);

    const lookW = Math.sin(Math.min(1, s.look) * Math.PI) * s.weights.idle;
    const rest = (1 - s.weights.emote) * (1 - sitW) * (1 - gestureW);
    actions.idle.setEffectiveWeight(s.weights.idle * rest * (1 - lookW)); actions.look.setEffectiveWeight(s.weights.idle * rest * lookW);
    for (const n of LOCO) actions[n].setEffectiveWeight(s.weights[n] * rest);
    for (const e of ['wave', 'dance', 'cheer']) actions[e].setEffectiveWeight(e === s.emote ? s.weights.emote * (1 - sitW) : 0);

    // ------------------------------------------------------------------ ball handling layers
    // Arm-only clips carry a large weight: the mixer normalises per bone, so on arm bones they
    // dominate whatever the legs are doing while leaving the rest of the body to locomotion.
    s.hold = THREE.MathUtils.damp(s.hold, holding && !seated ? 1 : 0, 12, dt);
    const charging = holding && m.charge != null, sinceRelease = now - (m.release ?? 0);
    const dribbling = holding && !charging && speed > .6;
    s.dribbleW = THREE.MathUtils.damp(s.dribbleW, dribbling ? 1 : 0, 9, dt);
    // Set pose while charging, full extension at release, then the follow-through fades.
    const follow = sinceRelease >= 0 && sinceRelease < .9 ? 1 - smooth((sinceRelease - .25) / .65) : 0;
    s.raise = THREE.MathUtils.damp(s.raise, charging ? .8 + .2 * (m.charge ?? 0) : 0, 14, dt);
    const up = Math.max(s.raise, follow);
    const big = 4;
    actions.holdArms.setEffectiveWeight(s.hold * (1 - s.dribbleW) * (1 - up) * big);
    actions.leftHold.setEffectiveWeight(s.hold * s.dribbleW * (1 - up) * big * .7);
    actions.armsUp.setEffectiveWeight(up * big);
    // Dribble cadence follows the stride: about one bounce per step.
    if (dribbling) s.dribble = (s.dribble + dt * THREE.MathUtils.clamp(speed * .62, 1.5, 3.2)) % 1;

    // ------------------------------------------------------------------ level of detail (other players)
    // Off screen, the skeleton is not posed or drawn at all; far away it is posed every 2nd or 4th frame.
    // Everything above keeps running every frame, so sit-down and stand-up transitions finish on time.
    const lod = remote ? avatarLod(rig.root, camera, clock.elapsedTime) : 1;
    if (remote) {
      const shown = lod > 0; rig.root.visible = shown; if (contact.current) contact.current.visible = shown;
      const cast = shown && lod < 4; if (cast !== s.cast) { s.cast = cast; rig.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = cast; }); }
    }
    s.poseDt += dt;
    // A ball held by someone off screen follows their room position instead of a stale hand.
    if (!lod || ++s.poseFrame % lod) { anchor.holding = holding && lod > 0; return; }
    const pdt = s.poseDt; s.poseDt = 0;
    rig.mixer.update(pdt);

    // ------------------------------------------------------------------ procedural layers
    // Airborne tuck, landing compression and banking into turns.
    const airborne = m.y > .04;
    s.air = THREE.MathUtils.damp(s.air, airborne ? 1 : 0, airborne ? 14 : 18, pdt);
    if (s.wasAir && !airborne) s.land = 1; s.wasAir = airborne;
    s.land = Math.max(0, s.land - pdt * 5);
    s.lean = THREE.MathUtils.damp(s.lean, THREE.MathUtils.clamp((m.turn ?? 0) * speed * .045, -.22, .22), 8, pdt);
    const b = rig.bones, shooting = up > .05, tuck = s.air * (m.vy > 0 ? .75 : 1) * (shooting ? .35 : 1), comp = Math.sin(s.land * Math.PI) * .5 * (1 - sitW);
    for (const side of ['L', 'R']) {
      rotate(b[`Bip01_${side}_Thigh`], AXIS_Z, -(tuck * .55 + comp * .45));
      rotate(b[`Bip01_${side}_Calf`], AXIS_Z, tuck * 1.05 + comp * .8);
      rotate(b[`Bip01_${side}_Foot`], AXIS_Z, -tuck * .35 - comp * .3);
      if (!shooting && !holding) rotate(b[`Bip01_${side}_UpperArm`], AXIS_Y, (side === 'L' ? 1 : -1) * tuck * .25);
    }
    // Release: raise the upper arms further and straighten the elbows past the set pose.
    const ext = follow * (1 - s.raise * .4);
    if (ext > 0) for (const side of ['L', 'R']) { rotate(b[`Bip01_${side}_UpperArm`], AXIS_Z, -ext * .55); rotate(b[`Bip01_${side}_Forearm`], AXIS_Z, ext * .5); rotate(b[`Bip01_${side}_Hand`], AXIS_Z, ext * .5); }
    // Dribble: the right arm pumps the ball down and absorbs it on the way back up.
    const pump = s.dribbleW * s.hold * (1 - up);
    if (pump > .01) { const c = Math.cos(s.dribble * Math.PI * 2); rotate(b.Bip01_R_UpperArm, AXIS_Z, -pump * (.35 + .12 * c)); rotate(b.Bip01_R_Forearm, AXIS_Z, pump * (.25 - .3 * c)); rotate(b.Bip01_R_Hand, AXIS_Z, -pump * .5 * c); }
    rotate(b.Bip01_Spine, AXIS_Z, -(tuck * .12 + comp * .2));
    rotate(b.Bip01_Spine1, AXIS_X, s.lean * (1 - sitW)); rotate(b.Bip01_Pelvis, AXIS_X, -s.lean * .4 * (1 - sitW));
    rig.root.position.set(rx, ry - comp * .09, rz);
    if (preview) rig.root.rotation.y = Math.sin(clock.elapsedTime * .4) * .35;
    if (contact.current) { const lift = Math.max(0, m.y); contact.current.position.set(rx, -lift + .012, rz); contact.current.scale.setScalar(1 - Math.min(.45, lift * .35)); contactMat.opacity = .3 * (1 - Math.min(.7, lift * .6)) * (1 - sitW * .6); }

    // ------------------------------------------------------------------ ball anchor (world space)
    anchor.holding = holding;
    if (id && holding) {
      rig.root.updateMatrixWorld(true);
      b.Bip01_L_Hand.getWorldPosition(HAND_L); b.Bip01_R_Hand.getWorldPosition(HAND_R);
      rig.root.getWorldQuaternion(WQ); FWD.set(0, 0, 1).applyQuaternion(WQ); RIGHT.set(-1, 0, 0).applyQuaternion(WQ); rig.root.getWorldPosition(WP);
      anchor.ball.copy(HAND_L).add(HAND_R).multiplyScalar(.5).addScaledVector(FWD, .07 + up * .03);
      if (s.dribbleW > .01) {
        // Bounce beside the right foot: pushed down from the hand, a sharp floor contact, caught at the top.
        const floor = floorAt(WP.x, WP.z) + BALL_R, top = HAND_R.y - .1, k = Math.pow(Math.abs(Math.cos(s.dribble * Math.PI)), 1.3), reach = .42 + speed * .03;
        BOUNCE.set(WP.x + FWD.x * reach + RIGHT.x * .26, floor + Math.max(0, top - floor) * k, WP.z + FWD.z * reach + RIGHT.z * .26);
        anchor.ball.lerp(BOUNCE, s.dribbleW);
      }
    }
  });
  return <><primitive object={rig.root} />{!preview && <mesh ref={contact} material={contactMat} rotation-x={-Math.PI / 2} renderOrder={1}><planeGeometry args={[1.25, 1.25]} /></mesh>}</>;
}

/** Warm the caches (model, clips) for a character without rendering it. */
export function preloadCharacter(id: string) { loadCharacterManifest().then(m => { const c = m.characters.find(x => x.id === id); if (c) loadModel(`characters/${c.id}.glb`).then(g => loadLibrary(c.body, g)); }); }
