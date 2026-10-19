import {createHash,randomUUID} from 'node:crypto';
import {SCENARIO,LAB_AGENT,POLICIES,siteById} from '../../shared/economic-lab.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = reason => ({ok:false,reason});
const terminal = t => ['accepted','rejected','cancelled'].includes(t.status);
const event = (run,type,data={}) => {const e={id:`${run.id}:e${run.events.length+1}`,type,time:elapsed(run),...data};run.events.push(e);return e;};
export function elapsed(run,now=Date.now()) {return Math.max(run.virtualSeconds,run.clockSeconds+(run.mode==='live'&&run.status==='running'?Math.max(0,now-run.resumedAt)/1000:0));}
export function newRun(owner,policy,seed=42,now=Date.now(),mode='live') {
 const run={id:randomUUID(),owner,scenario:SCENARIO.id,scenarioVersion:SCENARIO.version,ruleVersion:SCENARIO.ruleVersion,seed,policy,mode,status:'running',startedAt:now,endedAt:null,resumedAt:now,clockSeconds:0,virtualSeconds:0,
  initial:{stock:SCENARIO.stock,balances:{...SCENARIO.initialBalances}},stock:SCENARIO.stock,reserved:0,balances:{...SCENARIO.initialBalances},orders:[],tasks:[],events:[],transactions:[],contributions:[],agentTrace:[]};
 event(run,'initialized',{policy,seed,initial:structuredClone(run.initial)});
 return run;
}
export function createOrder(run,{destination,quantity},now=Date.now()) {
 if(run.orders.length>=SCENARIO.maxOrders)return fail('This run has reached its 12-order budget. Finish it and start a new run.');
 if(!['commons','student','welcome','courts'].includes(destination)||!Number.isInteger(quantity)||quantity<1||quantity>3)return fail('Choose a receiver and 1–3 resource packs.');
 if(run.stock-run.reserved<quantity){event(run,'stockout',{requested:quantity,available:run.stock-run.reserved});return fail('Insufficient unreserved stock. No order or payment was created.');}
 const at=elapsed(run,now),index=run.orders.length+1,id=`${run.id}:o${index}`,taskId=`${run.id}:t${index}`;
 const order={id,taskId,origin:'stores',destination,quantity,unitPrice:SCENARIO.price,status:'reserved',createdAt:now,createdTime:at,deadline:at+SCENARIO.deadlineSeconds};
 run.orders.push(order);run.reserved+=quantity;
 run.tasks.push({id:taskId,orderId:id,description:`Deliver ${quantity} resource pack${quantity===1?'':'s'} to ${siteById(destination).name}`,category:'campus-delivery',creator:run.owner,
  ruleVersion:SCENARIO.ruleVersion,criteria:['Assigned worker only','Collect the reserved packs at Lab Stores','Deliver to the named receiver','Submit before the 600-second active deadline','Maximum three verification attempts'],
  inputs:{origin:'stores',quantity},outputs:{destination,quantity},constraints:{deadline:order.deadline,maxAttempts:SCENARIO.maxAttempts},eligible:['human','agent'],status:'available',worker:null,principal:null,attempts:[],pickup:null,delivery:null,createdAt:now,acceptedAt:null});
 event(run,'order_created',{order:id,task:taskId,quantity,destination});
 return {ok:true,order:id,task:taskId};
}
export function seedOrders(run) {
 let n=run.seed>>>0;const next=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n;};
 for(const destination of ['student','commons','courts','welcome','student','commons'])createOrder(run,{destination,quantity:1+next()%2},run.startedAt);
}
export function assign(run,task,worker,principal) {
 if(task.status!=='available')return fail('This task is already assigned or closed.');
 if(principal!==run.owner||!['human','agent'].includes(worker.kind))return fail('Worker permission denied.');
 task.worker={...worker};task.principal=principal;task.status='claimed';
 event(run,'claimed',{task:task.id,worker:task.worker,principal});return {ok:true};
}
export function pickup(run,task) {
 if(!['claimed','revision'].includes(task.status)||task.pickup)return fail('Collect only an assigned task that has not been picked up.');
 const order=run.orders.find(o=>o.id===task.orderId);
 if(order.status!=='reserved')return fail('This order is no longer reserved.');
 task.status='in_progress';task.pickup=event(run,'picked_up',{task:task.id,order:order.id,site:order.origin,worker:task.worker.id,quantity:order.quantity}).id;
 return {ok:true};
}
export function deliver(run,task) {
 if(!['in_progress','revision'].includes(task.status)||!task.pickup||task.delivery)return fail('Pick up the reserved packs before delivering them.');
 const order=run.orders.find(o=>o.id===task.orderId);
 task.status='in_progress';task.delivery=event(run,'delivered',{task:task.id,order:order.id,site:order.destination,worker:task.worker.id,quantity:order.quantity}).id;
 return {ok:true};
}
export function routeFor(run,order) {
 const origin=siteById('stores'),destination=siteById(order.destination);
 const points=[origin,{x:-57,z:36.5},{x:-32,z:36.5},{x:-32,z:26},{x:-12,z:26}];
 if(run.policy==='fixed')points.push({x:0,z:36},{x:0,z:26},{x:-12,z:26});
 if(order.destination==='commons')points.push({x:-12,z:9},{x:-12,z:0},{x:-30,z:0});
 if(order.destination==='student')points.push({x:-12,z:9},{x:17,z:9},{x:17,z:5.5},{x:29,z:5.5});
 if(order.destination==='courts')points.push({x:13,z:26},{x:26,z:26});
 points.push(destination);
 const distance=points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-points[i].x,p.z-points[i].z),0);
 return {points,distance,duration:distance/5+2,cost:1+Math.ceil(distance/20)};
}
function release(run,task,reason) {
 const order=run.orders.find(o=>o.id===task.orderId);
 if(order.status==='reserved'){run.reserved-=order.quantity;order.status='rejected';}
 task.status='rejected';event(run,'rejected',{task:task.id,reason});
}
/** The trusted verifier and local acceptance policy are separate from the worker actions. */
export function submit(run,task,output,now=Date.now()) {
 if(terminal(task)||task.status==='available')return fail('This task cannot be submitted in its current state.');
 const order=run.orders.find(o=>o.id===task.orderId),at=elapsed(run,now),route=routeFor(run,order);
 task.status='submitted';event(run,'submitted',{task:task.id,worker:task.worker.id});
 const relevant=run.events.filter(e=>e.task===task.id),picked=relevant.find(e=>e.id===task.pickup),delivered=relevant.find(e=>e.id===task.delivery);
 const checks=[
  {rule:'worker_authorized',pass:task.principal===run.owner&&task.worker.principal===run.owner},
  {rule:'order_reserved',pass:order.status==='reserved'&&run.reserved>=order.quantity&&run.stock>=order.quantity},
  {rule:'origin_and_quantity',pass:!!picked&&picked.site===order.origin&&picked.quantity===order.quantity&&picked.worker===task.worker.id},
  {rule:'destination_and_quantity',pass:!!delivered&&delivered.site===order.destination&&delivered.quantity===order.quantity&&delivered.worker===task.worker.id},
  {rule:'action_order',pass:!!picked&&!!delivered&&relevant.indexOf(picked)<relevant.indexOf(delivered)},
  {rule:'deadline',pass:at<=task.constraints.deadline},
  {rule:'funds',pass:run.balances.customers>=order.quantity*order.unitPrice&&run.balances.business>=route.cost},
  {rule:'no_previous_settlement',pass:!run.transactions.some(t=>t.order===order.id)},
 ];
 const reasons=checks.filter(c=>!c.pass).map(c=>c.rule),verified=!reasons.length;
 const evidence={schema:'campos.delivery-evidence/1',id:`${task.id}:a${task.attempts.length+1}`,run:run.id,scenario:run.scenario,scenarioVersion:run.scenarioVersion,task:task.id,ruleVersion:task.ruleVersion,
  worker:structuredClone(task.worker),principal:task.principal,initial:structuredClone(run.initial),inputs:{order:structuredClone(order),policy:run.policy,seed:run.seed},
  output:output??{},events:structuredClone(relevant),measurements:{activeSeconds:at,duration:delivered&&picked?delivered.time-picked.time:null,fulfillmentSeconds:delivered?delivered.time-order.createdTime:null,routeDistance:route.distance,cost:route.cost},checks,verified,reasons,submittedAt:now,verifiedBy:'system:delivery-verifier/1',externalValidation:null};
 evidence.digest=digest(evidence);task.attempts.push(evidence);
 if(!verified){
  const retry=at<=task.constraints.deadline&&task.attempts.length<task.constraints.maxAttempts;
  if(retry){task.status='revision';event(run,'revision_requested',{task:task.id,evidence:evidence.id,reasons});}
  else release(run,task,reasons.join(', '));
  return {ok:false,reason:`Verification failed: ${reasons.join(', ')}.${retry?' Correct the task and resubmit.':''}`,evidence:evidence.id};
 }
 task.status='verified';event(run,'verified',{task:task.id,evidence:evidence.id,digest:evidence.digest});
 // Local acceptance is a server policy, never an approval capability granted to workers.
 const gross=order.quantity*order.unitPrice;
 run.stock-=order.quantity;run.reserved-=order.quantity;run.balances.customers-=gross;run.balances.business+=gross-route.cost;run.balances.logistics+=route.cost;
 run.transactions.push({id:`${order.id}:settlement`,order:order.id,task:task.id,evidence:evidence.id,time:at,resourceConsumed:order.quantity,revenue:gross,expense:route.cost,entries:[{account:'customers',delta:-gross},{account:'business',delta:gross-route.cost},{account:'logistics',delta:route.cost}]});
 order.status='fulfilled';task.status='accepted';task.acceptedAt=now;
 run.contributions.push({id:`${task.id}:recognition`,task:task.id,evidence:evidence.id,digest:evidence.digest,contributor:task.worker.id,kind:task.worker.kind,principal:task.principal,rule:SCENARIO.contributionRule,recognitionUnits:SCENARIO.recognitionPerDelivery,reason:'Accepted delivery under delivery/1',acceptedBy:'system:local-acceptance/1',at:now,externalRecord:null,fundedReward:null});
 event(run,'accepted',{task:task.id,evidence:evidence.id,recognitionUnits:SCENARIO.recognitionPerDelivery});
 return {ok:true,evidence:evidence.id};
}
export function agentStep(run,principal,taskId=null) {
 const at=elapsed(run),eligible=run.tasks.filter(t=>t.status==='available'&&(!taskId||t.id===taskId));
 const score=t=>routeFor(run,run.orders.find(o=>o.id===t.orderId)).duration;
 if(run.policy==='demand-aware')eligible.sort((a,b)=>score(a)-score(b)||a.id.localeCompare(b.id));
 const task=eligible.find(t=>at+score(t)<=t.constraints.deadline);
 if(!task)return fail('No feasible available task within the agent’s time and resource budget.');
 const route=routeFor(run,run.orders.find(o=>o.id===task.orderId));
 run.agentTrace.push({id:run.agentTrace.length+1,task:task.id,principal,agent:LAB_AGENT.id,policy:run.policy,decision:'Selected feasible delivery',candidateCount:eligible.length,route,execution:LAB_AGENT.execution,actions:4});
 const a=assign(run,task,{id:LAB_AGENT.id,kind:'agent',principal},principal);if(!a.ok)return a;
 pickup(run,task);run.virtualSeconds=Math.max(run.virtualSeconds,at)+route.duration;deliver(run,task);
 const submittedAt=run.mode==='experiment'?run.startedAt+run.virtualSeconds*1000:Date.now();
 return submit(run,task,{kind:'modeled-logistics',route:route.points},submittedAt);
}
export function finishRun(run,reason='completed',now=Date.now()) {
 run.clockSeconds=elapsed(run,now);run.status=reason;run.endedAt=now;
 for(const task of run.tasks)if(!terminal(task)){const order=run.orders.find(o=>o.id===task.orderId);if(order.status==='reserved'){run.reserved-=order.quantity;order.status='cancelled';}task.status='cancelled';event(run,'cancelled',{task:task.id,reason});}
 event(run,'run_closed',{reason});
}
export function metrics(run) {
 const created=run.orders.length,completed=run.orders.filter(o=>o.status==='fulfilled').length,rejected=run.orders.filter(o=>o.status==='rejected').length;
 const submissions=run.tasks.flatMap(t=>t.attempts),accepted=run.tasks.filter(t=>t.status==='accepted'),durations=accepted.map(t=>t.attempts.at(-1).measurements.duration);
 const revenue=run.transactions.reduce((n,t)=>n+t.revenue,0),expenses=run.transactions.reduce((n,t)=>n+t.expense,0),consumed=run.initial.stock-run.stock;
 return {created,completed,rejected,pending:run.orders.filter(o=>o.status==='reserved').length,cancelled:run.orders.filter(o=>o.status==='cancelled').length,completionRate:created?completed/created:null,completionDenominator:created,
  meanDeliverySeconds:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,costPerCompleted:completed?expenses/completed:null,revenue,expenses,resourcesConsumed:consumed,resourceUtilization:run.initial.stock?consumed/run.initial.stock:null,
  stockouts:run.events.filter(e=>e.type==='stockout').length,submissions:submissions.length,acceptanceRate:submissions.length?accepted.length/submissions.length:null,rejectionRate:submissions.length?submissions.filter(a=>!a.verified).length/submissions.length:null,
  revisionRate:submissions.length?run.events.filter(e=>e.type==='revision_requested').length/submissions.length:null,humanAccepted:accepted.filter(t=>t.worker.kind==='human').length,agentAccepted:accepted.filter(t=>t.worker.kind==='agent').length,
  recognitionUnits:run.contributions.reduce((n,c)=>n+c.recognitionUnits,0),recognitionDistribution:Object.fromEntries([...new Set(run.contributions.map(c=>c.contributor))].map(id=>[id,run.contributions.filter(c=>c.contributor===id).reduce((n,c)=>n+c.recognitionUnits,0)])),durationSeconds:elapsed(run),outcome:run.status};
}
export function assertInvariants(run) {
 const settled=new Set(run.transactions.map(t=>t.order));
 if(run.stock<0||run.reserved<0||run.reserved>run.stock||run.reserved!==run.orders.filter(o=>o.status==='reserved').reduce((n,o)=>n+o.quantity,0))throw Error('Inventory invariant');
 if(Object.values(run.balances).some(v=>!Number.isSafeInteger(v)||v<0)||Object.values(run.balances).reduce((a,b)=>a+b,0)!==2500)throw Error('Closed balance invariant');
 if(settled.size!==run.transactions.length||run.contributions.length!==run.transactions.length||run.tasks.filter(t=>t.status==='accepted').length!==run.transactions.length)throw Error('Settlement invariant');
 if(run.initial.stock-run.stock!==run.transactions.reduce((n,t)=>n+t.resourceConsumed,0)||run.transactions.some(t=>t.entries.reduce((n,e)=>n+e.delta,0)!==0))throw Error('Accounting invariant');
 for(const c of run.contributions){const t=run.tasks.find(t=>t.id===c.task),e=t?.attempts.find(e=>e.id===c.evidence);if(!e?.verified||t.status!=='accepted'||c.digest!==e.digest||c.recognitionUnits!==10)throw Error('Contribution invariant');}
 return true;
}
export function comparePolicies(owner,seed=42,now=Date.now()) {
 const runs=POLICIES.map(p=>{const r=newRun(owner,p.id,seed,now,'experiment');seedOrders(r);for(let i=0;i<SCENARIO.maxOrders;i++)if(!agentStep(r,owner).ok)break;finishRun(r,'completed',now);assertInvariants(r);return r;});
 return {id:randomUUID(),schema:'campos.policy-comparison/1',seed,scenarioVersion:1,initial:structuredClone(runs[0].initial),runIds:runs.map(r=>r.id),runs,assumptions:['Equivalent seeded orders and starting inventory/balances','Server-side route model at 5 m/s; no avatar navigation or traffic','One sequential worker; four authorized actions per delivery','Recognition is local and unfunded'],results:runs.map(r=>({run:r.id,policy:r.policy,metrics:metrics(r)}))};
}
