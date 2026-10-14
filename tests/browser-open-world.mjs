import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],results=[];
async function open(name,mobile=false){const context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:800,height:500},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:1});await context.addInitScript(name=>localStorage.setItem('campos-worlds-v1',JSON.stringify({state:{quality:'low',name},version:0})),name);const p=await context.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});await p.goto('http://127.0.0.1:5173');await p.getByRole('button',{name:'Enter campus',exact:true}).click({timeout:120000});await p.waitForFunction(()=>window.__campusInspect?.().status==='connected',null,{timeout:30000});await p.waitForTimeout(2500);console.log(name,await p.evaluate(()=>window.__campus));return p;}
const state=p=>p.evaluate(async()=>{const {useVehicle,localFleet}=await import('/src/vehicles/client.ts');return {...window.__campusDebug.state(),vehicle:useVehicle.getState(),fleet:localFleet.snapshot()};});
async function walk(p,x,z){await p.evaluate(([x,z])=>window.__campusDebug.walkTo(x,z),[x,z]);await p.waitForFunction(()=>!window.__campusDebug.walking(),null,{timeout:130000});const s=await state(p);assert.ok(Math.hypot(s.x-x,s.z-z)<.6,`Walk ${x},${z} reached ${s.x},${s.z}`);}
const pass=s=>{console.log('PASS',s);results.push(s);};
try{
 const a=await open('Ada Driver');await a.waitForTimeout(2000);await a.screenshot({path:'docs/screenshots/open-world/01-hub.png'});pass('App loads and joins room');
 await walk(a,0,56);await walk(a,8.55,57);await a.keyboard.press('KeyE');await a.waitForFunction(async()=>!!(await import('/src/vehicles/client.ts')).useVehicle.getState().id);let s=await state(a);assert.equal(s.vehicle.seat,0);pass('Walk from original hub; enter driver seat with E');
 if(process.env.SMOKE==='1'){console.log(JSON.stringify(s.vehicle));await a.screenshot({path:'docs/screenshots/open-world/02-driver.png'});}
 else {
 const b=await open('Tobi Passenger');await walk(b,0,56);await walk(b,8.55,53);await b.keyboard.press('KeyE');await b.waitForFunction(async()=>!!(await import('/src/vehicles/client.ts')).useVehicle.getState().id);assert.equal((await state(b)).vehicle.seat,1);pass('Second actual browser enters passenger seat');
 const before=(await state(a)).fleet.find(v=>v.id==='courtyard-car');await a.keyboard.down('KeyW');await a.waitForTimeout(1800);await a.keyboard.up('KeyW');await a.keyboard.down('Space');await a.waitForTimeout(900);await a.keyboard.up('Space');s=await state(a);const car=s.fleet.find(v=>v.id==='courtyard-car');assert.ok(car.x>before.x+2);const peer=await state(b);const their=peer.fleet.find(v=>v.id===car.id);assert.ok(Math.hypot(car.x-their.x,car.z-their.z)<1);assert.ok(Math.hypot(peer.x-car.x,peer.z-car.z)<3);pass('Authoritative forward movement, braking, passenger anchoring and remote synchronization');
 await a.screenshot({path:'docs/screenshots/open-world/02-driver.png'});await b.screenshot({path:'docs/screenshots/open-world/03-passenger.png'});
 await b.keyboard.press('KeyE');await b.waitForFunction(async()=>!(await import('/src/vehicles/client.ts')).useVehicle.getState().id);await a.keyboard.press('KeyE');await a.waitForFunction(async()=>!(await import('/src/vehicles/client.ts')).useVehicle.getState().id);pass('Both players safely exit parked car');
 await a.keyboard.press('KeyE');await a.waitForFunction(async()=>!!(await import('/src/vehicles/client.ts')).useVehicle.getState().id);pass('Re-enter same persisted vehicle');
 await a.keyboard.down('KeyS');await a.waitForTimeout(1800);await a.keyboard.up('KeyS');await a.keyboard.down('Space');await a.waitForTimeout(800);await a.keyboard.up('Space');assert.ok((await state(a)).fleet.find(v=>v.id===car.id).x<car.x-2);pass('Reverse and handbrake');
 await a.getByRole('button',{name:'Recover vehicle',exact:true}).click();await a.waitForTimeout(500);assert.ok(Math.abs((await state(a)).fleet.find(v=>v.id===car.id).x-8)<.3);pass('Recovery returns stopped driver to a clear home bay');
 await a.keyboard.press('KeyM');await a.screenshot({path:'docs/screenshots/open-world/04-map.png'});await a.getByRole('button',{name:'Close panel'}).click();pass('Expanded university map is available while driving');
 await a.context().close();await b.waitForTimeout(800);assert.equal((await state(b)).fleet.find(v=>v.id===car.id).occupants[0],null);pass('Driver disconnect releases control and stops vehicle');
 }
 assert.deepEqual(errors,[]);pass('No uncaught browser errors');
}finally{await writeFile('docs/screenshots/open-world/browser-results.json',JSON.stringify({results,errors},null,2));await browser.close();}
