import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LAB,LAB_DOOR,LAB_STATIONS,LOGISTICS_SITES} from '../shared/economic-lab.mjs';
import {LOCATIONS,blocked,moveWithCollisions,setDoorOpen,COLLIDERS} from '../shared/campus.mjs';
import {DOOR_BY_ID} from '../shared/interactions.mjs';
import {createWorld} from '../shared/world.mjs';
test('lab is registered and does not occupy original buildings, court or field',()=>{
 assert.equal(LOCATIONS.find(l=>l.id===LAB.id)?.name,LAB.name);
 assert.equal(DOOR_BY_ID.get(LAB_DOOR.id),LAB_DOOR);
 assert.ok(LAB.z-LAB.d/2>13,'south of playing field');
 assert.ok(COLLIDERS.filter(c=>Math.abs(c.x+55)<9&&Math.abs(c.z-22)<5).length>=6);
 for(const s of LOGISTICS_SITES)assert.equal(blocked(s.x,s.z),false,`delivery point ${s.id} is open`);
});
test('real door blocks entrance, opens through world rules, and interior routes reach every workstation and exit',()=>{
 setDoorOpen(LAB_DOOR.id,0);
 const world=createWorld(),p={id:'visitor',x:-57,z:29,y:0};
 assert.equal(blocked(-57,27),true);
 assert.equal(world.door(p,LAB_DOOR.id,true,[]).ok,true);
 assert.equal(blocked(-57,27),false);
 // Flood-fill actual shared collision space, not a copy of the intended floor plan.
 const todo=[[-57,29]],seen=new Set(['-57,29']);
 for(let i=0;i<todo.length;i++){const [x,z]=todo[i];for(const [dx,dz] of [[.25,0],[-.25,0],[0,.25],[0,-.25]]){
  const a=x+dx,b=z+dz,k=`${a},${b}`;if(a<-65||a>-45||b<16||b>32||seen.has(k)||blocked(a,b))continue;seen.add(k);todo.push([a,b]);
 }}
 for(const s of LAB_STATIONS){assert.ok(todo.some(([x,z])=>Math.hypot(x-s.point.x,z-s.point.z)<.3),s.name+' reachable');assert.equal(blocked(s.x,s.z),true,'solid desk');}
 assert.equal(blocked(-64,22),true);assert.equal(blocked(-46,22),true);assert.equal(blocked(-55,17),true);
 const enter=moveWithCollisions(-57,29,0,-3.5);assert.ok(enter.z<26);
 const leave=moveWithCollisions(enter.x,enter.z,0,6);assert.ok(leave.z>29);
 setDoorOpen(LAB_DOOR.id,0);
});
