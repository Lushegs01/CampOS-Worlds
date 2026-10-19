import {create} from 'zustand';
import {onRoomMessage,send} from '../network/client';
import {player,useGame} from '../state';
import {registerCandidates} from '../interaction/controller';
import {moveWithCollisions} from '../../shared/campus.mjs';
import {LAB_STATIONS,LOGISTICS_SITES,insideLab} from '../../shared/economic-lab.mjs';
import type {LabReply,LabView} from './types';

type Payload={action:string;station:string;run:string|null;key:string;[key:string]:unknown};
interface LabState {view:LabView|null;busy:boolean;error:string;message:string;retry:Payload|null}
export const useLab=create<LabState>(()=>({view:null,busy:false,error:'',message:'',retry:null}));
let ref=0;
const pending=new Map<number,{done:(r:LabReply)=>void;timer:ReturnType<typeof setTimeout>;payload:Payload}>();
const operationKey=()=>globalThis.crypto?.randomUUID?.()??`lab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function dispatch(payload:Payload):Promise<LabReply> {
 if(useLab.getState().busy)return Promise.resolve({ok:false,reason:'Wait for the current operation.'});
 useLab.setState({busy:true,error:'',message:''});
 if(useGame.getState().status!=='connected'||!send({type:'lab',ref:++ref,...payload})) {
  const reason='Connect to the campus room to use the lab. You can keep exploring the building.';useLab.setState({busy:false,error:reason});return Promise.resolve({ok:false,reason});
 }
 const requestRef=ref;
 return new Promise(resolve=>{
  const timer=setTimeout(()=>{pending.delete(requestRef);const reason='The room did not answer. Retry the same operation to avoid duplicates.';useLab.setState({busy:false,error:reason,retry:payload});resolve({ok:false,reason});},10000);
  pending.set(requestRef,{done:resolve,timer,payload});
 });
}
export function labRequest(station:string,action:string,extra:Record<string,unknown>={}):Promise<LabReply> {
 if(useLab.getState().retry&&action!=='inspect')return Promise.resolve({ok:false,reason:'Resolve the pending operation with Retry first.'});
 return dispatch({...extra,action,station,run:useLab.getState().view?.current?.id??null,key:operationKey()});
}
export const retryLab=()=>{const p=useLab.getState().retry;return p?dispatch(p):Promise.resolve({ok:false});};
onRoomMessage(m=>{
 if(m.type==='labResult') {
  const p=pending.get(m.ref);if(!p)return;
  clearTimeout(p.timer);pending.delete(m.ref);
  useLab.setState(s=>({busy:false,view:m.view??s.view,error:m.ok?'':m.reason??'Operation failed.',message:m.ok?(m.replayed?'Operation confirmed; no duplicate effects.':p.payload.action==='inspect'?'':'Saved by the campus room.'):'',retry:m.reason?.includes('could not save')?p.payload:p.payload.action==='inspect'?s.retry:null}));
  p.done(m);
 }
 if(m.type==='disconnected'||m.type==='welcome'||m.type==='auth') {
  for(const p of pending.values()){clearTimeout(p.timer);p.done({ok:false,reason:'Connection or identity changed. Reopen the workstation.'});}
  pending.clear();useLab.setState({view:null,busy:false,error:'',message:'',retry:null});
 }
});
function reachable(x:number,z:number,range:number) {
 if(player.y>.05||Math.hypot(player.x-x,player.z-z)>range)return false;
 const q=moveWithCollisions(player.x,player.z,x-player.x,z-player.z);return Math.hypot(q.x-x,q.z-z)<.15;
}
registerCandidates(rank=>{
 const out=[];
 if(insideLab(player.x,player.z))for(const s of LAB_STATIONS)if(reachable(s.point.x,s.point.z,s.range))out.push({id:`lab:${s.id}`,kind:'lab',label:`Use ${s.name}`,key:'E',hint:`Station ${s.letter} · Economic Simulation Lab`,score:rank(8,s.point.x,s.point.z),run:()=>{useGame.getState().set({panel:`lab:${s.id}`});document.exitPointerLock?.();}});
 const view=useLab.getState().view,run=view?.current;
 if(run?.status==='running'&&!useLab.getState().busy)for(const task of run.tasks) {
  if(task.worker?.kind!=='human'||task.worker.id!==view?.principal||!['claimed','in_progress','revision'].includes(task.status))continue;
  const site=LOGISTICS_SITES.find(s=>s.id===(!task.pickup?task.inputs.origin:task.outputs.destination));
  if(!site||task.delivery||!reachable(site.x,site.z,1.9))continue;
  const action=task.pickup?'deliver':'collect';
  out.push({id:`logistics:${task.id}`,kind:'lab-delivery',label:task.pickup?'Deliver reserved packs':'Collect reserved packs',key:'E',hint:site.name,score:rank(12,site.x,site.z),run:()=>{void labRequest('tasks',action,{task:task.id}).then(r=>useGame.getState().notify(r.ok?(action==='collect'?'Packs collected. Follow your delivery destination.':'Delivery recorded. Return to Tasks and Logistics to submit for verification.'):r.reason??'Try again.'));}});
 }
 return out;
});
