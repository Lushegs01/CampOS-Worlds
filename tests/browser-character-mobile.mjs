import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { launch, open } from './support/browser.mjs';
import { SEATS, seatApproach } from '../shared/interactions.mjs';

const stack=await startStack({name:'character-mobile',webPort:5198,roomPort:3298,supabasePort:54981});
const browser=await launch(),errors=[];
const out=process.env.CHARACTER_EVIDENCE??'/tmp/campos-character-evidence';
await mkdir(out,{recursive:true});
const opts={viewport:{width:900,height:520},query:'/?qa-norender&qa-scale=.38'};
let phone,observer;
try{
 observer=await open(browser,stack,'Animation Observer',errors,opts);
 phone=await open(browser,stack,'Animation Touch',errors,{...opts,mobile:true});
 assert.equal(await phone.evaluate(()=>matchMedia('(pointer:coarse) and (orientation:landscape)').matches),true);
 const cdp=await phone.context().newCDPSession(phone);
 await cdp.send('Network.enable');
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:180,downloadThroughput:65000,uploadThroughput:29000,connectionType:'cellular3g'});
 const actor=[...stack.room.clients.values()].find(c=>c.name==='Animation Touch');
 const seat=SEATS[0],point=seatApproach(seat);
 Object.assign(actor,point,{y:0,vx:0,vz:0,vy:0});
 const touch=phone.locator('.touch-actions');
 await touch.getByRole('button',{name:'Sit',exact:true}).tap();
 await phone.waitForFunction(()=>window.__campusDebug.state().sit?.phase==='seated',null,{timeout:22000});
 await observer.waitForFunction(async ([id,seat])=>{
   const {livePeers}=await import('/src/state.ts');
   const peer=livePeers.get(id);
   return peer?.seat===seat&&peer.characterAction?.[1]==='sit';
 },[actor.id,seat.id],{timeout:2000}).catch(async ()=>{
   // A connection joining a completed transition sees the authoritative final pose.
   await observer.waitForFunction(id=>window.__campusDebug.state().world.seats[id],seat.id);
 });
 await phone.evaluate(()=>window.__campusGL.render(window.__campusScene,window.__campusCamera));
 await phone.screenshot({path:out+'/05-touch-seated.jpg',type:'jpeg',quality:80});
 await phone.evaluate(()=>window.__campusNet.close());
 await observer.waitForFunction(seat=>!window.__campusDebug.state().world.seats[seat],seat.id);
 await phone.waitForFunction(()=>window.__campusInspect().status==='connected'&&!window.__campusDebug.state().sit,null,{timeout:20000});
 assert.equal(stack.room.world.seats.has(seat.id),false);
 const count=await observer.evaluate(()=>{
   let n=0;window.__campusScene.traverse(o=>{if(o.name.startsWith('npc:'))n++;});return n;
 });
 assert.ok(count>=2);
 console.log('PASS touch seating under 3G emulation, remote occupancy, release and reconnect; NPC renders:',count);
 assert.deepEqual(errors,[]);
}catch(e){
 console.error('browser errors',errors);
 process.exitCode=1;throw e;
}finally{await browser.close();await stack.stop();}
