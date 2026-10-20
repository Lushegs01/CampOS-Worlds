// In-page capture rig (loaded by tools/render.mjs into the game's own dev page). It drives the real game:
// the local player through the same input fields the keyboard writes, the car through the same controls,
// other players through the client's own peer list (as the room would), and the basketball through the
// same shot request. Each frame it then places the cinematic camera after the game has moved, before the
// frame is drawn, and reads the finished frame back.
import * as THREE from 'three';
import { _roots } from '@react-three/fiber';
import { useGame, player, input, livePeers, type Peer } from '../../src/state';
import { displayAvatar, sanitizeAvatar, setDoorOpen } from '../../shared/campus.mjs';
import { localFleet, vehicleVisuals, receiveVehicles, vehicleAction, useVehicle } from '../../src/vehicles/client';
import { VEHICLE_TYPES, localPoint } from '../../shared/vehicles.mjs';
import { world, request } from '../../src/interaction/world';
import { startCharge, releaseShot, CHARGE_PERIOD } from '../../src/interaction/controller';
import { planShot, stepBall, newBall } from '../../shared/ball.mjs';
import { BALLS } from '../../shared/interactions.mjs';
import type { Pose } from './camera';
import { SHOTS, type Shot } from '../shots';

declare global { interface Window { __clock: { manual(): void; step(ms: number): number; now(): number }; __campusDebug: Record<string, (...a: never[]) => unknown> } }

const FPS = 30, DT = 1 / FPS;
type AvatarChoice = { model: string; skin?: string; accent?: string; accessory?: string };
type Debug = { teleport(x: number, z: number, yaw: number, pitch?: number, zoom?: number): void };

/** What a shot can do. Everything goes through the game's own state and rules. */
export class Rig {
  /** `t`: film time (seconds from the first captured frame). `sim`: game time, slower in slow motion. */
  t = 0; sim = 0; frame = 0; readonly dt = DT; aspect = 9 / 16; tags = true;
  /** High redraws the sun's shadows every other frame; fast movers (the car, sprinters, the ball) need every frame. */
  shadowsEveryFrame = false;
  camera!: THREE.PerspectiveCamera; scene!: THREE.Scene; gl!: THREE.WebGLRenderer;
  private held = new Set<string>();
  /** Named moments in the take (film time), for syncing sound: the gate pass, the ball through the net. */
  readonly marks: { name: string; t: number }[] = [];
  mark(name: string) { if (!this.marks.some(m => m.name === name)) this.marks.push({ name, t: this.t }); }
  private shot: { at: number; release: number } | null = null;
  readonly memory: Record<string, unknown> = {};
  get player() { return player; }
  get now() { return performance.now() / 1000; }

  // ---------------------------------------------------------------- local player
  avatar(choice: AvatarChoice) { useGame.getState().set({ avatar: sanitizeAvatar(choice) }); }
  /** Stand the player at (x, z) facing `heading` (radians; 0 = +z, the game's yaw). */
  place(x: number, z: number, heading: number) { (window.__campusDebug as unknown as Debug).teleport(x, z, heading + Math.PI); input.x = input.z = 0; }
  key(code: string, down: boolean) {
    if (down === this.held.has(code)) return;
    if (down) this.held.add(code); else this.held.delete(code);
    document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  }
  /** Walk (or run) towards a heading this frame, the way the stick does. */
  walk(heading: number, sprint = false, amount = 1) { input.yaw = heading + Math.PI; input.x = 0; input.z = -amount; this.key('ShiftLeft', sprint); }
  /** Walk towards a point; stops inside `radius`. Returns true once there. */
  walkTo(x: number, z: number, sprint = false, radius = .25) {
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
    if (d < radius) { this.stop(); return true; }
    this.walk(Math.atan2(dx, dz), sprint, Math.min(1, d / 1.2 + .35)); return false;
  }
  stop() { input.x = input.z = 0; this.key('ShiftLeft', false); }
  jump() { input.jump = true; }
  emote(name: 'wave' | 'dance' | 'cheer') { player.emote = name; player.emoteUntil = Date.now() + 3000; }

