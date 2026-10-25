import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { avatars } from '../avatar/registry';
import { Label } from '../world/Primitives';
import { surfaceHeight } from '../world/layout';
import type { Quality } from '../world/quality';
import { livePeers, player, useGame } from '../state';
import { mySpace } from '../dorm/client';
import { GESTURE_MS, lineClear, npcKey, npcPose } from '../../shared/npcs.mjs';
import { engager, npcDef, npcNow, npcState, useNpcs } from './client';
import { makeProp } from './props';
import { QA_HOOKS } from '../qa';

// Campus characters in the scene. Each is drawn from its definition and the room clock (npcPose), so every
// player sees the same character in the same place; only presentation is local: easing the turn, where the
// head looks, the name tag. Characters reuse the players' rigs, clips and level of detail (../avatar).

/** A character's model loads within this distance of you and is released beyond 1.4 times it. */
const LOAD: Record<Quality, number> = { low: 30, medium: 55, high: 85 };
// QA builds: `?qa-npcs=0` leaves the cast out of the scene (performance comparisons with and without it).
const HIDDEN = QA_HOOKS && new URLSearchParams(location.search).get('qa-npcs') === '0';

export default function Npcs() {
  const ids = useNpcs(s => s.active), playing = useGame(s => s.phase === 'playing'), quality = useGame(s => s.quality);
  if (HIDDEN || !playing) return null;
  return <>{ids.map(id => <NpcSlot key={id} id={id} radius={LOAD[quality]} />)}</>;
}

/** Mounts the character only while you are near enough to see it (models download on first approach). */
function NpcSlot({ id, radius }: { id: string; radius: number }) {
  const [near, setNear] = useState(false), wait = useRef(0), def = npcDef(id)!, at = useMemo(() => ({}) as ReturnType<typeof npcPose>, []);
  useFrame((_, dt) => {
    wait.current -= dt; if (wait.current > 0) return; wait.current = .5;
    npcPose(def, npcState(id), npcNow(), at);
    const d = Math.hypot(at.x - player.x, at.z - player.z);
    if (!near && d < radius) setNear(true); else if (near && d > radius * 1.4) setNear(false);
  });
  return near ? <NpcBody id={id} /> : null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const PROP_TILT = -.95;
function NpcBody({ id }: { id: string }) {
  const def = npcDef(id)!, key = npcKey(id);
  const group = useRef<THREE.Group>(null!), tag = useRef<THREE.Group>(null!);
  const config = useMemo(() => ({ ...def.appearance }), [def]), prop = useMemo(() => def.prop ? makeProp(def.prop) : null, [def]);
  const motion = useRef<AvatarMotion>({ speed: 0, y: 0, vy: 0, turn: 0, gaze: 0, holding: false, gesture: null, emote: '', emoteUntil: 0 });
  const local = useRef({ placed: false, cue: -1, gestureAt: -1, serveUntil: 0, look: 0, lookTarget: 0 });
  const pose = useMemo(() => ({}) as ReturnType<typeof npcPose>, []);
  useEffect(() => () => { prop?.removeFromParent(); }, [prop]);
  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, .25), g = group.current, L = local.current, m = motion.current, s = npcState(id);
    // Inside your own room, everyone on campus is elsewhere (as other players are).
    const here = !mySpace() && !!s; g.visible = here; if (prop) prop.visible = false; if (!here) return;
    const t = npcNow(), p = npcPose(def, s, t, pose), y = surfaceHeight(p.x, p.z);
    // The pose is continuous; a correction from the room (a reconnect) glides unless it is far.
    if (!L.placed || Math.hypot(g.position.x - p.x, g.position.z - p.z) > 2.5) { g.position.set(p.x, y, p.z); g.rotation.y = p.yaw; L.placed = true; }
    else { g.position.x = THREE.MathUtils.damp(g.position.x, p.x, 14, dt); g.position.z = THREE.MathUtils.damp(g.position.z, p.z, 14, dt); g.position.y = y; }
    // Facing: the routine's direction, or whoever started the conversation.
    const who = p.state === 'interacting' ? engager(s) : null;
    const face = who ? Math.atan2(who.x - p.x, who.z - p.z) : p.yaw, turn = wrap(face - g.rotation.y), before = g.rotation.y;
    g.rotation.y += turn * (1 - Math.exp(-dt * (who ? 7 : 5)));
    m.turn = wrap(g.rotation.y - before) / Math.max(dt, 1e-4);
    m.speed = THREE.MathUtils.damp(m.speed, p.speed, 10, dt);
    // Gaze: four times a second, the nearest person in front and in sight within 3.5 m (not while walking).
    L.look -= dt;
    if (L.look <= 0) {
      L.look = .25; L.lookTarget = 0; let best = 3.5;
      if (!who && p.speed < .05) for (const o of [player, ...livePeers.values()]) {
        if ('space' in o && o.space) continue;
        const d = Math.hypot(o.x - p.x, o.z - p.z), a = wrap(Math.atan2(o.x - p.x, o.z - p.z) - g.rotation.y);
        if (d < best && d > .3 && Math.abs(a) < 1.75 && lineClear(p.x, p.z, o.x, o.z)) { best = d; L.lookTarget = a; }
      }
    }
    m.gaze = THREE.MathUtils.damp(m.gaze ?? 0, THREE.MathUtils.clamp(L.lookTarget, -1.1, 1.1), 4, dt);
    // Gestures the room announced (a wave hello, a cheer, serving an order), each played once.
    const gesture = s.gesture;
    if (gesture && gesture.at !== L.gestureAt && t - gesture.at < GESTURE_MS) {
      L.gestureAt = gesture.at; const left = GESTURE_MS - (t - gesture.at);
      if (gesture.kind === 'serve') L.serveUntil = performance.now() + left; else { m.emote = gesture.kind; m.emoteUntil = Date.now() + left; }
    }
    // Repeated work gestures from the routine: reaching (the board, the shelves, the till) or tending a bed.
    if (p.cue != null && p.cue !== L.cue) { L.cue = p.cue; m.gesture = { kind: p.activity === 'tend' ? 'pickup' : 'door-push', start: performance.now() / 1000 - (t - p.cue) / 1000 }; }
    // Holding the role's prop (documents pose), or presenting an order; never while waving or walking.
    const waving = !!m.emote && (m.emoteUntil ?? 0) > Date.now(), serving = performance.now() < L.serveUntil;
    m.holding = !!prop && !waving && m.speed < .08 && (serving || p.activity === 'hold');
    const hands = avatars.get(key);
    if (prop && m.holding && hands?.holding) {
      if (!prop.parent) g.parent?.add(prop);
      prop.visible = true; prop.position.copy(hands.ball); prop.rotation.set(prop.userData.upright ? 0 : PROP_TILT, g.rotation.y, 0, 'YXZ');
    }
    tag.current.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion);
    const seen = g.position.distanceToSquared(camera.position); tag.current.visible = seen > 9 && seen < 900;
  });
  return <group ref={group} name={key}>
    <AvatarBoundary accent={def.appearance.accent}><Suspense fallback={null}><Avatar id={key} config={config} motion={() => motion.current} /></Suspense></AvatarBoundary>
    {/* Campus characters' tags: their name and role, never a player's ✓ or handle. */}
    <group ref={tag} position={[0, 2.22, 0]} name={`npc-tag:${id}`}>
      <Label text={def.name} p={[0, 0, 0]} width={2.3} height={.34} background="#5b3a22" />
      <Label text={def.role.toUpperCase()} p={[0, -.29, 0]} width={1.9} height={.21} color="#f2d69a" background="#2a1d14" />
    </group>
  </group>;
}
