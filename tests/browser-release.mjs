// End-to-end checks of the exact production bundle, service worker and shipped HTTP headers.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchPersistent } from './support/browser.mjs';
import { startProduction } from './support/production.mjs';

const host = await startProduction(), profile = await mkdtemp(join(tmpdir(),'campos-pwa-'));
// Installability must be checked in a real, disposable profile: Chromium deliberately refuses incognito installation.
const persistent = await launchPersistent(profile,{viewport:{width:1280,height:800},deviceScaleFactor:.25});
const browser = persistent.browser(), results = [], errors = [], failed = [];
const pass = label => { results.push(label); console.log('PASS', label); };
await mkdir('docs/release', { recursive: true });
const ready = page => page.waitForFunction(() => {
  const button = document.querySelector('.enter-button'); return button && !button.disabled;
}, null, { timeout: 180000 });
async function context(options = {}) {
  // This machine has no GPU. A real browser DPR of 0.25 keeps software rasterisation responsive,
  // without QA hooks or alterations to the shipped production code. This is not a phone benchmark.
  const ctx = await browser.newContext({ deviceScaleFactor:0.25, ...options });
  await ctx.addInitScript(() => localStorage.setItem('campos-worlds-v1', JSON.stringify({ version: 1, state: { quality: 'low', reducedMotion: true, volume: 0 } })));
  return ctx;
}
function watch(page) {
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR',error.message); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text());console.log('CONSOLE ERROR',message.text().slice(0,350)); } });
  page.on('requestfailed', request => failed.push({ url:request.url(),error:request.failure()?.errorText }));
}
async function appTarget(targetId, browserCdp) {
  // Installation may also open an ordinary browser tab. The first page event is not
  // necessarily the application. Newer Chrome returns a tab target whose child page has
  // a different target id; match its native window as well as supporting page target ids.
  const appWindow=await browserCdp.send('Browser.getWindowForTarget',{targetId});
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) {
    for(const candidate of browser.contexts().flatMap(context=>context.pages())) {
      if(candidate.isClosed())continue;
      const session=await candidate.context().newCDPSession(candidate);
      try {
        const pageId=(await session.send('Target.getTargetInfo')).targetInfo.targetId;
        if(pageId===targetId)return candidate;
        const window=await browserCdp.send('Browser.getWindowForTarget',{targetId:pageId});
        if(window.windowId===appWindow.windowId)return candidate;
      }
      finally { await session.detach(); }
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('The installed application target was not exposed to the browser test');
}
let completed=false, installability, install = { tested:false, reason:'Not attempted' }, timings;
try {
  const ctx = persistent;
  await ctx.addInitScript(() => localStorage.setItem('campos-worlds-v1',JSON.stringify({version:1,state:{quality:'low',reducedMotion:true,volume:0}})));
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000); watch(page);
  const started = Date.now();
  const response = await page.goto(host.url, { waitUntil:'domcontentloaded' });
  assert.equal(response.status(),200);
  assert.equal(response.headers()['x-content-type-options'],'nosniff');
  await ready(page);
  timings = { coldReadyMs:Date.now()-started, browser:await browser.version(), renderer:'Chromium headless / SwiftShader; no physical GPU or phone', viewport:'1280 × 800 CSS pixels, Low, DPR 0.25; unmodified production code' };
  assert.deepEqual(await page.evaluate(() => ['__campus','__campusDebug','__campusInspect','__campusNet','__graphics'].filter(key => key in window)),[]);
  assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'),'https://camposworlds.click/brand/campos-worlds-social.png');
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://camposworlds.click/');
  const social = await ctx.request.get(host.url+'/brand/campos-worlds-social.png');
  assert.equal(social.status(),200); assert.match(social.headers()['content-type'],/image\/png/);
  for (const path of ['/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png','/icons/apple-touch-icon.png','/favicon.svg'])
    assert.equal((await ctx.request.get(host.url+path)).status(),200,path);
  pass('production page, branded metadata, manifest and icons resolve with security headers');

  await page.getByRole('button',{name:'Enter campus',exact:true}).click();
  await page.getByRole('button',{name:/\d+ online/}).waitFor();
  const actor = () => [...host.room.clients.values()].find(client=>client.joined);
  const before = { x:actor().x,z:actor().z };
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800); await page.keyboard.up('KeyW');
  assert.ok(Math.hypot(actor().x-before.x,actor().z-before.z)>.5,'real keyboard movement reaches the authoritative room');
  await page.getByRole('button',{name:'Open campus map',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'Close panel',exact:true}).click();
  pass('production game enters, connects, moves with real input and opens/closes the map');
  await page.screenshot({path:'docs/release/desktop.png'});

  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.ready).active,{},{timeout:60000});
  if (!await page.evaluate(()=>!!navigator.serviceWorker.controller)) { await page.reload(); await ready(page); }
  const cdp = await ctx.newCDPSession(page);
  const appManifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(appManifest.errors,[]);
  installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors,[]);
  pass('Chromium reports a valid manifest and no installability errors; service worker activates and controls the page');
  // Exercise a real install/standalone launch when this Chromium build exposes the PWA CDP domain.
  const browserCdp = await browser.newBrowserCDPSession();
  const originalPages=new Set(ctx.pages());
  try {
    await cdp.send('PWA.install',{manifestId:host.url+'/',installUrlOrBundleUrl:host.url+'/'});
    const state = await cdp.send('PWA.getOsAppState',{manifestId:host.url+'/'});
    // The CDP install API does not run Chrome's end-user install dialog. Its default user
    // preference can be "browser" independently of the manifest's standalone display mode.
    await cdp.send('PWA.changeAppUserSettings',{manifestId:host.url+'/',displayMode:'standalone'});
    const launched = await cdp.send('PWA.launch',{manifestId:host.url+'/'});
    const appPage=await appTarget(launched.targetId,browserCdp);
    watch(appPage);
    await appPage.waitForLoadState('domcontentloaded');await ready(appPage);
    const standalone=await appPage.evaluate(()=>matchMedia('(display-mode: standalone)').matches);
    assert.equal(standalone,true);await appPage.screenshot({path:'docs/release/installed.png'});
    install={tested:true,state,launched,standalone};
    pass('Chromium installs the PWA and launches a standalone app target');
    if(launched.targetId)await browserCdp.send('Target.closeTarget',{targetId:launched.targetId});
    await cdp.send('PWA.uninstall',{manifestId:host.url+'/'});
  } catch(error) {
    install={tested:false,reason:error.message};
    if(!/Method not found|wasn't found|not supported|not implemented|headless|OS integration|kWebAppDisabled/i.test(error.message))throw error;
    console.log('INSTALL LIMITATION',error.message);
  } finally {
    // Chrome's install path can create ordinary campus tabs as well as the app window.
    // Do not leave extra room clients alive for the single-player mobile-input checks.
    for(const extra of ctx.pages())if(!originalPages.has(extra)&&!extra.isClosed())await extra.close();
  }
  await browserCdp.detach();

  if(await page.getByRole('button',{name:'Enter campus',exact:true}).count())await page.getByRole('button',{name:'Enter campus',exact:true}).click();
  await page.getByRole('button',{name:'Pause and settings',exact:true}).click();
  await page.getByRole('heading',{name:'CampOS on your home screen'}).waitFor();
  host.changeWorker();
  let navigations=0; const navigated=frame=>{if(frame===page.mainFrame())navigations++;};page.on('framenavigated',navigated);
  await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
  await page.getByRole('button',{name:'Reload and update',exact:true}).waitFor();
  assert.equal(navigations,0,'an available update does not interrupt gameplay');
  await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'Reload and update',exact:true}).click()]);
  await ready(page);
  assert.ok(navigations>=1,'explicit update reloads');
  page.off('framenavigated',navigated);
  pass('new worker waits; Settings applies the update only on explicit reload');

  await page.evaluate(async()=>{await fetch('/health');});
  const cached = await page.evaluate(async()=>{
    const out=[];for(const name of await caches.keys())for(const request of await (await caches.open(name)).keys())out.push({name,url:request.url});return out;
  });
  const urls=cached.map(c=>c.url), world=/\.(?:glb|ktx2|hdr|ogg|wav)(?:\?|$)/;
  assert.ok(urls.some(url=>url.includes('/offline.html')));
  // No API, account, health or shop response in any cache.
  assert.ok(urls.every(url=>!/(?:\/health|\/auth\/|\/rest\/|\/shop\/)/.test(url)), 'no private or live responses cached');
  // World models, textures and audio: never in the precache (the launch shell); kept only by the runtime static-asset
  // cache (src/world/assetCache.ts), and only at a content revision (?v=…), so a new build replaces them.
  assert.ok(cached.every(({name,url})=>!world.test(url)||(name==='campos-worlds-static-assets'&&/[?&]v=[\w-]{4,64}$/.test(url))), 'world assets only in the revisioned runtime cache');
  pass('caches hold the launch shell and revisioned static assets only: no API, account or live responses');
  // Network failures below are deliberate and kept separate from the normal-flow console audit.
  page.removeAllListeners('requestfailed'); page.removeAllListeners('console');
  host.setUnavailable(true);await ctx.setOffline(true); await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Let’s get you back to campus.'}).waitFor();
  assert.equal(await page.locator('img').evaluate(image=>image.complete&&image.naturalWidth===192),true);
  await page.screenshot({path:'docs/release/offline.png'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('link',{name:'Try campus again'}).waitFor();
  host.setUnavailable(false);await ctx.setOffline(false); await page.getByRole('link',{name:'Try campus again'}).click(); await ready(page);
  pass('offline cold navigation and refresh show branded recovery; reconnect returns to the playable campus');
  await page.close();

  const phoneCtx=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),phone=await phoneCtx.newPage();watch(phone);
  await phone.goto(host.url);await ready(phone);await phone.getByRole('button',{name:'Enter campus',exact:true}).click();
  await phone.getByRole('group',{name:'Movement joystick'}).waitFor();
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),390);
  const joystick=await phone.locator('.joystick').boundingBox(),touch=await phoneCtx.newCDPSession(phone);
  const phoneActor=()=>[...host.room.clients.values()].find(client=>client.joined),position={x:phoneActor().x,z:phoneActor().z};
  const point={id:1,x:joystick.x+joystick.width/2,y:joystick.y+joystick.height/2};
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-joystick.height*.35}]});
  await phone.waitForTimeout(2000);await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(Math.hypot(phoneActor().x-position.x,phoneActor().z-position.z)>.5,'touch movement reaches the server');
  await phone.screenshot({path:'docs/release/mobile.png'});
  await phone.setViewportSize({width:844,height:390});
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),844);
  pass('production phone viewport supports real joystick movement, portrait/landscape and no horizontal overflow');
  await phoneCtx.close();
  const failureCtx = await context({viewport:{width:900,height:600}}), recovery = await failureCtx.newPage();
  // (Blocked for the whole context: revisioned textures are fetched through the service worker's runtime cache, and a
  // page-level route does not see a service worker's requests.)
  await failureCtx.route('**/textures/grass/color.ktx2*',route=>route.abort());
  await recovery.goto(host.url,{waitUntil:'domcontentloaded'});
  await recovery.getByRole('heading',{name:'The campus couldn’t open.'}).waitFor({timeout:60000});
  await failureCtx.unroute('**/textures/grass/color.ktx2*');
  await recovery.getByRole('button',{name:'Reload campus on low quality'}).click();await ready(recovery);
  pass('a failed essential texture offers recovery; retry downloads it and opens the campus');
  const savedBeforeLoss=await recovery.evaluate(()=>JSON.parse(localStorage.getItem('campos-worlds-v1')).state);
  const retiredCanvas=await recovery.locator('.world canvas').elementHandle();
  let recoveryNavigations=0;
  recovery.on('framenavigated',frame=>{if(frame===recovery.mainFrame())recoveryNavigations++;});
  await retiredCanvas.evaluate(canvas=>canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await recovery.getByRole('heading',{name:'Campus graphics were interrupted.',exact:true}).waitFor();
  await recovery.getByRole('button',{name:'Rebuild campus graphics',exact:true}).click();await ready(recovery);
  assert.equal(recoveryNavigations,0,'graphics rebuild preserves the page and its session');
  assert.equal(await recovery.evaluate(old=>document.querySelector('.world canvas')!==old,retiredCanvas),true,'recovery creates a fresh canvas');
  assert.equal(await retiredCanvas.evaluate(canvas=>canvas.getContext('webgl2').isContextLost()),true,'retired context stays released');
  assert.deepEqual(await recovery.evaluate(()=>JSON.parse(localStorage.getItem('campos-worlds-v1')).state),savedBeforeLoss,'graphics recovery preserves settings and saved progress');
  await retiredCanvas.dispose();
  pass('WebGL context loss rebuilds campus in place with a new canvas, released old context and preserved preferences');
  await failureCtx.close();
  const panelCtx=await context({serviceWorkers:'block'}),panelPage=await panelCtx.newPage();
  await panelPage.route('**/AvatarEditor-*.js',route=>route.abort());
  await panelPage.goto(host.url,{waitUntil:'domcontentloaded'});
  await panelPage.getByRole('button',{name:'Make it you',exact:true}).click();
  await panelPage.getByRole('heading',{name:'This panel couldn’t open.'}).waitFor();
  await panelPage.getByRole('button',{name:'Back to campus',exact:true}).click();
  await ready(panelPage);
  pass('a failed optional panel download stays inside its boundary and leaves the campus usable');
  await panelCtx.close();
  assert.deepEqual(errors,[],'no unexpected page or console errors in normal production flows');
  assert.deepEqual(failed,[],'no failed requests in normal production flows');
  completed=true;
} catch(error) {
  const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>!page.isClosed());
  const diagnostics=await Promise.all(pages.map(async(page,index)=>{
    await page.screenshot({path:`docs/release/failure-${index}.png`}).catch(()=>{});
    return {url:page.url(),state:await page.evaluate(async()=>({
      title:document.title,text:document.body?.innerText.slice(0,2000),online:navigator.onLine,
      controller:navigator.serviceWorker?.controller?.scriptURL,
      registrations:(await navigator.serviceWorker?.getRegistrations()??[]).map(r=>({scope:r.scope,active:r.active?.state,waiting:r.waiting?.state})),
      caches:await caches.keys(),
    })).catch(e=>({unavailable:e.message}))};
  }));
  await writeFile('docs/release/failure.json',JSON.stringify({error:error.message,pages:diagnostics},null,2)+'\n');
  throw error;
} finally {
  await writeFile('docs/release/browser.json',JSON.stringify({date:new Date().toISOString(),result:completed?'pass':'fail',results,errors,failed,timings,installability,install},null,2)+'\n');
  await browser.close();await host.stop();await rm(profile,{recursive:true,force:true});
}
