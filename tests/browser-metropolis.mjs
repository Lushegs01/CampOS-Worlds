// Lobby -> WebSocket -> authoritative city match -> rendered city, on desktop and phone.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { launch, open } from './support/browser.mjs';
const realism = process.env.METROPOLIS_REALISM === '1';
const shots = realism ? 'docs/screenshots/metropolis-realism' : 'docs/screenshots/metropolis'; await mkdir(shots, {recursive:true});
let clockOffset = 0;
const stack = await startStack({name:'metropolis-browser',webPort:5191,roomPort:3221,supabasePort:54341,arena:{clock:()=>Date.now()+clockOffset,rules:{countdownMs:100,spawnProtectMs:0}}});
let browser; const errors=[], failures=[], result={checks:[], screenshots:[]};
const check = name => { result.checks.push(name); console.log('PASS',name); };
try {
  browser = await launch();
  for (const mobile of [false,true]) {
    const page = await open(browser,stack,mobile?'Phone':'Desktop',errors,{mobile,viewport:mobile?{width:844,height:390}:{width:1280,height:800}});
    page.on('response',r=>{if(r.status()>=400 && r.url().includes('/assets/')) failures.push(`${r.status()} ${r.url()}`);});
    await page.evaluate(quality=>localStorage.setItem('campos-arena-settings',JSON.stringify({quality,qualityChosen:true,adaptive:false})),realism && !mobile ? 'medium' : 'low');
    await page.getByRole('button',{name:/Combat Arena/}).click();
    await page.waitForFunction(()=>window.__arena?.state().status==='ready');
    await page.getByRole('tab',{name:'Training',exact:true}).click();
    await page.getByRole('combobox',{name:/^Map/}).selectOption('metropolis');
    await page.getByRole('combobox',{name:/^Weather/}).selectOption(mobile?'night':'day');
    await page.getByRole('button',{name:'Open the firing range'}).click();
    await page.waitForFunction(()=>window.__arenaDeploy?.().stage==='deployed',null,{timeout:180000});
    const state = await page.evaluate(()=>window.__arena.state());
    const match = stack.room.arena.matches.get(state.match.id), player=match.players.find(p=>p.num===state.you.num);
    assert.equal(match.map.id,'metropolis'); assert.equal(match.variant,mobile?'night':'day');
    await page.waitForFunction(()=>Math.abs(window.__arena.self()?.y-5)<.05);
    check(`${mobile?'phone':'desktop'} selects map/weather, deploys, and spawns at street level`);
    const places = mobile ? [['night',-18,5,-25,-Math.PI/2]] : [['avenue',-42,5,-25,-Math.PI/2],['plaza',-20,5,0,-Math.PI/2],['rooftops',-40,12,-35,-Math.PI/2],['station',-20,1,0,-Math.PI/2],['industrial',-12,5,31,-Math.PI/2]];
    for(const [name,x,y,z,yaw] of places) {
      Object.assign(player.sim,{x,y,z,vx:0,vy:0,vz:0}); player.history=[];
      await page.evaluate(yaw=>window.__arena.look(yaw,0),yaw);
      await page.waitForFunction(({x,y,z})=>{const p=window.__arena.self();return p&&Math.hypot(p.x-x,p.y-y,p.z-z)<.2;},{x,y,z});
      await page.waitForTimeout(500);
      await page.evaluate(()=>{window.__arenaRenderScale(.75);});
      await page.waitForTimeout(500);
      await page.screenshot({path:`${shots}/${name}.png`});
      await page.evaluate(()=>{window.__arenaRenderScale(.2);});result.screenshots.push(`${shots}/${name}.png`);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    check(`${mobile?'phone':'desktop'} renders districts without page overflow`);
    // A shot crosses the actual pane using normal input, and the authoritative event reaches the client.
    if(!mobile) {
      const pane=match.map.glass.find(g=>!g.alongZ&&g.min[2]<-32&&g.min[1]<6);
      Object.assign(player.sim,{x:(pane.min[0]+pane.max[0])/2,y:5,z:-30,vx:0,vz:0}); player.history=[];
      await page.evaluate(()=>window.__arena.look(0,0)); await page.waitForTimeout(500);
      await page.evaluate(async()=>{const {hold}=await import('/src/arena/input.ts');const {B}=await import('/shared/arena/sim.mjs');hold(B.FIRE,true);});
      await page.waitForFunction(async i=>{const {live}=await import('/src/arena/net.ts');return live.broken.has(i);},pane.i);
      await page.evaluate(async()=>{const {hold}=await import('/src/arena/input.ts');const {B}=await import('/shared/arena/sim.mjs');hold(B.FIRE,false);});
      assert.ok(match.broken.has(pane.i));check('a real shot shatters a pane on server and client');
      const reconnect=await page.evaluate(async()=>{const {request}=await import('/src/arena/net.ts');const s=window.__arena.state();return request({t:'rejoin',match:s.match.id,key:s.you.key});});assert.equal(reconnect.ok,true);
      assert.equal(await page.evaluate(async i=>{const {live}=await import('/src/arena/net.ts');return live.broken.has(i);},pane.i),true);check('rejoin preserves broken glass');
      Object.assign(player.sim,{x:0,y:1,z:0,vx:0,vy:0,vz:0}); player.history=[];
      await page.evaluate(()=>window.__arena.look(Math.PI,0));
      clockOffset = match.startedAt + 52000 - Date.now();
      await page.waitForFunction(()=>window.__arenaDebug?.().city.train===true);
      const tx=await page.evaluate(()=>window.__arenaDebug().city.trainX);
      assert.ok(Math.abs(tx)<50); check('server clock drives a visible train through Plaza Station');
      await page.screenshot({path:`${shots}/train.png`}); result.screenshots.push(`${shots}/train.png`);

    }
    result[mobile?'phone':'desktop'] = await page.evaluate(()=>({stats:window.__arenaStats,deploy:window.__arenaDeploy()}));
    await page.context().close();
  }
  assert.deepEqual(errors,[]); assert.deepEqual(failures,[]); result.ok=true;
} catch(e) { result.ok=false; result.error=String(e.stack??e); console.error(e); process.exitCode=1; if(browser) for(const c of browser.contexts())for(const p of c.pages()) { result.deploy=await p.evaluate(()=>window.__arenaDeploy?.()).catch(()=>null);await p.screenshot({path:`${shots}/failure.png`}).catch(()=>{}); } }
finally { result.errors=errors;result.assetFailures=failures;await writeFile(realism ? 'docs/metropolis-realism-results.json' : 'docs/metropolis-browser-results.json',JSON.stringify(result,null,2)+'\n');await browser?.close();await stack.stop(); }
