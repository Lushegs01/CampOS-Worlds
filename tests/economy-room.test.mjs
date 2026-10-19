import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createRoom} from '../server/room.mjs';
import {LAB_STATIONS} from '../shared/economic-lab.mjs';
const next=(ws,predicate)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',read);reject(Error('Room response timed out'));},3000);function read(raw){const m=JSON.parse(raw);if(predicate(m)){clearTimeout(timer);ws.off('message',read);resolve(m);}}ws.on('message',read);});
test('room protocol rejects remote and malformed operations, isolates players and preserves ordinary gameplay',async()=>{
 const room=createRoom({port:0});const address=await room.start();const ws=new WebSocket(`ws://127.0.0.1:${address.port}/ws`,{origin:'http://localhost:5173'});
 try {
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});const welcome=next(ws,m=>m.type==='welcome');ws.send(JSON.stringify({type:'join',name:'Lab participant'}));const joined=await welcome,c=room.clients.get(joined.id);let n=0;
  const ask=async payload=>{const ref=++n,p=next(ws,m=>m.type==='labResult'&&m.ref===ref);ws.send(JSON.stringify({type:'lab',ref,key:`network-op-${n}`,...payload}));return p;};
  assert.equal((await ask({station:'control',action:'start',run:null,policy:'fixed',seed:42})).ok,false);
  Object.assign(c,LAB_STATIONS[0].point);let r=await ask({station:'control',action:'start',run:null,policy:'fixed',seed:42,seedOrders:true});assert.ok(r.ok);const run=r.view.current.id;
  assert.equal((await ask({station:[],action:{},run})).ok,false);
  Object.assign(c,LAB_STATIONS.find(s=>s.id==='agents').point);r=await ask({station:'agents',action:'agent',run});assert.ok(r.ok);assert.equal(r.view.current.metrics.agentAccepted,1);
  // A client-provided accepted flag cannot call a privileged lifecycle operation.
  assert.equal((await ask({station:'agents',action:'accept',run,accepted:true,balance:999999})).ok,false);
  const chat=next(ws,m=>m.type==='chat');ws.send(JSON.stringify({type:'chat',text:'Campus is still here'}));assert.equal((await chat).text,'Campus is still here');
  const health=await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();assert.equal(health.ok,true);
 }finally{ws.terminate();await room.close();}
});
