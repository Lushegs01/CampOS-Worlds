import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createRoom } from '../server/room.mjs';
import { createServer } from 'vite';
import { launch,open } from './support/browser.mjs';
const port=5183,origin=`http://127.0.0.1:${port}`,room=createRoom({port:0,origins:[origin]}),address=await room.start();
process.env.ROOM_URL=`127.0.0.1:${address.port}`;
const web=await createServer({server:{hmr:false,port,host:'127.0.0.1',strictPort:true},logLevel:'warn'});await web.listen();
const browser=await launch(),errors=[],results=[],pass=s=>{results.push(s);console.log('PASS',s);};let page;
const read=()=>page.evaluate(()=>({...window.__controls.input}));
try{
 page=await open(browser,{url:origin},'Touch QA',errors,{viewport:{width:390,height:844},mobile:true});
 await page.evaluate(async()=>{window.__controls=await import('/src/state.ts');});
 const cdp=await page.context().newCDPSession(page),touch=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
 // CDP touchMove supplies the remaining active pointers when releasing just one finger.
 const b=await page.locator('.joystick').boundingBox(),point={id:1,x:b.x+b.width/2,y:b.y+b.height/2},moved={...point,x:point.x+25},second={id:2,x:point.x-15,y:point.y-15};
 await touch('touchStart',[point]);await touch('touchMove',[moved]);assert.ok((await read()).x>.5);
 await touch('touchStart',[moved,second]);await touch('touchMove',[moved]);assert.ok((await read()).x>.5,'second finger release must not release the first finger');
 await touch('touchMove',[{...moved,x:moved.x+5}]);assert.ok((await read()).x>.7);
 await touch('touchEnd',[]);assert.equal((await read()).x,0);pass('two fingers on the joystick: releasing a secondary touch preserves movement; releasing its owner stops it');
 const lookBox=await page.locator('.touch-look').boundingBox(),look={id:3,x:lookBox.x+lookBox.width*.3,y:lookBox.y+lookBox.height*.5},look2={id:4,x:lookBox.x+lookBox.width*.7,y:lookBox.y+lookBox.height*.5};await touch('touchStart',[look]);await touch('touchStart',[look,look2]);await touch('touchMove',[look]);
 const yaw=(await read()).yaw;await touch('touchMove',[{...look,x:look.x+20}]);assert.notEqual((await read()).yaw,yaw);await touch('touchEnd',[]);pass('secondary touch release preserves camera look ownership');
 // Use the actual parked vehicle; placement remains authoritative and entry uses the normal room action.
 const actor=room.clients.get(await page.evaluate(()=>window.__campusNet.id())),v=room.fleet.vehicles[0];
 Object.assign(actor,{x:v.x-1.8,z:v.z,y:0,vx:0,vz:0,vy:0});
 await page.evaluate(async id=>{(await import('/src/vehicles/client.ts')).vehicleAction('vehicleEnter',id,0);},v.id);
 await page.getByRole('button',{name:'Accelerate',exact:true}).waitFor();
 const go=await page.getByRole('button',{name:'Accelerate',exact:true}).boundingBox(),g1={id:5,x:go.x+go.width*.3,y:go.y+go.height*.4},g2={id:6,x:go.x+go.width*.7,y:go.y+go.height*.6};
 await touch('touchStart',[g1]);await touch('touchStart',[g1,g2]);assert.equal((await read()).z,-1);
 await touch('touchMove',[g1]);assert.equal((await read()).z,-1);await touch('touchEnd',[]);assert.equal((await read()).z,0);pass('two fingers on accelerator: each pointer releases only its own hold');
 await page.evaluate(()=>{window.__controls.input.jump=true;window.__controls.input.x=1;document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal((await read()).x,0);assert.equal((await read()).jump,false);pass('visibility changes clear movement and jump latches');
 await page.context().close();
 const ctx=await browser.newContext({viewport:{width:800,height:600}});await ctx.addInitScript(()=>{localStorage.setItem('campos-social-prefs','null');localStorage.setItem('campos-worlds-v1',JSON.stringify({version:1,state:{name:{bad:1},quality:'broken',discovered:null,tokens:123,muted:null,volume:'loud',set:null,notify:'bad'}}));});
 page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?qa-scale=0.2');await page.getByRole('button',{name:'Enter campus',exact:true}).waitFor({timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.enter-button').disabled);await page.getByRole('button',{name:'Enter campus',exact:true}).click();await page.waitForFunction(()=>window.__campusInspect?.().status==='connected');
 pass('corrupt saved settings recover to a playable campus');
 await ctx.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Storage denied','SecurityError');}}));
 await page.close();page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?qa-scale=0.2');
 await page.waitForFunction(()=>{const b=document.querySelector('.enter-button');return b&&!b.disabled;},null,{timeout:180000});
 await page.getByRole('button',{name:'Enter campus',exact:true}).click();await page.waitForFunction(()=>window.__campusInspect?.().status==='connected');
 const original=await page.evaluate(()=>window.__campusNet.id()),token=room.clients.get(original).token;
 await page.evaluate(()=>window.__campusNet.abandon());await page.waitForFunction(old=>window.__campusNet.id()&&window.__campusNet.id()!==old,original);
 assert.equal(room.clients.get(await page.evaluate(()=>window.__campusNet.id())).token,token);pass('denied session storage still joins and reconnects with the same room token');
 assert.deepEqual(errors,[]);await mkdir('docs/reliability',{recursive:true});await writeFile('docs/reliability/chrome-controls.json',JSON.stringify({results,errors},null,2));
}catch(e){console.error(e);throw e;}finally{await browser.close();await room.close();await Promise.race([web.close(),new Promise(r=>setTimeout(r,3000))]);}
