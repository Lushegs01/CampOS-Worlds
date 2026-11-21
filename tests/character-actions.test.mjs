import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { characterAction, characterActionAt, doorHandle, markCharacterAction, PRIMITIVES, seatRoute } from '../shared/character-actions.mjs';
import { DOOR_BY_ID, SEATS, seatApproach } from '../shared/interactions.mjs';
import { MODELS } from '../shared/campus.mjs';
import { localPoint } from '../shared/vehicles.mjs';

test('shared motion intent prioritizes seats, sports, airborne phases, slide and weapon actions',()=>{
 const base={speed:1.8,grounded:true,vy:0};
 assert.equal(characterAction({...base,speed:0}),'idle');
 assert.equal(characterAction(base),'locomotion');
 assert.equal(characterAction({...base,sprint:true}),'sprint');
 assert.equal(characterAction({...base,grounded:false,vy:3}),'jump');
 assert.equal(characterAction({...base,grounded:false,vy:-2}),'fall');
 for(const [key,want] of [['seat','seating'],['sport','sport'],['interaction','interaction'],['slide','slide'],['crouch','crouch'],['vehicle','vehicle']])
   assert.equal(characterAction({...base,[key]:true}),want);
 assert.equal(characterAction({...base,phase:'reload'}),'reload');
});

test('fixture contracts use measured handle offsets and route chair approaches around the seat',()=>{
 const d=DOOR_BY_ID.get('library-main');
 assert.deepEqual(doorHandle(d,d.leaves[0]),{x:1.1,y:1.05,z:.06});
 const chair=SEATS.find(s=>s.kind==='chair');
 const behind={x:chair.x-Math.sin(chair.yaw),z:chair.z-Math.cos(chair.yaw)};
 assert.deepEqual(seatRoute(chair,seatApproach(chair),SEATS),[]);
 assert.equal(seatRoute(chair,behind,SEATS).length,2);
 assert.equal(seatRoute(SEATS[0],behind,SEATS).length,0);
});

function glb(path){
 const bytes=readFileSync(path);
 return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
}
test('all shipped body rigs carry both limb chains and both clip banks satisfy the fixture library',()=>{
 const models=[...MODELS.map(id=>`characters/${id}.glb`),...['m1','m2','f1'].flatMap(id=>['','mobile/'].map(t=>`arena/${t}characters/soldier-${id}.glb`))];
 for(const model of models){
   const g=glb('public/assets/'+model),nodes=new Set(g.skins[0].joints.map(i=>g.nodes[i].name.replaceAll(' ','_')));
   const parents=new Map(g.nodes.flatMap(node=>(node.children??[]).map(i=>[g.nodes[i].name.replaceAll(' ','_'),node.name.replaceAll(' ','_')])));
   for(const side of ['L','R'])for(const chain of [['UpperArm','Forearm','Hand'],['Thigh','Calf','Foot','Toe0']]){
     const joints=chain.map(n=>`Bip01_${side}_${n}`);
     for(const joint of joints)assert.ok(nodes.has(joint),model+' '+joint);
     for(let i=1;i<joints.length;i++)assert.equal(parents.get(joints[i]),joints[i-1],model);
   }
   for(const name of ['Pelvis','Spine','Spine1','Spine2','Neck','Head'])assert.ok(nodes.has('Bip01_'+name),model);
 }
 const aliases=new Set(['armsUp']);
 for(const id of ['m','f']){
   const g=glb(`public/assets/characters/anim-${id}.glb`), names=new Set(g.animations.map(a=>a.name));
   for(const p of Object.values(PRIMITIVES))for(const clip of p.clips)assert.ok(names.has(clip)||aliases.has(clip),clip);
 }
 const arms=glb('public/assets/arena/weapons/arms.glb');
 for(const side of ['L','R'])for(const stem of ['arm','elbow','wrist'])assert.ok(arms.skins[0].joints.some(i=>arms.nodes[i].name.startsWith(`${side}_${stem}`)));
});

test('motion projection is compact, sequence-numbered and expires independently of occupancy',()=>{
 const p={};
 markCharacterAction(p,'pickup','ball-1',1000,{x:1.234,y:.119,z:18.026});
 assert.deepEqual(p.characterAction,[1,'pickup','ball-1',1000,1.23,.12,18.03]);
 assert.equal(characterActionAt(p.characterAction,5000),null);
 markCharacterAction(p,'vehicle-enter','courtyard-car',2000,{x:1.3,y:.5,z:0});
 assert.equal(p.characterAction[0],2);
 assert.equal(characterActionAt(p.characterAction,2300)[1],'vehicle-enter');
});

function wait(ws,filter){
 return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{ws.off('message',read);reject(Error('Room message timeout'));},5000);
   function read(bytes){const m=JSON.parse(bytes);if(filter(m)){clearTimeout(timer);ws.off('message',read);resolve(m);}}
   ws.on('message',read);
 });
}
async function join(port){
 const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:'http://localhost:5173'});
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 const ready=wait(socket,m=>m.type==='welcome');
 const send=m=>socket.send(JSON.stringify(m));
 send({type:'join',name:'Motion QA',movement:1});
 return {socket,send,id:(await ready).id};
}
test('room emits poses only after gameplay validation, replicates the same sequence, and frees occupancy on disconnect',async()=>{
 const room=createRoom({port:0}),{port}=await room.start();let A,B;
 try{
   A=await join(port);B=await join(port);
   const actor=room.clients.get(A.id),observer=room.clients.get(B.id);
   const pair=()=>wait(B.socket,m=>m.type==='state'&&m.players.some(p=>p.id===A.id&&p.characterAction));
   A.send({type:'door',id:'library-main',open:true});
   const denied=await wait(A.socket,m=>m.type==='result'&&m.action==='door');
   assert.equal(denied.ok,false);
   assert.equal(actor.characterAction,undefined);
   Object.assign(actor,{x:-30,z:-2.6});
   const seen=pair();
   A.send({type:'door',id:'library-main',open:true});
   const peer=(await seen).players.find(p=>p.id===A.id);
   assert.deepEqual(peer.characterAction.slice(0,3),[1,'door-push','library-main']);
   assert.equal(peer.characterAction.length,4);
   const seat=SEATS[0], at=seatApproach(seat);
   Object.assign(actor,at);Object.assign(observer,at);
   const seatReply=wait(A.socket,m=>m.type==='result'&&m.action==='sit');
   A.send({type:'sit',seat:seat.id});assert.equal((await seatReply).ok,true);
   const conflict=wait(B.socket,m=>m.type==='result'&&m.action==='sit');
   B.send({type:'sit',seat:seat.id});assert.equal((await conflict).ok,false);
   assert.equal(observer.characterAction,undefined);
   const stand=wait(A.socket,m=>m.type==='result'&&m.action==='stand');
   A.send({type:'stand'});assert.equal((await stand).ok,true);
   assert.equal(actor.characterAction[1],'stand');
   const car=room.fleet.vehicles[0];Object.assign(actor,localPoint(car,1.55,0));
   const enterReply=wait(A.socket,m=>m.type==='vehicleResult');
   A.send({type:'vehicleEnter',id:car.id,seat:0});
   assert.deepEqual((await enterReply).characterAction.slice(0,3),[4,'vehicle-enter',car.id]);
   A.socket.close();await wait(B.socket,m=>m.type==='left'&&m.id===A.id);
   assert.equal(car.occupants[0],null);
 }finally{A?.socket.terminate();B?.socket.terminate();await room.close();}
});
