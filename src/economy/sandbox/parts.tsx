import {useState,type ReactNode} from 'react';
import {formatValue} from '../../../shared/economic-analysis.mjs';
import {useLab} from '../client';
import type {MetricDef,Summary} from '../types';

export const fmt=(def:MetricDef|undefined,v:number|null|undefined)=>formatValue(def,v??null);
export const short=(id:string)=>id.length>14?`${id.slice(0,8)}…`:id;
export const pct=(v:number)=>`${(v*100).toFixed(1)}%`;
/** Mean with the observed range across seeds; a missing value is shown as insufficient evidence, never 0. */
export function SummaryCell({def,s}:{def?:MetricDef;s?:Summary}) {
 if(!s||s.mean===null)return <span className="insufficient">Insufficient evidence</span>;
 return <><b>{fmt(def,s.mean)}</b>{s.n>1&&s.min!==s.max&&<small> range {fmt(def,s.min)} – {fmt(def,s.max)}</small>}{s.missing>0&&<small> · missing in {s.missing} seed{s.missing===1?'':'s'}</small>}</>;
}
/** A decorative bar beside a number that is always present as text. */
export const Bar=({value,max}:{value:number|null|undefined;max:number})=>value===null||value===undefined||!(max>0)?null:<span className="lab-bar" aria-hidden="true"><i style={{width:`${Math.max(2,Math.min(100,Math.abs(value)/max*100))}%`}}/></span>;
export function Table({caption,head,rows,limit=0}:{caption:string;head:ReactNode[];rows:ReactNode[][];limit?:number}) {
 const [all,setAll]=useState(false),shown=limit&&!all?rows.slice(0,limit):rows;
 return <div className="lab-table-wrap" role="region" aria-label={caption} tabIndex={0}><table className="lab-table"><caption>{caption}</caption><thead><tr>{head.map((h,i)=><th key={i} scope="col">{h}</th>)}</tr></thead>
  <tbody>{shown.map((r,i)=><tr key={i}>{r.map((c,j)=>j===0?<th key={j} scope="row">{c}</th>:<td key={j}>{c}</td>)}</tr>)}</tbody></table>
  {limit>0&&rows.length>limit&&<button className="text-button" onClick={()=>setAll(!all)}>{all?`Show first ${limit} rows`:`Show all ${rows.length} rows`}</button>}</div>;
}
export function FieldErrors({prefix}:{prefix?:string}) {
 const errors=useLab(s=>s.errors).filter(e=>!prefix||e.field.startsWith(prefix));
 return errors.length?<ul className="lab-errors" role="alert">{errors.map((e,i)=><li key={i}><b>{e.field}</b>: {e.message}</li>)}</ul>:null;
}
export const Section=({title,children,open=false}:{title:string;children:ReactNode;open?:boolean})=><details className="sandbox-section" open={open}><summary>{title}</summary>{children}</details>;
