import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,constants as FS,readFileSync} from 'node:fs';
import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {LAB_STATIONS,LAB_AGENT,POLICIES,SCENARIO,siteById,insideLab} from '../../shared/economic-lab.mjs';
import {moveWithCollisions} from '../../shared/campus.mjs';
import {newRun,createOrder,seedOrders,assign,pickup,deliver,submit,agentStep,finishRun,metrics,elapsed,assertInvariants,comparePolicies,digest} from './model.mjs';
import {localOnlyAdapter} from './adapter.mjs';
import {SANDBOX_LIMITS,DOMAINS,validatePlan} from '../../shared/economic-sandbox.mjs';
import {preview,buildRecord,validateRecord,modelFor} from './sandbox/engine.mjs';
import {runIsolated} from './sandbox/runner.mjs';
import {createExperimentStore} from './sandbox/store.mjs';
import {exportBundle,experimentReport} from './sandbox/report.mjs';

const fail=reason=>({ok:false,reason});
const LIMITS={principals:500,runs:100,comparisons:20,replays:256};
const STATION_ACTIONS={control:['start','pause','resume','finish','reset','preview'],market:['order','preview'],tasks:['claim','submit','release'],agents:['agent'],verification:[],research:['compare','export','evaluate','experiment','repeat','export-experiment']};
// Read-only requests need no operation key and never write. `open` reads a saved experiment at any station.
const READ_ONLY=['inspect','open','preview','export-experiment'];
const SCHEMA=2;
export const principalOf=c=>createHash('sha256').update(c.account?.id?`account:${c.account.id}`:`guest:${c.token}`).digest('hex');
const reachable=(p,target,range)=>{
 if(p.dorm||p.vehicle||p.seat||p.y>.05||!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.hypot(p.x-target.x,p.z-target.z)>range)return false;
 const q=moveWithCollisions(p.x,p.z,target.x-p.x,target.z-p.z);
 return Math.hypot(q.x-target.x,q.z-target.z)<.15;
};
const active=w=>w.runs.find(r=>r.id===w.active)??null;
const summary=r=>({id:r.id,policy:r.policy,seed:r.seed,mode:r.mode,status:r.status,startedAt:r.startedAt,metrics:metrics(r)});
const bytesOf=list=>list.reduce((n,e)=>n+e.bytes,0);
function snapshot(w,storage,sandboxStorage) {
 const r=active(w);
 return {schema:'campos.lab-view/1',principal:w.owner,durability:storage,scenario:SCENARIO,policies:POLICIES,agent:{...LAB_AGENT,principal:w.owner},
  current:r?{...r,metrics:metrics(r),elapsed:elapsed(r)}:null,history:w.runs.map(summary),comparisons:w.comparisons.map(c=>({...c,runs:undefined})),external:w.external??null,
  sandbox:{experiments:w.experiments,durability:sandboxStorage,usage:{count:w.experiments.length,bytes:bytesOf(w.experiments)},limits:SANDBOX_LIMITS}};
}
/** The small index entry kept in the main lab file; the immutable record lives in the experiment store. */
const indexEntry=(record,bytes)=>({id:record.id,scenario:record.scenario.id,version:record.scenario.version,domain:record.scenario.domain,label:record.label,status:record.status,createdAt:record.createdAt,
 policies:record.policies.map(p=>({key:p.key,id:p.id,version:p.version,label:p.label})),baseSeed:record.plan.baseSeed,replications:record.plan.replications,conditions:record.results.conditions.length,sweep:record.plan.sweep,
 resultsDigest:record.resultsDigest,digest:record.digest,bytes,repeatOf:record.repeatOf,reproduced:record.reproduction?record.reproduction.identical:null});
