// The whole app running locally with accounts: PostgreSQL (embedded) + the Supabase stand-in + the
// room server with account verification + the Vite dev server configured to use them. Used by the
// browser tests and by `npm run dev:local` for development without a Supabase project.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDatabase } from './postgres.mjs';
import { startLocalSupabase } from './local-supabase.mjs';
import { createRoom } from '../../server/room.mjs';
import { createAccounts } from '../../server/accounts.mjs';

export async function startStack({ name = 'stack', database, keep = false, webPort = 5175, roomPort = 3201, supabasePort = 54321, accessTtl = 3600, confirmEmail = false, vite = true } = {}) {
  const dir = join(tmpdir(), `campos-worlds-pg17-${name}`);
  const db = await startDatabase({ name, database, keep });
  // A stable signing secret keeps local sessions valid across restarts of the dev stack.
  const secretFile = join(dir, 'campos-local-jwt-secret');
  const jwtSecret = keep && existsSync(secretFile) ? (await readFile(secretFile, 'utf8')).trim() : randomBytes(32).toString('hex');
  if (keep) await writeFile(secretFile, jwtSecret);
  const supa = await startLocalSupabase({ pool: db.pool, port: supabasePort, jwtSecret, accessTtl, confirmEmail });
  const origins = [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`];
  const room = createRoom({ port: roomPort, origins, accounts: createAccounts({ url: supa.url, serviceKey: supa.serviceKey, anonKey: supa.anonKey }) });
  await room.start();
  let web = null;
  if (vite) {
    const { createServer } = await import('vite');
    Object.assign(process.env, { VITE_SUPABASE_URL: supa.url, VITE_SUPABASE_ANON_KEY: supa.anonKey, ROOM_URL: `127.0.0.1:${roomPort}` });
    web = await createServer({ configFile: join(process.cwd(), 'vite.config.ts'), mode: 'development', server: { port: webPort, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
    await web.listen();
  }
  return {
    db, supa, room, url: `http://127.0.0.1:${webPort}`,
    // Each step is time-boxed so a stuck socket or server cannot hang a test run.
    async stop() { for (const step of [() => web?.close(), () => room.close(), () => supa.close(), () => db.stop()]) await Promise.race([Promise.resolve().then(step).catch(() => {}), new Promise(r => setTimeout(r, 10000))]); },
  };
}
