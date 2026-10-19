import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {LAB_STATIONS,LAB_AGENT,POLICIES,SCENARIO,siteById,insideLab} from '../../shared/economic-lab.mjs';
import {moveWithCollisions} from '../../shared/campus.mjs';
import {newRun,createOrder,seedOrders,assign,pickup,deliver,submit,agentStep,finishRun,metrics,elapsed,assertInvariants,comparePolicies,digest} from './model.mjs';
import {localOnlyAdapter} from './adapter.mjs';

const fail=reason=>({ok:false,reason});
const LIMITS={principals:500,runs:100,comparisons:20,replays:256};
const STATION_ACTIONS={control:['start','pause','resume','finish','reset'],market:['order'],tasks:['claim','submit','release'],agents:['agent'],verification:[],research:['compare','export','evaluate']};
export const principalOf=c=>createHash('sha256').update(c.account?.id?`account:${c.account.id}`:`guest:${c.token}`).digest('hex');
const reachable=(p,target,range)=>{
 if(p.dorm||p.vehicle||p.seat||p.y>.05||!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.hypot(p.x-target.x,p.z-target.z)>range)return false;
 const q=moveWithCollisions(p.x,p.z,target.x-p.x,target.z-p.z);
 return Math.hypot(q.x-target.x,q.z-target.z)<.15;
};
const active=w=>w.runs.find(r=>r.id===w.active)??null;
const summary=r=>({id:r.id,policy:r.policy,seed:r.seed,mode:r.mode,status:r.status,startedAt:r.startedAt,metrics:metrics(r)});
function snapshot(w,storage) {
 const r=active(w);
 return {schema:'campos.lab-view/1',principal:w.owner,durability:storage,scenario:SCENARIO,policies:POLICIES,agent:{...LAB_AGENT,principal:w.owner},
  current:r?{...r,metrics:metrics(r),elapsed:elapsed(r)}:null,history:w.runs.map(summary),comparisons:w.comparisons.map(c=>({...c,runs:undefined})),external:w.external??null};
}
const limitations=['This is a local campus simulation, not an independently validated real-world result.','Simulation units have no naira conversion or redemption value. Recognition units are separate, local and unfunded.','The deterministic agent models logistics on the server; it is not a physically navigating character.','No official WorkStream acceptance, Flow Research points or external rewards.','One server writer; retain the configured data volume and backups. Guest records require the same session token.'];
export function exportEvidence(w) {
 const runs=structuredClone(w.runs);
 return {schema:'campos.economic-lab/1',exportedAt:new Date().toISOString(),principal:w.owner,runIds:runs.map(r=>r.id),scenario:SCENARIO,runs:runs.map(r=>({...r,metrics:metrics(r)})),comparisons:structuredClone(w.comparisons),governance:{verifier:'system:delivery-verifier/1',acceptance:'system:local-acceptance/1',contributionRule:SCENARIO.contributionRule,recognitionPerDelivery:10,externalAcceptance:null,independentValidation:null,fundedReward:null},limitations};
}
export function reportFor(bundle) {
 return ['# CampOS Worlds · Economic Simulation Lab',`Evidence format: ${bundle.schema}`,`Runs: ${bundle.runIds.join(', ')||'No runs yet'}`,'','## Model','Campus Logistics Economy / scenario 1; resource packs; 20 simulation units per pack; 12 starting packs; 600 active seconds per order. Orders reserve stock. Only verified and locally accepted work consumes stock and settles balanced customer/business/logistics transfers. Operating expense = 1 + ceil(authored route metres / 20). Ten recognition units per accepted delivery.','',...bundle.runs.flatMap(r=>[`## ${r.id}`,`Policy: ${r.policy}; seed: ${r.seed}; mode: ${r.mode}; state: ${r.status}`,`Initial: ${JSON.stringify(r.initial)}`,`Metrics: ${JSON.stringify(r.metrics)}`,...r.tasks.map(t=>`- ${t.id}: ${t.status}; worker ${t.worker?.id??'unassigned'}; evidence ${t.attempts.map(e=>`${e.id} (${e.verified?'verified':e.reasons.join(', ')}; SHA-256 ${e.digest})`).join('; ')||'none'}`),`Contribution allocation: ${JSON.stringify(r.contributions)}`,'']),...bundle.comparisons.flatMap(c=>['## Policy comparison',`Comparison ${c.id}; seed ${c.seed}; runs ${c.runIds.join(', ')}`,JSON.stringify(c.results),...c.assumptions,'']),'## Limitations',...bundle.limitations.map(l=>`- ${l}`)].join('\n');
}

/** Serialized copy-on-write transactions; publish only after atomic durable persistence succeeds. */
export function createEconomyService({file=null,adapter=localOnlyAdapter,persist=null}={}) {
 let state={schema:1,workspaces:{}},queue=Promise.resolve(),unavailable='';
 const storage=file?'server-file':'memory · resets when this room server restarts';
 if(file)try{const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.digest!==digest(saved.state)||saved.state.schema!==1)throw Error('invalid snapshot');state=saved.state;
  for(const w of Object.values(state.workspaces))for(const r of w.runs){assertInvariants(r);if(r.status==='running'){r.clockSeconds=Math.max(r.virtualSeconds,r.clockSeconds);r.status='paused';}}
 }catch(e){if(e.code!=='ENOENT')unavailable='Lab storage could not be verified. Ask the room operator to restore the data file; the campus remains available.';}
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
  if(!physical&&m.action!=='inspect'&&!STATION_ACTIONS[m.station]?.includes(m.action))return fail('This workstation does not grant that action.');
  const owner=principalOf(c),existing=state.workspaces[owner];
  if(!existing&&Object.keys(state.workspaces).length>=LIMITS.principals)return fail('The lab has reached its storage capacity. Contact the room operator.');
  const w=structuredClone(existing??{owner,active:null,runs:[],comparisons:[],replays:[],external:null});
  if(m.action==='inspect')return {ok:true,view:snapshot(w,storage)};
  if(typeof m.key!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(m.key))return fail('A valid operation key is required.');
  const requestHash=digest({...m,ref:undefined,key:undefined}),prior=w.replays.find(r=>r.key===m.key);
  if(prior)return prior.hash===requestHash?{...prior.result,replayed:true,view:snapshot(w,storage)}:fail('That operation key belongs to a different request.');
  let r=active(w),result;
  // A request from an old panel cannot mutate a newly reset scenario.
  if(m.run!==(r?.id??null))return fail('The run changed. Refresh this workstation and retry.');
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
  }else if(m.action==='export') {const bundle=exportEvidence(w);return {ok:true,bundle,report:reportFor(bundle),view:snapshot(w,storage)};
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
  const next={...state,workspaces:{...state.workspaces,[owner]:w}};await save(next);state=next;
  return {...result,view:snapshot(w,storage)};
 }
 return {
  request(c,m){const expected=principalOf(c);const job=queue.then(()=>principalOf(c)===expected?execute(c,m):fail('Your identity changed. Reopen the workstation before acting.')).catch(()=>fail('The lab could not save this operation. No changes were committed. Retry with the same operation key.'));queue=job.then(()=>{});return job;},
  async close(){await queue;},
 };
}
