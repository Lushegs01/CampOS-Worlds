// Combat Arena server load test: several full Quick Play matches of real WebSocket clients sending
// commands at the real rate (moving, aiming and firing), plus Training matches full of bots, all in
// one room process at once. Clients run in a worker thread, so the main thread's event-loop
// utilisation is the server's own load.
//
// Usage: node scripts/qa/arena-load.mjs   (ARENA_MATCHES=4 ARENA_PLAYERS=12 ARENA_TRAINING=4 ARENA_SECONDS=20)
// Writes docs/performance/arena-load.json.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';

const MATCHES = Number(process.env.ARENA_MATCHES || 4), PLAYERS = Number(process.env.ARENA_PLAYERS || 12), TRAINING = Number(process.env.ARENA_TRAINING || 4), SECONDS = Number(process.env.ARENA_SECONDS || 20);

if (isMainThread) {
  const { createRoom } = await import('../../server/room.mjs');
  const room = createRoom({ port: 0, arena: { maxMatches: 200, capacity: 1000, rules: { countdownMs: 300, fillWaitMs: 0, mode: { scoreLimit: 10000, timeMs: 3600000 } } } });
  const { port } = await room.start();
  const worker = new Worker(new URL(import.meta.url), { workerData: { url: `ws://127.0.0.1:${port}/arena` } });
  const result = await new Promise((resolve, reject) => {
    let elu0, cpu0, t0, lag;
    worker.on('message', m => {
      if (m.type === 'started') { lag = monitorEventLoopDelay({ resolution: 5 }); lag.enable(); elu0 = performance.eventLoopUtilization(); cpu0 = process.cpuUsage(); t0 = performance.now(); }
      if (m.type === 'done') {
        const elu = performance.eventLoopUtilization(elu0), secs = (performance.now() - t0) / 1000; lag.disable();
        const status = room.arena.status(), matches = [...room.arena.matches.values()];
        resolve({
          when: new Date().toISOString(), node: process.version, seconds: +secs.toFixed(1),
          setup: { quickPlayMatches: MATCHES, playersPerMatch: PLAYERS, trainingMatches: TRAINING, botsPerTraining: 9 },
          server: {
            mainThreadUtilisation: +(elu.utilization * 100).toFixed(1) + '%',
            processCpuIncludingClientWorker: +((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1e6 / secs * 100).toFixed(1) + '%',
            eventLoopDelayMs: { p50: +(lag.percentile(50) / 1e6).toFixed(2), p99: +(lag.percentile(99) / 1e6).toFixed(2), max: +(lag.max / 1e6).toFixed(2) },
            heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1), rssMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
            matchesRunning: status.matches.length, connections: status.connections,
            shotsResolved: matches.reduce((a, x) => a + x.players.reduce((b, p) => b + p.stats.shots, 0), 0),
            eliminations: matches.reduce((a, x) => a + x.players.reduce((b, p) => b + p.stats.kills, 0), 0),
          },
          clients: m.clients,
        });
      }
    });
    worker.on('error', reject);
  });
  await mkdir('docs/performance', { recursive: true });
  await writeFile('docs/performance/arena-load.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  await worker.terminate(); await room.close();
} else {
  const { WebSocket } = await import('ws');
  const { quantize, encodeCommand, B } = await import('../../shared/arena/sim.mjs');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clients = [];
  async function connect(name) {
    const ws = new WebSocket(workerData.url, { origin: 'http://localhost:5173' });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const c = { ws, name, seq: 0, snaps: 0, bytes: 0, match: null, counting: false };
    ws.on('message', raw => { const m = JSON.parse(raw); if (c.counting) { c.bytes += raw.length; if (m.t === 's') c.snaps++; } if (m.t === 'match') c.match = m.match.id; });
    ws.send(JSON.stringify({ t: 'hello', name }));
    await sleep(30);
    return c;
  }
  for (let m = 0; m < MATCHES; m++) {
    const mode = m % 2 ? 'dom' : 'tdm', map = m % 4 < 2 ? 'foundry' : 'quad';
    // A private match per group keeps groups apart exactly as Quick Play would fill them.
    const host = await connect(`H${m}`); clients.push(host);
    const code = await new Promise(r => { host.ws.on('message', raw => { const x = JSON.parse(raw); if (x.t === 'reply' && x.code) r(x.code); }); host.ws.send(JSON.stringify({ t: 'private', action: 'create', mode, map, size: PLAYERS / 2, ref: 1 })); });
    for (let i = 1; i < PLAYERS; i++) { const c = await connect(`P${m}-${i}`); c.ws.send(JSON.stringify({ t: 'private', action: 'join', code, ref: 1 })); clients.push(c); }
    await sleep(100); host.ws.send(JSON.stringify({ t: 'private', action: 'start', ref: 2 }));
  }
  const trainers = [];
  for (let t = 0; t < TRAINING; t++) { const c = await connect(`T${t}`); c.ws.send(JSON.stringify({ t: 'training', mode: t % 2 ? 'dom' : 'tdm', map: t % 2 ? 'quad' : 'foundry', bots: 9, difficulty: 'hard', ref: 1 })); trainers.push(c); }
  await sleep(1500);
  for (const c of [...clients, ...trainers]) c.counting = true;
  parentPort.postMessage({ type: 'started' });
  const end = Date.now() + SECONDS * 1000;
  // Every client sends 4 commands every ~66 ms (60 per second), moving, turning and firing in bursts.
  await Promise.all(clients.map(async (c, i) => {
    let k = 0;
    while (Date.now() < end) {
      const batch = [];
      for (let j = 0; j < 4; j++, k++) batch.push(encodeCommand(quantize({ seq: ++c.seq, b: (k % 90 < 40 ? B.FIRE : 0) | (k % 300 === 0 ? B.RELOAD : 0) | (k % 200 === 5 ? B.JUMP : 0), mx: Math.sin(k / 37 + i), mz: Math.cos(k / 29 + i), yaw: Math.sin(k / 80 + i) * 3, pitch: Math.sin(k / 60) * .2 })));
      if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ t: 'c', rt: Date.now() - 100, c: batch }));
      await sleep(66);
    }
  }));
  const secs = SECONDS;
  const rates = clients.map(c => c.snaps / secs), kbps = clients.map(c => c.bytes / secs / 1024);
  parentPort.postMessage({ type: 'done', clients: {
    people: clients.length, trainingViewers: trainers.length,
    snapshotsPerSecond: { min: +Math.min(...rates).toFixed(1), mean: +(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1) },
    downloadKBps: { mean: +(kbps.reduce((a, b) => a + b, 0) / kbps.length).toFixed(1), max: +Math.max(...kbps).toFixed(1) },
  } });
}
