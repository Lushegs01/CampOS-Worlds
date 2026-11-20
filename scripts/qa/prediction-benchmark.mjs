// Microbenchmark of the actual shared authority/prediction code, not a device FPS test.
// BASELINE_ROOT=/tmp/... node scripts/qa/prediction-benchmark.mjs
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import * as after from '../../shared/prediction.mjs';

const before = await import(pathToFileURL(resolve(process.env.BASELINE_ROOT, 'shared/prediction.mjs')));
const count = 40000, runs = { before: [], after: [] };
const body = () => ({ x: -300, y: 0, z: 300, vx: 0, vy: 0, vz: 0, yaw: 0 });
function measure(module, count) {
  const w = body(), authority = module.createMotionAuthority(w), epoch = authority.snapshot('', 0).epoch;
  const command = [0, 1 / 60, 1, 0, 0, 0, 0], message = { epoch, commands: [command] };
  const start = performance.now();
  for (let i = 1; i <= count; i++) {
    command[0] = i; command[2] = i % 120 < 60 ? 1 : -1;
    if (!authority.receive(message, '', i * 1000 / 60, () => true)) throw Error('Command rejected');
    if (i % 4 === 0) authority.snapshot('', i * 1000 / 60);
  }
  return { elapsedMs: performance.now() - start, checksum: [w.x, w.y, w.z] };
}
for (const module of [before, after]) measure(module, 5000);
for (let i = 0; i < 7; i++) for (const label of i % 2 ? ['after', 'before'] : ['before', 'after']) runs[label].push(measure(label === 'before' ? before : after, count));
const median = label => runs[label].map(r => r.elapsedMs).sort((a, b) => a - b)[3];
if (JSON.stringify(runs.before[0].checksum) !== JSON.stringify(runs.after[0].checksum)) throw Error('Movement changed');
const report = { date: new Date().toISOString(), node: process.version, commandsPerRun: count, repetitions: 7,
  environment: 'Linux container; shared movement authority, open collision callback, 60 Hz commands / 15 Hz snapshots. CPU microbenchmark only; no GPU, network or phone FPS claim.',
  medianMs: { before: median('before'), after: median('after') }, improvementPercent: (1 - median('after') / median('before')) * 100, runs };
await mkdir('docs/performance', { recursive: true });
await writeFile('docs/performance/mandate-prediction-cpu.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.medianMs), report.improvementPercent.toFixed(1) + '% less elapsed CPU work');
