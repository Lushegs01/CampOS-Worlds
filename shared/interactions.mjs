import { LAB_DOOR } from './economic-lab.mjs';
import { EXPANSION_SEATS, EXPANSION_TABLES } from './expansion.mjs';
// Interactive fixtures shared by the renderer, client prediction and the authoritative room server.
// Everything a player can sit on, open, pick up or use is defined here once, with stable ids.

const rotate = (x, z, yaw) => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];

// ---------------------------------------------------------------- furniture
/** Timber benches: x, z, facing yaw (direction a seated person looks), length. */
export const BENCHES = [
 // Welcome Pavilion and shuttle shelter.
 {x:-13.8,z:27.2,yaw:0},{x:-10.2,z:27.2,yaw:0},{x:-49.6,z:35.1,yaw:0},{x:-46.4,z:35.1,yaw:0},
 // Courtyard edges, lawns and the north walk.
 {x:-22,z:13.6,yaw:0},{x:-34,z:13.6,yaw:0},{x:22,z:13.6,yaw:0},{x:-20,z:30.4,yaw:Math.PI},
 {x:-8,z:-25.7,yaw:Math.PI},{x:8,z:-25.7,yaw:Math.PI},{x:-30,z:-31.7,yaw:0},{x:30,z:-31.7,yaw:0},
 // Auditorium forecourt, facing the avenue.
 {x:-6.6,z:-29.6,yaw:Math.PI/2},{x:-6.6,z:-31.8,yaw:Math.PI/2},{x:6.6,z:-29.6,yaw:-Math.PI/2},{x:6.6,z:-31.8,yaw:-Math.PI/2},
 // The Confluence: four benches on the diagonals between the entrances, facing the fountain.
 ...[40,140,220,320].map(d=>d*Math.PI/180).map(a=>({x:Math.cos(a)*9.1,z:Math.sin(a)*9.1,yaw:-a-Math.PI/2})),
].map(b=>({len:1.9,...b}));

export const LIBRARY_TABLES = [[-34.2,-19.5],[-34.2,-10.5],[-25.8,-19.5],[-25.8,-10.5]];
export const LIBRARY_COMPUTERS = [{id:'pc-1',x:-41.05,z:-11.2},{id:'pc-2',x:-41.05,z:-8.6}];
export const CAFE_TERRACE_TABLES = [21.5,25.5,33,37.5].flatMap(x=>[-1.6,1.4].map(z=>[x,z]));
export const CAFE_INTERIOR_TABLES = [[35,-7.4],[39,-7.4]];
/** One classroom on the School of Design ground floor, behind the open gallery. */
export const CLASSROOM = {x0:31.3,x1:37.5,z0:-43,z1:-36.55,desks:[33.9,36.2].flatMap(x=>[-38.6,-40.4].map(z=>[x,z]))};

// Seat anchors: (x, z) is the seat centre when seated, y the seat height, yaw the direction the sitter faces.
// Table chairs rest `pull` metres back from it: the sitter sits on the pulled-out chair, then scoots in.
const PULL = .25, seats = [];
BENCHES.forEach((b,i)=>{for(const o of [-.45,.45]){const [dx,dz]=rotate(o,-.04,b.yaw);seats.push({id:`bench-${i}-${o<0?'l':'r'}`,x:b.x+dx,z:b.z+dz,y:.495,yaw:b.yaw,kind:'bench',table:false,pull:0});}});
LIBRARY_TABLES.forEach(([x,z],t)=>{for(const dx of [-.8,0,.8])for(const side of [-1,1])seats.push({id:`lib-${t}-${dx}-${side}`,x:x+dx,z:z+side*1.02,y:.5,yaw:side<0?0:Math.PI,kind:'chair',model:'schoolChair',table:true,pull:PULL});});
LIBRARY_COMPUTERS.forEach(c=>seats.push({id:`${c.id}-chair`,x:c.x+1.02,z:c.z,y:.5,yaw:-Math.PI/2,kind:'chair',model:'schoolChair',table:true,pull:PULL,computer:c.id}));
CAFE_TERRACE_TABLES.forEach(([x,z],t)=>{for(let a=0;a<4;a++){const ang=a*Math.PI/2+.4;seats.push({id:`terrace-${t}-${a}`,x:x+Math.sin(ang)*1.02,z:z+Math.cos(ang)*1.02,y:.44,yaw:ang+Math.PI,kind:'chair',model:'monobloc',table:true,pull:PULL});}});
CAFE_INTERIOR_TABLES.forEach(([x,z],t)=>{for(let a=0;a<3;a++){const ang=a*2.094+Math.PI;seats.push({id:`cafe-${t}-${a}`,x:x+Math.sin(ang)*1.02,z:z+Math.cos(ang)*1.02,y:.44,yaw:ang+Math.PI,kind:'chair',model:'monobloc',table:true,pull:PULL});}});
CLASSROOM.desks.forEach(([x,z],d)=>{for(const dx of [-.42,.42])seats.push({id:`class-${d}-${dx<0?'l':'r'}`,x:x+dx,z:z+.92,y:.5,yaw:Math.PI,kind:'chair',model:'schoolChair',table:true,pull:PULL});});
export const SEATS = [...seats,...EXPANSION_SEATS];
export const SEAT_BY_ID = new Map(SEATS.map(s=>[s.id,s]));

