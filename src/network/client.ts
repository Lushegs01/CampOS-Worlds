import { useEffect } from 'react';
import { livePeers, player, useGame, type Peer } from '../state';
import { bindNetwork, unbindNetwork, receive, loadSnapshot } from '../interaction/world';
let socket:WebSocket|null=null;let ownId='';let reconnect:ReturnType<typeof setTimeout>;let retry=0;let stopped=false;
export function send(data:unknown){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(data));return true;}return false;}
export function interact(id:string){if(useGame.getState().status==='connected'){send({type:'interact',id});}else openLocation(id);}
function openLocation(id:string){useGame.getState().discover(id);useGame.getState().set({panel:id});document.exitPointerLock?.();}
let roster='';
/** Update live positions every message; touch React state only when the roster itself changes. */
function syncPeers(list:Peer[],count:number){
 const ids=new Set(list.map(p=>p.id));for(const id of livePeers.keys())if(!ids.has(id))livePeers.delete(id);
 for(const p of list){const live=livePeers.get(p.id);if(live)Object.assign(live,p);else livePeers.set(p.id,{...p});}
 const next=list.map(p=>p.id+'|'+p.name+'|'+JSON.stringify(p.avatar)).sort().join(';');const s=useGame.getState();
 if(next!==roster||count!==s.count){roster=next;s.set({peers:list.map(p=>({...p})),count});}
}
export function connect(){
 clearTimeout(reconnect);stopped=false;if(socket&&socket.readyState<2)return;
 const state=useGame.getState();state.set({status:'connecting'});
 const url=import.meta.env.VITE_WS_URL||`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
 // Handlers capture their own socket so a late close from a replaced connection can't clobber
 // the current one (React StrictMode reconnects once in development; real reconnects race too).
 const ws=new WebSocket(url);socket=ws;
 ws.onopen=()=>{if(socket!==ws)return;send({type:'join',name:useGame.getState().name,avatar:useGame.getState().avatar,invite:useGame.getState().invite,token:sessionStorage.getItem('campus-session')});};
 ws.onmessage=event=>{if(socket!==ws)return;let m;try{m=JSON.parse(event.data);}catch{return;}const s=useGame.getState();
  if(m.type==='welcome'){ownId=m.id;retry=0;sessionStorage.setItem('campus-session',m.token);Object.assign(player,m.position,{vy:0});bindNetwork(send,m.id);if(m.world)loadSnapshot(m.world);s.set({status:'connected'});}
  if(m.type==='state'){const self=m.players.find((p:{id:string})=>p.id===ownId);if(self&&Math.hypot(self.x-player.x,self.z-player.z)>2)Object.assign(player,{x:self.x,z:self.z,y:self.y});if(m.balls)receive({type:'balls',balls:m.balls});syncPeers(m.players.filter((p:Peer)=>p.id!==ownId),m.players.length);}
  if(m.type==='left'){livePeers.delete(m.id);s.set({peers:s.peers.filter(p=>p.id!==m.id),count:Math.max(1,s.count-1)});}
  if(m.type==='chat')s.set({messages:[...s.messages,{id:m.id,name:m.name,text:m.text,at:m.at}].slice(-60)});
  if(m.type==='interaction')openLocation(m.id);
  if(m.type==='collected')s.collect(m.id);
  if(m.type==='notice')s.notify(m.text);
  if(m.type==='result'||m.type==='world'||m.type==='events')receive(m);
 };
 ws.onclose=e=>{if(socket!==ws)return;socket=null;livePeers.clear();unbindNetwork();useGame.getState().set({status:e.code===4003?'removed':e.code===4001?'invitation required':e.code===4004?'session in use':'offline',peers:[],count:1});if(!stopped&&![4001,4003,4004].includes(e.code)){reconnect=setTimeout(connect,Math.min(15000,1000*2**retry++));}};
 ws.onerror=()=>{};
}
export function useNetwork(){const phase=useGame(s=>s.phase);useEffect(()=>{if(phase!=='playing')return;connect();return()=>{stopped=true;clearTimeout(reconnect);socket?.close();};},[phase]);}
