import { currentVehicle, useVehicle, driving, occupiedAnchor, vehicleFootBlocked } from '../vehicles/client';
import { dormLayout } from '../dorm/client';
import { furnitureAllows, inDormRoom, DORM_ROOM } from '../../shared/dorm.mjs';
import { VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { QA_HOOKS } from '../qa';
import { Suspense, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Avatar from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { input, player, prediction, trail, useGame } from '../state';
import { COLLIDERS, LOCATIONS, TOKENS, collidersIn } from '../../shared/campus.mjs';
import { stepFrame, MAX_STEP, WALK_SPEED, SPRINT_SPEED, JUMP_SPEED } from '../../shared/movement.mjs';
import { SEAT_BY_ID, seatApproach } from '../../shared/interactions.mjs';
import { roomSelf, send, flushMovement } from '../network/client';
import { activate, activity, beginSit, cancelApproach, cancelCharge, chargeStartedAt, drop, releaseShot, requestSit, standUp, startCharge, tickInteractions } from '../interaction/controller';
import { useInteraction, world } from '../interaction/world';
import { currentKeepsakes } from '../account/store';
import { surfaceHeight } from '../world/layout';
import { steerAuthority, steerToward } from '../vehicles/steering.mjs';

const keys = new Set<string>();
const target = new THREE.Vector3(), desired = new THREE.Vector3(), look = new THREE.Vector3(), lookFrom = new THREE.Vector3(), posFrom = new THREE.Vector3();
const ray = new THREE.Vector3(), side = new THREE.Vector3(), upv = new THREE.Vector3(0, 1, 0);
/** Where the driver's steering wheel is, -1..1 (src/vehicles/steering.mjs). */
let wheel = 0;
// QA only: steer towards a point through the normal input path, so the server follows as it would a player.
let qaTarget: { x: number; z: number; until: number } | null = null;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const body = { x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0 };
/**
 * Steering to a point `d` away: no faster than covers most of what is left after the next frame.
 * Legacy rooms apply the last sent input for one more frame, so subtract that travel first.
 */
const arrive = (d: number, frame: number, connected: boolean) => { const f = Math.max(Math.min(frame, MAX_STEP), 1 / 60), coming = connected && !prediction.active ? Math.hypot(sentMove.x, sentMove.z) * f : 0; return Math.max(0, .8 * (d - coming) / f); };
/** The walking velocity of the last input sent: what the room is applying until the next one arrives. */
const sentMove = { x: 0, z: 0 };
// Vehicles block walking into them, never walking out (someone left inside a footprint can step clear).
// Vehicles and, in your room, furniture: never step into one, always step out (shared/dorm.mjs, as the room server).
const footAllowed = (x: number, z: number, fromX: number, fromZ: number) => (!vehicleFootBlocked(x, z) || vehicleFootBlocked(fromX, fromZ)) && furnitureAllows(dormLayout(), x, z, fromX, fromZ);

/** Fraction (0..1) of the segment origin→end that is free of collider boxes. */
export function cameraDistance(origin: THREE.Vector3, end: THREE.Vector3, pad = .3, colliders: readonly { x: number; z: number; w: number; d: number; h: number }[] = COLLIDERS) {
  let closest = 1;
  const dx = end.x - origin.x, dy = end.y - origin.y, dz = end.z - origin.z;
  const x0 = Math.min(origin.x, end.x) - pad, x1 = Math.max(origin.x, end.x) + pad;
  const z0 = Math.min(origin.z, end.z) - pad, z1 = Math.max(origin.z, end.z) + pad;
  for (const b of colliders) {
    // Broad phase rejects distant buildings before the slab test. No per-collider arrays.
    if (b.x + b.w / 2 < x0 || b.x - b.w / 2 > x1 || b.z + b.d / 2 < z0 || b.z - b.d / 2 > z1) continue;
    let near = 0, far = 1;
    let miss = false;
    for (let axis = 0; axis < 3; axis++) {
      const o = origin.getComponent(axis), v = axis === 0 ? dx : axis === 1 ? dy : dz;
      const min = axis === 0 ? b.x - b.w / 2 - pad : axis === 1 ? -pad : b.z - b.d / 2 - pad;
      const max = axis === 0 ? b.x + b.w / 2 + pad : axis === 1 ? b.h + pad : b.z + b.d / 2 + pad;
      if (Math.abs(v) < 1e-4) { if (o < min || o > max) { miss = true; break; } }
      else { const a = (min - o) / v, c = (max - o) / v; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); }
    }
    if (!miss && near <= far && near >= 0 && near < closest) closest = Math.max(.06, near - .02);
  }
  return closest;
}

/** Spring-arm length with a small "sphere" of rays so thin posts and corners don't clip the view. */
const RAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const, rayFrom = new THREE.Vector3(), rayTo = new THREE.Vector3();
function armFraction(from: THREE.Vector3, to: THREE.Vector3) {
  ray.subVectors(to, from); side.crossVectors(ray, upv).normalize().multiplyScalar(.22);
  // Only the colliders in grid cells around the arm (of 1,200+), found once for all five rays.
  const near = collidersIn(Math.min(from.x, to.x) - 1, Math.min(from.z, to.z) - 1, Math.max(from.x, to.x) + 1, Math.max(from.z, to.z) + 1);
  let f = cameraDistance(from, to, .3, near);
  for (const [sx, sy] of RAYS) {
    rayFrom.copy(from).addScaledVector(side, sx); rayFrom.y += sy * .2; rayTo.copy(to).addScaledVector(side, sx); rayTo.y += sy * .2;
    f = Math.min(f, cameraDistance(rayFrom, rayTo, .15, near));
  }
  return f;
}

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export default function Player() {
  const avatar = useGame(s => s.avatar), root = useRef<THREE.Group>(null!), { gl } = useThree();
  const idle = useRef({ t: 0, sent: 0 }), lastSend = useRef(0), sentStill = useRef(false), lastSense = useRef(0), collectSent = useRef<Record<string, number>>({});
  const cam = useRef({ yaw: 0, pitch: .12, arm: 5.4, zoom: 5.4, intro: 0, wasWelcome: true, seated: 0 });
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea,select')) return; const s = useGame.getState();
      if (e.code === 'Escape') { cancelCharge(); if (s.panel) s.set({ panel: null }); else if (s.phase === 'playing') s.set({ panel: 'settings' }); document.exitPointerLock?.(); keys.clear(); return; }
      if (s.phase !== 'playing' || s.panel) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); keys.add(e.code);
      const act = activity();
      if(useVehicle.getState().id&&['Space','KeyQ',...MOVE_KEYS].includes(e.code))return;
      // Space shoots while holding a ball; otherwise it jumps (latched so a quick tap is never lost
      // between two slow frames). E performs the one action on screen; Q drops the ball.
      if (e.code === 'Space' && !e.repeat) { if (act === 'holding') startCharge(e.timeStamp / 1000); else if (act === 'free' || act === 'busy') input.jump = true; }
      if (e.code === 'KeyE' && !e.repeat) activate();
      if (e.code === 'KeyQ' && !e.repeat) drop();
      if (MOVE_KEYS.includes(e.code)) { if (act === 'seated') standUp(); else if (act === 'approach') cancelApproach(); }
      if (e.code === 'KeyM') { s.set({ panel: 'map' }); document.exitPointerLock?.(); }
      if (e.code === 'KeyC') { s.set({ panel: 'chat' }); document.exitPointerLock?.(); }
      if (['Digit1', 'Digit2', 'Digit3'].includes(e.code) && act === 'free') { const emote = ['wave', 'dance', 'cheer'][Number(e.code.slice(-1)) - 1]; player.emote = emote; player.emoteUntil = Date.now() + 3000; send({ type: 'emote', emote }); }
    };
    const keyup = (e: KeyboardEvent) => { keys.delete(e.code); if (e.code === 'Space') releaseShot(e.timeStamp / 1000); };
    const clear = () => { keys.clear(); input.jump = false; input.x = input.z = 0; input.dragging = false; cancelCharge(); };
    const mouse = (e: MouseEvent) => { const s = useGame.getState(); if (s.phase !== 'playing' || s.panel) return; if (document.pointerLockElement === gl.domElement || input.dragging) { input.yaw -= e.movementX * .0032; input.pitch = THREE.MathUtils.clamp(input.pitch + e.movementY * .0022, -.25, .95); } };
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') return; if (useGame.getState().phase === 'playing' && !useGame.getState().panel) input.dragging = true; };
    const up = () => { input.dragging = false; };
    const wheel = (e: WheelEvent) => { if (useGame.getState().phase !== 'playing' || useGame.getState().panel) return; cam.current.zoom = THREE.MathUtils.clamp(cam.current.zoom + Math.sign(e.deltaY) * .6, 2.8, 9); };
    // Development-only QA hook for scripted screenshots from fixed viewpoints.
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__campusDebug = {
      scene: () => gl.domElement,
      teleport: (x: number, z: number, yaw = 0, pitch = .04, zoom = 5.4) => { if (player.sit) return; player.x = x; player.z = z; player.y = 0; player.vx = player.vz = player.vy = 0; trail.clear(); input.yaw = yaw; input.pitch = pitch; cam.current.zoom = zoom; cam.current.arm = zoom; cam.current.yaw = yaw; cam.current.intro = 1; player.yaw = yaw + Math.PI; },
      activate, standUp, drop, startCharge, releaseShot, sit: (id: string) => beginSit(id),
      walkTo: (x: number, z: number) => { qaTarget = Number.isFinite(x) && Number.isFinite(z) ? { x, z, until: performance.now() + 120000 } : null; }, walking: () => !!qaTarget,
      focus: () => useInteraction.getState().focus,
      state: () => ({ prediction: { active: prediction.active, pending: prediction.pending }, activity: activity(), chargeStart: chargeStartedAt(), x: player.x, z: player.z, room: { ...roomSelf }, y: player.y, yaw: player.yaw, sit: player.sit && { ...player.sit }, holding: player.holding, charge: player.charge, ui: { ...useInteraction.getState(), set: undefined }, world: world.snapshot() }),
      face: (yaw: number) => { player.yaw = yaw; input.yaw = yaw + Math.PI; cam.current.yaw = input.yaw; },
    };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear); document.addEventListener('visibilitychange', clear); window.addEventListener('mousemove', mouse); gl.domElement.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); gl.domElement.addEventListener('wheel', wheel, { passive: true });
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); window.removeEventListener('mousemove', mouse); gl.domElement.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); gl.domElement.removeEventListener('wheel', wheel); };
  }, [gl]);

  useEffect(() => { prediction.collision(footAllowed); }, []);

  useFrame(({ camera, clock }, raw) => {
    const dt = Math.min(raw, .25), s = useGame.getState(), c = cam.current;
    if (s.phase === 'welcome') {
      // Slow establishing shot across the courtyard towards the auditorium.
      const t = s.reducedMotion ? 0 : clock.elapsedTime * .04;
      desired.set(46 + Math.sin(t) * 10, 30 + Math.sin(t * .7) * 2, 62 + Math.cos(t) * 6);
      camera.position.lerp(desired, 1 - Math.exp(-dt * 1.5)); camera.lookAt(-3, 2, -10);
      root.current.visible = false; c.wasWelcome = true; return;
    }
    if (c.wasWelcome) { c.wasWelcome = false; c.intro = s.reducedMotion ? 1 : 0; posFrom.copy(camera.position); lookFrom.set(-3, 2, -10); }
    root.current.visible = true;
    const enabled = !s.panel && !document.hidden;
    tickInteractions(dt);
    const vehicle=currentVehicle(),occupancy=useVehicle.getState();
    if(vehicle){
      player.vx=player.vz=0;input.jump=false;player.y=player.vy=player.speed=0;player.moving=false;
      driving.throttle=enabled?(Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))-input.z):0;
      // Settings → Steering sensitivity shapes what is sent; the room's vehicle physics is the same for everyone.
      const steerTarget=enabled?(Number(keys.has('KeyA')||keys.has('ArrowLeft'))-Number(keys.has('KeyD')||keys.has('ArrowRight'))-input.x):0;
      wheel=steerToward(wheel,steerTarget,s.steering,Math.min(raw,.25));driving.steer=wheel*steerAuthority(s.steering,vehicle.speed);
      driving.brake=!enabled||keys.has('Space');
      const a=occupiedAnchor(vehicle.id,occupancy.seat??0)!;player.x=a.x;player.z=a.z;player.yaw=a.yaw;root.current.position.set(a.x,.025,a.z);root.current.rotation.y=a.yaw;
      // Chase camera settles behind the vehicle in real time (frame-rate independent); dragging looks around.
      const real=Math.min(raw,.25);if(!input.dragging){c.yaw+=Math.atan2(Math.sin(a.yaw+Math.PI-c.yaw),Math.cos(a.yaw+Math.PI-c.yaw))*(1-Math.exp(-real*3));input.yaw=c.yaw;}else c.yaw=input.yaw;
      // Framing scales with the vehicle: further back and higher for the shuttle than the cart.
      const size=VEHICLE_TYPES[vehicle.type],back=4+size.length*1.2;target.set(vehicle.x,size.height*.85,vehicle.z);desired.set(vehicle.x+Math.sin(c.yaw)*back,2.6+size.height*1.3+input.pitch*3,vehicle.z+Math.cos(c.yaw)*back);
      const f=armFraction(target,desired);desired.lerp(target,1-f);camera.position.lerp(desired,1-Math.exp(-real*7));camera.lookAt(target);return;
    }
    driving.throttle=driving.steer=wheel=0;
    // Finished standing: step onto the spot the stand-up motion ended on.
    if (player.sit?.phase === 'done') { const exit = player.sit.exit; if (exit) { player.x = exit.x; player.z = exit.z; } player.sit = null; player.vx = player.vz = 0; }
    const act = activity(), sit = player.sit, seat = sit ? SEAT_BY_ID.get(sit.seat) : undefined;
    const onSeat = !!seat && (sit!.phase === 'down' || sit!.phase === 'seated' || sit!.phase === 'up');
    const still = onSeat || act === 'charging' || sit?.phase === 'request';
    let x = enabled ? Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + input.x : 0;
    let z = enabled ? Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')) + input.z : 0;
    const len = Math.max(1, Math.hypot(x, z)); x /= len; z /= len;
    const steering = Math.abs(x) + Math.abs(z) > .3;
    if (steering && act === 'seated') standUp();
    let dx = x * Math.cos(input.yaw) + z * Math.sin(input.yaw), dz = z * Math.cos(input.yaw) - x * Math.sin(input.yaw);
    let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight'), speed = sprint ? SPRINT_SPEED : WALK_SPEED, scale = 1;
    if (sit?.phase === 'approach' && seat) {
      // Walk to the spot in front of the seat, then turn around to face away from it.
      if (steering) cancelApproach();
      else {
        const via = sit.path?.[0], a = via ?? seatApproach(seat), ex = a.x - player.x, ez = a.z - player.z, d = Math.hypot(ex, ez); sit.t += dt; sprint = false;
        if (via && d < .14) sit.path!.shift();
        else if (via || d > .05) { dx = ex / d; dz = ez / d; speed = Math.min(via ? 1.4 : Math.min(1.5, d * 3 + .3), arrive(d, raw, s.status === 'connected')); scale = speed / WALK_SPEED; }
        else {
          dx = dz = 0; player.yaw = seat.yaw;
          let err = seat.yaw - root.current.rotation.y; err = Math.atan2(Math.sin(err), Math.cos(err));
          if (Math.abs(err) < .12 && Math.hypot(player.vx, player.vz) < .3) requestSit();
        }
        if (sit.t > 8 && d > .2) { cancelApproach(); s.notify('Something is in the way of that seat.'); }
      }
    }
    if (QA_HOOKS && qaTarget && !sit) {
      const ex = qaTarget.x - player.x, ez = qaTarget.z - player.z, d = Math.hypot(ex, ez);
      if (d < .1 || performance.now() > qaTarget.until) qaTarget = null;
      else { dx = ex / d; dz = ez / d; sprint = false; speed = Math.min(WALK_SPEED, d * 4 + .3, arrive(d, raw, s.status === 'connected')); scale = speed / WALK_SPEED; }
    }
    if (still) { dx = dz = 0; if (!prediction.active) player.vx = player.vz = 0; }
    // Drifted out of agreement with the room while standing: glide back (any input cancels it).
    if (player.reconcile) {
      if (Math.hypot(dx, dz) > .01 || player.sit) player.reconcile = null;
      else {
        const ex = player.reconcile.x - player.x, ez = player.reconcile.z - player.z, d = Math.hypot(ex, ez), step = Math.min(d, 3 * Math.min(raw, .1));
        if (d < .05) player.reconcile = null; else { player.x += ex / d * step; player.z += ez / d * step; }
      }
    }
    // Predict each timed command with the shared physics, retaining it until the room acknowledges it.
    // Older rooms retain the previous-input integrator until both client and server are deployed.
    const beforeX = player.x, beforeZ = player.z, connected = s.status === 'connected';
    const jump = enabled && input.jump && player.y === 0 && !still && !sit; if (jump && !prediction.active) player.vy = JUMP_SPEED;
    input.jump = false;
    const wantX = dx * speed, wantZ = dz * speed;
    if (Math.hypot(dx, dz) > .1) player.yaw = Math.atan2(dx, dz);
    if (prediction.active) { sentMove.x = wantX; sentMove.z = wantZ; }
    if (still || !connected) { sentMove.x = wantX; sentMove.z = wantZ; }
    body.x = player.x; body.z = player.z; body.y = player.y; body.vy = player.vy; body.vx = player.vx; body.vz = player.vz;
    const real = prediction.active
      ? prediction.frame(raw, dx * scale, dz * scale, sprint, jump, player.yaw)
      : stepFrame(body, sentMove.x, sentMove.z, raw, footAllowed);
    if (prediction.active && !real && jump) input.jump = true;
    if (!prediction.active) { player.x = body.x; player.z = body.z; player.y = body.y; player.vy = body.vy; player.vx = body.vx; player.vz = body.vz; }
    trail.push(player.x, player.z, performance.now());
    // Animation reads the speed actually achieved (so walking into a wall doesn't run on the spot).
    const achieved = Math.hypot(player.x - beforeX, player.z - beforeZ) / Math.max(real, 1e-4);
    player.speed = THREE.MathUtils.damp(player.speed, achieved, 14, dt);
    player.moving = achieved > .2; player.sprinting = sprint;
    // Sitting down, seated and standing up, the body is anchored to the seat; the avatar replays the
    // captured travel onto and off it.
    const px = onSeat ? seat!.x : player.x, pz = onSeat ? seat!.z : player.z;
    if (onSeat) player.yaw = seat!.yaw;
    const ground = surfaceHeight(px, pz);
    root.current.position.set(px, player.y + ground, pz);
    const prevYaw = root.current.rotation.y;
    let delta = player.yaw - root.current.rotation.y; delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    root.current.rotation.y += delta * (1 - Math.exp(-dt * 12));
    player.turn = THREE.MathUtils.damp(player.turn, (root.current.rotation.y - prevYaw) / Math.max(dt, 1e-4), 10, dt);

    // Third-person camera: damped orbit, spring arm that shortens fast and extends slowly.
    c.yaw += Math.atan2(Math.sin(input.yaw - c.yaw), Math.cos(input.yaw - c.yaw)) * (1 - Math.exp(-dt * 16));
    // In your room (3 m ceiling, a short spring arm), look down from a little higher, over the shoulder.
    const indoors = inDormRoom(px, pz);
    c.pitch = THREE.MathUtils.damp(c.pitch, input.pitch + .08 + (indoors ? .15 : 0), 14, dt);
    c.seated = THREE.MathUtils.damp(c.seated, onSeat && sit!.phase !== 'up' ? 1 : 0, 3, dt);
    target.set(px, ground + Math.min(player.y, 1.2) * .5 + 1.58 - c.seated * .45, pz);
    const zoom = c.zoom;
    desired.set(target.x + Math.sin(c.yaw) * zoom * Math.cos(c.pitch), target.y + .35 + Math.sin(c.pitch) * zoom, target.z + Math.cos(c.yaw) * zoom * Math.cos(c.pitch));
    const free = armFraction(target, desired) * zoom;
    c.arm = free < c.arm ? THREE.MathUtils.damp(c.arm, free, 30, dt) : THREE.MathUtils.damp(c.arm, free, 3.2, dt);
    desired.sub(target).normalize().multiplyScalar(c.arm).add(target);
    desired.y = Math.max(desired.y, ground + .45); if (indoors) desired.y = Math.min(desired.y, DORM_ROOM.height - .25);
    look.copy(target); look.y += .1;
    if (c.intro < 1) {
      c.intro = Math.min(1, c.intro + dt / 1.8); const k = ease(c.intro);
      camera.position.lerpVectors(posFrom, desired, k); camera.lookAt(rayTo.copy(lookFrom).lerp(look, k));
    } else { camera.position.copy(desired); camera.lookAt(look); }

    // 20 inputs a second while moving, sooner (40 ms) when the input changes; standing still, the room only
    // needs reminding 4 times a second (the first "stopped" still goes out at once). The room allows 35 a second.
    const stillInput = Math.hypot(dx, dz) < .01 && !sprint, since = clock.elapsedTime - lastSend.current;
    const changed = Math.abs(wantX - sentMove.x) + Math.abs(wantZ - sentMove.z) > .05;
    if (prediction.active) {
      if (since > .05 || prediction.batch().commands.length >= 16) { flushMovement(); lastSend.current = clock.elapsedTime; }
    } else if (jump || (changed && since > .04) || since > (stillInput && sentStill.current ? .25 : .05)) {
      if (send({ type: 'input', dx: dx * scale, dz: dz * scale, yaw: player.yaw, sprint, jump })) { sentMove.x = wantX; sentMove.z = wantZ; }
      lastSend.current = clock.elapsedTime; sentStill.current = stillInput;
    }
    // Standing still: keep the room's copy of our position in step with what we see.
    const resting = !player.sit && Math.hypot(dx, dz) < .01 && player.speed < .05 && player.y === 0;
    idle.current.t = resting ? idle.current.t + dt : 0;
    if (!prediction.active && idle.current.t > .25 && clock.elapsedTime - idle.current.sent > .5) { idle.current.sent = clock.elapsedTime; send({ type: 'settle', x: player.x, z: player.z }); }
    if (clock.elapsedTime - lastSense.current > .15) {
      lastSense.current = clock.elapsedTime;
      const near = LOCATIONS.map(l => ({ id: l.id, d: Math.hypot(l.x - player.x, l.z - player.z) })).sort((a, b) => a.d - b.d)[0]; const id = near.d < 5 ? near.id : null; if (s.nearby !== id) s.set({ nearby: id });
      if (enabled) for (const token of TOKENS) if (!currentKeepsakes().includes(token.id) && Math.hypot(player.x - token.x, player.z - token.z) < 1.65 && clock.elapsedTime - (collectSent.current[token.id] ?? -10) > .8) { collectSent.current[token.id] = clock.elapsedTime; if (s.status === 'connected') send({ type: 'collect', id: token.id }); else s.collect(token.id); }
    }
  });
  return <group ref={root} rotation-y={Math.PI}><AvatarBoundary accent={avatar.accent}><Suspense fallback={null}><Avatar id="local" config={avatar} motion={() => player} /></Suspense></AvatarBoundary></group>;
}
