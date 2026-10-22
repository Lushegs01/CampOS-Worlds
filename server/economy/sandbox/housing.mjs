// Affordable Housing Allocation (scenario housing-allocation/1). One allocation round over a synthetic
// stock and applicant list; each policy is a declared ordering, eligibility and pricing rule.
import {SANDBOX_SCENARIOS} from '../../../shared/economic-sandbox.mjs';
import {rng} from './rng.mjs';
import {count,total,ratio,mean,range,check,groupsFor} from './measure.mjs';

const K=SANDBOX_SCENARIOS['housing-allocation@1'].constants;
const APPLICANT_COLUMNS=['id','group','income','budget','size','bedrooms','accessibility','insecure','need','queue'];
const UNIT_COLUMNS=['id','bedrooms','accessible','reference','reserve'];
const pad=(n,w=3)=>String(n).padStart(w,'0');

export function generate(p,seed) {
 const people=rng(seed,'housing/applicants'),order=rng(seed,'housing/queue'),stock=rng(seed,'housing/units');
 const nLow=Math.round(p.applicants*p.lowIncomeSharePct/100),nHigh=Math.min(p.applicants-nLow,Math.round(p.applicants*p.highIncomeSharePct/100));
 const groups=people.shuffle([...Array(nLow).fill('low'),...Array(nHigh).fill('high'),...Array(p.applicants-nLow-nHigh).fill('middle')]);
 const queue=order.shuffle(groups.map((_,i)=>i));
 const applicants=groups.map((group,i)=>{
  const [lo,hi]=K.incomeBands[group],income=Math.round((lo+people.next()*(hi-lo))/10)*10,size=people.weighted(K.householdSizes);
  const accessibility=people.next()<K.accessibilityNeed?1:0,insecure=people.next()<K.insecurity[group]?1:0;
  return [`A${pad(i+1)}`,group,income,Math.floor(income*p.budgetSharePct/100),size,size<=2?1:size===3?2:3,accessibility,insecure,4*insecure+3*accessibility+Math.min(3,size-1),queue.indexOf(i)+1];
 });
 const family=Math.round(p.units*p.familyUnitPct/100),three=Math.round(family/4),access=Math.round(p.units*p.accessibleUnitPct/100);
 const bedrooms=stock.shuffle([...Array(p.units-family).fill(1),...Array(family-three).fill(2),...Array(three).fill(3)]);
 const accessible=new Set(stock.shuffle(bedrooms.map((_,i)=>i)).slice(0,access));
 const units=bedrooms.map((b,i)=>{const reference=Math.round(p.baseRent*[1,1.5,2][b-1]*(.85+.3*stock.next())/10)*10;return [`U${pad(i+1)}`,b,accessible.has(i)?1:0,reference,Math.round(reference*p.reserveSharePct/100)];});
 return {applicantColumns:APPLICANT_COLUMNS,applicants,unitColumns:UNIT_COLUMNS,units};
}
const rows=(columns,list)=>list.map(r=>Object.fromEntries(columns.map((c,i)=>[c,r[i]])));
export const expand=initial=>({applicants:rows(initial.applicantColumns,initial.applicants),units:rows(initial.unitColumns,initial.units)});

const suitable=(a,u)=>u.bedrooms>=a.bedrooms&&(!a.accessibility||u.accessible===1);
const round6=v=>Math.round(v*1e6)/1e6;
/** The declared rule of each policy, as pure functions over one applicant and unit. */
function rules(policy) {
 const q=policy.params;
 if(policy.id==='highest-bid')return {
  maxBid:a=>Math.floor(a.budget*q.bidSharePct/100),
  rent:(a,u)=>Math.min(Math.floor(a.budget*q.bidSharePct/100),Math.round(u.reference*(1+q.premiumCapPct/100))),
  acceptable:(a,u,rent)=>rent>=u.reserve&&rent<=a.budget,eligible:()=>true,offered:()=>true,
  priority:a=>Math.floor(a.budget*q.bidSharePct/100),priorityMeaning:'maximum bid (higher first)',
  sort:(x,y)=>y.priority-x.priority||x.queue-y.queue||x.id.localeCompare(y.id)};
 if(policy.id==='capped-rent')return {
  rent:(a,u)=>Math.min(u.reference,q.rentCap),acceptable:(a,u,rent)=>rent<=a.budget,eligible:()=>true,
  offered:u=>!(q.withdrawBelowCost&&u.reserve>q.rentCap),priority:a=>a.queue,priorityMeaning:'application position (earlier first)',
  sort:(x,y)=>x.queue-y.queue};
 if(policy.id==='needs-weighted') {
  const w=q.needWeightPct/100,[lo]=K.incomeBands.low,hi=K.incomeBands.high[1];
  return {rent:(a,u)=>Math.min(u.reference,Math.ceil(a.income*q.incomeSharePct/100/10)*10),acceptable:(a,u,rent)=>rent<=a.budget,
   eligible:a=>a.income<=q.incomeCeiling,offered:()=>true,
   priority:a=>round6(w*a.need/10+(1-w)*Math.min(1,Math.max(0,1-(a.income-lo)/(hi-lo)))),priorityMeaning:'need-weighted priority score (higher first)',
   sort:(x,y)=>y.priority-x.priority||x.queue-y.queue||x.id.localeCompare(y.id)};
 }
 throw Error(`Unknown housing policy ${policy.id}`);
}
// Fewest surplus bedrooms, then the lowest rent under this policy, then the lowest unit ID (same for every policy).
const fit=(a,rent)=>(u,v)=>(u.bedrooms-a.bedrooms)-(v.bedrooms-a.bedrooms)||rent(a,u)-rent(a,v)||u.id.localeCompare(v.id);

