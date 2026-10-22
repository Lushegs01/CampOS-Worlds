// Metric value constructors. Every value carries the quantities it was computed from so a reader can check
// it; a zero denominator yields null ("insufficient evidence"), never 0 or NaN.
import {round6} from '../../../shared/economic-analysis.mjs';
export const count=v=>({value:v});
export const total=v=>({value:round6(v)});
export const ratio=(num,den)=>({value:den?round6(num/den):null,numerator:round6(num),denominator:den});
export const mean=xs=>({value:xs.length?round6(xs.reduce((a,b)=>a+b,0)/xs.length):null,denominator:xs.length});
export const max=xs=>({value:xs.length?round6(Math.max(...xs)):null,denominator:xs.length});
export const range=xs=>({value:xs.length>1?round6(Math.max(...xs)-Math.min(...xs)):null,denominator:xs.length});
export const check=(rule,pass,detail='')=>({rule,pass:!!pass,...(pass?{}:{detail:String(detail).slice(0,240)})});
/** Group metrics for every declared group, including empty ones (members: 0) so no group silently disappears. */
export function groupsFor(scenario,members,compute) {
 return Object.fromEntries(scenario.groupings.map(g=>[g.id,Object.fromEntries(g.groups.map(grp=>{const m=members(g.id,grp.id);return [grp.id,{members:m.length,metrics:compute(g,grp,m)}];}))]));
}
