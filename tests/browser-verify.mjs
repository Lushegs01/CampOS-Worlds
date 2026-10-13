import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,timeout:20000});
const errors=[],results=[];const base=process.env.TEST_URL||'http://localhost:5173';
await mkdir('docs/screenshots',{recursive:true});
const page=await browser.newPage({viewport:{width:1200,height:800}});page.setDefaultTimeout(15000);
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.__campusInspect());
const record=(label)=>{results.push(label);console.log('PASS',label);};
async function closePanel(){if(await page.getByRole('button',{name:'Close panel',exact:true}).isVisible())await page.getByRole('button',{name:'Close panel',exact:true}).click();}
async function walk(x,z){
 await closePanel();const start=Date.now();let held=new Set();
 while(Date.now()-start<90000){const s=await state(),dx=x-s.position.x,dz=z-s.position.z;if(Math.hypot(dx,dz)<.8)break;const want=new Set();if(Math.abs(dx)>.5)want.add(dx>0?'KeyD':'KeyA');if(Math.abs(dz)>.5)want.add(dz>0?'KeyS':'KeyW');for(const key of held)if(!want.has(key))await page.keyboard.up(key);for(const key of want)if(!held.has(key))await page.keyboard.down(key);held=want;await page.waitForTimeout(110);}
 for(const key of held)await page.keyboard.up(key);await page.waitForTimeout(300);const s=await state();assert.ok(Math.hypot(s.position.x-x,s.position.z-z)<1.9,`Walk to ${x},${z} ended at ${JSON.stringify(s.position)}`);
}
// Precise steering through the normal input path (QA hook), for spots that need centimetres, not a metre.
async function steer(x,z){await page.evaluate(([x,z])=>window.__campusDebug.walkTo(x,z),[x,z]);await page.waitForFunction(()=>!window.__campusDebug.walking(),null,{timeout:40000});}
const debug=(fn,arg)=>page.evaluate(fn,arg);
async function interact(id){await page.keyboard.press('KeyE');await page.waitForFunction(async id=>window.__campusInspect().panel===id,id);}
try{
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});await page.getByRole('button',{name:'Enter campus',exact:true}).waitFor({timeout:120000});await page.waitForTimeout(2500);
 console.log('renderer',await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const ex=gl.getExtension('WEBGL_debug_renderer_info');return ex?gl.getParameter(ex.UNMASKED_RENDERER_WEBGL):'unavailable';}));
 await page.screenshot({path:'docs/screenshots/welcome-desktop.png'});record('desktop real WebGL campus renders');
 await page.getByRole('button',{name:'Make it you',exact:true}).click();await page.getByRole('textbox',{name:'What should we call you?'}).fill('Ada QA');await page.getByRole('button',{name:'Accent 2',exact:true}).click();await page.getByRole('button',{name:/^Amara/}).click();await page.waitForTimeout(3500);await page.screenshot({path:'docs/screenshots/avatar.png'});assert.equal((await state()).avatar.model,'amara');assert.equal((await state()).avatar.accent,'#537d70');await page.keyboard.press('Escape');assert.equal((await state()).panel,null);record('customization and welcome Escape');
 await page.getByRole('button',{name:'Enter campus',exact:true}).click();await page.getByRole('button',{name:/online/}).waitFor();await page.waitForTimeout(2000);await page.screenshot({path:'docs/screenshots/gameplay-desktop.png'});
 const initial=await state();await page.keyboard.down('KeyW');await page.waitForTimeout(800);await page.keyboard.up('KeyW');assert.ok((await state()).position.z<initial.position.z-1);record('WASD movement');
 await page.keyboard.press('Space');await page.waitForTimeout(90);assert.ok((await state()).position.y>0);record('jump');
 await walk(-12,26);await interact('orientation');await page.getByRole('button',{name:/Let’s take a look/}).click();
 await walk(-10,17);await walk(0,8);await interact('landmark');await closePanel();
 await walk(-14,8);await walk(-24.5,-1.2);await interact('library');await page.getByRole('button',{name:/Designing for belonging/}).click();await page.getByRole('heading',{name:'Designing for belonging'}).waitFor();record('library information and mini-read');await closePanel();
 await walk(-30,-2.4);if(!(await debug(()=>window.__campusDebug.state().world.doors['library-main']))){await page.waitForFunction(()=>window.__campusDebug.focus()?.label==='Open door');await page.keyboard.press('KeyE');await page.waitForFunction(()=>window.__campusDebug.state().world.doors['library-main']!==0);await page.waitForTimeout(1000);}record('open the library door');
 await walk(-30,-14);await page.screenshot({path:'docs/screenshots/library-interior.png'});assert.ok((await state()).tokens.includes('t2'));record('walk-in library and interior collectible');
 await walk(-30,2);await walk(-12,9);await walk(15,9);await walk(29,2);await interact('student');await page.getByRole('button',{name:/Creative coding circle/}).click();await closePanel();
 await walk(13,-23);await walk(0,-30);await interact('lecture');assert.equal((await state()).tourStep,5);record('complete five-stop exploration tour');await closePanel();
 await walk(8,-28);await walk(13,9);await walk(25,6);await walk(43,32);await walk(40,24);await interact('sports');
 await page.getByRole('button',{name:'Head to the court'}).click();
 // The real game: pick up a ball, take five free throws under physics, released in the gold band.
 const takeBall=async()=>{const b=await debug(()=>window.__campusDebug.state().world.balls.find(b=>b.state!=='held'));await steer(b.x+.9,b.z);await debug(()=>window.__campusDebug.face(-Math.PI/2));await page.waitForFunction(()=>window.__campusDebug.focus()?.label==='Pick up basketball');await page.keyboard.press('KeyE');await page.waitForFunction(()=>window.__campusDebug.state().holding);};
 for(let i=0;i<5;i++){
  if(!(await debug(()=>window.__campusDebug.state().holding))){await takeBall();await steer(44,16.2);}
  await debug(()=>window.__campusDebug.face(Math.PI));await page.waitForTimeout(400);const before=await debug(()=>window.__campusDebug.state().ui.hoops.shots);
  await page.keyboard.down('Space');await page.waitForFunction(()=>{const s=window.__campusDebug.state(),z=s.ui.zone;return z&&s.charge!=null&&s.charge>z[0]+(z[1]-z[0])*.3&&s.charge<z[1]-(z[1]-z[0])*.3;},null,{timeout:8000,polling:'raf'});await page.keyboard.up('Space');
  await page.waitForFunction(b=>window.__campusDebug.state().ui.hoops.shots>b,before,{timeout:8000});
 }
 assert.equal((await debug(()=>window.__campusDebug.state().ui.hoops.round)).length,5);await page.screenshot({path:'docs/screenshots/basketball.png'});record('five-shot basketball round under real physics');
 if(await debug(()=>window.__campusDebug.state().holding))await page.keyboard.press('KeyQ');
 await walk(12,30);await walk(-19,37);assert.equal((await state()).tokens.length,6);record('all six keepsakes collected');
 // Pause must stop movement, including held keys. Map and profile remain keyboard accessible.
 await page.keyboard.press('Escape');await page.getByRole('button',{name:/Lighter on your device/}).click();await page.getByLabel('Reduced motion').check();await page.keyboard.down('KeyW');const paused=await state();await page.waitForTimeout(500);await page.keyboard.up('KeyW');assert.ok(Math.hypot((await state()).position.x-paused.position.x,(await state()).position.z-paused.position.z)<.5);await closePanel();record('pause, low quality, reduced motion');
 await page.getByRole('button',{name:'Map',exact:true}).click();await page.screenshot({path:'docs/screenshots/map.png'});await closePanel();
 const otherContext=await browser.newContext({viewport:{width:640,height:480}});await otherContext.addInitScript(()=>localStorage.setItem('campos-worlds-v1',JSON.stringify({state:{quality:'low',name:'Tobi QA'},version:0})));const other=await otherContext.newPage();await other.goto(base,{waitUntil:'domcontentloaded'});await other.getByRole('button',{name:'Enter campus',exact:true}).click();await other.getByRole('button',{name:/online/}).waitFor();await page.waitForFunction(async()=> window.__campusInspect().peers.some(p=>p.name==='Tobi QA'));
 await other.getByRole('button',{name:'Chat',exact:true}).click();await other.getByRole('textbox',{name:'Chat message'}).fill('Hello from a separate browser session');await other.getByRole('button',{name:'Send message'}).click();await page.getByRole('button',{name:'Chat',exact:true}).click();await page.getByText('Hello from a separate browser session',{exact:true}).waitFor();await page.screenshot({path:'docs/screenshots/multiplayer.png'});record('two browser sessions exchange real chat and presence');await closePanel();await other.getByRole('button',{name:'Close panel'}).click();await other.keyboard.down('KeyW');await other.waitForTimeout(1200);await other.keyboard.up('KeyW');await page.waitForFunction(async()=>window.__campusInspect().peers.some(p=>p.name==='Tobi QA'&&p.z<34));record('remote avatar movement');await otherContext.close();await page.waitForFunction(async()=> !window.__campusInspect().peers.some(p=>p.name==='Tobi QA'));record('disconnect removes remote avatar');
 const persisted=(await state()).tokens;await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Enter campus',exact:true}).waitFor({timeout:120000});assert.deepEqual((await state()).tokens,persisted);record('progress persists after reload');
 const metrics=await page.evaluate(()=>window.__campus);await page.close();
 const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});await mobile.addInitScript(()=>localStorage.setItem('campos-worlds-v1',JSON.stringify({state:{quality:'low'},version:0})));await mobile.goto(base,{waitUntil:'domcontentloaded',timeout:45000});await mobile.getByRole('button',{name:'Enter campus',exact:true}).waitFor({timeout:120000});await mobile.waitForTimeout(1500);await mobile.screenshot({path:'docs/screenshots/welcome-mobile.png'});await mobile.getByRole('button',{name:'Enter campus',exact:true}).click();await mobile.waitForTimeout(1500);await mobile.getByRole('button',{name:'Jump',exact:true}).waitFor();await mobile.screenshot({path:'docs/screenshots/gameplay-mobile.png'});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth),390);record('390px touch layout without horizontal overflow');await mobile.getByRole('button',{name:'Open profile'}).click();await mobile.getByRole('button',{name:'Edit avatar',exact:true}).click();await mobile.screenshot({path:'docs/screenshots/avatar-mobile.png'});record('mobile avatar editor');
 await writeFile('docs/browser-results.json',JSON.stringify({date:new Date().toISOString(),results,errors,metrics},null,2));assert.deepEqual(errors,[]);console.log('ALL PASSED',results.length);
}catch(e){console.error('FAILED',e);if(!page.isClosed()){console.log('state',await state().catch(()=>null));await page.screenshot({path:'docs/screenshots/failure.png'}).catch(()=>{});}await writeFile('docs/browser-results.json',JSON.stringify({results,errors,failure:String(e)},null,2));process.exitCode=1;}finally{await browser.close();}
