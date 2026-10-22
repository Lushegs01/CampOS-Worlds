import {useEffect,useState} from 'react';
import {LAB_STATIONS,LOGISTICS_SITES,LAB_AGENT,POLICIES,SCENARIO} from '../../shared/economic-lab.mjs';
import {useGame} from '../state';
import {labRequest,retryLab,useLab} from './client';
import type {Metrics,Run,Task} from './types';
import {useSandbox,type Domain} from './sandbox/store';
import {DomainPicker,SandboxControl,InitialConditions,PolicyOperations,NoAgent,ExperimentVerification,SandboxResearch} from './sandbox/Stations';

const value=(n:number|null,unit='')=>n===null?'Insufficient evidence':`${Number(n.toFixed(2))}${unit}`;
const pct=(n:number|null)=>n===null?'Insufficient evidence':`${(n*100).toFixed(1)}%`;
const siteName=(id:string)=>LOGISTICS_SITES.find(s=>s.id===id)?.name??id;
const short=(id:string)=>id.slice(-10);
function MetricGrid({m}:{m:Metrics}) {return <dl className="lab-metrics">
 <div><dt>Completed / created</dt><dd>{m.completed} / {m.completionDenominator}</dd></div><div><dt>Completion rate</dt><dd>{pct(m.completionRate)}</dd></div>
 <div><dt>Pending · rejected · cancelled</dt><dd>{m.pending} · {m.rejected} · {m.cancelled}</dd></div><div><dt>Mean delivery</dt><dd>{value(m.meanDeliverySeconds,' s')}</dd></div>
 <div><dt>Cost / completion</dt><dd>{value(m.costPerCompleted,' sim units')}</dd></div><div><dt>Revenue · expenses</dt><dd>{m.revenue} · {m.expenses} sim units</dd></div>
 <div><dt>Packs consumed · stockouts</dt><dd>{m.resourcesConsumed} · {m.stockouts}</dd></div><div><dt>Resource utilization</dt><dd>{pct(m.resourceUtilization)}</dd></div>
 <div><dt>Acceptance / submission</dt><dd>{pct(m.acceptanceRate)}</dd></div><div><dt>Failed / revision attempts</dt><dd>{pct(m.rejectionRate)} · {pct(m.revisionRate)}</dd></div>
 <div><dt>Human · agent accepted</dt><dd>{m.humanAccepted} · {m.agentAccepted}</dd></div><div><dt>Recognition units</dt><dd>{m.recognitionUnits}</dd></div><div><dt>Recognition allocation</dt><dd>{Object.entries(m.recognitionDistribution).map(([id,n])=>`${id==='dispatch-v1'?'Dispatch / 01':short(id)}: ${n}`).join('; ')||'No accepted contributions'}</dd></div><div><dt>Active duration · outcome</dt><dd>{value(m.durationSeconds,' s')} · {m.outcome}</dd></div>
 </dl>;}
