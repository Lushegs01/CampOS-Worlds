// Local, real-WebSocket capacity exercise. Not a WAN, renderer or database benchmark.
import assert from 'node:assert/strict';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { cpus, totalmem, platform, arch } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MOTION_VERSION } from '../../shared/prediction.mjs';
import { WebSocket } from 'ws';

const seconds=Number(process.env.CAPACITY_SECONDS||60),population=48;
assert.ok(Number.isInteger(seconds)&&seconds>=20&&seconds<=3600,'CAPACITY_SECONDS must be 20–3600');
const origin='https://capacity.example',server=fork(fileURLToPath(new URL('../../tests/support/capacity-room.mjs',import.meta.url)),[],{stdio:['ignore','inherit','inherit','ipc']});
const {port}=await new Promise((resolve,reject)=>{server.once('message',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('Room process exited during startup')));});
const url=`ws://127.0.0.1:${port}/ws`,peers=[],unexpected=[],rtts=[],gaps=[];
const status=async()=>await(await fetch(`http://127.0.0.1:${port}/admin/status`,{headers:{Authorization:'Bearer capacity-local-only'},signal:AbortSignal.timeout(5000)})).json();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values,p)=>values.length?Math.round([...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]*100)/100:0;
let stopping=false,inputs,probes,traffic,phase=0,states=0,decodedBytes=0;
async function peer(index,token){
 const ws=new WebSocket(url,{origin,perMessageDeflate:true});
 const c={ws,index,token,epoch:1,seq:0,states:0,lastState:0,fullStates:0};
 ws.on('close',code=>{if(!stopping&&!c.expectedClose)unexpected.push({index,code});});
 ws.on('error',error=>unexpected.push({index,error:error.message}));
 ws.on('pong',raw=>{const sent=Number(raw.toString());if(Number.isFinite(sent))rtts.push(performance.now()-sent);});
 const welcome=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Welcome timeout')),5000);
  ws.on('message',raw=>{
   decodedBytes+=raw.length;
   const m=JSON.parse(raw);
   if(m.type==='welcome'){clearTimeout(timer);c.token=m.token;c.epoch=m.motion.epoch;resolve();}
   if(m.motion&&m.motion.epoch!==c.epoch){c.epoch=m.motion.epoch;c.seq=m.motion.seq;}
   if(m.type==='state'){
    const now=performance.now();if(c.lastState&&phase===1)gaps.push(now-c.lastState);c.lastState=now;c.states++;states++;
    if(m.players.length===population)c.fullStates++;
   }
  });
 });
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.send(JSON.stringify({type:'join',movement:MOTION_VERSION,name:`Capacity ${index}`,token}));await welcome;
 return c;
}
const loop=monitorEventLoopDelay({resolution:10});
let result;
try{
 for(let index=0;index<population;index++)peers.push(await peer(index));
 await wait(500);
 const before=await status();console.log('population ready',JSON.stringify({connected:before.connections,unexpected,joined:peers.length}));
 assert.equal(before.connections,population,'all 48 clients must remain connected before measuring');
 const refused=new WebSocket(url,{origin});
 const overflowStatus=await new Promise(resolve=>{refused.once('unexpected-response',(_req,res)=>{res.resume();refused.terminate();resolve(res.statusCode);});refused.on('error',()=>{});refused.once('open',()=>{refused.terminate();resolve(101);});});
 assert.equal(overflowStatus,503,'the 49th socket must be refused before allocating a player');
 const memoryBefore=before.memory,cpuBefore=process.cpuUsage(),started=performance.now();loop.enable();phase=1;
 inputs=setInterval(()=>{
  const elapsed=(performance.now()-started)/1000;
  for(const c of peers)if(c.ws.readyState===WebSocket.OPEN){
   const angle=elapsed*.35+c.index*.13;
   c.ws.send(JSON.stringify({type:'move',epoch:c.epoch,commands:[[ ++c.seq,.04,Math.sin(angle),Math.cos(angle),0,0,angle ]]}));
  }
 },40);
 probes=setInterval(()=>{for(const c of peers)if(c.ws.readyState===WebSocket.OPEN)c.ws.ping(String(performance.now()));},1000);
 traffic=setInterval(()=>{for(const c of peers)if(c.ws.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify({type:'chat',text:`Capacity ${c.index} ${Date.now()}`}));},5000);
 const deadline=Date.now()+seconds*1000;
 while(Date.now()<deadline){await wait(Math.max(1,Math.min(10000,deadline-Date.now())));const current=await status();console.log(`capacity ${Math.round((performance.now()-started)/1000)}s: ${current.connections} sockets, ${states} states`);assert.equal(current.connections,population,'all clients must remain connected');}
 phase=2;clearInterval(inputs);clearInterval(probes);clearInterval(traffic);loop.disable();
 const elapsed=performance.now()-started,cpu=process.cpuUsage(cpuBefore),after=await status(),memoryAfter=after.memory,perClientStates=peers.map(c=>c.states);
 // Six abrupt network losses and resumes with their existing session tokens.
 for(const c of peers.slice(0,6)){c.expectedClose=true;c.ws.terminate();}
 const gone=Date.now()+5000;while((await status()).connections!==42&&Date.now()<gone)await wait(20);assert.equal((await status()).connections,42);
 for(let index=0;index<6;index++)peers[index]=await peer(index,peers[index].token);
 await wait(300);
 const health=await(await fetch(`http://127.0.0.1:${port}/health`)).json();assert.equal(health.players,population);
 const statusBody=await status();
 result={date:new Date().toISOString(),passed:false,scope:'48 sequenced moving clients, compressed state, public chat, WebSocket ping RTT, six reconnects; isolated local room and client-generator processes; no renderer, accounts or WAN',
  environment:{node:process.version,os:`${platform()} ${arch()}`,cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},
  durationSeconds:Math.round(elapsed/100)/10,players:population,overflowStatus,reconnects:6,unexpectedDisconnects:unexpected,
  states,perClientStates,decodedBytes,inputHzPerClient:25,compression:peers[0].ws.extensions,
  roundTripMs:{p50:percentile(rtts,.5),p95:percentile(rtts,.95),p99:percentile(rtts,.99),max:percentile(rtts,1)},
  stateGapMs:{p50:percentile(gaps,.5),p95:percentile(gaps,.95),p99:percentile(gaps,.99),max:percentile(gaps,1)},
  clientEventLoopMs:{p95:Math.round(loop.percentile(95)/1e4)/100,max:Math.round(loop.max/1e4)/100},
  clientCpuPercentOfOneCore:Math.round((cpu.user+cpu.system)/elapsed/10),
  serverCpuPercentOfOneCore:Math.round((after.cpu.user+after.cpu.system-before.cpu.user-before.cpu.system)/elapsed/10),memoryBefore,memoryAfter,room:statusBody};
 assert.deepEqual(unexpected,[]);assert.ok(rtts.length>=population*10,'every peer receives ongoing ping replies');
 assert.ok(states>population*seconds*8,'state delivery must remain above 8Hz per client on average');
 assert.ok(Math.min(...perClientStates)>seconds*8,'every client must receive at least 8Hz of state');
 assert.ok(result.roundTripMs.p95<250,'local p95 round-trip must remain below 250ms');
 assert.ok(result.stateGapMs.p95<250,'p95 state delivery gap must remain below 250ms');
 assert.ok(result.stateGapMs.max<1500,'no state-delivery stall may exceed 1.5 seconds');
 assert.equal(statusBody.slowConnections,0);
 assert.ok(memoryAfter.rss-memoryBefore.rss<256*1024*1024,'room RSS growth must remain below 256MiB');
 result.passed=true;
 console.log(JSON.stringify(result,null,2));
}catch(error){result??={date:new Date().toISOString(),passed:false,error:error.message,unexpectedDisconnects:unexpected,states};throw error;
}finally{
 stopping=true;clearInterval(inputs);clearInterval(probes);clearInterval(traffic);loop.disable();peers.forEach(c=>c.ws.terminate());
 await new Promise(resolve=>{if(server.exitCode!==null)return resolve();const timer=setTimeout(()=>server.kill('SIGKILL'),10000);server.once('exit',()=>{clearTimeout(timer);resolve();});server.send('stop');});
 await mkdir('docs/release',{recursive:true});await writeFile('docs/release/capacity.json',JSON.stringify(result??{passed:false,error:'Capacity exercise did not complete'},null,2)+'\n');
}
