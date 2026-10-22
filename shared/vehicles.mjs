import { blocked, FOOTPRINTS } from './campus.mjs';
import { BUILDINGS, DISTRICTS, COURTYARD_PARKING } from './expansion.mjs';
import { DORM_ROOM } from './dorm.mjs';
import { COURT } from './ball.mjs';
export const VEHICLE_TYPES = {
 // Dimensions in metres. Seats are [x, z] hip points in the vehicle frame (+z forward, +x left):
 // left-hand drive, as on Nigerian roads. seatHeight is the cushion height used by the seated pose.
 car:{name:'Campus Compact',length:4.3,width:1.78,wheelbase:2.6,height:1.5,wheelRadius:.31,maxSpeed:23,reverse:6,accel:4.8,brake:10,steer:.55,seats:[[.37,-.02],[-.37,-.02],[.37,-.86],[-.37,-.86]],seatHeight:.5},
 shuttle:{name:'Òrìṣun Shuttle',length:6.6,width:2.2,wheelbase:3.9,height:2.65,wheelRadius:.38,maxSpeed:17,reverse:4,accel:2.8,brake:8,steer:.43,seats:[[.55,2.3],[-.55,1.2],[.55,1.2],[-.55,.1],[.55,.1],[-.55,-1],[.55,-1],[-.55,-2.1]],seatHeight:1.05},
 cart:{name:'Garden Cart',length:2.75,width:1.3,wheelbase:1.7,height:1.9,wheelRadius:.24,maxSpeed:11,reverse:4,accel:3.8,brake:8,steer:.65,seats:[[.3,-.12],[-.3,-.12]],seatHeight:.62},
};
// Parked nose-out in marked bays so drivers pull straight out onto the road.
/** @type {{id:string,type:keyof typeof VEHICLE_TYPES,x:number,z:number,yaw:number}[]} */
export const VEHICLE_SPAWNS=[{id:'courtyard-car',type:'car',x:COURTYARD_PARKING.x-4.5,z:63,yaw:Math.PI},...DISTRICTS.flatMap((d,i)=>[{id:`${d.id}-shuttle`,type:'shuttle',x:d.x+24,z:d.z+28,yaw:Math.PI},{id:`${d.id}-local`,type:i%2?'cart':'car',x:d.x+36,z:d.z+28,yaw:Math.PI}])];
export function localPoint(v,x,z){return {x:v.x+x*Math.cos(v.yaw)+z*Math.sin(v.yaw),z:v.z-x*Math.sin(v.yaw)+z*Math.cos(v.yaw)};}
export function seatAnchor(v,index){const t=VEHICLE_TYPES[v.type],s=t.seats[index];return {...localPoint(v,...s),y:t.seatHeight,yaw:v.yaw};}
export function vehicleContains(v,x,z,pad=.3){const dx=x-v.x,dz=z-v.z,t=VEHICLE_TYPES[v.type],c=Math.cos(v.yaw),s=Math.sin(v.yaw);return Math.abs(dx*c-dz*s)<t.width/2+pad&&Math.abs(dx*s+dz*c)<t.length/2+pad;}
// Vehicles drive anywhere outdoors: roads, car parks, lawns, paths, the football pitch and open land between
// districts. Walls, trees, fences and people block them; they never enter a building (or your room), and
// stay off the fenced basketball court, where a parked car would block a game.
const span_=r=>({x:(r.x0+r.x1)/2,z:(r.z0+r.z1)/2,w:r.x1-r.x0,d:r.z1-r.z0});
export const NO_DRIVE=[...FOOTPRINTS.map(span_),...BUILDINGS,span_(DORM_ROOM),span_(COURT)];
/** False where any part of a vehicle `pad` metres round this point would be inside a building or on the court. */
export function drivable(x,z,pad=0){return !NO_DRIVE.some(r=>Math.abs(x-r.x)<r.w/2+pad&&Math.abs(z-r.z)<r.d/2+pad);}
const fail=reason=>({ok:false,reason});
const blank=()=>({throttle:0,steer:0,brake:true});
export function vehicleBlocked(v,all,players=[]){
 const t=VEHICLE_TYPES[v.type];
 // Overlapping circles cover the chassis; <=0.2 m sweep prevents tunnelling at full speed.
 const span=t.length-t.width,n=Math.ceil(span/.3);for(let j=0;j<=n;j++){const p=localPoint(v,0,-span/2+j*span/n);if(blocked(p.x,p.z,t.width/2)||!drivable(p.x,p.z,t.width/2))return true;}
 // Separating-axis rectangle test for other vehicles.
 for(const o of all){if(o.id===v.id)continue;const u=VEHICLE_TYPES[o.type];if(Math.hypot(v.x-o.x,v.z-o.z)>t.length+u.length)continue;let separated=false;
  for(const a of [v.yaw,o.yaw])for(const angle of [a,a+Math.PI/2]){const ax=Math.cos(angle),az=-Math.sin(angle);const radius=(p,k)=>Math.abs(ax*Math.cos(p.yaw)-az*Math.sin(p.yaw))*k.width/2+Math.abs(ax*Math.sin(p.yaw)+az*Math.cos(p.yaw))*k.length/2;
   if(Math.abs((v.x-o.x)*ax+(v.z-o.z)*az)>=radius(v,t)+radius(o,u)+.08)separated=true;}
  if(!separated)return true;
 }
 return players.some(p=>!p.vehicle&&vehicleContains(v,p.x,p.z,.35));
}
export function createFleet(){
 const vehicles=VEHICLE_SPAWNS.map(s=>({...s,speed:0,steering:0,wheel:0,occupants:VEHICLE_TYPES[s.type].seats.map(()=>/** @type {string|null} */(null)),input:blank(),inputAt:0,idle:0}));
 const find=id=>vehicles.find(v=>v.id===id);

 function sync(v,players){v.occupants.forEach((id,i)=>{const p=players.find(p=>p.id===id);if(p){const a=seatAnchor(v,i);Object.assign(p,{x:a.x,z:a.z,y:0,yaw:v.yaw,vx:0,vz:0,vy:0,moving:false,vehicle:v.id,vehicleSeat:i});}});}
 function home(v,players){const spawn=VEHICLE_SPAWNS.find(s=>s.id===v.id);if(vehicleBlocked({...v,...spawn},vehicles,players))return false;Object.assign(v,spawn,{speed:0,steering:0,input:blank(),idle:0});sync(v,players);return true;}
 return {vehicles,find,
  snapshot:()=>vehicles.map(({input,inputAt,idle,...v})=>({...v,occupants:[...v.occupants]})),
  enter(p,id,seat=0){const v=find(id);if(!v||!Number.isInteger(seat)||seat<0||seat>=v.occupants.length)return fail('Unknown vehicle seat.');if(p.vehicle||p.seat||p.ball||p.y>.05)return fail('Stand up and put down the ball first.');if(v.occupants[seat])return fail('That seat is taken.');if(Math.abs(v.speed)>.5)return fail('Wait for the vehicle to stop.');const t=VEHICLE_TYPES[v.type],a=localPoint(v,(t.seats[seat][0]<0?-1:1)*(t.width/2+.65),t.seats[seat][1]);if(Math.hypot(p.x-a.x,p.z-a.z)>3)return fail('Approach a vehicle door.');v.occupants[seat]=p.id;p.vehicle=v.id;p.vehicleSeat=seat;p.input={dx:0,dz:0};v.idle=0;sync(v,[p]);return {ok:true};},
  exit(p,players=[]){const v=find(p.vehicle);if(!v)return fail('You are not in a vehicle.');if(Math.abs(v.speed)>.5)return fail('Stop before exiting.');const t=VEHICLE_TYPES[v.type],sz=t.seats[p.vehicleSeat]?.[1]??0,side=(t.seats[p.vehicleSeat]?.[0]??-1)<0?-1:1;
   const points=[localPoint(v,side*(t.width/2+.8),sz),localPoint(v,-side*(t.width/2+.8),sz),localPoint(v,0,-t.length/2-1),localPoint(v,0,t.length/2+1)];
   const q=points.find(q=>!blocked(q.x,q.z)&&!vehicles.some(o=>vehicleContains(o,q.x,q.z,.35))&&!players.some(o=>o.id!==p.id&&!o.vehicle&&Math.hypot(o.x-q.x,o.z-q.z)<.65));if(!q)return fail('No safe exit. Move to an open parking bay.');
   v.occupants[p.vehicleSeat]=null;if(p.vehicleSeat===0){v.input=blank();v.speed=0;}Object.assign(p,q,{vehicle:null,vehicleSeat:null,y:0,vy:0,vx:0,vz:0});return {ok:true,...q};},
  control(p,m,now=Date.now()){const v=find(p.vehicle);if(!v||v.occupants[0]!==p.id)return fail('Only the driver can control this vehicle.');if(![m.throttle,m.steer].every(Number.isFinite))return fail('Invalid input.');v.input={throttle:Math.max(-1,Math.min(1,m.throttle)),steer:Math.max(-1,Math.min(1,m.steer)),brake:m.brake===true};v.inputAt=now;return {ok:true};},
  recover(p,players=[]){const v=find(p.vehicle)||vehicles.find(v=>Math.hypot(p.x-v.x,p.z-v.z)<5&&!v.occupants.some(Boolean));if(!v)return fail('Approach an empty vehicle or sit in the driver seat.');if(v.occupants.some((id,i)=>id&&(i!==0||id!==p.id))||Math.abs(v.speed)>.5)return fail('Stop and let passengers exit before recovery.');return home(v,players)?{ok:true}:fail('The home bay is occupied. Try again when it is clear.');},
  release(p){for(const v of vehicles){const driver=v.occupants[0]===p.id;v.occupants=v.occupants.map(id=>id===p.id?null:id);if(driver){v.speed=0;v.input=blank();}}p.vehicle=null;p.vehicleSeat=null;},
  step(dt,players,now=Date.now()){dt=Math.min(.25,Math.max(0,dt));for(const v of vehicles){const t=VEHICLE_TYPES[v.type],active=v.occupants[0]&&now-v.inputAt<350,i=active?v.input:blank();
    const steps=!v.speed&&!i.throttle?0:Math.max(1,Math.ceil(dt/.008)),h=dt/steps;
    for(let k=0;k<steps;k++){let accel=i.throttle*t.accel;if(i.brake)accel=-Math.sign(v.speed)*t.brake*1.5;else if(i.throttle*v.speed<0)accel=i.throttle*t.brake;
      const old=v.speed;v.speed+=accel*h;if(i.brake&&old*v.speed<0)v.speed=0;
      v.speed*=Math.exp(-h*(i.throttle&&!i.brake?.035:.7));v.speed=Math.max(-t.reverse,Math.min(t.maxSpeed,v.speed));if(Math.abs(v.speed)<.015)v.speed=0;
      v.steering+=(i.steer*t.steer/(1+Math.abs(v.speed)/18)-v.steering)*Math.min(1,h*7);
      const yaw=v.yaw+v.speed/t.wheelbase*Math.tan(v.steering)*h,q={...v,yaw,x:v.x+Math.sin(yaw)*v.speed*h,z:v.z+Math.cos(yaw)*v.speed*h};
      if(vehicleBlocked(q,vehicles,players)){v.speed=0;}else{v.x=q.x;v.z=q.z;v.yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));v.wheel+=v.speed*h/.32;}
    }
    sync(v,players);if(!v.occupants.some(Boolean)){v.idle+=dt;if(v.idle>300)home(v,players);}else v.idle=0;
   }}
 };
}
