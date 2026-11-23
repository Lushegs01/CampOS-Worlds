// The Commercial District hero slice's production pedestrian: Funmilayo, a bank customer outside Coastal Bank.
//
// * Character: a Microsoft Rocketbox avatar (MIT) not used anywhere else, built by scripts/assets/build-characters.mjs
//   (`PEDESTRIANS`) like the player cast (KTX2 textures, meshopt, skin mask), and never offered in the avatar picker.
// * Animation: the shared motion-capture library through src/avatar/Avatar.tsx: speed-blended walking, the captured
//   sit-down/stand-up transitions on the bench, and two clips added for ambient life (checking a receipt at the ATM,
//   texting on a phone). Avatar's distance LOD applies: not posed off screen, posed every 2nd/4th frame beyond
//   30/60 m.
// * Schedule: ./heroPedestrianPlan.mjs, a pure function of the room clock, so every client agrees.
// * Reactions (local, per viewer): she turns her head to follow a player who comes close in front of her, waves at
//   one who stops nearby, and steps aside on her walking line rather than walking through a player.
import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { player, roomPlayback } from '../state';
import { METRO_SHIFT } from '../../shared/metro.mjs';
import type { SitState } from '../state';
import { BENCH_SEAT, pedestrianAt, PERIOD } from './heroPedestrianPlan.mjs';
import { QA_HOOKS } from '../qa';

// QA builds: `__heroPedestrian({ at: seconds })` pins her round to a moment (it then runs on from there);
// `{ at, freeze: true }` holds her there (for captures at a low frame rate); `__heroPedestrian()` reports where she is and what she is doing.
const qa = { base: null as number | null, from: 0, freeze: false, last: null as unknown };
if (QA_HOOKS && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__heroPedestrian = (o?: { at?: number; freeze?: boolean }) => {
  if (o?.at != null) { qa.base = o.at; qa.from = performance.now(); qa.freeze = !!o.freeze; }
  return { ...(qa.last as object), period: PERIOD };
};

const CONFIG = { model: 'funmi', skin: '#5b3424', accent: '#6f5c49', accessory: 'none' };
const GROUND = .125; // Harbour Exchange paving

export default function HeroPedestrian() {
  const root = useRef<THREE.Group>(null!);
  const motion = useRef<AvatarMotion>({ speed: 0, y: 0, vy: 0, turn: 0, seatAt: BENCH_SEAT });
  const r = useRef({ yaw: Math.PI / 2, side: 0, gaze: 0, near: 0, waved: -1e9, waves: 0, upAt: 0, sitSince: NaN });
  const config = useMemo(() => CONFIG, []);
  useFrame((_, raw) => {
    const dt = Math.min(raw, .25), now = performance.now(), t = qa.base != null ? qa.base + (qa.freeze ? 0 : (now - qa.from) / 1000) : (roomPlayback.time(now) ?? now) / 1000;
    const p = pedestrianAt(t), m = motion.current, s = r.current, g = root.current;
    // The player in the district's local frame.
    const px = player.x - METRO_SHIFT.x, pz = player.z - METRO_SHIFT.z;
    // ---- seating: start the captured sit-down once per bench visit, ask to stand at the plan's time
    if (p.action === 'sit') {
      if (s.sitSince !== (p.since ?? 0)) { s.sitSince = p.since ?? 0; m.sit = { seat: BENCH_SEAT.id, phase: p.phase === 'down' ? 'down' : 'seated', t: 0 } as SitState; }
      if (p.phase === 'up' && m.sit && (m.sit.phase === 'seated' || m.sit.phase === 'down')) { m.sit.phase = 'up'; s.upAt = now; }
    } else if (m.sit && m.sit.phase !== 'up') m.sit = null;
    // The captured stand-up runs on capped frame time; on a very slow frame rate (or after the clock jumps) her round
    // moves on without it: release the seat 4 s after asking her to stand.
    else if (m.sit && now - s.upAt > 4000) m.sit = null;
    if (m.sit?.phase === 'done') m.sit = null;
    const seated = !!m.sit;
    // ---- step aside: on her walking line a player close ahead pushes her sideways (smoothly), then she returns
    let lateral = 0;
    if (p.action === 'walk') {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), dx = px - p.x, dz = pz - p.z, ahead = dx * fx + dz * fz, across = dx * fz - dz * fx;
      if (ahead > -.3 && ahead < 2.2 && Math.abs(across) < 1.1) lateral = (across >= 0 ? -1 : 1) * .85;
    }
    s.side = THREE.MathUtils.damp(s.side, lateral, 3, dt);
    const x = p.x + Math.cos(p.yaw) * s.side, z = p.z - Math.sin(p.yaw) * s.side;
    if (seated) { g.position.set(BENCH_SEAT.x, GROUND, BENCH_SEAT.z); g.rotation.y = BENCH_SEAT.yaw; s.yaw = BENCH_SEAT.yaw; }
    else {
      g.position.set(x, GROUND, z);
      // While greeting someone she turns to face them, then back to what she was doing.
      const greeting = now - s.waved < 3400 && p.action !== 'walk';
      const facing = greeting ? Math.atan2(px - x, pz - z) : p.yaw;
      let d = facing - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yaw += d * (1 - Math.exp(-dt * 6)); g.rotation.y = s.yaw;
      m.turn = d * 3;
    }
    m.speed = seated ? 0 : p.speed;
    // ---- ambient clips
    m.emote = p.action === 'documents' || p.action === 'phone' ? p.action : undefined;
    m.emoteUntil = m.emote ? Date.now() + 1000 : 0;
    // ---- gaze: follow a player within 7 m in front of her (head and neck, clamped by the avatar)
    const dx = px - g.position.x, dz = pz - g.position.z, dist = Math.hypot(dx, dz);
    let rel = Math.atan2(dx, dz) - g.rotation.y; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const watching = dist < 7 && Math.abs(rel) < 1.7;
    s.gaze = THREE.MathUtils.damp(s.gaze, watching ? rel : 0, 4, dt); m.gaze = s.gaze;
    // ---- greeting: a wave for a player who has stood within 4 m for a moment (not while busy or seated)
    s.near = dist < 4 && Math.hypot(player.vx, player.vz) < .2 ? s.near + dt : 0;
    if (s.near > 1.2 && !seated && p.action !== 'walk' && now - s.waved > 30000) { s.waved = now; s.waves++; }
    if (now - s.waved < 3400 && !seated && p.action !== 'walk') { m.emote = 'wave'; m.emoteUntil = Date.now() + 300; }
    if (QA_HOOKS) qa.last = { action: p.action, phase: m.sit?.phase ?? null, emote: m.emote ?? null, gaze: +s.gaze.toFixed(2), waves: s.waves, x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2) };
  });
  return <group ref={root} name="hero:pedestrian"><AvatarBoundary accent={CONFIG.accent}>
    <Suspense fallback={null}><Avatar config={config} id="hero-pedestrian" motion={() => motion.current} /></Suspense>
  </AvatarBoundary></group>;
}