const planInput=plan=>({scenario:plan.scenario,version:plan.version,params:plan.params,policies:plan.policies.map(({id,version,params})=>({id,version,params})),baseSeed:plan.baseSeed,replications:plan.replications,sweep:plan.sweep,weights:plan.weights,label:plan.label});
const limitations=['This is a local campus simulation, not an independently validated real-world result.','Simulation units have no naira conversion or redemption value. Recognition units are separate, local and unfunded.','The deterministic agent models logistics on the server; it is not a physically navigating character.','No official WorkStream acceptance, Flow Research points or external rewards.','One server writer; retain the configured data volume and backups. Guest records require the same session token.'];
export function exportEvidence(w) {
 const runs=structuredClone(w.runs);
 return {schema:'campos.economic-lab/1',exportedAt:new Date().toISOString(),principal:w.owner,runIds:runs.map(r=>r.id),scenario:SCENARIO,runs:runs.map(r=>({...r,metrics:metrics(r)})),comparisons:structuredClone(w.comparisons),governance:{verifier:'system:delivery-verifier/1',acceptance:'system:local-acceptance/1',contributionRule:SCENARIO.contributionRule,recognitionPerDelivery:10,externalAcceptance:null,independentValidation:null,fundedReward:null},limitations};
}
export function reportFor(bundle) {
 return ['# CampOS Worlds · Economic Simulation Lab',`Evidence format: ${bundle.schema}`,`Runs: ${bundle.runIds.join(', ')||'No runs yet'}`,'','## Model','Campus Logistics Economy / scenario 1; resource packs; 20 simulation units per pack; 12 starting packs; 600 active seconds per order. Orders reserve stock. Only verified and locally accepted work consumes stock and settles balanced customer/business/logistics transfers. Operating expense = 1 + ceil(authored route metres / 20). Ten recognition units per accepted delivery.','',...bundle.runs.flatMap(r=>[`## ${r.id}`,`Policy: ${r.policy}; seed: ${r.seed}; mode: ${r.mode}; state: ${r.status}`,`Initial: ${JSON.stringify(r.initial)}`,`Metrics: ${JSON.stringify(r.metrics)}`,...r.tasks.map(t=>`- ${t.id}: ${t.status}; worker ${t.worker?.id??'unassigned'}; evidence ${t.attempts.map(e=>`${e.id} (${e.verified?'verified':e.reasons.join(', ')}; SHA-256 ${e.digest})`).join('; ')||'none'}`),`Contribution allocation: ${JSON.stringify(r.contributions)}`,'']),...bundle.comparisons.flatMap(c=>['## Policy comparison',`Comparison ${c.id}; seed ${c.seed}; runs ${c.runIds.join(', ')}`,JSON.stringify(c.results),...c.assumptions,'']),'## Limitations',...bundle.limitations.map(l=>`- ${l}`)].join('\n');
}

