import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { player, useGame } from '../state';
import { surfaceHeight } from '../world/layout';
import { useGetaway } from './client';

function constable(id: string, side: number) {
  return { model: id.includes('unit-2') ? side > 0 ? 'chidi' : 'kelechi' : side > 0 ? 'ibrahim' : 'tunde',
    skin: 'natural', accent: '#263545', accessory: 'none' };
}
function Officer({ id }: { id: string }) {
  const first = useGetaway.getState().mission?.officers?.find(o => o.id === id);
  const config = useMemo(() => constable(id, first?.side ?? 1),[id,first?.side]);
  const root = useRef<THREE.Group>(null!);
  const motion = useRef<AvatarMotion>({speed:0,y:0,vy:0});
  const dismount = useRef(false);
  useFrame((_,raw) => {
    const at = useGetaway.getState().mission?.officers?.find(o => o.id === id);
    const g = root.current, m = motion.current, dt = Math.min(raw,.12);
    g.visible = !!at && Math.hypot(at.x-player.x,at.z-player.z) < 88;
    if (!at) return;
    const gap = Math.hypot(at.x-g.position.x,at.z-g.position.z);
    if (gap > 5) g.position.set(at.x,surfaceHeight(at.x,at.z),at.z);
    const x = g.position.x, z = g.position.z;
    g.position.x = THREE.MathUtils.damp(x,at.x,17,dt);
    g.position.z = THREE.MathUtils.damp(z,at.z,17,dt);
    g.position.y = surfaceHeight(g.position.x,g.position.z);
    const angle = Math.atan2(Math.sin(at.yaw-g.rotation.y),Math.cos(at.yaw-g.rotation.y));
    g.rotation.y += angle*(1-Math.exp(-18*dt));
    m.speed = Math.min(2.3,Math.hypot(x-g.position.x,z-g.position.z)/Math.max(.001,dt));
    m.coverPose = at.mode === 'cover';
    if (!dismount.current && at.mode === 'dismount' && !useGame.getState().reducedMotion) {
      dismount.current=true;
      m.vehicleMotion={kind:'vehicle-exit',start:performance.now()/1000-at.age,
        x:at.seat.x-at.x,z:at.seat.z-at.z,seatHeight:.5};
    }
  });
  return <group ref={root} name={'getaway:officer:'+id} position={[first?.x??0,0,first?.z??0]} rotation-y={first?.yaw??0}>
    <AvatarBoundary accent={config.accent}><Suspense fallback={null}>
      <Avatar config={config} id={'officer:'+id} duty motion={()=>motion.current}/>
    </Suspense></AvatarBoundary>
  </group>;
}

export default function Police() {
  const ids = useGetaway(useShallow(s => s.mission?.officers?.map(o=>o.id) ?? []));
  return <>{ids.map(id=><Officer key={id} id={id}/>)}</>;
}
