import { HARBOUR_BLOCKS, HARBOUR_LINKS, HARBOUR_NODES, inHarbour } from './harbour.mjs';
import { INDUSTRIAL_NODES, INDUSTRIAL_LINKS, inDistrict } from './getaway.mjs';
import { METRO_PLANTERS, METRO_STREETS, METRO_BUILDINGS, inMetro } from './metro.mjs';
// Metres; +X east, +Z south. Stable authored data is used by rendering, maps and physics.
export const WORLD_LIMIT = 1400;
export const DISTRICTS = [
 {id:'academic',name:'Academic Quarter',x:-300,z:-550,color:'#cbb391',buildings:['Senate & Student Services','Akinola Lecture Hall','Faculty of Engineering']},
 {id:'residential',name:'Palm Residences',x:600,z:55,color:'#c58c72',buildings:['Palm House · Common Room','Neem House · Common Room','Residence Study Lounge']},
 {id:'recreation',name:'Recreation Park',x:600,z:650,color:'#91a98c',buildings:['Sports Pavilion','Team House','Recreation Clubhouse']},
 {id:'learning',name:'Learning Gardens',x:-600,z:-550,color:'#c3ba96',buildings:['Research Reading Room','Seminar House','Learning Studio']},
 {id:'student-life',name:'Student Village',x:-600,z:55,color:'#ccac75',buildings:['Union Hall & Clubs','Village Café','Arts Workshop']},
 {id:'gateway',name:'South Gate & Transport',x:0,z:1250,color:'#9daeb0',buildings:['Transport Terminal','Visitors Centre','Campus Discovery Hall']},
];
export const ROAD_NODES = [
 {id:'nw',x:-600,z:-550},{id:'na',x:-300,z:-550},{id:'nc',x:0,z:-550},{id:'ne',x:600,z:-550},
 {id:'w',x:-600,z:55.55},{id:'hub',x:0,z:55.55},{id:'e',x:600,z:55.55},
 {id:'sw',x:-600,z:650},{id:'sc',x:0,z:650},{id:'se',x:600,z:650},
 {id:'east-village',x:760,z:55.55},{id:'east-park',x:760,z:650},{id:'gate-east',x:160,z:1250},
 {id:'north',x:0,z:-80},{id:'gate',x:0,z:1250}, ...INDUSTRIAL_NODES, ...HARBOUR_NODES,
];
// Metropolitan City's street grid: a node wherever two streets meet (existing Exchange and freight nodes are
// reused), and an edge between consecutive nodes along each street.
const METRO_EDGES=(()=>{
 const key=(x,z)=>Math.round(x*100)+':'+Math.round(z*100),byKey=new Map(ROAD_NODES.map(n=>[key(n.x,n.z),n]));
 const nodeAt=(x,z)=>{const k=key(x,z);let n=byKey.get(k);if(!n){n={id:`metro-${Math.round(x)}-${Math.round(z)}`,x,z};byKey.set(k,n);ROAD_NODES.push(n);}return n;};
 const on=(st,x,z)=>st[0]==='h'?Math.abs(z-st[1])<.01&&x>=Math.min(st[2],st[3])-.01&&x<=Math.max(st[2],st[3])+.01:Math.abs(x-st[1])<.01&&z>=Math.min(st[2],st[3])-.01&&z<=Math.max(st[2],st[3])+.01;
 const out=[];
 for(const st of METRO_STREETS){
  const pts=[];const push=(x,z)=>{if(on(st,x,z)&&!pts.some(p=>Math.abs(p[0]-x)<.01&&Math.abs(p[1]-z)<.01))pts.push([x,z]);};
  if(st[0]==='h'){push(st[2],st[1]);push(st[3],st[1]);}else{push(st[1],st[2]);push(st[1],st[3]);}
  for(const o of METRO_STREETS){if(o===st||o[0]===st[0])continue;if(st[0]==='h')push(o[1],st[1]);else push(st[1],o[1]);}
  for(const n of [...ROAD_NODES])push(n.x,n.z);
  pts.sort((a,b)=>st[0]==='h'?a[0]-b[0]:a[1]-b[1]);
  for(let i=1;i<pts.length;i++){const a=nodeAt(...pts[i-1]),b=nodeAt(...pts[i]);if(!out.some(([p,q])=>p===a.id&&q===b.id||p===b.id&&q===a.id))out.push([a.id,b.id]);}
 }
 return out;
})();
const roadNode=id=>{const node=ROAD_NODES.find(n=>n.id===id);if(!node)throw Error('Unknown road node '+id);return node;};
const edges=[['nw','na'],['na','nc'],['nc','ne'],['nw','w'],['w','sw'],['ne','e'],['e','se'],['sw','sc'],['sc','se'],['w','hub'],['hub','sc'],['sc','gate'],['nc','north'],['e','east-village'],['se','east-park'],['gate','gate-east'],...INDUSTRIAL_LINKS,...HARBOUR_LINKS];
// (Metro streets that duplicate an Exchange or freight road are left out.)
for(const [a,b] of METRO_EDGES)if(!edges.some(([p,q])=>p===a&&q===b||p===b&&q===a))edges.push([a,b]);
// Two-lane carriageways, 8 m kerb to kerb. The hub road continues the courtyard's own road (z 51.6–59.5).
export const ROAD_WIDTH=8;
export const ROADS=edges.map(([a,b],i)=>({id:`road-${i}`,a:roadNode(a),b:roadNode(b),width:ROAD_WIDTH}));
/** The original campus road outside the gate, already built (with kerbs and markings) by the courtyard. */
export const COURTYARD_ROAD={x0:-90,x1:90,z0:51.6,z1:59.5};
/** Bays on the south side of the courtyard road; the drivable area overlaps the road so cars can pull out. */
export const COURTYARD_PARKING={x:18,z:63,w:24,d:7};
/** Flared corners (curb returns) where two roads meet, so a car can turn without clipping the kerb. */
export const JUNCTION_RADIUS=5;
export const JUNCTIONS=ROAD_NODES.map(n=>{const arms=ROADS.filter(r=>r.a===n||r.b===n).map(r=>{const o=r.a===n?r.b:r.a;return [Math.sign(o.x-n.x),Math.sign(o.z-n.z)];});return {id:n.id,x:n.x,z:n.z,arms};}).filter(j=>j.arms.length>1);
export const ROAD_LENGTH=ROADS.reduce((n,r)=>n+Math.hypot(r.a.x-r.b.x,r.a.z-r.b.z),0);
export const BUILDINGS=DISTRICTS.flatMap(d=>d.buildings.map((name,i)=>({id:`${d.id}-${i}`,district:d.id,name,x:d.x+(i+1)*48,z:d.z-43,w:30,d:26,h:i===0?9:7,color:d.color})));
export const EXPANSION_LOCATIONS=BUILDINGS.map(b=>({id:b.id,name:b.name,type:b.district==='residential'?'Residence common room':b.district==='academic'||b.district==='learning'?'Class & study space':'Campus gathering space',x:b.x,z:b.z+10,icon:'grid',description:'Open ground floor · shared seating · student gatherings.'}));
export const PARKING=DISTRICTS.map(d=>({id:d.id,x:d.x+30,z:d.z+22,w:36,d:22}));
export const STOPS=DISTRICTS.map(d=>({id:d.id,name:d.name,x:d.x+8,z:d.z+10}));
// Entrance walks run from each front door to the road's sidewalk (which starts 4.2 m from the road centre).
export const EXPANSION_PATHS=BUILDINGS.map(b=>({x:b.x,z:(b.z+13+(b.z+43-5))/2,w:4,d:25}));
export const EXPANSION_SEATS=BUILDINGS.flatMap(b=>[-6,0,6].flatMap(dx=>[-5,2].map((dz,i)=>({id:`${b.id}-seat-${dx}-${i}`,x:b.x+dx,z:b.z+dz,y:.5,yaw:Math.PI,kind:'chair',model:'schoolChair',table:true,pull:.25}))));
export const EXPANSION_TABLES=EXPANSION_SEATS.map(s=>({x:s.x,z:s.z-.92,w:1.6,d:.6}));
export const EXPANSION_WALLS=BUILDINGS.flatMap(b=>[
 {x:b.x-b.w/2,z:b.z,w:.4,d:b.d,h:b.h},{x:b.x+b.w/2,z:b.z,w:.4,d:b.d,h:b.h},
 {x:b.x,z:b.z-b.d/2,w:b.w,d:.4,h:b.h},
 ...[-1,1].map(s=>({x:b.x+s*(b.w/4+1),z:b.z+b.d/2,w:b.w/2-2,d:.4,h:b.h})),
 // Entrance canopy columns.
 ...[-1,1].map(s=>({x:b.x+s*3.4,z:b.z+b.d/2+4.3,w:.2,d:.2,h:3.5})),
]);
// Roads have sidewalks: the transport network (vehicles may also leave it; see shared/vehicles.mjs).
const rect=(x,z,c,pad=0)=>Math.abs(x-c.x)<=c.w/2-pad&&Math.abs(z-c.z)<=c.d/2-pad;
/** Dead ends finish in a turning circle. */
export const TURNAROUNDS=ROAD_NODES.filter(n=>ROADS.filter(r=>r.a===n||r.b===n).length===1).map(n=>({id:n.id,x:n.x,z:n.z,r:10}));
export const roadRect=r=>({x:(r.a.x+r.b.x)/2,z:(r.a.z+r.b.z)/2,w:Math.abs(r.a.x-r.b.x)+r.width,d:Math.abs(r.a.z-r.b.z)+r.width});
/** Driveway from each district road into its car park. */
export const DRIVEWAYS=DISTRICTS.map(d=>({id:d.id,x:d.x+30,z:d.z+12,w:12,d:26}));
const JUNCTION_PADS=JUNCTIONS.map(j=>({x:j.x,z:j.z,w:ROAD_WIDTH+2*JUNCTION_RADIUS,d:ROAD_WIDTH+2*JUNCTION_RADIUS}));
const COURTYARD_DRIVE={x:COURTYARD_PARKING.x,z:(COURTYARD_ROAD.z0+COURTYARD_PARKING.z+COURTYARD_PARKING.d/2)/2,w:COURTYARD_PARKING.w,d:COURTYARD_PARKING.z+COURTYARD_PARKING.d/2-COURTYARD_ROAD.z0};
export function transportSurface(x,z,pad=0){return ROADS.some(r=>rect(x,z,roadRect(r),pad))||JUNCTION_PADS.some(j=>rect(x,z,j,pad))||PARKING.some(p=>rect(x,z,p,pad))||DRIVEWAYS.some(d=>rect(x,z,d,pad))||rect(x,z,COURTYARD_DRIVE,pad)||TURNAROUNDS.some(t=>Math.hypot(x-t.x,z-t.z)<=t.r-pad);}
// Shade trees line every road behind its sidewalk (royal palms on the gateway avenue). Shared, so
// their trunks collide identically on clients and the room server.
const near=(x,z,list,pad)=>list.some(c=>Math.abs(x-c.x)<c.w/2+pad&&Math.abs(z-c.z)<c.d/2+pad);
export const ROADSIDE_TREES=(()=>{
 const out=[],shade=['terminalia','neem','mango','flamboyant','neem','mango'];let k=0;
 const pitch=DISTRICTS.filter(d=>d.id==='recreation').map(d=>({x:d.x-100,z:d.z-90,w:72,d:110}));
 for(const r of ROADS){
  const horizontal=r.a.z===r.b.z,lo=horizontal?Math.min(r.a.x,r.b.x):Math.min(r.a.z,r.b.z),hi=horizontal?Math.max(r.a.x,r.b.x):Math.max(r.a.z,r.b.z),c=horizontal?r.a.z:r.a.x;
  const avenue=!horizontal&&c===0&&lo>=55;
  for(const side of [-1,1])for(let t=lo+16+(side>0?0:12);t<hi-14;t+=24){
   const x=horizontal?t:c+side*(r.width/2+4.2),z=horizontal?c+side*(r.width/2+4.2):t;
   if(inDistrict(x,z,5)||inHarbour(x,z,2)||near(x,z,METRO_BUILDINGS,3.5)||inMetro(x,z)&&z<1810&&x>-8||Math.abs(x)<100&&z>35&&z<75)continue;
   if(ROAD_NODES.some(n=>Math.hypot(n.x-x,n.z-z)<16)||transportSurface(x,z,-2.5))continue;
   if(near(x,z,BUILDINGS,4)||near(x,z,PARKING,4)||near(x,z,pitch,2)||STOPS.some(p=>Math.hypot(p.x-x,p.z-z)<7))continue;
   if(DISTRICTS.some(d=>Math.abs(x-(d.x+48))<4&&Math.abs(z-d.z)<12))continue;
   const h=Math.sin(x*12.9898+z*78.233)*43758.5453,f=h-Math.floor(h);
   out.push({x:Math.round(x*100)/100,z:Math.round(z*100)/100,species:avenue?'royal':shade[k++%shade.length],s:Math.round((.85+f*.3)*100)/100});
  }
 }
 out.push(...METRO_PLANTERS);
 out.push(...HARBOUR_BLOCKS.flatMap((b,i)=>[-1,1].map(side=>({
  x:b.x+side*16,z:b.z+b.d/2-1.3,species:i%3===0?'royal':i%3===1?'neem':'terminalia',s:i%3===0?.7:.62,
 }))));
 return out;
})();
// Woodland between the courtyard walls and the districts (formerly scenery only, now walkable):
// kept off roads, car parks and buildings, and collidable like every other tree.
export const BELT_TREES=(()=>{
 let seed=4242;const r=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
 const out=[],species=['mango','neem','mango','flamboyant','mango','coconut','neem'];
 for(let i=0;out.length<240&&i<4000;i++){
  const inner=i%5<3,a=r()*Math.PI*2,d=inner?82+r()*34:110+Math.pow(r(),.7)*160,x=Math.cos(a)*d*1.05,z=Math.sin(a)*d-4,s=.9+r()*.5;
  if(Math.abs(x)<78&&z>-72&&z<68)continue;
  if(Math.abs(x)<100&&z>40&&z<75)continue;
  if(transportSurface(x,z,-4.5)||near(x,z,BUILDINGS,5)||near(x,z,PARKING,5)||ROADSIDE_TREES.some(t=>Math.hypot(t.x-x,t.z-z)<5)||out.some(t=>Math.hypot(t.x-x,t.z-z)<3.5))continue;
  out.push({x:Math.round(x*100)/100,z:Math.round(z*100)/100,species:species[i%species.length],s:Math.round(s*100)/100});
 }
 return out.filter(t=>!inDistrict(t.x,t.z,5));
})();
// Dijkstra on actual roads. Start/end are projected onto edges, never an arbitrary line through buildings.
export function roadRoute(from,to){
 const project=p=>ROADS.map(r=>{const dx=r.b.x-r.a.x,dz=r.b.z-r.a.z,t=Math.max(0,Math.min(1,((p.x-r.a.x)*dx+(p.z-r.a.z)*dz)/(dx*dx+dz*dz)));const q={x:r.a.x+dx*t,z:r.a.z+dz*t};return {r,q,d:Math.hypot(q.x-p.x,q.z-p.z)};}).sort((a,b)=>a.d-b.d)[0];
 const s=project(from),e=project(to),nodes=[...ROAD_NODES,{id:'start',...s.q},{id:'end',...e.q}],links=ROADS.map(r=>[r.a.id,r.b.id]);
 links.push(['start',s.r.a.id],['start',s.r.b.id],['end',e.r.a.id],['end',e.r.b.id]);if(s.r.id===e.r.id)links.push(['start','end']);
 const dist={start:0},prev={},todo=new Set(nodes.map(n=>n.id)),by=Object.fromEntries(nodes.map(n=>[n.id,n]));
 while(todo.size){const id=[...todo].sort((a,b)=>(dist[a]??Infinity)-(dist[b]??Infinity))[0];todo.delete(id);if(id==='end')break;for(const link of links){const next=link[0]===id?link[1]:link[1]===id?link[0]:null;if(!next||!todo.has(next))continue;const d=dist[id]+Math.hypot(by[id].x-by[next].x,by[id].z-by[next].z);if(d<(dist[next]??Infinity)){dist[next]=d;prev[next]=id;}}}
 const path=[];let id='end';while(id){path.unshift(by[id]);id=prev[id];}return {points:path,distance:dist.end,startDistance:s.d,endDistance:e.d};
}
