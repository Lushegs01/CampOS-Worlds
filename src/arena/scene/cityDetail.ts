// Architectural and street-scale detail. All additions are presentation geometry;
// the shared map remains the source of movement, cover and shot collision.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Builder, hash } from './environment';
import { surface, type Library } from './library';

type Box = { min: number[]; max: number[]; mat: string };

/** Deterministic wear masks: no network request and no per-frame canvas work. */
function mask(kind: 'dirt' | 'crack' | 'contact') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!;
  if (kind === 'contact') {
    const g = c.createRadialGradient(128,128,18,128,128,128); g.addColorStop(0,'rgba(15,12,8,.48)'); g.addColorStop(.55,'rgba(15,12,8,.2)'); g.addColorStop(1,'rgba(15,12,8,0)'); c.fillStyle=g;c.fillRect(0,0,256,256);
  } else if (kind === 'dirt') {
    for(let i=0;i<1200;i++) { const x=hash(i,3)*256,y=hash(i,4)*256,r=1+hash(i,5)*16; c.fillStyle=`rgba(36,31,23,${.015+hash(i,6)*.055})`;c.beginPath();c.ellipse(x,y,r,r*.3,hash(i,7)*Math.PI,0,Math.PI*2);c.fill(); }
  } else {
    c.lineCap='round';
    for(let j=0;j<5;j++) { let x=hash(j,1)*256,y=hash(j,2)*256;c.beginPath();c.moveTo(x,y);
      for(let i=0;i<14;i++){x+=(hash(i,j+20)-.5)*48;y+=8+hash(i,j+30)*12;c.lineTo(x,y);}c.lineWidth=j? .6:1.5;c.strokeStyle='rgba(20,18,16,.45)';c.stroke();
    }
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,toneMapped:true});
}

export function cityDetail(lib: Library, b: Builder, boxes: Box[], wet: boolean, detail: boolean) {
  const trim = surface(lib,'concreteFloor',{tint:'#c5c1b6',normalScale:.3});
  const steel = new THREE.MeshStandardMaterial({color:'#4c5556',metalness:.65,roughness:.5});
  const dark = new THREE.MeshStandardMaterial({color:'#242b2c',roughness:.8});
  const marking = new THREE.MeshStandardMaterial({color:'#c7bfa2',roughness:.95});
  const dirt=mask('dirt'),crack=mask('crack'),contact=mask('contact');
  const groundDecal=(x:number,y:number,z:number,w:number,d:number,m:THREE.Material,angle=0)=>{
    const g=new THREE.PlaneGeometry(w,d);b.add(g,m,1,new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,angle)),new THREE.Vector3(1,1,1)),false,true);g.dispose();
  };
  for(const [i,c] of boxes.entries()) {
    const [x0,y0,z0]=c.min,[x1,y1,z1]=c.max,w=x1-x0,d=z1-z0,h=y1-y0;
    if(y0===5 && h>.7 && w<13 && d<12 && !c.mat.startsWith('bld') && !c.mat.includes('stair') && !['rail','hedge'].includes(c.mat)) groundDecal((x0+x1)/2,5.008,(z0+z1)/2,w+1.1,d+1.1,contact);
    if(c.mat.startsWith('bld-') && h>1.2 && (w<.8 || d<.8)) {
      // Coping, foundation courses and mortar seams follow each solid wall segment, never the openings.
      b.box(x0-.025,y0,z0-.025,x1+.025,Math.min(y1,y0+.22),z1+.025,trim,1);
      b.box(x0-.045,y1-.12,z0-.045,x1+.045,y1,z1+.045,trim,1);
      if(detail && (w>2 || d>2)) {
        const n=Math.floor(Math.max(w,d)/3.5);
        for(let k=1;k<=n;k++) { const t=k/(n+1); if(w>d)b.box(x0+w*t-.025,y0,z0-.015,x0+w*t+.025,y1,z1+.015,trim);else b.box(x0-.015,y0,z0+d*t-.025,x1+.015,y1,z0+d*t+.025,trim); }
      }
    }
    if(c.mat==='st-sidewalk' && y1===5 && (w>4 || d>4)) {
      // Narrow perimeter joints instead of enormous repeated pavement texture blocks.
      if(d<4) for(let x=x0+.75;x<x1;x+=1.5)b.box(x,5.003,z0,x+.012,5.008,z1,dark);
    }
    if(c.mat==='st-asphalt' && y1===5 && w>5 && d>3) {
      groundDecal((x0+x1)/2,5.016,(z0+z1)/2,w*.9,d*.9,crack,hash(i,4)*3);
      groundDecal(x0+w*.4,5.018,z0+d*.6,w*.8,d*.7,dirt);
    }
    if(c.mat==='ug-column') {
      // Protective bands and column feet in the transit station.
      b.box(x0-.025,y0,z0-.025,x1+.025,y0+.18,z1+.025,trim);
      b.box(x0-.014,y0+.9,z0-.014,x1+.014,y0+1.03,z1+.014,marking);
    }
  }
  // Kerb-side drains and road repairs are flush with the street, not obstacles.
  for(const side of [-1,1])for(const x of [12,27,42]) {
    const px=side*x;
    b.box(px-.45,5.008,-29.02,px+.45,5.025,-28.65,dark);
    for(let k=0;k<8;k++)b.box(px-.42+k*.115,5.025,-29.02,px-.39+k*.115,5.03,-28.65,steel);
    groundDecal(px,5.018,-22.5,3.5,1.6,dirt);
  }
  // Dull wet patches avoid a uniform plastic road in rainy weather.
  if(wet){const puddle=new THREE.MeshStandardMaterial({color:'#566166',map:contact.map,roughness:.1,metalness:.25,transparent:true,opacity:.55,depthWrite:false});for(let i=0;i<16;i++)groundDecal(-42+hash(i,1)*84,5.02,i%2?-22.3:14.5,1+hash(i,2)*3,.3+hash(i,4),puddle,hash(i,3)*3);}
}

