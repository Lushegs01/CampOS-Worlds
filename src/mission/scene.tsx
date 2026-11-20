import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';
import { CONTACT, WAREHOUSE, INDUSTRIAL_SOLIDS, DISTRICT, BARREL, PACKAGE, SAFEHOUSE, O } from '../../shared/getaway.mjs';
import { input, player, useGame } from '../state';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { loadModel } from '../world/assets';
import { SPECS } from '../arena/scene/weaponSpecs';
import { Label } from '../world/Primitives';
import { surfaceHeight } from '../world/layout';
import { VehicleModel } from '../world/Vehicles';
import { activeCombat, onMissionEvent, shotInput, useGetaway, type Actor, type MissionEvent } from './client';
import { missionSound, tickMissionSound, stopMissionSound } from './sound';

const CONTACT_AVATAR = { model: 'zainab', skin: 'natural', accent: '#506b96', accessory: 'none' };
const GUARD_AVATAR = { model: 'chidi', skin: 'natural', accent: '#353c4c', accessory: 'none' };
const OPERATIVE_AVATAR = { model: 'ibrahim', skin: 'natural', accent: '#b05f49', accessory: 'none' };
type XYZ = [number, number, number];
const staticBox = new THREE.BoxGeometry(1, 1, 1);
const materials = Object.fromEntries(Object.entries({
  pavement:'#535759', concrete:'#8a8980', steel:'#566363', iron:'#354448', rust:'#8b5240',
  crate:'#8a6941', gold:'#dfa748', roof:'#3e4849', glass:'#778d91', shutter:'#586062', black:'#232c2d',
}).map(([key,color])=>[key,new THREE.MeshStandardMaterial({color,roughness:key==='glass'?.29:.84,metalness:key==='iron'?.22:.04})]));
function Box({ p, size, mat, cast = false }: { p: XYZ; size: XYZ; mat: keyof typeof materials; cast?: boolean }) {
  return <mesh position={p} scale={size} geometry={staticBox} material={materials[mat]} dispose={null} receiveShadow castShadow={cast}/>;
}
function MeshAsset({ file, fit, cast = true, children }: { file: string; fit?: XYZ; cast?: boolean; children?: React.ReactNode }) {
  const [model,setModel]=useState<{file:string;object:THREE.Group;size:THREE.Vector3}|null>(null);
  useEffect(()=>{
    let current=true;
    void loadModel(file,{priority:2,retries:2,stallMs:12000,timeoutMs:45000}).then(g=>{
      if(!current)return;
      const object=g.scene.clone(true);
      object.traverse(o=>{if((o as THREE.Mesh).isMesh){o.castShadow=cast;o.receiveShadow=true;}});
      const size=new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      setModel({file,object,size});
    }).catch(()=>{});
    return ()=>{current=false;};
  },[file,cast]);
  if(model?.file!==file)return children;
  const scale:XYZ=fit?[fit[0]/model.size.x,fit[1]/model.size.y,fit[2]/model.size.z]:[1,1,1];
  return <group scale={scale}><primitive object={model.object}/></group>;
}
function FreightContainer({ size }: {size:XYZ}){
  const low=useGame(s=>s.quality==='low');
  const long=size[0]>=size[2], fit:XYZ=long?size:[size[2],size[1],size[0]];
  return <group rotation-y={long?0:Math.PI/2}><MeshAsset file={`getaway/freightContainer${low?'Low':''}.glb`} fit={fit}>
    <Box p={[0,size[1]*.5,0]} size={fit} mat="steel"/>
  </MeshAsset></group>;
}
const Architecture = memo(function Architecture() {
  return <>
    <Box p={[DISTRICT.x,-.08,14]} size={[DISTRICT.w,.15,88]} mat="pavement"/>
    <Box p={[191,.01,13]} size={[28,.03,23]} mat="concrete"/>
    <Box p={[191,7.12,12.4]} size={[30,.33,24.4]} mat="roof" cast/>
    {[4,10,17,23].map(z=><group key={z} position={[191,6.2,z]}><MeshAsset file="getaway/warehouseTruss.glb"/></group>)}
    <Box p={[191,5.3,24.16]} size={[10,.68,.68]} mat="iron" cast/>
    <Box p={[191,.018,26]} size={[8.1,.04,.15]} mat="gold"/>
    <Label text="BAY 04  ·  ORISUN FREIGHT" p={[191,6,24.53]} width={8.4} height={.68} background="#303b3c" color="#f5da9c"/>
    {INDUSTRIAL_SOLIDS.map((b,index)=>{
      const crate=b.kind==='crate', container=b.kind==='container', depot=b.kind==='depot'||b.kind==='safehouse';
      const style=crate?'crate':container?index%2?'steel':'rust':depot?'concrete':'steel';
      return <group key={index} position={[b.x,0,b.z]}>
        {container ? <FreightContainer size={[b.w,b.h,b.d]}/> : crate ?
          <MeshAsset file="arena/props/milCrate.glb" fit={[b.w,b.h,b.d]}><Box p={[0,b.h/2,0]} size={[b.w,b.h,b.d]} mat="crate"/></MeshAsset>
          : <Box p={[0,b.h/2,0]} size={[b.w,b.h,b.d]} mat={style} cast/>}
        {depot&&<>
          <Box p={[0,b.h,0]} size={[b.w+.47,.25,b.d+.47]} mat="roof" cast/>
          <Box p={[0,1.65,b.d/2+.033]} size={[Math.min(4.6,b.w-.6),3.3,.08]} mat="shutter"/>
          <Box p={[0,b.h-.97,b.d/2+.045]} size={[b.w*.54,.65,.09]} mat="glass"/>
        </>}
      </group>;
    })}
    {[-1,1].map(s=><group key={s} position={[191+s*8,0,26]}>
      <Box p={[0,2.5,0]} size={[.14,5,.14]} mat="black" cast/>
      <Box p={[0,5,0]} size={[.6,.18,.38]} mat="gold"/>
    </group>)}
    {[209,215,221].map(x=><group key={x} position={[x,0,46]}>
      {[-1,1].map(s=><Box key={s} p={[s*1.84,.012,0]} size={[.1,.018,7.8]} mat="gold"/>)}
      <Box p={[0,.012,-3.9]} size={[3.68,.018,.1]} mat="gold"/>
    </group>)}
    <Label text="FREIGHT GATE" p={[CONTACT.x,3.3,CONTACT.z-1]} width={4.8} height={.56} background="#303b3c"/>
    <Label text="MAINTENANCE" p={[275.9,3.2,-35]} rotation={-Math.PI/2} width={4.2} height={.53} background="#303b3c"/>
  </>;
});
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
function Gun({ kind, held=false }: { kind: string; held?: boolean }) {
  const pistol=kind==='sparrow',shotgun=kind==='bastion',length=pistol?.235:shotgun?.61:.49;
  const spec=SPECS[kind];
  return <group position-z={spec?-(spec.grip[1]-.085):0}>
    <MeshAsset file={`arena/weapons/${kind}${held&&useGame.getState().quality!=='low'?'':'-lod'}.glb`} cast={false}>
      <group position-z={length}><Box p={[0,0,-length/2]} size={[.093,.105,length]} mat={shotgun?'crate':'black'}/>
      <Box p={[0,-.1,-.055]} size={[.063,.18,.095]} mat="black"/></group>
    </MeshAsset>
    {held&&<Box p={[.036,-.083,(spec?.grip[1]??.12)+.01]} size={[.085,.095,.17]} mat="crate"/>}
  </group>;
}
function Hostile({ id }: { id: string }) {
  const root=useRef<THREE.Group>(null!), tag=useRef<THREE.Group>(null!), body=useRef<THREE.Group>(null!);
  const seen=useRef<Actor|null>(null),hurtAt=useRef(-1000),motion=useMemo(bodyMotion,[]);
  const a=useGetaway.getState().mission?.actors.find(enemy=>enemy.id===id);
  const config=a?.kind==='operative'?OPERATIVE_AVATAR:GUARD_AVATAR;
  useFrame(({camera},raw)=>{
    const actor=useGetaway.getState().mission?.actors.find(o=>o.id===id), g=root.current, dt=Math.min(raw,.12);
    if(!actor){g.visible=false;return;}
    g.visible=Math.hypot(player.x-actor.x,player.z-actor.z)<100;
    const previous=seen.current;
    if(!previous||Math.hypot(g.position.x-actor.x,g.position.z-actor.z)>8)g.position.set(actor.x,0,actor.z);
    if(previous&&actor.hp<previous.hp)hurtAt.current=performance.now();
    const x=THREE.MathUtils.damp(g.position.x,actor.x,15,dt),z=THREE.MathUtils.damp(g.position.z,actor.z,15,dt);
    motion.speed=Math.hypot(x-g.position.x,z-g.position.z)/Math.max(dt,.001);
    g.position.set(x,surfaceHeight(x,z),z);
    const turn=Math.atan2(Math.sin(actor.yaw-g.rotation.y),Math.cos(actor.yaw-g.rotation.y));
    motion.turn=turn;g.rotation.y+=turn*(1-Math.exp(-dt*13));
    body.current.rotation.x=THREE.MathUtils.damp(body.current.rotation.x,actor.hp<=0?Math.PI/2:0,8,dt);
    body.current.rotation.z=actor.hp>0?.18*Math.exp(-(performance.now()-hurtAt.current)/200):0;
    body.current.position.y=actor.mode==='cover'||actor.mode==='retreat'?-.15:0;
    tag.current.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion);
    tag.current.visible=actor.hp>0&&Math.hypot(x-player.x,z-player.z)<28;
    seen.current=actor;
  });
  return <group ref={root} position={[a?.x??WAREHOUSE.x,0,a?.z??WAREHOUSE.z]}>
    <group ref={body}><AvatarBoundary accent={config.accent}><Suspense fallback={null}><Avatar id={id} config={config} motion={()=>motion}/></Suspense></AvatarBoundary>
      <group position={[.25,1.12,.38]} rotation-y={Math.PI}><Gun kind={a?.kind==='guard'?'sparrow':'vanguard'}/></group>
    </group>
    <group ref={tag}><mesh position={[0,2.12,0]}><circleGeometry args={[.07,4]}/><meshBasicMaterial color="#ec875e"/></mesh></group>
  </group>;
}
function YardAlarm(){
  const lamps=useRef<THREE.Group>(null!);
  useFrame(({clock})=>{
    const live=(useGetaway.getState().mission?.wanted??0)>0;
    lamps.current.visible=live&&(useGame.getState().reducedMotion||Math.floor(clock.elapsedTime*3)%2===0);
  });
  return <group ref={lamps} visible={false}>{[-1,1].map(side=><mesh key={side} position={[191+side*8,5.01,26.21]}><boxGeometry args={[.46,.14,.05]}/><meshBasicMaterial color="#ff402c"/></mesh>)}</group>;
}
function FirstPerson() {
  const flash=useRef<THREE.Mesh>(null!);
  const root=useRef<THREE.Group>(null!),hand=useRef<THREE.Group>(null!);
  const id=useGetaway(s=>s.mission?.gun.id ?? 'sparrow');
  const offset=useMemo(()=>new THREE.Vector3(),[]);
  useFrame(({camera,clock},dt)=>{
    const {mission,aim}=useGetaway.getState(),g=root.current;
    g.visible=activeCombat(mission)&&!mission?.failed;
    if(!g.visible)return;
    const since=performance.now()-shotInput.recoilAt;
    const k=Math.exp(-since/90), reload=mission?.reloading??0;
    flash.current.visible=since<70&&!useGame.getState().reducedMotion;
    g.position.copy(camera.position);g.quaternion.copy(camera.quaternion);
    const sway=useGame.getState().reducedMotion?0:Math.sin(clock.elapsedTime*8)*Math.min(.012,player.speed*.002);
    offset.set(aim?.06:.27,-.23+sway-(reload?.19:0),-.45);
    hand.current.position.lerp(offset,1-Math.exp(-dt*16));hand.current.position.z+=k*.045;
    hand.current.rotation.x=reload?-.53:k*.12;
    hand.current.rotation.z=reload?.42:0;
  });
  const bore=SPECS[id]?.grip[1]??.18;
  return <group ref={root} visible={false}><group ref={hand}><Gun kind={id} held/>
    <mesh ref={flash} position-z={-bore+.055}><octahedronGeometry args={[.055,0]}/><meshBasicMaterial color="#ffca6c" toneMapped={false}/></mesh>
  </group></group>;
}

