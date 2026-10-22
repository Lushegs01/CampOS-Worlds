// Campus Logistics (scenario campus-logistics/2). Reuses the live lab's order, reservation, delivery/1
// verifier and balanced settlement code; adds seeded batch demand, declared service classes and 1–4
// server-modeled couriers dispatched in modeled-time order.
import {newRun,createOrder,assign,pickup,deliver,submit,finishRun,assertInvariants,rankTasks,routeFor} from '../model.mjs';
import {rng} from './rng.mjs';
import {count,total,ratio,mean,max,range,check,groupsFor} from './measure.mjs';

const RECEIVERS=['commons','student','welcome','courts'];
const short=id=>id.slice(id.lastIndexOf(':')+1);

export function generate(p,seed) {
 const r=rng(seed,'logistics/requests');
 // Three draws per request whatever the parameters, so sweeps keep the same receivers and sizes.
 const requests=Array.from({length:p.orders},(_,i)=>{const receiver=r.pick(RECEIVERS),quantity=1+Math.floor(r.next()*p.maxPacks),priority=r.next()<p.prioritySharePct/100;return [`q${i+1}`,receiver,quantity,priority?'priority':'standard'];});
 return {stock:p.stock,balances:{business:p.businessBalance,customers:p.customerBudget,logistics:0},couriers:Array.from({length:p.couriers},(_,i)=>`courier-${i+1}`),requestColumns:['id','receiver','quantity','serviceClass'],requests};
}

export function execute(initial,p,policy,{id,seed}) {
 const config={scenarioVersion:2,stock:initial.stock,price:p.price,maxOrders:p.orders,deadlineSeconds:p.standardDeadline,priorityDeadline:p.priorityDeadline,initialBalances:initial.balances,speed:p.speed,priorityBonusSeconds:policy.params.priorityBonusSeconds??0};
 const run=newRun('sandbox',policy.id,seed,0,'experiment',{id,config}),requestOf=new Map(),refused=[];
 for(const [rid,receiver,quantity,serviceClass] of initial.requests) {
  const r=createOrder(run,{destination:receiver,quantity,priority:serviceClass==='priority'},0);
  if(r.ok)requestOf.set(r.order,rid);else refused.push({request:rid,receiver,serviceClass,quantity,reason:/stock/.test(r.reason)?'stockout':'refused'});
 }
 const couriers=initial.couriers.map(cid=>({id:cid,free:0,task:null,busy:0,distance:0,deliveries:0})),dispatch=[];
 // Discrete events in modeled-time order: a courier finishing at t submits, then takes its next task at t.
 for(let guard=0;guard<10000;guard++) {
  const c=couriers.filter(c=>c.free!==null).sort((a,b)=>a.free-b.free||a.id.localeCompare(b.id))[0];
  if(!c)break;
  const t=c.free;run.virtualSeconds=Math.max(run.virtualSeconds,t);
  if(c.task){const task=c.task;deliver(run,task);if(submit(run,task,{kind:'modeled-logistics',courier:c.id},t*1000).ok)c.deliveries++;c.task=null;}
  const available=run.tasks.filter(x=>x.status==='available'),pick=rankTasks(run,available).find(x=>t+x.duration<=x.task.constraints.deadline);
  if(!pick){c.free=null;continue;}
  const order=run.orders.find(o=>o.id===pick.task.orderId),route=routeFor(run,order);
  assign(run,pick.task,{id:c.id,kind:'agent',principal:run.owner},run.owner);pickup(run,pick.task);
  dispatch.push({at:t,courier:c.id,order:short(order.id),candidates:available.length,feasible:available.filter(x=>t+routeFor(run,run.orders.find(o=>o.id===x.orderId)).duration<=x.constraints.deadline).length,duration:pick.duration});
  c.task=pick.task;c.free=t+pick.duration;c.busy+=pick.duration;c.distance+=route.distance;
 }
 finishRun(run,'completed',run.virtualSeconds*1000);
 let modelCheck=null;try{assertInvariants(run);}catch(e){modelCheck=e.message;}
 const orders=run.orders.map(o=>{
  const t=run.tasks.find(t=>t.id===o.taskId),last=t.attempts.at(-1),delivered=run.events.find(e=>e.type==='delivered'&&e.task===t.id&&o.status==='fulfilled');
  return {id:short(o.id),request:requestOf.get(o.id),receiver:o.destination,serviceClass:o.serviceClass,quantity:o.quantity,status:o.status==='fulfilled'?'fulfilled':t.attempts.length?'failed-verification':'unserved',
   deadline:o.deadline,deliveredTime:delivered?.time??null,courier:t.worker?.id??null,routeDistance:last?.measurements.routeDistance??null,expense:o.status==='fulfilled'?last.measurements.cost:0,revenue:o.status==='fulfilled'?o.quantity*o.unitPrice:0,
   evidence:last?{id:last.id.split(':').slice(-2).join(':'),digest:last.digest,verified:last.verified,reasons:last.reasons}:null};
 });
 return {orders,refused,dispatch,couriers:couriers.map(c=>({id:c.id,deliveries:c.deliveries,busySeconds:c.busy,distance:c.distance})),
  final:{stock:run.stock,reserved:run.reserved,balances:{...run.balances},settlements:run.transactions.map(x=>({order:short(x.order),revenue:x.revenue,expense:x.expense,packs:x.resourceConsumed})),contributions:run.contributions.length},
  modelChecks:[{rule:'delivery/1 inventory, closed-balance, settlement, accounting and contribution invariants',pass:!modelCheck,...(modelCheck?{detail:modelCheck}:{})}]};
}

