import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { launch,open } from './support/browser.mjs';
import { localPoint } from '../shared/vehicles.mjs';
import { DOOR_BY_ID } from '../shared/interactions.mjs';

const stack=await startStack({name:'browser-character-actions',webPort:5197,roomPort:3297,supabasePort:54971});
const browser=await launch(), errors=[];
const out=process.env.CHARACTER_EVIDENCE??'/tmp/campos-character-evidence';
await mkdir(out,{recursive:true});
let page,actor;
const inside=(x,z)=>Object.assign(actor,{x,z,y:0,vx:0,vz:0,vy:0});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const room=async(fn,label)=>{
 const end=Date.now()+9500;
 while(Date.now()<end){if(fn())return;await delay(65);}
 throw Error(label);
};
const check=(fn,args)=>page.waitForFunction(fn,args,{timeout:15000});
const focus=name=>check(name=>window.__campusDebug.focus()?.label===name,name);
const waitPos=(x,z)=>check(([x,z])=>{const a=window.__campusDebug.state();return Math.hypot(a.x-x,a.z-z)<.3;},[x,z]);
const move=async(x,z)=>{
 await page.evaluate(([x,z])=>window.__campusDebug.walkTo(x,z),[x,z]);
 await check(()=>!window.__campusDebug.walking());
 await waitPos(x,z);
};
async function shot(name) {
 await page.evaluate(()=>window.__campusGL.render(window.__campusScene,window.__campusCamera));
 await page.screenshot({path:`${out}/${name}.jpg`,type:'jpeg',quality:80});
}
try{
 page=await open(browser,stack,'Motion Browser QA',errors,{viewport:{width:960,height:540},query:'/?qa-norender&qa-scale=.42'});
 actor=[...stack.room.clients.values()].find(c=>c.joined);
 assert.ok(actor);
 await page.keyboard.down('w');await delay(400);await page.keyboard.down('Shift');
 await room(()=>actor.sprinting&&Math.hypot(actor.vx,actor.vz)>5,'sprinting');
 await page.keyboard.up('Shift');await page.keyboard.press('p');
 await check(()=>window.__campusScene.getObjectByName('campus-player').visible===false);
 await page.keyboard.press('p');
 await check(()=>window.__campusScene.getObjectByName('campus-player').visible===true);
 await page.keyboard.up('w');
 await room(()=>Math.hypot(actor.vx,actor.vz)<.2,'decelerating to idle');
 await page.keyboard.press('Space');
 await room(()=>actor.y>.15,'jump');
 await room(()=>actor.y<.02,'land');
 console.log('PASS locomotion, sprint, stop, jump and camera switch while moving');
 inside(-22.45,15.2);await waitPos(-22.45,15.2);
 await move(-22.45,14.6);
 await page.evaluate(()=>window.__campusDebug.face(Math.PI));
 await focus('Sit');
 await page.keyboard.press('e');
 await check(()=>window.__campusDebug.state().sit?.phase==='seated');
 assert.ok(actor.seat);
 await shot('01-seated');
 await page.keyboard.press('e');
 await check(()=>!window.__campusDebug.state().sit);
 assert.equal(actor.seat,null);
 console.log('PASS chair approach, sit and stand');
 inside(-30,-2.55);await waitPos(-30,-2.55);
 await focus('Open door');
 await page.keyboard.press('e');
 // Send the interrupt before any time-based reach commit.
 await page.keyboard.press('ArrowLeft');
 await delay(650);
 assert.equal(stack.room.world.doors['library-main'],0);
 inside(-30,-2.55);await waitPos(-30,-2.55);
 await focus('Open door');await page.keyboard.press('e');
 await room(()=>stack.room.world.doors['library-main']!==0,'door approved');
 assert.equal(actor.characterAction?.[1],'door-push');
 await shot('02-door-contact');
 const d=DOOR_BY_ID.get('library-main');
 await move(d.x,d.z-2.4);
 assert.ok(actor.z<d.z);
 console.log('PASS interrupted reach and approved door approach / traversal');
 const ball=stack.room.world.balls[0];
 inside(ball.x-1.05,ball.z);await waitPos(ball.x-1.05,ball.z);
 await focus('Pick up basketball');await page.keyboard.press('e');
 await room(()=>actor.ball===ball.id,'pickup approved');
 await shot('03-ball-pickup');
 await page.evaluate(()=>window.__campusDebug.face(Math.PI/2));
 await page.keyboard.down('w');await delay(390);await page.keyboard.up('w');
 await page.keyboard.down('Space');await delay(330);await page.keyboard.up('Space');
 await room(()=>ball.state==='flight','shot released');
 console.log('PASS pickup, moving with the ball and shooting');
 const car=stack.room.fleet.vehicles[0],at=localPoint(car,1.65,0);
 inside(at.x,at.z);await waitPos(at.x,at.z);
 await focus('Drive');await page.keyboard.press('e');
 await room(()=>actor.vehicle===car.id,'vehicle enter');
 await shot('04-vehicle-entry');
 await page.keyboard.down('w');
 await room(()=>Math.abs(car.speed)>2,'vehicle acceleration');
 await page.keyboard.up('w');await page.keyboard.down('Space');
 await room(()=>Math.abs(car.speed)<.05,'vehicle braking');
 await page.keyboard.up('Space');await page.keyboard.press('e');
 await room(()=>!actor.vehicle,'vehicle exit');
 assert.equal(actor.characterAction?.[1],'vehicle-exit');
 console.log('PASS enter, drive, brake and exit');
 const metrics=await page.evaluate(()=>window.__campusAnimationMetrics());
 assert.ok(metrics.feet>0&&metrics.hands>0,JSON.stringify(metrics));
 console.log('Animation CPU sample',metrics);
 assert.deepEqual(errors,[]);
}catch(e){
 console.error('browser errors',errors);
 if(page)await shot('failure').catch(()=>{});
 process.exitCode=1;throw e;
}finally{await browser.close();await stack.stop();}
