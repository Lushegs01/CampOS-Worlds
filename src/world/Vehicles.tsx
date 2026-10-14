import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { player } from '../state';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { VEHICLE_SPAWNS, VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { vehicleVisuals, tickVehicles } from '../vehicles/client';
import { sign, place } from './architecture/signage';
const materials={paint:new THREE.MeshStandardMaterial({color:'#e8ce8e',metalness:.4,roughness:.32}),green:new THREE.MeshStandardMaterial({color:'#244f42',metalness:.3,roughness:.35}),rubber:new THREE.MeshStandardMaterial({color:'#202422',roughness:.9}),metal:new THREE.MeshStandardMaterial({color:'#a6afb0',metalness:.8,roughness:.3}),glass:new THREE.MeshPhysicalMaterial({color:'#779da3',transparent:true,opacity:.22,roughness:.1,depthWrite:false}),seat:new THREE.MeshStandardMaterial({color:'#4a514d',roughness:.9}),light:new THREE.MeshStandardMaterial({color:'#ffefd0',emissive:'#f9dda5',emissiveIntensity:.5})};
const geometries=new Map<string,THREE.BufferGeometry>();
function rounded(w:number,h:number,d:number,r=.06){const key=[w,h,d,r].join();let g=geometries.get(key);if(!g){g=new RoundedBoxGeometry(w,h,d,2,r);geometries.set(key,g);}return g;}
function buildVehicle(type:keyof typeof VEHICLE_TYPES){const t=VEHICLE_TYPES[type],g=new THREE.Group(),w=t.width,L=t.length,isCart=type==='cart',isBus=type==='shuttle',wheels:THREE.Group[]=[],brake=new THREE.MeshStandardMaterial({color:'#a32122',emissive:'#ff2121',emissiveIntensity:.1});
 const box=(x:number,y:number,z:number,a:number,b:number,c:number,m:THREE.Material,r=.06)=>{const q=new THREE.Mesh(rounded(a,b,c,r),m);q.position.set(x,y,z);q.castShadow=true;g.add(q);return q;};
 box(0,.46,0,w,.25,L,materials.rubber);box(0,.7,0,w,.42,L,isBus?materials.green:materials.paint,.15);
 // Sculpted nose and bonnet, bumpers, passenger cell and glazing; all dimensions in metres.
 box(0,isBus?1.05:.96,L/2-.48,w*.96,isBus?.65:.3,.94,materials.paint,.14);
 box(0,.48,L/2+.02,w*.88,.14,.12,materials.metal);box(0,.48,-L/2-.02,w*.88,.14,.12,materials.metal);
 const roofY=t.height-.1,front=isCart?.75:isBus?L/2-.5:.95,back=-L/2+.45;
 box(0,roofY,(front+back)/2,w*.95,.12,front-back+.3,isBus?materials.paint:materials.green);
 for(const x of [-w*.43,w*.43])for(const z of [front,back])box(x,(roofY+1)/2,z,.07,roofY-1,.08,materials.metal,.02);
 if(!isCart){box(0,(roofY+1.12)/2,front,w*.83,roofY-1.12,.035,materials.glass,.015);box(0,(roofY+1.12)/2,back,w*.83,roofY-1.12,.035,materials.glass,.015);
 for(const side of [-1,1]){box(side*w*.47,1.04,(front+back)/2,.08,.45,front-back,materials.green);box(side*w*.475,(roofY+1.23)/2,(front+back)/2,.035,roofY-1.23,front-back-.12,materials.glass,.01);
  for(let z=back+.7;z<front;z+=1.25){box(side*w*.48,(roofY+1.1)/2,z,.055,roofY-1.1,.055,materials.metal,.01);box(side*w*.5,1.18,z+.2,.025,.04,.17,materials.metal,.01);}}
 }
 for(const [x,z] of t.seats){box(x,t.seatHeight-.05,z,.52,.12,.5,materials.seat);box(x,t.seatHeight+.28,z-.25,.53,.62,.1,materials.seat);}
 const steering=new THREE.Mesh(new THREE.TorusGeometry(.2,.024,8,24),materials.rubber);steering.position.set(t.seats[0][0],t.seatHeight+.48,t.seats[0][1]+.48);steering.rotation.x=-.55;g.add(steering);
 for(const x of [-w*.34,w*.34]){box(x,.96,L/2+.025,.29,.16,.045,materials.light);box(x,.95,-L/2-.025,.25,.14,.045,brake);}
 for(const side of [-1,1]){box(side*(w/2+.12),1.3,front-.12,.18,.12,.26,materials.green);}
 for(const x of [-w/2,w/2])for(const z of [-t.wheelbase/2,t.wheelbase/2]){const root=new THREE.Group(),spin=new THREE.Group();root.position.set(x,.33,z);root.add(spin);const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.33,.33,.23,20),materials.rubber);tyre.rotation.z=Math.PI/2;spin.add(tyre);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.245,12),materials.metal);hub.rotation.z=Math.PI/2;spin.add(hub);for(let j=0;j<5;j++){const spoke=new THREE.Mesh(rounded(.25,.04,.38,.01),materials.metal);spoke.rotation.x=j*Math.PI/5;spin.add(spoke);}g.add(root);wheels.push(root);}
 if(isBus)g.add(place(sign({text:'ÒRÌṢUN · CAMPUS SHUTTLE',kind:'panel',width:w*.85,height:.22,background:'#234738',color:'#f8e8ba'}),[0,2.22,L/2-.46]));
 // Merge bodywork by material; wheels retain their independent steering/spin transforms.
 const buckets=new Map<THREE.Material,THREE.BufferGeometry[]>();
 for(const child of [...g.children]){if(!(child instanceof THREE.Mesh)||child.name.startsWith('sign:'))continue;child.updateMatrix();const geo=child.geometry.clone().applyMatrix4(child.matrix);const mat=child.material as THREE.Material;if(!buckets.has(mat))buckets.set(mat,[]);buckets.get(mat)!.push(geo);g.remove(child);}
 for(const [mat,parts] of buckets){const merged=mergeGeometries(parts);parts.forEach(p=>p.dispose());if(merged){const mesh=new THREE.Mesh(merged,mat);mesh.castShadow=true;g.add(mesh);}}
 return {g,wheels,brake};
}
function VehicleModel({id,type}:{id:string;type:keyof typeof VEHICLE_TYPES}){const model=useMemo(()=>buildVehicle(type),[type]),group=useRef<THREE.Group>(null!);
 useFrame(()=>{const v=vehicleVisuals.get(id);if(!v)return;group.current.visible=Math.hypot(v.x-player.x,v.z-player.z)<300;group.current.position.set(v.x,.025,v.z);group.current.rotation.y=v.yaw;model.g.rotation.z=-v.steering*Math.min(Math.abs(v.speed)/25,.04);model.wheels.forEach(w=>{w.rotation.y=w.position.z>0?v.steering:0;w.children[0].rotation.x=v.wheel;});model.brake.emissiveIntensity=Math.abs(v.speed)<.5?1:.1;});
 return <group ref={group} name={`vehicle:${id}`}><primitive object={model.g}/></group>;
}
export default function Vehicles(){useFrame((_,raw)=>tickVehicles(Math.min(raw,.25)),-2);return <>{VEHICLE_SPAWNS.map(v=><VehicleModel key={v.id} id={v.id} type={v.type as keyof typeof VEHICLE_TYPES}/>)}</>;}
