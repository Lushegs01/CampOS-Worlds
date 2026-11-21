// Capture the actual campus browser from comparable camera poses on the baseline and working revision.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { launch, open } from './support/browser.mjs';
import { CONTACT, O } from '../shared/getaway.mjs';

const baseline = process.env.REFERENCE_BASELINE === '1';
const views = new Set(process.env.REFERENCE_ONLY?.split(',').filter(Boolean) ?? []);
const detailed = !views.size || [...views].some(view => view !== 'metropolitan-street');
const out = process.env.REFERENCE_EVIDENCE ?? '/tmp/campos-harbour-reference';
const ports = Number(process.env.REFERENCE_PORT_SHIFT ?? 0) + (baseline ? 0 : 2);
const stack = await startStack({name:'harbour-proof-'+ports,webPort:5215+ports,roomPort:3315+ports,supabasePort:55015+ports,heartbeatMs:90000});
const browser = await launch(), errors = [];
try {
  await mkdir(out,{recursive:true});
  const page = await open(browser,stack,'Visual Reference',errors,{
    viewport:{width:1280,height:800},quality:'high',query:'/?qa-render-lab&qa-norender&qa-scale=.63',
  });
  const actor = [...stack.room.clients.values()].find(c=>c.joined);
  assert.ok(actor);
  const metrics = {};
  const wait = (fn,arg) => page.waitForFunction(fn,arg,{timeout:60000});
  const importPath = '/src/mission/client.ts';
  async function place(x,z,yaw=0) {
    Object.assign(actor,{x,z,y:0,vx:0,vz:0,vy:0});
    await page.evaluate(([x,z,yaw])=>window.__campusDebug.teleport(x,z,yaw,.04,5.4),[x,z,yaw]);
    await wait(([x,z])=>Math.hypot(window.__campusInspect().position.x-x,window.__campusInspect().position.z-z)<.85,[x,z]);
    await page.waitForTimeout(750);
  }
  async function capture(id,position,target) {
    if(views.size&&!views.has(id))return;
    await wait(()=>window.__campusLoads()===0);
    const frame = await page.evaluate(({position,target})=>{
      const gl=window.__campusGL, camera=window.__campusCamera, scene=window.__campusScene;
      const at=camera.position.clone(), frame=camera.quaternion.clone();
      camera.position.set(...position);camera.lookAt(...target);camera.updateMatrixWorld(true);
      gl.info.reset();
      if(window.__campusComposer)window.__campusComposer.render(1/60);else gl.render(scene,camera);
      const info={camera:camera.position.toArray(),target,calls:gl.info.render.calls,triangles:gl.info.render.triangles,
        width:gl.domElement.width,height:gl.domElement.height};
      camera.position.copy(at);camera.quaternion.copy(frame);camera.updateMatrixWorld(true);
      return info;
    },{position,target});
    metrics[id]=frame;
    await page.screenshot({path:out+'/'+id+'.jpg',type:'jpeg',quality:89});
    console.log('Captured',id,frame.calls,frame.triangles);
  }

  if (!views.size||views.has('metropolitan-street')) {
    await place(406,54,Math.PI/2);
    if (!baseline) {
      await wait(()=>window.__campusScene.getObjectsByProperty('isMesh',true).some(mesh=>mesh.name.startsWith('block-1-0')&&mesh.name.includes('glass')));
      await wait(()=>window.__campusScene.getObjectByName('vehicle:harbour-traffic-west')?.position.x>355);
    }
    await capture('metropolitan-street',[410,2.55,53.7],[375,4.1,35]);
  }
  if (detailed) {

    await place(141,41);
    await capture('player-character',[141.65,1.63,39.02],[141,1.16,41]);
    await place(194,36);
    await capture('warehouse-exterior',[198,2.9,43],[191,4,24]);
    await place(256,41);
    await capture('industrial-gantry',[255,3.4,45],[263,5.5,15]);
    await place(CONTACT.x,CONTACT.z+1.35);
    await page.locator('.interact-prompt[aria-label="Talk to Sade"]').click();
    await page.getByRole('button',{name:'Accept assignment'}).click();
    await wait(async path=>(await import(path)).useGetaway.getState().mission?.stage===1,importPath);
    await place(191,22);
    await wait(async path=>(await import(path)).useGetaway.getState().mission?.stage===2,importPath);
    for(const a of actor.getaway.actors)a.nextShot=Date.now()/1000+180;
    await wait(()=>!!window.__campusScene.getObjectByName('getaway:hostile:guard-1'));
    await capture('warehouse-interior',[191,2.7,22.7],[192.6,2.3,5]);
    await capture('enemy-character',[187.7,1.69,15.7],[184.7,1.18,13.65]);
    await capture('combat',[191,1.5,22],[191,1.46,8]);

    // Pin the compact using the mission's fleet, not a post-processing render.
    const m=actor.getaway, compact=m.fleet.find('getaway-compact');
    Object.assign(m,{stage:O.vehicle,wanted:0,actors:[]});
    await place(209,42);
    await wait(()=>!!window.__campusScene.getObjectByName('vehicle:getaway-compact'));
    await capture('vehicle-exterior',[212,1.53,50.2],[209,.85,46]);
    await capture('vehicle-interior',[209.37,1.18,45.87],[209.06,.79,47.3]);
    if(!baseline){
      await place(210.5,46);
      await page.waitForFunction(()=>window.__campusDebug.focus()?.label==='Drive');
      await page.keyboard.press('KeyE');
      await wait(()=>Math.abs(window.__campusScene.getObjectByName('campus-player').position.x-209.37)<.12);
      await page.keyboard.press('KeyP');
      await wait(()=>window.__campusScene.getObjectByName('campus-player').visible===false);
      await page.keyboard.press('KeyP');
      await wait(()=>window.__campusScene.getObjectByName('campus-player').visible===true);
      compact.occupants=compact.occupants.map(()=>null);
      actor.vehicle=null;actor.vehicleSeat=null;
    }

    Object.assign(m,{stage:O.pursuit,wanted:2,policeAt:Infinity,actors:[],police:[]});
    await place(241,55.5);
    const units = [
      {id:'getaway-unit-1',x:231,z:54,yaw:Math.PI/2},
      {id:'getaway-unit-2',x:251,z:57.2,yaw:-Math.PI/2},
    ];
    m.police=units.map(spawn=>({...spawn,type:'car',speed:0,wheel:0,steering:0,occupants:[null,null,null,null],route:[],plan:0,mode:'dispatch',last:{x:241,z:55.5},lastSeen:-Infinity,stuckAt:null,reverseUntil:0}));
    if(!baseline) {
      await wait(async path=>(await import(path)).useGetaway.getState().mission?.officers?.filter(o=>o.mode==='cover').length>=2,importPath);
      await page.getByText('Stop. Stay where you are.').waitFor();
    } else {
      await wait(()=>!!window.__campusScene.getObjectByName('vehicle:getaway-unit-1'));
    }
    await capture('officers',[237.3,1.7,50.3],[232.63,1.06,51.9]);
    await capture('police-containment',[240,4.6,73],[241,.8,54.5]);
  }
  assert.deepEqual(errors,[]);
  await writeFile(out+'/metrics.json',JSON.stringify(metrics,null,2)+'\n');
} finally {
  await browser.close();
  await stack.stop();
}
