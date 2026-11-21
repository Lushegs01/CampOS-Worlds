import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cast, takes } from './dialogue-lines.mjs';
import { effects } from './elevenlabs-effects.mjs';

const { values } = parseArgs({ options: {
  'dry-run': { type: 'boolean' }, only: { type: 'string' },
  clip: { type: 'string' }, 'voice-map': { type: 'string' },
} });
if (values.only && !['voice', 'sfx'].includes(values.only)) throw Error('--only expects voice or sfx');
const overrides = values['voice-map'] ? JSON.parse(await readFile(values['voice-map'], 'utf8')) : {};
for (const [speaker, id] of Object.entries(overrides)) {
  if (!Object.hasOwn(cast, speaker) || typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw Error(`Invalid voice mapping for ${speaker}`);
  }
}
const spoken = text => text.replaceAll('Bay 04', 'Bay oh four').replaceAll('Studio D1', 'Studio D one')
  .replaceAll('8:00–22:00', 'eight in the morning to ten at night')
  .replaceAll('6.75 m', 'six point seven five metres');
const jobs = [
  ...takes.map(({ id, speaker, text }) => ({
    id, endpoint: `text-to-speech/${overrides[speaker] ?? cast[speaker]}`,
    body: { text: spoken(text), model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: .46, similarity_boost: .75, style: .12 } },
  })),
  ...Object.entries(effects).map(([name, [duration_seconds, prompt, loop = false]]) => ({
    id: `sfx/${name}`, endpoint: 'sound-generation',
    body: { text: `${prompt} Game sound effect. No voices or music.`, duration_seconds,
      prompt_influence: .45, model_id: 'eleven_text_to_sound_v2', loop },
  })),
].filter(job => (!values.only || job.id.startsWith(values.only + '/')) && (!values.clip || job.id === values.clip));
if (!jobs.length) throw Error('No matching audio clips');
if (values['dry-run']) {
  for (const job of jobs) console.log(job.id);
  const characters = jobs.filter(job => job.id.startsWith('voice/')).reduce((total, job) => total + job.body.text.length, 0);
  const seconds = jobs.reduce((total, job) => total + (job.body.duration_seconds ?? 0), 0);
  console.log(`${jobs.length} clips selected, ${characters} speech characters and ${seconds.toFixed(2)} seconds of effects. No ElevenLabs requests made.`);
} else {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw Error('Set ELEVENLABS_API_KEY in .env.local before generating audio.');
  const root = fileURLToPath(new URL('../../public/assets/elevenlabs/', import.meta.url));
  const manifestFile = join(root, 'manifest.json');
  const lockFile = join(root, '.generation.lock');
  const lock = await open(lockFile, 'wx').catch(error => {
    if (error.code !== 'EEXIST') throw error;
    throw Error('Another ElevenLabs generation is running. If it was terminated, remove .generation.lock from the audio asset directory.');
  });
  const interrupted = new AbortController();
  const interrupt = () => interrupted.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    for (const { id, endpoint, body } of jobs) {
      interrupted.signal.throwIfAborted();
      const fingerprint = createHash('sha256').update(JSON.stringify([endpoint, body])).digest('hex').slice(0, 16);
      const relative = `${id}-${fingerprint}.mp3`;
      const file = join(root, relative);
      const exists = await stat(file).then(s => s.size > 0, error => { if (error.code !== 'ENOENT') throw error; return false; });
      if (!exists) {
        const response = await fetch(`https://api.elevenlabs.io/v1/${endpoint}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify(body), signal: AbortSignal.any([interrupted.signal, AbortSignal.timeout(90_000)]),
        });
        if (!response.ok) throw Error(`${id}: ElevenLabs returned HTTP ${response.status}`);
        const data = Buffer.from(await response.arrayBuffer());
        if (!response.headers.get('content-type')?.startsWith('audio/') || !data.length) {
          throw Error(`${id}: ElevenLabs returned no audio`);
        }
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, data);
        await rename(temporary, file);
        console.log(`Generated ${id}`);
      } else {
        console.log(`Cached ${id}`);
      }
      if (manifest.clips[id] !== relative) {
        manifest.clips[id] = relative;
        const temporary = `${manifestFile}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
        await rename(temporary, manifestFile);
      }
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await lock.close();
    await unlink(lockFile);
  }
}
