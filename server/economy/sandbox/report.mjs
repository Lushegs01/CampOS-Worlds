// Exports are rendered from the stored record only. Nothing here re-runs or recomputes an experiment.
import {EXPORT_SCHEMA} from '../../../shared/economic-sandbox.mjs';
import {formatValue} from '../../../shared/economic-analysis.mjs';
import {validateRecord} from './engine.mjs';

export function exportBundle(record) {
 const problems=validateRecord(record);
 if(problems.length)throw Error(`The stored record failed validation: ${problems[0]}`);
 return {schema:EXPORT_SCHEMA,exportedAt:new Date().toISOString(),notice:'Simulated experiment record. Simulation units have no monetary value. Integrity digests detect accidental modification; they are not signatures and this file cannot create or verify a live lab operation.',record};
}
const esc=v=>String(v??'—').replace(/[|\\]/g,m=>`\\${m}`).replace(/[<>]/g,'').replace(/\r?\n/g,' ');
const table=(head,rows)=>[`| ${head.map(esc).join(' | ')} |`,`| ${head.map(()=>'---').join(' | ')} |`,...rows.map(r=>`| ${r.map(esc).join(' | ')} |`)].join('\n');
const range=(def,s)=>s.mean===null?'insufficient evidence':`${formatValue(def,s.mean)}${s.n>1&&s.min!==s.max?` (range ${formatValue(def,s.min)} – ${formatValue(def,s.max)})`:''}${s.missing?` · missing in ${s.missing}`:''}`;
const dir={higher:'higher is better',lower:'lower is better',neutral:'descriptive'};

