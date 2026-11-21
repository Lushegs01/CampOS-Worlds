import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { account, launch, open, roomPlayer, signIn } from './support/browser.mjs';
import { CONTACT, O } from '../shared/getaway.mjs';

const output = process.env.GETAWAY_EVIDENCE ?? '/tmp/getaway-visual';
const portShift = Number(process.env.GETAWAY_PORT_SHIFT ?? 0);
const stack = await startStack({
  name: 'getaway-visual' + portShift, webPort: 5187 + portShift, roomPort: 3287 + portShift, supabasePort: 54871 + portShift, heartbeatMs: 90000,
});
const browser = await launch();
const errors = [];
const failedAssets = [];
const viewport = { width: 1280, height: 800 };
const profile = process.env.GETAWAY_PROFILE ?? 'high';
const timing = process.env.GETAWAY_TIMING === '1';
const combatOnly = process.env.GETAWAY_COMBAT_ONLY === '1';
const blastOnly = process.env.GETAWAY_BLAST_FRAME === '1';
try {
  await mkdir(output, { recursive: true });
  const user = await account(stack, 'visualqa', 'Visual QA', 'tunde');
  console.log('Starting ' + profile + (timing ? ' frame pacing' : ' captures'));
  const page = await open(browser, stack, 'Visual QA', errors, {
    viewport, query: `/?qa-render-lab&qa-norender&qa-scale=${timing ? 0.48 : 0.62}`,
    quality: profile, mobile: profile === 'low',
  });
  page.on('response', response => {
    if (!response.ok() && response.status() !== 304 && response.url().includes('/assets/')) failedAssets.push(response.url());
  });
  console.log('Campus ready');
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('Performance.enable');
  await page.evaluate(() => { performance.clearResourceTimings(); performance.setResourceTimingBufferSize(1200); });
  await signIn(page, user);
  console.log('Signed in');
  if (combatOnly) {
    await page.evaluate(async () => (await import('/src/state.ts')).useGame.getState().set({ reducedMotion: false }));
  }
  const actor = () => roomPlayer(stack, user.handle);
  assert.ok(actor(), 'authenticated player in the room');
  async function place(x, z, yaw = 0, pitch = .06, zoom = 5.4) {
    Object.assign(actor(), { x, z, y: 0, vx: 0, vy: 0, vz: 0 });
    await page.evaluate(pose => window.__campusDebug.teleport(...pose), [x, z, yaw, pitch, zoom]);
    await page.waitForFunction(([x, z]) => {
      const p = window.__campusInspect().position;
      return Math.hypot(x - p.x, z - p.z) < .75;
    }, [x, z]);
    await page.waitForTimeout(900);
  }
  const metrics = { profile, viewport, timing, sample: timing ? 'Live renderer on requestAnimationFrame' : 'Single-frame capture', views: {}, failedAssets, errors };
  async function capture(name, position, target) {
    if (blastOnly && name !== 'fuel-blast') return;
    if (blastOnly) {
      const available = await page.waitForFunction(({position,target})=>{
        const gl=window.__campusGL, camera=window.__campusCamera, scene=window.__campusScene;
        const wreck=scene.getObjectByName('getaway:fuel-wreck');
        const effects=scene.getObjectByName('getaway:effects');
        if(!wreck||!effects?.children.some(mesh=>mesh.isInstancedMesh&&mesh.visible&&
          mesh.geometry.getAttribute('aColor')?.array.some((value,index)=>index%4===3&&value>.12)))return false;
        camera.position.set(...position);
        camera.lookAt(...target);
        gl.info.reset();
        if(window.__campusComposer)window.__campusComposer.render(1/60);
        else gl.render(scene,camera);
        return {frame:gl.domElement.toDataURL('image/jpeg',.93).split(',')[1],camera:camera.position.toArray(),target,
          wreck:!!scene.getObjectByName('getaway:fuel-wreck'),fallout:!!scene.getObjectByName('getaway:blast-site'),
          draw:{...gl.info.render}};
      },{position,target},{timeout:25000});
      const {frame,...details}=await available.jsonValue();
      assert.equal(details.wreck,true);
      await writeFile(`${output}/${name}.jpg`,Buffer.from(frame,'base64'));
      metrics.views[name]=details;
      console.log(name,JSON.stringify(details));
      return;
    }
    await page.waitForFunction(() => window.__campusLoads() === 0);
    const info = await page.evaluate(({ position, target, timing }) => {
      const gl = window.__campusGL, camera = window.__campusCamera, scene = window.__campusScene;
      const context = gl.getContext(), extension = context.getExtension('WEBGL_debug_renderer_info');
      if (!timing) {
        if (position) {
          camera.position.set(...position);
          camera.lookAt(...target);
        }
        gl.info.reset();
        if (window.__campusComposer) window.__campusComposer.render(.016);
        else gl.render(scene, camera);
      }
      return {
        renderer: extension && context.getParameter(extension.UNMASKED_RENDERER_WEBGL),
        width: context.drawingBufferWidth, height: context.drawingBufferHeight,
        shadowMap: scene.getObjectsByProperty('isDirectionalLight', true).find(light => light.castShadow)?.shadow.mapSize.toArray(),
        post: !!window.__campusComposer, quality: window.__campusInspect().quality,
        camera: camera.position.toArray(),
        connection: window.__campusInspect().status,
        resources: { ...gl.info.memory },
        draw: { ...gl.info.render },
        hostiles: scene.getObjectsByProperty('isGroup', true).filter(group => group.name.startsWith('getaway:hostile:')).length,
        weapon: scene.getObjectByName('getaway:weapon:sparrow')?.name ?? null,
        districtMeshes: scene.getObjectsByProperty('isMesh', true).filter(mesh => /industrial:|getaway:/.test(mesh.name)).length,
      };
    }, { position, target, timing });
    const { metrics: entries } = await devtools.send('Performance.getMetrics');
    info.jsHeapUsedBytes = entries.find(entry => entry.name === 'JSHeapUsedSize')?.value;
    assert.equal(info.quality, profile);
    assert.equal(info.connection, 'connected', `${name} has a live room connection`);
    assert.equal(info.post, profile === 'high' || profile === 'ultra');
    if (timing) {
      info.framePacing = await page.evaluate(() => new Promise(resolve => {
        const gl = window.__campusGL, scene = window.__campusScene, camera = window.__campusCamera;
        const times = [];
        let start = 0, last = 0, warmup = 2;
        function sample(now) {
          // Keep setup and room controls render-free in the software lab. During the sample,
          // draw the live scene and tracked camera through the active pipeline on each animation frame.
          const dt = last ? (now - last) / 1000 : .016;
          gl.info.reset();
          if (window.__campusComposer) window.__campusComposer.render(dt);
          else gl.render(scene, camera);
          if (warmup > 0) {
            warmup--;
            last = now;
            return requestAnimationFrame(sample);
          }
          if (!start) start = last;
          times.push(now - last);
          last = now;
          if (now - start < 7000) return requestAnimationFrame(sample);
          times.sort((a, b) => a - b);
          resolve({
            fps: 1000 * times.length / (now - start),
            p50ms: times[Math.floor(.5 * times.length)], p95ms: times[Math.floor(.95 * times.length)],
            durationMs: now - start, frames: times.length,
            calls: gl.info.render.calls, triangles: gl.info.render.triangles,
            textures: gl.info.memory.textures, geometries: gl.info.memory.geometries,
          });
        }
        requestAnimationFrame(sample);
      }));
    } else {
      await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 88 });
    }
    metrics.views[name] = info;
    console.log(name, JSON.stringify(info));
  }

  await place(CONTACT.x, CONTACT.z + 1.5);
  if (!timing && !combatOnly) await capture('character-close', [137.4, 1.53, 50.05], [136, 1.43, 48]);
  const talk = profile === 'low' ? '.touch-action' : '.interact-prompt';
  await page.locator(talk + '[aria-label="Talk to Sade"]').click();
  await page.getByRole('button', { name: 'Accept assignment' }).click();
  await page.waitForFunction(async () => (await import('/src/mission/client.ts')).useGetaway.getState().mission?.stage === 1);
  if (!combatOnly) {
    await place(189, 37, .04);
    await capture('third-person');
  }
  if (!timing && !combatOnly) {
    await capture('industrial-street', [203, 2.45, 53.4], [187, 2.7, 25]);
    await capture('wide', [221, 17, 72], [194, 3, 17]);
    await capture('vehicle-close', [211.8, 1.38, 49.9], [209.6, .85, 45.65]);
  }
  await place(191, 22);
  await page.waitForFunction(async () => (await import('/src/mission/client.ts')).useGetaway.getState().mission?.stage === 2);
  assert.equal(actor().getaway.stage, O.combat);
  // Keep the render sample on the mission's newly spawned actors while benchmarking a stationary camera.
  for (const enemy of actor().getaway.actors) enemy.nextShot = Date.now() / 1000 + 180;
  if (process.env.GETAWAY_EXPECT_TRANSFORMED === '1') {
    await page.waitForFunction(() => window.__campusScene.getObjectByName('getaway:weapon:sparrow')
      && window.__campusScene.getObjectsByProperty('isGroup', true).filter(group => group.name.startsWith('getaway:hostile:')).length >= 2);
  }
  await capture('warehouse-interior', [191, 2.7, 22.7], [192.6, 2.3, 5]);
  if (!timing && process.env.GETAWAY_EXPECT_TRANSFORMED === '1') {
    await page.waitForFunction(() => Math.abs(window.__campusCamera.position.y - 1.5) < .2);
    await capture('combat-view');
  }
  if (combatOnly && profile === 'high') {
    // Start at the case checkpoint so the normal server ambush timer supplies a real blast event.
    Object.assign(actor().getaway, { stage: O.ambush, checkpoint: O.ambush, carried: true, actors: [] });
    await place(191, 29.5);
    for (const enemy of actor().getaway.actors) enemy.nextShot = Date.now() / 1000 + 180;
    if (blastOnly) actor().getaway.blastAt=Date.now()/1000+1.4;
    else await page.waitForFunction(async () => {
      const mission = (await import('/src/mission/client.ts')).useGetaway.getState().mission;
      const pool = window.__campusScene.getObjectByName('getaway:effects');
      return mission?.exploded
        && !!window.__campusScene.getObjectByName('getaway:fuel-wreck')
        && pool?.children.some(mesh => mesh.isInstancedMesh && mesh.visible
          && mesh.geometry.getAttribute('aColor')?.array.some((value, index) => index % 4 === 3 && value > .12));
    }, null, { timeout: 20000 });
    await capture('fuel-blast', [187.5, 2.8, 38], [198, 1.35, 32]);
  }
  metrics.assets = await page.evaluate(() => {
    const views = performance.getEntriesByType('resource').filter(entry => /\/assets\/(getaway|arena\/(mobile\/)?(props|characters|weapons))\//.test(entry.name));
    return {
      requests: views.length, transferredBytes: views.reduce((n, entry) => n + entry.transferSize, 0),
      maxDurationMs: Math.max(0, ...views.map(entry => entry.duration)),
    };
  });
  metrics.graphicsErrors = await page.evaluate(() => window.__graphics?.().events
    .filter(e => /shader-error|creation-error|context.?lost/.test(e.event ?? e.type ?? e.name)) ?? []);
  await writeFile(`${output}/metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
  assert.deepEqual(metrics.graphicsErrors, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedAssets, []);
} finally {
  await browser.close();
  await stack.stop();
}
