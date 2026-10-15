import { WORLD_LIMIT, EXPANSION_LOCATIONS, EXPANSION_WALLS, ROADSIDE_TREES, BELT_TREES } from './expansion.mjs';
import { DOORS, TABLES } from './interactions.mjs';
import { LOCKED_ACCENTS } from './achievements.mjs';
import { DORM_WALLS } from './dorm.mjs';
export const BRAND = { name: 'CampOS', product: 'Worlds', campus: 'Òrìṣun Campus', subtitle: 'A new world. Your people.', room: 'The Courtyard' };
// Spawn on the main avenue, facing north towards The Confluence and Horizon Auditorium.
export const SPAWN = { x: 0, y: 0, z: 36 };
export const LOCATIONS = [
 ...EXPANSION_LOCATIONS,
 {id:'orientation',name:'Welcome Pavilion',type:'Orientation',x:-12,z:26,icon:'compass',description:'Your first steps, made a little easier.'},
 {id:'landmark',name:'The Confluence',type:'Landmark',x:0,z:8,icon:'sparkles',description:'Different paths. A shared future.'},
 {id:'library',name:'Adunni Learning Commons',type:'Library',x:-24.5,z:-1.6,icon:'book',description:'Room for your next big idea.'},
 {id:'student',name:'The Student House',type:'Community & café',x:29,z:1,icon:'coffee',description:'Find your people over a good conversation.'},
 {id:'lecture',name:'Horizon Auditorium',type:'Talks & events',x:0,z:-32,icon:'calendar',description:'Fresh perspectives start here.'},
 {id:'sports',name:'The Courts',type:'Play & recreation',x:40,z:24,icon:'ball',description:'Take a study break. Take your shot.'},
 {id:'notice',name:'Campus Noticeboard',type:'Around campus',x:13,z:19.5,icon:'board',description:'The small things you should not miss.'},
 {id:'services',name:'CampOS Connect',type:'Student services',x:-23,z:24,icon:'grid',description:'Your campus services, one step away.'},
];
export const TOUR = ['orientation','landmark','library','student','lecture'];
export const TOKENS = [{id:'t1',x:-10,z:17},{id:'t2',x:-30,z:-14},{id:'t3',x:25,z:6},{id:'t4',x:8,z:-28},{id:'t5',x:42,z:32},{id:'t6',x:-19,z:37}];

// Shade trees and palms are shared so trunks collide identically on client and server.
// species: terminalia | flamboyant | mango | neem | royal | coconut
export const TREES = [
 // Royal palm avenue from the gate to the courtyard.
 ...[40,34,28,22,16].flatMap((z,i)=>[{x:-7.6,z,species:'royal',s:1+((i*7)%5)*.03},{x:7.6,z,species:'royal',s:1.04-((i*3)%5)*.03}]),
 // Courtyard shade: tiered umbrella trees and flamboyants framing The Confluence.
 {x:-17,z:-12,species:'terminalia',s:1.05},{x:17,z:-14,species:'flamboyant',s:1},{x:-18,z:16,species:'flamboyant',s:1.1},{x:19,z:15,species:'terminalia',s:.95},
 {x:-13,z:-24,species:'neem',s:.95},{x:10.8,z:-19.5,species:'terminalia',s:.9},
 // Lawns south of the cross walk.
 {x:-32,z:15,species:'mango',s:1.15},{x:-41,z:23,species:'terminalia',s:1},{x:-40,z:30,species:'neem',s:1.05},{x:-22,z:39,species:'flamboyant',s:.95},
 {x:27,z:16,species:'mango',s:1},{x:24,z:43,species:'neem',s:1},{x:36,z:46,species:'terminalia',s:1.1},{x:50,z:46,species:'mango',s:.95},
 // Around the library, student house and the north walk.
 {x:-44,z:-2,species:'neem',s:.9},{x:-14,z:-34,species:'flamboyant',s:.9},{x:22,z:-28,species:'neem',s:.95},{x:-26,z:-33,species:'terminalia',s:1},
 {x:48,z:-1,species:'flamboyant',s:1.05},{x:58,z:6,species:'mango',s:1.1},{x:61,z:-22,species:'terminalia',s:1.1},{x:-64,z:-30,species:'mango',s:1.05},
 {x:-66,z:22,species:'terminalia',s:1},{x:-62,z:44,species:'mango',s:1.1},{x:63,z:30,species:'neem',s:1},{x:64,z:72,species:'terminalia',s:.9},
 // Palms around the courts, café and gardens.
 {x:30,z:8,species:'coconut',s:1},{x:34,z:-23,species:'coconut',s:.95},{x:56,z:12,species:'coconut',s:1.05},{x:57,z:36,species:'coconut',s:.95},
 {x:-27,z:-30,species:'coconut',s:1},{x:-9,z:-30,species:'coconut',s:1.05},{x:9,z:-31,species:'coconut',s:.95},{x:-44,z:8,species:'coconut',s:1},
 {x:-37,z:26,species:'coconut',s:.95},{x:-52,z:28,species:'coconut',s:1.05},
];