/** Vehicles constructed in a local longitudinal frame, with detailed cab, chassis and wheel assemblies. */
export function vehicleBuilder(lib:Library, detail:boolean) {
  const rubber=new THREE.MeshStandardMaterial({color:'#181c1d',roughness:.94});
  const steel=new THREE.MeshStandardMaterial({color:'#89928e',metalness:.8,roughness:.38});
  const black=new THREE.MeshStandardMaterial({color:'#252d2d',roughness:.64});
  const glass=new THREE.MeshStandardMaterial({color:'#24363c',metalness:.25,roughness:.14,envMapIntensity:1.5});
  const headlamp=new THREE.MeshStandardMaterial({color:'#d6d9c8',metalness:.1,roughness:.22});
  const red=new THREE.MeshStandardMaterial({color:'#6f1711',roughness:.32});
  const paints=new Map<string,THREE.Material>();
  return (b:Builder,c:Box)=>{
    const [x0,y0,z0]=c.min,[x1,y1,z1]=c.max,alongX=x1-x0>=z1-z0,L=alongX?x1-x0:z1-z0,W=alongX?z1-z0:x1-x0,H=y1-y0;
    const yaw=alongX?0:Math.PI/2,root=new THREE.Matrix4().compose(new THREE.Vector3((x0+x1)/2,y0,(z0+z1)/2),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(1,1,1));
    const color=c.mat==='bus'?'#b29857':c.mat==='truck'?'#8b9188':c.mat==='van'?'#a5a89c':c.mat==='pickup'?'#6d786c':'#6f7b7f';
    if(!paints.has(color))paints.set(color,new THREE.MeshPhysicalMaterial({color,roughness:.48,metalness:.2,clearcoat:detail ? .25 : 0,clearcoatRoughness:.35}));
    const paint=paints.get(color)!;
    const part=(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material,r=0)=>{
      const geo=r?new RoundedBoxGeometry(w,h,d,detail?2:1,Math.min(r,w/3,h/3,d/3)):new THREE.BoxGeometry(w,h,d);
      b.add(geo,m,1,root.clone().multiply(new THREE.Matrix4().makeTranslation(x,y,z)));geo.dispose();
    };
    const cylinder=(x:number,y:number,z:number,r:number,d:number,m:THREE.Material)=>{
      const geo=new THREE.CylinderGeometry(r,r,d,detail?20:12),matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2),new THREE.Vector3(1,1,1));b.add(geo,m,1,root.clone().multiply(matrix));geo.dispose();
    };
    const car=c.mat==='car'||c.mat==='pickup',truck=c.mat==='truck',radius=Math.min(.48,H*.23);
    part(0,.38,0,L-.25,.25,W-.25,black,.04);
    part(0,H*.37,0,L,H*.4,W,paint,.09);
    const cabL=car?L*.57:truck?L*.23:L-.15,cabX=truck?-L*.36:car?-L*.05:0;
    part(cabX,H*.75,0,cabL,H*.5,W-.12,paint,.12);
    if(truck){part(L*.13,H*.72,0,L*.73,H*.56,W-.08,surface(lib,'corrugated',{tint:'#c3c1af',normalScale:.45}),.03);}
    const windowH=H*.28;
    // Windscreen and rear glazing, with rubber seals around every pane.
    for(const front of [-1,1]){const x=cabX+front*(cabL/2+.008);part(x,H*.76,0,.025,windowH+.08,W-.3,black,.015);part(x+front*.014,H*.76,0,.012,windowH,W-.4,glass,.01);}
    const n=c.mat==='bus'?7:car?2:truck?1:3;
    for(const side of [-1,1]){
      for(let i=0;i<n;i++){
        const x=cabX-cabL/2+.14+(i+.5)*(cabL-.28)/n,ww=(cabL-.28)/n-.07;
        part(x,H*.76,side*(W/2-.053),ww+.035,windowH+.055,.025,black,.015);part(x,H*.76,side*(W/2-.035),ww,windowH,.012,glass,.01);
        if(car||truck||i<2){part(x,H*.48,side*(W/2+.008),ww*.19,.035,.025,steel,.008);part(x+ww/2,H*.43,side*(W/2+.006),.008,H*.37,.008,black);}
      }
      part(0,H*.23,side*(W/2+.01),L-.16,.065,.025,black);
      part(cabX-cabL*.38,H*.7,side*(W/2+.04),.17,.12,.08,black,.025);
    }
    for(const ax of [-.32,.32])for(const side of [-1,1]){
      cylinder(L*ax,radius,side*(W/2-.04),radius,.2,rubber);
      cylinder(L*ax,radius,side*(W/2+.065),radius*.57,.025,steel);
      cylinder(L*ax,radius,side*(W/2+.085),radius*.22,.035,black);
    }
    for(const front of [-1,1]){
      part(front*(L/2-.02),H*.24,0,.12,.13,W+.03,black,.025);
      for(const side of [-1,1])part(front*(L/2+.008),H*.4,side*W*.34,.035,.12,W*.18,front<0?headlamp:red,.02);
      part(front*(L/2+.02),H*.23,0,.018,.1,.32,headlamp);
    }
    for(let i=0;i<5;i++)part(-L/2-.018,H*.3+i*.035,0,.015,.012,W*.45,steel);
    if(detail)for(const side of [-1,1])part(cabX,H*.91,side*(W*.38),cabL*.9,.015,.025,black);
  };
}
