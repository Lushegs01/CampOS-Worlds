import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT, WAREHOUSE, BARREL, PACKAGE, SAFEHOUSE, O, distance } from '../shared/getaway.mjs';
import { blocked } from '../shared/campus.mjs';
import { createGetaway, combatInput, missionStep, missionInteract, viewMission } from '../server/mission/getaway.mjs';
import { createMissionService } from '../server/mission/service.mjs';
import { createFleet, localPoint, vehicleBlocked } from '../shared/vehicles.mjs';
import { startDatabase, rpc } from './support/postgres.mjs';

const fresh = (p={}) => ({id:'driver',token:'guest1',joined:true,x:CONTACT.x,z:CONTACT.z,y:0,vehicle:null,vehicleSeat:null,...p});
const aim = (p,a,h=1.15) => ({yaw:Math.atan2(a.x-p.x,a.z-p.z),pitch:Math.atan2(h-p.y-1.5,distance(p,a)),aim:true});
const newRun = checkpoint => createGetaway({now:0,checkpoint,random:()=>.5});
const dt=1/30;

test('offer and checkpoints bind to the correct player; objectives require presence and acceptance', async () => {
  const messages=[],fleet=createFleet();
  let now=1;
  const svc=createMissionService({fleet,accounts:{},time:()=>now,send:(c,m)=>messages.push([c.id,m]),place:Object.assign,release:c=>c.getaway?.fleet.release(c)});
  const p=fresh(),q=fresh({id:'other',token:'guest2'});
  svc.handle(p,{action:'accept'});assert.equal(p.getaway,undefined);
  svc.handle(p,{action:'brief'});svc.handle(p,{action:'accept'});assert.equal(p.getaway.stage,O.warehouse);
  assert.equal(q.getaway,undefined);
  svc.handle(p,{action:'deliver'});assert.equal(p.getaway.stage,O.warehouse);
  svc.depart(p);
  const back=fresh({id:'rejoined',x:0,z:0});
  await svc.load(q);await svc.load(back);
  assert.equal(messages.findLast(([id])=>id===q.id)[1].resume,null);
  assert.equal(messages.findLast(([id])=>id===back.id)[1].resume,O.warehouse);
  svc.handle(back,{action:'resume'});assert.equal(back.getaway.stage,O.warehouse);
  assert.ok(distance(back,CONTACT)<3);
  Object.assign(back,WAREHOUSE);
  now+=1;svc.step(back,dt);assert.equal(back.getaway.stage,O.combat);
  svc.handle(back,{action:'pause'});assert.equal(svc.frozen(back),true);
  svc.handle(back,{action:'pause'});assert.equal(svc.frozen(back),false);
  svc.handle(back,{action:'retry'});assert.equal(back.getaway.stage,O.warehouse);
  svc.handle(back,{action:'abandon'});assert.equal(back.getaway,null);
});

test('loadout fires distinct weapons, reloads, respects cover and defeats enemies',()=>{
  const m=newRun(),p=fresh(WAREHOUSE);
  missionStep(m,p,dt,1);assert.equal(m.stage,O.combat);
  const a=m.actors[0];Object.assign(a,{x:180,z:16});
  Object.assign(p,{x:186,z:19});
  const health=a.hp;
  combatInput(m,p,'fire',aim(p,a,.55),2);
  assert.equal(a.hp,health,'crate at x183 z18 blocks the shot');
  assert.equal(m.guns[0].mag,11);
  combatInput(m,p,'reload',{},2.5);
  assert.ok(m.reloadAt);
  missionStep(m,p,dt,5);assert.equal(m.guns[0].mag,12);assert.equal(m.guns[0].reserve,47);
  Object.assign(p,{x:181,z:14});
  for(let t=6;t<8;t+=.32)combatInput(m,p,'fire',aim(p,a),t);
  assert.equal(a.hp,0);
  assert.equal(m.defeated,1);
  combatInput(m,p,'equip',{slot:1},8.6);
  assert.equal(m.guns[m.arm].id,'vanguard');
  combatInput(m,p,'fire',aim(p,m.actors[1]),9);
  assert.equal(m.guns[1].mag,29);
  combatInput(m,p,'equip',{slot:2},9.5);
  Object.assign(p,{x:190,z:9});
  const operative=m.actors[2];
  combatInput(m,p,'fire',aim(p,operative),10);
  assert.ok(operative.hp<operative.maxHp);
  assert.equal(m.guns[2].mag,5);
});