/** Low shelving under the library's north windows, with a gap in front of the staff-room door. */
export const LOW_SHELVES=Array.from({length:9},(_,k)=>({x:-40.9+k*2.4+1.1,z:-25.3,w:2.2,d:.38,h:1})).filter(s=>Math.abs(s.x+34.95)>1.7);
// Axis-aligned boxes are shared by rendering, client movement and server validation.
const LIBRARY = [
 ...LOW_SHELVES,
 {x:-41.8,z:-15,w:.6,d:22,h:10},{x:-18.2,z:-15,w:.6,d:22,h:10},{x:-30,z:-25.8,w:24,d:.6,h:10},
 {x:-37,z:-4.3,w:10,d:.6,h:10},{x:-23,z:-4.3,w:10,d:.6,h:10},
 // Reading-room shelving bays, issue desk and the new-arrivals display.
 ...[-39.6,-20.4].flatMap(x=>[-23.6,-19,-14.4].map(z=>({x,z,w:2.2,d:1.2,h:2.4}))),
 {x:-22.5,z:-7.5,w:3.1,d:.95,h:1.1},{x:-20.95,z:-8.4,w:.95,d:1.9,h:1.1},{x:-30,z:-23.2,w:2.2,d:.7,h:1},
];
export const COLLIDERS = [
 ...EXPANSION_WALLS,
 // The residents' wing behind Palm House (shared/dorm.mjs).
 ...DORM_WALLS,
 {x:0,z:-64.6,w:139.2,d:.4,h:2.7},{x:-69.6,z:-7.3,w:.4,d:114.6,h:2.7},{x:69.6,z:-7.3,w:.4,d:114.6,h:2.7},
 ...LIBRARY,
 // The Student House: kitchen block behind an enterable café (front glazing either side of the door).
 {x:30,z:-16.15,w:25,d:7.7,h:9},{x:17.8,z:-8.25,w:.6,d:8.1,h:9},{x:42.2,z:-8.25,w:.6,d:8.1,h:9},
 {x:21.725,z:-4.45,w:8.45,d:.5,h:4},{x:35.225,z:-4.45,w:14.55,d:.5,h:4},{x:26.5,z:-10.4,w:9.2,d:1,h:1.1},
 {x:0,z:-43,w:32,d:17,h:13},{x:-52,z:-45,w:20,d:17,h:14},
 // School of Design: an open ground-floor gallery with one enterable classroom (D1).
 {x:45.25,z:-44.2,w:15.5,d:15.6,h:13},{x:34.25,z:-47.5,w:6.5,d:9,h:13},{x:31.15,z:-39.7,w:.3,d:6.6,h:4},
 {x:31.6,z:-36.55,w:1.2,d:.3,h:4},{x:35.35,z:-36.55,w:4.3,d:.3,h:4},{x:51.2,z:-35.2,w:3.6,d:2.4,h:11},
 ...[31,34.67,38.33,42,45.67].map(x=>({x,z:-34.2,w:.35,d:.35,h:11})),
 // The Confluence fountain pool, approximated by a cross of boxes.
 {x:0,z:0,w:8.9,d:8.9,h:3},{x:0,z:0,w:12.4,d:5.6,h:3},{x:0,z:0,w:5.6,d:12.4,h:3},
 // Boundary wall and gateway pylons with an open central passage.
 {x:-39.25,z:50,w:59.5,d:1,h:3},{x:39.25,z:50,w:59.5,d:1,h:3},
 {x:-7.6,z:50,w:2.4,d:3.2,h:7},{x:7.6,z:50,w:2.4,d:3.2,h:7},
 {x:15,z:46.5,w:3.4,d:3,h:3},
 {x:13,z:20.2,w:4.2,d:.6,h:3},{x:-23,z:22,w:4,d:2,h:3},{x:-48,z:34.4,w:8.6,d:.4,h:3},
 // Basketball cage: chain-link fence with a wide opening facing the campus (west).
 {x:44,z:8.6,w:22.8,d:.2,h:3.5},{x:55.4,z:24,w:.2,d:31,h:3.5},{x:44,z:39.4,w:22.8,d:.2,h:3.5},
 {x:32.6,z:12,w:.2,d:6.8,h:3.5},{x:32.6,z:35.45,w:.2,d:7.9,h:3.5},
// Tabletops block only their own footprint (shrunk by the player radius used below).
 ...TABLES.map(t=>({x:t.x,z:t.z,w:Math.max(.1,t.w-.6),d:Math.max(.1,t.d-.6),h:.8})),
 ...[...TREES,...ROADSIDE_TREES,...BELT_TREES].map(t=>({x:t.x,z:t.z,w:t.species==='royal'||t.species==='coconut'?.5:.7,d:t.species==='royal'||t.species==='coconut'?.5:.7,h:6})),
];
// Door state is held per process (room server or client) and updated from the authoritative world:
// 0 = closed, +1 / -1 = open, swung towards +z / -z. A closed (or locked) door blocks its doorway.
export const doorOpen = Object.fromEntries(DOORS.map(d=>[d.id,0]));
export function setDoorOpen(id,open){const d=DOORS.find(x=>x.id===id);if(!d||d.locked)return;doorOpen[id]=open===true?d.swing:open===false?0:Math.sign(Number(open)||0);}
const hit=(b,x,z,r)=>Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r;
/** Body radius for walking: about shoulder width, so a 1 m doorway leaves a comfortable 40 cm. */
export const PLAYER_RADIUS=.3;
// 32 m cells with numeric keys (movement checks run for every substep of every player: no string keys).
const collisionGrid=new Map(),cell=(ix,iz)=>(ix+4096)*8192+iz+4096;
for(const b of COLLIDERS)for(let ix=Math.floor((b.x-b.w/2)/32);ix<=Math.floor((b.x+b.w/2)/32);ix++)for(let iz=Math.floor((b.z-b.d/2)/32);iz<=Math.floor((b.z+b.d/2)/32);iz++){const key=cell(ix,iz);if(!collisionGrid.has(key))collisionGrid.set(key,[]);collisionGrid.get(key).push(b);}
function hitsStatic(x,z,r){for(let ix=Math.floor((x-r)/32);ix<=Math.floor((x+r)/32);ix++)for(let iz=Math.floor((z-r)/32);iz<=Math.floor((z+r)/32);iz++){const list=collisionGrid.get(cell(ix,iz));if(list)for(const b of list)if(hit(b,x,z,r))return true;}return false;}
const seen=new Set(),found=[];
/** Static colliders that may overlap the box [x0, x1] × [z0, z1]. Returns a shared array, valid until the next call. */
export function collidersIn(x0,z0,x1,z1){seen.clear();found.length=0;for(let ix=Math.floor(x0/32);ix<=Math.floor(x1/32);ix++)for(let iz=Math.floor(z0/32);iz<=Math.floor(z1/32);iz++){const list=collisionGrid.get(cell(ix,iz));if(list)for(const b of list)if(!seen.has(b)){seen.add(b);found.push(b);}}return found;}
export function blocked(x,z,r=PLAYER_RADIUS){return !Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>WORLD_LIMIT||Math.abs(z)>WORLD_LIMIT||hitsStatic(x,z,r)||DOORS.some(d=>!doorOpen[d.id]&&hit(d.collider,x,z,r));}
const SLIP=[.05,-.05,.1,-.1];
export function moveWithCollisions(x,z,dx,dz){
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.18));
 const sx=dx/steps,sz=dz/steps;
 for(let i=0;i<steps;i++){
  // Slide along walls; brushing a corner (a door frame) slips a few centimetres sideways around it.
  if(!blocked(x+sx,z))x+=sx;else if(Math.abs(sx)>Math.abs(sz))for(const n of SLIP)if(!blocked(x+sx,z+n)){x+=sx;z+=n;break;}
  if(!blocked(x,z+sz))z+=sz;else if(Math.abs(sz)>Math.abs(sx))for(const n of SLIP)if(!blocked(x+n,z+sz)){x+=n;z+=sz;break;}
 }
 return {x,z};
}

