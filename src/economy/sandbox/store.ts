import {create} from 'zustand';
import {DOMAINS,domainScenario,latestPolicy,validatePlan,SANDBOX_LIMITS} from '../../../shared/economic-sandbox.mjs';
import {labRequest} from '../client';
import type {ExperimentRecord,FieldError,Preview,Scenario,Value} from '../types';

export type Domain='logistics'|'housing'|'procurement';
export interface DraftPolicy {id:string;params:Record<string,string|boolean>}
/** What the player is typing. Kept outside the panels, so closing a panel or a failed request loses nothing. */
export interface Draft {params:Record<string,string|boolean>;policies:DraftPolicy[];baseSeed:string;replications:string;sweepOn:boolean;sweepParam:string;sweepValues:string;weights:Record<string,number>;label:string;previewSeed:string}
const asInput=(v:Value)=>typeof v==='boolean'?v:String(v);
const paramsOf=(defs:{id:string;default:Value}[])=>Object.fromEntries(defs.map(d=>[d.id,asInput(d.default)]));
export const scenarioOf=(domain:Domain)=>domainScenario(domain) as unknown as Scenario;
export function freshDraft(domain:Domain):Draft {
 const sc=scenarioOf(domain);
 return {params:paramsOf(sc.params),policies:sc.policies.map(id=>({id,params:paramsOf(latestPolicy(id)!.params)})),baseSeed:'42',replications:'3',sweepOn:false,sweepParam:sc.params.find(p=>p.sweep)?.id??'',sweepValues:'',weights:{},label:'',previewSeed:'42'};
}
export const newPolicy=(id:string):DraftPolicy=>({id,params:paramsOf(latestPolicy(id)!.params)});
const num=(v:string|boolean)=>typeof v==='boolean'?v:/^\s*-?\d+\s*$/.test(v)?Number(v):Number.NaN;
const nums=(o:Record<string,string|boolean>)=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,num(v)]));
/** The plan the server will validate again, authoritatively. */
export function planFrom(domain:Domain,d:Draft) {
 const sc=scenarioOf(domain);
 return {scenario:sc.id,version:sc.version,params:nums(d.params),policies:d.policies.map(p=>({id:p.id,params:nums(p.params)})),baseSeed:num(d.baseSeed),replications:num(d.replications),
  sweep:d.sweepOn?{param:d.sweepParam,values:d.sweepValues.split(/[\s,;]+/).filter(Boolean).map(num)}:null,weights:Object.fromEntries(Object.entries(d.weights).filter(([,w])=>w>0)),label:d.label};
}
export function checkDraft(domain:Domain,d:Draft):{ok:boolean;errors:FieldError[];runs:number} {
 const r=validatePlan(planFrom(domain,d)) as {ok:boolean;errors?:FieldError[];runs?:number};
 return {ok:r.ok,errors:r.errors??[],runs:r.runs??0};
}
interface SandboxState {
 domain:Domain;drafts:Record<Domain,Draft>;previews:Partial<Record<Domain,Preview>>;records:Record<string,ExperimentRecord>;selected:Partial<Record<Domain,string>>;
 setDomain:(d:Domain)=>void;edit:(d:Domain,patch:Partial<Draft>)=>void;reset:(d:Domain)=>void;
}
export const useSandbox=create<SandboxState>(set=>({
 domain:'logistics',drafts:Object.fromEntries(DOMAINS.map(d=>[d.id,freshDraft(d.id as Domain)])) as Record<Domain,Draft>,previews:{},records:{},selected:{},
 setDomain:domain=>set({domain}),
 edit:(domain,patch)=>set(s=>({drafts:{...s.drafts,[domain]:{...s.drafts[domain],...patch}}})),
 reset:domain=>set(s=>({drafts:{...s.drafts,[domain]:freshDraft(domain)}})),
}));
const CACHE=6;
/** Fetch a saved record from the room (verified there against its committed digest) and select it. */
export async function openExperiment(station:string,id:string) {
 const r=await labRequest(station,'open',{experiment:id});
 if(r.ok&&r.record) {
  const record=r.record,domain=record.scenario.domain as Domain;
  useSandbox.setState(s=>{const records={...s.records,[record.id]:record};const keys=Object.keys(records);for(const k of keys.slice(0,Math.max(0,keys.length-CACHE)))delete records[k];return {records,selected:{...s.selected,[domain]:record.id},domain};});
 }
 return r;
}
export async function runPreview(station:string,domain:Domain,d:Draft) {
 const r=await labRequest(station,'preview',{domain,params:nums(d.params),seed:num(d.previewSeed)});
 if(r.ok&&r.preview)useSandbox.setState(s=>({previews:{...s.previews,[domain]:r.preview}}));
 return r;
}
export const limits=SANDBOX_LIMITS;
