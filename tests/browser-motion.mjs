// Real Chrome, WebGL and an ordered WebSocket relay with delayed/bursty delivery.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'vite';
import { createRoom } from '../server/room.mjs';
import { launch, open } from './support/browser.mjs';

const port=5182, origin=`http://127.0.0.1:${port}`, room=createRoom({port:0,origins:[origin]});
const address=await room.start(), relay=httpServer(), wss=new WebSocketServer({server:relay});
const trace=[];let delay=0,jitter=0;const timers=new Set();
wss.on('connection',down=>{
 const up=new WebSocket(`ws://127.0.0.1:${address.port}/ws`,{origin}), pending=[];
 const queues=[[],[]], active=[null,null];
 const drain=direction=>{
  active[direction]=null;const queue=queues[direction];
  while(queue.length&&queue[0].at<=performance.now()+.1){const item=queue.shift();if(item.target.readyState===WebSocket.OPEN){const m=JSON.parse(item.data.toString());if(direction===0&&m.type==='move'||direction===1&&m.type==='motion')trace.push({at:performance.now(),inbound:direction===0,type:m.type,epoch:m.epoch,seq:m.commands?.map(c=>c[0]),motion:m.motion});item.target.send(item.data.toString());}}
  if(queue.length){const timer=setTimeout(()=>{timers.delete(timer);drain(direction);},Math.max(1,queue[0].at-performance.now()));active[direction]=timer;timers.add(timer);}
 };
 const later=(target,data,inbound)=>{
  const direction=inbound?0:1,queue=queues[direction],now=performance.now();
  const at=Math.max(queue.at(-1)?.at??0,now+delay+jitter*Math.sin(now*(inbound?.009:.007)));
  queue.push({at,target,data});if(!active[direction])drain(direction);
 };
 down.on('message',data=>up.readyState===WebSocket.CONNECTING?pending.push(data):later(up,data,true));
 up.on('open',()=>pending.splice(0).forEach(data=>later(up,data,true)));
 up.on('message',data=>later(down,data,false));
 down.on('close',()=>up.close());up.on('close',()=>down.close());up.on('error',()=>down.close());
});
await new Promise(r=>relay.listen(0,'127.0.0.1',r));process.env.ROOM_URL=`127.0.0.1:${relay.address().port}`;
const web=await createServer({server:{hmr:false,port,strictPort:true,host:'127.0.0.1'},logLevel:'warn'});await web.listen();
const browser=await launch(),errors=[],results=[],dir='docs/reliability';await mkdir(dir,{recursive:true});let page;
const pass=s=>{console.log('PASS',s);results.push(s);};
try{
 page=await open(browser,{url:origin},'Movement QA',errors,{viewport:{width:800,height:600}});
 await page.waitForFunction(()=>window.__campusDebug?.state().prediction.active);
 // Authoritative relocation to clear ground; subsequent walking uses real keyboard inputs.
 const id=await page.evaluate(()=>window.__campusNet.id()),actor=room.clients.get(id);
 Object.assign(actor,{x:-300,z:300,vx:0,vz:0,vy:0,y:0});
 await page.waitForFunction(()=>Math.abs(window.__campusDebug.state().x+300)<.01);
 await page.evaluate(()=>{window.__motionSamples=[];let previous=performance.now();function record(){const now=performance.now(),s=window.__campusDebug.state();window.__motionSamples.push({at:now,dt:now-previous,x:s.x,z:s.z,y:s.y,pending:s.prediction.pending});previous=now;requestAnimationFrame(record);}requestAnimationFrame(record);});
 delay=1000;jitter=600;
 await page.keyboard.down('KeyD');await page.waitForTimeout(7000);
 await page.keyboard.up('KeyD');await page.keyboard.down('KeyW');await page.waitForTimeout(5000);
 await page.keyboard.up('KeyW');await page.keyboard.press('Space');await page.waitForTimeout(6000);
 delay=0;jitter=0;await page.waitForTimeout(5000);
 const samples=await page.evaluate(()=>window.__motionSamples),s=await page.evaluate(()=>window.__campusDebug.state());
 const gap=Math.hypot(s.x-actor.x,s.z-actor.z);
 assert.ok(gap<.02,`resting server/client gap ${gap}`);
 const backwards=samples.slice(1).filter((p,i)=>p.x<samples[i].x-.05);
 assert.equal(backwards.length,0,`moving right jumped backwards: ${JSON.stringify(backwards)}`);
 assert.equal(s.prediction.pending<15,true);pass('Chrome walks and turns through 1 s one-way delay plus 600 ms jitter without backwards corrections');
 assert.ok(samples.some(p=>p.y>.1),'jump uses the predicted command path');pass('jump, key release and delayed acknowledgements converge to within 2 cm');
 // Walk, blur, reconnect: a stale key or velocity must not keep moving a new session.
 await page.keyboard.down('KeyD');await page.waitForTimeout(1500);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('KeyD');
 await page.waitForTimeout(1800);const before=await page.evaluate(()=>window.__campusNet.id());await page.evaluate(()=>window.__campusNet.abandon());
 await page.waitForFunction(old=>window.__campusNet.id()!==old&&window.__campusDebug.state().prediction.active,before);
 await page.waitForTimeout(2000);const resting=await page.evaluate(()=>window.__campusDebug.state());await page.waitForTimeout(1500);const later=await page.evaluate(()=>window.__campusDebug.state());
 assert.ok(Math.hypot(later.x-resting.x,later.z-resting.z)<.02);pass('blur clears held movement; reconnect resets prediction and velocity');
 const shooter=room.clients.get(await page.evaluate(()=>window.__campusNet.id())),ball=room.world.balls[0];
 Object.assign(shooter,{x:ball.x,z:ball.z+.5,y:0,vx:0,vz:0,vy:0});
 await page.waitForFunction(x=>Math.abs(window.__campusDebug.state().x-x)<.01,ball.x);
 const picked=await page.evaluate(async id=>(await import('/src/interaction/world.ts')).request('pickup',{ball:id}),ball.id);assert.equal(picked.ok,true,picked.reason);
 await page.evaluate(()=>window.__campusDebug.startCharge());await page.waitForTimeout(300);delay=350;jitter=150;
 await page.evaluate(()=>window.__campusDebug.releaseShot());
 await page.waitForFunction(()=>!window.__campusDebug.state().holding&&window.__campusDebug.state().world.balls.some(b=>b.shot));
 delay=0;jitter=0;await page.waitForTimeout(2500);
 const shot=await page.evaluate(()=>window.__campusDebug.state());assert.ok(Math.hypot(shot.x-shooter.x,shot.z-shooter.z)<.02);assert.equal(shot.y,0);
 pass('pickup, charge and jump shot preserve authoritative movement through delayed acknowledgements');
 await page.screenshot({path:`${dir}/chrome-movement.png`});
 assert.deepEqual(errors,[]);await writeFile(`${dir}/chrome-movement.json`,JSON.stringify({results,errors,samples,trace,finalGap:gap},null,2));
}catch(e){if(page)await page.screenshot({path:`${dir}/motion-failure.png`}).catch(()=>{});throw e;}
finally{for(const t of timers)clearTimeout(t);await browser.close();wss.clients.forEach(c=>c.terminate());wss.close();relay.close();await room.close();await Promise.race([web.close(),new Promise(r=>setTimeout(r,3000))]);}
