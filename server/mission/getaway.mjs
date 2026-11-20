import { blocked, collidersIn, moveWithCollisions } from '../../shared/campus.mjs';
import { createWorld, raycast, raySphere, lineOfSight } from '../../shared/arena/physics.mjs';
import { damageAt, WEAPON_BY_ID, TICK_RATE } from '../../shared/arena/weapons.mjs';
import { advance, createFleet, localPoint, vehicleBlocked } from '../../shared/vehicles.mjs';
import { roadRoute } from '../../shared/expansion.mjs';
import { CONTACT, WAREHOUSE, PACKAGE, BARREL, EXIT, SAFEHOUSE, GETAWAY_CARS, VEHICLE_BAY,
  INDUSTRIAL_SOLIDS, LOADOUT, REWARD, O, distance, inDistrict } from '../../shared/getaway.mjs';

const bounds = [110, -50, 306, 79];
const collision = createWorld(collidersIn(...bounds).map(b => ({
  min: [b.x-b.w/2, 0, b.z-b.d/2], max: [b.x+b.w/2, b.h, b.z+b.d/2],
})), bounds);
const clear = (a, b, eye = 1.45, height = eye) => {
  if (distance(a,b) < 0.02) return true;
  return lineOfSight(collision, a.x, eye + (a.y ?? 0), a.z, b.x, height + (b.y ?? 0), b.z);
};
const near = (a,b,r=2.6) => distance(a,b) < r;
const clamp = (n, min, max) => Math.min(max, Math.max(min,n));
const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
const facing = (a,b) => Math.atan2(b.x-a.x,b.z-a.z);
const point = (x,z) => ({x,z});
const GUARDS = [
  { id: 'guard-1', kind: 'guard', hp: 77, path: [point(185,14),point(188,11),point(181,14)] },
  { id: 'guard-2', kind: 'guard', hp: 77, path: [point(200,12),point(199,6),point(192,10)] },
  { id: 'operative', kind: 'operative', hp: 106, path: [point(190,6),point(186,5),point(190,13)] },
];
const AMBUSH = [
  { id: 'reinforcement-1', kind: 'guard', hp: 72, path: [point(171,36),point(184,34),point(198,32)] },
  { id: 'reinforcement-2', kind: 'operative', hp: 88, path: [point(221,34),point(213,35),point(199,34)] },
];
const POLICE_START = [
  { id:'getaway-unit-1', x:286, z:54, yaw:-Math.PI/2 }, { id:'getaway-unit-2', x:151, z:-24, yaw:Math.PI/2 },
  { id:'getaway-unit-3', x:111, z:57, yaw:Math.PI/2 },
];
const COVER = INDUSTRIAL_SOLIDS.filter(b => b.kind === 'crate' || b.kind === 'container')
  .flatMap(b => [point(b.x-b.w/2-.75,b.z),point(b.x+b.w/2+.75,b.z),point(b.x,b.z-b.d/2-.75),point(b.x,b.z+b.d/2+.75)]);
const CORNERS = INDUSTRIAL_SOLIDS.flatMap(b => [-1,1].flatMap(x => [-1,1].map(z =>
  point(b.x+x*(b.w/2+.68), b.z+z*(b.d/2+.68))))).filter(p=>!blocked(p.x,p.z,.4));
const walkClear = (a,b) => {
  const steps = Math.ceil(distance(a,b)/.5);
  for(let i=1;i<=steps;i++) if(blocked(a.x+(b.x-a.x)*i/steps,a.z+(b.z-a.z)*i/steps,.38)) return false;
  return true;
};
// Static edges are built once. Replanning only tests the actor and target against the graph.
let links;
function pathTo(a,b) {
  if(walkClear(a,b)) return [b];
  links ??= CORNERS.map((p,i)=>CORNERS.flatMap((q,j)=>j!==i&&walkClear(p,q)?[[j,distance(p,q)]]:[]));
  const end = CORNERS.length, scores = new Map(), parents = new Map(), open = new Set();
  CORNERS.forEach((p,i)=>{if(walkClear(a,p)){open.add(i);scores.set(i,distance(a,p));}});
  const seen = new Set();
  while(open.size){
    const i = [...open].reduce((best,k)=>scores.get(k)+(k===end?0:distance(CORNERS[k],b)) <
      scores.get(best)+(best===end?0:distance(CORNERS[best],b))?k:best);
    if(i===end){
      const route=[b]; let j=i;
      while(parents.has(j)){j=parents.get(j);route.unshift(CORNERS[j]);}
      return route;
    }
    open.delete(i); seen.add(i);
    const edges = walkClear(CORNERS[i],b)?[...links[i],[end,distance(CORNERS[i],b)]]:links[i];
    for(const [j,d] of edges){
      const score=scores.get(i)+d;
      if(seen.has(j)||score>=(scores.get(j)??Infinity))continue;
      scores.set(j,score);parents.set(j,i);open.add(j);
    }
  }
  return [];
}

