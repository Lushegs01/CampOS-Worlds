import { LAB, LAB_STATIONS, LOGISTICS_SITES } from '../../../shared/economic-lab.mjs';
import type { BuildContext } from './buildings';
import { flatRoof, windowUnit } from './kit';
import { sign } from './signage';

/** Small tropical-modern research hall; geometry joins the campus material batches. */
export function buildEconomicLab(c: BuildContext) {
  const {kit}=c;
  kit.box('terrazzo',[-55,.015,22],[18,.03,10]);
  for(const x of [-64,-46]) {
    kit.box('stucco',[x,3,22],[.3,6,10]);
    kit.box('wood',[x+(x===-64?.17:-.17),.5,22],[.04,1,9.6]);
  }
  kit.box('stucco',[-55,3,17],[18,6,.3]);
  for(const [a,b] of [[-64,-58.2],[-55.8,-46]]) {
    kit.box('granite',[(a+b)/2,.35,27],[b-a,.7,.3]);
    kit.within([a,0,27.15],0,()=>windowUnit(kit,{x0:.1,x1:b-a-.1,y0:.7,y1:3.7},{frame:'bronzeFrame',tint:'clear',sill:null,recess:.15,mullion:1.5}));
    kit.box('stucco',[(a+b)/2,4.85,27],[b-a,2.3,.3]);
  }
  kit.box('stucco',[-57,4.55,27],[2.4,2.9,.3]);
  for(const x of [-58.2,-55.8]) kit.box('bronzeFrame',[x,1.55,27],[.08,3.1,.15]);
  kit.box('bronzeFrame',[-57,3.12,27],[2.5,.1,.15]);
  flatRoof(kit,-64,-46,17,27,LAB.h,{eave:.7,slab:.25});
  kit.box('paintGreen',[-57,3.6,28.15],[6.5,.3,2.8]);
  for(const x of [-60,-54]) kit.box('bronzeFrame',[x,1.7,29.3],[.12,3.4,.12]);
  c.signs.push(kit.place(sign({text:'ECONOMIC SIMULATION LAB',width:14,height:.65,kind:'letters',color:'#b88a50'}),[-55,4.5,27.17]));
  c.signs.push(kit.place(sign({text:'Welcome · Economic Policy Sandbox',lines:['ECONOMIC POLICY SANDBOX','Six stations · simulation units only'],width:4.8,height:1.1,kind:'panel',background:'#233f35'}),[-52,1.9,26.81],Math.PI));
  c.signs.push(kit.place(sign({text:'ORISUN / RESEARCH & OPERATIONS',width:10,height:.55,kind:'panel',background:'#233f35'}),[-55,3.7,17.18]));
  for(const s of LAB_STATIONS) {
    kit.box('wood',[s.x,.82,s.z],[2.2,.09,.75]);
    for(const dx of [-.9,.9]) kit.box('darkMetal',[s.x+dx,.41,s.z],[.08,.82,.6]);
    kit.box('darkMetal',[s.x,1.2,s.z-.06],[1.1,.66,.1]);
    kit.box('paintGreen',[s.x,1.2,s.z],[.99,.55,.015],{color:'#5b9b80',shadow:false});
    kit.box('darkMetal',[s.x,.89,s.z+.22],[.65,.025,.18]);
    c.signs.push(kit.place(sign({text:`${s.letter} / ${s.name}`,width:2.1,height:.27,kind:'panel',background:'#233f35'}),[s.x,1.67,s.z+.01]));
  }
  for(const x of [-60,-54,-48])for(const z of [19.5,24])kit.box('emissiveWarm',[x,5.7,z],[2.2,.04,.45],{shadow:false});
  c.lights.push({position:[-55,4.7,22],intensity:40,distance:17});
  // Clearly authored logistics fixtures: they do not turn decorative businesses into a real economy.
  for(const s of LOGISTICS_SITES) {
    const x=s.x+.9,z=s.z;
    kit.box('paintGreen',[x,.65,z],[.55,1.3,.4]);
    kit.box('bronzeFrame',[x,1.35,z],[.7,.1,.5]);
    c.signs.push(kit.place(sign({text:s.id==='stores'?'SIM / PICKUP':'SIM / DELIVERY',width:1.4,height:.28,kind:'panel',background:'#233f35'}),[x,1.7,z+.22]));
  }
}