  // ---------------------------------------------------------------- other players (as the room sends them)
  addPeer(id: string, name: string, choice: AvatarChoice, x: number, z: number, heading: number) {
    const p: Peer = { id, name, avatar: displayAvatar(choice), x, y: 0, z, yaw: heading, moving: false, sprinting: false, emote: '', emoteAt: 0, seat: null, ball: null, handle: null, verified: false, title: null, vehicle: null, vehicleSeat: null };
    livePeers.set(id, p);
    useGame.getState().set({ peers: [...livePeers.values()].map(q => ({ ...q })), count: livePeers.size + 1 });
    return p;
  }
  peer(id: string) { const p = livePeers.get(id); if (!p) throw new Error(`no peer ${id}`); return p; }
  /** Move a player along a polyline at `speed` m/s, starting at game time `t0`. */
  peerAlong(id: string, points: [number, number][], speed: number, t0 = 0) {
    const p = this.peer(id); let s = Math.max(0, (this.sim - t0) * speed), i = 0;
    const lengths = points.slice(1).map((q, k) => Math.hypot(q[0] - points[k][0], q[1] - points[k][1]));
    while (i < lengths.length - 1 && s > lengths[i]) { s -= lengths[i]; i++; }
    const a = points[i], b = points[i + 1], k = Math.min(1, s / lengths[i]);
    p.x = a[0] + (b[0] - a[0]) * k; p.z = a[1] + (b[1] - a[1]) * k; p.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    p.moving = this.sim >= t0 && !(i === lengths.length - 1 && k >= 1); p.sprinting = p.moving && speed > 3.2;
  }
  peerEmote(id: string, name: 'wave' | 'dance' | 'cheer') { const p = this.peer(id); p.emote = name; p.emoteAt = Date.now(); }

  // ---------------------------------------------------------------- vehicles
  placeVehicle(id: string, x: number, z: number, yaw: number) {
    const v = localFleet.find(id)!; Object.assign(v, { x, z, yaw, speed: 0, steering: 0 });
    Object.assign(vehicleVisuals.get(id)!, { x, z, yaw, speed: 0, steering: 0 }); receiveVehicles(localFleet.snapshot());
  }
  /** Get in through the seat's own door, as the E key does. */
  board(id: string, seat = 0) {
    if (useVehicle.getState().id === id) return;
    const v = localFleet.find(id)!, t = VEHICLE_TYPES[v.type as keyof typeof VEHICLE_TYPES], s = t.seats[seat];
    const door = localPoint(v, (s[0] < 0 ? -1 : 1) * (t.width / 2 + .65), s[1]); player.x = door.x; player.z = door.z;
    vehicleAction('vehicleEnter', id, seat);
    if (useVehicle.getState().id !== id) throw new Error(`could not board ${id}`);
  }
  /** Driver controls for this frame: throttle and steer in -1..1 (steer + is left), as W/S and A/D. */
  drive(throttle: number, steer: number, brake = false) { input.z = -throttle; input.x = -steer; this.key('Space', brake); }
  /** Steer the car along a route (pure pursuit) at a target speed (m/s). */
  driveAlong(id: string, route: [number, number][], speed: number, lookahead = 7) {
    const v = localFleet.find(id)!; let best = 0, bestD = Infinity;
    for (let i = 0; i < route.length; i++) { const d = Math.hypot(route[i][0] - v.x, route[i][1] - v.z); if (d < bestD) { bestD = d; best = i; } }
    let j = best; while (j < route.length - 1 && Math.hypot(route[j][0] - v.x, route[j][1] - v.z) < lookahead) j++;
    const aim = Math.atan2(route[j][0] - v.x, route[j][1] - v.z); let err = aim - v.yaw; err = Math.atan2(Math.sin(err), Math.cos(err));
    const steer = THREE.MathUtils.clamp(err * 2.2, -1, 1), done = j === route.length - 1 && bestD < 2;
    const throttle = done ? 0 : THREE.MathUtils.clamp((speed - v.speed) * .6, -1, 1);
    this.drive(throttle, steer, done); return done;
  }
  vehicle(id: string) { return vehicleVisuals.get(id)!; }