function actors(list, now) {
  return list.map(s=>({...s,...s.path[0],yaw:0,maxHp:s.hp,mode:'patrol',index:0,awareness:0,
    nextShot:now+1.6,decision:now,seen:-Infinity,remember:null,goal:null,route:[],routeAt:0,searchUntil:0,hitAt:-Infinity}));
}

export function createGetaway({ now, checkpoint=O.warehouse, stats, random=Math.random, externalVehicles=()=>[] }) {
  const m = {
    stage:checkpoint, checkpoint, started:now, checkpointStats:stats, elapsed:stats?.duration??0, actors:[], police:[],
    events:[], health:100, paused:false, pauseAt:null, failed:null, defeated:stats?.defeated??0, carried:checkpoint>=O.ambush,
    exploded:checkpoint>=O.vehicle, ambushed:false, barrelHp:30, blastAt:null, blastKills:stats?.blastKills??0,
    arm:0, guns:LOADOUT.map(id=>{const w=WEAPON_BY_ID.get(id);return {id,mag:w.mag,reserve:w.reserve};}),
    reloadAt:null, nextShot:0, recoil:0, lastFire:-Infinity, wanted:checkpoint>=O.pursuit?2:0,
    spotted:false, lostAt:null, pursuitDistance:0, drivingDistance:stats?.distance??0, topSpeed:stats?.topSpeed??0,
    crashes:stats?.crashes??0, vitalsAt:now, policeAt:now+.7, lastDrive:null, heat:0, damageAt:null,
    report:null, random, externalVehicles, eventId:0, nextPush:0, saveError:false,
  };
  const damageVehicle = (v, amount) => { if(v.condition>0)v.condition=Math.max(0,v.condition-amount); };
  m.damageVehicle=damageVehicle;
  m.fleet=createFleet(GETAWAY_CARS,{obstacles:()=>[...externalVehicles(),...m.police],onImpact:(v,speed)=>{
    if(speed<3.9||v.impactAt&&m.now-v.impactAt<.4)return;
    v.impactAt=m.now; damageVehicle(v,(speed-3)*2.9);m.crashes++;event(m,'crash',v);
  }});
  for(const v of m.fleet.vehicles)v.condition=100;
  return m;
}
export const resultOf = (m, now) => ({
  duration:Math.max(0, Math.round((m.elapsed+now-m.started-(m.pauseAt===null?0:now-m.pauseAt))*1000)/1000),
  defeated:m.defeated, distance:Math.round(m.drivingDistance), topSpeed:Math.round(m.topSpeed*3.6),
  crashes:m.crashes, blastKills:m.blastKills,
});
function event(m,kind,p,data={}) {
  m.events.push({id:++m.eventId,kind,x:p.x,y:p.y??0,z:p.z,...data});
}
function advanceTo(m,stage,p) {
  m.stage=stage;
  event(m,'objective',p,{stage});
}
function checkpointAt(m,stage,now) {
  m.checkpoint=stage;
  m.checkpointStats=resultOf(m,now);
  // Stored in simulation units when reconstructing the run.
  m.checkpointStats.topSpeed/=3.6;
}
const fail = (m,reason,p) => { if(!m.failed){m.failed=reason;event(m,'failed',p);} };
const hurt = (m,p,n) => {
  if(m.failed)return;
  m.health=Math.max(0,m.health-n); m.damageAt=m.now; event(m,'hurt',p);
  if(!m.health)fail(m,'You were downed. Retry from the last checkpoint.',p);
};
function hitActor(m,a,d,blast=false) {
  if(a.hp<=0)return;
  a.hp=Math.max(0,a.hp-d); a.hitAt=m.now; a.awareness=1;
  event(m,'hit',a);
  if(!a.hp){a.mode='defeated';m.defeated++;if(blast)m.blastKills++;}
}
function explode(m,p) {
  if(m.exploded)return;
  m.exploded=true; m.blastAt=null;
  event(m,'blast',{...BARREL,y:.85});
  const d=distance(p,BARREL);
  if(d<10&&clear(BARREL,p,.9))hurt(m,p,Math.round(65*(1-d/10)));
  for(const a of m.actors)if(near(a,BARREL,9)&&clear(BARREL,a,.9))hitActor(m,a,105*(1-distance(a,BARREL)/12),true);
  for(const v of m.fleet.vehicles)if(near(v,BARREL,19)&&clear(BARREL,v,1.35)){
    m.damageVehicle(v,Math.round(60*(1-distance(v,BARREL)/19)));
    const away=facing(BARREL,v), yaw=Math.abs(angle(away-v.yaw))<Math.PI/2?1:-1;
    if(!v.occupants[0])v.speed=yaw*2;
  }
}