export function invariants(initial,p,policy,outcome) {
 const O=outcome.orders,done=O.filter(o=>o.status==='fulfilled'),f=outcome.final,start=Object.values(initial.balances).reduce((a,b)=>a+b,0);
 const revenue=done.reduce((n,o)=>n+o.revenue,0),expense=done.reduce((n,o)=>n+o.expense,0),packs=done.reduce((n,o)=>n+o.quantity,0);
 const overlaps=outcome.couriers.some(c=>{const xs=outcome.dispatch.filter(d=>d.courier===c.id).sort((a,b)=>a.at-b.at);return xs.some((d,i)=>i&&xs[i-1].at+xs[i-1].duration>d.at+1e-9);});
 return [
  ...outcome.modelChecks.map(c=>check(c.rule,c.pass,c.detail)),
  check('requests-accounted',O.length+outcome.refused.length===initial.requests.length&&new Set([...O.map(o=>o.request),...outcome.refused.map(r=>r.request)]).size===initial.requests.length,'Requests are missing or duplicated.'),
  check('reservations-within-stock',O.reduce((n,o)=>n+o.quantity,0)<=initial.stock,'Created orders reserved more packs than existed.'),
  check('stock-never-negative',f.stock>=0&&f.reserved===0&&initial.stock-f.stock===packs,'Stock, reservations or consumption do not reconcile.'),
  check('single-settlement',new Set(f.settlements.map(s=>s.order)).size===f.settlements.length&&f.settlements.length===done.length&&f.contributions===done.length,'An order was settled or recognised more than once.'),
  check('closed-balances',Object.values(f.balances).every(v=>Number.isSafeInteger(v)&&v>=0)&&Object.values(f.balances).reduce((a,b)=>a+b,0)===start&&f.balances.customers===initial.balances.customers-revenue&&f.balances.logistics===initial.balances.logistics+expense,'Balances do not reconcile with settlements.'),
  check('verified-before-settlement',done.every(o=>o.evidence?.verified===true&&/^[a-f0-9]{64}$/.test(o.evidence.digest)),'A settled order lacks verified evidence.'),
  check('deadline-respected',done.every(o=>o.deliveredTime!==null&&o.deliveredTime<=o.deadline+1e-9),'A delivery was settled after its deadline.'),
  check('feasible-dispatch',outcome.dispatch.every(d=>{const o=O.find(o=>o.id===d.order);return o&&d.at+d.duration<=o.deadline+1e-9;}),'A courier was dispatched to a task it could not finish in time.'),
  check('one-task-per-courier',!overlaps,'A courier was assigned overlapping tasks.'),
 ];
}

export function measure(scenario,initial,p,policy,outcome) {
 const reqs=initial.requests.map(([id,receiver,quantity,serviceClass])=>({id,receiver,quantity,serviceClass,order:outcome.orders.find(o=>o.request===id)??null}));
 const done=reqs.filter(r=>r.order?.status==='fulfilled'),O=outcome.orders,time=r=>r.order.deliveredTime;
 const expense=done.reduce((n,r)=>n+r.order.expense,0),revenue=done.reduce((n,r)=>n+r.order.revenue,0),makespan=done.length?Math.max(...done.map(time)):0;
 const groupRate=g=>{const m=reqs.filter(r=>r.receiver===g);return m.length?done.filter(r=>r.receiver===g).length/m.length:null;};
 const priority=reqs.filter(r=>r.serviceClass==='priority'),busy=outcome.couriers.reduce((n,c)=>n+c.busySeconds,0);
 const metrics={
  requested:count(reqs.length),created:count(O.length),completed:count(done.length),serviceRate:ratio(done.length,reqs.length),completionRate:ratio(done.length,O.length),
  priorityServiceRate:ratio(done.filter(r=>r.serviceClass==='priority').length,priority.length),stockouts:count(outcome.refused.filter(r=>r.reason==='stockout').length),
  cancelled:count(O.filter(o=>o.status==='unserved').length),rejected:count(O.filter(o=>o.status==='failed-verification').length),unmetDemand:count(reqs.length-done.length),
  meanFulfillmentSeconds:mean(done.map(time)),maxFulfillmentSeconds:max(done.map(time)),revenue:total(revenue),expenses:total(expense),costPerCompleted:ratio(expense,done.length),
  resourceUtilization:ratio(initial.stock-outcome.final.stock,initial.stock),serviceRateGap:range(RECEIVERS.map(groupRate).filter(v=>v!==null)),
  workloadMaxShare:ratio(Math.max(0,...outcome.couriers.map(c=>c.deliveries)),done.length),courierUtilization:ratio(busy,outcome.couriers.length*makespan),makespanSeconds:total(makespan),
 };
 const groups=groupsFor(scenario,(dim,g)=>reqs.filter(r=>r[dim==='receiver'?'receiver':'serviceClass']===g),(g,grp,m)=>{
  const d=m.filter(r=>r.order?.status==='fulfilled'),e=d.reduce((n,r)=>n+r.order.expense,0);
  return {requested:count(m.length),completed:count(d.length),serviceRate:ratio(d.length,m.length),meanFulfillmentSeconds:mean(d.map(time)),unmetDemand:count(m.length-d.length),
   shareOfDemand:ratio(m.length,reqs.length),shareOfCompleted:ratio(d.length,done.length),costPerCompleted:ratio(e,d.length)};
 });
 return {metrics,groups};
}