/** Serialized copy-on-write transactions; publish only after atomic durable persistence succeeds. */
export function createEconomyService({file=null,adapter=localOnlyAdapter,persist=null,experiments=createExperimentStore(file?`${file}.experiments`:null),runner=runIsolated}={}) {
 let state={schema:SCHEMA,workspaces:{}},queue=Promise.resolve(),unavailable='';
 const storage=file?'server-file':'memory · resets when this room server restarts';
 if(file)try{const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.digest!==digest(saved.state)||![1,SCHEMA].includes(saved.state.schema))throw Error('invalid snapshot');
  for(const w of Object.values(saved.state.workspaces))for(const r of w.runs)assertInvariants(r);
  // Schema 1 (before the policy sandbox) is upgraded in memory. The original file is kept once as a backup
  // and is replaced only by the next successful atomic write.
  if(saved.state.schema===1){try{copyFileSync(file,`${file}.schema-1.bak`,FS.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}saved.state.schema=SCHEMA;}
  state=saved.state;
  for(const w of Object.values(state.workspaces)){w.experiments??=[];for(const r of w.runs)if(r.status==='running'){r.clockSeconds=Math.max(r.virtualSeconds,r.clockSeconds);r.status='paused';}}
  experiments.sweep(new Set(Object.values(state.workspaces).flatMap(w=>w.experiments.map(e=>e.id))));
 }catch(e){if(e.code!=='ENOENT')unavailable='Lab storage could not be verified. Ask the room operator to restore the data file; the campus remains available.';}
 const totalBytes=()=>Object.values(state.workspaces).reduce((n,w)=>n+bytesOf(w.experiments??[]),0);
 /** Reads a saved record and refuses it unless it matches the committed index digest and its own contents. */
 async function load(w,id) {
  const entry=typeof id==='string'?w.experiments.find(e=>e.id===id):null;
  if(!entry)return {error:'Unknown experiment in this workspace. Refresh and choose a saved experiment.'};
  let record;try{record=await experiments.read(entry.id);}catch{return {error:'This experiment record is missing. Ask the room operator to restore the lab data backup.'};}
  if(record?.digest!==entry.digest||validateRecord(record).some(p=>/digest/.test(p)))return {error:'This experiment record failed its integrity check. It was not shown; ask the room operator to restore it from backup.'};
  return {entry,record};
 }
 const save=async next=>{
  if(persist){await persist(next);return;}
  if(!file)return;
  await mkdir(dirname(file),{recursive:true});const tmp=`${file}.${randomUUID()}.tmp`;
  try{const handle=await open(tmp,'wx',0o600);try{await handle.writeFile(JSON.stringify({digest:digest(next),state:next}));await handle.sync();}finally{await handle.close();}await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}
 };
 async function execute(c,m) {
  if(unavailable)return fail(unavailable);
  if(!c.joined||typeof c.token!=='string'||!c.token)return fail('Join the campus room first.');
  if(typeof m.action!=='string'||typeof m.station!=='string')return fail('Invalid lab request.');
  const station=LAB_STATIONS.find(s=>s.id===m.station),physical=['collect','deliver'].includes(m.action);
  if(!physical&&(!station||!insideLab(c.x,c.z)||!reachable(c,station.point,station.range+.25)))return fail('Walk to the named workstation inside the lab.');
  if(!physical&&!['inspect','open'].includes(m.action)&&!STATION_ACTIONS[m.station]?.includes(m.action))return fail('This workstation does not grant that action.');
  const owner=principalOf(c),existing=state.workspaces[owner];
  if(!existing&&Object.keys(state.workspaces).length>=LIMITS.principals)return fail('The lab has reached its storage capacity. Contact the room operator.');
  const w=structuredClone(existing??{owner,active:null,runs:[],comparisons:[],replays:[],external:null,experiments:[]});
  const view=()=>snapshot(w,storage,experiments.kind);
  if(READ_ONLY.includes(m.action)) {
   if(m.action==='inspect')return {ok:true,view:view()};
   if(m.action==='preview') {
    const domain=DOMAINS.find(d=>d.id===m.domain);if(!domain)return fail('Choose an experimental domain.');
    const r=preview(domain.scenario,domain.version,m.params,m.seed);
    return r.ok?{ok:true,preview:r.preview}:{ok:false,reason:'Check the highlighted parameters.',errors:r.errors};
   }
   const loaded=await load(w,m.experiment);if(loaded.error)return fail(loaded.error);
   if(m.action==='open')return {ok:true,record:loaded.record,view:view()};
   try{return {ok:true,bundle:exportBundle(loaded.record),report:experimentReport(loaded.record)};}catch(e){return fail(e.message);}
  }
  if(typeof m.key!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(m.key))return fail('A valid operation key is required.');
  const requestHash=digest({...m,ref:undefined,key:undefined}),prior=w.replays.find(r=>r.key===m.key);
  if(prior)return prior.hash===requestHash?{...prior.result,replayed:true,view:view()}:fail('That operation key belongs to a different request.');
  let r=active(w),result,written=null;
  // Policy experiments never touch the live run, so only live-run operations check the run identity.
  const sandbox=['experiment','repeat'].includes(m.action);
  // A request from an old panel cannot mutate a newly reset scenario.
  if(!sandbox&&m.run!==(r?.id??null))return fail('The run changed. Refresh this workstation and retry.');
  const running=()=>r?.status==='running';
  if(['start','reset'].includes(m.action)) {
   if(!POLICIES.some(p=>p.id===m.policy)||!Number.isSafeInteger(m.seed)||m.seed<0||m.seed>0xffffffff)return fail('Choose a policy and a seed from 0 to 4294967295.');
   if(w.runs.length>=LIMITS.runs)return fail('This workspace has reached its 100-run archive budget. Export records and contact the operator.');
   if(m.action==='start'&&r&&!['completed','reset'].includes(r.status))return fail('Finish or explicitly reset the active run first.');
   if(m.action==='reset'&&(!r||m.confirm!==r.id))return fail('Reset requires explicit confirmation of the current run ID.');
   if(m.action==='reset')finishRun(r,'reset');
   r=newRun(owner,m.policy,m.seed);if(m.seedOrders===true)seedOrders(r);w.runs.push(r);w.active=r.id;result={ok:true};
  }else if(m.action==='compare') {
   if(!Number.isSafeInteger(m.seed)||m.seed<0||m.seed>0xffffffff)return fail('Invalid comparison seed.');
   if(w.comparisons.length>=LIMITS.comparisons||w.runs.length+2>LIMITS.runs)return fail('Comparison archive capacity reached. Export records and contact the operator.');
   const comparison=comparePolicies(owner,m.seed);w.runs.push(...comparison.runs);const {runs,...record}=comparison;w.comparisons.push(record);result={ok:true,comparison:record.id};
  }else if(sandbox) {
   let plan,original=null;
   if(m.action==='experiment') {
    const v=validatePlan(m.plan);if(!v.ok)return {ok:false,reason:'The experiment plan is not valid. Nothing was run.',errors:v.errors};plan=v.plan;
   }else {
    const loaded=await load(w,m.experiment);if(loaded.error)return fail(loaded.error);original=loaded.record;
    if(!modelFor(original.plan.scenario,original.plan.version))return fail(`Scenario ${original.plan.scenario} version ${original.plan.version} is no longer executable on this server. Its saved record and exports remain available; it cannot be repeated.`);
    const v=validatePlan(planInput(original.plan));
    if(!v.ok||JSON.stringify(v.plan)!==JSON.stringify(original.plan))return fail('This saved plan no longer validates identically under the current rules, so it cannot be repeated as the same experiment.');plan=v.plan;
   }
   const L=SANDBOX_LIMITS;
   if(w.experiments.length>=L.experimentsPerPrincipal||bytesOf(w.experiments)>=L.bytesPerPrincipal||totalBytes()>=L.totalBytes)return fail('The experiment archive has reached its storage budget. Export records and contact the room operator; nothing was deleted.');
   const outcome=await runner(plan);
   if(!outcome.ok)return fail(outcome.message);
   const record=buildRecord({id:randomUUID(),principal:owner,plan,results:outcome.results,resultsDigest:outcome.resultsDigest,createdAt:new Date().toISOString(),
    execution:{isolation:'worker-thread',durationMs:outcome.durationMs,timeoutMs:L.timeoutMs,memoryMb:L.memoryMb},repeatOf:original?.id??null,
    reproduction:original?{original:original.id,originalResultsDigest:original.resultsDigest,identical:outcome.resultsDigest===original.resultsDigest}:null});
   const size=Buffer.byteLength(JSON.stringify(record));
   if(size>L.recordBytes)return fail(`This experiment's record would be ${(size/1e6).toFixed(1)} MB, above the ${L.recordBytes/1e6} MB limit. Reduce replications, policies, sensitivity values or population size.`);
   if(bytesOf(w.experiments)+size>L.bytesPerPrincipal||totalBytes()+size>L.totalBytes)return fail('Saving this experiment would exceed the archive storage budget. Export records and contact the room operator.');
   // Phase one: the immutable record. Phase two (below): the index, committed with the main lab file.
   await experiments.write(record);written=record.id;
   w.experiments.push(indexEntry(record,size));
   result={ok:true,experiment:record.id,status:record.status,reproduced:record.reproduction?.identical??null};
  }else if(m.action==='export') {const bundle=exportEvidence(w);return {ok:true,bundle,report:reportFor(bundle),view:view()};
  }else if(m.action==='evaluate') {const receipt=await adapter.evaluate(exportEvidence(w));w.external=receipt;result={ok:true,receipt};
  }else if(!r)return fail('Start a scenario at Simulation Control first.');
  else if(m.action==='pause') {if(!running())return fail('Only a running scenario can pause.');r.clockSeconds=elapsed(r);r.status='paused';result={ok:true};
  }else if(m.action==='resume') {if(r.status!=='paused')return fail('Only a paused scenario can resume.');r.resumedAt=Date.now();r.status='running';result={ok:true};
  }else if(m.action==='finish') {if(!['paused','running'].includes(r.status))return fail('This run is already closed.');finishRun(r);result={ok:true};
  }else if(!running())return fail('Resume this scenario at Simulation Control before working.');
  else if(m.action==='order')result=createOrder(r,{destination:m.destination,quantity:m.quantity});
  else if(m.action==='agent') {if(m.task!==undefined&&typeof m.task!=='string')return fail('Invalid task ID.');result=agentStep(r,owner,m.task??null);
  }else {
   const t=typeof m.task==='string'?r.tasks.find(t=>t.id===m.task):null;if(!t)return fail('Unknown task in this run.');
   if(m.action==='claim')result=assign(r,t,{id:owner,kind:'human',principal:owner},owner);
   else {
    if(t.worker?.id!==owner||t.worker?.kind!=='human'||t.principal!==owner)return fail('Only the assigned human worker may perform this action.');
    if(m.action==='release'){if(t.status!=='claimed'||t.pickup)return fail('Only an uncollected claim can be released.');t.status='available';t.worker=null;t.principal=null;result={ok:true};}
    else if(m.action==='collect'||m.action==='deliver') {
     const o=r.orders.find(o=>o.id===t.orderId),site=siteById(m.action==='collect'?o.origin:o.destination);
     if(!reachable(c,site,2.1))return fail(`Go to ${site.name} and interact on foot.`);
     result=m.action==='collect'?pickup(r,t):deliver(r,t);
    }else if(m.action==='submit') {if(typeof m.note!=='string'||m.note.length>500)return fail('Submission notes must be at most 500 characters.');result=submit(r,t,{note:m.note});}
    else return fail('Unknown task operation.');
   }
  }
  for(const run of w.runs){assertInvariants(run);if(run.mode==='live'&&run.status==='running'){run.clockSeconds=elapsed(run);run.resumedAt=Date.now();}}
  const compact={...result};w.replays.push({key:m.key,hash:requestHash,result:compact});if(w.replays.length>LIMITS.replays)w.replays.shift();
  const next={...state,workspaces:{...state.workspaces,[owner]:w}};
  try{await save(next);}catch(e){if(written)await experiments.remove(written);throw e;}
  state=next;
  return {...result,view:view()};
 }
 return {
  request(c,m){const expected=principalOf(c);const job=queue.then(()=>principalOf(c)===expected?execute(c,m):fail('Your identity changed. Reopen the workstation before acting.')).catch(()=>fail('The lab could not save this operation. No changes were committed. Retry with the same operation key.'));queue=job.then(()=>{});return job;},
  async close(){await queue;},
 };
}
