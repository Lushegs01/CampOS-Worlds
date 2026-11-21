import * as THREE from 'three';
import { surfaceHeight } from '../world/layout';

type Chain = [THREE.Bone,THREE.Bone,THREE.Bone];
type Plant = { target:THREE.Vector3; initial:THREE.Vector3; planted:boolean };
const makePlant=():Plant=>({target:new THREE.Vector3(),initial:new THREE.Vector3(),planted:false});
const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),d=new THREE.Vector3(),pole=new THREE.Vector3();
const bend=new THREE.Vector3(),wanted=new THREE.Vector3(),axis=new THREE.Vector3(),old=new THREE.Vector3(),next=new THREE.Vector3();
const current=new THREE.Quaternion(),rotation=new THREE.Quaternion(),parent=new THREE.Quaternion();
export const doorContacts = new Map<string, (near:THREE.Vector3, into:THREE.Vector3)=>void>();
const chain=(bones:Record<string,THREE.Bone>, side:string, names:string[]):Chain|null=>{
  const [top,mid,tip]=names.map(name=>bones[`Bip01_${side}_${name}`]);
  return top&&mid&&tip?[top,mid,tip]:null;
};
export function mapCampusRig(bones:Record<string,THREE.Bone>) {
  return {
    pelvis:bones.Bip01_Pelvis, spine:bones.Bip01_Spine, neck:bones.Bip01_Neck, head:bones.Bip01_Head,
    arms:[chain(bones,'L',['UpperArm','Forearm','Hand']),chain(bones,'R',['UpperArm','Forearm','Hand'])],
    legs:[chain(bones,'L',['Thigh','Calf','Foot']),chain(bones,'R',['Thigh','Calf','Foot'])],
  };
}
function aim(bone:THREE.Bone, origin:THREE.Vector3, from:THREE.Vector3,to:THREE.Vector3) {
  if(old.subVectors(from,origin).lengthSq()<1e-8||next.subVectors(to,origin).lengthSq()<1e-8)return;
  rotation.setFromUnitVectors(old.normalize(),next.normalize());
  bone.getWorldQuaternion(current);
  bone.parent!.getWorldQuaternion(parent).invert();
  bone.quaternion.copy(parent.multiply(rotation).multiply(current)).normalize();
  bone.updateWorldMatrix(false,true);
}
// Two-bone reach with authored bend direction and bounded correction. Gameplay colliders stay authoritative.
export function solve(chain:Chain, target:THREE.Vector3, weight:number, maxCorrection:number) {
  const [top,mid,tip]=chain;
  top.getWorldPosition(a);mid.getWorldPosition(b);tip.getWorldPosition(c);
  const l1=a.distanceTo(b), l2=b.distanceTo(c);
  if(l1<.01||l2<.01)return;
  d.subVectors(target,c).clampLength(0,maxCorrection);
  wanted.copy(c).addScaledVector(d,weight);
  axis.subVectors(wanted,a);
  const len=axis.length();if(len<1e-5)return;
  axis.multiplyScalar(1/len);
  const distance=THREE.MathUtils.clamp(len,Math.abs(l1-l2)+.001,l1+l2-.001);
  pole.subVectors(b,a);pole.addScaledVector(axis,-pole.dot(axis));
  if(pole.lengthSq()<1e-7)return;
  pole.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance);
  bend.copy(a).addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(Math.max(0,l1*l1-along*along)));
  wanted.copy(a).addScaledVector(axis,distance);
  aim(top,a,b,bend);
  mid.getWorldPosition(b);tip.getWorldPosition(c);
  aim(mid,b,c,wanted);
}

const foot=new THREE.Vector3(),target=new THREE.Vector3(), body=new THREE.Vector3();
export function createFootContacts() {
  const plants=[makePlant(),makePlant()];
  return {
    clear(){plants[0].planted=plants[1].planted=false;},
    apply(rig:ReturnType<typeof mapCampusRig>, phase:number, speed:number, root:THREE.Object3D) {
      root.getWorldPosition(body);
      for(let i=0;i<2;i++){
        const leg=rig.legs[i], plant=plants[i];
        if(!leg)continue;
        const cycle=(phase+i*.5)%1;
        const active=speed<.12||cycle<.37;
        if(!active){plant.planted=false;continue;}
        leg[2].getWorldPosition(foot);
        const ground=surfaceHeight(foot.x,foot.z);
        if(!plant.planted||plant.initial.distanceToSquared(body)>.55*.55||plant.target.distanceToSquared(foot)>.28*.28){
          plant.planted=true;
          plant.initial.copy(body);
          plant.target.set(foot.x,ground+THREE.MathUtils.clamp(foot.y-ground,.045,.105),foot.z);
        }
        target.copy(plant.target);
        const weight=speed<.12?.58:THREE.MathUtils.smoothstep(cycle,0,.075)*(1-THREE.MathUtils.smoothstep(cycle,.25,.37));
        solve(leg,target,weight,.14);
      }
    },
  };
}
