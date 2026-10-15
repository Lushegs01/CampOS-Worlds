import { receiveClasses } from '../ui/Classes';
import { receiveVehicles, vehicleResult, setOccupancy, disconnectVehicles } from '../vehicles/client';
import { useEffect } from 'react';
import { livePeers, peerTracks, player, trail, useGame, type Peer } from '../state';
import { createClock, createTrack } from './interpolation.mjs';
import { bindNetwork, unbindNetwork, receive, loadSnapshot, releaseLocal } from '../interaction/world';
import type { AvatarConfig } from '../state';
import { analyticsPayload } from '../analytics/consent';
import { QA_HOOKS } from '../qa';
// The account layer registers here (instead of being imported) to keep the dependency one-way.
export interface AuthReply {ok:boolean;code?:string;reason?:string;account?:{handle:string;display_name:string}|null}
export interface ProgressReply {kind:'keepsake'|'landmark'|'hoops'|'duel'|'checkin'|'challenge'|'party';item:string;awarded?:string[];best?:number}
interface AccountBridge {access:()=>Promise<string|null>;verified:()=>boolean;onAuth:(m:AuthReply)=>void;onProgress:(m:ProgressReply)=>void}
let bridge:AccountBridge|null=null;
export function registerAccountBridge(b:AccountBridge){bridge=b;}
// Other layers (social, matches) subscribe to room messages here rather than being imported, which
// keeps the network layer free of feature code. A synthetic {type:'disconnected'} marks a lost room.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoomListener=(m:any)=>void;
const roomListeners=new Set<RoomListener>();
export function onRoomMessage(fn:RoomListener){roomListeners.add(fn);return()=>{roomListeners.delete(fn);};}
/** Our connection id in the room ('' when not connected). */
export const selfConnection=()=>ownId;
/** The room instance we are in (parties and presence are scoped to it). */
export const roomInfo={id:'',name:''};
/** Present a verified account (access token), re-read the saved profile ('refresh'), or return to a guest identity (null). */
export function sendAccountIdentity(token:string|null|'refresh',name?:string,avatar?:AvatarConfig){if(token==='refresh')send({type:'profile',name,avatar});else if(token)send({type:'auth',token});else send({type:'auth',token:null,name,avatar});}
let socket:WebSocket|null=null;let ownId='';let reconnect:ReturnType<typeof setTimeout>;let retry=0;let stopped=false;
/** Connection attempts that failed since the last successful join (a reliability statistic, sent only with consent). */
let failures=0;
export function send(data:unknown){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(data));return true;}return false;}
/** Where the room last placed us (read by the development QA hook to diagnose drift). */
export const roomSelf={x:NaN,z:NaN};
export function interact(id:string){if(useGame.getState().status==='connected'){send({type:'interact',id});}else openLocation(id);}
function openLocation(id:string){useGame.getState().discover(id);useGame.getState().set({panel:id});document.exitPointerLock?.();}
let roster='';const roomClock=createClock();
/** Update live positions every message; touch React state only when the roster itself changes. */
function syncPeers(list:Peer[],count:number,roomAt?:number){
 const ids=new Set(list.map(p=>p.id));for(const id of livePeers.keys())if(!ids.has(id)){livePeers.delete(id);peerTracks.delete(id);}
 const at=typeof roomAt==='number'?roomClock.receive(roomAt,performance.now()):performance.now();
 for(const p of list){const live=livePeers.get(p.id);if(live)Object.assign(live,p);else livePeers.set(p.id,{...p});let track=peerTracks.get(p.id);if(!track)peerTracks.set(p.id,track=createTrack());track.push(at,p.x,p.y,p.z,p.yaw);}
 const next=list.map(p=>p.id+'|'+p.name+'|'+(p.handle??'')+(p.verified?'|v':'')+'|'+(p.title??'')+'|'+JSON.stringify(p.avatar)).sort().join(';');const s=useGame.getState();
 if(next!==roster||count!==s.count){roster=next;s.set({peers:list.map(p=>({...p})),count});}
}
export function connect(){
 clearTimeout(reconnect);stopped=false;if(socket&&socket.readyState<2)return;
 const state=useGame.getState();state.set({status:'connecting'});
 const url=import.meta.env.VITE_WS_URL||`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
 // Handlers capture their own socket so a late close from a replaced connection can't clobber
 // the current one (React StrictMode reconnects once in development; real reconnects race too).
 const ws=new WebSocket(url);socket=ws;
 // Signed-in players include their access token in the join message (never in the URL); the room
 // verifies it with the account service and upgrades the guest identity.
 ws.onopen=async()=>{if(socket!==ws)return;const access=await bridge?.access().catch(()=>null)??null;if(socket!==ws)return;const g=useGame.getState();send({type:'join',name:g.name,avatar:g.avatar,invite:g.invite,token:sessionStorage.getItem('campus-session'),analytics:analyticsPayload(),...(access?{access}:{})});};
 ws.onmessage=event=>{if(socket!==ws)return;let m;try{m=JSON.parse(event.data);}catch{return;}const s=useGame.getState();
  if(m.classes)receiveClasses(m.classes);if(m.type==='classes')receiveClasses(m.sessions);
  if(m.type==='welcome'){ownId=m.id;retry=0;if(failures&&analyticsPayload().consent)setTimeout(()=>send({type:'telemetry',failures}),1000);failures=0;Object.assign(roomInfo,m.room??{id:'courtyard',name:'The Courtyard'});sessionStorage.setItem('campus-session',m.token);Object.assign(player,m.position,{vy:0,reconcile:null});trail.clear();releaseLocal(true);bindNetwork(send,m.id);if(m.world)loadSnapshot(m.world);if(m.vehicles)receiveVehicles(m.vehicles);setOccupancy(null,null);s.set({status:'connected'});}
  if(m.type==='vehicles')receiveVehicles(m.vehicles);
  if(m.type==='vehicleResult')vehicleResult(m);
  if(m.type==='state'){if(m.vehicles)receiveVehicles(m.vehicles);const self=m.players.find((p:{id:string})=>p.id===ownId);if(self){setOccupancy(self.vehicle??null,self.vehicleSeat??null);roomSelf.x=self.x;roomSelf.z=self.z;}const live=self&&!self.vehicle,gap=live?Math.hypot(self.x-player.x,self.z-player.z):0;
   // The room's position trails ours by the network and tick delay: only a position away from the path we
   // just walked is real disagreement (beyond 2 m, snap to it). A lagging snapshot used to snap us back.
   if(live&&gap>2&&trail.distance(self.x,self.z,performance.now())>2){Object.assign(player,{x:self.x,z:self.z,y:self.y,reconcile:null});trail.clear();}
   else player.reconcile=live&&!self.moving&&gap>.9&&player.speed<.05&&!player.sit?{x:self.x,z:self.z}:null;/* glide only once the room has stopped us too (never toward a mid-stride snapshot); under 0.9 m a settle request corrects the room instead */if(m.balls)receive({type:'balls',balls:m.balls});syncPeers(m.players.filter((p:Peer)=>p.id!==ownId),m.players.length,m.at);}
  if(m.type==='left'){livePeers.delete(m.id);peerTracks.delete(m.id);s.set({peers:s.peers.filter(p=>p.id!==m.id),count:Math.max(1,s.count-1)});}
  if(m.type==='chat')s.set({messages:[...s.messages,{id:m.id,name:m.name,text:m.text,at:m.at,channel:(m.channel==='party'?'party':'room') as 'party'|'room',handle:m.handle??null,verified:m.verified===true}].slice(-80)});
  // The room moved us (meeting up with a party member): jump there rather than gliding.
  if(m.type==='meetUpResult'&&m.ok){Object.assign(player,{x:m.x,z:m.z,y:0,vy:0,reconcile:null});trail.clear();}
  if(m.type==='interaction')openLocation(m.id);
  if(m.type==='collected'&&!bridge?.verified())s.collect(m.id);
  if(m.type==='notice')s.notify(m.text);
  if(m.type==='result'||m.type==='world'||m.type==='events')receive(m);
  if(m.type==='auth')bridge?.onAuth(m);
  if(m.type==='progress')bridge?.onProgress(m);
  for(const fn of roomListeners)fn(m);
 };
 // Only a session that actually joined has room state to tear down: failed reconnect attempts while
 // exploring offline must not eject the player from the local vehicle or reset local interactions.
 ws.onclose=e=>{if(socket!==ws)return;socket=null;const joined=useGame.getState().status==='connected';if(!joined)failures++;livePeers.clear();peerTracks.clear();if(joined){disconnectVehicles();unbindNetwork();ownId='';for(const fn of roomListeners)fn({type:'disconnected'});}useGame.getState().set({status:e.code===4003?'removed':e.code===4001?'invitation required':e.code===4004?'session in use':'offline',peers:[],count:1});if(!stopped&&![4001,4003,4004].includes(e.code)){reconnect=setTimeout(connect,Math.min(15000,1000*2**retry++));}};
 ws.onerror=()=>{};
}
// QA builds only: lose the connection the way a phone does when it changes networks (the room still holds
// the old socket and only notices later), or close it outright.
if(QA_HOOKS)(window as unknown as Record<string,unknown>).__campusNet={abandon:()=>{const ws=socket;if(ws)ws.onclose?.(new CloseEvent('close',{code:1006}));},close:()=>socket?.close(),id:()=>ownId};
export function useNetwork(){const phase=useGame(s=>s.phase);useEffect(()=>{if(phase!=='playing')return;connect();return()=>{stopped=true;clearTimeout(reconnect);socket?.close();};},[phase]);}
