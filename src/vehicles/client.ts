import { create } from 'zustand';
import { createFleet, advance, VEHICLE_TYPES, localPoint, seatAnchor, vehicleContains } from '../../shared/vehicles.mjs';
import { createDrivePrediction, DRIVE_VERSION } from '../../shared/driving.mjs';
import { player, useGame, livePeers, roomPlayback, type Peer } from '../state';
import { me } from '../interaction/world';
import { send } from '../network/client';
import { createVehicleTrack } from '../network/vehicle-motion.mjs';
export const localFleet=createFleet();
export type Vehicle=ReturnType<typeof localFleet.snapshot>[number];
export const vehicleVisuals=new Map<string,Vehicle>(localFleet.snapshot().map(v=>[v.id,{...v}]));
export const driving={throttle:0,steer:0,brake:false};
export const useVehicle=create<{id:string|null;seat:number|null;near:string|null;revision:number}>(()=>({id:null,seat:null,near:null,revision:0}));
export function currentVehicle(){return vehicleVisuals.get(useVehicle.getState().id??'');}
const vehicleTarget={...localFleet.snapshot()[0]},tracks=new Map<string,ReturnType<typeof createVehicleTrack>>();
const trackOf=(id:string)=>{let t=tracks.get(id);if(!t)tracks.set(id,t=createVehicleTrack());return t;};
// Driving your own vehicle online: commands apply here at once and the room confirms them (shared/driving.mjs).
// Other players nearby block it as they do in the room; the room's answer always wins.
const nearby:Peer[]=[];
const prediction=createDrivePrediction((v:Vehicle,i:{throttle:number;steer:number;brake:boolean},dt:number)=>advance(v,i,dt,localFleet.vehicles,nearby));
/** Rooms that accept driving commands say so on joining; older rooms keep the previous input messages. */
let driveSupported=false;
export function driveProtocol(version:unknown){driveSupported=version===DRIVE_VERSION;prediction.stop();}
/** What the driver sees is the prediction plus a correction that fades out, so reconciling never jolts. */
const correction={x:0,z:0,yaw:0};
const predicting=(id:string)=>prediction.active&&useVehicle.getState().id===id&&useVehicle.getState().seat===0;
/**
 * `at` is the room's send time. Each vehicle carries `ts`, the room time its state represents (a driver's car
 * is as far along as the driver's commands have reached). Snapshots without `at` (joining, getting in or out)
 * only seed an empty track.
 */
export function receiveVehicles(list:(Vehicle&{ts?:number})[],at?:number){if(!list.length)return;for(const v of list){const target=localFleet.find(v.id);if(!target)continue;
  // Your own predicted vehicle takes its pose from the acknowledged driving state, never from a stale broadcast.
  if(predicting(v.id))target.occupants=v.occupants;else{Object.assign(target,v);delete (target as {ts?:number}).ts;}
  const track=trackOf(v.id);if(at!==undefined)track.push(typeof v.ts==='number'?v.ts:at,v,at);else if(!track.length)track.push(0,v);
  const present=vehicleVisuals.get(v.id);if(present){present.occupants=v.occupants;present.speed=v.speed;present.steering=v.steering;}else vehicleVisuals.set(v.id,{...v});}
 useVehicle.setState(s=>({revision:s.revision+1}));}
/** The room's state for the vehicle you drive: adopt it and replay what it has not applied yet. */
export function receiveDrive(state:unknown){const s=useVehicle.getState();if(!driveSupported||!s.id||s.seat!==0)return;const v=localFleet.find(s.id);if(!v)return;
 const was={x:v.x,z:v.z,yaw:v.yaw},fresh=!prediction.active;if(!prediction.receive(state,v))return;
 if(fresh){correction.x=correction.z=correction.yaw=0;return;}
 correction.x+=was.x-v.x;correction.z+=was.z-v.z;correction.yaw+=Math.atan2(Math.sin(was.yaw-v.yaw),Math.cos(was.yaw-v.yaw));
 // A real disagreement (a collision the room saw differently): go straight to the room's answer.
 if(Math.hypot(correction.x,correction.z)>4)correction.x=correction.z=correction.yaw=0;}
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
/** Every frame, without allocating: the nearest vehicle within 6 m. */
export function senseVehicles(){let near:string|null=null,best=6;for(const v of localFleet.vehicles){const d=Math.hypot(v.x-player.x,v.z-player.z);if(d<best){best=d;near=v.id;}}if(useVehicle.getState().near!==near)useVehicle.setState({near});}
let sent=0;
export function tickVehicles(dt:number){
 const s=useVehicle.getState(),online=useGame.getState().status==='connected',driver=!!s.id&&s.seat===0;
 if(!driver&&prediction.active){prediction.stop();correction.x=correction.z=correction.yaw=0;}
 // The driver's controls are applied before the step, so even a very slow frame drives with them.
 if(driver){const stopped=!!useGame.getState().panel||document.hidden,throttle=stopped?0:driving.throttle,steer=stopped?0:driving.steer,brake=stopped||driving.brake,m={type:'vehicleInput',throttle,steer,brake};
  if(!online)localFleet.control(me,m);
  else if(driveSupported&&prediction.active){nearby.length=0;for(const p of livePeers.values())nearby.push(p);prediction.frame(localFleet.find(s.id)!,dt,throttle,steer,brake);
   // Batched about 30 times a second: well inside the room's message rate limit at any frame rate.
   if(performance.now()-sent>=33){const out=prediction.outbox();if(out){sent=performance.now();send({type:'vehicleDrive',...out});}}}
  else if(performance.now()-sent>50){sent=performance.now();send(m);}}
 if(!online)localFleet.step(dt,[me]);
 // Other vehicles are drawn slightly in the past, between the room's timestamped snapshots, so their speed
 // stays steady whatever the network does; yours is drawn where you are driving it.
 const at=online?roomPlayback.time(performance.now()):null,fade=Math.exp(-dt*10);correction.x*=fade;correction.z*=fade;correction.yaw*=fade;
 for(const authoritative of localFleet.vehicles){const p=vehicleVisuals.get(authoritative.id)!;let v:Vehicle=authoritative;
  if(online&&predicting(authoritative.id)){p.x=v.x+correction.x;p.z=v.z+correction.z;p.yaw=v.yaw+correction.yaw;}
  else{if(online&&at!==null&&tracks.get(v.id)?.sample(at,vehicleTarget))v=vehicleTarget;p.x=v.x;p.z=v.z;p.yaw=v.yaw;}
  p.speed=v.speed;p.steering=v.steering;p.wheel=v.wheel;p.occupants=authoritative.occupants;}
 senseVehicles();
}
/** Called for every movement substep: no allocation. */
export function vehicleFootBlocked(x:number,z:number){for(const v of vehicleVisuals.values())if(vehicleContains(v,x,z))return true;return false;}
export function disconnectVehicles(){const v=localFleet.find(useVehicle.getState().id);if(v){v.speed=0;localFleet.exit(me,[me]);}localFleet.release(me);setOccupancy(null,null);driving.throttle=driving.steer=0;driving.brake=true;prediction.stop();tracks.clear();receiveVehicles(localFleet.snapshot());}
/** How far each drawn vehicle is raised to ride on the paving, sidewalk or kerb under its wheels (src/world/Vehicles.tsx). */
export const vehicleLift=new Map<string,number>();
export function occupiedAnchor(id:string,seat:number){const v=vehicleVisuals.get(id);return v?seatAnchor(v,seat):null;}