// Measured from the Rocketbox sit-down / stand-up root motion (both rigs): the sitter starts 0.45 m
// in front of the seat and finishes standing 0.42 m in front of it.
export const SIT_APPROACH = .45, STAND_EXIT = .42, SEAT_RANGE = 1.4;
/** Where to stand before sitting (d = SIT_APPROACH) or after standing (d = STAND_EXIT), allowing for a pulled-out chair. */
export function seatApproach(seat,d=SIT_APPROACH){const k=d-(seat.pull??0);return {x:seat.x+Math.sin(seat.yaw)*k,z:seat.z+Math.cos(seat.yaw)*k};}
/** Tabletops collide only within their own footprint, so stand points beside them stay reachable. */
export const TABLES = [...EXPANSION_TABLES,...LIBRARY_TABLES.map(([x,z])=>({x,z,w:2.4,d:1.1})),...CAFE_TERRACE_TABLES.map(([x,z])=>({x,z,w:.9,d:.9})),...CAFE_INTERIOR_TABLES.map(([x,z])=>({x,z,w:.9,d:.9})),...CLASSROOM.desks.map(([x,z])=>({x,z,w:1.6,d:.6})),...LIBRARY_COMPUTERS.map(c=>({x:c.x,z:c.z,w:.7,d:1.4}))];

// ---------------------------------------------------------------- doors
// Hinged leaves: hinge (x, z), leaf length along +x (dir 1) or -x (dir -1), default swing towards +z (1) or -z (-1).
// Double-acting doors swing away from whoever opens them. `collider` blocks the doorway while the door
// is closed. Locked doors never open.
export const DOORS = [
 LAB_DOOR,
 {id:'library-main',label:'Library entrance',x:-30,z:-4.3,leaves:[{hx:-32,hz:-4.3,dir:1,len:2},{hx:-28,hz:-4.3,dir:-1,len:2}],swing:-1,double:true,height:3.2,glass:true,collider:{x:-30,z:-4.3,w:4,d:.6}},
 {id:'cafe-main',label:'Café entrance',x:26.95,z:-4.45,leaves:[{hx:25.95,hz:-4.45,dir:1,len:1},{hx:27.95,hz:-4.45,dir:-1,len:1}],swing:1,double:true,height:2.6,glass:true,collider:{x:26.95,z:-4.45,w:2,d:.5}},
 {id:'classroom-d1',label:'Classroom D1',x:32.7,z:-36.55,leaves:[{hx:32.2,hz:-36.55,dir:1,len:1}],swing:-1,double:true,height:2.24,glass:false,collider:{x:32.7,z:-36.55,w:1,d:.3}},
 {id:'library-staff',label:'Library staff room',x:-34.95,z:-26.1,leaves:[{hx:-35.55,hz:-25.95,dir:1,len:1.2}],swing:1,height:2.3,glass:false,locked:'Staff only',collider:{x:-34.95,z:-26.1,w:1.2,d:.4}},
 {id:'cafe-kitchen',label:'Café kitchen',x:29.6,z:-20,leaves:[{hx:28.7,hz:-19.8,dir:1,len:1.8}],swing:-1,height:2.4,glass:false,locked:'Kitchen staff only',collider:{x:29.6,z:-20,w:1.8,d:.4}},
];
export const DOOR_BY_ID = new Map(DOORS.map(d=>[d.id,d]));

// ---------------------------------------------------------------- basketball
const COURT_CENTRE = {x:44,z:24};
/** Hoops at both ends: rim centre, backboard plane and post. */
export const HOOPS = [-1,1].map(s=>{const base=COURT_CENTRE.z+s*14;return {id:s<0?'south':'north',x:COURT_CENTRE.x,z:base-s*1.575,rimY:3.05,rimR:.225,board:{x:COURT_CENTRE.x,y:3.35,z:base-s*1.2-s*.015,w:1.8,h:1.05,d:.03},post:{x:COURT_CENTRE.x,z:base+s*1.0,w:.18,d:.18,h:3.3},arm:{x:COURT_CENTRE.x,z:(base+s*1.0+base-s*1.2)/2,w:.12,d:2.2,y0:3.14,y1:3.26},dir:-s};});
/** Balls rest on a rack by the court entrance. */
export const BALLS = [{id:'ball-1',x:34.2,z:22.6},{id:'ball-2',x:34.2,z:25.4}];
export const BALL_PICKUP_RANGE = 1.5;

// ---------------------------------------------------------------- informational fixtures (client panels)
export const POINTS = [
 {id:'cafe-menu',kind:'MENU',label:'Read the menu',x:33.5,z:-11.6,range:2.4},
 {id:'cafe-counter',kind:'COUNTER',label:'Order at the counter',x:26.5,z:-9.6,range:2.2},
 {id:'library-books',kind:'BOOKS',label:'Browse new arrivals',x:-30,z:-22.6,range:2.2},
 {id:'classroom-board',kind:'BOARD',label:'Read the whiteboard',x:34.4,z:-42.4,range:2.6},
 ...LIBRARY_COMPUTERS.map(c=>({id:c.id,kind:'COMPUTER',label:'Use computer',x:c.x+1.02,z:c.z,range:1.3,seat:`${c.id}-chair`})),
];