function Requirements({task}:{task:Task}) {return <details><summary>Requirements · {task.ruleVersion}</summary><ul>{task.criteria.map(c=><li key={c}>{c}</li>)}</ul><p>From {siteName(task.inputs.origin)} to {siteName(task.outputs.destination)} · {task.inputs.quantity} packs. Due at active second {Math.round(task.constraints.deadline)}. Eligible: human or deterministic agent. Up to {task.constraints.maxAttempts} submissions.</p></details>;}
function Control({run}:{run:Run|null}) {
 const [policy,setPolicy]=useState('demand-aware'),[seed,setSeed]=useState('42'),[seeded,setSeeded]=useState(true),[confirm,setConfirm]=useState(false),busy=useLab(s=>s.busy);
 const send=(action:string)=>labRequest('control',action,{policy,seed:Number(seed),seedOrders:seeded,...(action==='reset'?{confirm:run?.id}:{})});
 return <><h3>Campus Logistics Economy</h3><p>Run a closed campus marketplace. You own this workspace; other players’ scenarios are separate. Use the other physical stations for orders, work, verification and research.</p>
 <div className="note"><b>Scenario 1 · delivery/1</b><p>Start with 12 resource packs and 2,500 simulation units across customer, business and logistics accounts. Orders reserve packs; accepted delivery consumes them. Price: 20 sim units / pack. Expense: 1 + ceil(route metres / 20). Deadline: 600 active seconds; up to 3 submission attempts. Each accepted delivery receives 10 separate recognition units.</p></div>
 <label className="field">Dispatch policy<select aria-label="Dispatch policy" value={policy} onChange={e=>setPolicy(e.target.value)}>{POLICIES.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="muted">{POLICIES.find(p=>p.id===policy)?.description}</p>
 <label className="field">Reproducible seed<input type="number" min="0" max="4294967295" value={seed} onChange={e=>setSeed(e.target.value)}/></label><label className="lab-check"><input type="checkbox" checked={seeded} onChange={e=>setSeeded(e.target.checked)}/>Create six seeded customer orders</label>
 <div className="lab-actions"><button className="primary" disabled={busy||!!run&&['running','paused'].includes(run.status)||!/^\d+$/.test(seed)} onClick={()=>void send('start')}>Start scenario</button>
 {run?.status==='running'&&<button className="secondary" disabled={busy} onClick={()=>void send('pause')}>Pause run</button>}{run?.status==='paused'&&<button className="secondary" disabled={busy} onClick={()=>void send('resume')}>Resume run</button>}
 {run&&['running','paused'].includes(run.status)&&<button className="secondary" disabled={busy} onClick={()=>void send('finish')}>Finish and archive</button>}</div>
 {run&&<div className="note"><label className="lab-check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Archive this run, cancel outstanding work and start a new run. Historical records remain.</label><button className="secondary" disabled={busy||!confirm} onClick={()=>{void send('reset');setConfirm(false);}}>Reset into new run</button></div>}
 </>;
}
function Market({run}:{run:Run}) {
 const [destination,setDestination]=useState('welcome'),[quantity,setQuantity]=useState(1),busy=useLab(s=>s.busy);
 return <><h3>Simulation businesses</h3><p>Lab Stores supplies resource packs; Campus Dispatch provides delivery services to four explicitly configured campus receivers. These entities exist only within this simulation.</p><div className="lab-cards"><article><b>Lab Stores</b><p>{run.stock} packs in stock · {run.reserved} reserved · {run.stock-run.reserved} available.</p></article><article><b>Campus Dispatch</b><p>Simulation logistics operator · {run.balances.logistics} sim units earned from accepted delivery services.</p></article><article><b>Simulation balances</b>{Object.entries(run.balances).map(([k,v])=><p key={k}>{{business:'Lab Stores',customers:'Campus receivers',logistics:'Campus Dispatch'}[k]??k}: {v} sim units</p>)}</article></div>
 <form className="lab-order" onSubmit={e=>{e.preventDefault();void labRequest('market','order',{destination,quantity});}}><label className="field">Receiver<select aria-label="Receiver" value={destination} onChange={e=>setDestination(e.target.value)}>{LOGISTICS_SITES.filter(s=>s.id!=='stores').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="field">Resource packs<input type="number" min="1" max="3" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label><p>{quantity*20} simulation units · stock reserved on order creation.</p><button className="primary" disabled={busy||run.status!=='running'}>Create order</button></form>
 <h3>Orders</h3>{!run.orders.length&&<p>No orders. Create an order to generate delivery work.</p>}{run.orders.map(o=><article className="lab-card" key={o.id}><b>{short(o.id)} · {o.status}</b><p>{o.quantity} packs → {siteName(o.destination)} · {o.quantity*o.unitPrice} sim units</p></article>)}
 <h3>Settled transactions</h3>{!run.transactions.length&&<p>No settlement yet. Unverified work produces no revenue.</p>}{run.transactions.map(t=><p key={t.id}>{short(t.order)} · revenue {t.revenue} · expense {t.expense} · {t.resourceConsumed} packs consumed.</p>)}</>;
}
function Tasks({run}:{run:Run}) {
 const {view,busy}=useLab(),[note,setNote]=useState('');
 const navigate=(task:Task)=>{const s=LOGISTICS_SITES.find(s=>s.id===(!task.pickup?task.inputs.origin:task.outputs.destination));if(s){useGame.getState().set({panel:null,destination:`pt:${s.x}:${s.z}:${s.name}`});useGame.getState().notify(`${s.name}: (${s.x}, ${s.z}). Walk there and use E or Interact.`);}};
 return <><p>Inspect requirements before claiming. Collect at Lab Stores, visit the named receiver, then return here to submit. Pickup and delivery require your actual room-controlled location. Menus do not pause deadlines.</p>
 {!run.tasks.length&&<p>No work available. Create an order at Market Operations.</p>}{run.tasks.map(t=>{const mine=t.worker?.id===view?.principal,working=['claimed','in_progress','revision'].includes(t.status);return <article className="lab-card" key={t.id}><span className="eyebrow">{short(t.id)} · {t.status}</span><h3>{t.description}</h3><Requirements task={t}/><p>Worker: {t.worker?`${t.worker.kind} / ${short(t.worker.id)}`:'Available'} · Attempts: {t.attempts.length} / 3</p>
 {t.attempts.at(-1)?.reasons.length? <p role="status">Last verification: {t.attempts.at(-1)?.reasons.join(', ')}</p>:null}
 <div className="lab-actions">{t.status==='available'&&<button className="primary" disabled={busy||run.status!=='running'} onClick={()=>void labRequest('tasks','claim',{task:t.id})}>Claim {short(t.id)}</button>}
 {mine&&working&&!t.delivery&&<button className="secondary" onClick={()=>navigate(t)}>Find {t.pickup?'receiver':'pickup'}</button>}
 {mine&&t.status==='claimed'&&!t.pickup&&<button className="secondary" disabled={busy} onClick={()=>void labRequest('tasks','release',{task:t.id})}>Release claim</button>}</div>
 {mine&&working&&<><label className="field">Submission note<input value={note} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="Optional observations"/></label><button className="primary" disabled={busy||run.status!=='running'} onClick={()=>void labRequest('tasks','submit',{task:t.id,note})}>Submit {short(t.id)} for verification</button><p className="muted">{t.delivery?'Delivery recorded. Ready for verification.':t.pickup?'Packs collected. Delivery still required.':'Pickup and delivery still required. An incomplete submission returns specific verification reasons.'}</p></>}
 </article>;})}</>;
}
function Agents({run}:{run:Run}) {
 const {view,busy}=useLab(),[task,setTask]=useState('');
 return <><h3>{LAB_AGENT.name} · {LAB_AGENT.id}</h3><p>{LAB_AGENT.execution}. No paid API or external model is used.</p><p>Responsible principal: <code>{view?.principal}</code></p><ul>{LAB_AGENT.capabilities.map(c=><li key={c}>{c}</li>)}</ul><p>Budget: one feasible task / command, four execution actions / task. The server independently verifies and accepts submissions.</p><details><summary>Denied capabilities</summary><p>{LAB_AGENT.forbidden.join(' · ')}</p></details><label className="field">Task authorization<select aria-label="Task authorization" value={task} onChange={e=>setTask(e.target.value)}><option value="">Authorize next feasible task</option>{run.tasks.filter(t=>t.status==='available').map(t=><option key={t.id} value={t.id}>{t.description}</option>)}</select></label><button className="primary" disabled={busy||run.status!=='running'||!run.tasks.some(t=>t.status==='available')} onClick={()=>void labRequest('agents','agent',task?{task}:{}).then(r=>{if(r.ok)setTask('');})}>Execute one authorized delivery</button>
 <h3>Execution trace</h3>{!run.agentTrace.length&&<p>No agent activity yet.</p>}{run.agentTrace.map(t=><article className="lab-card" key={t.id}><b>{short(t.task)} · {t.decision}</b><p>{t.candidateCount} candidate tasks; {t.actions} bounded actions; {value(t.route.distance,' m')}; {value(t.route.duration,' modeled seconds')}; {t.route.cost} sim units expense.</p><p>{run.tasks.find(task=>task.id===t.task)?.status} · {t.execution}</p></article>)}</>;
}
function Verification({run}:{run:Run}) {return <><p>Delivery verifier / 1 reads authoritative events and versioned rules. Local acceptance / 1 settles verified work and writes the contribution ledger. Workers cannot approve their own results.</p>
 {!run.tasks.some(t=>t.attempts.length)&&<p>No submitted evidence yet.</p>}{run.tasks.flatMap(t=>t.attempts).map(e=><article className="lab-card" key={e.id}><b>{short(e.task)} · {e.verified?'Verified by server':'Verification failed'}</b><p>{e.ruleVersion} · {e.worker.kind} · {short(e.worker.id)}</p><ul>{e.checks.map(c=><li key={c.rule}>{c.pass?'Pass':'Fail'}: {c.rule.replaceAll('_',' ')}</li>)}</ul><p>Evidence: <code>{e.id}</code></p><p>SHA-256: <code>{e.digest}</code></p><details><summary>Evidence bundle</summary><pre>{JSON.stringify(e,null,2)}</pre></details></article>)}
 <h3>Local contribution ledger</h3><p>{SCENARIO.contributionRule}: 10 recognition units per locally accepted delivery; zero for rejected work. Separate from simulated business balances. Unfunded; no redemption or official Flow Research points.</p>{!run.contributions.length&&<p>No accepted contributions yet.</p>}{run.contributions.map(c=><article className="lab-card" key={c.id}><b>{short(c.contributor)} · {c.recognitionUnits} recognition units</b><p>{c.reason} · {c.rule}</p><p>Task: <code>{c.task}</code><br/>Evidence: <code>{c.evidence}</code><br/>Principal: <code>{c.principal}</code><br/>Accepted by: {c.acceptedBy}</p></article>)}</>;}
function download(data:string,type:string,name:string) {const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function Research() {
 const {view,busy}=useLab(),[seed,setSeed]=useState('42');
 if(!view)return null;
 const exportFile=async(format:'json'|'md')=>{const r=await labRequest('research','export');if(r.ok)download(format==='json'?JSON.stringify(r.bundle,null,2):r.report??'',format==='json'?'application/json':'text/markdown',`campos-lab-report.${format}`);};
 return <><h3>Live-model quick comparison · scenario 1</h3><p>Run the fixed campus circuit and demand-aware dispatch with identical seeded orders, inventory and balances, using the live lab’s exact scenario 1 rules (one courier, six orders). Results come from each recorded task, verification and settlement. For three policies, replications, groups and sensitivity, use the policy comparison above.</p><label className="field">Comparison seed<input type="number" min="0" max="4294967295" value={seed} onChange={e=>setSeed(e.target.value)}/></label><button className="primary" disabled={busy||!/^\d+$/.test(seed)} onClick={()=>void labRequest('research','compare',{seed:Number(seed)})}>Run policy comparison</button>
 {view.comparisons.map(c=><article className="lab-card" key={c.id}><h3>Comparison · seed {c.seed}</h3><div className="lab-comparison">{c.results.map(r=><section key={r.run}><b>{POLICIES.find(p=>p.id===r.policy)?.name}</b><p>Run <code>{r.run}</code></p><MetricGrid m={r.metrics}/></section>)}</div><ul>{c.assumptions.map(a=><li key={a}>{a}</li>)}</ul></article>)}
 <h3>Run archive</h3>{!view.history.length&&<p>No runs yet. Start one at Simulation Control or run a comparison here.</p>}{view.history.map(r=><details key={r.id}><summary>{r.policy} · {r.status} · seed {r.seed} · {short(r.id)}</summary><p>Run <code>{r.id}</code> · {r.mode}</p><MetricGrid m={r.metrics}/></details>)}
 <div className="lab-actions"><button className="secondary" disabled={busy} onClick={()=>void exportFile('json')}>Export JSON evidence</button><button className="secondary" disabled={busy} onClick={()=>void exportFile('md')}>Export readable report</button><button className="secondary" disabled={busy} onClick={()=>void labRequest('research','evaluate')}>Check external adapter</button></div>
 {view.external&&<p role="status">{view.external.status}: {view.external.reason}</p>}<div className="note"><b>Research limits</b><p>This route model assumes 5 m/s, one sequential worker and no traffic. Simulation success has no independent real-world validation. No WorkStream contract or funded rewards are connected.</p></div></>;
}
const NO_RUN=<p>No live run. Start a scenario at station A, Simulation Control, to work in the campus logistics economy.</p>;
/** Logistics keeps the original live, in-world workflow and adds its policy-experiment sections. */
function Logistics({station,run}:{station:string;run:Run|null}) {
 const domain:Domain='logistics';
 if(station==='control')return <><Control run={run}/><SandboxControl domain={domain}/></>;
 if(station==='research')return <><SandboxResearch domain={domain}/><Research/></>;
 const live=!run?NO_RUN:station==='market'?<Market run={run}/>:station==='tasks'?<Tasks run={run}/>:station==='agents'?<Agents run={run}/>:station==='verification'?<Verification run={run}/>:null;
 return <>{live}{station==='market'?<InitialConditions domain={domain}/>:station==='tasks'?<PolicyOperations domain={domain}/>:station==='verification'?<ExperimentVerification domain={domain}/>:station==='agents'?<p className="note">In policy experiments, Campus Dispatch couriers use this worker’s bounded model: one task at a time, chosen by the selected policy, verified by delivery/1 and settled by the same server code. They do not navigate the campus.</p>:null}</>;
}
function Experiments({station,domain}:{station:string;domain:Domain}) {
 return station==='control'?<SandboxControl domain={domain}/>:station==='market'?<InitialConditions domain={domain}/>:station==='tasks'?<PolicyOperations domain={domain}/>:station==='agents'?<NoAgent domain={domain}/>:station==='verification'?<ExperimentVerification domain={domain}/>:<SandboxResearch domain={domain}/>;
}
export default function LabPanel({station}:{station:string}) {
 const {view,busy,error,message,retry}=useLab(),run=view?.current,s=LAB_STATIONS.find(s=>s.id===station),domain=useSandbox(s=>s.domain);
 useEffect(()=>{void labRequest(station,'inspect');},[station]);
 if(!s)return <p>Unknown workstation.</p>;
 return <div className="economic-lab"><div className="lab-status"><span>STATION {s.letter} / {s.name}</span><button className="text-button" disabled={busy} onClick={()=>void labRequest(station,'inspect')}>Refresh</button></div>
 <DomainPicker/>
 {busy&&<p role="status">Working with the campus room…</p>}{error&&<div className="note" role="alert">{error}{retry&&<button className="secondary" disabled={busy} onClick={()=>void retryLab()}>Retry same operation</button>}</div>}{message&&<p role="status">{message}</p>}
 {view&&(domain==='logistics'?<><p className="muted">{run?`${run.status} · ${run.policy} · seed ${run.seed} · active second ${Math.round(run.elapsed)}`:'No active run'} · {view.durability}</p>{run&&<details><summary>Run identity</summary><code>{run.id}</code></details>}
  <Logistics station={station} run={run??null}/></>:<><p className="muted">Policy experiments · {view.sandbox?.usage.count??0} saved · {view.sandbox?.durability}</p><Experiments station={station} domain={domain}/></>)}
 <p className="small-text muted">Simulation units and recognition units have no monetary or redemption value. All records here are local prototype records, separate from institutional, academic and financial records.</p></div>;
}
