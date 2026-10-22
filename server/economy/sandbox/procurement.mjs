// Campus Procurement and Small-Business Access (scenario campus-procurement/1). Whole orders are awarded
// in deadline order against a finite budget and finite supplier capacity; every payment is double-entry.
import {SANDBOX_SCENARIOS} from '../../../shared/economic-sandbox.mjs';
import {rng,uniformAt} from './rng.mjs';
import {count,total,ratio,mean,max,check,groupsFor} from './measure.mjs';

const K=SANDBOX_SCENARIOS['campus-procurement@1'].constants,CATEGORIES=K.categories.map(c=>c.id);
const pad=n=>String(n).padStart(2,'0');
const r6=v=>Math.round(v*1e6)/1e6;

export function generate(p,seed) {
 const s=rng(seed,'procurement/suppliers'),o=rng(seed,'procurement/orders');
 const nSmall=Math.round(p.suppliers*p.smallSupplierPct/100),sizes=s.shuffle([...Array(nSmall).fill('small'),...Array(p.suppliers-nSmall).fill('large')]);
 const suppliers=sizes.map((size,i)=>{
  const categories=[CATEGORIES[i%3]];
  if(s.next()<K.secondCategoryChance)categories.push(CATEGORIES[(i+1+s.int(0,1))%3]);
  const prices={},costs={};
  for(const c of K.categories){const price=Math.max(1,Math.round(c.basePrice*(size==='small'?1+p.smallPricePremiumPct/100:1)*(.9+.2*s.next())));prices[c.id]=price;costs[c.id]=Math.max(1,Math.round(price*(.7+.15*s.next())));}
  const [lo,hi]=K.leadTimes[size],mean_=size==='small'?p.smallReliabilityPct:p.largeReliabilityPct;
  return {id:`S${pad(i+1)}`,size,categories:categories.filter(c=>Object.hasOwn(prices,c)),prices:Object.fromEntries(categories.map(c=>[c,prices[c]])),unitCosts:Object.fromEntries(categories.map(c=>[c,costs[c]])),
   capacity:size==='small'?p.smallCapacity:p.largeCapacity,leadTime:s.int(lo,hi),reliability:Math.min(99,Math.max(50,mean_+s.int(-5,5)))/100};
 });
 const orders=Array.from({length:p.orders},(_,i)=>({id:`P${pad(i+1)}`,category:o.pick(CATEGORIES),quantity:o.int(5,p.maxQuantity),deadline:o.int(3,Math.max(3,p.deadlineDays))}));
 return {seed,budget:p.budget,suppliers,orders};
}
const sequence=orders=>[...orders].sort((a,b)=>a.deadline-b.deadline||a.id.localeCompare(b.id));
const byPriceThen=(c)=>(a,b)=>a.prices[c]-b.prices[c]||b.reliability-a.reliability||a.id.localeCompare(b.id);
/** Feasibility filters in a fixed order; the first empty stage names the reason an order is unfulfilled. */
function feasible(state,suppliers,order) {
 const serving=suppliers.filter(s=>s.categories.includes(order.category));
 if(!serving.length)return {reason:'no-supplier',list:[]};
 const timely=serving.filter(s=>s.leadTime<=order.deadline);if(!timely.length)return {reason:'lead-time',list:[]};
 const cap=timely.filter(s=>state.capacity[s.id]>=order.quantity);if(!cap.length)return {reason:'capacity',list:[]};
 const afford=cap.filter(s=>s.prices[order.category]*order.quantity<=state.budget);if(!afford.length)return {reason:'budget',list:[]};
 return {reason:null,list:afford};
}
/** Each policy's declared choice among feasible suppliers, with the facts the choice used. */
function choose(policy,list,order,state) {
 const c=order.category,q=policy.params;
 if(policy.id==='lowest-price')return {supplier:[...list].sort(byPriceThen(c))[0],basis:'lowest quoted price'};
 if(policy.id==='best-value') {
  const w=q.priceWeightPct/100,low=Math.min(...list.map(s=>s.prices[c])),score=s=>r6(w*low/s.prices[c]+(1-w)*s.reliability);
  const pick=[...list].sort((a,b)=>score(b)-score(a)||a.prices[c]-b.prices[c]||a.id.localeCompare(b.id))[0];
  return {supplier:pick,basis:`best-value score ${score(pick)}`};
 }
 if(policy.id==='small-business-access') {
  const share=state.awarded?state.smallAwarded/state.awarded:0,small=list.filter(s=>s.size==='small');
  if(share<q.reservedSharePct/100&&small.length)return {supplier:[...small].sort(byPriceThen(c))[0],basis:`reserved share (small share so far ${(share*100).toFixed(1)}%)`};
  const evaluated=s=>s.prices[c]*(s.size==='small'?1-q.preferencePct/100:1);
  return {supplier:[...list].sort((a,b)=>evaluated(a)-evaluated(b)||b.reliability-a.reliability||a.id.localeCompare(b.id))[0],basis:'lowest evaluated price with small-business preference'};
 }
 throw Error(`Unknown procurement policy ${policy.id}`);
}

