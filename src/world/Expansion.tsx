import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BUILDINGS, DISTRICTS, EXPANSION_WALLS, EXPANSION_TABLES, EXPANSION_PATHS, PARKING, ROADS, STOPS } from '../../shared/expansion.mjs';
import { player, useGame } from '../state';
import { Kit, flatRoof, hipRoof, windowUnit } from './architecture/kit';
import { sign, place } from './architecture/signage';
import type { Materials } from './materials';

function disposeGeometry(g:THREE.Group){g.traverse(o=>{if((o as THREE.Mesh).isMesh)(o as THREE.Mesh).geometry.dispose();});}
function districtDetail(id:string,lib:Materials){
 const kit=new Kit(),g=new THREE.Group(),district=DISTRICTS.find(d=>d.id===id)!;
 for(const b of BUILDINGS.filter(b=>b.district===id)){
  for(const c of EXPANSION_WALLS.filter(c=>Math.abs(c.x-b.x)<=16&&Math.abs(c.z-b.z)<=14))kit.box('stucco',[c.x,c.h/2,c.z],[c.w,c.h,c.d],{color:b.color});
  kit.box('terrazzo',[b.x,.01,b.z],[b.w,.02,b.d]);
  flatRoof(kit,b.x-15.4,b.x+15.4,b.z-13.4,b.z+13.4,b.h,{eave:.5});
  if(id==='residential'||id==='student-life')hipRoof(kit,'roofRed',b.x-16,b.x+16,b.z-14,b.z+14,b.h+.2,.22);
  // Covered entrance, fins, window frames and upper-storey glazing give each facade depth.
  kit.box('concrete',[b.x,3.6,b.z+15],[10,.25,5]);
  for(const x of [-4,4])kit.box('paintDark',[b.x+x,1.75,b.z+16.5],[.18,3.5,.18]);
  for(const x of [-12,-7,7,12])kit.within([b.x+x,0,b.z+13.24],0,()=>{
   windowUnit(kit,{x0:-1.5,x1:1.5,y0:1.1,y1:3},{mullion:1});
   windowUnit(kit,{x0:-1.5,x1:1.5,y0:4.7,y1:6.3},{mullion:1});
   kit.box('paintTerracotta',[1.9,3.5,.4],[.16,6,1.1]);
  });
  for(const t of EXPANSION_TABLES.filter(t=>Math.abs(t.x-b.x)<14&&Math.abs(t.z-b.z)<12)){
   kit.box('wood',[t.x,.75,t.z],[t.w,.07,t.d]);for(const dx of [-.65,.65])kit.box('darkMetal',[t.x+dx,.36,t.z],[.06,.72,.48]);
  }
  kit.box('paintGreen',[b.x,1.9,b.z-12.7],[9,2,.07]);
  g.add(place(sign({text:b.name,kind:'panel',width:9,height:.75,background:'#233e34',color:'#f7ead2'}),[b.x,3.02,b.z+13.3]));
  g.add(place(sign({text:id==='academic'||id==='learning'?'SHARED LEARNING · DEMONSTRATION':'WELCOME · COMMON ROOM',kind:'panel',width:7,height:.5,background:'#233e34',color:'#f7ead2'}),[b.x,2.3,b.z-12.6]));
 }
 const stop=STOPS.find(s=>s.id===id)!;
 kit.box('paintDark',[stop.x,2.65,stop.z],[7,.16,3]);
 for(const x of [-3,3])kit.box('darkMetal',[stop.x+x,1.3,stop.z+1],[.1,2.6,.1]);
 kit.box('wood',[stop.x,.5,stop.z+1],[5,.1,.5]);
 g.add(place(sign({text:`${district.name}\nSHUTTLE STOP · communal fleet`,kind:'panel',width:5,height:1,background:'#234738',color:'#f7ead2'}),[stop.x,2,stop.z-1],Math.PI));
 if(id==='recreation'){
  const x=district.x-100,z=district.z-90;
  kit.box('courtGreen',[x,.012,z],[68,.02,105]);
  for(const dx of [-34,34])kit.box('lineWhite',[x+dx,.03,z],[.12,.02,105]);
  for(const dz of [-52.5,0,52.5])kit.box('lineWhite',[x,.03,z+dz],[68,.02,.12]);
  for(const dz of [-52.5,52.5]){for(const dx of [-3.66,3.66])kit.box('paintWhite',[x+dx,1.22,z+dz],[.12,2.44,.12]);kit.box('paintWhite',[x,2.44,z+dz],[7.44,.12,.12]);}
 }
 g.add(kit.build(lib,`district:${id}`));return g;
}
function District({id,lib}:{id:string;lib:Materials}){
 const [near,setNear]=useState(false),elapsed=useRef(0),quality=useGame(s=>s.quality),d=DISTRICTS.find(d=>d.id===id)!;
 useFrame((_,dt)=>{elapsed.current+=dt;if(elapsed.current<.5)return;elapsed.current=0;const range=quality==='low'?220:350;const distance=Math.hypot(player.x-d.x,player.z-d.z);setNear(old=>distance<(old?range+70:range));});
 return near?<Detail id={id} lib={lib}/>:<>{BUILDINGS.filter(b=>b.district===id).map(b=><mesh key={b.id} position={[b.x,b.h/2,b.z]} material={lib.stucco}><boxGeometry args={[b.w,b.h,b.d]}/></mesh>)}</>;
}
function Detail({id,lib}:{id:string;lib:Materials}){const g=useMemo(()=>districtDetail(id,lib),[id,lib]);useEffect(()=>()=>disposeGeometry(g),[g]);return <primitive object={g}/>;}
function AvenueTrees(){
 const trunks=useRef<THREE.InstancedMesh>(null!),leaves=useRef<THREE.InstancedMesh>(null!);
 const trees=useMemo(()=>ROADS.flatMap((r,ri)=>{const length=Math.hypot(r.a.x-r.b.x,r.a.z-r.b.z),dx=(r.b.x-r.a.x)/length,dz=(r.b.z-r.a.z)/length;return Array.from({length:Math.floor(length/35)},(_,i)=>[-1,1].map(s=>({x:r.a.x+dx*(i*35+18)+dz*s*18,z:r.a.z+dz*(i*35+18)-dx*s*18,h:6+((i+ri)%4)}))).flat();}).filter(p=>Math.abs(p.x)>90||Math.abs(p.z)>90),[]);
 useEffect(()=>{const o=new THREE.Object3D();trees.forEach((t,i)=>{o.position.set(t.x,t.h/2,t.z);o.scale.set(.4,t.h,.4);o.updateMatrix();trunks.current.setMatrixAt(i,o.matrix);o.position.y=t.h;o.scale.set(4,2.6,4);o.updateMatrix();leaves.current.setMatrixAt(i,o.matrix);});trunks.current.instanceMatrix.needsUpdate=true;leaves.current.instanceMatrix.needsUpdate=true;trunks.current.computeBoundingSphere();leaves.current.computeBoundingSphere();},[trees]);
 return <><instancedMesh ref={trunks} args={[undefined,undefined,trees.length]}><cylinderGeometry args={[1,1,1,6]}/><meshStandardMaterial color="#635140"/></instancedMesh><instancedMesh ref={leaves} args={[undefined,undefined,trees.length]}><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color="#527747" roughness={1}/></instancedMesh></>;
}
export default function Expansion({lib}:{lib:Materials}){
 const network=useMemo(()=>{const k=new Kit();for(const r of ROADS){const x=(r.a.x+r.b.x)/2,z=(r.a.z+r.b.z)/2,w=Math.abs(r.a.x-r.b.x)+12,d=Math.abs(r.a.z-r.b.z)+12;
  k.box('paversGrey',[x,.005,z],[w+5,.02,d+5]);k.box('asphalt',[x,.021,z],[w,.018,d]);
  const length=Math.hypot(r.a.x-r.b.x,r.a.z-r.b.z),dx=(r.b.x-r.a.x)/length,dz=(r.b.z-r.a.z)/length;
  for(let a=12;a<length-12;a+=14)k.box('lineWhite',[r.a.x+dx*a,.036,r.a.z+dz*a],[dx?5:.13,.01,dz?5:.13]);
 }
 for(const p of PARKING){k.box('asphalt',[p.x,.02,p.z],[p.w,.03,p.d]);k.box('asphalt',[p.x,.02,p.z-12],[12,.03,24]);for(let x=-15;x<=15;x+=3)k.box('lineWhite',[p.x+x,.042,p.z+6],[.1,.01,8]);}
 for(const p of EXPANSION_PATHS)k.box('pavers',[p.x,.025,p.z],[p.w,.03,p.d]);
 k.box('asphalt',[8,.02,62],[16,.03,14]);
 return k.build(lib,'campus-roads');},[lib]);
 useEffect(()=>()=>disposeGeometry(network),[network]);
 return <group name="open-world"><primitive object={network}/><AvenueTrees/>{DISTRICTS.map(d=><District key={d.id} id={d.id} lib={lib}/>)}</group>;
}
