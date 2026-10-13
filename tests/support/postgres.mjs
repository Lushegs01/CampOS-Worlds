// A real PostgreSQL 17 server for tests and local development (embedded-postgres), prepared like a
// Supabase database: the shim in supabase-shim.sql, then every migration in supabase/migrations.
// Requests run the way PostgREST runs them: one transaction, SET LOCAL ROLE, and the caller's JWT
// claims in request.jwt.claims, so Row Level Security and grants are exercised for real.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER = 'postgres', PASSWORD = 'campos-local-only';

/** Start (or reuse) a cluster in `dir` and create a fresh database with the schema applied. */
/** Each test file uses its own cluster (`name`) so files can run in parallel. */
export async function startDatabase({ name = 'test', dir = join(tmpdir(), `campos-worlds-pg17-${name}`), port = 54000 + Math.floor(Math.random() * 900), database = `campos_${Date.now().toString(36)}`, keep = false } = {}) {
  const server = new EmbeddedPostgres({ databaseDir: dir, user: USER, password: PASSWORD, port, persistent: true, initdbFlags: ['--encoding=UTF8', '--no-locale'], onLog: () => {}, onError: () => {} });
  if (!existsSync(join(dir, 'PG_VERSION'))) await server.initialise();
  try { await server.start(); }
  catch {
    // A previous run that was killed can leave a stale lock file behind.
    await rm(join(dir, 'postmaster.pid'), { force: true });
    try { await server.start(); }
    catch (e) { throw new Error(`PostgreSQL did not start in ${dir} (is another test run using it, or a stray postgres process still running?): ${e?.message ?? e}`); }
  }
  const admin = new pg.Client({ host: '127.0.0.1', port, user: USER, password: PASSWORD, database: 'postgres' });
  await admin.connect();
  const exists = (await admin.query('select 1 from pg_database where datname = $1', [database])).rowCount > 0;
  // Supabase databases are UTF-8; template0 lets us choose that whatever the cluster default is.
  if (!exists) await admin.query(`create database "${database}" with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  await admin.end();
  const pool = new pg.Pool({ host: '127.0.0.1', port, user: USER, password: PASSWORD, database, max: 12 });
  if (!exists) await migrate(pool);
  return {
    pool, port, database,
    url: `postgres://${USER}:${PASSWORD}@127.0.0.1:${port}/${database}`,
    async stop() {
      await pool.end();
      if (!keep) { const c = new pg.Client({ host: '127.0.0.1', port, user: USER, password: PASSWORD, database: 'postgres' }); await c.connect(); await c.query(`drop database if exists "${database}" with (force)`); await c.end(); }
      await server.stop();
    },
  };
}

export async function migrate(pool) {
  await pool.query(await readFile(join(ROOT, 'tests', 'support', 'supabase-shim.sql'), 'utf8'));
  const dir = join(ROOT, 'supabase', 'migrations');
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pool.query(await readFile(join(dir, file), 'utf8'));
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
/**
 * Call `public.<fn>(named args)` as a Supabase API role. `claims` is the decoded JWT payload
 * ({ sub, role }); omit it to call as `anon`. Returns the function's JSON result.
 */
export async function rpc(pool, fn, args = {}, claims = null) {
  if (!IDENT.test(fn)) throw Object.assign(new Error('Unknown function'), { code: 'PGRST202' });
  const role = claims?.role === 'service_role' ? 'service_role' : claims?.sub ? 'authenticated' : 'anon';
  const names = Object.keys(args);
  for (const n of names) if (!IDENT.test(n)) throw Object.assign(new Error('Unknown argument'), { code: 'PGRST202' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: 'anon' })]);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as result`;
    const { rows } = await client.query(sql, names.map(n => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])));
    await client.query('commit');
    return rows[0]?.result ?? null;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
}

/** Run raw SQL as an API role (for checking direct-table permissions the way PostgREST would). */
export async function asRole(pool, claims, sql, params = []) {
  const role = claims?.role === 'service_role' ? 'service_role' : claims?.sub ? 'authenticated' : 'anon';
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: 'anon' })]);
    const result = await client.query(sql, params);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
}
