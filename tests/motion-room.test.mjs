import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { createPrediction } from '../shared/prediction.mjs';

function next(ws, predicate) {return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handler);reject(Error('message timeout'));},3000);const handler=raw=>{const m=JSON.parse(raw);if(predicate(m)){clearTimeout(timer);ws.off('message',handler);resolve(m);}};ws.on('message',handler);});}
test('real room acknowledges exact physics, rejects legacy movement bypass and retires pre-teleport inputs', async()=>{
 const room=createRoom({port:0}),address=await room.start(),ws=new WebSocket(`ws://127.0.0.1:${address.port}/ws`,{origin:'http://localhost:5173'});
 try{
  await new Promise(r=>ws.once('open',r));const welcome=next(ws,m=>m.type==='welcome');ws.send(JSON.stringify({type:'join',name:'Motion QA',movement:1}));const joined=await welcome,c=room.clients.get(joined.id);
  const w={...joined.motion,yaw:0},p=createPrediction(w);p.receive(joined.motion);p.frame(0,0,0,false,false,0);
  p.frame(.1,1,0,true,true,Math.PI/2);const batch=p.batch();p.didSend(batch);
  const state=next(ws,m=>m.type==='state'&&m.motion?.seq===1);ws.send(JSON.stringify(batch));const ack=await state;
  for(const k of ['x','y','z','vx','vy','vz'])assert.equal(ack.motion[k],w[k],k);
  const x=c.x;ws.send(JSON.stringify(batch));ws.send(JSON.stringify({type:'input',dx:1,dz:0,sprint:true,yaw:0}));ws.send(JSON.stringify({type:'settle',x:x+.5,z:c.z}));
  await next(ws,m=>m.type==='state');assert.equal(c.x,x,'duplicates and legacy messages cannot move a sequenced client');
  Object.assign(c,{x:-300,z:300,y:0,vx:0,vz:0,vy:0});
  const relocated=await next(ws,m=>m.type==='state'&&m.motion.epoch>joined.motion.epoch);p.receive(relocated.motion);
  ws.send(JSON.stringify({...batch,commands:[[2,.1,1,0,1,0,0]]}));await next(ws,m=>m.type==='motion');assert.equal(c.x,-300);
  assert.equal(p.pending,0);assert.equal(w.vx,0);
  // TCP may deliver two seconds of ordinary 20 Hz sends at once. The server's clock still bounds
  // movement; a per-second message counter must not drop the tail and strand the command sequence.
  const burst=next(ws,m=>m.type==='state'&&m.motion.seq===40);
  for(let seq=1;seq<=40;seq++)ws.send(JSON.stringify({type:'move',epoch:relocated.motion.epoch,commands:[[seq,.001,1,0,0,0,0]]}));
  await burst;assert.ok(c.x>-300&&c.x<-299.9);
 }finally{ws.terminate();await room.close();}
});