const MAX_SPARKS=48;
function Effects() {
  const root=useRef<THREE.Group>(null!),puff=useRef<THREE.InstancedMesh>(null!), streak=useRef<THREE.InstancedMesh>(null!);
  const light=useRef<THREE.PointLight>(null!);
  const flash=useRef(-Infinity);
  const smoke=useRef<{t:number;life:number;position:THREE.Vector3;velocity:THREE.Vector3;scale:number;color:THREE.Color}[]>([]);
  const lines=useRef<{t:number;a:THREE.Vector3;b:THREE.Vector3}[]>([]);
  const dummy=useMemo(()=>new THREE.Object3D(),[]), delta=useMemo(()=>new THREE.Vector3(),[]), up=useMemo(()=>new THREE.Vector3(0,1,0),[]);
  useEffect(()=>{
    const off=onMissionEvent((e:MissionEvent)=>{
      missionSound(e);
      const now=performance.now()/1000;
      const at = new THREE.Vector3(e.x,e.y,e.z);
      if(e.end){
        const end = new THREE.Vector3(...e.end), origin = at.clone().lerp(end,.025);
        lines.current.push({t:now,a:origin,b:end});
        if(lines.current.length>12)lines.current.shift();
        if(e.impact)smoke.current.push({t:now,life:.42,position:end,velocity:new THREE.Vector3(0,.4,0),scale:.12,color:new THREE.Color('#f9c579')});
        if(e.kind==='enemyShot')smoke.current.push({t:now,life:.16,position:origin,velocity:new THREE.Vector3(),scale:.26,color:new THREE.Color('#ffe0aa')});
      }
      if(e.kind==='blast'){
        flash.current=now;light.current.position.copy(at);
        const cfg=useGame.getState(),count=cfg.reducedMotion?12:cfg.quality==='low'?22:40;
        for(let i=0;i<count;i++){
          const theta=i*2.4,v=1+(i%7)*.59,fire=i%3===0;
          smoke.current.push({t:now,life:fire?1.25:3+i%4*.37,position:at.clone(),
            velocity:new THREE.Vector3(Math.sin(theta)*v,1+(i%5)*.65,Math.cos(theta)*v),
            scale:fire?.64:.95,color:new THREE.Color(fire?'#f78931':'#4a4b48')});
        }
      }
      while(smoke.current.length>MAX_SPARKS)smoke.current.shift();
    });
    return ()=>{off();stopMissionSound();};
  },[]);
  useFrame(()=>{
    const now=performance.now()/1000,n=now-flash.current;
    light.current.intensity=n<.21&&!useGame.getState().reducedMotion?Math.max(0,170*(1-n/.21)):0;
    const m=useGetaway.getState().mission;
    tickMissionSound(m);
    if(!m){smoke.current.length=0;lines.current.length=0;}
    smoke.current=smoke.current.filter(p=>now-p.t<p.life);
    lines.current=lines.current.filter(p=>now-p.t<.105);
    let count=0;
    for(const p of smoke.current){
      const age=now-p.t;
      dummy.position.copy(p.position).addScaledVector(p.velocity,Math.sqrt(age));
      dummy.quaternion.identity();
      dummy.scale.setScalar(Math.max(.01,(1-age/p.life)*p.scale*(1+age)));
      dummy.updateMatrix();puff.current.setMatrixAt(count,dummy.matrix);puff.current.setColorAt(count++,p.color);
    }
    puff.current.count=count;puff.current.instanceMatrix.needsUpdate=!!count;
    if(puff.current.instanceColor)puff.current.instanceColor.needsUpdate=!!count;
    count=0;
    for(const l of lines.current){
      delta.subVectors(l.b,l.a);dummy.position.copy(l.a).lerp(l.b,.5);
      dummy.scale.set(.017,delta.length(),.017);dummy.quaternion.setFromUnitVectors(up,delta.normalize());dummy.updateMatrix();
      streak.current.setMatrixAt(count++,dummy.matrix);
    }
    streak.current.count=count;streak.current.instanceMatrix.needsUpdate=!!count;
  });
  return <group ref={root}>
    <instancedMesh ref={puff} args={[undefined,undefined,MAX_SPARKS]} frustumCulled={false}><icosahedronGeometry args={[1,0]}/><meshStandardMaterial roughness={.9}/></instancedMesh>
    <instancedMesh ref={streak} args={[undefined,undefined,12]} frustumCulled={false}><boxGeometry/><meshBasicMaterial color="#ffbd70" transparent opacity={.72}/></instancedMesh>
    <pointLight ref={light} color="#ff8d50" distance={23} intensity={0}/>
  </group>;
}

