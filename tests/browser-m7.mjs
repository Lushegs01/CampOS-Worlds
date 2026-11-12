// Actual browser → WebSocket → authoritative match → PostgreSQL progression flow.
// No ownership fixture or simulated checkout: the M7 is free.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startStack} from './support/stack.mjs';
import {launch,account,open,signIn} from './support/browser.mjs';
import {B} from '../shared/arena/sim.mjs';
const SHOTS='docs/screenshots/m7/';await mkdir(SHOTS,{recursive:true});
const stack=await startStack({name:'m7-browser',webPort:5189,roomPort:3219,supabasePort:54339,arena:{minRecordMs:0,slowCloseMs:30000,rules:{countdownMs:1000,fillWaitMs:0,spawnProtectMs:0,regenDelayMs:60000,mode:{scoreLimit:2,respawnMs:1500}}}});
const browser=await launch(),errors=[],result={checks:[],screenshots:[]};
const check=(name,detail)=>{result.checks.push({name,detail,ok:true});console.log('✓',name,detail??'');};
const state=p=>p.evaluate(()=>window.__arena.state());
async function arena(p){await p.evaluate(()=>localStorage.setItem('campos-arena-settings',JSON.stringify({quality:'low',showFps:true,adaptive:false})));await p.getByRole('button',{name:/Combat Arena/}).click();await p.waitForFunction(()=>window.__arena?.state().status==='ready');}
async function equip(p){await p.getByRole('button',{name:'Edit loadouts'}).click();await p.getByRole('button',{name:/^SIG Sauer M7/}).click();await p.getByRole('button',{name:'Equip',exact:true}).click();}
async function shot(p,name){
 if(/first-person|third-person|ads/.test(name)) {await p.evaluate(()=>{const g=window.__arenaGL;if(g){g.setPixelRatio(.65);g.setSize(innerWidth,innerHeight,false);}});await p.waitForTimeout(600);}
 await p.screenshot({path:SHOTS+name+'.png'});result.screenshots.push(name+'.png');
 if(/first-person|third-person|ads/.test(name)) await p.evaluate(()=>{const g=window.__arenaGL;if(g){g.setPixelRatio(.2);g.setSize(innerWidth,innerHeight,false);}});
}
async function point(p,yaw,pitch=0){await p.evaluate(([y,x])=>window.__arena.look(y,x),[yaw,pitch]);}
async function key(p,code,ms=50){await p.keyboard.down(code);await p.waitForTimeout(ms);await p.keyboard.up(code);}
try{ flow: {
 const [ada,tobi]=await Promise.all([account(stack,'ada_m7','Ada'),account(stack,'tobi_m7','Tobi')]);
 const pa=await open(browser,stack,'Ada',errors), requests=[];
 pa.on('request',r=>{if(/m7/.test(r.url()))requests.push(r.url());});
 await signIn(pa,ada);await arena(pa);
 assert.ok(!requests.some(u=>/m7(?:-lod)?\.glb/.test(u)),'M7 is not preloaded on campus or lobby');
 await pa.getByRole('button',{name:'Edit loadouts'}).click();await pa.getByRole('button',{name:/^SIG Sauer M7/}).click();
 assert.equal(await pa.getByRole('heading',{name:'Armory',exact:true}).count(),0);
 await pa.getByRole('button',{name:'Equip',exact:true}).click();await pa.getByText('Saved to your account and equipped.').waitFor();
 await shot(pa,'loadout');await pa.getByRole('button',{name:'Close loadouts'}).click();
 const saved=await stack.db.pool.query("select primary_weapon from public.arena_loadouts l join public.profiles p on p.id=l.user_id where handle='ada_m7'");assert.equal(saved.rows[0].primary_weapon,'m7');
 assert.equal((await stack.db.pool.query("select count(*)::int n from public.shop_ownership")).rows[0].n,0);
 check('free M7 equips and saves on a real account with no entitlement or purchase');
 await pa.getByRole('button',{name:/Armory/}).first().click();await pa.getByRole('button',{name:/^SIG Sauer M7/}).click();
 await pa.locator('.ar-inspect-view[data-model="ready"]').waitFor({timeout:60000});await pa.waitForTimeout(800);await shot(pa,'armory');
 assert.equal(await pa.getByRole('button',{name:/Buy for/}).count(),0);check('Armory loads the original model on demand and shows Free');
 await pa.getByRole('button',{name:'Close the Armory'}).click();
 const pb=await open(browser,stack,'Tobi',errors);await signIn(pb,tobi);await arena(pb);await equip(pb);await pb.getByText('Saved to your account and equipped.').waitFor();await pb.getByRole('button',{name:'Close loadouts'}).click();
 for(const p of [pa,pb]){await p.getByRole('radio',{name:/Sim Quad/}).click();await p.getByRole('button',{name:'Quick Play'}).first().click();await p.waitForFunction(()=>window.__arena.state().phase==='match');}
 await pa.waitForFunction(()=>window.__arena.state().hud.matchState==='playing',null,{timeout:60000});
 for(const p of [pa,pb])await p.locator('.ar-scene-loading').waitFor({state:'detached',timeout:90000});
 const sa=await state(pa),sb=await state(pb);assert.equal(sa.match.id,sb.match.id);
 const match=stack.room.arena.matches.get(sa.match.id),A=match.players.find(p=>p.num===sa.you.num),C=match.players.find(p=>p.num===sb.you.num);
 const place=(p,x,z,yaw)=>{Object.assign(p.sim,{x,y:0,z,vx:0,vz:0,yaw});p.history=[];};
 place(A,-20,-6,-Math.PI/2);place(C,-14,-6,Math.PI/2);await point(pa,-Math.PI/2);await point(pb,Math.PI/2);
 await pa.waitForFunction(()=>window.__arenaDebug?.().vm.gun==='m7',null,{timeout:60000});
 await pb.waitForFunction(()=>window.__arenaDebug?.().bodies.some(b=>b.weapon==='m7'),null,{timeout:60000});
 await shot(pa,'first-person');
 place(C,-18,-6,Math.PI/2);await point(pa,Math.PI);await point(pb,Math.PI/2);await pb.waitForTimeout(1400);await shot(pb,'third-person');
 place(C,-14,-6,Math.PI/2);await point(pa,-Math.PI/2);
 check('two clients share a match and see the M7 first-person and third-person LOD');
 if(process.argv.includes('--presentation')) {
   const hold=async(b,on)=>pa.evaluate(async({b,on})=>{const {hold}=await import('/src/arena/input.ts');hold(b,on);},{b,on});
   await hold(B.ADS,true);await pa.waitForFunction(()=>window.__arena.state().hud.ads>.95);await shot(pa,'ads');await hold(B.ADS,false);
   check('2× ADS sight picture remains visible through the hollow optic');result.ok=true;break flow;
 }
 // Selector buttons also support touch; these use exactly the same validated command bits as keys.
 await pa.getByRole('button',{name:'Change fire mode'}).click();await pa.waitForFunction(()=>window.__arena.state().hud.fireMode==='semi');assert.equal(A.sim.wpn[0].mode,'semi');
 // Aim above players while checking trigger cadence and reload.
 await point(pa,-Math.PI/2,.45);let before=A.sim.wpn[0].mag;
 // Test-only dynamic import supplies buttons to the same input object; no state/hit mutation.
 const hold=async(p,b,on)=>p.evaluate(async({b,on})=>{const {hold}=await import('/src/arena/input.ts');hold(b,on);},{b,on});
 await hold(pa,B.FIRE,true);await pa.waitForTimeout(500);await hold(pa,B.FIRE,false);assert.equal(A.sim.wpn[0].mag,before-1);check('semi mode fires once while held and the server owns the selector');
 await pa.getByRole('button',{name:'Change fire mode'}).click();await pa.waitForFunction(()=>window.__arena.state().hud.fireMode==='auto');
 before=A.sim.wpn[0].mag;await hold(pa,B.FIRE,true);await pa.waitForTimeout(650);await hold(pa,B.FIRE,false);assert.ok(before-A.sim.wpn[0].mag>=3);check('automatic mode consumes rounds at the enforced cadence');
 await key(pa,'r');await pa.waitForFunction(()=>window.__arena.state().hud.phase==='reload');await pa.waitForTimeout(1200);await shot(pa,'reload');
 await pa.waitForFunction(()=>window.__arena.state().hud.mag===20&&window.__arena.state().hud.phase==='ready',null,{timeout:10000});assert.equal(A.sim.wpn[0].mag,20);check('reload animation and authoritative ammunition complete together');
 await pa.getByRole('button',{name:'Inspect weapon'}).click();await pa.waitForFunction(()=>window.__arena.state().hud.phase==='inspect');await shot(pa,'inspect');await pa.waitForFunction(()=>window.__arena.state().hud.phase==='ready');
 // Authoritative elimination with the original damage/recoil system; controlled taps aim at body.
 for(let kill=0;kill<2;kill++){
   place(A,-20,-6,-Math.PI/2);place(C,-14,-6,Math.PI/2);await point(pa,-Math.PI/2,-.06);await pa.waitForTimeout(400);
   for(let i=0;i<12&&A.stats.kills<=kill;i++){await point(pa,-Math.PI/2,-.06);await hold(pa,B.FIRE,true);await pa.waitForTimeout(60);await hold(pa,B.FIRE,false);await pa.waitForTimeout(240);}
   assert.ok(A.stats.kills>kill,'server confirms elimination');
   if(kill===0) { const until=Date.now()+10000;while(!C.alive&&Date.now()<until)await pa.waitForTimeout(100);assert.equal(C.alive,true); }
 }
 await pa.waitForFunction(()=>window.__arena.state().phase==='results',null,{timeout:20000});
 const stats=await stack.db.pool.query("select s.shots,s.kills from public.arena_weapon_stats s join public.profiles p on p.id=s.user_id where handle='ada_m7' and weapon='m7'");
 assert.ok(stats.rows[0]?.shots>0&&stats.rows[0]?.kills===2);check('server registers two multiplayer eliminations and persists M7 progression',stats.rows[0]);
 await pa.context().close();await pb.context().close();
 const phone=await open(browser,stack,'Phone',errors,{viewport:{width:390,height:844},mobile:true});await phone.setViewportSize({width:844,height:390});await arena(phone);await equip(phone);await phone.getByRole('button',{name:'Close loadouts'}).click();
 await phone.getByRole('tab',{name:'Training'}).click();await phone.getByRole('button',{name:'Start training'}).click();await phone.waitForFunction(()=>!!window.__arena.state().match);
 const training=stack.room.arena.matches.get((await state(phone)).match.id);for(const b of training.players.filter(p=>p.bot))b.brain.think=()=>null;
 await phone.locator('.ar-scene-loading').waitFor({state:'detached',timeout:90000});await phone.waitForFunction(()=>window.__arena.state().hud.alive);
 await phone.getByRole('button',{name:'Change fire mode'}).tap();await phone.waitForFunction(()=>window.__arena.state().hud.fireMode==='semi');
 const ammo=(await state(phone)).hud.mag;await phone.getByRole('button',{name:'Fire',exact:true}).tap();await phone.waitForFunction(n=>window.__arena.state().hud.mag<n,ammo);
 await phone.getByRole('button',{name:'Reload',exact:true}).tap();await phone.waitForFunction(()=>window.__arena.state().hud.mag===20&&window.__arena.state().hud.phase==='ready',null,{timeout:12000});
 await shot(phone,'mobile');assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);check('guest on mobile equips for free, changes mode, fires and reloads with touch controls');
 assert.deepEqual(errors.filter(e=>!/AudioContext|autoplay/i.test(e)),[]);result.ok=true;
} }catch(e){result.ok=false;result.error=String(e.stack??e);result.errors=errors;result.matches=[...stack.room.arena.matches.values()].map(m=>({players:m.players.map(p=>({num:p.num,alive:p.alive,hp:p.hp,x:p.sim?.x,z:p.sim?.z,stats:p.stats}))}));console.error(e);for(const [i,c] of browser.contexts().entries())for(const p of c.pages())await p.screenshot({path:SHOTS+`failure-${i}.png`}).catch(()=>{});process.exitCode=1;}
finally{result.finished=new Date().toISOString();await writeFile(process.argv.includes('--presentation')?'docs/m7-presentation-results.json':'docs/m7-browser-results.json',JSON.stringify(result,null,2)+'\n');await browser.close();await stack.stop();}
