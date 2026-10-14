import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoom } from '../server/room.mjs';
import { blocked,moveWithCollisions,sanitizeAvatar ,setDoorOpen} from '../shared/campus.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function next(ws,predicate,timeout=3000){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.off('message',handler);reject(Error('Message timeout'));},timeout);const handler=raw=>{const m=JSON.parse(raw);if(predicate(m)){clearTimeout(t);ws.off('message',handler);resolve(m);}};ws.on('message',handler);});}
async function client(url,name){const ws=new WebSocket(url,{origin:'http://localhost:5173'});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const welcome=next(ws,m=>m.type==='welcome');ws.send(JSON.stringify({type:'join',name,avatar:{}}));return {ws,welcome:await welcome,send:m=>ws.send(JSON.stringify(m))};}
test('collision sweep respects the library door and stops tunnelling',()=>{assert.equal(blocked(-30,-4),true);setDoorOpen('library-main',true);assert.equal(blocked(-30,-4),false);setDoorOpen('library-staff',true);assert.equal(blocked(-34.95,-26.1),true,'locked doors stay shut');assert.equal(blocked(-37,-4),true);const p=moveWithCollisions(-30,0,-20,-10);assert.equal(blocked(p.x,p.z),false);assert.equal(blocked(NaN,0),true);assert.equal(blocked(1401,0),true);const c=moveWithCollisions(30,3,0,-100);assert.ok(c.z> -4.2&&c.z< -3);setDoorOpen('library-main',false);});
test('avatar inputs are allowlisted',()=>{const avatar=sanitizeAvatar({model:'../../etc/passwd',skin:'url(secret)',accent:'red',accessory:'script',extra:'x'});assert.deepEqual(avatar,{model:'tunde',skin:'natural',accent:'#353c4c',accessory:'backpack'});assert.equal(sanitizeAvatar({model:'zainab',skin:'#3a2219',accessory:'glasses'}).model,'zainab');});
test('two real clients: state authority, chat, emotes, proximity, reporting, moderator removal and cleanup',async()=>{
 const reportDir=await mkdtemp(join(tmpdir(),'campos-room-'));const room=createRoom({port:0,adminToken:'test-admin',reportDir});const address=await room.start();const url=`ws://127.0.0.1:${address.port}/ws`;let a,b;
 try{
  a=await client(url,'Ada');b=await client(url,'Tobi');let state=await next(a.ws,m=>m.type==='state'&&m.players.length===2);assert.equal(state.players.length,2);
  a.send({type:'input',dx:0,dz:-1,yaw:0,x:900,z:900});await delay(250);state=await next(b.ws,m=>m.type==='state');const ada=state.players.find(p=>p.id===a.welcome.id);assert.ok(ada.z<36&&ada.z>33);assert.equal(ada.x,0);
  const oldZ=ada.z;await delay(550);state=await next(b.ws,m=>m.type==='state');assert.ok(state.players.find(p=>p.id===a.welcome.id).z>oldZ-2,'stale inputs stop movement');
  const chat=next(b.ws,m=>m.type==='chat');a.send({type:'chat',text:'Hello campus'});assert.equal((await chat).text,'Hello campus');
  const emote=next(b.ws,m=>m.type==='state'&&m.players.some(p=>p.id===a.welcome.id&&p.emote==='wave'));a.send({type:'emote',emote:'wave'});await emote;
  let falseInteraction=false;const observer=raw=>{if(JSON.parse(raw).type==='interaction')falseInteraction=true;};a.ws.on('message',observer);a.send({type:'interact',id:'library'});await delay(150);assert.equal(falseInteraction,false);a.ws.off('message',observer);
  const notice=next(a.ws,m=>m.type==='notice');a.send({type:'report',id:b.welcome.id,reason:'Test report'});await notice;assert.match(await readFile(reportDir+'/reports.jsonl','utf8'),/Test report/);
  const unauth=await fetch(`http://127.0.0.1:${address.port}/admin/kick`,{method:'POST',body:JSON.stringify({id:b.welcome.id})});assert.equal(unauth.status,403);
  const closed=new Promise(r=>b.ws.once('close',code=>r(code)));await fetch(`http://127.0.0.1:${address.port}/admin/kick`,{method:'POST',headers:{Authorization:'Bearer test-admin'},body:JSON.stringify({id:b.welcome.id})});assert.equal(await closed,4003);
  state=await next(a.ws,m=>m.type==='state'&&m.players.length===1);assert.equal(state.players.length,1);
  const health=await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();assert.equal(health.players,1);
 }finally{a?.ws.close();b?.ws.close();await room.close();await rm(reportDir,{recursive:true,force:true});}
});
test('origin and invitation gates reject unauthorized joins',async()=>{const room=createRoom({port:0,invite:'private'});const address=await room.start();try{const ws=new WebSocket(`ws://127.0.0.1:${address.port}/ws`,{origin:'https://untrusted.example'});const error=await new Promise(r=>ws.once('error',r));assert.match(error.message,/403/);const c=new WebSocket(`ws://127.0.0.1:${address.port}/ws`,{origin:'http://localhost:5173'});await new Promise(r=>c.once('open',r));const closed=new Promise(r=>c.once('close',r));c.send(JSON.stringify({type:'join',name:'Guest'}));assert.equal(await closed,4001);}finally{await room.close();}});
