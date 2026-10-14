import { create } from 'zustand';
import { createFleet, VEHICLE_TYPES, localPoint, seatAnchor, vehicleContains } from '../../shared/vehicles.mjs';
import { player, useGame } from '../state';
import { me } from '../interaction/world';
import { send } from '../network/client';
export const localFleet=createFleet();
export type Vehicle=ReturnType<typeof localFleet.snapshot>[number];
export const vehicleVisuals=new Map<string,Vehicle>(localFleet.snapshot().map(v=>[v.id,{...v}]));
export const driving={throttle:0,steer:0,brake:false};
export const useVehicle=create<{id:string|null;seat:number|null;near:string|null;revision:number}>(()=>({id:null,seat:null,near:null,revision:0}));
export function currentVehicle(){return vehicleVisuals.get(useVehicle.getState().id??'');}
export function receiveVehicles(list:Vehicle[]){for(const v of list){const target=localFleet.find(v.id);if(target)Object.assign(target,v);else continue;const present=vehicleVisuals.get(v.id);if(present){present.occupants=v.occupants;present.speed=v.speed;present.steering=v.steering;}else vehicleVisuals.set(v.id,{...v});}useVehicle.setState(s=>({revision:s.revision+1}));}
export function setOccupancy(id:string|null,seat:number|null){if(useVehicle.getState().id!==id||useVehicle.getState().seat!==seat)useVehicle.setState({id:id??null,seat:seat??null});me.vehicle=id??null;me.vehicleSeat=seat??null;player.vehicleSeatHeight=id?VEHICLE_TYPES[localFleet.find(id)!.type].seatHeight:null;if(id){player.sit=null;player.speed=0;player.moving=false;player.reconcile=null;player.emote='';}}
export function vehicleResult(m:{ok:boolean;reason?:string;vehicle?:string|null;vehicleSeat?:number|null;x?:number;z?:number}){if(!m.ok){useGame.getState().notify(m.reason??'Vehicle action unavailable.');return;}const was=useVehicle.getState().id;setOccupancy(m.vehicle??null,m.vehicleSeat??null);if(!m.vehicle&&was&&m.x!==undefined&&m.z!==undefined){player.x=m.x;player.z=m.z;player.y=0;player.vy=0;}}
export function vehicleAction(action:'vehicleEnter'|'vehicleExit'|'vehicleRecover',id?:string,seat=0){
 if(useGame.getState().status==='connected'){send({type:action,id,seat});return;}
 const r=action==='vehicleEnter'?localFleet.enter(me,id,seat):action==='vehicleExit'?localFleet.exit(me,[me]):localFleet.recover(me,[me]);vehicleResult({...r,vehicle:me.vehicle,vehicleSeat:me.vehicleSeat,x:me.x,z:me.z});receiveVehicles(localFleet.snapshot());
}
export function vehicleInteract(){const s=useVehicle.getState();if(s.id){vehicleAction('vehicleExit');return true;}const v=localFleet.find(s.near);if(!v||player.sit||player.holding)return false;const t=VEHICLE_TYPES[v.type];const choices=v.occupants.map((id:string|null,i:number)=>({id,i,p:localPoint(v,(t.seats[i][0]<0?-1:1)*(t.width/2+.65),t.seats[i][1])})).filter(s=>!s.id).sort((a,b)=>Math.hypot(a.p.x-player.x,a.p.z-player.z)-Math.hypot(b.p.x-player.x,b.p.z-player.z));const choice=choices[0];if(choice)vehicleAction('vehicleEnter',v.id,choice.i);else useGame.getState().notify('This vehicle is full.');return true;}
export function senseVehicles(){const v=localFleet.vehicles.filter(v=>Math.hypot(v.x-player.x,v.z-player.z)<6).sort((a,b)=>Math.hypot(a.x-player.x,a.z-player.z)-Math.hypot(b.x-player.x,b.z-player.z))[0];if(useVehicle.getState().near!==(v?.id??null))useVehicle.setState({near:v?.id??null});}
let sent=0;
export function tickVehicles(dt:number){
 const s=useVehicle.getState();if(useGame.getState().status!=='connected')localFleet.step(dt,[me]);
 for(const v of localFleet.vehicles){const p=vehicleVisuals.get(v.id)!;const k=Math.hypot(v.x-p.x,v.z-p.z)>35?1:1-Math.exp(-dt*15);p.x+=(v.x-p.x)*k;p.z+=(v.z-p.z)*k;p.yaw+=Math.atan2(Math.sin(v.yaw-p.yaw),Math.cos(v.yaw-p.yaw))*k;p.speed=v.speed;p.steering=v.steering;p.wheel+=v.speed*dt/.32;p.occupants=v.occupants;}
 if(s.id&&s.seat===0&&performance.now()-sent>50){sent=performance.now();const stopped=!!useGame.getState().panel||document.hidden;const m={type:'vehicleInput',throttle:stopped?0:driving.throttle,steer:stopped?0:driving.steer,brake:stopped||driving.brake};if(useGame.getState().status==='connected')send(m);else localFleet.control(me,m);}
 senseVehicles();
}
export function vehicleFootBlocked(x:number,z:number){return [...vehicleVisuals.values()].some(v=>vehicleContains(v,x,z));}
export function disconnectVehicles(){const v=localFleet.find(useVehicle.getState().id);if(v){v.speed=0;localFleet.exit(me,[me]);}localFleet.release(me);setOccupancy(null,null);driving.throttle=driving.steer=0;driving.brake=true;receiveVehicles(localFleet.snapshot());}
export function occupiedAnchor(id:string,seat:number){const v=vehicleVisuals.get(id);return v?seatAnchor(v,seat):null;}
