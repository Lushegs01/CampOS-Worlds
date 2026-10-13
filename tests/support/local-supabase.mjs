// A small local stand-in for the two Supabase services CampOS Worlds uses, for automated tests and
// keyless local development. It is NOT a production backend and never ships in the app bundle.
//
//   Auth (GoTrue subset): POST /auth/v1/signup, POST /auth/v1/token?grant_type=password|refresh_token,
//                         GET /auth/v1/user, POST /auth/v1/logout
//   Data (PostgREST subset): POST /rest/v1/rpc/<function>
//
// Data calls run against a real PostgreSQL database prepared from supabase/migrations, as the API
// role named by the request's JWT, so Row Level Security and grants behave as they do on Supabase.
import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { rpc } from './postgres.mjs';

const scryptAsync = promisify(scrypt);
const b64u = value => Buffer.from(value).toString('base64url');

export function signJwt(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
/** Returns the payload of a valid token signed with `secret`, `'expired'`, or null. */
export function verifyJwt(token, secret) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url')), given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload; try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return null; }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return 'expired';
  return payload;
}

async function hashPassword(password) { const salt = randomBytes(16); return `scrypt$${salt.toString('base64')}$${(await scryptAsync(password, salt, 32)).toString('base64')}`; }
async function checkPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$'); if (!salt || !hash) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), 32), wanted = Buffer.from(hash, 'base64');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/**
 * Start the stand-in. `pool` is a pg Pool for a database prepared by tests/support/postgres.mjs.
 * `accessTtl` (seconds) lets tests issue short-lived tokens; `confirmEmail` mimics projects that
 * require email confirmation (sign-up then returns no session).
 */
