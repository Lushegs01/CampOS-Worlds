import { lazy, Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';
import { CONTACT, BARREL, PACKAGE, SAFEHOUSE, O } from '../../shared/getaway.mjs';
import { player, useGame } from '../state';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { MeshAsset, type XYZ } from './meshAsset';
import IndustrialDistrict from './IndustrialDistrict';
import type { Materials } from '../world/materials';
import { Label } from '../world/Primitives';
import { surfaceHeight } from '../world/layout';
import { VehicleModel } from '../world/Vehicles';
import { useGetaway } from './client';
import GetawayEffects from './effects';

const CombatPresentation = lazy(() => import('./presentation'));

const CONTACT_AVATAR = { model: 'zainab', skin: 'natural', accent: '#506b96', accessory: 'none' };
const staticBox = new THREE.BoxGeometry(1, 1, 1);
const materials = {
  black: new THREE.MeshStandardMaterial({ color: '#232c2d', roughness: .84, metalness: .04 }),
  gold: new THREE.MeshStandardMaterial({ color: '#dfa748', roughness: .84, metalness: .04 }),
};
function Box({ p, size, mat, cast = false }: { p: XYZ; size: XYZ; mat: keyof typeof materials; cast?: boolean }) {
  return <mesh position={p} scale={size} geometry={staticBox} material={materials[mat]} dispose={null} receiveShadow castShadow={cast}/>;
}
const bodyMotion = ():AvatarMotion => ({ speed:0,y:0,vy:0,turn:0 });
function Contact({ delivery=false }: { delivery?: boolean }) {
  const here=delivery?SAFEHOUSE:CONTACT;
  const root=useRef<THREE.Group>(null!),motion=useMemo(bodyMotion,[]);
  useFrame((_,dt)=>{
    const nearby=Math.hypot(player.x-here.x,player.z-here.z)<14;
    if(nearby)root.current.rotation.y=THREE.MathUtils.damp(root.current.rotation.y,Math.atan2(player.x-here.x,player.z-here.z),5,dt);
  });
  return <group position={[here.x,surfaceHeight(here.x,here.z),here.z]}><group ref={root}>
    <AvatarBoundary accent={CONTACT_AVATAR.accent}><Suspense fallback={null}><Avatar id="sade" config={CONTACT_AVATAR} motion={()=>motion}/></Suspense></AvatarBoundary>
  </group><Label text="Sade" p={[0,2.16,0]} width={1.35} height={.31} background="#203b33"/></group>;
}
function YardAlarm(){
  const lamps=useRef<THREE.Group>(null!);
  useFrame(({clock})=>{
    const live=(useGetaway.getState().mission?.wanted??0)>0;
    lamps.current.visible=live&&(useGame.getState().reducedMotion||Math.floor(clock.elapsedTime*3)%2===0);
  });
  return <group ref={lamps} visible={false}>{[-1,1].map(side=><mesh key={side} position={[191+side*5.31,2.23,24.634]}><planeGeometry args={[.124,.124]}/><meshBasicMaterial color="#ff633e" toneMapped={false}/></mesh>)}</group>;
}
export default function GetawayScene({ lib }: { lib: Materials }) {
  const stage=useGetaway(s=>s.mission?.stage??null), blast=useGetaway(s=>s.mission?.exploded??false);
  const activeActors=useGetaway(s=>Boolean(s.mission?.actors.length));
  const vehicleIds=useGetaway(useShallow(s=>s.mission?.vehicles.map(v=>v.id)??[]));
  const mark=useGetaway(useShallow(s=>{
    const m=s.mission;
    // When an encounter starts the objective becomes tactical. The former approach beam sat in the centre
    // of the sight picture just as the camera moved to eye height.
    return m && m.stage!==O.combat && !(m.stage===O.ambush&&m.ambushed) ? m.mark : null;
  }));
  const mission=useGetaway.getState().mission;
  const vehicles=mission?.vehicles;
  return <>
    <IndustrialDistrict lib={lib}/><YardAlarm/>
    {stage===null&&<Contact/>}{stage!==null&&stage>=O.safehouse&&<Contact delivery/>}
    {stage!==null&&stage<=O.package&&<group position={[PACKAGE.x,.35,PACKAGE.z]}>
      <MeshAsset file="getaway/intelligenceCase.glb">
        <Box p={[0,0,0]} size={[.78,.31,.5]} mat="black" cast/><Box p={[0,.17,0]} size={[.1,.022,.5]} mat="gold"/>
      </MeshAsset>
    </group>}
    {!blast&&<group position={[BARREL.x,0,BARREL.z]}>
      <MeshAsset file="arena/props/barrel.glb" fit={[.91,1.18,.91]}>
        <mesh position-y={.59} castShadow><cylinderGeometry args={[.45,.45,1.18,16]}/><meshStandardMaterial color="#a74c35" roughness={.65}/></mesh>
      </MeshAsset>
    </group>}
    {blast&&stage!==null&&stage<O.safehouse&&<group name="getaway:fuel-wreck" position={[BARREL.x + .34,.27,BARREL.z + .29]} rotation-z={Math.PI / 2 + .18} scale={[.56,1,.64]}>
      <MeshAsset file="arena/props/barrel.glb" fit={[.91,1.18,.91]}/>
    </group>}
    {mark&&<group position={[mark.x,.045,mark.z]}>
      <mesh rotation-x={-Math.PI/2}><torusGeometry args={[.7,.035,6,32]}/><meshBasicMaterial color="#ffc979"/></mesh>
      {stage!==O.package&&<mesh position-y={.72}><cylinderGeometry args={[.017,.086,1.44,8]}/><meshBasicMaterial color="#ffd294" transparent opacity={.32} depthWrite={false}/></mesh>}
    </group>}
    {stage!==null&&(stage<=O.ambush||activeActors)&&<Suspense fallback={null}><CombatPresentation stage={stage}/></Suspense>}
    {vehicleIds.map(id=><VehicleModel key={id} id={id} type={vehicles?.find(v=>v.id===id)?.type??'car'}/>)}
    <GetawayEffects stage={stage}/>
  </>;
}
