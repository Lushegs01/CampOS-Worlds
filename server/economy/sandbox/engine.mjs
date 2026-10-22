// The experiment protocol: validate and snapshot the plan, generate each seed's starting conditions once,
// give every policy an isolated copy, execute, check invariants, measure, then analyse only complete evidence.
import {EXPERIMENT_SCHEMA,ENGINE_VERSION,SANDBOX_LIMITS,SANDBOX_POLICIES,scenarioFor,policyKey,policyLabel,conditionsFor,snapshotDefinition,validateParams,scenarioConstraintErrors} from '../../../shared/economic-sandbox.mjs';
import {analyse} from '../../../shared/economic-analysis.mjs';
import {digest} from '../model.mjs';
import * as logistics from './logistics.mjs';
import * as housing from './housing.mjs';
import * as procurement from './procurement.mjs';

/** Executable model code per registered scenario version. A retired version is removed from both maps. */
export const MODELS={'campus-logistics@2':logistics,'housing-allocation@1':housing,'campus-procurement@1':procurement};
export const modelFor=(id,version)=>MODELS[`${id}@${version}`]??null;

/** Starting conditions for one seed, for inspection before an experiment. Read-only; nothing is stored. */
export function preview(scenarioId,version,params,seed) {
 const scenario=scenarioFor(scenarioId,version),model=modelFor(scenarioId,version),errors=[];
 if(!scenario||!model)return {ok:false,errors:[{field:'scenario',message:'Choose a registered scenario and version.'}]};
 const p=validateParams(scenario.params,params,errors,'params');
 if(!errors.length)errors.push(...scenarioConstraintErrors(scenario,p));
 if(!Number.isSafeInteger(seed)||seed<0||seed>SANDBOX_LIMITS.maxSeed)errors.push({field:'seed',message:`Choose a seed from 0 to ${SANDBOX_LIMITS.maxSeed}.`});
 if(errors.length)return {ok:false,errors:errors.slice(0,12)};
 const initial=model.generate(p,seed);
 return {ok:true,preview:{scenario:scenario.id,version:scenario.version,seed,params:p,initial,digest:digest(initial)}};
}

/**
 * Runs a normalized plan (from validatePlan). `fault` exists only for tests that prove a corrupted run
 * cannot yield a successful report; the room protocol never passes it.
 */
export function executePlan(plan,{fault=null}={}) {
 const scenario=scenarioFor(plan.scenario,plan.version),model=modelFor(plan.scenario,plan.version);
 if(!scenario||!model)throw Error('This scenario version is not executable on this server.');
 const conditions=conditionsFor(plan),policies=plan.policies.map(p=>({...p,label:policyLabel(p)}));
 const initial=[],runs=[],equivalence=[];
 for(const c of conditions)for(const [r,seed] of plan.seeds.entries()) {
  const start=model.generate(c.params,seed),startDigest=digest(start),received=[];
  initial.push({condition:c.index,replication:r,seed,digest:startDigest,data:start});
  for(const p of policies) {
   const id=`c${c.index}-r${r}-${p.key}`,copy=structuredClone(start),copyDigest=digest(copy);received.push(copyDigest);
   try {
    const outcome=model.execute(copy,c.params,p,{id,seed});
    if(fault)fault(id,outcome);
    const invariants=model.invariants(start,c.params,p,outcome),failed=invariants.filter(x=>!x.pass);
    const {metrics,groups}=model.measure(scenario,start,c.params,p,outcome);
    runs.push({id,condition:c.index,replication:r,seed,policy:p.key,initialDigest:copyDigest,status:failed.length?'failed':'completed',error:failed.length?`Invariant check failed: ${failed.map(x=>x.rule).join(', ')}`:null,invariants,metrics,groups,outcome});
   }catch(e){runs.push({id,condition:c.index,replication:r,seed,policy:p.key,initialDigest:copyDigest,status:'failed',error:`Model error: ${String(e?.message??e).slice(0,240)}`,invariants:[],metrics:{},groups:{},outcome:null});}
  }
  // Every policy must have received byte-identical starting conditions, and none may have altered the original.
  equivalence.push({condition:c.index,replication:r,seed,digest:startDigest,identical:received.every(d=>d===startDigest),untouched:digest(start)===startDigest});
 }
 const complete=runs.every(r=>r.status==='completed')&&equivalence.every(e=>e.identical&&e.untouched);
 const analysis=complete?analyse(scenario,plan,conditions,runs,policies):null;
 // Group-level seed counts feed the statements above; group means and ranges are what the record keeps.
 if(analysis)for(const c of analysis.conditions)delete c.groupPaired;
 const results={status:complete?'completed':'failed',failure:complete?null:runs.find(r=>r.status!=='completed')?.error??'Starting conditions differed between policies.',conditions,seeds:plan.seeds,policies,initial,equivalence,runs,analysis};
 return {results,resultsDigest:digest(results)};
}