export function combatInput(m,p,action,command,now) {
  if(m.paused||m.failed||p.vehicle||p.dorm||!inDistrict(p.x,p.z)||![O.combat,O.package,O.ambush].includes(m.stage))return;
  const gun=m.guns[m.arm], w=WEAPON_BY_ID.get(gun.id);
  if(action==='equip'){
    if(Number.isInteger(command.slot)&&m.guns[command.slot]&&m.arm!==command.slot){
      m.arm=command.slot;m.reloadAt=null;m.nextShot=now+.22;m.recoil=0;
      event(m,'equip',p,{weapon:m.guns[m.arm].id});
    }
    return;
  }
  if(action==='reload'){
    if(!m.reloadAt&&gun.mag<w.mag&&gun.reserve>0){
      m.reloadAt=now+(w.reloadMode==='shell'?(w.reloadStart??0)+w.reload:gun.mag?w.reload:w.reloadEmpty)/TICK_RATE;
      event(m,'reload',p,{weapon:gun.id});
    }
    return;
  }
  if(action!=='fire'||!Number.isFinite(command.yaw)||!Number.isFinite(command.pitch)||now<m.nextShot||!gun.mag||(m.reloadAt&&w.reloadMode!=='shell'))return;
  m.reloadAt=null;m.now=now;gun.mag--;m.nextShot=now+60/w.rpm-.006;
  const aiming=command.aim===true, yaw=angle(command.yaw), pitch=clamp(command.pitch,-1.07,1.07);
  const cone=(aiming?w.spread.ads:w.spread.hip)*(p.moving?1.25:1);
  m.recoil=Math.max(0,m.recoil-(now-m.lastFire)*.045);
  const origin={x:p.x,y:1.5+p.y,z:p.z};
  let end, impact=false;
  for(let i=0;i<w.pellets;i++){
    const y=yaw+(m.random()*2-1)*cone, a=pitch+m.recoil+(m.random()*2-1)*cone;
    const dx=Math.sin(y)*Math.cos(a),dy=Math.sin(a),dz=Math.cos(y)*Math.cos(a);
    const wall=raycast(collision,origin.x,origin.y,origin.z,dx,dy,dz,w.range);
    let max=wall?.t??w.range, target=null, head=false;
    for(const enemy of m.actors){
      if(enemy.hp<=0)continue;
      for(const [height,radius,isHead] of [[.52,.37,false],[1.13,.44,false],[1.65,.24,true]]){
        const t=raySphere(origin.x,origin.y,origin.z,dx,dy,dz,enemy.x,height,enemy.z,radius,max);
        if(t>=0){max=t;target=enemy;head=isHead;}
      }
    }
    const fuel=m.stage===O.ambush&&m.ambushed&&!m.exploded
      ?raySphere(origin.x,origin.y,origin.z,dx,dy,dz,BARREL.x,.68,BARREL.z,.62,max):-1;
    if(fuel>=0){max=fuel;m.barrelHp-=damageAt(w,fuel);if(m.barrelHp<=0)explode(m,p);}
    else if(target)hitActor(m,target,damageAt(w,max)*(head?w.head:1));
    if(i===0){end=[origin.x+dx*max,origin.y+dy*max,origin.z+dz*max];impact=!!(wall||target||fuel>=0);}
  }
  event(m,'shot',origin,{end,weapon:w.id,impact});
  m.recoil=Math.min(w.recoil.max,m.recoil+w.recoil.kick*(aiming?w.recoil.adsRecoil:1));m.lastFire=now;
  for(const a of m.actors)if(a.hp&&near(a,p,29)){
    a.remember=point(p.x,p.z);
    if(a.mode==='idle'||a.mode==='patrol'||a.mode==='suspicious')a.mode='investigate';
    a.searchUntil=now+6;a.awareness=Math.max(a.awareness,.54);
  }
}
function guardStep(m,a,p,dt,now) {
  if(!a.hp)return;
  const d=distance(a,p), aim=facing(a,p);
  const inView=d<32&&(d<7||Math.abs(angle(aim-a.yaw))<1.4||now-a.seen<2)&&clear(a,p,1.54,1.35);
  if(inView){
    a.awareness=Math.min(1,a.awareness+dt*(d<14?3:1.7));
    a.remember=point(p.x,p.z);a.seen=now;
    if(a.awareness<1)a.mode='suspicious';
    else if(!['engage','cover','reposition','alert','retreat'].includes(a.mode)){
      a.mode='alert';a.decision=now+.65;a.goal=null;a.nextShot=Math.max(a.nextShot,now+.9);
    }
  }else if(now-a.seen>1.35&&['engage','cover','reposition','alert','retreat','suspicious'].includes(a.mode)){
    a.mode='search';a.goal=a.remember;a.searchUntil=now+5;a.routeAt=0;
  }
  let destination=null, speed=1.6;
  if(a.mode==='patrol'){
    destination=a.path[a.index];
    if(near(a,destination,.5)){a.index=(a.index+1)%a.path.length;a.mode='idle';a.decision=now+.8;}
  }else if(a.mode==='idle'&&now>=a.decision)a.mode='patrol';
  else if(a.mode==='alert'&&now>=a.decision){a.mode='engage';a.decision=now+1.25;}
  else if(a.mode==='investigate'||a.mode==='search'){
    destination=a.remember; speed=2.45;
    if(now>a.searchUntil){
      a.mode='patrol';a.awareness=0;a.remember=null;a.goal=null;a.routeAt=0;
    }else if(destination&&near(a,destination,1.8))destination=null;
  }else if(a.mode==='engage'){
    if(d>16){destination=a.remember;speed=2.9;}
    if(now>=a.decision){
      const defensive=a.hp<a.maxHp*.5;
      const options=COVER.filter(q=>near(q,a,15)&&distance(q,a)>1.5&&(!defensive||!clear(q,p,.95,1.35)));
      a.goal=options.sort((x,y)=>defensive?distance(a,x)-distance(a,y):
        Math.abs(distance(p,x)-8)-Math.abs(distance(p,y)-8))[0]??null;
      if(a.goal&&(defensive||a.kind==='operative')){
        a.mode=defensive?(a.hp<20?'retreat':'cover'):'reposition';a.decision=now+2.6;a.routeAt=0;
      }else a.decision=now+1.6;
    }
  }else if(['cover','retreat','reposition'].includes(a.mode)){
    destination=a.goal;speed=a.kind==='operative'?3.7:3.15;
    if(now>a.decision){a.mode='engage';a.decision=now+2;}
  }
  if(destination&&!near(a,destination,.42)){
    if(now>=a.routeAt){a.route=pathTo(a,destination);a.routeAt=now+.6;}
    while(a.route[0]&&near(a,a.route[0],.38))a.route.shift();
    if(a.route[0]){
      a.yaw=facing(a,a.route[0]);
      const step=Math.min(speed*dt,distance(a,a.route[0]));
      Object.assign(a,moveWithCollisions(a.x,a.z,Math.sin(a.yaw)*step,Math.cos(a.yaw)*step));
    }
  } else if(inView) a.yaw=aim;
  if(inView&&d<24&&a.mode==='engage'&&now>=a.nextShot){
    a.nextShot=now+(a.kind==='operative'?1.16:1.48)+m.random()*.42;
    const hit=m.random()<clamp(.87-d*.022-(p.moving?.18:0),.21,.8);
    event(m,'enemyShot',{...a,y:1.42},{end:[p.x+(hit?0:1.1),p.y+1.28,p.z],weapon:a.kind==='guard'?'sparrow':'vanguard'});
    if(hit)hurt(m,p,a.kind==='operative'?9:7);
  }
}
function dispatch(m,now) {
  const spawn=POLICE_START[m.police.length];
  if(!spawn)return;
  m.police.push({...spawn,type:'car',speed:0,wheel:0,steering:0,occupants:[null,null,null,null],
    route:[],plan:0,mode:'dispatch',last:EXIT,lastSeen:-Infinity,age:now,stuckAt:null,reverseUntil:0});
  event(m,'dispatch',spawn);
}
function chase(m,p,dt,now) {
  if(now>=m.policeAt&&m.police.length<m.wanted){
    dispatch(m,now);m.policeAt=now+4.5;
  }
  let visible=false, closest=Infinity;
  const vehicle=m.fleet.find(p.vehicle);
  const traffic=[...m.fleet.vehicles,...m.police,...m.externalVehicles()];
  for(const unit of m.police){
    const d=distance(unit,p);
    closest=Math.min(closest,d);
    const sees=d<61&&clear(unit,p,1.55,vehicle?1.35:1.3);
    if(sees){visible=true;unit.last=point(p.x,p.z);unit.lastSeen=now;unit.mode='pursuit';}
    else if(unit.mode==='pursuit'&&now-unit.lastSeen>1)unit.mode='search';
    if(now>=unit.plan){
      unit.plan=now+(sees?.85:2.8);
      const route=roadRoute(unit,unit.last);
      // Leave the road only for a nearby target on the apron. Long trips use district junctions.
      const direct=distance(unit,unit.last)<20&&clear(unit,unit.last,1.25);
      unit.route=direct?[unit.last]:route.points.filter((q,i)=>i>0||distance(unit,q)>6);
      if(unit.route.length===0||distance(unit.route.at(-1),unit.last)>3)unit.route.push(unit.last);
    }
    while(unit.route.length>1&&near(unit,unit.route[0],7))unit.route.shift();
    const next=unit.route[0]??unit.last,dest=distance(unit,next),turn=angle(facing(unit,next)-unit.yaw);
    const done=dest<3.4||d<4.3&&sees;
    const desired=done?0:clamp(18-Math.abs(turn)*8,4,18);
    if(!done&&Math.abs(unit.speed)<.45){
      unit.stuckAt??=now;
      if(now-unit.stuckAt>1.3){unit.reverseUntil=now+1;unit.stuckAt=null;}
    } else unit.stuckAt=null;
    if(unit.reverseUntil>now){
      advance(unit,{throttle:-.68,steer:-Math.sign(turn),brake:false},dt,traffic);
    }else{
      advance(unit,{throttle:desired>Math.abs(unit.speed)?.98:0,steer:clamp(turn*1.65,-1,1),brake:desired<Math.abs(unit.speed)-1},dt,traffic);
    }
  }
  m.closest=closest;
  m.spotted=visible;
  if(m.stage!==O.pursuit)return;
  if(visible){
    m.lostAt=null;m.heat+=dt;
    if(m.heat>=17&&m.wanted===2){m.wanted=3;m.policeAt=Math.min(m.policeAt,now+.7);event(m,'dispatch',p);}
  }else if(closest>42&&m.police.length&&m.pursuitDistance>=75){
    m.lostAt??=now;
    if(now-m.lostAt>=8){
      m.wanted=0;m.police=[];m.closest=Infinity;advanceTo(m,O.safehouse,p);
    }
  }else m.lostAt=null;
  if(visible&&closest<6&&(!vehicle||Math.abs(vehicle.speed)<1.3))m.capture=(m.capture??0)+dt;
  else m.capture=0;
  if(m.capture>7)fail(m,'Police boxed you in. Retry from the motor pool.',p);
}
export function missionStep(m,p,dt,now) {
  m.now=now;
  if(m.failed||m.paused||m.stage>=O.commit)return;
  if(m.stage===O.warehouse&&near(p,WAREHOUSE,8)&&p.z<23.7&&Math.abs(p.x-WAREHOUSE.x)<6&&!p.vehicle){
    m.actors=actors(GUARDS,now);advanceTo(m,O.combat,p);
  }
  if(m.reloadAt&&now>=m.reloadAt){
    const g=m.guns[m.arm],w=WEAPON_BY_ID.get(g.id),n=Math.min(g.reserve,w.mag-g.mag,w.reloadMode==='shell'?1:Infinity);
    g.mag+=n;g.reserve-=n;
    m.reloadAt=w.reloadMode==='shell'&&g.mag<w.mag&&g.reserve>0?now+w.reload/TICK_RATE:null;
  }
  if(m.stage===O.ambush&&!m.ambushed&&distance(p,PACKAGE)>19){
    m.ambushed=true;m.actors=actors(AMBUSH,now);m.blastAt=now+9;
    // The break-in alarm provides a real point for responding units to investigate.
    m.wanted=1;m.policeAt=now+3;event(m,'alarm',EXIT);
  }
  if(m.blastAt&&now>=m.blastAt)explode(m,p);
  if(m.stage===O.combat||m.stage===O.ambush){
    for(const a of m.actors)guardStep(m,a,p,dt,now);
    if(!m.failed&&m.actors.length&&m.actors.every(a=>!a.hp)){
      if(m.stage===O.combat)advanceTo(m,O.package,p);
      else if(m.exploded)advanceTo(m,O.vehicle,p);
    }
  }
  if(m.stage>=O.combat&&m.stage<=O.pursuit&&!inDistrict(p.x,p.z, m.stage===O.pursuit?270:85)){
    fail(m,'You left the operation area. Retry from the last checkpoint.',p);
  }
  if(m.stage===O.vehicle&&m.fleet.find(p.vehicle)&&p.vehicleSeat===0){
    advanceTo(m,O.pursuit,p);m.wanted=2;checkpointAt(m,O.pursuit,now);m.policeAt=Math.min(now+.8,m.policeAt);event(m,'dispatch',p);
  }
  if(m.stage===O.pursuit&&m.fleet.find(p.vehicle)){
    const v=m.fleet.find(p.vehicle);
    if(!v.condition)fail(m,'Your getaway vehicle is wrecked. Retry from the motor pool.',p);
    if(m.lastDrive){
      const d=Math.min(3,distance(v,m.lastDrive));m.pursuitDistance+=d;m.drivingDistance+=d;
    }
    m.lastDrive=point(v.x,v.z);m.topSpeed=Math.max(m.topSpeed,Math.abs(v.speed));
  }else m.lastDrive=null;
  if(m.wanted)chase(m,p,dt,now);
  if(m.stage===O.safehouse&&near(p,SAFEHOUSE,7)){advanceTo(m,O.deliver,p);checkpointAt(m,O.deliver,now);}
  if(now-m.vitalsAt>1.5){
    m.vitalsAt=now;
    if(m.damageAt!==null&&now-m.damageAt>8&&m.health<100)m.health=Math.min(100,m.health+4);
  }
}
export function missionInteract(m,p,action,now) {
  if(m.failed||m.paused||p.vehicle||p.dorm||p.seat||p.ball)return false;
  if(action==='package'&&m.stage===O.package&&near(p,PACKAGE)&&clear(p,PACKAGE,1.42,1)){
    m.carried=true;advanceTo(m,O.ambush,p);checkpointAt(m,O.ambush,now);event(m,'pickup',PACKAGE);return true;
  }
  if(action==='deliver'&&m.stage===O.deliver&&m.carried&&!m.wanted&&near(p,SAFEHOUSE)&&clear(p,SAFEHOUSE)){
    m.report=resultOf(m,now);advanceTo(m,O.commit,p);return true;
  }
  return false;
}
export const atContact = p => !p.vehicle&&!p.dorm&&!p.seat&&!p.ball&&near(p,CONTACT,3.15)&&clear(p,CONTACT);
export const getSpawn = checkpoint => ({
  ...(checkpoint===O.deliver?point(271,-33):checkpoint===O.pursuit?point(VEHICLE_BAY.x,40):checkpoint===O.ambush?point(PACKAGE.x,PACKAGE.z+2):point(CONTACT.x+1,CONTACT.z)),
  yaw:checkpoint===O.ambush?0:Math.PI/2,
});
export function viewMission(m,now) {
  const gun=m.guns[m.arm];
  const mark=[CONTACT,WAREHOUSE,WAREHOUSE,PACKAGE,EXIT,VEHICLE_BAY,SAFEHOUSE,SAFEHOUSE,SAFEHOUSE,null,null][m.stage];
  return {stage:m.stage,checkpoint:m.checkpoint,paused:m.paused,failed:m.failed,health:m.health,carried:m.carried,
    ambushed:m.ambushed,exploded:m.exploded,wanted:m.wanted,spotted:m.spotted,closest:Number.isFinite(m.closest)?Math.round(m.closest):null,
    escape:m.lostAt===null?0:clamp((now-m.lostAt)/8,0,1),gun,slot:m.arm,reloading:m.reloadAt?Math.max(0,m.reloadAt-now):0,mark,
    actors:m.actors.map(({id,kind,x,z,yaw,hp,maxHp,mode})=>({id,kind,x,z,yaw,hp,maxHp,mode})),
    vehicles:[...m.fleet.snapshot().map(v=>({...v,available:m.stage>=O.vehicle&&m.stage<=O.deliver})),...m.police.map(({id,type,x,z,yaw,speed,wheel,steering,occupants,mode})=>({id,type,x,z,yaw,speed,wheel,steering,occupants,police:true,mode,condition:100}))],
    report:m.report, reward:m.reward??null, saveError:m.saveError, events:m.events.splice(0)};
}
export { O, REWARD };