export function execute(initial,p,policy) {
 const state={budget:initial.budget,capacity:Object.fromEntries(initial.suppliers.map(s=>[s.id,s.capacity])),awarded:0,smallAwarded:0};
 const awards=[],unfulfilled=[],ledger=[];
 for(const order of sequence(initial.orders)) {
  const f=feasible(state,initial.suppliers,order);
  if(f.reason){unfulfilled.push({order:order.id,reason:f.reason});continue;}
  const {supplier:s,basis}=choose(policy,f.list,order,state),price=s.prices[order.category],value=price*order.quantity,cost=s.unitCosts[order.category]*order.quantity;
  state.budget-=value;state.capacity[s.id]-=order.quantity;state.awarded+=value;if(s.size==='small')state.smallAwarded+=value;
  // One draw per (order, supplier) pair: two policies choosing the same supplier see the same delivery outcome.
  const onTime=uniformAt(initial.seed,order.id,s.id,'on-time')<s.reliability,delayDays=onTime?0:1+Math.floor(uniformAt(initial.seed,order.id,s.id,'delay')*4);
  awards.push({order:order.id,supplier:s.id,size:s.size,category:order.category,quantity:order.quantity,price,value,cost,onTime,delayDays,deliveredDay:onTime?s.leadTime:order.deadline+delayDays,feasible:f.list.map(x=>x.id),basis});
  // Paid once on delivery; the supplier then pays its modeled unit cost to external inputs.
  ledger.push({id:`${order.id}:payment`,order:order.id,from:'buyer',to:`supplier:${s.id}`,amount:value},{id:`${order.id}:inputs`,order:order.id,from:`supplier:${s.id}`,to:'external-inputs',amount:cost});
 }
 return {awards,unfulfilled,ledger};
}

export function invariants(initial,p,policy,outcome) {
 const sup=new Map(initial.suppliers.map(s=>[s.id,s])),ord=new Map(initial.orders.map(o=>[o.id,o]));
 const balances={buyer:initial.budget,'external-inputs':0,...Object.fromEntries(initial.suppliers.map(s=>[`supplier:${s.id}`,0]))};
 let ledgerOk=true;for(const t of outcome.ledger){if(!(t.from in balances)||!(t.to in balances)||!Number.isSafeInteger(t.amount)||t.amount<0)ledgerOk=false;else{balances[t.from]-=t.amount;balances[t.to]+=t.amount;}}
 const used={};for(const a of outcome.awards)used[a.supplier]=(used[a.supplier]??0)+a.quantity;
 // Replay the award sequence to confirm each recorded reason and choice against the declared rules.
 const state={budget:initial.budget,capacity:Object.fromEntries(initial.suppliers.map(s=>[s.id,s.capacity])),awarded:0,smallAwarded:0},problems=[];let cumulative=0,peak=0;
 for(const order of sequence(initial.orders)) {
  const f=feasible(state,initial.suppliers,order),a=outcome.awards.find(x=>x.order===order.id),u=outcome.unfulfilled.find(x=>x.order===order.id);
  if(f.reason){if(!u||u.reason!==f.reason||a)problems.push(`${order.id}: expected ${f.reason}`);continue;}
  if(!a||u){problems.push(`${order.id}: feasible order not awarded`);continue;}
  const expected=choose(policy,f.list,order,state).supplier;if(expected.id!==a.supplier)problems.push(`${order.id}: rule selects ${expected.id}, recorded ${a.supplier}`);
  const s=sup.get(a.supplier);state.budget-=a.value;state.capacity[s.id]-=a.quantity;state.awarded+=a.value;if(s.size==='small')state.smallAwarded+=a.value;cumulative+=a.value;peak=Math.max(peak,cumulative);
 }
 const payments=outcome.ledger.filter(t=>t.from==='buyer');
 return [
  check('budget-never-exceeded',peak<=initial.budget&&outcome.awards.reduce((n,a)=>n+a.value,0)<=initial.budget,'Awards exceed the budget.'),
  check('capacity-never-exceeded',Object.entries(used).every(([id,q])=>q<=sup.get(id).capacity),'A supplier was awarded more than its capacity.'),
  check('single-settlement',new Set(outcome.awards.map(a=>a.order)).size===outcome.awards.length&&new Set(payments.map(t=>t.order)).size===payments.length&&payments.length===outcome.awards.length,'An order was awarded or paid more than once.'),
  check('every-order-accounted',outcome.awards.length+outcome.unfulfilled.length===initial.orders.length&&initial.orders.every(o=>outcome.awards.some(a=>a.order===o.id)!==outcome.unfulfilled.some(u=>u.order===o.id)),'Orders are missing or double-counted.'),
  check('feasible-awards',outcome.awards.every(a=>{const s=sup.get(a.supplier),o=ord.get(a.order);return s&&o&&s.categories.includes(o.category)&&s.leadTime<=o.deadline&&a.quantity===o.quantity;}),'An award breaks category, lead-time or quantity rules.'),
  check('payment-equals-quote',outcome.awards.every(a=>{const s=sup.get(a.supplier);return a.price===s.prices[a.category]&&a.value===a.price*a.quantity&&a.cost===s.unitCosts[a.category]*a.quantity&&payments.some(t=>t.order===a.order&&t.amount===a.value&&t.to===`supplier:${a.supplier}`);}),'A payment differs from the quoted price.'),
  check('balanced-ledger',ledgerOk&&Object.values(balances).every(v=>v>=0)&&Object.values(balances).reduce((x,y)=>x+y,0)===initial.budget,'The ledger is unbalanced or a balance is negative.'),
  check('declared-rule-and-reasons',!problems.length,problems.slice(0,3).join('; ')),
 ];
}

