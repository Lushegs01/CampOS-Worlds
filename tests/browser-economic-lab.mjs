// Real WebGL + room server. QA steering feeds the normal walker; no economic outcomes are injected.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRoom} from '../server/room.mjs';
import {createServer} from 'vite';
import {launch,open} from './support/browser.mjs';
import {LAB_STATIONS} from '../shared/economic-lab.mjs';

const webPort=5181,room=createRoom({port:0,origins:[`http://127.0.0.1:${webPort}`]}),address=await room.start();
process.env.ROOM_URL=`127.0.0.1:${address.port}`;
const web=await createServer({server:{hmr:false,port:webPort,strictPort:true,host:'127.0.0.1'},logLevel:'warn'});await web.listen();
const browser=await launch(),errors=[],results=[],shots=process.env.TEST_OUTPUT_DIR||'docs/screenshots/economic-lab';await mkdir(shots,{recursive:true});
const pass=s=>{results.push(s);console.log('PASS',s);};
let page;
const state=()=>page.evaluate(()=>window.__campusDebug.state());
async function close(){if(await page.getByRole('button',{name:'Close panel'}).isVisible())await page.getByRole('button',{name:'Close panel'}).click();}
async function walk(x,z){await close();await page.evaluate(([x,z])=>window.__campusDebug.walkTo(x,z),[x,z]);await page.waitForFunction(()=>!window.__campusDebug.walking(),null,{timeout:90000});const p=await state();assert.ok(Math.hypot(p.x-x,p.z-z)<.5,`walk ended at ${p.x},${p.z}, target ${x},${z}`);}
async function station(id,touch=false){console.log('STATION',id);const s=LAB_STATIONS.find(s=>s.id===id);if(id==='research'){await walk(-52,24.5);await walk(-52,26.35);}else if(id==='verification')await walk(-52,24);await walk(s.point.x,s.point.z);await page.evaluate(()=>window.__campusDebug.face(Math.PI));await page.waitForFunction(id=>window.__campusDebug.focus()?.id===`lab:${id}`,id);if(touch)await page.locator('.touch-action').click();else await page.keyboard.press('KeyE');await page.getByRole('heading',{name:s.name,exact:true}).waitFor();await page.waitForFunction(()=>window.__labStore.getState().view&&!window.__labStore.getState().busy);}
async function saved(){await page.waitForFunction(()=>!window.__labStore.getState().busy);const error=await page.evaluate(()=>window.__labStore.getState().error);assert.equal(error,'');}
try {
 page=await open(browser,{url:`http://127.0.0.1:${webPort}`},'Economic Lab QA',errors);
 await page.evaluate(async()=>{window.__labStore=(await import('/src/economy/client.ts')).useLab;});
 const before=await page.evaluate(()=>({avatar:window.__campusInspect().avatar,tokens:window.__campusInspect().tokens}));
 await walk(-30,36.5);await walk(-57,36.5);await walk(-57,29);
 await page.evaluate(()=>window.__campusDebug.face(Math.PI));await page.waitForFunction(()=>window.__campusDebug.focus()?.id==='economic-lab-main');await page.screenshot({path:`${shots}/exterior.png`});
 assert.equal((await state()).world.doors['economic-lab-main'],0);await page.keyboard.press('KeyE');await page.waitForFunction(()=>window.__campusDebug.state().world.doors['economic-lab-main']!==0);await walk(-57,25.8);
 pass('walked from campus spawn, opened the real door and entered the lab');
 await station('control');await page.getByLabel('Create six seeded customer orders').uncheck();await page.getByRole('button',{name:'Start scenario',exact:true}).click();await saved();pass('physical Simulation Control starts an authoritative run');
 await station('market');await page.getByLabel('Receiver',{exact:true}).selectOption('welcome');await page.getByRole('button',{name:'Create order',exact:true}).click();await saved();await page.getByLabel('Receiver',{exact:true}).selectOption('courts');await page.getByRole('button',{name:'Create order',exact:true}).click();await saved();pass('Market Operations creates reserved orders');
 await station('tasks');await page.getByRole('button',{name:/^Claim /}).first().click();await saved();await page.getByRole('button',{name:/^Submit .* for verification/}).click();await page.waitForFunction(()=>window.__labStore.getState().view.current.tasks[0].status==='revision');assert.match(await page.locator('[role="alert"]').textContent(),/origin_and_quantity/);pass('a fabricated incomplete submission is returned for revision with actual failure reasons');
 await page.screenshot({path:`${shots}/tasks.png`});
 await walk(-54,21.5);await walk(-57,25.8);await walk(-57,31.5);await page.waitForFunction(()=>window.__campusDebug.focus()?.label==='Collect reserved packs');await page.keyboard.press('KeyE');await page.waitForFunction(()=>!!window.__labStore.getState().view.current.tasks[0].pickup);
 await walk(-57,36.5);await walk(-32,36.5);await walk(-32,26);await walk(-12,26);await walk(-12,25);await page.waitForFunction(()=>window.__campusDebug.focus()?.label==='Deliver reserved packs');await page.keyboard.press('KeyE');await page.waitForFunction(()=>!!window.__labStore.getState().view.current.tasks[0].delivery);
 await walk(-12,26);await walk(-32,26);await walk(-32,36.5);await walk(-57,36.5);await walk(-57,25.8);await station('tasks');await page.getByRole('button',{name:/^Submit .* for verification/}).click();await saved();assert.equal(await page.evaluate(()=>window.__labStore.getState().view.current.tasks[0].status),'accepted');pass('human walked to pickup and receiver; server verified and atomically settled the delivery');
 await station('agents');await page.getByRole('button',{name:'Execute one authorized delivery'}).click();await saved();assert.equal(await page.evaluate(()=>window.__labStore.getState().view.current.metrics.agentAccepted),1);await page.screenshot({path:`${shots}/agent.png`});pass('physical AI station executes a bounded deterministic delivery through the same verifier');
 await station('verification');assert.equal(await page.locator('.lab-card').count(),5);assert.ok(await page.getByText('Verification failed',{exact:false}).count());await page.screenshot({path:`${shots}/evidence.png`});pass('verification station preserves failed and verified evidence plus both contribution records');
 await station('research');await page.getByRole('button',{name:'Run policy comparison'}).click();await saved();await page.getByText('Comparison · seed 42',{exact:true}).waitFor();
 const [json]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export JSON evidence'}).click()]);await json.saveAs(`${shots}/evidence.json`);const [report]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export readable report'}).click()]);await report.saveAs(`${shots}/report.md`);await page.getByRole('button',{name:'Check external adapter'}).click();await saved();await page.getByText(/not-connected:/).waitFor();await page.screenshot({path:`${shots}/research.png`});pass('research compares actual runs, downloads JSON and readable report, and discloses no external connection');
 await close();await walk(-52,26.35);await walk(-57,25.8);await walk(-57,30);await walk(-57,36.5);await walk(-30,36.5);await walk(0,36);
 const after=await page.evaluate(()=>({avatar:window.__campusInspect().avatar,tokens:window.__campusInspect().tokens}));assert.deepEqual(after.avatar,before.avatar);assert.ok(before.tokens.every(t=>after.tokens.includes(t)),'unrelated progress is preserved; ordinary walking may collect keepsakes');pass('exited to ordinary campus with avatar and unrelated progress intact');
 const token=await page.evaluate(()=>sessionStorage.getItem('campus-session'));await page.context().close();
 page=await open(browser,{url:`http://127.0.0.1:${webPort}`},'Mobile Lab QA',errors,{viewport:{width:390,height:844},mobile:true});await page.evaluate(async()=>{window.__labStore=(await import('/src/economy/client.ts')).useLab;});
 // Place the mobile tester on the approach; the door crossing and station use still use the walker and touch action.
 const id=await page.evaluate(()=>window.__campusNet.id()),c=room.clients.get(id);Object.assign(c,{x:-57,z:29,y:0,input:{dx:0,dz:0,sprint:false,jump:false}});await page.waitForFunction(()=>Math.abs(window.__campusDebug.state().x+57)<.5);
 await walk(-57,25.8);await station('research',true);await page.getByRole('button',{name:'Run policy comparison'}).click();await saved();
 const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth,modal:document.querySelector('[role="dialog"]').scrollWidth>document.querySelector('[role="dialog"]').clientWidth+1}));assert.deepEqual(overflow,{page:false,modal:false});await page.screenshot({path:`${shots}/mobile.png`});pass('390px phone uses touch workstation interaction and usable comparison/export controls without horizontal overflow');
 assert.ok(token);assert.deepEqual(errors,[]);await writeFile(`${shots}/results.json`,JSON.stringify({results,errors},null,2));console.log(`${results.length} browser checks passed`);
} catch(error) {console.error(error);if(page)await page.screenshot({path:`${shots}/failure.png`}).catch(()=>{});throw error;} finally {await browser.close();await room.close();await Promise.race([web.close(),new Promise(resolve=>setTimeout(resolve,3000))]);}
