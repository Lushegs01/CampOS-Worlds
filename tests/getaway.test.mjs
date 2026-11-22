import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT, WAREHOUSE, BARREL, PACKAGE, SAFEHOUSE, O, distance } from '../shared/getaway.mjs';
import { blocked } from '../shared/campus.mjs';
import { METRO_SHIFT } from '../shared/metro.mjs';
import { POLICE_BAYS } from '../shared/metro.mjs';
import { createGetaway, combatInput, missionStep, missionInteract, viewMission } from '../server/mission/getaway.mjs';
import { createMissionService } from '../server/mission/service.mjs';
import { createFleet, localPoint, vehicleBlocked } from '../shared/vehicles.mjs';
import { startDatabase, rpc } from './support/postgres.mjs';

const fresh = (p={}) => ({id:'driver',token:'guest1',joined:true,x:CONTACT.x,z:CONTACT.z,y:0,vehicle:null,vehicleSeat:null,...p});
const aim = (p,a,h=1.15) => ({yaw:Math.atan2(a.x-p.x,a.z-p.z),pitch:Math.atan2(h-p.y-1.5,distance(p,a)),aim:true});
const newRun = checkpoint => createGetaway({now:0,checkpoint,random:()=>.5});
const dt=1/30;
// The freight yard was authored in a local frame; the tests keep its local coordinates.
const L=(x,z)=>({x:x+METRO_SHIFT.x,z:z+METRO_SHIFT.z});

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
  const a=m.actors[0];Object.assign(a,L(180,16));
  Object.assign(p,L(186,19));
  const health=a.hp;
  combatInput(m,p,'fire',aim(p,a,.55),2);
  assert.equal(a.hp,health,'crate at x183 z18 blocks the shot');
  assert.equal(m.guns[0].mag,11);
  combatInput(m,p,'reload',{},2.5);
  assert.ok(m.reloadAt);
  missionStep(m,p,dt,5);assert.equal(m.guns[0].mag,12);assert.equal(m.guns[0].reserve,47);
  Object.assign(p,L(181,14));
  for(let t=6;t<8;t+=.32)combatInput(m,p,'fire',aim(p,a),t);
  assert.equal(a.hp,0);
  assert.equal(m.defeated,1);
  combatInput(m,p,'equip',{slot:1},8.6);
  assert.equal(m.guns[m.arm].id,'vanguard');
  combatInput(m,p,'fire',aim(p,m.actors[1]),9);
  assert.equal(m.guns[1].mag,29);
  combatInput(m,p,'equip',{slot:2},9.5);
  Object.assign(p,L(190,9));
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
  Object.assign(p,L(175,14)); // outside the wall, still audible
  combatInput(m,p,'fire',{yaw:Math.PI/2,pitch:0},2);
  assert.equal(guard.mode,'investigate');
  missionStep(m,p,dt,2.1);assert.equal(guard.mode,'investigate');
  Object.assign(p,L(187,11));Object.assign(guard,{...L(189,11),yaw:-Math.PI/2,hp:18});
  for(let t=3;t<6;t+=dt)missionStep(m,p,dt,t);
  assert.ok(['retreat','cover','engage','search','reposition'].includes(guard.mode),guard.mode);
  assert.ok(guard.seen>3);
  Object.assign(p,L(175,14));
  for(let t=6;t<8.4;t+=dt)missionStep(m,p,dt,t);
  assert.ok(['search','patrol'].includes(guard.mode));
  Object.assign(p,L(189,13));
  m.health=5;
  for(let t=9;t<28&&!m.failed;t+=dt)missionStep(m,p,dt,t);
  assert.ok(m.failed);
});

test('case gates delivery, fuel barrel respects shots, blast damages and cleans up, all three cars can drive',()=>{
  const m=newRun(O.ambush),p=fresh(L(191,28));
  assert.equal(missionInteract(m,p,'deliver',1),false);
  missionStep(m,p,dt,1);
  assert.equal(m.ambushed,true);assert.equal(m.pd.reports.length,1,'the alarm is a report, not an instant response');
  Object.assign(p,L(198,27));
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

test('getaway collision damage can wreck the car and deterministically restore the motor pool',()=>{
  const m=newRun(O.pursuit),p=fresh();
  const v=m.fleet.find('getaway-compact');
  Object.assign(p,localPoint(v,1.55,0));
  assert.ok(m.fleet.enter(p,v.id).ok);
  for(let i=0;i<3&&!m.failed;i++){
    // A stationary test fixture moves the car back so each impact uses the same approach.
    Object.assign(v,{...L(209,24),yaw:0,speed:20});
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
  assert.equal(rebuilt.pd.units.filter(u=>u.role!=='patrol').length,1,'only the unit answering the alarm');
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

