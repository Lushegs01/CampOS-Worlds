import { fixtureCalibration } from '../../shared/primitive-calibration.mjs';
import { PRIMITIVES, isGesture, seatRoute, doorHandle } from '../../shared/character-actions.mjs';
import { moveWithCollisions } from '../../shared/campus.mjs';
import { SEATS, SEAT_BY_ID, DOOR_BY_ID } from '../../shared/interactions.mjs';

export type Point = { x:number; z:number };
export type ActionPacket = [sequence:number, kind:string, target:string, at:number, x?:number, y?:number, z?:number];
export type GestureKind = 'door-push'|'door-pull'|'pickup';
export type Gesture = { kind: GestureKind; start:number; target?:string; point?:Point & {y:number} };
export type VehicleMotion = { kind:'vehicle-enter'|'vehicle-exit'; start:number; x:number; z:number; seatHeight:number };
export const gestureSpec = (kind:string) => isGesture(kind) ? PRIMITIVES[kind as GestureKind] : null;

type Request =
  | {kind:'sit';id:string;from:Point}
  | {kind:GestureKind;id:string;from:Point;point?:Point & {y:number}};
export interface MotionPlan {
  kind:Request['kind'];
  target:string;
  route:Point[];
  contactDelay:number;
  facing?:number;
  point?:Gesture['point'];
  stand?:Point;
}
export interface MotionProvider {
  readonly id: string;
  supports(request:Request):boolean;
  plan(request:Request, signal?:AbortSignal):MotionPlan|null|Promise<MotionPlan|null>;
}
// Cached clip definitions and fixture measurements. Planning runs on interaction intent.
export const clipProvider = {
  id:'campus-clips',
  supports(request:Request) {
    return request.kind==='sit' ? SEAT_BY_ID.has(request.id) : request.kind==='pickup' ? !!request.point : DOOR_BY_ID.has(request.id);
  },
  plan(request:Request, signal?:AbortSignal):MotionPlan|null {
    if(signal?.aborted||!this.supports(request))return null;
    const {kind,id,from}=request;
    if(kind==='sit'){
      const seat=SEAT_BY_ID.get(id)!;
      return {kind,target:id,route:seatRoute(seat,from,SEATS),facing:seat.yaw,contactDelay:0};
    }
    const point=request.point;
    let target:Point, stand:Point|undefined;
    if(kind==='pickup'){
      target=point!;
      const yaw=Math.atan2(target.x-from.x,target.z-from.z);
      if(Math.hypot(target.x-from.x,target.z-from.z)>.82)stand={x:target.x-Math.sin(yaw)*.67,z:target.z-Math.cos(yaw)*.67};
    }else{
      const door=DOOR_BY_ID.get(id)!;
      const calibration=fixtureCalibration(id);
      let best=Infinity;target=door;
      for(const leaf of door.leaves){
        const x=leaf.hx+doorHandle(door,leaf).x,d=Math.abs(from.x-x);
        if(d<best){best=d;target={x,z:leaf.hz};}
      }
      if(kind==='door-push'&&Math.hypot(target.x-from.x,target.z-from.z)>.84){
        stand={x:target.x,z:target.z+(from.z>=target.z?1:-1)*(.73+calibration.approach)};
      }
    }
    if(stand){
      const reach=moveWithCollisions(from.x,from.z,stand.x-from.x,stand.z-from.z);
      if(Math.hypot(reach.x-stand.x,reach.z-stand.z)>.11)stand=undefined;
    }
    const at=stand??from;
    return {kind,target:id,route:[],facing:Math.atan2(target.x-at.x,target.z-at.z),contactDelay:PRIMITIVES[kind].commitMs,point,stand};
  },
} satisfies MotionProvider;

export function packetGesture(packet:ActionPacket, playback:number, now:number):Gesture|null {
  const spec=gestureSpec(packet[1]);
  const age=(playback-packet[3])/1000;
  if(!spec||age < -.025||age>=spec.seconds)return null;
  const [,,target,,x,y,z]=packet;
  return {kind:packet[1] as GestureKind,start:now-Math.max(0,age),target,point:x===undefined||y===undefined||z===undefined?undefined:{x,y,z}};
}

export const GAITS=['idle','walk','jog','run'] as const;
export const speedsScratch = () => new Float32Array(4);
export function gaitTargets(out:Float32Array, speed:number, walk:number, jog:number, run:number) {
  out.fill(0);
  const s=Math.max(0,speed);
  const i=s<walk?0:s<jog?1:s<run?2:3;
  if(i===3){out[3]=1;return;}
  const from=i===0?0:i===1?walk:jog, to=i===0?walk:i===1?jog:run;
  const k=(s-from)/Math.max(1e-4,to-from);
  out[i]=1-k;out[i+1]=k;
}

export function packetVehicle(packet:ActionPacket, playback:number, now:number):VehicleMotion|null {
  const [,kind,,,x,y,z]=packet;
  if((kind!=='vehicle-enter'&&kind!=='vehicle-exit')||x===undefined||y===undefined||z===undefined)return null;
  const age=(playback-packet[3])/1000;
  return age>=-.025&&age<PRIMITIVES[kind].seconds ? {kind,start:now-Math.max(0,age),x,z,seatHeight:y} : null;
}
