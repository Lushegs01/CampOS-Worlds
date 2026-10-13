import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const ctx = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
// Isolated local gameplay: no QA movement enters a user's shared room.
await ctx.addInitScript(()=>{ const Real=window.WebSocket; window.WebSocket=function(url,p){if(!String(url).endsWith('/ws'))return new Real(url,p);const fake={readyState:3,send(){},close(){}};setTimeout(()=>fake.onclose?.({code:1006}),0);return fake;};Object.assign(window.WebSocket,{OPEN:1,CLOSED:3}); });
const page=await ctx.newPage(), errors=[], results=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/WebSocket|ERR_CONNECTION/.test(m.text()))errors.push(m.text());});
page.setDefaultTimeout(120000);
const pass=name=>{results.push(name);console.log('PASS',name);};
const pos=()=>page.evaluate(()=>window.__campusInspect());
await mkdir('docs/screenshots/performance',{recursive:true});
try {
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Enter campus',exact:true}).click();await page.waitForTimeout(4000);
 assert.equal((await pos()).quality,'low');
 const downloads=await page.evaluate(()=>performance.getEntriesByType('resource').map(x=>x.name));
 assert.ok(!downloads.some(x=>/textures\/[^/]+\/(normal|arm)\.ktx2/.test(x)));pass('Phone starts on low and skips normal/ARM surface downloads');
 const cdp=await ctx.newCDPSession(page),box=await page.getByRole('group',{name:'Movement joystick'}).boundingBox();
 const x=box.x+box.width/2,y=box.y+box.height/2;
 const start=await pos();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-33,id:1}]});
 await page.waitForTimeout(900);
 assert.ok(Math.hypot((await pos()).position.x-start.position.x,(await pos()).position.z-start.position.z)>2);pass('Actual touch joystick moves the player');
 const yaw=(await pos()).yaw;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:y-33,id:1},{x:280,y:420,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-33,id:1},{x:335,y:420,id:2}]});
 await page.waitForFunction(y=>Math.abs(window.__campusInspect().yaw-y)>.2,yaw,{timeout:5000});pass('Two-finger movement and camera rotation work together');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(1000);const stopped=(await pos()).position;
 await page.waitForTimeout(500);assert.ok(Math.hypot((await pos()).position.x-stopped.x,(await pos()).position.z-stopped.z)<.05);pass('Releasing touch stops movement');
 await page.getByRole('button',{name:'Jump',exact:true}).tap();await page.waitForFunction(()=>window.__campusInspect().position.y>.2);pass('Touch jump works');
 await page.waitForTimeout(1000);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-30,id:1}]});
 await page.getByRole('button',{name:'Pause and settings',exact:true}).click();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.getByRole('button',{name:/Back to campus/}).click();await page.waitForTimeout(700);const paused=(await pos()).position;await page.waitForTimeout(500);
 assert.ok(Math.hypot((await pos()).position.x-paused.x,(await pos()).position.z-paused.z)<.05);pass('Opening a menu clears held touch input');
 for(const [name,point] of [['library',[-30,-14,0]],['cafe',[30,-8,0]],['court',[44,20,0]]]){
  await page.evaluate(p=>window.__campusDebug.teleport(...p),point);await page.waitForTimeout(3500);
  const stats=await page.evaluate(()=>({triangles:window.__campus.triangles,drawCalls:window.__campus.drawCalls,visibleChairs:(()=>{let n=0;window.__campusScene.traverse(o=>{if(o.name.startsWith('chairs:')&&o.visible)n++;});return n;})()}));
  if(name==='library'||name==='cafe')assert.ok(stats.visibleChairs>0);
  await page.screenshot({path:`docs/screenshots/performance/mobile-${name}.png`});pass(`${name} renders nearby detail (${stats.triangles} triangles, ${stats.drawCalls} draws)`);
 }
 for(const quality of ['medium','high','low']){
  await page.getByRole('button',{name:'Pause and settings',exact:true}).click();await page.getByRole('button',{name:quality==='low'?/Lighter on your device/:quality==='medium'?/A balanced view/:/All the little details/}).click();await page.getByRole('button',{name:/Back to campus/}).click();await page.waitForTimeout(6000);
  assert.equal((await pos()).quality,quality);
 }pass('Switching low → medium → high → low keeps rendering');
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(1500);assert.ok(await page.getByRole('group',{name:'Movement joystick'}).isVisible());
 for(const selector of ['.joystick','.touch-actions button']) {
  const reachable=await page.locator(selector).first().evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);});assert.ok(reachable,`${selector} is covered in landscape`);
 }
 await page.screenshot({path:'docs/screenshots/performance/mobile-landscape.png'});pass('Landscape touch controls remain accessible');
 assert.deepEqual(errors,[]);pass('No browser runtime or rendering errors');
} finally {await writeFile('docs/mobile-checks.json',JSON.stringify({date:new Date().toISOString(),results,errors},null,2));await browser.close();}
