import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';
import { createModeration } from '../server/moderation.mjs';
import { roomConfig } from '../server/config.mjs';

const origin='https://campus.example', adminToken='test-room-admin-secret';
function message(ws,predicate){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{ws.off('message',handler);reject(Error('Message timeout'));},4000);
 const handler=raw=>{const m=JSON.parse(raw);if(predicate(m)){clearTimeout(timer);ws.off('message',handler);resolve(m);}};
 ws.on('message',handler);
});}
async function connect(port,extra={}){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 return {ws,join(){const next=message(ws,m=>m.type==='welcome');ws.send(JSON.stringify({type:'join',name:'Explorer',...extra}));return next;}};
}
const closed=ws=>new Promise(resolve=>ws.once('close',resolve));
const request=(port,path,body,token=adminToken)=>fetch(`http://127.0.0.1:${port}${path}`,{
 method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000),
});

test('production config rejects incomplete, insecure and out-of-range settings without exposing secrets',()=>{
 const env={NODE_ENV:'production',ALLOWED_ORIGINS:origin,ADMIN_TOKEN:'x'.repeat(32)};
 assert.equal(roomConfig(env).capacity,48);
 for(const extra of [{ALLOWED_ORIGINS:''},{ALLOWED_ORIGINS:'http://campus.example'},{ALLOWED_ORIGINS:origin+'/path'},
  {ALLOWED_ORIGINS:'https://localhost'},{ADMIN_TOKEN:'short'},{PORT:'NaN'},{ROOM_CAPACITY:'500'},
  {SUPABASE_URL:'https://accounts.example'},{SUPABASE_URL:'https://accounts.example',SUPABASE_SERVICE_ROLE_KEY:'key',BACHS_SECRET_KEY:'secret'},
  {ANALYTICS_ENABLED:'1'},{ANALYTICS_RETENTION_DAYS:'400'},{REPORT_DIR:'public/private'},{MODERATION_FILE:'dist/hidden.json'},{LAB_DATA_FILE:'dist-qa/lab.json'}]){
  assert.throws(()=>roomConfig({...env,...extra}));
 }
 assert.deepEqual(roomConfig({ALLOWED_ORIGINS:' http://localhost:5173, http://127.0.0.1:5173 '}).origins,['http://localhost:5173','http://127.0.0.1:5173']);
});

test('moderation commits atomically, hashes guest tokens, expires bans and retains removals across a restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campos-moderation-')),file=join(dir,'state.json'),token='a'.repeat(48),account='11111111-1111-4111-8111-111111111111';let now=1000;
 try{
  const store=createModeration({file,now:()=>now});await store.load();
  await store.ban({token,account,hours:1,reason:'Harassment'});
  assert.equal(store.banned({token}),true);assert.equal(store.banned({account}),true);
  assert.equal((await readFile(file,'utf8')).includes(token),false);
  const restarted=createModeration({file,now:()=>now});await restarted.load();assert.equal(restarted.banned({account}),true);
  await restarted.unban(`account:${account}`);assert.equal(restarted.banned({account}),false);
  assert.equal(restarted.banned({token}),true);now+=3600001;assert.equal(restarted.banned({token}),false);
  await writeFile(file,'{ broken');await assert.rejects(createModeration({file}).load(),/invalid/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('moderator account ban survives new guest tokens and room restart; unban restores access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campos-ban-')),file=join(dir,'moderation.json'),account='22222222-2222-4222-8222-222222222222';
 // Authentication is stubbed at its verified boundary here; the full account suite uses PostgreSQL.
 const accounts={enabled:true,verify:async access=>access==='valid'?{id:account,email:'test@example.test'}:{error:'expired'},
  snapshot:async()=>({handle:'explorer',display_name:'Explorer',social:{}})};
 let room,port,a,b;
 const start=async()=>{room=createRoom({port:0,origins:[origin],adminToken,moderationFile:file,accounts});port=(await room.start()).port;};
 try{
  await start();a=await connect(port);await a.join();const auth=message(a.ws,m=>m.type==='auth'&&m.ok);
  a.ws.send(JSON.stringify({type:'auth',token:'valid'}));await auth;
  assert.equal((await request(port,'/admin/status',undefined,'wrong')).status,403);
  assert.equal((await request(port,'/admin/ban',{id:null})).status,404);
  assert.equal((await request(port,'/admin/ban',{id:[...room.clients.keys()][0],hours:'forever'})).status,400);
  const removed=closed(a.ws);assert.equal((await request(port,'/admin/ban',{id:[...room.clients.keys()][0],reason:'Test enforcement'})).status,200);
  assert.equal(await removed,4003);await room.close();await start();
  b=await connect(port);await b.join();const rejected=closed(b.ws);b.ws.send(JSON.stringify({type:'auth',token:'valid'}));assert.equal(await rejected,4003);
  const list=await (await request(port,'/admin/bans')).json();assert.ok(list.bans.some(b=>b.key===`account:${account}`));
  assert.equal((await request(port,'/admin/unban',{key:`account:${account}`})).status,200);
  b=await connect(port);await b.join();const allowed=message(b.ws,m=>m.type==='auth'&&m.ok);b.ws.send(JSON.stringify({type:'auth',token:'valid'}));await allowed;
 }finally{a?.ws.terminate();b?.ws.terminate();await room?.close();await rm(dir,{recursive:true,force:true});}
});