export function measure(scenario,initial,p,policy,outcome) {
 const A=outcome.awards,spend=A.reduce((n,a)=>n+a.value,0),cost=A.reduce((n,a)=>n+a.cost,0),units=A.reduce((n,a)=>n+a.quantity,0),capacity=initial.suppliers.reduce((n,s)=>n+s.capacity,0);
 const bySupplier=Object.fromEntries(initial.suppliers.map(s=>[s.id,A.filter(a=>a.supplier===s.id)])),valueOf=id=>bySupplier[id].reduce((n,a)=>n+a.value,0);
 const reason=k=>outcome.unfulfilled.filter(u=>u.reason===k).length;
 const metrics={
  orders:count(initial.orders.length),fulfilled:count(A.length),unfulfilled:count(outcome.unfulfilled.length),completionRate:ratio(A.length,initial.orders.length),
  onTimeRate:ratio(A.filter(a=>a.onTime).length,A.length),meanDelayDays:mean(A.map(a=>a.delayDays)),
  unfulfilledNoSupplier:count(reason('no-supplier')),unfulfilledLeadTime:count(reason('lead-time')),unfulfilledCapacity:count(reason('capacity')),unfulfilledBudget:count(reason('budget')),
  totalSpend:total(spend),budgetUtilization:ratio(spend,initial.budget),costPerFulfilled:ratio(spend,A.length),meanUnitPrice:ratio(spend,units),
  supplierRevenue:total(spend),supplierCost:total(cost),supplierProfit:total(spend-cost),
  smallBusinessShare:ratio(A.filter(a=>a.size==='small').reduce((n,a)=>n+a.value,0),spend),
  hhi:{value:spend?Math.round(initial.suppliers.reduce((n,s)=>n+(valueOf(s.id)/spend*100)**2,0)*100)/100:null,denominator:spend},
  suppliersAwarded:count(initial.suppliers.filter(s=>bySupplier[s.id].length).length),capacityUtilization:ratio(units,capacity),
  maxSupplierUtilization:max(initial.suppliers.map(s=>bySupplier[s.id].reduce((n,a)=>n+a.quantity,0)/s.capacity)),
 };
 const groups=groupsFor(scenario,(dim,g)=>dim==='supplierSize'?initial.suppliers.filter(s=>s.size===g):initial.orders.filter(o=>o.category===g),(g,grp,m)=>{
  if(g.id==='supplierSize') {
   const won=A.filter(a=>a.size===grp.id),value=won.reduce((n,a)=>n+a.value,0),c=won.reduce((n,a)=>n+a.cost,0);
   return {suppliers:count(m.length),ordersWon:count(won.length),awardedValue:total(value),shareOfValue:ratio(value,spend),revenue:total(value),operatingCost:total(c),profit:total(value-c),capacityUtilization:ratio(won.reduce((n,a)=>n+a.quantity,0),m.reduce((n,s)=>n+s.capacity,0))};
  }
  const done=A.filter(a=>a.category===grp.id),value=done.reduce((n,a)=>n+a.value,0);
  return {orders:count(m.length),fulfilled:count(done.length),completionRate:ratio(done.length,m.length),onTimeRate:ratio(done.filter(a=>a.onTime).length,done.length),meanDelayDays:mean(done.map(a=>a.delayDays)),spend:total(value),costPerFulfilled:ratio(value,done.length)};
 });
 return {metrics,groups};
}