export function buildRecord({id,principal,plan,results,resultsDigest,execution,createdAt,repeatOf=null,reproduction=null}) {
 const scenario=scenarioFor(plan.scenario,plan.version);
 const record={schema:EXPERIMENT_SCHEMA,id,principal,createdAt,label:plan.label,engineVersion:ENGINE_VERSION,modelVersion:scenario.model,
  scenario:snapshotDefinition(scenario),
  policies:plan.policies.map(p=>({key:p.key,id:p.id,version:p.version,label:policyLabel(p),values:p.params,definition:snapshotDefinition(SANDBOX_POLICIES[policyKey(p.id,p.version)])})),
  plan,limits:{maxRuns:SANDBOX_LIMITS.maxRuns,maxReplications:SANDBOX_LIMITS.maxReplications,timeoutMs:SANDBOX_LIMITS.timeoutMs,memoryMb:SANDBOX_LIMITS.memoryMb,recordBytes:SANDBOX_LIMITS.recordBytes},
  status:results.status,execution,repeatOf,reproduction,results,resultsDigest,
  governance:{units:'simulation units only; no naira value, payment, procurement, housing assignment or real-world commitment',executedBy:'room server (worker thread)',externalValidation:null,calibratedWithRealData:false}};
 record.digest=digest(record);
 return record;
}
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Structural and integrity checks for a stored or exported experiment record. Returns a list of problems. */
export function validateRecord(record) {
 const problems=[];
 if(!isObj(record)||record.schema!==EXPERIMENT_SCHEMA)return ['Unsupported experiment schema.'];
 const {digest:stored,...body}=record;
 if(stored!==digest(body))problems.push('Record digest does not match its contents.');
 if(record.resultsDigest!==digest(record.results))problems.push('Results digest does not match the recorded results.');
 for(const k of ['id','principal','createdAt','scenario','policies','plan','results','execution'])if(record[k]===undefined)problems.push(`Missing ${k}.`);
 const r=record.results,scenario=record.scenario;
 if(!isObj(r)||!Array.isArray(r.runs)||!isObj(scenario))return [...problems,'Malformed results.'];
 const expected=(r.conditions?.length??0)*record.plan.seeds.length*record.policies.length;
 if(r.runs.length!==expected)problems.push(`Expected ${expected} runs, found ${r.runs.length}.`);
 if(r.status==='completed') {
  if(!r.analysis)problems.push('A completed experiment must include its analysis.');
  for(const run of r.runs) {
   if(run.status!=='completed'||!run.invariants.every(i=>i.pass))problems.push(`Run ${run.id} is not a completed, invariant-checked run.`);
   for(const m of scenario.metrics)if(!isObj(run.metrics[m.id]))problems.push(`Run ${run.id} lacks metric ${m.id}.`);
   for(const g of scenario.groupings)for(const grp of g.groups)if(!isObj(run.groups?.[g.id]?.[grp.id]))problems.push(`Run ${run.id} lacks group ${g.id}/${grp.id}.`);
  }
  if(!r.equivalence.every(e=>e.identical&&e.untouched))problems.push('Policies did not receive identical starting conditions.');
 }else if(r.analysis)problems.push('A failed experiment must not carry an analysis or conclusions.');
 return [...new Set(problems)].slice(0,20);
}
