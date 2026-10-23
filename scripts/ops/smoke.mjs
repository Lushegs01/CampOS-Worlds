// Public release check: use the actual deployed HTTPS frontend and WSS room.
// Creates two temporary guest connections; no account, report or payment is created.
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const [site,roomURL]=process.argv.slice(2);
if(!site){console.error('Usage: node scripts/ops/smoke.mjs https://<frontend> [wss://<room>/ws]');process.exit(1);}
const origin=new URL(site).origin,wsURL=roomURL||origin.replace(/^http/,'ws')+'/ws';
assert.equal(new URL(origin).protocol,'https:','Public release checks require HTTPS');
assert.equal(new URL(wsURL).protocol,'wss:','Public release checks require WSS');
async function get(path){const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000),redirect:'error'});assert.equal(response.status,200,path);return response;}
function next(ws,type,predicate=()=>true){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{ws.off('message',handler);reject(Error(`Timed out waiting for ${type}`));},10000);
 const handler=raw=>{const m=JSON.parse(raw);if(m.type===type&&predicate(m)){clearTimeout(timer);ws.off('message',handler);resolve(m);}};ws.on('message',handler);
});}
const sockets=[];
async function connect(token){
 const ws=new WebSocket(wsURL,{origin,handshakeTimeout:10000});sockets.push(ws);ws.on('error',()=>{});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 const welcome=next(ws,'welcome');ws.send(JSON.stringify({type:'join',name:'Release check',token,invite:process.env.ROOM_INVITE||''}));return {ws,welcome:await welcome};
}
try{
 const response=await get('/'),html=await response.text();
 assert.match(response.headers.get('content-type')||'',/text\/html/);
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.ok(response.headers.get('content-security-policy'),'CSP is applied at the live origin');
 assert.ok(html.includes('rel="canonical"')&&html.includes(origin),'Canonical metadata references this origin');
 assert.match(html,/og:image/);
 const manifest=await(await get('/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons)assert.match((await get(icon.src)).headers.get('content-type')||'',/image\//);
 const worker=await get('/sw.js');assert.match(worker.headers.get('content-type')||'',/javascript/);
 assert.match(worker.headers.get('cache-control')||'',/no-cache|no-store|max-age=0/);
 await get('/offline.html');await get('/brand/campos-worlds-social.png');
 const a=await connect(),b=await connect(),text='Release check '+Date.now(),chat=next(b.ws,'chat',m=>m.text===text);
 a.ws.send(JSON.stringify({type:'chat',text}));assert.equal((await chat).text,text);
 a.ws.terminate();const resumed=await connect(a.welcome.token);assert.equal(resumed.welcome.token,a.welcome.token);
 console.log(JSON.stringify({passed:true,date:new Date().toISOString(),origin,room:new URL(wsURL).origin,checks:['HTTPS/headers','canonical and sharing metadata','manifest/icons','worker cache policy','offline document','two-player room/chat','session reconnect'],
  limits:'Does not verify account/provider configuration, payments, physical installation, regional latency or capacity.'},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}finally{sockets.forEach(ws=>ws.terminate());}
