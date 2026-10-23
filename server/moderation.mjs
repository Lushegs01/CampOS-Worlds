// Single-writer, bounded moderation state. Guest tokens are hashed before being stored.
// An account ban is enforced only after the account service verifies the access token.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_BANS = 5000, MAX_AUDIT = 1000, MAX_TTL = 30 * 86400000;
const ACCOUNT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^[a-f0-9]{48}$/;
export const validAccount = value => typeof value === 'string' && ACCOUNT.test(value);
const sessionKey = token => createHash('sha256').update(token).digest('hex');
const keyOf = (kind, value) => `${kind}:${kind === 'session' ? sessionKey(value) : value.toLowerCase()}`;

export function createModeration({ file = null, now = () => Date.now() } = {}) {
  let state = { version: 1, bans: [], audit: [] }, queue = Promise.resolve();
  const active = ban => ban.expires > now();
  async function persist(next) {
    if (file) {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temp, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(next) + '\n'); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temp, file);
      } finally { await unlink(temp).catch(() => {}); }
    }
    state = next;
  }
  function change(operation) {
    const job = queue.then(operation);
    queue = job.catch(() => {});
    return job;
  }
  return {
    async load() {
      if (!file) return;
      let text;
      try { text = await readFile(file, 'utf8'); }
      catch (error) {
        if (error.code === 'ENOENT') { await persist(state); return; }
        throw new Error('Moderation state could not be read.');
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed.version !== 1 || !Array.isArray(parsed.bans) || parsed.bans.length > MAX_BANS ||
          !Array.isArray(parsed.audit) || parsed.audit.length > MAX_AUDIT || parsed.bans.some(b =>
            typeof b.key !== 'string' || !/^(?:session:[a-f0-9]{64}|account:[0-9a-f-]{36})$/.test(b.key) ||
            !Number.isFinite(b.expires) || !Number.isFinite(b.at) || typeof b.reason !== 'string' || b.reason.length > 300)) throw Error();
        state = parsed;
      } catch { throw new Error('Moderation state is invalid; restore a verified backup before starting.'); }
    },
    banned({ token, account } = {}) {
      const keys = new Set();
      if (typeof token === 'string' && SESSION.test(token)) keys.add(keyOf('session', token));
      if (validAccount(account)) keys.add(keyOf('account', account));
      return state.bans.some(b => active(b) && keys.has(b.key));
    },
    ban({ token, account, reason = '', hours = 24 } = {}) {
      if ((!SESSION.test(typeof token === 'string' ? token : '') && !validAccount(account)) ||
        typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours * 3600000 > MAX_TTL ||
        typeof reason !== 'string' || reason.length > 300) return Promise.reject(new Error('Invalid ban.'));
      const keys = [];
      if (typeof token === 'string' && SESSION.test(token)) keys.push(keyOf('session', token));
      if (validAccount(account)) keys.push(keyOf('account', account));
      return change(async () => {
        const at = now(), expires = at + hours * 3600000;
        const bans = state.bans.filter(b => active(b) && !keys.includes(b.key));
        if (bans.length + keys.length > MAX_BANS) throw new Error('Moderation storage is full.');
        const entry = { at, expires, reason: reason.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim() };
        bans.push(...keys.map(key => ({ key, ...entry })));
        await persist({ version: 1, bans, audit: [...state.audit, { action: 'ban', keys, ...entry }].slice(-MAX_AUDIT) });
        return { expires };
      });
    },
    unban(key) {
      if (typeof key !== 'string' || !/^(?:session:[a-f0-9]{64}|account:[0-9a-f-]{36})$/.test(key)) return Promise.reject(new Error('Invalid ban key.'));
      return change(async () => {
        const removed = state.bans.some(b => b.key === key);
        await persist({ version: 1, bans: state.bans.filter(b => active(b) && b.key !== key),
          audit: [...state.audit, { action: 'unban', keys: [key], at: now() }].slice(-MAX_AUDIT) });
        return { removed };
      });
    },
    list: () => state.bans.filter(active).map(b => ({ ...b })),
    flush: () => queue,
  };
}
