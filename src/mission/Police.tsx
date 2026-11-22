// Metro Police officers and city pedestrians around the player, drawn from the room's mission state.
// Officers are their seated crew first: the duty avatar plays the vehicle-exit transition from the car door, walks
// and searches; once they draw weapons at cover the armed rig takes over (src/mission/ArmedOfficer.tsx).
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { player, useGame } from '../state';
import { surfaceHeight } from '../world/layout';
import { useGetaway } from './client';

const ArmedOfficer = lazy(() => import('./ArmedOfficer'));
const CREW = ['tunde', 'ibrahim', 'chidi', 'kelechi', 'ngozi', 'amara'];
const ARMED = new Set(['deploy', 'cover', 'aim', 'fire', 'down']);

function constable(id: string, side: number) {
  const n = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return { model: CREW[(n + (side > 0 ? 1 : 0)) % CREW.length], skin: 'natural', accent: '#263545', accessory: 'none' };
}
function Officer({ id }: { id: string }) {
  const first = useGetaway.getState().mission?.officers?.find(o => o.id === id);
  const config = useMemo(() => constable(id, first?.side ?? 1), [id, first?.side]);
  const root = useRef<THREE.Group>(null!);
  const motion = useRef<AvatarMotion>({ speed: 0, y: 0, vy: 0 });
  const dismount = useRef(false), [armed, setArmed] = useState(false), [rig, setRig] = useState(false);
  const ready = useCallback((r: boolean) => setRig(r), []);
  useFrame((_, raw) => {
    const at = useGetaway.getState().mission?.officers?.find(o => o.id === id);
    const g = root.current, m = motion.current, dt = Math.min(raw, .12);
    const wantArmed = !!at && ARMED.has(at.mode);
    if (wantArmed !== armed) setArmed(wantArmed);
    g.visible = !!at && Math.hypot(at.x - player.x, at.z - player.z) < 88 && at.mode !== 'seated' && !(wantArmed && rig);
    if (!at) return;
    const gap = Math.hypot(at.x - g.position.x, at.z - g.position.z);
    if (gap > 5) g.position.set(at.x, surfaceHeight(at.x, at.z), at.z);
    const x = g.position.x, z = g.position.z;
    g.position.x = THREE.MathUtils.damp(x, at.x, 17, dt);
    g.position.z = THREE.MathUtils.damp(z, at.z, 17, dt);
    g.position.y = surfaceHeight(g.position.x, g.position.z);
    const angle = Math.atan2(Math.sin(at.yaw - g.rotation.y), Math.cos(at.yaw - g.rotation.y));
    g.rotation.y += angle * (1 - Math.exp(-18 * dt));
    m.speed = Math.min(3.6, Math.hypot(x - g.position.x, z - g.position.z) / Math.max(.001, dt));
    m.coverPose = at.mode === 'cover';
    if (!dismount.current && at.mode === 'dismount' && !useGame.getState().reducedMotion) {
      dismount.current = true;
      m.vehicleMotion = { kind: 'vehicle-exit', start: performance.now() / 1000 - at.age, x: at.seat.x - at.x, z: at.seat.z - at.z, seatHeight: .5 };
    }
    if (at.mode === 'board' && dismount.current) { dismount.current = false; m.vehicleMotion = null; }
  });
  return <>
    <group ref={root} name={'getaway:officer:' + id} position={[first?.x ?? 0, 0, first?.z ?? 0]} rotation-y={first?.yaw ?? 0}>
      <AvatarBoundary accent={config.accent}><Suspense fallback={null}>
        <Avatar config={config} id={'officer:' + id} duty motion={() => motion.current}/>
      </Suspense></AvatarBoundary>
    </group>
    {(armed || rig) && <Suspense fallback={null}><ArmedOfficer id={id} onReady={ready}/></Suspense>}
  </>;
}

/** City pedestrians (room-simulated near the player): walking, talking, watching, running and cowering. */
function Civilian({ id }: { id: string }) {
  const first = useGetaway.getState().mission?.civilians?.find(c => c.id === id);
  const config = useMemo(() => ({ model: first?.model ?? 'ada', skin: 'natural', accent: ['#5a6b5d', '#7a5b46', '#4b5a78', '#7a4b5e'][id.length % 4], accessory: 'none' }), [id, first?.model]);
  const root = useRef<THREE.Group>(null!), motion = useRef<AvatarMotion>({ speed: 0, y: 0, vy: 0 });
  useFrame((_, raw) => {
    const c = useGetaway.getState().mission?.civilians?.find(c => c.id === id), g = root.current, m = motion.current, dt = Math.min(raw, .12);
    g.visible = !!c && Math.hypot(c.x - player.x, c.z - player.z) < 90;
    if (!c) return;
    if (Math.hypot(c.x - g.position.x, c.z - g.position.z) > 6) g.position.set(c.x, 0, c.z);
    const x = g.position.x, z = g.position.z;
    g.position.x = THREE.MathUtils.damp(x, c.x, 9, dt); g.position.z = THREE.MathUtils.damp(z, c.z, 9, dt);
    g.position.y = surfaceHeight(g.position.x, g.position.z);
    g.rotation.y += Math.atan2(Math.sin(c.yaw - g.rotation.y), Math.cos(c.yaw - g.rotation.y)) * (1 - Math.exp(-10 * dt));
    m.speed = Math.min(6, Math.hypot(x - g.position.x, z - g.position.z) / Math.max(.001, dt));
    m.sprinting = c.mode === 'flee';
    m.coverPose = c.mode === 'cower';
  });
  return <group ref={root} name={'getaway:civilian:' + id} position={[first?.x ?? 0, 0, first?.z ?? 0]}>
    <AvatarBoundary accent={config.accent}><Suspense fallback={null}><Avatar config={config} id={'civilian:' + id} motion={() => motion.current}/></Suspense></AvatarBoundary>
  </group>;
}

export default function Police() {
  const ids = useGetaway(useShallow(s => s.mission?.officers?.map(o => o.id) ?? []));
  const low = useGame(s => s.quality === 'low');
  const people = useGetaway(useShallow(s => (s.mission?.civilians ?? []).slice(0, low ? 6 : 12).map(c => c.id)));
  return <>{ids.map(id => <Officer key={id} id={id}/>)}{people.map(id => <Civilian key={id} id={id}/>)}</>;
}
