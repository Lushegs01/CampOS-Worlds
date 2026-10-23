// Exercise the actual production image as a non-root, read-only container with a data volume.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';

const run=promisify(execFile),name='campos-release-'+randomBytes(5).toString('hex'),volume=name+'-data',origin='https://campus.example';
const env={...process.env,ADMIN_TOKEN:randomBytes(32).toString('hex')};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=async(...args)=>(await run('docker',['--host=unix:///var/run/docker.sock',...args],{env,timeout:120000,maxBuffer:1024*1024})).stdout.trim();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[],sockets=[];let base,token;
const request=(path,body,auth=env.ADMIN_TOKEN)=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
async function ready(){
 const mapping=await docker('port',name,'3001/tcp');base='http://127.0.0.1:'+mapping.split(':').at(-1);
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){try{if((await request('/ready')).ok)return;}catch{}await wait(250);}
 throw Error('Container readiness did not pass');
}
async function connect(session){
 const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{origin});sockets.push(ws);
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 const outcome=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Join timeout')),5000);
  ws.once('message',raw=>{const m=JSON.parse(raw);clearTimeout(timer);resolve(m);});
  ws.once('close',code=>{clearTimeout(timer);resolve({closed:code});});
 });
 ws.send(JSON.stringify({type:'join',name:'Container check',token:session}));return {ws,result:await outcome};
}
let passed=false;
try{
 await docker('volume','create',volume);
 await docker('run','--detach','--name',name,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
  '--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--mount',`type=volume,src=${volume},dst=/app/server/data`,
  '--publish','127.0.0.1::3001','--env','ADMIN_TOKEN','--env','ALLOWED_ORIGINS='+origin,process.argv[2]||'campos-worlds-room:release');
 await ready();
 assert.equal(await docker('exec',name,'id','-u'),'1000');
 assert.equal((await request('/admin/status',undefined,'invalid')).status,403);
 checks.push('production config, readiness, non-root read-only image, protected admin');
 const a=await connect(),b=await connect();assert.equal(a.result.type,'welcome');assert.equal(b.result.type,'welcome');token=a.result.token;
 assert.equal((await(await request('/health')).json()).players,2);
 const ended=new Promise(resolve=>a.ws.once('close',resolve));
 assert.equal((await request('/admin/ban',{id:a.result.id,reason:'Container restart regression'})).status,200);assert.equal(await ended,4003);
 checks.push('real two-player join and moderator removal');
 await docker('stop','--time','20',name);assert.equal(await docker('inspect','--format','{{.State.ExitCode}}',name),'0');
 await docker('start',name);await ready();
 const rejected=await connect(token);assert.equal(rejected.result.closed,4003);
 const bans=await(await request('/admin/bans')).json();assert.equal(bans.bans.length,1);assert.equal(JSON.stringify(bans).includes(token),false);
 const fresh=await connect();assert.equal(fresh.result.type,'welcome');
 checks.push('SIGTERM exits cleanly; persisted ban is enforced after container restart; fresh guests can join');
 // A host must use the image HEALTHCHECK result, rather than process existence alone.
 const deadline=Date.now()+45000;let health;
 do{health=await docker('inspect','--format','{{.State.Health.Status}}',name);if(health==='healthy')break;await wait(1000);}while(Date.now()<deadline);
 assert.equal(health,'healthy');checks.push('Docker HEALTHCHECK becomes healthy');passed=true;
 console.log(JSON.stringify({passed,checks},null,2));
}catch(error){
 console.error('CONTAINER LOGS',await docker('logs',name).catch(()=>'(unavailable)'));
 console.error('CONTAINER STATE',await docker('inspect','--format','{{json .State}}',name).catch(()=>'(unavailable)'));
 console.error('PORT MAPPING',await docker('port',name,'3001/tcp').catch(()=>'(unavailable)'));
 throw error;
}finally{
 sockets.forEach(ws=>ws.terminate());
 await docker('rm','--force',name).catch(()=>{});await docker('volume','rm',volume).catch(()=>{});
 await mkdir('docs/release',{recursive:true});await writeFile('docs/release/container.json',JSON.stringify({date:new Date().toISOString(),passed,checks},null,2)+'\n');
}
