import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
/** Camera-facing name tag drawn to a canvas texture. */
export function Label({text,p,width=8,height=1,color='#eee6d3',background='',rotation=0}:{text:string;p:[number,number,number];width?:number;height?:number;color?:string;background?:string;rotation?:number}){
 // About 270 texels per metre: sharp at the closest a name tag is shown (3 m), about half the memory of a
 // fixed 1024 px canvas. Disposed with the tag (every player who left used to leave theirs behind).
 const tex=useMemo(()=>{const c=document.createElement('canvas');c.width=Math.min(1024,Math.ceil(width*270/64)*64);c.height=Math.round(c.width*height/width);const x=c.getContext('2d')!;if(background){x.fillStyle=background;x.globalAlpha=.86;x.beginPath();x.roundRect(4,4,c.width-8,c.height-8,c.height/2-4);x.fill();x.globalAlpha=1;}x.fillStyle=color;x.font=`600 ${Math.round(c.height*.48)}px "DM Sans Variable", system-ui, sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText(text,c.width/2,c.height/2+2,c.width*.96);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;},[text,color,background,width,height]);
 useEffect(()=>()=>tex.dispose(),[tex]);
 return <mesh position={p} rotation-y={rotation}><planeGeometry args={[width,height]}/><meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide}/></mesh>;
}