  // ---------------------------------------------------------------- basketball
  pickUp(ballId: string) { player.gesture = { kind: 'pickup', start: this.now }; return request('pickup', { ball: ballId }); }
  /** The charge that drops the ball through the ring from here: the middle of the scoring run. */
  scoringCharge() {
    const hits: number[] = [];
    for (let i = 0; i <= 80; i++) {
      const c = i / 80, b = Object.assign(newBall(BALLS[0]), planShot(player.x, player.z, player.yaw, c), { state: 'flight', shot: { id: 0, by: '', from: [player.x, player.z], scored: false } }), ev: { type: string }[] = [];
      for (let k = 0; k < 90 && !ev.some(e => e.type === 'score'); k++) stepBall(b, 1 / 30, ev);
      if (ev.some(e => e.type === 'score')) hits.push(c);
    }
    if (!hits.length) throw new Error('no scoring charge from here');
    return (hits[0] + hits[hits.length - 1]) / 2;
  }
  /** Start a shot now; it is released when the meter reaches `charge`. */
  shoot(charge = this.scoringCharge()) { startCharge(this.now); this.shot = { at: this.now, release: this.now + charge * CHARGE_PERIOD }; }
  ball(id: string) { return world.balls.find(b => b.id === id)!; }
  /** Called every frame by the runner: lets a charging shot go at the planned instant. */
  tickShot() { if (this.shot && this.now >= this.shot.release) { releaseShot(this.shot.release); this.shot = null; } }

  door(id: string, open: 1 | -1 | false) { setDoorOpen(id, open); }
}

// ------------------------------------------------------------------ runner
const rig = new Rig();
let active: Shot | null = null, cameraOn = false, lastPose: Pose | null = null;
const tags: THREE.Object3D[] = [];

/**
 * The camera's position, writable only by the rig. The game's third-person camera (src/game/Player.tsx)
 * still runs every frame; with it locked out, everything else in the frame (name tags turning to the
 * camera, avatar culling and detail, door and prop distances) sees the cinematic camera instead.
 */
class RigPosition extends THREE.Vector3 {
  open = false;
  override copy(v: THREE.Vector3) { return this.open ? super.copy(v) : this; }
  override lerp(v: THREE.Vector3, a: number) { return this.open ? super.lerp(v, a) : this; }
  override lerpVectors(a: THREE.Vector3, b: THREE.Vector3, k: number) { return this.open ? super.lerpVectors(a, b, k) : this; }
}
let rigPosition: RigPosition;
const suns: THREE.DirectionalLight[] = [];

