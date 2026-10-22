// Pure analysis of recorded sandbox runs. The server stores the output of analyse() with each experiment;
// the workstation reuses weightedRanking() for exploratory re-weighting, clearly labelled as not saved.
import {metricDef,policyLabel} from './economic-sandbox.mjs';

const EPS=1e-9;
export const round6=v=>v===null||v===undefined?null:Math.round(v*1e6)/1e6;
/** Mean, range and sample standard deviation across replications. Nulls are counted as missing, never as zero. */
export function summarize(values) {
 const xs=values.filter(v=>typeof v==='number'&&Number.isFinite(v)),n=xs.length;
 if(!n)return {n:0,missing:values.length,mean:null,min:null,max:null,sd:null};
 const mean=xs.reduce((a,b)=>a+b,0)/n,sd=n>1?Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(n-1)):null;
 return {n,missing:values.length-n,mean:round6(mean),min:round6(Math.min(...xs)),max:round6(Math.max(...xs)),sd:round6(sd)};
}
const better=(direction,a,b)=>direction==='higher'?a>b+EPS:direction==='lower'?a<b-EPS:false;
/** Seed-by-seed comparison of an alternative with the baseline (common random numbers: same seeds, same starts). */
export function paired(direction,base,alt) {
 const pairs=base.map((b,i)=>[b,alt[i]]).filter(([b,a])=>typeof b==='number'&&typeof a==='number');
 if(!pairs.length)return {n:0,meanDiff:null,minDiff:null,maxDiff:null,relative:null,relativeNote:'No seed has both values.',better:0,worse:0,equal:0,higher:0,lower:0};
 const diffs=pairs.map(([b,a])=>a-b),meanBase=pairs.reduce((s,[b])=>s+b,0)/pairs.length,meanDiff=diffs.reduce((a,b)=>a+b,0)/diffs.length;
 const count=f=>pairs.filter(f).length;
 return {n:pairs.length,meanDiff:round6(meanDiff),minDiff:round6(Math.min(...diffs)),maxDiff:round6(Math.max(...diffs)),
  relative:Math.abs(meanBase)>EPS?round6(meanDiff/Math.abs(meanBase)):null,relativeNote:Math.abs(meanBase)>EPS?'Mean difference ÷ |baseline mean|.':'Baseline mean is zero; a relative change is undefined.',
  better:count(([b,a])=>better(direction,a,b)),worse:count(([b,a])=>better(direction,b,a)),equal:count(([b,a])=>Math.abs(a-b)<=EPS),higher:count(([b,a])=>a>b+EPS),lower:count(([b,a])=>a<b-EPS)};
}
/** Policies ordered from best to worst on one metric (by mean); ties share a rank. */
export function rankOn(direction,means) {
 const keys=Object.keys(means).filter(k=>typeof means[k]==='number');
 if(direction==='neutral'||keys.length<2)return null;
 const sorted=keys.sort((a,b)=>direction==='higher'?means[b]-means[a]:means[a]-means[b]);
 let rank=0,prior=null;return sorted.map((k,i)=>{if(prior===null||Math.abs(means[k]-prior)>EPS)rank=i+1;prior=means[k];return {policy:k,rank,mean:means[k]};});
}
/** Pareto comparison on the scenario's direction-bearing objectives, using means across seeds. */
export function pareto(scenario,summary,policyKeys) {
 const objectives=scenario.objectives.filter(m=>metricDef(scenario,m)?.direction!=='neutral');
 const usable=objectives.filter(m=>policyKeys.some(p=>summary[p]?.[m]?.mean!==null));
 const excluded=policyKeys.filter(p=>usable.some(m=>summary[p]?.[m]?.mean===null)).map(p=>({policy:p,reason:`Insufficient evidence on ${usable.filter(m=>summary[p][m].mean===null).join(', ')}.`}));
 const valid=policyKeys.filter(p=>!excluded.some(e=>e.policy===p));
 if(valid.length<2||usable.length<2)return {meaningful:false,reason:valid.length<2?'Fewer than two policies have values on every objective, so no Pareto comparison is possible.':'Fewer than two objectives have values, so a Pareto comparison would only repeat a single ranking.',objectives:usable,excluded,nonDominated:[],dominatedBy:{}};
 const dir=m=>metricDef(scenario,m).direction,mean=(p,m)=>summary[p][m].mean;
 const dominates=(a,b)=>usable.every(m=>!better(dir(m),mean(b,m),mean(a,m)))&&usable.some(m=>better(dir(m),mean(a,m),mean(b,m)));
 const dominatedBy=Object.fromEntries(valid.map(p=>[p,valid.filter(q=>q!==p&&dominates(q,p))]));
 const nonDominated=valid.filter(p=>!dominatedBy[p].length);
 const identical=valid.every(p=>usable.every(m=>Math.abs(mean(p,m)-mean(valid[0],m))<=EPS));
 return {meaningful:true,reason:identical?'All compared policies produced identical means on every objective.':nonDominated.length===valid.length?'No policy dominates another: each is better on at least one objective. Choosing requires a value judgement about the trade-off.':nonDominated.length===1?'One policy is at least as good on every objective and better on at least one, in this model and these conditions.':'Some policies are dominated; the remaining ones trade objectives against each other.',
  objectives:usable,excluded,nonDominated,dominatedBy:Object.fromEntries(Object.entries(dominatedBy).filter(([,v])=>v.length)),basis:'Means across replications; a dominated mean can still win in individual seeds.'};
}
/**
 * Optional user-weighted score. Each weighted metric is min–max normalized across the compared policies
 * (best = 1, worst = 0; a metric with no variation contributes 1 to every policy). This expresses the
 * user's priorities; it is not an objective measure of welfare.
 */
