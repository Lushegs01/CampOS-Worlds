import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { open, launch, account, signIn, roomPlayer } from './support/browser.mjs';
import { CONTACT, PACKAGE, SAFEHOUSE, BARREL, O, distance } from '../shared/getaway.mjs';
import { collidersIn } from '../shared/campus.mjs';
import { rayBox } from '../shared/arena/physics.mjs';

const stack=await startStack({name:'browser-getaway',webPort:5184,roomPort:3284,supabasePort:54841});
const browser=await launch(), errors=[];
const evidence=process.env.GETAWAY_EVIDENCE ?? '/tmp/campos-getaway-evidence';
await mkdir(evidence,{recursive:true});
const noRender=process.env.GETAWAY_CONTINUOUS_RENDER!=='1';
const view={viewport:{width:880,height:520},...(noRender?{query:'/?qa-scale=0.38&qa-norender'}:{})};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const until=async(fn,label,ms=12000)=>{
  const end=Date.now()+ms;
  while(Date.now()<end){const v=await fn();if(v)return v;await sleep(60);}
  const final=await fn();
  if(final)return final;
  throw new Error('Timed out: '+label);
};
let page,who;
const self=()=>roomPlayer(stack,who.handle);
const mission=()=>self()?.getaway;
const snapshot=()=>({point:[self()?.x,self()?.z],stage:mission()?.stage,hp:mission()?.health,vehicle:self()?.vehicle,pursuit:mission()?.wanted?{wanted:mission().wanted,spotted:mission().spotted,closest:mission().closest,driven:mission().pursuitDistance,units:mission().police.map(v=>[Math.round(v.x),Math.round(v.z),v.mode])}:undefined,actors:mission()?.actors.map(a=>[a.id,Math.round(a.x),Math.round(a.z),a.hp,a.mode])});
const render=async()=>{if(noRender)await page.evaluate(()=>{
  const gl=window.__campusGL, scene=window.__campusScene, camera=window.__campusCamera;
  if(gl&&scene&&camera)gl.render(scene,camera);
});};
const proof=async name=>{await render();console.log(name,JSON.stringify(snapshot()));await page.screenshot({path:`${evidence}/${name}.jpg`,type:'jpeg',quality:81,timeout:12000});};
const playerInput=async(action)=>page.evaluate(async action=>{
  const { input }=await import('/src/state.ts');
  const wrap=n=>Math.atan2(Math.sin(n),Math.cos(n));
  const canvas=document.querySelector('.world canvas');
  // The game handles ordinary mouse look through its canvas/window input listeners.
  if(action.drag)canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:1,bubbles:true}));
  dispatchEvent(new MouseEvent('mousemove',{movementX:Math.round(wrap(input.yaw-action.yaw)/.0032),movementY:Math.round((action.pitch-input.pitch)/.0022)}));
  if(action.drag)dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:1}));
  return {yaw:input.yaw,pitch:input.pitch};
},action);
const look=async(x,z,pitch=.1,drag=true)=>{
  const c=self();
  return playerInput({yaw:Math.atan2(x-c.x,z-c.z)-Math.PI,pitch,drag});
};
async function walk(x,z,{radius=1.3,timeout=25000,sprint=true}={}){
  if(distance(self(),{x,z})<radius)return;
  if(sprint)await page.keyboard.down('Shift');
  try{
    await look(x,z,-.02);
    await page.keyboard.down('w');
    await until(async()=>{
      const p=self();
      if(distance(p,{x,z})<radius)return true;
      if(mission()?.failed)throw Error(mission().failed);
      await look(x,z,-.02);
      return false;
    },`walk to ${x},${z} ${JSON.stringify(snapshot())}`,timeout);
  }finally{await page.keyboard.up('w');if(sprint)await page.keyboard.up('Shift');}
  await sleep(170);
}
const trigger=async()=>page.keyboard.press('e');
function visible(p,a){
  const dx=a.x-p.x,dz=a.z-p.z,len=Math.hypot(dx,dz);
  if(len<.5)return false;
  return !collidersIn(Math.min(p.x,a.x),Math.min(p.z,a.z),Math.max(p.x,a.x),Math.max(p.z,a.z)).some(b=>
    rayBox(p.x,1.5,p.z,dx/len,0,dz/len,b.x-b.w/2,0,b.z-b.d/2,b.x+b.w/2,b.h,b.z+b.d/2,len,null)>=0);
}
async function sweepRoom(points,stage){
  const used=new Set();
  for(let round=0;round<3&&mission().stage===stage;round++)for(const [x,z] of points){
    if(mission().stage!==stage)break;
    await walk(x,z,{sprint:false,radius:.85,timeout:9500});
    for(let n=0;n<18&&mission().stage===stage;n++){
      const m=mission(),p=self();
      const a=m.actors.filter(a=>a.hp>0&&visible(p,a)).sort((a,b)=>distance(p,a)-distance(p,b))[0];
      if(!a)break;
      const weapon=m.guns[m.arm];
      if(!weapon.mag){await page.keyboard.press('r');await until(()=>m.guns[m.arm].mag,'reload');}
      const aimPitch=-Math.atan2(1.52-(1.5+p.y),distance(p,a))+m.recoil;
      await look(a.x,a.z,aimPitch);
      // Right button sets ADS, left button goes through the same fire handler as human input.
      await page.evaluate(()=>{
        const canvas=document.querySelector('.world canvas');
        canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:2,bubbles:true}));
        canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:0,bubbles:true}));
        dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:0}));
      });
      used.add(weapon.id);
      await sleep(weapon.id==='bastion'?870:220);
      if(used.size===1&&stage===O.combat&&m.defeated>=1&&m.arm===0){await page.keyboard.press('2');await sleep(440);}
      if(m.failed)throw Error(m.failed);
    }
  }
  return [...used];
}
async function driveTo(x,z,{radius=5,fast=14,timeout=23000}={}){
  let forward=false,steering='',braking=false;
  const set=async(key,on)=>on?page.keyboard.down(key):page.keyboard.up(key);
  try{
    await until(async()=>{
      const c=self(),m=mission(),v=m.fleet.find(c.vehicle);
      if(m.failed)throw Error(m.failed);
      if(distance(v,{x,z})<radius)return true;
      const err=angle(Math.atan2(x-v.x,z-v.z)-v.yaw);
      const next=err>.12?'a':err<-.12?'d':'';
      const max=Math.abs(err)>.75?3.6:Math.abs(err)>.32?7:fast;
      const gas=v.speed<max, slow=v.speed>max+1;
      if(next!==steering){if(steering)await set(steering,false);steering=next;if(next)await set(next,true);}
      if(forward!==gas){forward=gas;await set('w',gas);}
      if(braking!==slow){braking=slow;await set('Space',slow);}
      return false;
    },`drive to ${x},${z}`,timeout);
  }finally{
    if(forward)await set('w',false);if(steering)await set(steering,false);if(braking)await set('Space',false);
  }
}
try{
  who=await account(stack,'getawayqa','Getaway QA');
  page=await open(browser,stack,'Getaway QA',errors,view);
  console.log('Campus running');
  await signIn(page,who);
  console.log('Profile signed in');
  await until(self,'room verified account');
  await page.getByRole('button',{name:'Campaign',exact:true}).click();
  await page.getByRole('button',{name:'Mark the freight gate'}).click();
  await walk(0,55.5,{radius:1.4});
  await walk(130,55.55,{radius:2,timeout:40000});
  console.log('Reached freight road');
  await walk(CONTACT.x,CONTACT.z,{radius:1.55});
  await page.getByRole('button',{name:'Talk to Sade',exact:true}).waitFor({timeout:8000});
  await trigger();
  await page.getByRole('button',{name:'Accept assignment'}).waitFor();
  await proof('01-briefing');
  await page.getByRole('button',{name:'Accept assignment'}).click();
  await until(()=>mission()?.stage===O.warehouse,'mission accepted');
  const warehouse=async()=>{
    await walk(162,42);
    await walk(171,42);
    await walk(191,29,{timeout:17000});
    await walk(191,21,{radius:1.1});
    await until(()=>mission()?.stage===O.combat,'combat starts');
  };
  await warehouse();
  console.log('Warehouse entered');
  await walk(191,15.5,{radius:1.2,sprint:false});
  await until(()=>mission()?.failed,'downed by the operative',38000);
  await proof('02-downed');
  await page.getByRole('button',{name:'Retry checkpoint'}).click();
  await until(()=>mission()?.stage===O.warehouse,'retry restored the start');
  await warehouse();
  const used=await sweepRoom([[191,20],[190,16],[189,11],[192,6],[199,5],[200,13],[194,14],[187,13]],O.combat);
  assert.equal(mission().stage,O.package,JSON.stringify(snapshot()));
  assert.ok(used.includes('sparrow')&&used.includes('vanguard'),used.join(','));
  await proof('03-warehouse-cleared');
  await walk(PACKAGE.x,PACKAGE.z,{radius:1.4});
  await trigger();
  await until(()=>mission().carried,'picked up case');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Enter campus',exact:true}).click({timeout:120000});
  await page.getByRole('button',{name:'Your profile, @getawayqa'}).waitFor({timeout:45000});
  await page.getByRole('button',{name:'Campaign',exact:true}).click();
  await page.getByRole('button',{name:'Resume checkpoint'}).click({timeout:20000});
  await until(()=>mission()?.stage===O.ambush,'account checkpoint after reload');
  await walk(191,28.5,{radius:1.1});
  await until(()=>mission().ambushed,'ambush and alarm');
  await page.keyboard.press('3');await sleep(330);
  await look(BARREL.x,BARREL.z,Math.atan2(.82,distance(self(),BARREL)));
  await page.evaluate(()=>{document.querySelector('.world canvas').dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:0}));dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:0}));});
  await until(()=>mission().exploded,'fuel drum explodes',13000);
  await proof('04-fuel-drum');
  await page.keyboard.press('2');await sleep(300);
  await sweepRoom([[191,33],[191,39],[204,39],[216,40],[187,36.5],[175,37]],O.ambush);
  assert.equal(mission().stage,O.vehicle,JSON.stringify(snapshot()));
  const compact=mission().fleet.find('getaway-compact');
  await walk(211,40);
  await walk(compact.x+1.6,compact.z-.15,{radius:.8});
  await trigger();
  await until(()=>mission()?.stage===O.pursuit,'vehicle starts pursuit');
  await driveTo(210,69,{radius:5,fast:13});
  await driveTo(252,83,{radius:12,fast:17});
  await proof('05-police-pursuit');
  await driveTo(365,105,{radius:11,fast:23});
  await driveTo(480,108,{radius:12,fast:23});
  if(mission().stage===O.pursuit)await driveTo(526,109,{radius:6,fast:15});
  await until(()=>mission().stage>=O.safehouse,'real evasion',14000);
  console.log('Police evaded',JSON.stringify(snapshot()));
  await driveTo(506,75,{radius:4,fast:8});
  await driveTo(506,41,{radius:2.8,fast:9});
  await driveTo(487,12,{radius:7,fast:12});
  await driveTo(346,-25,{radius:7,fast:14});
  await driveTo(307,-24,{radius:5,fast:13});
  await driveTo(273,-26,{radius:3.5,fast:8});
  await page.keyboard.down('Space');await sleep(1200);await page.keyboard.up('Space');
  await trigger();await until(()=>!self().vehicle,'exit car at safehouse');
  const parked=mission().fleet.find('getaway-compact');
  await walk(parked.x-4,self().z,{radius:.9,sprint:false});
  await walk(parked.x-4,-30,{radius:.9,sprint:false});
  await walk(273,-30,{radius:1.2,sprint:false});
  await walk(SAFEHOUSE.x,SAFEHOUSE.z,{radius:1.8,sprint:false});
  await trigger();
  await page.getByText(/\+500 campaign XP/).waitFor({timeout:12000});
  await proof('06-debrief');
  await page.getByRole('button',{name:'Return to free roam'}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Enter campus',exact:true}).click({timeout:120000});
  await page.getByRole('button',{name:'Your profile, @getawayqa'}).waitFor();
  await page.getByRole('button',{name:'Campaign',exact:true}).click();
  await page.getByText('Completed · 500 campaign XP · 250 credits · Loose ends',{exact:true}).waitFor();
  await proof('07-saved-after-refresh');
  assert.deepEqual(errors,[]);
}catch(error){
  console.error(JSON.stringify(snapshot()),errors);
  await render().catch(()=>{});
  await page?.screenshot({path:`${evidence}/failure.jpg`,type:'jpeg',timeout:8000}).catch(()=>{});
  process.exitCode=1;throw error;
}finally{await browser.close();await stack.stop();}