function apply(pose: Pose) {
  const cam = rig.camera;
  rigPosition.open = true; cam.position.copy(pose.pos); rigPosition.open = false;
  cam.up.set(0, 1, 0); THREE.Object3D.prototype.lookAt.call(cam, pose.look.x, pose.look.y, pose.look.z);
  if (pose.roll) cam.rotateZ(pose.roll);
  if (Math.abs(cam.fov - pose.fov) > 1e-4) { cam.fov = pose.fov; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
}

function install() {
  const canvas = document.querySelector('.world canvas') as HTMLCanvasElement;
  const root = (_roots as unknown as Map<HTMLCanvasElement, { store: { getState(): { camera: THREE.PerspectiveCamera; scene: THREE.Scene; gl: THREE.WebGLRenderer; size: { width: number; height: number }; internal: { subscribe(ref: { current: (s: unknown, dt: number) => void }, priority: number, store: unknown): () => void } } } }>).get(canvas);
  if (!root) throw new Error('scene not mounted');
  const state = root.store.getState();
  rig.camera = state.camera; rig.scene = state.scene; rig.gl = state.gl;
  const p = rig.camera.position; rigPosition = new RigPosition(p.x, p.y, p.z);
  Object.defineProperty(rig.camera, 'position', { value: rigPosition, configurable: true, enumerable: true });
  rig.camera.lookAt = () => {};
  // After the game's own frame work (priority 0: the player, other players, vehicles) and before the
  // frame is drawn (priority 1, World.tsx Render).
  state.internal.subscribe({ current: () => {
    if (!active || !cameraOn) return;
    const size = root.store.getState().size; rig.aspect = size.width / size.height;
    lastPose = active.cam(rig, rig.t); apply(lastPose);
    if (!rig.tags) for (const o of tags) o.visible = false;
    if (rig.shadowsEveryFrame) for (const l of suns) l.shadow.needsUpdate = true;
  } }, .5, root.store);
  rig.scene.traverse(o => { const l = o as THREE.DirectionalLight; if (l.isDirectionalLight && l.castShadow) suns.push(l); });
}

function reset() {
  rig.t = rig.sim = -((active!.lead ?? 0) + (active!.pre ?? 0)); rig.frame = 0; rig.marks.length = 0; rig.shadowsEveryFrame = false;
  for (const k of Object.keys(rig.memory)) delete rig.memory[k];
}

function collectTags() { tags.length = 0; rig.scene.traverse(o => { if (o.name.startsWith('tag:')) tags.push(o); }); }

function loaded() {
  if (!useGame.getState().ready) return false;
  // A character is several skinned meshes sharing one skeleton: count characters by their root bone.
  const roots = new Set<THREE.Object3D>();
  rig.scene.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.skeleton?.bones[0]) roots.add(m.skeleton.bones[0]); });
  return roots.size >= 1 + livePeers.size;
}

const api = {
  shots: () => SHOTS.map(s => ({ id: s.id, frames: s.frames, lead: s.lead ?? 0, pre: s.pre ?? 0 })),
  /** Load a shot: start playing, then let the shot place its world. */
  load(id: string) {
    if (!rig.camera) install();
    active = SHOTS.find(s => s.id === id) ?? null; if (!active) throw new Error(`unknown shot ${id}`);
    useGame.getState().set({ phase: 'playing', panel: null, volume: 0, toast: '' });
    reset(); active.setup(rig); cameraOn = true; return active.frames;
  },
  /** One frame with time held at the start (assets load, characters settle). */
  warm() { collectTags(); window.__clock.step(1000 / FPS); return loaded(); },
  /** The first frame of the take: re-run setup so warm-up frames leave no trace. */
  start() { reset(); active!.setup(rig); },
  /** Motion-blur samples the next frame needs (1: none). */
  samples: () => Math.max(1, Math.round(active!.blur?.(rig.t) ?? 1)),
  /**
   * Advance 1/`of` of a frame (motion blur draws a frame as `of` sub-frames). In slow motion the game
   * advances less than the film. With `capture`, return the drawn frame as a data URL.
   */
  frame(capture = false, type = 'image/png', of = 1) {
    const speed = active!.speed?.(rig.t) ?? 1;
    active!.act?.(rig, rig.t); rig.tickShot();
    window.__clock.step(1000 / FPS * speed / of);
    rig.t += DT / of; rig.sim += DT * speed / of; rig.frame++;
    return capture ? rig.gl.domElement.toDataURL(type, .96) : null;
  },
  marks: () => rig.marks,
  pose: () => lastPose && { pos: lastPose.pos.toArray(), look: lastPose.look.toArray(), fov: lastPose.fov, roll: lastPose.roll ?? 0, aspect: rig.aspect },
  state: () => ({ t: rig.t, player: { x: player.x, z: player.z, yaw: player.yaw }, vehicle: useVehicle.getState().id, peers: [...livePeers.values()].map(p => ({ id: p.id, x: p.x, z: p.z })) }),
  rig,
};
Object.assign(window, { __cinema: api });
export default api;