// Avatars: a realistic base character, an optional skin-tone shift, an accent colour
// (bag, headphones, frames and name tag) and one accessory.
export const MODELS=['tunde','amara','chidi','ngozi','kelechi','zainab','ibrahim','ada','mel'];
export const SKINS=['natural','#3a2219','#5b3424','#7a4a31','#a66b46','#cb9168'];
export const ACCENTS=['#353c4c','#537d70','#b05f49','#506b96','#e8b95e','#eee9df'];
export const ACCESSORIES=['none','backpack','headphones','glasses'];
/** Accent colours earned with an achievement (shared/achievements.mjs): usable only once unlocked. */
export const EARNED_ACCENTS=Object.keys(LOCKED_ACCENTS);
/** For showing an avatar the server has already validated (profile cards, other players): any known colour. */
export function displayAvatar(a={}){return sanitizeAvatar(a,Object.values(LOCKED_ACCENTS));}
/** Keep only known appearance choices; an earned accent needs its achievement id in `unlocked`. */
export function sanitizeAvatar(a={},unlocked=[]){const earned=LOCKED_ACCENTS[a.accent];return {model:MODELS.includes(a.model)?a.model:MODELS[0],skin:SKINS.includes(a.skin)?a.skin:SKINS[0],accent:ACCENTS.includes(a.accent)||(earned&&unlocked.includes(earned))?a.accent:ACCENTS[0],accessory:ACCESSORIES.includes(a.accessory)?a.accessory:'backpack'};}
