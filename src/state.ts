import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SPAWN, TOUR, LOCATIONS, sanitizeAvatar } from '../shared/campus.mjs';
import { suggestedQuality } from './world/quality';
export type AvatarConfig = ReturnType<typeof sanitizeAvatar>;
export type Panel = null|'map'|'profile'|'settings'|'chat'|'players'|'avatar'|string;
export type Peer = {id:string;name:string;avatar:AvatarConfig;x:number;y:number;z:number;yaw:number;moving:boolean;sprinting:boolean;emote:string;emoteAt:number;seat?:string|null;ball?:string|null;handle?:string|null;verified?:boolean;title?:string|null;vehicle?:string|null;vehicleSeat?:number|null};
/** Public room chat or party chat. Private messages are separate (src/social) and never mixed in here. */
export type ChatMessage = {id:string;name:string;text:string;at:number;channel:'room'|'party';handle:string|null;verified:boolean};
/** Mutes are local to this device: by handle for signed-in players (it survives their reconnects), by session otherwise. */
export const muteKey = (p:{id:string;handle?:string|null}) => p.handle ? 'h:'+p.handle : p.id;
export const isMuted = (muted:string[], p:{id:string;handle?:string|null}) => muted.includes(p.id) || (!!p.handle && muted.includes('h:'+p.handle));
/** Seating sequence: walk to the stand point, sit (motion-captured), remain seated, stand. */
export type SitState = {seat:string;phase:'approach'|'request'|'down'|'seated'|'up'|'done';t:number;exit?:{x:number;z:number};path?:{x:number;z:number}[]};
export type Gesture = {kind:'door-push'|'door-pull'|'pickup';start:number};
// speed (m/s) and turn (rad/s) drive the animation blend; y and vy drive the jump layer.
export const player = {...SPAWN,yaw:Math.PI,moving:false,sprinting:false,vy:0,speed:0,turn:0,emote:'',emoteUntil:0,
 vehicleSeatHeight:null as number|null, sit:null as SitState|null, gesture:null as Gesture|null, charge:null as number|null, release:0, holding:false,
 /** Where the room has us when we drifted too far to settle (glided to while standing still). */
 reconcile:null as {x:number;z:number}|null};
export const input = {x:0,z:0,jump:false,yaw:0,pitch:.04,dragging:false};
// Latest remote positions arrive at 15 Hz; they live outside React so the scene reads them per frame
// and React only re-renders when someone joins, leaves or changes their name or appearance.
export const livePeers = new Map<string,Peer>();
export const useGame = create<Game>()(persist((set,get)=>({
 phase:'welcome',panel:null,ready:false,name:'New explorer',avatar:sanitizeAvatar(),quality:suggestedQuality(),reducedMotion:false,volume:0,
 discovered:[],tokens:[],tour:false,tourStep:0,bestScore:0,nearby:null,toast:'',destination:null,
 status:'offline',count:1,peers:[],messages:[],muted:[],invite:'',fps:0,
 set:(value)=>set(value),
 notify:(toast)=>{set({toast});setTimeout(()=>{if(get().toast===toast)set({toast:''});},4500);},
 discover:(id)=>{const s=get();if(!s.discovered.includes(id))set({discovered:[...s.discovered,id]});if(s.tour&&TOUR[s.tourStep]===id){const next=s.tourStep+1;set({tourStep:next,destination:TOUR[next]??null});s.notify(next===TOUR.length?'Campus compass badge earned. You belong here!':`Stop ${next} complete. Next: ${LOCATIONS.find(l=>l.id===TOUR[next])?.name}`);}},
 collect:(id)=>{if(get().tokens.includes(id))return;set({tokens:[...get().tokens,id]});get().notify(get().tokens.length===6?'All six found! Discovery badge earned.':'Campus keepsake found · '+get().tokens.length+' / 6');}
}),{name:'campos-worlds-v1',partialize:s=>({name:s.name,avatar:s.avatar,quality:s.quality,reducedMotion:s.reducedMotion,volume:s.volume,discovered:s.discovered,tokens:s.tokens,tour:s.tour,tourStep:s.tourStep,bestScore:s.bestScore,muted:s.muted}),merge:(saved,current)=>{const s=saved as Partial<Game>;return {...current,...s,avatar:sanitizeAvatar(s?.avatar??{}),phase:'welcome',panel:null};}}));
interface Game {
 phase:'welcome'|'playing'; panel:Panel;ready:boolean;name:string;avatar:AvatarConfig;quality:'low'|'medium'|'high';reducedMotion:boolean;volume:number;
 discovered:string[];tokens:string[];tour:boolean;tourStep:number;bestScore:number;nearby:string|null;toast:string;destination:string|null;
 status:string;count:number;peers:Peer[];messages:ChatMessage[];muted:string[];invite:string;fps:number;
 set:(value:Partial<Game>)=>void; notify:(toast:string)=>void;discover:(id:string)=>void;collect:(id:string)=>void;
}
