// Real browser + SDK + PostgreSQL + room. Isolates the account layer so a software GPU does not
// need to render two campuses. The production browser suite separately verifies the playable world.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch, account } from './support/browser.mjs';
import { firefox, webkit } from '@playwright/test';
import { startStack } from './support/stack.mjs';

const stack=await startStack({name:'accountrecovery',webPort:5185,roomPort:3206,supabasePort:54336});
const engine=process.env.BROWSER_ENGINE||'chromium';
assert.ok(['chromium','firefox','webkit'].includes(engine),'Unsupported BROWSER_ENGINE');
const browser=await(engine==='chromium'?launch():({firefox,webkit}[engine]).launch()),ctx=await browser.newContext(),results=[],errors=[];
let completed=false;
const pass=label=>{results.push(label);console.log('PASS',label);};
const stamp=Date.now().toString(36),alpha=await account(stack,`ar${stamp}`.slice(0,20),'Recovery Alpha'),beta=await account(stack,`br${stamp}`.slice(0,20),'Recovery Beta');
await ctx.addInitScript(()=>{if(!localStorage.getItem('campos-worlds-v1'))localStorage.setItem('campos-worlds-v1',JSON.stringify({version:1,state:{name:'Recovery Guest',quality:'low'}}));});
const page=await ctx.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
const open=async (p,noRoom=false)=>{await p.goto(stack.url+'/tests/fixtures/account-recovery.html'+(noRoom?'?no-room=1':''),{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!window.recoveryQA,null,{timeout:60000});};
const snapshot=(p=page)=>p.evaluate(()=>{const a=window.recoveryQA.account.useAccount.getState(),g=window.recoveryQA.useGame.getState();return {status:a.status,email:a.email,profile:a.profile?.display_name??null,name:g.name,avatar:g.avatar.model};});
async function roomIs(name){const end=Date.now()+10000;while(![...stack.room.clients.values()].some(c=>c.joined&&c.name===name)){assert.ok(Date.now()<end,`room identity becomes ${name}`);await new Promise(r=>setTimeout(r,30));}}
try {
 await open(page);assert.equal((await snapshot()).status,'guest');
 await page.evaluate(async email=>window.recoveryQA.account.signIn(email,'correct horse battery'),alpha.email);
 assert.equal((await snapshot()).name,'Recovery Alpha');await roomIs('Recovery Alpha');
 pass('real SDK sign-in loads a profile and binds the verified identity to the room');
 let release,reached;
 const held=new Promise(r=>release=r),requested=new Promise(r=>reached=r);
 await page.route('**/rest/v1/rpc/my_profile',async route=>{const response=await route.fetch();reached();await held;await route.fulfill({response});});
 await page.evaluate(()=>{window.pendingProfile=window.recoveryQA.account.reloadProfile();});await requested;
 await page.evaluate(()=>window.recoveryQA.account.signOut());release();await page.evaluate(()=>window.pendingProfile);
 assert.deepEqual(await snapshot(),{status:'guest',email:null,profile:null,name:'Recovery Guest',avatar:'tunde'});await roomIs('Recovery Guest');
 await page.unroute('**/rest/v1/rpc/my_profile');
 pass('a profile response arriving after sign-out cannot restore the old name, appearance or room identity');
 await page.evaluate(async email=>window.recoveryQA.account.signIn(email,'correct horse battery'),alpha.email);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.recoveryQA);
 await page.waitForFunction(()=>window.recoveryQA.account.useAccount.getState().profile?.display_name==='Recovery Alpha');
 assert.equal((await snapshot()).profile,'Recovery Alpha');
 pass('account session and profile restore after a browser reload');
 // A genuine SDK BroadcastChannel session change from another tab, while the replacement profile is delayed.
 let releaseSwitch,reachedSwitch;
 const switchHeld=new Promise(r=>releaseSwitch=r),switchRequested=new Promise(r=>reachedSwitch=r);
 await page.route('**/rest/v1/rpc/my_profile',async route=>{const response=await route.fetch();reachedSwitch();await switchHeld;await route.fulfill({response});});
 const other=await ctx.newPage();await open(other,true);
 await other.waitForFunction(()=>window.recoveryQA.account.useAccount.getState().profile?.display_name==='Recovery Alpha');
 await other.evaluate(async email=>window.recoveryQA.account.signIn(email,'correct horse battery'),beta.email);
 await switchRequested;
 assert.deepEqual(await snapshot(),{status:'signed-in',email:beta.email,profile:null,name:'Recovery Guest',avatar:'tunde'});
 releaseSwitch();await page.waitForFunction(()=>window.recoveryQA.account.useAccount.getState().profile?.display_name==='Recovery Beta');await roomIs('Recovery Beta');
 await page.unroute('**/rest/v1/rpc/my_profile');await other.close();
 pass('a cross-tab account switch clears the previous identity while loading and then binds the new account');
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('campos-worlds-auth'));s.expires_at=1;s.access_token=s.access_token.slice(0,-6)+'AAAAAA';s.refresh_token='revoked';localStorage.setItem('campos-worlds-auth',JSON.stringify(s));});
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.recoveryQA);
 assert.deepEqual(await snapshot(),{status:'guest',email:null,profile:null,name:'Recovery Guest',avatar:'tunde'});
 pass('an expired, unrefreshable session restores guest identity instead of leaving the previous profile visible');
 await page.evaluate(()=>{localStorage.setItem('campos-guest-identity','{broken');localStorage.setItem('campos-worlds-v1',JSON.stringify({version:1,state:{name:'Old account',avatar:{model:'ada'}}}));});
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.recoveryQA);
 assert.deepEqual(await snapshot(),{status:'guest',email:null,profile:null,name:'New explorer',avatar:'tunde'});
 pass('a corrupt guest backup recovers to a valid guest identity');
 const denied=await browser.newContext();await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage denied','SecurityError');}}));
 const privatePage=await denied.newPage();privatePage.on('pageerror',e=>errors.push(e.message));await open(privatePage,true);
 await privatePage.evaluate(async email=>window.recoveryQA.account.signIn(email,'correct horse battery'),alpha.email);
 await privatePage.evaluate(()=>window.recoveryQA.account.signOut());
 assert.deepEqual(await snapshot(privatePage),{status:'guest',email:null,profile:null,name:'New explorer',avatar:'tunde'});await denied.close();
 pass('denied browser storage still allows sign-in and safe guest restoration through memory');
 assert.deepEqual(errors,[]);
 completed=true;
} catch(error) {
 console.log('ACCOUNT STATE',await snapshot(),await page.evaluate(()=>{const s=window.recoveryQA?.account.useAccount.getState();return {profileState:s?.profileState,error:s?.error};}).catch(()=>null));
 throw error;
} finally {
 await mkdir('docs/release',{recursive:true});await writeFile(`docs/release/account-recovery${engine==='chromium'?'':'-'+engine}.json`,JSON.stringify({date:new Date().toISOString(),engine,browser:browser.version(),result:completed?'pass':'fail',results,errors,method:'Actual browser SDK, local Supabase stand-in, PostgreSQL 17 and room; no 3D scene'},null,2)+'\n');
 await browser.close();await stack.stop();
}