test('shutdown is idempotent, flushes received reports and analytics, revokes players, and releases the port',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campos-shutdown-'));let flushed=false;
 const room=createRoom({port:0,origins:[origin],reportDir:dir,analytics:{track(){},async flush(){flushed=true;}}});
 const {port}=await room.start();let a,b;
 try{
  a=await connect(port);await a.join();b=await connect(port);const target=await b.join();
  const received=new Promise(resolve=>[...room.clients.values()][0].ws.once('message',resolve));
  a.ws.send(JSON.stringify({type:'report',id:target.id,reason:'Queued at shutdown'}));await received;
  const ended=closed(a.ws),one=room.close();assert.equal(room.close(),one);await one;
  assert.equal(await ended,1001);assert.equal(flushed,true);assert.equal(room.clients.size,0);
  assert.match(await readFile(join(dir,'reports.jsonl'),'utf8'),/Queued at shutdown/);
  const replacement=createRoom({port,origins:[origin]});await replacement.start();await replacement.close();
 }finally{a?.ws.terminate();b?.ws.terminate();await room.close();await rm(dir,{recursive:true,force:true});}
});

test('corrupt moderation state prevents startup and a port collision rejects instead of hanging',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campos-invalid-')),file=join(dir,'moderation.json');
 try{
  await writeFile(file,'corrupt');const invalid=createRoom({port:0,moderationFile:file});await assert.rejects(invalid.start(),/invalid/);
  const first=createRoom({port:0});const {port}=await first.start();
  try{const other=createRoom({port});await assert.rejects(other.start(),/EADDRINUSE/);}finally{await first.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a failed moderation commit returns a retryable error and does not falsely remove the player',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campos-ban-failure-')),file=join(dir,'moderation.json');
 const room=createRoom({port:0,origins:[origin],adminToken,moderationFile:file});const {port}=await room.start();let a;
 try{
  a=await connect(port);const welcome=await a.join();await rm(file);await mkdir(file);
  assert.equal((await request(port,'/admin/ban',{id:welcome.id})).status,503);
  assert.equal(room.moderation.list().length,0);assert.equal(room.clients.size,1);
  const state=await message(a.ws,m=>m.type==='state');assert.equal(state.players[0].id,welcome.id);
 }finally{a?.ws.terminate();await room.close();await rm(dir,{recursive:true,force:true});}
});

test('shutdown waits for an already accepted account request and stale verification cannot rebind a departed client',async()=>{
 let release,verified;const reached=new Promise(resolve=>{verified=resolve;});
 const room=createRoom({port:0,origins:[origin],accounts:{enabled:true,verify:()=>{verified();return new Promise(resolve=>{release=resolve;});},snapshot:()=>{throw Error('Departed client must not load a profile');}}});
 const {port}=await room.start();let a;
 try{
  a=await connect(port);await a.join();a.ws.send(JSON.stringify({type:'auth',token:'held'}));await reached;
  let completed=false;const draining=room.close().then(()=>{completed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false);
  release({id:'33333333-3333-4333-8333-333333333333'});await draining;assert.equal(room.clients.size,0);
 }finally{release?.({error:'expired'});a?.ws.terminate();await room.close();}
});

test('brief output congestion preserves auth acknowledgements; an excessive queue triggers a reconnect',async()=>{
 const room=createRoom({port:0,origins:[origin],adminToken});const {port}=await room.start();let a;
 try{
  a=await connect(port);const welcome=await a.join(),server=room.clients.get(welcome.id).ws;let buffered=70000;
  Object.defineProperty(server,'bufferedAmount',{get:()=>buffered});
  const ack=message(a.ws,m=>m.type==='auth');a.ws.send(JSON.stringify({type:'auth',token:null}));assert.equal((await ack).ok,true);
  const ended=closed(a.ws);buffered=300000;assert.equal(await ended,1013);
  assert.equal((await(await request(port,'/admin/status')).json()).slowConnections,1);
 }finally{a?.ws.terminate();await room.close();}
});