export function execute(initial,p,policy) {
 const {applicants,units}=expand(initial),R=rules(policy),offered=units.filter(R.offered),taken=new Set();
 const order=applicants.map(a=>({...a,priority:R.priority(a)})).sort(R.sort),result=new Map();
 order.forEach((a,i)=>{
  const rank=i+1;
  if(!R.eligible(a)){result.set(a.id,[a.id,null,null,'ineligible',rank,a.priority]);return;}
  const all=offered.filter(u=>suitable(a,u));
  if(!all.length){result.set(a.id,[a.id,null,null,'no-suitable-unit',rank,a.priority]);return;}
  const free=all.filter(u=>!taken.has(u.id));
  if(!free.length){result.set(a.id,[a.id,null,null,'capacity',rank,a.priority]);return;}
  const ok=free.filter(u=>R.acceptable(a,u,R.rent(a,u)));
  if(!ok.length){result.set(a.id,[a.id,null,null,'unaffordable',rank,a.priority]);return;}
  const u=ok.sort(fit(a,R.rent))[0];taken.add(u.id);result.set(a.id,[a.id,u.id,R.rent(a,u),null,rank,a.priority]);
 });
 return {columns:['applicant','unit','rent','reason','rank','priority'],priorityMeaning:R.priorityMeaning,allocations:applicants.map(a=>result.get(a.id)),withdrawn:units.filter(u=>!R.offered(u)).map(u=>u.id)};
}
const outcomes=outcome=>outcome.allocations.map(r=>Object.fromEntries(outcome.columns.map((c,i)=>[c,r[i]])));

/** Independent checks that the recorded allocation obeys supply limits and the policy's own declared rules. */
export function invariants(initial,p,policy,outcome) {
 const {applicants,units}=expand(initial),R=rules(policy),byA=new Map(applicants.map(a=>[a.id,a])),byU=new Map(units.map(u=>[u.id,u]));
 const rows_=outcomes(outcome),housed=rows_.filter(r=>r.unit),unitIds=housed.map(r=>r.unit),offered=units.filter(R.offered);
 const offeredIds=new Set(offered.map(u=>u.id)),vacant=offered.filter(u=>!unitIds.includes(u.id));
 const blocking=[];
 for(const b of rows_.filter(r=>!r.unit&&r.reason!=='ineligible')) {
  const B=byA.get(b.applicant);
  for(const h of housed)if(h.rank>b.rank){const u=byU.get(h.unit);if(suitable(B,u)&&R.acceptable(B,u,R.rent(B,u)))blocking.push(`${b.applicant} before ${h.applicant} (${u.id})`);}
 }
 return [
  check('every-applicant-recorded-once',rows_.length===applicants.length&&new Set(rows_.map(r=>r.applicant)).size===applicants.length,'Outcome rows do not match applicants.'),
  check('one-unit-per-applicant',new Set(unitIds).size===unitIds.length,'A unit was allocated more than once.'),
  check('allocations-within-supply',housed.length<=offered.length&&offered.length<=units.length,`${housed.length} allocations for ${offered.length} offered units.`),
  check('only-offered-units',unitIds.every(id=>offeredIds.has(id)),'A withdrawn or unknown unit was allocated.'),
  check('withdrawal-rule',outcome.withdrawn.length===units.length-offered.length&&outcome.withdrawn.every(id=>!offeredIds.has(id)),'Withdrawn units do not match the policy rule.'),
  check('unit-suitability',housed.every(r=>suitable(byA.get(r.applicant),byU.get(r.unit))),'An allocation lacks the bedrooms or accessibility required.'),
  check('eligibility-rule',housed.every(r=>R.eligible(byA.get(r.applicant)))&&rows_.filter(r=>r.reason==='ineligible').every(r=>!R.eligible(byA.get(r.applicant))),'Eligibility was applied inconsistently.'),
  check('pricing-rule',housed.every(r=>{const a=byA.get(r.applicant),u=byU.get(r.unit);return r.rent===R.rent(a,u)&&R.acceptable(a,u,r.rent)&&r.rent<=a.budget;}),'A rent differs from the policy formula or exceeds ability to pay.'),
  check('priority-order-respected',!blocking.length,blocking.slice(0,3).join('; ')),
  check('no-usable-unit-left-vacant',rows_.filter(r=>!r.unit&&r.reason!=='ineligible').every(r=>{const a=byA.get(r.applicant);return !vacant.some(u=>suitable(a,u)&&R.acceptable(a,u,R.rent(a,u)));}),'An excluded applicant could have used a vacant unit.'),
  check('reasons-consistent',rows_.every(r=>r.unit?r.reason===null&&Number.isSafeInteger(r.rent):['ineligible','no-suitable-unit','capacity','unaffordable'].includes(r.reason)&&r.rent===null),'Outcome reasons are inconsistent.'),
 ];
}

