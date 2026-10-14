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
 {id:'w',x:-600,z:55},{id:'hub',x:0,z:55},{id:'e',x:600,z:55},
 {id:'sw',x:-600,z:650},{id:'sc',x:0,z:650},{id:'se',x:600,z:650},
 {id:'east-village',x:760,z:55},{id:'east-park',x:760,z:650},{id:'gate-east',x:160,z:1250},
 {id:'north',x:0,z:-80},{id:'gate',x:0,z:1250},
];
const roadNode=id=>{const node=ROAD_NODES.find(n=>n.id===id);if(!node)throw Error('Unknown road node '+id);return node;};
const edges=[['nw','na'],['na','nc'],['nc','ne'],['nw','w'],['w','sw'],['ne','e'],['e','se'],['sw','sc'],['sc','se'],['w','hub'],['hub','e'],['hub','sc'],['sc','gate'],['nc','north'],['e','east-village'],['se','east-park'],['gate','gate-east']];
export const ROADS=edges.map(([a,b],i)=>({id:`road-${i}`,a:roadNode(a),b:roadNode(b),width:12}));
export const ROAD_LENGTH=ROADS.reduce((n,r)=>n+Math.hypot(r.a.x-r.b.x,r.a.z-r.b.z),0);
export const BUILDINGS=DISTRICTS.flatMap(d=>d.buildings.map((name,i)=>({id:`${d.id}-${i}`,district:d.id,name,x:d.x+(i+1)*48,z:d.z-43,w:30,d:26,h:i===0?9:7,color:d.color})));
export const EXPANSION_LOCATIONS=BUILDINGS.map(b=>({id:b.id,name:b.name,type:b.district==='residential'?'Residence common room':b.district==='academic'||b.district==='learning'?'Class & study space':'Campus gathering space',x:b.x,z:b.z+10,icon:'grid',description:'Open ground floor · shared seating · student gatherings.'}));
export const PARKING=DISTRICTS.map(d=>({id:d.id,x:d.x+30,z:d.z+22,w:36,d:22}));
export const STOPS=DISTRICTS.map(d=>({id:d.id,name:d.name,x:d.x+8,z:d.z+10}));
export const EXPANSION_PATHS=BUILDINGS.map(b=>({x:b.x,z:(b.z+13+(b.z+43-8))/2,w:4,d:22}));
export const EXPANSION_SEATS=BUILDINGS.flatMap(b=>[-6,0,6].flatMap(dx=>[-5,2].map((dz,i)=>({id:`${b.id}-seat-${dx}-${i}`,x:b.x+dx,z:b.z+dz,y:.5,yaw:Math.PI,kind:'chair',model:'schoolChair',table:true,pull:.25}))));
export const EXPANSION_TABLES=EXPANSION_SEATS.map(s=>({x:s.x,z:s.z-.92,w:1.6,d:.6}));
export const EXPANSION_WALLS=BUILDINGS.flatMap(b=>[
 {x:b.x-b.w/2,z:b.z,w:.4,d:b.d,h:b.h},{x:b.x+b.w/2,z:b.z,w:.4,d:b.d,h:b.h},
 {x:b.x,z:b.z-b.d/2,w:b.w,d:.4,h:b.h},
 ...[-1,1].map(s=>({x:b.x+s*(b.w/4+1),z:b.z+b.d/2,w:b.w/2-2,d:.4,h:b.h})),
]);
// Roads have sidewalks. Cars stay on transport surfaces, keeping courts, fields and classrooms safe.
const rect=(x,z,c,pad=0)=>Math.abs(x-c.x)<=c.w/2-pad&&Math.abs(z-c.z)<=c.d/2-pad;
export function transportSurface(x,z,pad=0){return ROADS.some(r=>rect(x,z,{x:(r.a.x+r.b.x)/2,z:(r.a.z+r.b.z)/2,w:Math.abs(r.a.x-r.b.x)+r.width,d:Math.abs(r.a.z-r.b.z)+r.width},pad))||PARKING.some(p=>rect(x,z,p,pad))||DISTRICTS.some(d=>rect(x,z,{x:d.x+30,z:d.z+12,w:12,d:26},pad))||rect(x,z,{x:0,z:61,w:26,d:20},pad);}
// Dijkstra on actual roads. Start/end are projected onto edges, never an arbitrary line through buildings.
export function roadRoute(from,to){
 const project=p=>ROADS.map(r=>{const dx=r.b.x-r.a.x,dz=r.b.z-r.a.z,t=Math.max(0,Math.min(1,((p.x-r.a.x)*dx+(p.z-r.a.z)*dz)/(dx*dx+dz*dz)));const q={x:r.a.x+dx*t,z:r.a.z+dz*t};return {r,q,d:Math.hypot(q.x-p.x,q.z-p.z)};}).sort((a,b)=>a.d-b.d)[0];
 const s=project(from),e=project(to),nodes=[...ROAD_NODES,{id:'start',...s.q},{id:'end',...e.q}],links=ROADS.map(r=>[r.a.id,r.b.id]);
 links.push(['start',s.r.a.id],['start',s.r.b.id],['end',e.r.a.id],['end',e.r.b.id]);if(s.r.id===e.r.id)links.push(['start','end']);
 const dist={start:0},prev={},todo=new Set(nodes.map(n=>n.id)),by=Object.fromEntries(nodes.map(n=>[n.id,n]));
 while(todo.size){const id=[...todo].sort((a,b)=>(dist[a]??Infinity)-(dist[b]??Infinity))[0];todo.delete(id);if(id==='end')break;for(const link of links){const next=link[0]===id?link[1]:link[1]===id?link[0]:null;if(!next||!todo.has(next))continue;const d=dist[id]+Math.hypot(by[id].x-by[next].x,by[id].z-by[next].z);if(d<(dist[next]??Infinity)){dist[next]=d;prev[next]=id;}}}
 const path=[];let id='end';while(id){path.unshift(by[id]);id=prev[id];}return {points:path,distance:dist.end,startDistance:s.d,endDistance:e.d};
}
