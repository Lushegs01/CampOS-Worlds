import {useState} from 'react';
import {DOMAINS,SANDBOX_POLICIES,latestPolicy} from '../../../shared/economic-sandbox.mjs';
import {LOGISTICS_SITES} from '../../../shared/economic-lab.mjs';
import {labRequest,useLab} from '../client';
import type {ExperimentEntry,ExperimentRecord,ParamDef,PolicyDef,SandboxRun,Scenario} from '../types';
import {checkDraft,limits,newPolicy,openExperiment,planFrom,runPreview,scenarioOf,useSandbox,type Domain,type Draft} from './store';
import {FieldErrors,Table,pct,short} from './parts';
import {Results} from './Results';

const policyDef=(id:string,version?:number)=>(version?SANDBOX_POLICIES[`${id}@${version}` as keyof typeof SANDBOX_POLICIES]:latestPolicy(id)) as unknown as PolicyDef;
const yes=(v:unknown)=>v?'Yes':'No';
const rowsOf=(columns:string[],list:unknown[][])=>list.map(r=>Object.fromEntries(columns.map((c,i)=>[c,r[i]]))) as Record<string,any>[];
const site=(id:string)=>LOGISTICS_SITES.find(s=>s.id===id)?.name.split(' · ')[0]??id;
export function download(data:string,type:string,name:string) {const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function DomainPicker() {
 const domain=useSandbox(s=>s.domain),setDomain=useSandbox(s=>s.setDomain);
 return <label className="field lab-domain">Experimental domain<select aria-label="Experimental domain" value={domain} onChange={e=>setDomain(e.target.value as Domain)}>{DOMAINS.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>;
}
export function ModelCard({sc}:{sc:Scenario}) {
 return <div className="note sandbox-model"><b>{sc.name} · scenario {sc.id} v{sc.version}</b><p>{sc.researchQuestion}</p>
  <details><summary>What the model represents</summary><p><b>Boundary.</b> {sc.boundary}</p><p><b>Actors.</b> {sc.actors.join('; ')}.</p><p><b>Resources and constraints.</b> {sc.resources.join('; ')}.{sc.constraints.length?` Rules: ${sc.constraints.map(c=>c.rule).join('; ')}.`:''}</p><h4>Assumptions</h4><ul>{sc.assumptions.map(x=><li key={x}>{x}</li>)}</ul></details>
  <details><summary>What it does not represent</summary><h4>Limitations</h4><ul>{sc.limitations.map(x=><li key={x}>{x}</li>)}</ul><h4>Omitted</h4><ul>{sc.omitted.map(x=><li key={x}>{x}</li>)}</ul><h4>Evidence needed to calibrate with real observations</h4><ul>{sc.calibration.map(x=><li key={x}>{x}</li>)}</ul></details></div>;
}
function ParamInput({d,value,set,prefix}:{d:ParamDef;value:string|boolean;set:(v:string|boolean)=>void;prefix:string}) {
 const id=`${prefix}-${d.id}`;
 if(d.type==='bool')return <label className="lab-check"><input type="checkbox" checked={value===true} onChange={e=>set(e.target.checked)} aria-describedby={`${id}-help`}/><span>{d.label}<small id={`${id}-help`} className="muted"> {d.description}</small></span></label>;
 return <div className="field"><label htmlFor={id}>{d.label}{d.unit?` (${d.unit})`:''}</label><input id={id} type="number" inputMode="numeric" min={d.min} max={d.max} step={1} value={String(value)} onChange={e=>set(e.target.value)} aria-describedby={`${id}-help`}/><small id={`${id}-help`} className="muted">{d.description} Allowed {d.min}–{d.max}; default {String(d.default)}.</small></div>;
}
const draftErrors=(domain:Domain,d:Draft,prefix:string)=>checkDraft(domain,d).errors.filter(e=>e.field.startsWith(prefix));

/** Station A: choose the domain, read the rules, set parameters and preview starting conditions. */
export function SandboxControl({domain}:{domain:Domain}) {
 const sc=scenarioOf(domain),d=useSandbox(s=>s.drafts[domain]),edit=useSandbox(s=>s.edit),preview=useSandbox(s=>s.previews[domain]),busy=useLab(s=>s.busy),[confirm,setConfirm]=useState(false);
 const errors=draftErrors(domain,d,'params');
 return <section className="sandbox"><h3>Policy experiment setup</h3><ModelCard sc={sc}/>
  <p className="muted">Values are illustrative assumptions in simulation units. They are kept while you walk between stations; the room validates them again before running anything.</p>
  <div className="lab-param-grid">{sc.params.map(p=><ParamInput key={p.id} d={p as ParamDef} prefix={`param-${domain}`} value={d.params[p.id]} set={v=>edit(domain,{params:{...d.params,[p.id]:v}})}/>)}</div>
  {errors.length>0&&<ul className="lab-errors" aria-live="polite">{errors.map((e,i)=><li key={i}>{e.message}</li>)}</ul>}
  <div className="lab-actions">{confirm?<><button className="secondary" onClick={()=>{useSandbox.getState().reset(domain);setConfirm(false);}}>Confirm: restore every default</button><button className="text-button" onClick={()=>setConfirm(false)}>Keep my values</button></>:<button className="secondary" onClick={()=>setConfirm(true)}>Restore defaults…</button>}</div>
  <h4>Preview starting conditions</h4>
  <div className="lab-inline"><div className="field"><label htmlFor={`preview-seed-${domain}`}>Preview seed</label><input id={`preview-seed-${domain}`} type="number" min={0} max={limits.maxSeed} value={d.previewSeed} onChange={e=>edit(domain,{previewSeed:e.target.value})}/></div>
   <button className="secondary" disabled={busy||errors.length>0} onClick={()=>void runPreview('control',domain,d)}>Preview starting conditions</button></div>
  <FieldErrors/>
  {preview&&<p role="status">Generated on the room for seed {preview.seed} (digest <code>{short(preview.digest)}</code>). {describeInitial(domain,preview.initial)} Inspect them at station B, Market Operations.</p>}
 </section>;
}
function describeInitial(domain:Domain,data:Record<string,any>) {
 if(domain==='housing')return `${data.applicants.length} applicants and ${data.units.length} units.`;
 if(domain==='procurement')return `${data.orders.length} orders, ${data.suppliers.length} suppliers and a budget of ${data.budget.toLocaleString('en-GB')} simulation units.`;
 return `${data.requests.length} requests, ${data.stock} packs and ${data.couriers.length} courier${data.couriers.length===1?'':'s'}.`;
}
function InitialTables({domain,data}:{domain:Domain;data:Record<string,any>}) {
 if(domain==='housing') {
  const A=rowsOf(data.applicantColumns,data.applicants),U=rowsOf(data.unitColumns,data.units),count=(g:string)=>A.filter(a=>a.group===g).length;
  return <><p>{A.length} applicants ({count('low')} lower, {count('middle')} middle, {count('high')} higher income) for {U.length} units ({U.filter(u=>u.bedrooms>1).length} family-sized, {U.filter(u=>u.accessible).length} accessible). Rents are per period in simulation units.</p>
   <Table caption="Housing units" limit={12} head={['Unit','Bedrooms','Accessible','Reference rent','Provider minimum']} rows={U.map(u=>[u.id,String(u.bedrooms),yes(u.accessible),String(u.reference),String(u.reserve)])}/>
   <Table caption="Applicants (synthetic)" limit={12} head={['Applicant','Income group','Income','Ability to pay','Household','Bedrooms needed','Accessibility need','Insecure housing','Need score','Application position']} rows={A.map(a=>[a.id,a.group,String(a.income),String(a.budget),String(a.size),String(a.bedrooms),yes(a.accessibility),yes(a.insecure),String(a.need),String(a.queue)])}/></>;
 }
 if(domain==='procurement')return <><p>Budget {data.budget.toLocaleString('en-GB')} simulation units. {data.suppliers.filter((s:any)=>s.size==='small').length} of {data.suppliers.length} suppliers are small businesses.</p>
  <Table caption="Suppliers (synthetic)" head={['Supplier','Size','Categories','Quoted price / unit','Unit cost','Capacity','Lead time (days)','Reliability']} rows={data.suppliers.map((s:any)=>[s.id,s.size,s.categories.join(', '),Object.entries(s.prices).map(([c,p])=>`${c} ${p}`).join('; '),Object.entries(s.unitCosts).map(([c,p])=>`${c} ${p}`).join('; '),String(s.capacity),String(s.leadTime),pct(s.reliability)])}/>
  <Table caption="Procurement orders" limit={12} head={['Order','Category','Quantity','Deadline (days)']} rows={data.orders.map((o:any)=>[o.id,o.category,String(o.quantity),String(o.deadline)])}/></>;
 const R=rowsOf(data.requestColumns,data.requests);
 return <><p>{data.stock} packs in stock; customers {data.balances.customers}, Lab Stores {data.balances.business}, Campus Dispatch {data.balances.logistics} simulation units; {data.couriers.length} courier{data.couriers.length===1?'':'s'}.</p>
  <Table caption="Seeded order requests" limit={12} head={['Request','Receiver','Packs','Service class']} rows={R.map(r=>[r.id,site(r.receiver),String(r.quantity),r.serviceClass])}/></>;
}
function useSelected(domain:Domain):{entry?:ExperimentEntry;record?:ExperimentRecord} {
 const id=useSandbox(s=>s.selected[domain]),record=useSandbox(s=>id?s.records[id]:undefined),entry=useLab(s=>s.view?.sandbox?.experiments.find(e=>e.id===id));
 return {entry,record};
}
/** Saved experiments for a domain; opening one fetches the record the room verifies against its digest. */
export function Archive({domain,station,research=false}:{domain:Domain;station:string;research?:boolean}) {
 const all=useLab(s=>s.view?.sandbox?.experiments),busy=useLab(s=>s.busy),selected=useSandbox(s=>s.selected[domain]),list=(all??[]).filter(e=>e.domain===domain);
 const exportFile=async(id:string,format:'json'|'md')=>{const r=await labRequest(station,'export-experiment',{experiment:id});if(r.ok)download(format==='json'?JSON.stringify(r.bundle,null,2):r.report??'',format==='json'?'application/json':'text/markdown',`campos-experiment-${id.slice(0,8)}.${format}`);};
 if(!list.length)return <p className="muted">No saved {DOMAINS.find(d=>d.id===domain)?.label.toLowerCase()} experiments yet. Run one at station F, Research and Results.</p>;
 return <ul className="sandbox-archive">{[...list].reverse().map(e=><li key={e.id} className={e.id===selected?'selected':''}>
  <b>{e.label||`${e.policies.length} policies · seed ${e.baseSeed}`}</b> <span className={e.status==='completed'?'lab-ok':'insufficient'}>{e.status}</span>{e.reproduced!==null&&<span className={e.reproduced?'lab-ok':'insufficient'}> · {e.reproduced?'reproduced identically':'did not reproduce'}</span>}
  <small>{new Date(e.createdAt).toLocaleString()} · {e.policies.map(p=>p.key+' '+p.label).join(' / ')} · {e.replications} seed{e.replications===1?'':'s'} from {e.baseSeed}{e.sweep?` · sensitivity on ${e.sweep.param}`:''} · v{e.version} · <code>{short(e.id)}</code></small>
  <div className="lab-actions"><button className="secondary" disabled={busy} onClick={()=>void openExperiment(station,e.id)}>{e.id===selected?'Reload':'Open'} {short(e.id)}</button>
   {research&&<><button className="secondary" disabled={busy} onClick={()=>void labRequest('research','repeat',{experiment:e.id}).then(r=>{if(r.ok&&r.experiment)void openExperiment('research',r.experiment);})}>Repeat experiment {short(e.id)}</button>
    <button className="secondary" disabled={busy} onClick={()=>void exportFile(e.id,'json')}>Download JSON record {short(e.id)}</button><button className="secondary" disabled={busy} onClick={()=>void exportFile(e.id,'md')}>Download Markdown report {short(e.id)}</button></>}</div></li>)}</ul>;
}
function SelectedHint({domain,station}:{domain:Domain;station:string}) {
 return <><p className="muted">Open a saved experiment to inspect it here.</p><Archive domain={domain} station={station}/></>;
}
/** Station B: the resources and starting conditions the policies act on. */
export function InitialConditions({domain}:{domain:Domain}) {
 const preview=useSandbox(s=>s.previews[domain]),{record}=useSelected(domain),[source,setSource]=useState('preview'),[pick,setPick]=useState(0);
 const fromRecord=source==='record'&&record||!preview&&record,data=fromRecord?record!.results.initial[Math.min(pick,record!.results.initial.length-1)]:null;
 return <section className="sandbox"><h3>Experiment starting conditions</h3>
  {!preview&&!record&&<><p>Preview starting conditions at station A, or open a saved experiment.</p><Archive domain={domain} station="market"/></>}
  {preview&&record&&<label className="field">Show<select value={source} onChange={e=>setSource(e.target.value)}><option value="preview">Preview · seed {preview.seed}</option><option value="record">Saved experiment {short(record.id)}</option></select></label>}
  {fromRecord&&record&&<><label className="field">Condition and seed<select value={pick} onChange={e=>setPick(Number(e.target.value))}>{record.results.initial.map((x,i)=><option key={i} value={i}>{record.results.conditions[x.condition].label} · seed {x.seed}</option>)}</select></label>
   <p className="muted">Every compared policy received exactly these conditions (digest <code>{short(data!.digest)}</code>; identical for all: {yes(record.results.equivalence[Math.min(pick,record.results.equivalence.length-1)]?.identical)}).</p><InitialTables domain={domain} data={data!.data}/></>}
  {!fromRecord&&preview&&<><p className="muted">Preview for seed {preview.seed}; not saved.</p><InitialTables domain={domain} data={preview.initial}/></>}
 </section>;
}
function PolicyCard({p,values}:{p:PolicyDef;values?:Record<string,unknown>}) {
 return <article className="sandbox-card"><b>{p.name}</b> <small>{p.id} v{p.version}</small><p><b>Objective.</b> {p.objective}</p><p><b>Decision rule.</b> {p.decisionRule}</p>
  <details><summary>Eligibility, inputs and parameters</summary><p><b>Eligibility and constraints.</b> {p.eligibility.join('; ')}.</p><p><b>Inputs.</b> {p.inputs.join(', ')}.</p><p><b>Operation.</b> {p.behavior}</p><p><b>Parameters.</b> {p.params.length?p.params.map(d=>`${d.label} (${d.type==='bool'?'on/off':`${d.min}–${d.max}${d.unit?` ${d.unit}`:''}`}, default ${String(d.default)}${values?`, used ${String(values[d.id])}`:''})`).join('; '):'None.'}</p><p><b>Measured.</b> {p.measurements.join(' ')}</p><p><b>Assumptions.</b> {p.assumptions.join(' ')}</p></details></article>;
}
function runPicker(record:ExperimentRecord,cond:number,rep:number,policy:string):SandboxRun|undefined {return record.results.runs.find(r=>r.condition===cond&&r.replication===rep&&r.policy===policy);}
/** Station C: declared policy rules, then the individual decisions they produced in a saved experiment. */
export function PolicyOperations({domain}:{domain:Domain}) {
 const sc=scenarioOf(domain),{record}=useSelected(domain),[cond,setCond]=useState(0),[rep,setRep]=useState(0),[policy,setPolicy]=useState('P1'),[filter,setFilter]=useState('all');
 const run=record?runPicker(record,cond,rep,policy):undefined,initial=record?.results.initial.find(x=>x.condition===cond&&x.replication===rep)?.data as Record<string,any>|undefined;
 return <section className="sandbox"><h3>Policy rules</h3><p>Each policy is a named, versioned rule run by the room server. Players choose parameters within bounds; nobody can submit code or outcomes.</p>
  {sc.policies.map(id=><PolicyCard key={id} p={policyDef(id)}/>)}
  <h3>Recorded decisions</h3>
  {!record?<SelectedHint domain={domain} station="tasks"/>:<>
   <p className="muted">Experiment <code>{short(record.id)}</code> · {record.label||sc.name}</p>
   <div className="lab-inline">{record.results.conditions.length>1&&<label className="field">Condition<select value={cond} onChange={e=>setCond(Number(e.target.value))}>{record.results.conditions.map(c=><option key={c.index} value={c.index}>{c.label}</option>)}</select></label>}
    <label className="field">Seed<select value={rep} onChange={e=>setRep(Number(e.target.value))}>{record.plan.seeds.map((s,i)=><option key={i} value={i}>{s}</option>)}</select></label>
    <label className="field">Policy<select value={policy} onChange={e=>setPolicy(e.target.value)}>{record.policies.map(p=><option key={p.key} value={p.key}>{p.key} · {p.label}</option>)}</select></label>
    <label className="field">Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All</option><option value="served">Served / awarded</option><option value="excluded">Excluded / unserved</option></select></label></div>
   {!run||!run.outcome||!initial?<p className="insufficient">{run?.error??'No recorded outcome for this selection.'}</p>:<Decisions domain={domain} run={run} initial={initial} filter={filter}/>}
  </>}
 </section>;
}
function Decisions({domain,run,initial,filter}:{domain:Domain;run:SandboxRun;initial:Record<string,any>;filter:string}) {
 const o=run.outcome as Record<string,any>,keep=(served:boolean)=>filter==='all'||(filter==='served')===served;
 if(domain==='housing') {
  const A=new Map(rowsOf(initial.applicantColumns,initial.applicants).map(a=>[a.id,a])),rows=rowsOf(o.columns,o.allocations).filter(r=>keep(!!r.unit)).sort((x,y)=>x.rank-y.rank);
  return <><p>Processing order: {o.priorityMeaning}. {o.withdrawn.length?`Withdrawn units: ${o.withdrawn.join(', ')}.`:'No units withdrawn.'}</p>
   <Table caption="Applicant outcomes in processing order" limit={20} head={['Applicant','Rank','Priority value','Income group','Income','Ability to pay','Unit','Rent','Rent burden','Outcome']} rows={rows.map(r=>{const a=A.get(r.applicant);return [r.applicant,String(r.rank),String(r.priority),a?.group,String(a?.income),String(a?.budget),r.unit??'—',r.rent===null?'—':String(r.rent),r.rent===null?'—':pct(r.rent/a?.income),r.unit?'Housed':`Excluded: ${r.reason}`];})}/></>;
 }
 if(domain==='procurement') {
  const O=new Map(initial.orders.map((x:any)=>[x.id,x]));
  return <><Table caption="Awards in processing order (deadline, then ID)" limit={20} head={['Order','Category','Quantity','Deadline','Supplier','Size','Paid','Delivery','Basis','Feasible suppliers']} rows={(keep(true)?o.awards:[]).map((x:any)=>[x.order,x.category,String(x.quantity),String((O.get(x.order) as any)?.deadline),x.supplier,x.size,`${x.value.toLocaleString('en-GB')} (${x.price} / unit)`,x.onTime?'On time':`${x.delayDays} day${x.delayDays===1?'':'s'} late`,x.basis,x.feasible.join(', ')])}/>
   <Table caption="Unfulfilled orders" head={['Order','Category','Quantity','Reason']} rows={(keep(false)?o.unfulfilled:[]).map((x:any)=>[x.order,(O.get(x.order) as any)?.category,String((O.get(x.order) as any)?.quantity),x.reason])}/></>;
 }
 return <><Table caption="Orders and verification evidence" limit={24} head={['Order','Receiver','Class','Packs','Deadline (s)','Outcome','Delivered at (s)','Courier','Expense','Evidence']} rows={o.orders.filter((x:any)=>keep(x.status==='fulfilled')).map((x:any)=>[x.id,site(x.receiver),x.serviceClass,String(x.quantity),String(Math.round(x.deadline)),x.status,x.deliveredTime===null?'—':x.deliveredTime.toFixed(1),x.courier??'—',String(x.expense),x.evidence?`${x.evidence.verified?'verified':`failed: ${x.evidence.reasons.join(', ')}`} · ${short(x.evidence.digest)}`:'none'])}/>
  {keep(false)&&o.refused.length>0&&<Table caption="Requests refused before becoming orders" head={['Request','Receiver','Class','Packs','Reason']} rows={o.refused.map((x:any)=>[x.request,site(x.receiver),x.serviceClass,String(x.quantity),x.reason])}/>}
  <Table caption="Courier workload" head={['Courier','Accepted deliveries','Busy seconds','Route metres']} rows={o.couriers.map((c:any)=>[c.id,String(c.deliveries),c.busySeconds.toFixed(1),c.distance.toFixed(0)])}/>
  <details><summary>Dispatch decisions ({o.dispatch.length})</summary><Table caption="Dispatch trace" head={['At (s)','Courier','Order','Available tasks','Feasible tasks','Modeled trip (s)']} rows={o.dispatch.map((x:any)=>[x.at.toFixed(1),x.courier,x.order,String(x.candidates),String(x.feasible),x.duration.toFixed(1)])}/></details></>;
}
/** Station D outside logistics: say plainly that there is no agent, and what the rules engine may do. */
export function NoAgent({domain}:{domain:Domain}) {
 return <section className="sandbox"><h3>No agent in this domain</h3><p>{scenarioOf(domain).name} has no AI or autonomous agent. Each policy is a deterministic allocation rule executed by the room server’s policy executor in an isolated worker thread.</p>
  <ul><li><b>May:</b> read the validated plan and the generated starting conditions; apply the declared rule; record each decision and outcome.</li><li><b>May not:</b> change parameters or rules, exceed budget, capacity or supply, write balances outside the declared settlement, skip invariant checks, mark its own results valid, read other players’ workspaces or contact any external service.</li><li><b>Budget:</b> {limits.timeoutMs/1000} seconds and {limits.memoryMb} MB per experiment; at most {limits.maxRuns} runs.</li></ul></section>;
}
/** Station E: integrity, equal starting conditions and every invariant check of a saved experiment. */
export function ExperimentVerification({domain}:{domain:Domain}) {
 const {record}=useSelected(domain);
 if(!record)return <section className="sandbox"><h3>Experiment verification</h3><SelectedHint domain={domain} station="verification"/></section>;
 const r=record.results,failed=r.runs.filter(x=>x.status!=='completed'),rules=[...new Set(r.runs.flatMap(x=>x.invariants.map(i=>i.rule)))];
 return <section className="sandbox"><h3>Experiment verification</h3>
  <p className={failed.length?'insufficient':'lab-ok'} role="status">{failed.length?`${failed.length} of ${r.runs.length} runs failed. The experiment is marked failed and draws no conclusions.`:`All ${r.runs.length} runs passed ${rules.length} invariant checks each.`}</p>
  <p>The room verified this record against the digest committed in its lab file before showing it. Results digest <code>{record.resultsDigest}</code>; record digest <code>{record.digest}</code>. Digests detect accidental change; they are not signatures.</p>
  <Table caption="Equal starting conditions" head={['Condition · seed','Digest','Identical for every policy','Original left unchanged']} rows={r.equivalence.map(e=>[`${r.conditions[e.condition].label} · ${e.seed}`,short(e.digest),yes(e.identical),yes(e.untouched)])}/>
  <Table caption="Invariant checks per run" limit={16} head={['Run','Policy','Seed','Status','Checks passed','Failed checks']} rows={r.runs.map(x=>[x.id,x.policy,String(x.seed),x.status,`${x.invariants.filter(i=>i.pass).length} / ${x.invariants.length}`,x.invariants.filter(i=>!i.pass).map(i=>`${i.rule}${i.detail?`: ${i.detail}`:''}`).join('; ')||(x.error??'none')])}/>
  <details><summary>Rules checked</summary><ul>{rules.map(x=><li key={x}>{x.replaceAll('-',' ')}</li>)}</ul></details>
 </section>;
}
/** Station F: build a comparison, run it on the room, then interpret and export the stored result. */
export function SandboxResearch({domain}:{domain:Domain}) {
 const sc=scenarioOf(domain),d=useSandbox(s=>s.drafts[domain]),edit=useSandbox(s=>s.edit),{busy,action}=useLab(),{record}=useSelected(domain),[fresh,setFresh]=useState(false);
 const check=checkDraft(domain,d),errors=check.errors.filter(e=>!e.field.startsWith('params')),paramErrors=check.errors.length-errors.length;
 const setPolicy=(i:number,patch:Partial<Draft['policies'][number]>)=>edit(domain,{policies:d.policies.map((p,j)=>j===i?{...p,...patch}:p)});
 const run=async()=>{setFresh(false);const r=await labRequest('research','experiment',{plan:planFrom(domain,d)});if(r.ok&&r.experiment){await openExperiment('research',r.experiment);setFresh(true);}};
 const sweepable=sc.params.filter(p=>p.sweep);
 return <section className="sandbox"><h3>Policy comparison</h3><p>Compare {limits.minPolicies}–{limits.maxPolicies} policies on identical starting conditions for each seed. Parameters come from station A ({paramErrors?<span className="insufficient">fix {paramErrors} parameter issue{paramErrors===1?'':'s'} there</span>:'valid'}).</p>
  <fieldset className="sandbox-fieldset"><legend>Policies</legend>
   {d.policies.map((p,i)=>{const def=policyDef(p.id);return <div key={i} className="sandbox-policy"><label className="field">{`P${i+1}`}{i===0?' (baseline)':''}<select aria-label={`Policy P${i+1}`} value={p.id} onChange={e=>setPolicy(i,newPolicy(e.target.value))}>{sc.policies.map(id=><option key={id} value={id}>{policyDef(id).name}</option>)}</select></label>
    {def.params.map(q=><ParamInput key={q.id} d={q} prefix={`policy-${domain}-${i}`} value={p.params[q.id]} set={v=>setPolicy(i,{params:{...p.params,[q.id]:v}})}/>)}
    {d.policies.length>limits.minPolicies&&<button className="text-button" onClick={()=>edit(domain,{policies:d.policies.filter((_,j)=>j!==i)})}>Remove P{i+1}</button>}</div>;})}
   {d.policies.length<limits.maxPolicies&&<button className="secondary" onClick={()=>edit(domain,{policies:[...d.policies,newPolicy(sc.policies[0])]})}>Add policy variant</button>}
  </fieldset>
  <fieldset className="sandbox-fieldset"><legend>Seeds and replications</legend><div className="lab-inline">
   <div className="field"><label htmlFor={`seed-${domain}`}>Base seed</label><input id={`seed-${domain}`} type="number" min={0} max={limits.maxSeed} value={d.baseSeed} onChange={e=>edit(domain,{baseSeed:e.target.value})}/></div>
   <div className="field"><label htmlFor={`reps-${domain}`}>Replications (seeds)</label><input id={`reps-${domain}`} type="number" min={1} max={limits.maxReplications} value={d.replications} onChange={e=>edit(domain,{replications:e.target.value})}/></div></div>
   <p className="muted small-text">Replication i uses seed base + i. Each seed draws new synthetic starting conditions; within a seed every policy gets the same ones.</p>
   <label className="lab-check"><input type="checkbox" checked={d.sweepOn} onChange={e=>edit(domain,{sweepOn:e.target.checked})}/>Test sensitivity to one assumption</label>
   {d.sweepOn&&<div className="lab-inline"><label className="field">Parameter<select value={d.sweepParam} onChange={e=>edit(domain,{sweepParam:e.target.value})}>{sweepable.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    <div className="field"><label htmlFor={`sweep-${domain}`}>Values (2–{limits.maxSweepValues}, comma-separated)</label><input id={`sweep-${domain}`} value={d.sweepValues} placeholder="e.g. 20, 30, 40" onChange={e=>edit(domain,{sweepValues:e.target.value})}/></div></div>}
  </fieldset>
  <details className="sandbox-section"><summary>Optional: weight objectives for a ranking</summary><p className="muted small-text">A weighted ranking expresses your priorities, not an objective truth. Leave all at 0 to skip it. You can also explore weights after running.</p>
   <div className="lab-weights">{sc.objectives.map(m=><label key={m}>{sc.metrics.find(x=>x.id===m)?.label} <output>{d.weights[m]??0}</output><input type="range" min={0} max={limits.weightMax} step={1} value={d.weights[m]??0} onChange={e=>edit(domain,{weights:{...d.weights,[m]:Number(e.target.value)}})}/></label>)}</div></details>
  <div className="field"><label htmlFor={`label-${domain}`}>Label (optional)</label><input id={`label-${domain}`} maxLength={limits.labelLength} value={d.label} onChange={e=>edit(domain,{label:e.target.value})}/></div>
  <p role="status">{check.ok?`This plan runs ${check.runs} simulations (limit ${limits.maxRuns}) in an isolated worker for at most ${limits.timeoutMs/1000} seconds.`:'Fix the issues below to run.'}</p>
  {!check.ok&&<ul className="lab-errors" aria-live="polite">{check.errors.map((e,i)=><li key={i}><b>{e.field}</b>: {e.message}</li>)}</ul>}
  <FieldErrors/>
  <button className="primary" disabled={busy||!check.ok} onClick={()=>void run()}>Run experiment</button>
  {busy&&['experiment','repeat'].includes(action)&&<p role="status" className="lab-running">Running on the room server… other campus activity continues.</p>}
  <h3>Saved experiments</h3><Archive domain={domain} station="research" research/>
  {record&&<Results record={record} focus={fresh}/>}
 </section>;
}
