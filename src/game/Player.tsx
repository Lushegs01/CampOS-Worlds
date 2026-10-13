import { QA_HOOKS } from '../qa';
import { Suspense, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Avatar from '../avatar/Avatar';
import { input, player, useGame } from '../state';
import { COLLIDERS, LOCATIONS, TOKENS, moveWithCollisions } from '../../shared/campus.mjs';
import { SEAT_BY_ID, seatApproach } from '../../shared/interactions.mjs';
import { send } from '../network/client';
import { activate, activity, beginSit, cancelApproach, cancelCharge, drop, releaseShot, requestSit, standUp, startCharge, tickInteractions } from '../interaction/controller';
import { useInteraction, world } from '../interaction/world';
import { surfaceHeight } from '../world/layout';

const keys = new Set<string>();
const target = new THREE.Vector3(), desired = new THREE.Vector3(), look = new THREE.Vector3(), lookFrom = new THREE.Vector3(), posFrom = new THREE.Vector3();
const ray = new THREE.Vector3(), side = new THREE.Vector3(), upv = new THREE.Vector3(0, 1, 0);
// QA only: steer towards a point through the normal input path, so the server follows as it would a player.
let qaTarget: { x: number; z: number; until: number } | null = null;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Fraction (0..1) of the segment origin→end that is free of collider boxes. */
export function cameraDistance(origin: THREE.Vector3, end: THREE.Vector3, pad = .3) {
  let closest = 1;
  const dx = end.x - origin.x, dy = end.y - origin.y, dz = end.z - origin.z;
  const x0 = Math.min(origin.x, end.x) - pad, x1 = Math.max(origin.x, end.x) + pad;
  const z0 = Math.min(origin.z, end.z) - pad, z1 = Math.max(origin.z, end.z) + pad;
  for (const b of COLLIDERS) {
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
function armFraction(from: THREE.Vector3, to: THREE.Vector3) {
  ray.subVectors(to, from); side.crossVectors(ray, upv).normalize().multiplyScalar(.22);
  let f = cameraDistance(from, to);
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const o = from.clone().addScaledVector(side, sx).add(new THREE.Vector3(0, sy * .2, 0)), e = to.clone().addScaledVector(side, sx).add(new THREE.Vector3(0, sy * .2, 0));
    f = Math.min(f, cameraDistance(o, e, .15));
  }
  return f;
}

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export default function Player() {
  const avatar = useGame(s => s.avatar), root = useRef<THREE.Group>(null!), { gl } = useThree();
  const velocity = useRef({ x: 0, z: 0 }), idle = useRef({ t: 0, sent: 0 }), lastSend = useRef(0), lastSense = useRef(0), collectSent = useRef<Record<string, number>>({});
  const cam = useRef({ yaw: 0, pitch: .12, arm: 5.4, zoom: 5.4, intro: 0, wasWelcome: true, seated: 0 });
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea,select')) return; const s = useGame.getState();
      if (e.code === 'Escape') { cancelCharge(); if (s.panel) s.set({ panel: null }); else if (s.phase === 'playing') s.set({ panel: 'settings' }); document.exitPointerLock?.(); keys.clear(); return; }
      if (s.phase !== 'playing' || s.panel) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); keys.add(e.code);
      const act = activity();
      // Space shoots while holding a ball; otherwise it jumps (latched so a quick tap is never lost
      // between two slow frames). E performs the one action on screen; Q drops the ball.
      if (e.code === 'Space' && !e.repeat) { if (act === 'holding') startCharge(); else if (act === 'free' || act === 'busy') input.jump = true; }
      if (e.code === 'KeyE' && !e.repeat) activate();
      if (e.code === 'KeyQ' && !e.repeat) drop();
      if (MOVE_KEYS.includes(e.code)) { if (act === 'seated') standUp(); else if (act === 'approach') cancelApproach(); }
      if (e.code === 'KeyM') { s.set({ panel: 'map' }); document.exitPointerLock?.(); }
      if (e.code === 'KeyC') { s.set({ panel: 'chat' }); document.exitPointerLock?.(); }
      if (['Digit1', 'Digit2', 'Digit3'].includes(e.code) && act === 'free') { const emote = ['wave', 'dance', 'cheer'][Number(e.code.slice(-1)) - 1]; player.emote = emote; player.emoteUntil = Date.now() + 3000; send({ type: 'emote', emote }); }
    };
    const keyup = (e: KeyboardEvent) => { keys.delete(e.code); if (e.code === 'Space') releaseShot(); };
    const clear = () => { keys.clear(); input.x = input.z = 0; input.dragging = false; cancelCharge(); };
    const mouse = (e: MouseEvent) => { const s = useGame.getState(); if (s.phase !== 'playing' || s.panel) return; if (document.pointerLockElement === gl.domElement || input.dragging) { input.yaw -= e.movementX * .0032; input.pitch = THREE.MathUtils.clamp(input.pitch + e.movementY * .0022, -.25, .95); } };
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') return; if (useGame.getState().phase === 'playing' && !useGame.getState().panel) input.dragging = true; };
    const up = () => { input.dragging = false; };
    const wheel = (e: WheelEvent) => { if (useGame.getState().phase !== 'playing' || useGame.getState().panel) return; cam.current.zoom = THREE.MathUtils.clamp(cam.current.zoom + Math.sign(e.deltaY) * .6, 2.8, 9); };
    // Development-only QA hook for scripted screenshots from fixed viewpoints.
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__campusDebug = {
      scene: () => gl.domElement,
      teleport: (x: number, z: number, yaw = 0, pitch = .04, zoom = 5.4) => { if (player.sit) return; player.x = x; player.z = z; player.y = 0; player.vy = 0; input.yaw = yaw; input.pitch = pitch; cam.current.zoom = zoom; cam.current.arm = zoom; cam.current.yaw = yaw; cam.current.intro = 1; player.yaw = yaw + Math.PI; },
      activate, standUp, drop, startCharge, releaseShot, sit: (id: string) => beginSit(id),
      walkTo: (x: number, z: number) => { qaTarget = { x, z, until: performance.now() + 30000 }; }, walking: () => !!qaTarget,
      focus: () => useInteraction.getState().focus,
      state: () => ({ activity: activity(), x: player.x, z: player.z, y: player.y, yaw: player.yaw, sit: player.sit && { ...player.sit }, holding: player.holding, charge: player.charge, ui: { ...useInteraction.getState(), set: undefined }, world: world.snapshot() }),
      face: (yaw: number) => { player.yaw = yaw; input.yaw = yaw + Math.PI; cam.current.yaw = input.yaw; },
    };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear); window.addEventListener('mousemove', mouse); gl.domElement.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); gl.domElement.addEventListener('wheel', wheel, { passive: true });
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); window.removeEventListener('mousemove', mouse); gl.domElement.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); gl.domElement.removeEventListener('wheel', wheel); };
  }, [gl]);

  useFrame(({ camera, clock }, raw) => {
    const dt = Math.min(raw, .05), s = useGame.getState(), c = cam.current;
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
    // Finished standing: step onto the spot the stand-up motion ended on.
    if (player.sit?.phase === 'done') { const exit = player.sit.exit; if (exit) { player.x = exit.x; player.z = exit.z; } player.sit = null; velocity.current.x = velocity.current.z = 0; }
    const act = activity(), sit = player.sit, seat = sit ? SEAT_BY_ID.get(sit.seat) : undefined;
    const onSeat = !!seat && (sit!.phase === 'down' || sit!.phase === 'seated' || sit!.phase === 'up');
    const still = onSeat || act === 'charging' || sit?.phase === 'request';
    let x = enabled ? Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + input.x : 0;
    let z = enabled ? Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')) + input.z : 0;
    const len = Math.max(1, Math.hypot(x, z)); x /= len; z /= len;
    const steering = Math.abs(x) + Math.abs(z) > .3;
    if (steering && act === 'seated') standUp();
    let dx = x * Math.cos(input.yaw) + z * Math.sin(input.yaw), dz = z * Math.cos(input.yaw) - x * Math.sin(input.yaw);
    let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight'), speed = sprint ? 8 : 4.5, scale = 1; const blend = 1 - Math.exp(-dt * 12);
    if (sit?.phase === 'approach' && seat) {
      // Walk to the spot in front of the seat, then turn around to face away from it.
      if (steering) cancelApproach();
      else {
        const via = sit.path?.[0], a = via ?? seatApproach(seat), ex = a.x - player.x, ez = a.z - player.z, d = Math.hypot(ex, ez); sit.t += dt; sprint = false;
        if (via && d < .14) sit.path!.shift();
        else if (via || d > .05) { dx = ex / d; dz = ez / d; speed = via ? 1.4 : Math.min(1.5, d * 3 + .3); scale = speed / 4.5; }
        else {
          dx = dz = 0; player.x = a.x; player.z = a.z; player.yaw = seat.yaw;
          let err = seat.yaw - root.current.rotation.y; err = Math.atan2(Math.sin(err), Math.cos(err));
          if (Math.abs(err) < .12 && Math.hypot(velocity.current.x, velocity.current.z) < .3) requestSit();
        }
        if (sit.t > 8 && d > .2) { cancelApproach(); s.notify('Something is in the way of that seat.'); }
      }
    }
    if (QA_HOOKS && qaTarget && !sit) {
      const ex = qaTarget.x - player.x, ez = qaTarget.z - player.z, d = Math.hypot(ex, ez);
      if (d < .1 || performance.now() > qaTarget.until) qaTarget = null;
      else { dx = ex / d; dz = ez / d; sprint = false; speed = Math.min(4.5, d * 4 + .3); scale = speed / 4.5; }
    }
    if (still) { dx = dz = 0; velocity.current.x = velocity.current.z = 0; }
    // Integrate movement in real time (in ≤50 ms substeps) even when frames are slow, so the local
    // player moves at the same speed as the room server's simulation of them.
    const real = Math.min(raw, .25), steps = Math.ceil(real / .05), h = real / steps, before = { x: player.x, z: player.z };
    const jump = enabled && input.jump && player.y === 0 && !still && !sit; if (jump) player.vy = 7;
    input.jump = false;
    for (let i = 0; i < steps; i++) {
      const k = steps === 1 ? blend : 1 - Math.exp(-h * 12);
      velocity.current.x += (dx * speed - velocity.current.x) * k; velocity.current.z += (dz * speed - velocity.current.z) * k;
      Object.assign(player, moveWithCollisions(player.x, player.z, velocity.current.x * h, velocity.current.z * h));
      player.vy -= 19 * h; player.y = Math.max(0, player.y + player.vy * h); if (player.y === 0) player.vy = 0;
    }
    // Animation reads the speed actually achieved (so walking into a wall doesn't run on the spot).
    const achieved = Math.hypot(player.x - before.x, player.z - before.z) / Math.max(real, 1e-4);
    player.speed = THREE.MathUtils.damp(player.speed, achieved, 14, dt);
    player.moving = Math.hypot(velocity.current.x, velocity.current.z) > .2; player.sprinting = sprint;
    if (Math.hypot(dx, dz) > .1) player.yaw = Math.atan2(dx, dz);
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
    c.pitch = THREE.MathUtils.damp(c.pitch, input.pitch + .08, 14, dt);
    c.seated = THREE.MathUtils.damp(c.seated, onSeat && sit!.phase !== 'up' ? 1 : 0, 3, dt);
    target.set(px, ground + Math.min(player.y, 1.2) * .5 + 1.58 - c.seated * .45, pz);
    const zoom = c.zoom;
    desired.set(target.x + Math.sin(c.yaw) * zoom * Math.cos(c.pitch), target.y + .35 + Math.sin(c.pitch) * zoom, target.z + Math.cos(c.yaw) * zoom * Math.cos(c.pitch));
    const free = armFraction(target, desired) * zoom;
    c.arm = free < c.arm ? THREE.MathUtils.damp(c.arm, free, 30, dt) : THREE.MathUtils.damp(c.arm, free, 3.2, dt);
    desired.sub(target).normalize().multiplyScalar(c.arm).add(target);
    desired.y = Math.max(desired.y, ground + .45);
    look.copy(target).add(new THREE.Vector3(0, .1, 0));
    if (c.intro < 1) {
      c.intro = Math.min(1, c.intro + dt / 1.8); const k = ease(c.intro);
      camera.position.lerpVectors(posFrom, desired, k); camera.lookAt(lookFrom.clone().lerp(look, k));
    } else { camera.position.copy(desired); camera.lookAt(look); }

    if (clock.elapsedTime - lastSend.current > .05 || jump) { send({ type: 'input', dx: dx * scale, dz: dz * scale, yaw: player.yaw, sprint, jump }); lastSend.current = clock.elapsedTime; }
    // Standing still: keep the room's copy of our position in step with what we see.
    const resting = !player.sit && Math.hypot(dx, dz) < .01 && player.speed < .05 && player.y === 0;
    idle.current.t = resting ? idle.current.t + dt : 0;
    if (idle.current.t > .25 && clock.elapsedTime - idle.current.sent > .5) { idle.current.sent = clock.elapsedTime; send({ type: 'settle', x: player.x, z: player.z }); }
    if (clock.elapsedTime - lastSense.current > .15) {
      lastSense.current = clock.elapsedTime;
      const near = LOCATIONS.map(l => ({ id: l.id, d: Math.hypot(l.x - player.x, l.z - player.z) })).sort((a, b) => a.d - b.d)[0]; const id = near.d < 5 ? near.id : null; if (s.nearby !== id) s.set({ nearby: id });
      if (enabled) for (const token of TOKENS) if (!s.tokens.includes(token.id) && Math.hypot(player.x - token.x, player.z - token.z) < 1.65 && clock.elapsedTime - (collectSent.current[token.id] ?? -10) > .8) { collectSent.current[token.id] = clock.elapsedTime; if (s.status === 'connected') send({ type: 'collect', id: token.id }); else s.collect(token.id); }
    }
  });
  return <group ref={root} rotation-y={Math.PI}><Suspense fallback={null}><Avatar id="local" config={avatar} motion={() => player} /></Suspense></group>;
}
