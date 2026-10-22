import {useEffect,useMemo,useRef,useState} from 'react';
import {weightedRanking} from '../../../shared/economic-analysis.mjs';
import type {ConditionAnalysis,ExperimentRecord,MetricDef,Weighted} from '../types';
import {Bar,Section,SummaryCell,Table,fmt,short} from './parts';

const DIRECTION={higher:'higher is better',lower:'lower is better',neutral:'descriptive only'};
const signed=(def:MetricDef|undefined,v:number|null)=>v===null?'Insufficient evidence':`${v>0?'+':v<0?'−':'±'}${fmt(def,Math.abs(v))}`;

/** Everything shown here is read from the stored record; nothing is recomputed except the labelled what-if weighting. */
export function Results({record,focus=false}:{record:ExperimentRecord;focus?:boolean}) {
 const sc=record.scenario,r=record.results,P=record.policies,keys=P.map(p=>p.key),heading=useRef<HTMLHeadingElement>(null);
 const [cond,setCond]=useState(0),[grouping,setGrouping]=useState(sc.groupings[0]?.id??''),[gmetricId,setGmetric]=useState(sc.groupings[0]?.metrics.find(m=>/Rate$/.test(m))??sc.groupings[0]?.metrics[0]??''),[repMetric,setRepMetric]=useState(sc.objectives[0]);
 useEffect(()=>{if(focus)heading.current?.focus();},[focus,record.id]);
 const metric=(id:string)=>sc.metrics.find(m=>m.id===id),gmetric=(id:string)=>sc.groupMetrics.find(m=>m.id===id),label=(k:string)=>`${k} · ${P.find(p=>p.key===k)?.label}`;
 const a:ConditionAnalysis|undefined=r.analysis?.conditions[cond],g=sc.groupings.find(x=>x.id===grouping);
 return <section className="sandbox-results" aria-labelledby={`results-${record.id}`}>
  <h3 id={`results-${record.id}`} ref={heading} tabIndex={-1}>{record.label||sc.name} · results</h3>
  <p className={r.status==='completed'?'lab-ok':'insufficient'} role="status">{r.status==='completed'?`Completed: ${r.runs.length} runs, every invariant check passed and every policy received identical starting conditions.`:`Failed: ${r.failure}. No comparison, ranking or trade-off is shown for incomplete evidence.`}</p>
  <Section title="A · Experiment overview" open>
   <p><b>Research question.</b> {sc.researchQuestion}</p>
   <dl className="lab-facts"><div><dt>Scenario</dt><dd>{sc.name} · {sc.id} v{sc.version}</dd></div><div><dt>Model</dt><dd>{record.modelVersion} · {sc.ruleVersion}</dd></div><div><dt>Seeds</dt><dd>{record.plan.seeds.join(', ')} ({record.plan.replications} replication{record.plan.replications===1?'':'s'})</dd></div><div><dt>Conditions</dt><dd>{r.conditions.map(c=>c.label).join('; ')}</dd></div><div><dt>Saved</dt><dd>{new Date(record.createdAt).toLocaleString()}</dd></div><div><dt>Experiment</dt><dd><code>{record.id}</code></dd></div></dl>
   <ul>{P.map(p=><li key={p.key}><b>{label(p.key)}</b> — {p.definition.decisionRule} <small>({p.id} v{p.version}{p.definition.params.length?`; ${p.definition.params.map(d=>`${d.label}: ${String(p.values[d.id])}`).join(', ')}`:''})</small></li>)}</ul>
   <details><summary>Parameter values</summary><Table caption="Parameters used" head={['Parameter','Value','Default','Allowed']} rows={sc.params.map(d=>[d.label,`${String(record.plan.params[d.id])}${d.unit?` ${d.unit}`:''}`,String(d.default),d.type==='bool'?'on/off':`${d.min}–${d.max}`])}/></details>
   <details><summary>Assumptions and limitations</summary><h4>Assumptions</h4><ul>{sc.assumptions.map(x=><li key={x}>{x}</li>)}</ul><h4>Limitations</h4><ul>{sc.limitations.map(x=><li key={x}>{x}</li>)}</ul><h4>Not represented</h4><ul>{sc.omitted.map(x=><li key={x}>{x}</li>)}</ul></details>
  </Section>
  {a&&<>
   {r.conditions.length>1&&<label className="field">Sensitivity condition<select value={cond} onChange={e=>setCond(Number(e.target.value))}>{r.conditions.map(c=><option key={c.index} value={c.index}>{c.label}</option>)}</select></label>}
   <Section title="B · Outcome comparison" open>
    <p className="muted">Means across seeds with the lowest–highest seed range. Every policy started from identical conditions in each seed.</p>
    <Table caption="Headline objectives" head={['Objective',...keys.map(label)]} rows={sc.objectives.map(m=>{const d=metric(m),best=a.rankings[m]?.filter(x=>x.rank===1).map(x=>x.policy)??[],max=Math.max(...keys.map(k=>Math.abs(a.summary[k][m].mean??0)));
     return [<><b>{d?.label}</b><small> {DIRECTION[d?.direction??'neutral']}{d?.perspective?` · ${d.perspective}`:''}</small></>,...keys.map(k=><><SummaryCell def={d} s={a.summary[k][m]}/><Bar value={a.summary[k][m].mean} max={max}/>{best.includes(k)&&best.length<keys.length&&<span className="lab-badge">Best mean</span>}</>)];})}/>
    {keys.length>1&&<Table caption={`Differences from ${label(keys[0])} (alternative − baseline, paired by seed)`} head={['Metric',...keys.slice(1).map(label)]} rows={sc.metrics.filter(m=>m.direction!=='neutral').map(m=>[m.label,...keys.slice(1).map(k=>{const d=a.paired[k][m.id];return <>{signed(m,d.meanDiff)}<small> {d.relative===null?d.relativeNote:`${d.relative>0?'+':''}${(d.relative*100).toFixed(1)}% of baseline`} · better {d.better}, worse {d.worse}, equal {d.equal} of {d.n}</small></>;})])}/>}
    <h4>Who received what</h4>
    <div className="lab-inline"><label className="field">Stakeholder grouping<select value={grouping} onChange={e=>{const next=sc.groupings.find(x=>x.id===e.target.value);setGrouping(e.target.value);if(next&&!next.metrics.includes(gmetricId))setGmetric(next.metrics[0]);}}>{sc.groupings.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
     {g&&<label className="field">Group measure<select value={gmetricId} onChange={e=>setGmetric(e.target.value)}>{g.metrics.map(m=><option key={m} value={m}>{gmetric(m)?.label}</option>)}</select></label>}</div>
    {g&&<><Table caption={`${gmetric(gmetricId)?.label} by ${g.label.toLowerCase()}`} head={['Group','Members (first seed)',...keys.map(label)]} rows={g.groups.map(grp=>{const max=Math.max(...g.groups.flatMap(x=>keys.map(k=>Math.abs(a.groupSummary[k][g.id][x.id][gmetricId]?.mean??0))));
      return [grp.label,String(r.runs.find(x=>x.condition===cond&&x.replication===0)?.groups[g.id][grp.id].members??0),...keys.map(k=><><SummaryCell def={gmetric(gmetricId)} s={a.groupSummary[k][g.id][grp.id][gmetricId]}/><Bar value={a.groupSummary[k][g.id][grp.id][gmetricId]?.mean} max={max}/></>)];})}/>
     <p className="muted small-text">{gmetric(gmetricId)?.definition} Denominator: {gmetric(gmetricId)?.denominator}. Groups with no members are shown, with insufficient evidence for rates.</p></>}
    <Table caption="Exclusion, unmet demand and resource constraints" head={['Metric',...keys.map(label)]} rows={sc.metrics.filter(m=>['exclusion','utilization'].includes(m.category)).map(m=>[<>{m.label}<small> {m.definition}</small></>,...keys.map(k=><SummaryCell def={m} s={a.summary[k][m.id]}/>)])}/>
    <details><summary>All metrics with definitions and denominators</summary><Table caption="All aggregate metrics" head={['Metric','Definition','Denominator',...keys]} rows={sc.metrics.map(m=>[<>{m.label}<small> {m.category} · {DIRECTION[m.direction]}</small></>,m.definition,m.denominator,...keys.map(k=><SummaryCell def={m} s={a.summary[k][m.id]}/>)])}/></details>
   </Section>
   <Section title="C · Trade-offs" open>
    <p className="note">Statements are generated only from differences recorded consistently in this experiment. They describe this simplified model, not real-world causes.</p>
    <ul className="lab-tradeoffs">{a.tradeoffs.length?a.tradeoffs.map((t,i)=><li key={i} data-kind={t.kind}>{t.text}</li>):<li>No consistent difference between policies was recorded.</li>}</ul>
    <h4>Pareto comparison</h4><p>{a.pareto.meaningful?<>Not dominated: <b>{a.pareto.nonDominated.map(label).join('; ')}</b>. {Object.entries(a.pareto.dominatedBy).map(([k,v])=>`${k} is dominated by ${v.join(', ')}. `)}{a.pareto.reason} <small>{a.pareto.basis}</small></>:a.pareto.reason}</p>
    {a.pareto.excluded.map(x=><p key={x.policy} className="insufficient">{x.policy}: {x.reason}</p>)}
    <Table caption="Ranking under each objective alone (shows how the choice of priority changes the order)" head={['Objective','Best first','Seeds in which each policy was best']} rows={sc.objectives.map(m=>[metric(m)?.label,a.rankings[m]?a.rankings[m]!.map(x=>`${x.rank}. ${x.policy}`).join('  '):'Insufficient evidence',Object.entries(a.seedWins[m]).map(([k,v])=>`${k}: ${v}`).join(' · ')])}/>
    {a.weighted&&<WeightedTable caption="Weighted ranking saved with this experiment" w={a.weighted} label={label}/>}
    <WhatIf record={record} a={a} label={label}/>
   </Section>
   <Section title="D · Replications and uncertainty">
    <p className="muted">{r.analysis?.basis}</p>
    <label className="field">Measure<select value={repMetric} onChange={e=>setRepMetric(e.target.value)}>{sc.metrics.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <Table caption={`${metric(repMetric)?.label} in each seed`} head={['Seed',...keys.map(label)]} rows={[...record.plan.seeds.map((seed,i)=>[String(seed),...keys.map(k=>fmt(metric(repMetric),r.runs.find(x=>x.condition===cond&&x.replication===i&&x.policy===k)?.metrics[repMetric]?.value))]),
     ['Mean',...keys.map(k=>fmt(metric(repMetric),a.summary[k][repMetric].mean))],['Range',...keys.map(k=>{const s=a.summary[k][repMetric];return s.mean===null?'Insufficient evidence':`${fmt(metric(repMetric),s.min)} – ${fmt(metric(repMetric),s.max)}`;})],['Sample SD',...keys.map(k=>{const s=a.summary[k][repMetric];return s.sd===null?(s.n<2?'Needs 2+ seeds':'—'):String(Number(s.sd.toFixed(4)));})]]}/>
    {record.plan.replications===1&&<p className="insufficient">One seed only: this shows one example, not whether the result holds across draws.</p>}
   </Section>
   {r.analysis?.sensitivity&&<Section title="E · Sensitivity to assumptions" open>
    <ul className="lab-tradeoffs">{Object.values(r.analysis.sensitivity.metrics).map((s,i)=><li key={i} data-kind={s.stable?'stable':'mixed'}>{s.text}</li>)}</ul>
   </Section>}
  </>}
  <Section title="F · Reproducibility">
   <dl className="lab-facts"><div><dt>Results digest</dt><dd><code>{record.resultsDigest}</code></dd></div><div><dt>Record digest</dt><dd><code>{record.digest}</code></dd></div><div><dt>Execution</dt><dd>{record.execution.isolation}, {record.execution.durationMs} ms of {record.execution.timeoutMs} ms</dd></div>
    <div><dt>Repeat of</dt><dd>{record.repeatOf?<code>{short(record.repeatOf)}</code>:'Original experiment'}</dd></div>{record.reproduction&&<div><dt>Reproduction</dt><dd className={record.reproduction.identical?'lab-ok':'insufficient'}>{record.reproduction.identical?'Identical results to the original (same results digest).':'Results differ from the original; the model or rules may have changed.'}</dd></div>}</dl>
  </Section>
 </section>;
}
function WeightedTable({caption,w,label}:{caption:string;w:Weighted;label:(k:string)=>string}) {
 return <><Table caption={caption} head={['Rank','Policy','Score (0–1)']} rows={w.scores.map((s,i)=>[String(i+1),label(s.policy),s.score.toFixed(3)])}/>{w.excluded.map(x=><p key={x.policy} className="insufficient">{x.policy}: {x.reason}</p>)}<p className="muted small-text">{w.note}</p></>;
}
function WhatIf({record,a,label}:{record:ExperimentRecord;a:ConditionAnalysis;label:(k:string)=>string}) {
 const sc=record.scenario,metric=(id:string)=>sc.metrics.find(m=>m.id===id);
 const [weights,setWeights]=useState<Record<string,number>>(()=>Object.fromEntries(sc.objectives.map(m=>[m,record.plan.weights[m]??0])));
 const result=useMemo(()=>weightedRanking(sc,a.summary,record.policies.map(p=>p.key),weights) as Weighted|null,[sc,a,record.policies,weights]);
 return <details className="sandbox-section"><summary>Explore other weightings (not saved)</summary>
  <p className="muted small-text">Choose how much each objective matters to you. Each metric is rescaled so the best compared policy scores 1 and the worst 0. This is a value judgement, not an economic fact, and it is not added to the experiment record.</p>
  <div className="lab-weights">{sc.objectives.map(m=><label key={m}>{metric(m)?.label} <output>{weights[m]}</output><input type="range" min={0} max={10} step={1} value={weights[m]} onChange={e=>setWeights({...weights,[m]:Number(e.target.value)})}/></label>)}</div>
  {result?<WeightedTable caption="Exploratory weighted ranking" w={result} label={label}/>:<p>Give at least one objective a weight above zero.</p>}
 </details>;
}