export function experimentReport(record) {
 const r=record.results,sc=record.scenario,P=record.policies,plan=record.plan,out=[];
 const metric=id=>sc.metrics.find(m=>m.id===id),gmetric=id=>sc.groupMetrics.find(m=>m.id===id),plabel=k=>`${k} · ${P.find(p=>p.key===k)?.label}`;
 out.push('# CampOS Worlds · Economic Policy Sandbox experiment','','> A simplified, synthetic model run on the CampOS room server. Values are **simulation units** and modeled quantities. This is not a prediction of any real economy, and it does not show that any policy is generally better.','');
 out.push(table(['Field','Value'],[
  ['Experiment',record.id],['Label',record.label||'—'],['Status',r.status==='completed'?'Completed — every run passed its invariant checks':`FAILED — ${r.failure}. No conclusions are drawn.`],['Created',record.createdAt],
  ['Scenario',`${sc.name} (${sc.id}, version ${sc.version})`],['Model and rules',`${record.modelVersion}; ${sc.ruleVersion}; ${record.engineVersion}`],
  ['Seeds',`${plan.seeds.join(', ')} (${plan.replications} replication${plan.replications===1?'':'s'}, base seed ${plan.baseSeed})`],['Conditions',r.conditions.map(c=>c.label).join('; ')],
  ['Runs',`${r.runs.length} (${r.conditions.length} condition × ${plan.seeds.length} seed × ${P.length} policy)`],['Execution',`${record.execution.isolation}, ${record.execution.durationMs} ms of a ${record.execution.timeoutMs} ms budget`],
  ['Results digest (SHA-256)',record.resultsDigest],['Record digest (SHA-256)',record.digest],
  ['Repeat of',record.repeatOf??'—'],['Reproduction',record.reproduction?(record.reproduction.identical?`Identical results to ${record.reproduction.original}`:`Results DIFFER from ${record.reproduction.original}`):'—'],
 ]),'');
 out.push('## Research question','',sc.researchQuestion,'','**System boundary.** '+sc.boundary,'','**Actors.** '+sc.actors.join('; ')+'.','','**Resources.** '+sc.resources.join('; ')+'.','');
 out.push('## Policies compared','',...P.flatMap(p=>[`### ${p.key} · ${p.label}`,'',`- Policy: \`${p.id}\` version ${p.version}. Objective: ${p.definition.objective}`,`- Decision rule: ${p.definition.decisionRule}`,`- Eligibility and constraints: ${p.definition.eligibility.join('; ')}.`,`- Parameters: ${p.definition.params.length?p.definition.params.map(d=>`${d.label} = ${p.values[d.id]}${d.unit?` ${d.unit}`:''} (default ${d.default})`).join('; '):'none'}.`,`- Assumptions: ${p.definition.assumptions.join(' ')}`,'']));
 out.push('## Parameters','',table(['Parameter','Value','Unit','Default','Allowed'],sc.params.map(d=>[d.label,plan.params[d.id],d.unit??'',d.default,d.type==='bool'?'on/off':`${d.min}–${d.max}`])),'');
 if(plan.sweep)out.push(`Sensitivity: **${plan.sweep.param}** took the values ${plan.sweep.values.join(', ')}; all other parameters as above.`,'');
 if(sc.constants)out.push('Fixed illustrative constants of this scenario version:','','```json',JSON.stringify(sc.constants,null,1),'```','');
 out.push('## Starting conditions','','Each seed’s starting conditions were generated once and an isolated copy was given to every policy. The full data is in the JSON record.','',table(['Condition','Seed','Starting-conditions digest','Identical for all policies'],r.equivalence.map(e=>[r.conditions[e.condition].label,e.seed,e.digest,e.identical&&e.untouched?'yes':'NO'])),'');
 if(r.status!=='completed'||!r.analysis) {
  out.push('## Validation failure','',`The experiment did not complete: ${r.failure}. Results of failed or partial runs are not summarised, ranked or compared.`,'');
  for(const run of r.runs.filter(x=>x.status!=='completed'))out.push(`- ${run.id}: ${run.error}${run.invariants.filter(i=>!i.pass).map(i=>` — ${i.rule}${i.detail?`: ${i.detail}`:''}`).join('')}`);
  out.push('');
 }else r.conditions.forEach((c,ci)=>{
  const a=r.analysis.conditions[ci],keys=P.map(p=>p.key);
  out.push(`## Results · ${c.label}`,'','Values are means across seeds; ranges show the lowest and highest seed. Definitions and denominators are listed per metric.','');
  out.push('### Headline objectives','',table(['Objective','Direction',...keys.map(plabel)],sc.objectives.map(m=>[metric(m).label+(metric(m).perspective?` [${metric(m).perspective}]`:''),dir[metric(m).direction],...keys.map(k=>range(metric(m),a.summary[k][m]))])),'');
  out.push('### All metrics','',table(['Metric','Category','Definition','Denominator',...keys]  ,sc.metrics.map(m=>[m.label,m.category,m.definition,m.denominator,...keys.map(k=>range(m,a.summary[k][m.id]))])),'');
  if(keys.length>1)out.push(`### Differences from ${plabel(keys[0])}`,'','Seed-by-seed differences (alternative − baseline) using the same seeds and starting conditions. Relative change = mean difference ÷ |baseline mean|.','',table(['Metric',...keys.slice(1).flatMap(k=>[`${k} mean difference`,`${k} relative`,`${k} better / worse / equal seeds`])],sc.metrics.filter(m=>m.direction!=='neutral').map(m=>[m.label,...keys.slice(1).flatMap(k=>{const d=a.paired[k][m.id];return [d.meanDiff===null?'insufficient evidence':Number(d.meanDiff.toFixed(4)),d.relative===null?d.relativeNote:`${(d.relative*100).toFixed(1)}%`,`${d.better} / ${d.worse} / ${d.equal} of ${d.n}`];})])),'');
  out.push('### Stakeholder groups','');
  for(const g of sc.groupings) {
   out.push(`#### ${g.label}`,'',table(['Group','Members (seed 1)','Metric',...keys],g.groups.flatMap(grp=>g.metrics.map(m=>[grp.label,r.runs.find(x=>x.condition===ci&&x.replication===0&&x.policy===keys[0])?.groups[g.id][grp.id].members??0,gmetric(m).label,...keys.map(k=>range(gmetric(m),a.groupSummary[k][g.id][grp.id][m]))]))),'');
  }
  out.push('### Pareto comparison','',a.pareto.meaningful?`Objectives: ${a.pareto.objectives.map(m=>metric(m).label).join(', ')}. Non-dominated: ${a.pareto.nonDominated.map(plabel).join('; ')}. ${Object.entries(a.pareto.dominatedBy).map(([k,v])=>`${k} is dominated by ${v.join(', ')}.`).join(' ')} ${a.pareto.reason} ${a.pareto.basis}`:a.pareto.reason,'');
  if(a.weighted)out.push('### Weighted ranking (user-chosen priorities)','',`Weights: ${Object.entries(a.weighted.weights).map(([m,w])=>`${metric(m).label} ${w}`).join(', ')}. ${a.weighted.note}`,'',table(['Rank','Policy','Score (0–1)'],a.weighted.scores.map((s,i)=>[i+1,plabel(s.policy),s.score])),'');
  out.push('### Ranking under each single objective','',table(['Objective','Ranking (best first)','Seeds in which each policy was best'],sc.objectives.map(m=>[metric(m).label,a.rankings[m]?a.rankings[m].map(x=>`${x.rank}. ${x.policy}`).join(', '):'insufficient evidence',Object.entries(a.seedWins[m]).map(([k,v])=>`${k}: ${v}`).join(', ')])),'');
  out.push('### Observed trade-offs','','These statements are generated from recorded, consistent differences only. They describe what happened in this model; they are not causal claims about real policies.','',...(a.tradeoffs.length?a.tradeoffs.map(t=>`- ${t.text}`):['- No consistent difference was recorded.']),'');
  out.push('### Replications','',table(['Seed','Policy',...sc.objectives.map(m=>metric(m).label)],r.runs.filter(x=>x.condition===ci).map(x=>[x.seed,x.policy,...sc.objectives.map(m=>formatValue(metric(m),x.metrics[m].value))])),'');
 });
 if(r.analysis?.sensitivity)out.push('## Sensitivity','',...Object.values(r.analysis.sensitivity.metrics).map(s=>`- ${s.text}`),'');
 const checks=r.runs.flatMap(x=>x.invariants),failed=checks.filter(i=>!i.pass);
 out.push('## Validation','',`- ${checks.length} invariant checks across ${r.runs.length} runs; ${failed.length?`${failed.length} FAILED`:'all passed'}. Rules checked: ${[...new Set(checks.map(i=>i.rule))].join(', ')}.`,`- Starting conditions identical for every policy in every seed: ${r.equivalence.every(e=>e.identical&&e.untouched)?'yes':'NO'}.`,`- ${r.analysis?.basis??'No statistics are reported for an incomplete experiment.'}`,'');
 out.push('## Assumptions','',...sc.assumptions.map(x=>`- ${x}`),'','## Limitations','',...sc.limitations.map(x=>`- ${x}`),'','## Not represented in this model','',...sc.omitted.map(x=>`- ${x}`),'','## Evidence needed to calibrate with real observations','',...sc.calibration.map(x=>`- ${x}`),'');
 out.push('## Reproduce','',`Run scenario \`${sc.id}\` version ${sc.version} with the parameters, policies (IDs, versions and values) and seeds above on a CampOS room server that still registers this version, or use **Repeat** at Research and Results. Matching results produce the same results digest \`${record.resultsDigest}\`.`,'','Governance: '+record.governance.units+'. External validation: none. Calibrated with real data: no.');
 return out.join('\n');
}