test('patrol, auditory investigation, cover, visual search, reacquisition and downing',()=>{
  const m=newRun(),p=fresh(WAREHOUSE);
  missionStep(m,p,dt,1);
  const guard=m.actors[0];
  assert.ok(['patrol','idle','suspicious'].includes(guard.mode));
  Object.assign(p,{x:175,z:14}); // outside the wall, still audible
  combatInput(m,p,'fire',{yaw:Math.PI/2,pitch:0},2);
  assert.equal(guard.mode,'investigate');
  missionStep(m,p,dt,2.1);assert.equal(guard.mode,'investigate');
  Object.assign(p,{x:187,z:11});Object.assign(guard,{x:189,z:11,yaw:-Math.PI/2,hp:18});
  for(let t=3;t<6;t+=dt)missionStep(m,p,dt,t);
  assert.ok(['retreat','cover','engage','search'].includes(guard.mode));
  assert.ok(guard.seen>3);
  Object.assign(p,{x:175,z:14});
  for(let t=6;t<8.4;t+=dt)missionStep(m,p,dt,t);
  assert.ok(['search','patrol'].includes(guard.mode));
  Object.assign(p,{x:189,z:13});
  m.health=5;
  for(let t=9;t<28&&!m.failed;t+=dt)missionStep(m,p,dt,t);
  assert.ok(m.failed);
});

test('case gates delivery, fuel barrel respects shots, blast damages and cleans up, all three cars can drive',()=>{
  const m=newRun(O.ambush),p=fresh({x:191,z:28});
  assert.equal(missionInteract(m,p,'deliver',1),false);
  missionStep(m,p,dt,1);
  assert.equal(m.ambushed,true);assert.equal(m.wanted,1);
  Object.assign(p,{x:198,z:27});
  combatInput(m,p,'fire',aim(p,BARREL,.68),2);
  combatInput(m,p,'fire',aim(p,BARREL,.68),2.4);
  assert.equal(m.exploded,true);assert.ok(m.health<100);
  assert.equal(m.blastAt,null);
  const effects=viewMission(m,2.4).events;
  assert.equal(effects.filter(e=>e.kind==='blast').length,1);
  assert.ok(effects.some(e=>e.kind==='shot'&&e.impact&&e.surface==='metal'&&e.normal?.[2]<0));
  assert.equal(viewMission(m,2.5).events.length,0);
  for(let t=2.4;t<4;t+=dt)m.fleet.step(dt,[p],1000*t);
  for(const id of m.fleet.vehicles.map(v=>v.id)){
    const v=m.fleet.find(id);assert.equal(vehicleBlocked(v,m.fleet.vehicles),false);
    Object.assign(p,localPoint(v,1.3,0));assert.ok(m.fleet.enter(p,id).ok);
    const z=v.z;
    for(let t=1;t<2;t+=dt){m.fleet.control(p,{throttle:1,steer:0},1000*t);m.fleet.step(dt,[p],1000*t);}
    assert.ok(v.z>z+1);m.fleet.release(p);
  }
});

test('police dispatch, find visual, escalate, search and require travelled distance for evasion',()=>{
  const m=newRun(O.pursuit),p=fresh({x:257,z:54});
  for(let t=0;t<1.2;t+=dt)missionStep(m,p,dt,t);
  assert.ok(m.police.length>0);assert.equal(m.spotted,true);
  const first=m.police[0],start={x:first.x,z:first.z};
  assert.ok(distance(first,start)<.01);
  for(let t=1.2;t<3.5;t+=dt)missionStep(m,p,dt,t);
  assert.ok(distance(first,start)>1);
  m.heat=17;missionStep(m,p,dt,3.6);assert.equal(m.wanted,3);
  Object.assign(p,{x:322,z:4});
  for(let t=4;t<13;t+=dt)missionStep(m,p,dt,t);
  assert.ok(m.police.some(v=>v.mode==='search'));assert.equal(m.stage,O.pursuit);
  m.pursuitDistance=90;
  Object.assign(p,{x:394,z:21});
  for(let t=13;t<23;t+=dt)missionStep(m,p,dt,t);
  assert.equal(m.stage,O.safehouse);assert.equal(m.wanted,0);assert.equal(m.police.length,0);
  Object.assign(p,SAFEHOUSE);missionStep(m,p,dt,23);
  assert.ok(missionInteract(m,p,'deliver',24));assert.equal(m.stage,O.commit);
});

