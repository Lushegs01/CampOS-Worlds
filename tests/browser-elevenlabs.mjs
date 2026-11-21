// Run against a Vite development server. Fixture audio exercises Web Audio without spending API credits.
import assert from 'node:assert/strict';
import { launch } from './support/browser.mjs';

function fixtureAudio() {
  const sampleRate = 8000, samples = sampleRate * 4;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(800 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  return wav;
}

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 720 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.routeWebSocket(/\/ws/, ws => ws.close());
  await page.addInitScript(() => localStorage.setItem('campos-worlds-v1', JSON.stringify({
    state: { quality: 'low', reducedMotion: true }, version: 1,
  })));
  const expected = [
    'voice/teacher/hello', 'voice/teacher/studio', 'voice/sade/briefing',
    'sfx/shot-sparrow', 'sfx/impact-metal', 'sfx/crash', 'sfx/freight-ambience',
  ];
  const body = fixtureAudio();
  const requested = [];
  await page.route('**/assets/elevenlabs/**', route => {
    const path = new URL(route.request().url()).pathname.split('/elevenlabs/')[1];
    if (path === 'manifest.json') {
      return route.fulfill({ json: { clips: Object.fromEntries(expected.map(id => [id, id + '.mp3'])) } });
    }
    assert.ok(expected.includes(path.replace(/\.mp3$/, '')), path);
    requested.push(path);
    return route.fulfill({ body, contentType: 'audio/wav' });
  });
  await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5175') + '/?qa-scale=.2&qa-norender');
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click({ timeout: 120_000 });
  const heard = (id, count = 1) => page.waitForFunction(
    ([key, n]) => window.__campusSounds().played.filter(x => x === key).length >= n, [id, count]);
  const voiceButton = action => page.getByRole('button', { name: new RegExp('^' + action + ' .* voice$') });

  // Use the normal NPC interaction, then exercise the visible replay and stop controls.
  await page.evaluate(() => window.__campusDebug.teleport(35.05, -40.3, 0, .15, 4.6));
  await page.waitForFunction(() => window.__campusDebug.focus()?.label === 'Talk to teacher');
  await page.keyboard.press('KeyE');
  await page.getByRole('heading', { name: 'Ms Ifeoma Okafor' }).waitFor();
  await heard('voice/teacher/hello');
  await page.getByRole('button', { name: 'What is Studio D1 for?' }).click();
  await heard('voice/teacher/studio');
  await page.getByText(/Students meet here/).waitFor();
  await voiceButton('Stop').click();
  await voiceButton('Play').click();
  await heard('voice/teacher/studio', 2);
  await page.getByRole('button', { name: 'Close panel' }).click();

  // Inject the received mission state and events through the same modules used by the room.
  await page.evaluate(async () => {
    const loaded = performance.getEntriesByType('resource').find(r => new URL(r.name).pathname === '/src/mission/client.ts');
    const { useGetaway } = await import(loaded?.name ?? '/src/mission/client.ts');
    useGetaway.setState({ brief: true });
  });
  await page.getByText(/The freight yard used to move university equipment/).waitFor();
  await heard('voice/sade/briefing');
  await page.evaluate(async () => {
    const loaded = performance.getEntriesByType('resource').find(r => new URL(r.name).pathname === '/src/mission/client.ts');
    const { useGetaway } = await import(loaded?.name ?? '/src/mission/client.ts');
    useGetaway.setState({ brief: false });
    window.__campusDebug.teleport(176, 20, 0);
  });
  await heard('loop:sfx/freight-ambience');
  await page.evaluate(async () => {
    const loaded = performance.getEntriesByType('resource').find(r => new URL(r.name).pathname === '/src/mission/sound.ts');
    const { missionSound } = await import(loaded?.name ?? '/src/mission/sound.ts');
    missionSound({ id: 1, kind: 'shot', weapon: 'sparrow', x: 176, y: 1, z: 20,
      impact: true, end: [176, 1, 20], surface: 'metal' });
    missionSound({ id: 2, kind: 'crash', x: 177, y: 1, z: 21 });
  });
  await heard('sfx/shot-sparrow');
  await heard('sfx/impact-metal');
  await heard('sfx/crash');

  await page.getByRole('button', { name: 'Pause and settings', exact: true }).click();
  await page.getByRole('slider', { name: 'Dialogue volume' }).fill('0');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('campos-worlds-v1')).state.dialogueVolume), 0);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.evaluate(async () => {
    const loaded = performance.getEntriesByType('resource').find(r => new URL(r.name).pathname === '/src/mission/client.ts');
    const { useGetaway } = await import(loaded?.name ?? '/src/mission/client.ts');
    useGetaway.setState({ brief: true });
  });
  await page.getByText(/The freight yard used to move university equipment/).waitFor();
  assert.equal(await voiceButton('Play').count(), 0);
  assert.equal(await page.evaluate(() => window.__campusSounds().played.filter(x => x === 'voice/sade/briefing').length), 1);
  assert.equal(requested.filter(path => path === 'voice/teacher/studio.mp3').length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS ElevenLabs fixture playback, replay, mute, positional effects and freight ambience');
} finally {
  await browser.close();
}
