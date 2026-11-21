import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { BARREL } from '../../shared/getaway.mjs';
import { surfaceHeight } from '../world/layout';

function sootMap() {
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(size,size);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const i=(y*size+x)*4, dx=(x-size/2)/(size/2), dy=(y-size/2)/(size/2);
    const grain = Math.sin(x*15.31+y*107.9)*8173.71;
    const edge = 1-Math.hypot(dx+(Math.sin(y*.15)*.12),dy+(Math.cos(x*.21)*.11));
    const opacity = Math.min(.82,Math.max(0,edge)*(.65+(grain-Math.floor(grain))*.57));
    data.data[i]=data.data[i+1]=data.data[i+2]=255;
    data.data[i+3]=Math.round(opacity*255);
  }
  ctx.putImageData(data,0,0);
  return new THREE.CanvasTexture(canvas);
}
const scrap = new THREE.MeshStandardMaterial({color:'#2f2922',roughness:.81,metalness:.43,side:THREE.DoubleSide});
const rust = new THREE.MeshStandardMaterial({color:'#544139',roughness:.87,metalness:.25});
export default function BlastSite() {
  const location = surfaceHeight(BARREL.x,BARREL.z);
  const stain = useMemo(sootMap,[]);
  const shards = useMemo(() => Array.from({length:11},(_,i)=>{
    const a = i*2.395, r=.52+((i*13)%9)*.31;
    return {x:Math.cos(a)*r,z:Math.sin(a)*r,yaw:a+.36,length:.09+(i%4)*.048,rim:i%4===0};
  }),[]);
  useEffect(()=>()=>stain.dispose(),[stain]);
  return <group name="getaway:blast-site" position={[BARREL.x,Math.max(.024,location),BARREL.z]}>
    <mesh rotation-x={-Math.PI/2} position-y={.014} renderOrder={3}>
      <planeGeometry args={[6.3,4.7]}/>
      <meshBasicMaterial color="#221b18" map={stain} transparent opacity={.8} depthWrite={false} polygonOffset polygonOffsetFactor={-2}/>
    </mesh>
    <mesh material={rust} position={[1.14,.081,-.62]} rotation={[-1.37,.27,.3]} castShadow receiveShadow>
      <cylinderGeometry args={[.31,.3,.024,24,1,true]}/>
    </mesh>
    {shards.map((s,i)=><mesh key={i} material={scrap} position={[s.x,.042+s.length*.19,s.z]} rotation={[-1.19,s.yaw,.48]} castShadow receiveShadow>
      <boxGeometry args={[s.length,s.rim ? .026 : .01,s.length*.52]}/>
    </mesh>)}
  </group>;
}
