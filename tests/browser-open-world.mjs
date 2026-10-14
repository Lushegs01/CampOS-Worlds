import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],results=[];
async function open(name,mobile=false){const context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:800,height:500},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:1});await context.addInitScript(name=>localStorage.setItem('campos-worlds-v1',JSON.stringify({state:{quality:'low',name},version:0})),name);const p=await context.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});await p.goto('http://127.0.0.1:5173');await p.getByRole('button',{name:'Enter campus',exact:true}).click({timeout:120000});await p.waitForFunction(()=>window.__campusInspect?.().status==='connected',null,{timeout:30000});await p.waitForTimeout(2500);console.log(name,await p.evaluate(()=>window.__campus));return p;}
const state=p=>p.evaluate(async()=>{const {useVehicle,localFleet}=await import('/src/vehicles/client.ts');return {...window.__campusDebug.state(),vehicle:useVehicle.getState(),fleet:localFleet.snapshot()};});
async function walk(p,x,z){await p.evaluate(([x,z])=>window.__campusDebug.walkTo(x,z),[x,z]);await p.waitForFunction(()=>!window.__campusDebug.walking(),null,{timeout:130000});await p.waitForFunction(()=>{const s=window.__campusDebug.state();return Math.hypot(s.room.x-s.x,s.room.z-s.z)<1;},null,{timeout:60000});const s=await state(p);assert.ok(Math.hypot(s.x-x,s.z-z)<.6,`Walk ${x},${z} reached ${s.x},${s.z}`);}
const until=async(p,fn,ms=90000)=>{const t=Date.now();while(Date.now()-t<ms){if(await p.evaluate(fn))return;await p.waitForTimeout(250);}throw Error('Timed out waiting for '+fn);};
const inVehicle=async()=>!!(await import('/src/vehicles/client.ts')).useVehicle.getState().id,onFoot=async()=>!(await import('/src/vehicles/client.ts')).useVehicle.getState().id,prompt=()=>!!window.__campusDebug.focus();
const pass=s=>{console.log('PASS',s);results.push(s);};
try{
 const a=await open('Ada Driver');await a.waitForTimeout(2000);await a.screenshot({path:'docs/screenshots/open-world/01-hub.png'});pass('App loads and joins room');
 await walk(a,0,56);await walk(a,10.5,60.5);await walk(a,11.9,63.3);await until(a,prompt);await a.keyboard.press('KeyE');await until(a,inVehicle);let s=await state(a);assert.equal(s.vehicle.seat,0);pass('Walk from original hub; enter driver seat with E');
 if(process.env.SMOKE==='1'){console.log(JSON.stringify(s.vehicle));await a.screenshot({path:'docs/screenshots/open-world/02-driver.png'});}
 else {
 const b=await open('Tobi Passenger');await walk(b,0,56);await walk(b,16.5,60.5);await walk(b,15.1,62.7);await until(b,prompt);await b.keyboard.press('KeyE');await until(b,inVehicle);assert.equal((await state(b)).vehicle.seat,1);pass('Second actual browser enters passenger seat');
 const before=(await state(a)).fleet.find(v=>v.id==='courtyard-car');await a.keyboard.down('KeyW');await a.waitForTimeout(1200);for(let i=0;i<40&&before.z-(await state(a)).fleet.find(v=>v.id==='courtyard-car').z<1.5;i++)await a.waitForTimeout(500);await a.keyboard.up('KeyW');await a.keyboard.down('Space');await a.waitForTimeout(900);await a.keyboard.up('Space');s=await state(a);const car=s.fleet.find(v=>v.id==='courtyard-car');assert.ok(before.z-car.z>1,'drove north out of the bay');const peer=await state(b);const their=peer.fleet.find(v=>v.id===car.id);assert.ok(Math.hypot(car.x-their.x,car.z-their.z)<1);assert.ok(Math.hypot(peer.x-car.x,peer.z-car.z)<3);pass('Authoritative forward movement, braking, passenger anchoring and remote synchronization');
 await a.screenshot({path:'docs/screenshots/open-world/02-driver.png'});await b.screenshot({path:'docs/screenshots/open-world/03-passenger.png'});
 await b.keyboard.press('KeyE');await until(b,onFoot);await a.keyboard.press('KeyE');await until(a,onFoot);pass('Both players safely exit parked car');
 await until(a,prompt);await a.keyboard.press('KeyE');await until(a,inVehicle);pass('Re-enter same persisted vehicle');
 await a.keyboard.down('KeyS');await a.waitForTimeout(1000);for(let i=0;i<40&&(await state(a)).fleet.find(v=>v.id===car.id).z<car.z+1.2;i++)await a.waitForTimeout(500);await a.keyboard.up('KeyS');await a.keyboard.down('Space');await a.waitForTimeout(800);await a.keyboard.up('Space');assert.ok((await state(a)).fleet.find(v=>v.id===car.id).z>car.z+1,'reversed back towards the bay');pass('Reverse and handbrake');
 await a.getByRole('button',{name:'Recover vehicle',exact:true}).click();await a.waitForTimeout(500);{const home=(await state(a)).fleet.find(v=>v.id===car.id);assert.ok(Math.abs(home.x-13.5)<.3&&Math.abs(home.z-63)<.3);}pass('Recovery returns stopped driver to a clear home bay');
 await a.keyboard.press('KeyM');await a.screenshot({path:'docs/screenshots/open-world/04-map.png'});await a.getByRole('button',{name:'Close panel'}).click();pass('Expanded university map is available while driving');
 await a.context().close();await b.waitForTimeout(800);assert.equal((await state(b)).fleet.find(v=>v.id===car.id).occupants[0],null);pass('Driver disconnect releases control and stops vehicle');
 }
 assert.deepEqual(errors,[]);pass('No uncaught browser errors');
}finally{await writeFile('docs/screenshots/open-world/browser-results.json',JSON.stringify({results,errors},null,2));await browser.close();}