export function weightedRanking(scenario,summary,policyKeys,weights) {
 const used=Object.entries(weights??{}).filter(([m,w])=>w>0&&scenario.objectives.includes(m));
 if(!used.length)return null;
 const excluded=policyKeys.filter(p=>used.some(([m])=>summary[p]?.[m]?.mean===null)).map(p=>({policy:p,reason:'Insufficient evidence on a weighted metric.'}));
 const valid=policyKeys.filter(p=>!excluded.some(e=>e.policy===p)),total=used.reduce((a,[,w])=>a+w,0);
 const normalization=Object.fromEntries(used.map(([m])=>{const xs=valid.map(p=>summary[p][m].mean);return [m,{min:valid.length?Math.min(...xs):null,max:valid.length?Math.max(...xs):null,direction:metricDef(scenario,m).direction,constant:valid.length?Math.max(...xs)-Math.min(...xs)<=EPS:true}];}));
 const norm=(m,v)=>{const n=normalization[m];if(n.constant)return 1;const t=(v-n.min)/(n.max-n.min);return n.direction==='lower'?1-t:t;};
 const scores=valid.map(p=>{const contributions=Object.fromEntries(used.map(([m,w])=>[m,round6(w*norm(m,summary[p][m].mean)/total)]));return {policy:p,score:round6(Object.values(contributions).reduce((a,b)=>a+b,0)),contributions};}).sort((a,b)=>b.score-a.score||a.policy.localeCompare(b.policy));
 return {weights:Object.fromEntries(used),normalization,scores,ranking:scores.map(s=>s.policy),excluded,note:'Weights express a chosen priority. Normalization is relative to the compared policies only, so adding or removing a policy can change scores.'};
}
export function formatValue(def,v) {
 if(v===null||v===undefined)return 'insufficient evidence';
 if(def?.unit==='share'||def?.unit==='share of income')return `${(v*100).toFixed(1)}%`;
 if(def?.unit==='share points')return `${(v*100).toFixed(1)} points`;
 return `${Number(v.toFixed(2)).toLocaleString('en-GB')}${def?.unit&&!['ratio','position'].includes(def.unit)&&!def.unit.startsWith('index')?` ${def.unit}`:''}`;
}
const lower=s=>s.charAt(0).toLowerCase()+s.slice(1);
const seeds=(kind,k,n)=>n===1?'single seed; robustness untested':k===n?`${kind} in all ${n} seeds`:`${kind} in ${k} of ${n} seeds, equal in ${n-k}`;
/** Template statements produced only from recorded differences that never reverse across seeds. No causal language. */
export function tradeoffs(scenario,plan,cond,policies) {
 const out=[],base=policies[0],n=plan.replications,label=k=>policyLabel(policies.find(p=>p.key===k));
 const name=m=>{const d=metricDef(scenario,m);return d.perspective?`${lower(d.label)} [${d.perspective}]`:lower(d.label);};
 for(const alt of policies.slice(1)) {
  const pr=m=>cond.paired[alt.key][m],show=m=>`${formatValue(metricDef(scenario,m),cond.summary[base.key][m].mean)} → ${formatValue(metricDef(scenario,m),cond.summary[alt.key][m].mean)}`;
  const objectives=scenario.objectives.filter(m=>metricDef(scenario,m).direction!=='neutral');
  const missing=objectives.filter(m=>pr(m).n<n),complete=objectives.filter(m=>pr(m).n===n);
  const up=complete.filter(m=>pr(m).better>0&&!pr(m).worse),down=complete.filter(m=>pr(m).worse>0&&!pr(m).better),mixed=complete.filter(m=>pr(m).better>0&&pr(m).worse>0);
  const part=(ms,k)=>ms.slice(0,2).map(m=>`${name(m)} (${show(m)}; ${seeds(k,pr(m)[k],n)})`).join(' and ');
  if(up.length&&down.length)out.push({policy:alt.key,kind:'trade-off',metrics:[...up,...down],text:`Compared with ${label(base.key)}, ${label(alt.key)} had better ${part(up,'better')} but worse ${part(down,'worse')}.`});
  else if(up.length&&!mixed.length&&!missing.length)out.push({policy:alt.key,kind:'no-worse',metrics:up,text:`${label(alt.key)} was better than ${label(base.key)} on ${part(up,'better')}, and no worse in any seed on the other headline objectives.`});
  else if(down.length&&!mixed.length&&!missing.length)out.push({policy:alt.key,kind:'no-better',metrics:down,text:`${label(alt.key)} was worse than ${label(base.key)} on ${part(down,'worse')}, and no better in any seed on the other headline objectives.`});
  else if(!up.length&&!down.length&&!mixed.length&&!missing.length)out.push({policy:alt.key,kind:'equal',metrics:[],text:`${label(alt.key)} and ${label(base.key)} produced identical headline outcomes in every seed.`});
  for(const m of mixed){const p=pr(m);out.push({policy:alt.key,kind:'mixed',metrics:[m],text:`${metricDef(scenario,m).label}: ${label(alt.key)} versus ${label(base.key)} was mixed across seeds (better in ${p.better}, worse in ${p.worse}, equal in ${p.equal} of ${p.n}), so no consistent direction can be claimed.`});}
  for(const m of missing)out.push({policy:alt.key,kind:'insufficient',metrics:[m],text:`${metricDef(scenario,m).label}: insufficient evidence to compare ${label(alt.key)} with ${label(base.key)} in every seed (a denominator was zero).`});
  // Who benefits and who pays: a group whose outcome moves against the overall result in every seed.
  for(const g of scenario.groupings)for(const m of g.metrics) {
   const agg=metricDef(scenario,m),gd=metricDef(scenario,m,true),total=cond.paired[alt.key][m];
   if(!agg||agg.direction==='neutral'||gd?.direction!==agg.direction||!total||total.n<n)continue;
   const aggKind=total.better===n?'better':total.worse===n?'worse':null;if(!aggKind)continue;
   for(const grp of g.groups) {
    const gp=cond.groupPaired[alt.key]?.[g.id]?.[grp.id]?.[m];if(!gp||gp.n<n)continue;
    const gKind=gp.better===n?'better':gp.worse===n?'worse':null;if(!gKind||gKind===aggKind)continue;
    const gs=k=>formatValue(gd,cond.groupSummary[k][g.id][grp.id][m].mean),when=n===1?'in the single seed run':`in all ${n} seeds`;
    out.push({policy:alt.key,kind:'group-divergence',metrics:[m],group:{dimension:g.id,id:grp.id},text:aggKind==='better'
     ?`Overall ${lower(agg.label)} improved under ${label(alt.key)} (${show(m)}), but for ${grp.label} (${lower(g.label)}) it worsened (${gs(base.key)} → ${gs(alt.key)}) ${when}.`
     :`Overall ${lower(agg.label)} worsened under ${label(alt.key)} (${show(m)}), while for ${grp.label} (${lower(g.label)}) it improved (${gs(base.key)} → ${gs(alt.key)}) ${when}.`});
   }
  }
 }
 return out;
}
/** Summaries, paired differences, rankings, Pareto, weighting and trade-offs for one condition. */
export function analyseCondition(scenario,plan,runs,policies) {
 const byPolicy=k=>plan.seeds.map((_,r)=>runs.find(x=>x.policy===k&&x.replication===r));
 const summary={},groupSummary={},paired_={},groupPaired={},seedWins={};
 for(const p of policies) {
  const rs=byPolicy(p.key);
  summary[p.key]=Object.fromEntries(scenario.metrics.map(m=>[m.id,summarize(rs.map(r=>r.metrics[m.id]?.value??null))]));
  groupSummary[p.key]=Object.fromEntries(scenario.groupings.map(g=>[g.id,Object.fromEntries(g.groups.map(grp=>[grp.id,Object.fromEntries(g.metrics.map(m=>[m,summarize(rs.map(r=>r.groups[g.id][grp.id].metrics[m]?.value??null))]))]))]));
 }
 const base=byPolicy(policies[0].key);
 for(const p of policies.slice(1)) {
  const rs=byPolicy(p.key);
  paired_[p.key]=Object.fromEntries(scenario.metrics.map(m=>[m.id,paired(m.direction,base.map(r=>r.metrics[m.id]?.value??null),rs.map(r=>r.metrics[m.id]?.value??null))]));
  groupPaired[p.key]=Object.fromEntries(scenario.groupings.map(g=>[g.id,Object.fromEntries(g.groups.map(grp=>[grp.id,Object.fromEntries(g.metrics.map(m=>{const d=metricDef(scenario,m,true);return [m,paired(d.direction,base.map(r=>r.groups[g.id][grp.id].metrics[m]?.value??null),rs.map(r=>r.groups[g.id][grp.id].metrics[m]?.value??null))];}))]))]));
 }
 const rankings=Object.fromEntries(scenario.objectives.map(m=>[m,rankOn(metricDef(scenario,m).direction,Object.fromEntries(policies.map(p=>[p.key,summary[p.key][m].mean])))]));
 // How often each policy is (jointly) best on each objective, seed by seed.
 for(const m of scenario.objectives) {
  const d=metricDef(scenario,m);seedWins[m]=Object.fromEntries(policies.map(p=>[p.key,0]));
  plan.seeds.forEach((_,r)=>{const vals=Object.fromEntries(policies.map(p=>[p.key,byPolicy(p.key)[r].metrics[m]?.value??null]));const ranked=rankOn(d.direction,vals);if(ranked&&Object.values(vals).every(v=>v!==null))for(const x of ranked.filter(x=>x.rank===1))seedWins[m][x.policy]++;});
 }
 const cond={summary,groupSummary,paired:paired_,groupPaired,rankings,seedWins};
 cond.pareto=pareto(scenario,summary,policies.map(p=>p.key));
 cond.weighted=weightedRanking(scenario,summary,policies.map(p=>p.key),plan.weights);
 cond.tradeoffs=tradeoffs(scenario,plan,cond,policies);
 return cond;
}
/** Does the best policy on each objective change across sensitivity values? */
export function sensitivity(scenario,plan,conditions,analyses,policies) {
 if(!plan.sweep)return null;
 const metrics=Object.fromEntries(scenario.objectives.map(m=>{
  const per=conditions.map((c,i)=>{const ranked=analyses[i].rankings[m];return {value:c.params[plan.sweep.param],best:ranked?ranked.filter(x=>x.rank===1).map(x=>x.policy):[],means:Object.fromEntries(policies.map(p=>[p.key,analyses[i].summary[p.key][m].mean])),seedWins:analyses[i].seedWins[m]};});
  const sig=per.map(x=>x.best.join(',')),stable=sig.every(s=>s&&s===sig[0]);
  return [m,{perCondition:per,stable,text:stable?`${metricDef(scenario,m).label}: ${per[0].best.map(k=>policyLabel(policies.find(p=>p.key===k))).join(' and ')} had the best mean at every ${plan.sweep.param} value tested.`:`${metricDef(scenario,m).label}: the best policy changed with ${plan.sweep.param} (${per.map(x=>`${x.value}: ${x.best.join('/')||'none'}`).join('; ')}). This conclusion is sensitive to that assumption.`}];
 }));
 return {param:plan.sweep.param,values:plan.sweep.values,metrics};
}
export function analyse(scenario,plan,conditions,runs,policies) {
 if(runs.some(r=>r.status!=='completed'))return null;
 const analyses=conditions.map(c=>analyseCondition(scenario,plan,runs.filter(r=>r.condition===c.index),policies));
 return {basis:'Statistics are computed across replication seeds. Ranges are the minimum and maximum observed values; standard deviations are sample standard deviations of simulated outputs. No confidence intervals are reported: seeds sample the synthetic model, not the real world.',conditions:analyses,sensitivity:sensitivity(scenario,plan,conditions,analyses,policies)};
}
