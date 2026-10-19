import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newRun,seedOrders,createOrder,assign,pickup,deliver,submit,agentStep,metrics,assertInvariants,comparePolicies,digest} from '../server/economy/model.mjs';
import {createEconomyService,principalOf,exportEvidence,reportFor} from '../server/economy/service.mjs';
import {localOnlyAdapter} from '../server/economy/adapter.mjs';
import {LAB_STATIONS} from '../shared/economic-lab.mjs';
const worker={id:'human',kind:'human',principal:'owner'};
function fixture(){const r=newRun('owner','demand-aware',42,0,'experiment');createOrder(r,{destination:'welcome',quantity:2},0);return {r,t:r.tasks[0]};}
test('closed economy reserves stock and settles only verified accepted work once',()=>{
 const {r,t}=fixture();assert.equal(r.stock,12);assert.equal(r.reserved,2);assert.equal(assign(r,t,worker,'owner').ok,true);pickup(r,t);deliver(r,t);
 assert.equal(submit(r,t,{note:'observed'}).ok,true);assert.equal(t.status,'accepted');assert.equal(r.stock,10);assert.equal(r.reserved,0);assert.equal(r.transactions.length,1);assert.equal(r.contributions[0].recognitionUnits,10);
 assert.equal(submit(r,t,{success:true}).ok,false);assert.equal(r.transactions.length,1);assertInvariants(r);
 const e=t.attempts[0],{digest:hash,...body}=e;assert.equal(hash,digest(body));assert.equal(e.externalValidation,null);
});
test('fabricated success fails with reasons, can be revised, and failures earn no recognition',()=>{
 const {r,t}=fixture();assign(r,t,worker,'owner');let a=submit(r,t,{success:true});assert.equal(a.ok,false);assert.equal(t.status,'revision');assert.ok(t.attempts[0].reasons.includes('origin_and_quantity'));assert.equal(r.transactions.length,0);assert.equal(r.contributions.length,0);
 pickup(r,t);deliver(r,t);assert.equal(submit(r,t,{}).ok,true);assert.equal(t.attempts.length,2);assert.equal(metrics(r).acceptanceRate,.5);assert.equal(metrics(r).revisionRate,.5);assertInvariants(r);
});
test('exhausted attempts and missed deadlines reject work and release its reservation',()=>{
 const {r,t}=fixture();assign(r,t,worker,'owner');for(let i=0;i<3;i++)submit(r,t,{});assert.equal(t.status,'rejected');assert.equal(r.reserved,0);assert.equal(r.stock,12);assert.equal(r.contributions.length,0);
 const b=fixture();assign(b.r,b.t,worker,'owner');pickup(b.r,b.t);deliver(b.r,b.t);b.r.virtualSeconds=601;assert.equal(submit(b.r,b.t,{}).ok,false);assert.equal(b.t.status,'rejected');assertInvariants(b.r);
});
test('invalid resources and shortages cannot create stock or negative inventory',()=>{
 const {r}=fixture();assert.equal(createOrder(r,{destination:'welcome',quantity:-1}).ok,false);assert.equal(createOrder(r,{destination:'elsewhere',quantity:1}).ok,false);
 for(let i=0;i<7;i++)createOrder(r,{destination:'welcome',quantity:3});assert.ok(r.reserved<=r.stock);assert.ok(metrics(r).stockouts>0);assert.equal(r.balances.business,500);assertInvariants(r);
});
test('deterministic agent uses same verifier and bounded actions with task-specific authorization',()=>{
 const r=newRun('owner','demand-aware',42,0,'experiment');seedOrders(r);const wanted=r.tasks[2].id;assert.equal(agentStep(r,'owner',wanted).ok,true);assert.equal(r.tasks[2].status,'accepted');assert.equal(r.agentTrace[0].actions,4);assert.equal(r.tasks[2].attempts[0].verifiedBy,'system:delivery-verifier/1');assert.equal(agentStep(r,'intruder').ok,false);assertInvariants(r);
});
test('baseline and alternative use equivalent starts; metrics are reproducible and calculated',()=>{
 const a=comparePolicies('owner',99,0),b=comparePolicies('owner',99,0);
 assert.deepEqual(a.results.map(r=>r.metrics),b.results.map(r=>r.metrics));assert.deepEqual(a.runs[0].initial,a.runs[1].initial);
 assert.deepEqual(a.runs[0].orders.map(o=>[o.quantity,o.destination]),a.runs[1].orders.map(o=>[o.quantity,o.destination]));
 assert.ok(a.results[0].metrics.expenses>a.results[1].metrics.expenses);assert.ok(a.results[0].metrics.meanDeliverySeconds>a.results[1].metrics.meanDeliverySeconds);
 for(const r of a.runs){assertInvariants(r);assert.equal(metrics(r).completed,r.transactions.length);assert.equal(metrics(r).completionRate,r.transactions.length/r.orders.length);}
 const blank=newRun('owner','fixed',1,0,'experiment');assert.equal(metrics(blank).completionRate,null);assert.equal(metrics(blank).costPerCompleted,null);
});
test('live agent verification uses the active logical clock without adding checkpoint time twice',()=>{
 const now=Date.now(),r=newRun('owner','demand-aware',42,now,'live');seedOrders(r);
 r.virtualSeconds=30;r.clockSeconds=30;r.resumedAt=now;
 assert.equal(agentStep(r,'owner').ok,true);const e=r.tasks.find(t=>t.status==='accepted').attempts[0];
 assert.ok(Math.abs(e.measurements.activeSeconds-r.virtualSeconds)<.1);assert.ok(e.submittedAt<=Date.now());assertInvariants(r);
});
const actor=(token='a'.repeat(48))=>({joined:true,token,x:-61,z:19.8,y:0,account:null});
const at=(c,id)=>Object.assign(c,LAB_STATIONS.find(s=>s.id===id).point);
let key=0;
const req=(service,c,station,action,run=null,extra={})=>{at(c,station);return service.request(c,{station,action,run,key:`request-${++key}`, ...extra});};
test('service authorizes station, principal, current run, pickup position and request types',async()=>{
 const s=createEconomyService(),c=actor();let a=await req(s,c,'control','start',null,{policy:'fixed',seed:42});assert.ok(a.ok);let r=a.view.current;
 const far={...c,x:0,z:36};assert.equal((await s.request(far,{station:'control',action:'pause',run:r.id,key:'far-pause-1'})).ok,false);
 assert.equal((await req(s,c,'market','pause',r.id)).ok,false);assert.equal((await req(s,c,'market','order','stale',{destination:'welcome',quantity:1})).ok,false);
 assert.equal((await req(s,actor('b'.repeat(48)),'control','pause',r.id)).ok,false);
 a=await req(s,c,'market','order',r.id,{destination:'welcome',quantity:1});r=a.view.current;
 a=await req(s,c,'tasks','claim',r.id,{task:r.tasks[0].id});assert.ok(a.ok);
 a=await s.request(c,{station:'tasks',action:'collect',run:r.id,task:r.tasks[0].id,key:'collect-far-1'});assert.equal(a.ok,false);
 Object.assign(c,{x:-57,z:31.5});a=await s.request(c,{station:'tasks',action:'collect',run:r.id,task:r.tasks[0].id,key:'collect-near-1'});assert.ok(a.ok);
 Object.assign(c,{x:-12,z:25});a=await s.request(c,{station:'tasks',action:'deliver',run:r.id,task:r.tasks[0].id,key:'delivery-near-1'});assert.ok(a.ok);
 a=await req(s,c,'tasks','submit',r.id,{task:r.tasks[0].id,note:'Delivered by walking'});assert.ok(a.ok);assert.equal(a.view.current.contributions.length,1);
 assert.equal((await s.request(c,{station:{},action:[]})).ok,false);
});
test('concurrent requests serialize and durable replay keys prevent duplicate orders and key substitution',async()=>{
 const s=createEconomyService(),c=actor();let a=await req(s,c,'control','start',null,{policy:'fixed',seed:1});const run=a.view.current.id;at(c,'market');
 const payload={station:'market',action:'order',run,key:'repeat-order-1',destination:'welcome',quantity:3};
 const [one,two]=await Promise.all([s.request(c,payload),s.request(c,payload)]);assert.ok(one.ok);assert.ok(two.replayed);assert.equal(two.view.current.orders.length,1);
 assert.equal((await s.request(c,{...payload,quantity:2})).ok,false);
 const many=await Promise.all(Array.from({length:6},(_,i)=>s.request(c,{...payload,key:`concurrent-${i}`})));assert.ok(many.filter(a=>a.ok).length<=3);assert.equal(many.at(-1).view.current.reserved,12);
});
test('pause and explicit reset preserve archive; experiments do not replace the active live run',async()=>{
 const s=createEconomyService(),c=actor();let a=await req(s,c,'control','start',null,{policy:'fixed',seed:1,seedOrders:true});const run=a.view.current.id;
 a=await req(s,c,'control','pause',run);assert.equal(a.view.current.status,'paused');assert.equal((await req(s,c,'agents','agent',run)).ok,false);
 assert.equal((await req(s,c,'control','reset',run,{policy:'fixed',seed:2})).ok,false);
 a=await req(s,c,'control','reset',run,{policy:'demand-aware',seed:2,confirm:run});assert.ok(a.ok);assert.notEqual(a.view.current.id,run);assert.equal(a.view.history.find(r=>r.id===run).status,'reset');
 const current=a.view.current.id;a=await req(s,c,'research','compare',current,{seed:9});assert.ok(a.ok);assert.equal(a.view.current.id,current);assert.equal(a.view.comparisons.length,1);
});
test('atomic file persistence, startup pause, replay after restart and corruption isolation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campos-lab-')),file=join(dir,'lab.json'),c=actor();try{
  const s=createEconomyService({file});let a=await req(s,c,'control','start',null,{policy:'fixed',seed:1});const run=a.view.current.id;at(c,'market');const payload={station:'market',action:'order',run,key:'persisted-order-1',destination:'welcome',quantity:1};await s.request(c,payload);await s.close();
  const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.digest,digest(saved.state));assert.ok(!JSON.stringify(saved).includes(c.token));
  const restored=createEconomyService({file});a=await restored.request(c,payload);assert.ok(a.replayed);assert.equal(a.view.current.orders.length,1);assert.equal(a.view.current.status,'paused');
  await writeFile(file,'corrupt');const broken=createEconomyService({file});a=await req(broken,c,'control','inspect');assert.equal(a.ok,false);assert.match(a.reason,/storage could not be verified/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('write failure rolls back all effects and allows retry with the same operation key',async()=>{
 let broken=true;const s=createEconomyService({persist:async()=>{if(broken)throw Error('disk full');}}),c=actor();at(c,'control');const payload={station:'control',action:'start',run:null,key:'retry-after-disk-1',policy:'fixed',seed:1};
 assert.equal((await s.request(c,payload)).ok,false);assert.equal((await req(s,c,'control','inspect')).view.current,null);broken=false;assert.ok((await s.request(c,payload)).ok);
});
test('identity changes while queued cannot apply an old request to the new principal',async()=>{
 let release,entered;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const s=createEconomyService({persist:async()=>{entered();await gate;}}),first=actor(),second=actor('b'.repeat(48));at(first,'control');at(second,'control');
 const a=s.request(first,{station:'control',action:'start',run:null,key:'identity-first-1',policy:'fixed',seed:1});await ready;
 const b=s.request(second,{station:'control',action:'start',run:null,key:'identity-queued-1',policy:'fixed',seed:1});second.account={id:'new-account'};release();assert.ok((await a).ok);const rejected=await b;assert.equal(rejected.ok,false);assert.match(rejected.reason,/identity changed/);
 assert.equal((await req(s,second,'control','inspect')).view.current,null);
});
test('export preserves evidence, failed attempts, metrics, contribution allocation and honest external boundary',async()=>{
 const s=createEconomyService(),c=actor();let a=await req(s,c,'research','compare',null,{seed:42});assert.ok(a.ok);a=await req(s,c,'research','export');assert.ok(a.ok);
 const bundle=JSON.parse(JSON.stringify(a.bundle));assert.equal(bundle.schema,'campos.economic-lab/1');assert.equal(bundle.runs.length,2);assert.ok(bundle.runs[0].contributions.length);assert.match(a.report,/Recognition|recognition/);assert.ok(bundle.limitations.length);
 const receipt=await localOnlyAdapter.evaluate(bundle);assert.equal(receipt.status,'not-connected');assert.equal(receipt.externalRecord,null);await assert.rejects(()=>localOnlyAdapter.evaluate({schema:'fake'}));
 assert.equal(principalOf(c).length,64);assert.equal(exportEvidence({owner:'x',runs:[],comparisons:[]}).runIds.length,0);assert.match(reportFor(bundle),/delivery\/1/);
});
