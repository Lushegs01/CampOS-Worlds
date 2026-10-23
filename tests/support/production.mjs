// A real static production host with the shipped Cloudflare headers and the existing room's HTTP/WS.
// No Vite source serving, debug injection, third-party services or modified production bundle.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRoom } from '../../server/room.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg' };
export async function startProduction() {
  const root = resolve('dist'), rules = [], headers = await readFile(resolve(root, '_headers'), 'utf8');
  for (const line of headers.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), values: {} });
    else { const colon = line.indexOf(':'); rules.at(-1).values[line.slice(0, colon).trim()] = line.slice(colon + 1).trim(); }
  }
  let room, workerRevision = '', unavailable = false;
  const server = createServer(async (req, res) => {
    // An actual host outage affects every request, including service-worker targets;
    // keep the recovery check independent of page-level DevTools network emulation.
    if(unavailable){req.socket.destroy();return;}
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (/^\/(?:health|shop|admin)(?:\/|$)/.test(path)) { room.http.emit('request', req, res); return; }
      for (const rule of rules) if (rule.pattern.endsWith('*') ? path.startsWith(rule.pattern.slice(0, -1)) : path === rule.pattern)
        for (const [name, value] of Object.entries(rule.values)) res.setHeader(name, value);
      let target = resolve(root, '.' + decodeURIComponent(path));
      if (!target.startsWith(root + sep) && target !== root) { res.writeHead(403); res.end(); return; }
      if (!extname(path)) target = resolve(root, 'index.html');
      let bytes;
      try { bytes = await readFile(target); } catch { res.writeHead(404); res.end('Not found'); return; }
      if (path === '/sw.js') bytes = Buffer.concat([bytes, Buffer.from(workerRevision)]);
      res.setHeader('Content-Type', TYPES[extname(target)] ?? 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  room = createRoom({ port: 0, origins: [url] }); await room.start();
  server.on('upgrade', (req, socket, head) => room.http.emit('upgrade', req, socket, head));
  return { url, room,
    changeWorker() { workerRevision += '\n// release update test\n'; },
    setUnavailable(value) { unavailable=!!value; },
    async stop() { await room.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