test('getaway collision damage can wreck the car and deterministically restore the motor pool',()=>{
  const m=newRun(O.pursuit),p=fresh();
  const v=m.fleet.find('getaway-compact');
  Object.assign(p,localPoint(v,1.55,0));
  assert.ok(m.fleet.enter(p,v.id).ok);
  for(let i=0;i<3&&!m.failed;i++){
    // A stationary test fixture moves the car back so each impact uses the same approach.
    Object.assign(v,{x:209,z:24,yaw:0,speed:20});
    for(let k=0;k<12&&!m.failed;k++){
      const t=i*2+k*dt;
      m.now=t;
      m.fleet.control(p,{throttle:1,steer:0,brake:false},1000*t);
      m.fleet.step(dt,[p],1000*t);
      missionStep(m,p,dt,t);
    }
  }
  assert.equal(v.condition,0);
  assert.match(m.failed,/wrecked/);
  assert.ok(m.crashes>=2);
  const rebuilt=newRun(m.checkpoint);
  assert.equal(rebuilt.fleet.find(v.id).condition,100);
  assert.equal(rebuilt.fleet.vehicles.length,3);
  assert.equal(rebuilt.police.length,0);
});

test('Postgres completion is service-only and concurrent retries grant one account one receipt', async t=>{
  const db=await startDatabase({name:'getaway'});
  t.after(()=>db.stop());
  const service={role:'service_role'};
  const ids=(await db.pool.query(`insert into auth.users(email,encrypted_password) values ('getaway-one@local','test'),('getaway-two@local','test') returning id`)).rows.map(r=>r.id);
  await db.pool.query(`insert into public.profiles(id,handle,display_name,avatar) values($1,'getaway1','One','{"model":"ada"}'),($2,'getaway2','Two','{"model":"ada"}')`,ids);
  const [p_user,other]=ids;
  await rpc(db.pool,'getaway_checkpoint',{p_user,p_checkpoint:{stage:4,stats:{defeated:3}}},service);
  assert.equal((await rpc(db.pool,'getaway_status',{p_user},service)).checkpoint.stage,4);
  const p_report={duration:89,defeated:5,distance:145,topSpeed:58,crashes:1,blastKills:0};
  await assert.rejects(rpc(db.pool,'getaway_complete',{p_user,p_report},{role:'authenticated',sub:p_user}),/permission denied/);
  const results=await Promise.all(Array.from({length:4},()=>rpc(db.pool,'getaway_complete',{p_user,p_report},service)));
  assert.equal(results.filter(r=>r.first).length,1);
  const record=await rpc(db.pool,'getaway_status',{p_user},service);
  assert.equal(record.checkpoint,null);assert.equal(record.xp,500);assert.equal(record.credits,250);
  assert.deepEqual(record.completion.report,p_report);
  assert.equal(await rpc(db.pool,'getaway_status',{p_user:other},service),null);
});

test('a cruiser can stop, deploy visible officers, contain and reboard when its target moves on',()=>{
  const m=newRun(O.pursuit),p=fresh({x:239,z:55.5});
  m.policeAt=Infinity;
  m.police=[{id:'getaway-unit-1',x:231,z:54,yaw:Math.PI/2,type:'car',speed:0,wheel:0,steering:0,
    occupants:[null,null,null,null],route:[],plan:0,mode:'dispatch',last:{x:p.x,z:p.z},lastSeen:-Infinity}];
  missionStep(m,p,dt,1);
  const deployed=viewMission(m,1);
  assert.equal(deployed.vehicles.find(v=>v.police).mode,'containment');
  assert.equal(deployed.officers.length,2);
  assert.ok(deployed.officers.every(o=>o.mode==='dismount'&&o.age===0));
  for(let now=1.04;now<3.5;now+=.04)missionStep(m,p,.04,now);
  assert.ok(viewMission(m,3.5).officers.every(o=>o.mode==='cover'));
  assert.ok(m.capture>0);
  Object.assign(p,{x:270,z:48});
  for(let now=3.54;now<7;now+=.04)missionStep(m,p,.04,now);
  assert.equal(viewMission(m,7).officers.length,0);
  assert.notEqual(m.police[0].mode,'containment');
});