export default function GetawayScene() {
  const stage=useGetaway(s=>s.mission?.stage??null), blast=useGetaway(s=>s.mission?.exploded??false);
  const ids=useGetaway(useShallow(s=>s.mission?.actors.map(a=>a.id)??[]));
  const vehicleIds=useGetaway(useShallow(s=>s.mission?.vehicles.map(v=>v.id)??[]));
  const mark=useGetaway(useShallow(s=>s.mission?.mark??null));
  const vehicles=useGetaway.getState().mission?.vehicles;
  return <>
    <Architecture/><YardAlarm/>
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
    {blast&&stage!==null&&stage<O.safehouse&&<Box p={[BARREL.x,.075,BARREL.z]} size={[1.5,.14,.55]} mat="black"/>}
    {mark&&<group position={[mark.x,.045,mark.z]}>
      <mesh rotation-x={-Math.PI/2}><torusGeometry args={[.7,.035,6,32]}/><meshBasicMaterial color="#ffc979"/></mesh>
      <mesh position-y={1.35}><cylinderGeometry args={[.023,.16,2.7,8]}/><meshBasicMaterial color="#ffd294" transparent opacity={.42} depthWrite={false}/></mesh>
    </group>}
    {ids.map(id=><Hostile key={id} id={id}/>)}
    {vehicleIds.map(id=><VehicleModel key={id} id={id} type={vehicles?.find(v=>v.id===id)?.type??'car'}/>)}
    <Effects/><FirstPerson/>
  </>;
}