export async function startLocalSupabase({ pool, port = 0, host = '127.0.0.1', jwtSecret = randomBytes(32).toString('hex'), accessTtl = 3600, confirmEmail = false, minPassword = 8 } = {}) {
  // Fixed claims: the same secret always yields the same API keys, so restarts keep clients working.
  const forever = 4102444800;
  const anonKey = signJwt({ role: 'anon', iss: 'campos-local', exp: forever }, jwtSecret);
  const serviceKey = signJwt({ role: 'service_role', iss: 'campos-local', exp: forever }, jwtSecret);
  const requests = [];

  const userJson = row => ({ id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email, email_confirmed_at: row.email_confirmed_at, created_at: row.created_at, updated_at: row.created_at, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: row.raw_user_meta_data ?? {} });
  async function session(row) {
    const now = Math.floor(Date.now() / 1000), refresh = randomBytes(24).toString('base64url');
    await pool.query('insert into auth.refresh_tokens (token, user_id) values ($1, $2)', [refresh, row.id]);
    const access = signJwt({ sub: row.id, aud: 'authenticated', role: 'authenticated', email: row.email, iat: now, exp: now + accessTtl, session_id: randomUUID(), iss: 'campos-local/auth/v1' }, jwtSecret);
    return { access_token: access, token_type: 'bearer', expires_in: accessTtl, expires_at: now + accessTtl, refresh_token: refresh, user: userJson(row) };
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'x-supabase-api-version');
    res.setHeader('x-supabase-api-version', '2024-01-01');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    let body = '';
    try { for await (const chunk of req) { body += chunk; if (body.length > 65536) throw new Error('too large'); } } catch { reply(413, { code: 'request_too_large', msg: 'Request too large' }); return; }
    let data = {}; if (body) { try { data = JSON.parse(body); } catch { reply(400, { code: 'bad_json', msg: 'Invalid JSON' }); return; } }
    requests.push({ method: req.method, path: url.pathname, search: url.search, authorization: req.headers.authorization ?? null });
    const apikey = req.headers.apikey;
    if (apikey !== anonKey && apikey !== serviceKey) { reply(401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' }); return; }
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    try {
      // ------------------------------------------------------------ auth
      if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
        const email = String(data.email ?? '').trim().toLowerCase(), password = String(data.password ?? '');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { reply(400, { code: 'validation_failed', msg: 'Unable to validate email address: invalid format' }); return; }
        if (password.length < minPassword) { reply(422, { code: 'weak_password', msg: `Password should be at least ${minPassword} characters.`, weak_password: { reasons: ['length'] } }); return; }
        const existing = await pool.query('select id from auth.users where email = $1', [email]);
        if (existing.rowCount) { reply(422, { code: 'user_already_exists', msg: 'User already registered' }); return; }
        const { rows } = await pool.query('insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, $4) returning *', [email, await hashPassword(password), data.data ?? {}, confirmEmail ? null : new Date()]);
        if (confirmEmail) { reply(200, { ...userJson(rows[0]), confirmation_sent_at: new Date().toISOString() }); return; }
        reply(200, await session(rows[0])); return;
      }
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const { rows } = await pool.query('select * from auth.users where email = $1', [String(data.email ?? '').trim().toLowerCase()]);
          if (!rows.length || !(await checkPassword(String(data.password ?? ''), rows[0].encrypted_password))) { reply(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' }); return; }
          if (!rows[0].email_confirmed_at) { reply(400, { code: 'email_not_confirmed', msg: 'Email not confirmed' }); return; }
          reply(200, await session(rows[0])); return;
        }
        if (grant === 'refresh_token') {
          const { rows } = await pool.query('update auth.refresh_tokens set revoked = true where token = $1 and not revoked returning user_id', [String(data.refresh_token ?? '')]);
          if (!rows.length) { reply(400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }); return; }
          const user = await pool.query('select * from auth.users where id = $1', [rows[0].user_id]);
          reply(200, await session(user.rows[0])); return;
        }
        reply(400, { code: 'unsupported_grant_type', msg: 'Unsupported grant type' }); return;
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        const claims = verifyJwt(bearer, jwtSecret);
        if (claims === 'expired') { reply(403, { code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired' }); return; }
        if (!claims?.sub) { reply(403, { code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature' }); return; }
        const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub]);
        if (!rows.length) { reply(403, { code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }); return; }
        reply(200, userJson(rows[0])); return;
      }
      if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
        const claims = verifyJwt(bearer, jwtSecret);
        if (claims && claims !== 'expired' && claims.sub) await pool.query('update auth.refresh_tokens set revoked = true where user_id = $1', [claims.sub]);
        res.writeHead(204); res.end(); return;
      }
      // ------------------------------------------------------------ data
      const match = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]{0,62})$/);
      if (match && req.method === 'POST') {
        const claims = verifyJwt(bearer || apikey, jwtSecret);
        if (claims === 'expired') { reply(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null }); return; }
        if (!claims) { reply(401, { code: 'PGRST301', message: 'Invalid JWT', details: null, hint: null }); return; }
        try { reply(200, await rpc(pool, match[1], data, claims.role === 'anon' ? null : claims)); }
        catch (e) {
          const code = e.code ?? 'P0001';
          if (code === '42883' || code === 'PGRST202') { reply(404, { code: 'PGRST202', message: `Could not find the function public.${match[1]} in the schema cache`, details: null, hint: null }); return; }
          const status = code === '42501' ? (claims.sub ? 403 : 401) : code === '23505' ? 409 : code === 'P0002' ? 404 : 400;
          reply(status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
        }
        return;
      }
      reply(404, { code: 'not_found', msg: 'Not found' });
    } catch (e) {
      reply(500, { code: 'unexpected_failure', msg: 'Unexpected failure', message: e.message });
    }
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  const { port: actual } = server.address();
  return {
    url: `http://${host}:${actual}`, anonKey, serviceKey, jwtSecret, requests,
    /** Mint an access token directly (tests use this for expired-credential cases). */
    token: (sub, seconds = accessTtl) => signJwt({ sub, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + seconds }, jwtSecret),
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}
