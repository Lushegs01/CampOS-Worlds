// The cinematic director in the running game, on the full local stack (room server, accounts, Vite).
// Each sequence must start from the real game state it is written for, play its shots with subtitles and
// letterboxing, end (or be skipped) and give the camera and controls back with the mission state unchanged.
// The harness moves the player and, where noted, sets a mission checkpoint on the room (as `Resume checkpoint`
// does) so the run reaches each beat in minutes; the beats themselves (Sade's briefing, the yard, the ambush blast,
// the lock-up arrival, the delivery) are produced by the room's own mission logic.
// Usage: node tests/browser-cinema.mjs   (CINEMA_EVIDENCE=dir)
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { open, launch, account, signIn, roomPlayer } from './support/browser.mjs';
import { CONTACT, PACKAGE, SAFEHOUSE, WAREHOUSE, O, distance } from '../shared/getaway.mjs';
import { clearWanted } from '../server/mission/police.mjs';

const stack = await startStack({ name: 'browser-cinema', webPort: 5193, roomPort: 3293, supabasePort: 54853 });
const browser = await launch(), errors = [];
const OUT = process.env.CINEMA_EVIDENCE ?? 'docs/screenshots/cinema';
await mkdir(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80); } throw Error('Timed out: ' + label); };
const results = { date: new Date().toISOString(), sequences: {}, errors };
let page, who;
const self = () => roomPlayer(stack, who.handle), mission = () => self()?.getaway;
const place = async (x, z, yaw = 0) => { Object.assign(self(), { x, z }); await page.evaluate(([x, z, yaw]) => window.__campusDebug.teleport(x, z, yaw, .08, 5.4), [x, z, yaw]); await sleep(400); };
const cinema = () => page.evaluate(() => window.__cinema.state());
const render = () => page.evaluate(() => { const gl = window.__campusGL, s = window.__campusScene, c = window.__campusCamera; if (gl && s && c) gl.render(s, c); }).catch(() => {});
async function capture(id, { shots = 6, skipAfter = null, since = 0 } = {}) {
  const started = await until(async () => { const c = await cinema(); return (c.running?.id === id || c.log.some(e => e.id === id && e.event === 'start' && e.at >= since)) && c; }, `cinematic ${id} starts`, 30000);
  const seen = new Set(), frames = [];
  let shotIndex = -1, subtitles = new Set();
  while (true) {
    const s = await cinema(); if (!s.running || s.running.id !== id) break;
    if (s.subtitle) subtitles.add(`${s.subtitle.speaker}: ${s.subtitle.text}`);
    if (s.running.shot !== shotIndex && seen.size < shots) {
      shotIndex = s.running.shot; seen.add(s.running.shotName);
      await sleep(250); await render();
      const file = `${OUT}/${id}-${String(seen.size).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: file, type: 'jpeg', quality: 84 });
      frames.push({ shot: s.running.shotName, at: s.running.t, file, letterbox: await page.evaluate(() => getComputedStyle(document.querySelector('.cinema-bar.top')).height), subtitle: s.subtitle?.text ?? null });
    }
    if (skipAfter !== null && s.running.t > skipAfter) { await page.keyboard.press('Enter'); skipAfter = null; }
    await sleep(120);
  }
  const s = await cinema();
  const log = s.log.filter(e => e.id === id && e.at >= since);
  const record = { started: started.running, shots: [...seen], frames, subtitles: [...subtitles], log, cameraRestored: s.camera, active: s.active };
  results.sequences[id] = record; console.log(id, JSON.stringify({ shots: record.shots, subtitles: record.subtitles.length, end: log.at(-1) }));
  return record;
}
try {
  who = await account(stack, 'cinemaqa', 'Cinema QA');
  page = await open(browser, stack, 'Cinema QA', errors, { viewport: { width: 1100, height: 620 }, query: '/?qa-scale=0.5' });
  await signIn(page, who);
  await until(self, 'room verified account');
  await page.evaluate(() => sessionStorage.removeItem('campos-cinema-seen'));

  // 1–2. The city reveal: the player crosses from the campus onto the Gateway Expressway.
  await place(0, 1180, Math.PI); await sleep(1500);
  await place(0, 1305, Math.PI);
  const reveal = await capture('city-reveal');
  assert.ok(reveal.shots.length >= 3, 'reveal shots');
  assert.ok(reveal.log.some(e => e.event === 'end'));

  // 3–4. Meeting Sade: walk up, press E. The briefing panel waits for the scene; the subtitles follow her lines.
  await place(CONTACT.x + 1.3, CONTACT.z + .2, -Math.PI / 2);
  await page.getByRole('button', { name: 'Talk to Sade', exact: true }).waitFor({ timeout: 15000 });
  await page.keyboard.press('e');
  const meet = await capture('meet-contact');
  assert.ok(meet.shots.length >= 4 && meet.subtitles.length >= 3, JSON.stringify(meet.shots));
  await page.getByRole('button', { name: 'Accept assignment' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Accept assignment' }).click();
  await until(() => mission()?.stage === O.warehouse, 'mission accepted');

  // Skipping: talk to Sade again later is not possible mid-mission, so skip the yard establishing shot instead.
  // 5. Arriving at Bay 04 (skipped after a second: the mission state must be identical either way).
  const stageBefore = mission().stage;
  await place(WAREHOUSE.x + 4, WAREHOUSE.z + 26, Math.PI);
  const yard = await capture('warehouse-arrival', { skipAfter: 1.2 });
  assert.ok(yard.log.some(e => e.event === 'skip'), 'skipped');
  assert.equal(mission().stage, stageBefore, 'skipping changed nothing');
  const controls = await page.evaluate(async () => { const { player } = await import('/src/state.ts'); const z0 = player.z; return z0; });
  results.controlsAfterSkip = controls;

  // 8. The ambush blast: from the ambush checkpoint the room starts the ambush when the player leaves the case's
  // corner of the yard, and the leaking drum goes up nine seconds later.
  Object.assign(mission(), { stage: O.ambush, carried: true, checkpoint: O.ambush });
  await place(PACKAGE.x, PACKAGE.z + 22, Math.PI);
  await until(() => mission().ambushed, 'ambush begins', 15000);
  const blast = await capture('explosion');
  assert.ok(mission().exploded, 'the room reports the blast');
  assert.ok(blast.shots.length >= 2);

  // Stand the ambush down so the run can continue to Baobab Close (the beats after the escape are what follow).
  for (const a of mission().actors) a.hp = 0;
  clearWanted(mission().pd); Object.assign(mission(), { failed: null, health: 100 });
  // 16–18. Lock-up arrival and the delivery: from the safehouse leg (the pursuit already lost), drive the last
  // stretch's end on foot; the room advances to the handover when the player reaches Baobab Close.
  Object.assign(mission(), { stage: O.safehouse, carried: true, wanted: 0 });
  await place(SAFEHOUSE.x + 9, SAFEHOUSE.z + 9, Math.PI);
  await place(SAFEHOUSE.x + 4, SAFEHOUSE.z + 3, Math.PI);
  await until(() => mission().stage === O.deliver, 'arrived at the lock-up ' + JSON.stringify({ stage: mission().stage, failed: mission().failed, at: [self().x, self().z], wanted: mission().wanted }), 15000);
  const arrival = await capture('safehouse-arrival');
  assert.ok(arrival.shots.length >= 1);
  await place(SAFEHOUSE.x, SAFEHOUSE.z + 1.5, Math.PI); // (south of it: a street light stands 1 m to its east)
  await page.getByRole('button', { name: 'Hand the case to Sade', exact: true }).waitFor({ timeout: 20000 }).catch(async e => { throw Error('no handover prompt ' + JSON.stringify({ stage: mission().stage, carried: mission().carried, wanted: mission().wanted, at: [self().x, self().z], client: await page.evaluate(() => window.__campusDebug.state().x + ',' + window.__campusDebug.state().z) })); });
  const mark = await page.evaluate(() => Math.round(performance.now()));
  await page.keyboard.press('e');
  await until(() => mission().stage >= O.commit, 'room accepted the delivery', 15000);
  const delivery = await capture('delivery', { since: mark });
  assert.ok(delivery.log.some(e => e.event === 'start') && delivery.log.some(e => e.event === 'end'));
  assert.ok(delivery.log.filter(e => e.event === 'shot').length >= 4, 'delivery shots');
  await page.getByText(/Delivery verified|campaign XP|Guest run/).first().waitFor({ timeout: 20000 });
  await render(); await page.screenshot({ path: `${OUT}/debrief-after-delivery.jpg`, type: 'jpeg', quality: 84 });
  results.ok = true;
  assert.deepEqual(errors.filter(e => !/WebSocket/.test(e)), []);
} catch (e) {
  results.ok = false; results.failure = String(e?.stack ?? e);
  console.error(e); await page?.screenshot({ path: `${OUT}/failure.jpg`, type: 'jpeg' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(process.env.CINEMA_RESULTS ?? 'docs/cinema-results.json', JSON.stringify(results, null, 2));
  await browser.close(); await stack.stop();
}
void distance;
