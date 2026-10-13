import { useMemo } from 'react';
import * as THREE from 'three';
/** Camera-facing name tag drawn to a canvas texture. */
export function Label({text,p,width=8,height=1,color='#eee6d3',background='',rotation=0}:{text:string;p:[number,number,number];width?:number;height?:number;color?:string;background?:string;rotation?:number}){
 const tex=useMemo(()=>{const c=document.createElement('canvas');c.width=1024;c.height=Math.round(1024*height/width);const x=c.getContext('2d')!;if(background){x.fillStyle=background;x.globalAlpha=.86;x.beginPath();x.roundRect(4,4,c.width-8,c.height-8,c.height/2-4);x.fill();x.globalAlpha=1;}x.fillStyle=color;x.font=`600 ${Math.round(c.height*.48)}px "DM Sans Variable", system-ui, sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText(text,512,c.height/2+2,980);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;},[text,color,background,width,height]);
 return <mesh position={p} rotation-y={rotation}><planeGeometry args={[width,height]}/><meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide}/></mesh>;
}
