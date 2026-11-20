import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { launch, open } from './support/browser.mjs';
import { CONTACT, O } from '../shared/getaway.mjs';
import { localPoint } from '../shared/vehicles.mjs';

const stack=await startStack({name:'browser-getaway-touch',webPort:5186,roomPort:3286,supabasePort:54861});
const browser=await launch(), errors=[];
const evidence=process.env.GETAWAY_EVIDENCE??'/tmp/campos-getaway-evidence';
await mkdir(evidence,{recursive:true});
const wait=async(predicate,label)=>{
  const end=Date.now()+14000;
  do{if(predicate())return;await new Promise(resolve=>setTimeout(resolve,75));}while(Date.now()<end);
  throw new Error('Touch QA timed out: '+label);
};
let page;
try{
  page=await open(browser,stack,'Touch QA',errors,{viewport:{width:900,height:420},mobile:true});
  assert.equal(await page.evaluate(()=>matchMedia('(pointer: coarse) and (orientation: landscape)').matches),true);
  const c=[...stack.room.clients.values()].find(p=>p.joined);
  assert.ok(c);
  // Fixture placements isolate the input paths. The desktop playtest covers open-world traversal and mission completion.
  const place=(x,z)=>Object.assign(c,{x,z,y:0,vx:0,vz:0,vy:0});
  place(CONTACT.x,CONTACT.z+.6);
  await page.locator('.touch-actions').getByRole('button',{name:'Talk to Sade'}).tap();
  await page.getByRole('button',{name:'Accept assignment'}).tap();
  await wait(()=>c.getaway?.stage===O.warehouse,'accept');
  const m=c.getaway;
  place(191,26);
  const joy=await page.getByRole('group',{name:'Movement joystick'}).boundingBox();
  const cdp=await page.context().newCDPSession(page);
  async function touch(type,x=0,y=0){
    await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  }
  const x=joy.x+joy.width/2,y=joy.y+joy.height/2;
  await touch('touchStart',x,y);
  await touch('touchMove',x,y-32);
  try{await wait(()=>m.stage===O.combat,'joystick enters warehouse');
    for(const actor of m.actors)actor.nextShot=Date.now()/1000+120;}finally{await touch('touchEnd');}
  const buttons=page.locator('.touch-actions');
  await buttons.getByRole('button',{name:'Aim',exact:true}).tap();
  assert.equal(await buttons.getByRole('button',{name:'Aim',exact:true}).getAttribute('aria-pressed'),'true');
  await buttons.getByRole('button',{name:'Fire',exact:true}).tap();
  await wait(()=>m.guns[0].mag<12,'tap fires pistol');
  await buttons.getByRole('button',{name:'Reload',exact:true}).tap();
  await wait(()=>m.guns[0].mag===12,'touch reload');
  await buttons.getByRole('button',{name:'Switch weapon'}).tap();
  await wait(()=>m.arm===1,'touch changes weapon');
  const mobileFrames=await page.evaluate(()=>new Promise(resolve=>{
    const start=performance.now(), frames=[];
    const tick=t=>{
      frames.push(t);
      if(t-start<2000)requestAnimationFrame(tick);
      else {
        const gaps=frames.slice(1).map((v,i)=>v-frames[i]).sort((a,b)=>a-b);
        resolve({fps:+((frames.length-1)*1000/(frames.at(-1)-frames[0])).toFixed(1),medianFrameMs:gaps[Math.floor(gaps.length*.5)]?.toFixed(1)});
      }
    };
    requestAnimationFrame(tick);
  }));
  await page.screenshot({path:evidence+'/touch-combat.jpg',type:'jpeg',quality:83});
  const car=m.fleet.find('getaway-compact');
  place(...Object.values(localPoint(car,1.6,0)));
  Object.assign(m,{stage:O.vehicle,actors:[],health:100,failed:null});
  await buttons.getByRole('button',{name:'Drive',exact:true}).tap();
  await wait(()=>c.vehicle===car.id&&m.stage===O.pursuit,'touch enters vehicle');
  const gas=await page.getByRole('button',{name:'Accelerate',exact:true}).boundingBox(), z=car.z;
  await touch('touchStart',gas.x+gas.width/2,gas.y+gas.height/2);
  try{await wait(()=>car.z>z+1.1,'touch accelerator moves vehicle');}finally{await touch('touchEnd');}
  await page.screenshot({path:evidence+'/touch-driving.jpg',type:'jpeg',quality:83});
  assert.deepEqual(errors,[]);
  console.log('Touch smoke passed',mobileFrames);
}catch(error){
  await page?.screenshot({path:evidence+'/touch-failure.jpg',type:'jpeg',timeout:6000}).catch(()=>{});
  process.exitCode=1;throw error;
}finally{await browser.close();await stack.stop();}
