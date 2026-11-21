import { QA_HOOKS as QAInstrumentation } from '../qa';
// The renderer's own quality tier and textures do not change with the animation workload.
let frame=-1, remoteMs=0, avatarMs=0, samples=0, average=0, poses=0, contacts=0, skipped=0;
let hands=0,feet=0;
let last={averageMs:0,poses:0,contacts:0,skipped:0};
export function animationFrame(time:number){
  if(time===frame)return;
  if(frame>=0){
    average+=avatarMs;samples++;
    if(samples===60){last={averageMs:average/samples,poses,contacts,skipped};average=samples=poses=contacts=skipped=0;}
  }
  frame=time;remoteMs=0;avatarMs=0;
}
export function allowContacts(remote:boolean, raw:number) {
  return !remote || (raw<.05&&remoteMs<.85);
}
export function recordContacts(start:number,remote:boolean,usedFeet:boolean,usedHand:boolean){
  const elapsed=performance.now()-start;
  if(remote)remoteMs+=elapsed;
  contacts++;if(QAInstrumentation){if(usedFeet)feet++;if(usedHand)hands++;}
}
export function recordAvatar(start:number,posed:boolean){avatarMs+=performance.now()-start;if(posed)poses++;else skipped++;}
export function animationMetrics(){
  return {...(samples?{averageMs:average/samples,poses,contacts,skipped}:last),hands,feet};
}