export function measure(scenario,initial,p,policy,outcome) {
 const {applicants,units}=expand(initial),byA=new Map(applicants.map(a=>[a.id,a])),byU=new Map(units.map(u=>[u.id,u]));
 const rs=outcomes(outcome).map(r=>({...r,a:byA.get(r.applicant)})),housed=rs.filter(r=>r.unit),burden=r=>r.rent/r.a.income;
 const reason=k=>rs.filter(r=>r.reason===k).length,highNeed=rs.filter(r=>r.a.need>=K.highNeedThreshold);
 const groupRate=g=>{const m=rs.filter(r=>r.a.group===g);return m.length?housed.filter(r=>r.a.group===g).length/m.length:null;};
 const offered=units.length-outcome.withdrawn.length,reference=housed.reduce((s,r)=>s+byU.get(r.unit).reference,0),rent=housed.reduce((s,r)=>s+r.rent,0);
 const metrics={
  applicants:count(rs.length),unitsTotal:count(units.length),unitsOffered:count(offered),unitsAllocated:count(housed.length),housed:count(housed.length),unserved:count(rs.length-housed.length),
  housingRate:ratio(housed.length,rs.length),allocationRate:ratio(housed.length,units.length),
  excludedIneligible:count(reason('ineligible')),excludedNoSuitableUnit:count(reason('no-suitable-unit')),excludedCapacity:count(reason('capacity')),excludedUnaffordable:count(reason('unaffordable')),
  totalRent:total(rent),meanRent:mean(housed.map(r=>r.rent)),meanBurden:mean(housed.map(burden)),costBurdenedShare:ratio(housed.filter(r=>burden(r)>K.costBurdenThreshold).length,housed.length),
  rentToReference:ratio(rent,reference),providerShortfall:total(housed.reduce((s,r)=>s+Math.max(0,byU.get(r.unit).reserve-r.rent),0)),
  highNeedHousingRate:ratio(highNeed.filter(r=>r.unit).length,highNeed.length),
  housingRateGap:range(['low','middle','high'].map(groupRate).filter(v=>v!==null)),
  meanQueuePositionHoused:mean(housed.map(r=>r.a.queue)),
 };
 const memberOf={incomeGroup:(a,g)=>a.group===g,needLevel:(a,g)=>(a.need>=K.highNeedThreshold)===(g==='high'),household:(a,g)=>(a.size>=3)===(g==='family')};
 const groups=groupsFor(scenario,(dim,g)=>rs.filter(r=>memberOf[dim](r.a,g)),(g,grp,m)=>{
  const h=m.filter(r=>r.unit),shareA=rs.length?m.length/rs.length:null,shareH=housed.length?h.length/housed.length:null;
  return {applicants:count(m.length),housed:count(h.length),housingRate:ratio(h.length,m.length),meanRent:mean(h.map(r=>r.rent)),meanBurden:mean(h.map(burden)),
   shareOfApplicants:ratio(m.length,rs.length),shareOfHoused:ratio(h.length,housed.length),
   representation:{value:shareA&&shareH!==null?Math.round(shareH/shareA*1e6)/1e6:null,numerator:shareH,denominator:shareA},
   excludedUnaffordable:count(m.filter(r=>r.reason==='unaffordable').length),excludedCapacity:count(m.filter(r=>r.reason==='capacity').length),excludedOther:count(m.filter(r=>r.reason==='ineligible'||r.reason==='no-suitable-unit').length)};
 });
 return {metrics,groups};
}
