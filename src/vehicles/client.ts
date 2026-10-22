import { create } from 'zustand';
import { createFleet, VEHICLE_TYPES, localPoint, seatAnchor, vehicleContains } from '../../shared/vehicles.mjs';
import { player, useGame } from '../state';
import { me } from '../interaction/world';
import { send } from '../network/client';
import { createVehicleMotion } from '../network/vehicle-motion.mjs';
export const localFleet=createFleet();
export type Vehicle=ReturnType<typeof localFleet.snapshot>[number];
export const vehicleVisuals=new Map<string,Vehicle>(localFleet.snapshot().map(v=>[v.id,{...v}]));
export const driving={throttle:0,steer:0,brake:false};
export const useVehicle=create<{id:string|null;seat:number|null;near:string|null;revision:number}>(()=>({id:null,seat:null,near:null,revision:0}));
export function currentVehicle(){return vehicleVisuals.get(useVehicle.getState().id??'');}
const motion=createVehicleMotion(), vehicleTarget={...localFleet.snapshot()[0]};
export function receiveVehicles(list:Vehicle[]){if(!list.length)return;const now=performance.now();for(const v of list){const target=localFleet.find(v.id);if(target)Object.assign(target,v);else continue;motion.receive(v,now);const present=vehicleVisuals.get(v.id);if(present){present.occupants=v.occupants;present.speed=v.speed;present.steering=v.steering;}else vehicleVisuals.set(v.id,{...v});}useVehicle.setState(s=>({revision:s.revision+1}));}
export function setOccupancy(id:string|null,seat:number|null){if(useVehicle.getState().id!==id||useVehicle.getState().seat!==seat)useVehicle.setState({id:id??null,seat:seat??null});me.vehicle=id??null;me.vehicleSeat=seat??null;player.vehicleSeatHeight=id?VEHICLE_TYPES[localFleet.find(id)!.type].seatHeight:null;if(id){player.sit=null;player.speed=0;player.moving=false;player.reconcile=null;player.emote='';}}
export function vehicleResult(m:{ok:boolean;reason?:string;vehicle?:string|null;vehicleSeat?:number|null;x?:number;z?:number}){if(!m.ok){useGame.getState().notify(m.reason??'Vehicle action unavailable.');return;}const was=useVehicle.getState().id;setOccupancy(m.vehicle??null,m.vehicleSeat??null);if(!m.vehicle&&was&&m.x!==undefined&&m.z!==undefined){player.x=m.x;player.z=m.z;player.y=0;player.vy=0;}}
export function vehicleAction(action:'vehicleEnter'|'vehicleExit'|'vehicleRecover',id?:string,seat=0){
 if(useGame.getState().status==='connected'){send({type:action,id,seat});return;}
 const r=action==='vehicleEnter'?localFleet.enter(me,id,seat):action==='vehicleExit'?localFleet.exit(me,[me]):localFleet.recover(me,[me]);vehicleResult({...r,vehicle:me.vehicle,vehicleSeat:me.vehicleSeat,x:me.x,z:me.z});receiveVehicles(localFleet.snapshot());
}
/** The free seat whose door is closest to the player (the room accepts entry within 3 m of a door). */
export function nearestDoor(id:string|null){const v=localFleet.find(id);if(!v)return null;const t=VEHICLE_TYPES[v.type];const doors=v.occupants.map((who:string|null,i:number)=>({who,seat:i,p:localPoint(v,(t.seats[i][0]<0?-1:1)*(t.width/2+.65),t.seats[i][1])})).filter(d=>!d.who).map(d=>({...d,d:Math.hypot(d.p.x-player.x,d.p.z-player.z)})).sort((a,b)=>a.d-(a.seat===0?1:0)-(b.d-(b.seat===0?1:0)));return {v,type:t,door:doors[0]??null,full:!doors.length};}
/** Enter the nearest vehicle by its closest free door, or leave the current one. */
export function vehicleInteract(){const s=useVehicle.getState();if(s.id){vehicleAction('vehicleExit');return true;}const n=nearestDoor(s.near);if(!n||player.sit||player.holding)return false;if(n.door)vehicleAction('vehicleEnter',n.v.id,n.door.seat);else useGame.getState().notify('This vehicle is full.');return true;}
export function senseVehicles(){const v=localFleet.vehicles.filter(v=>Math.hypot(v.x-player.x,v.z-player.z)<6).sort((a,b)=>Math.hypot(a.x-player.x,a.z-player.z)-Math.hypot(b.x-player.x,b.z-player.z))[0];if(useVehicle.getState().near!==(v?.id??null))useVehicle.setState({near:v?.id??null});}
let sent=0;
export function tickVehicles(dt:number){
 const s=useVehicle.getState(),online=useGame.getState().status==='connected';
 // The driver's controls are applied before the step, so even a very slow frame drives with them.
 if(s.id&&s.seat===0){const stopped=!!useGame.getState().panel||document.hidden;const m={type:'vehicleInput',throttle:stopped?0:driving.throttle,steer:stopped?0:driving.steer,brake:stopped||driving.brake};
  if(!online)localFleet.control(me,m);else if(performance.now()-sent>50){sent=performance.now();send(m);}}
 if(!online)localFleet.step(dt,[me]);
 // Online, the room sends ~15 snapshots a second: carry each vehicle forward along its own heading
 // between them (for at most a quarter second) so motion stays continuous instead of stepping.
 const now=performance.now();
 for(const authoritative of localFleet.vehicles){const v=online&&motion.sample(authoritative.id,now,vehicleTarget)?vehicleTarget:authoritative;const p=vehicleVisuals.get(v.id)!;const k=!online||Math.hypot(v.x-p.x,v.z-p.z)>35?1:1-Math.exp(-dt*15);p.x+=(v.x-p.x)*k;p.z+=(v.z-p.z)*k;p.yaw+=Math.atan2(Math.sin(v.yaw-p.yaw),Math.cos(v.yaw-p.yaw))*k;p.speed=v.speed;p.steering=v.steering;p.wheel=v.wheel;p.occupants=v.occupants;}
 senseVehicles();
}
/** Called for every movement substep: no allocation. */
export function vehicleFootBlocked(x:number,z:number){for(const v of vehicleVisuals.values())if(vehicleContains(v,x,z))return true;return false;}
export function disconnectVehicles(){const v=localFleet.find(useVehicle.getState().id);if(v){v.speed=0;localFleet.exit(me,[me]);}localFleet.release(me);setOccupancy(null,null);driving.throttle=driving.steer=0;driving.brake=true;receiveVehicles(localFleet.snapshot());}
/** How far each drawn vehicle is raised to ride on the paving, sidewalk or kerb under its wheels (src/world/Vehicles.tsx). */
export const vehicleLift=new Map<string,number>();
export function occupiedAnchor(id:string,seat:number){const v=vehicleVisuals.get(id);return v?seatAnchor(v,seat):null;}
