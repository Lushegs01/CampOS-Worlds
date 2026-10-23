import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchWithTimeout } from '../src/services/fetch.mjs';

test('a stalled account request times out; a later request can succeed', async () => {
  const server = createServer((req, res) => { if (req.url === '/ok') res.end('recovered'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(fetchWithTimeout(base + '/slow', {}, { timeoutMs: 80 }), { name: 'TimeoutError' });
    assert.equal(await (await fetchWithTimeout(base + '/ok')).text(), 'recovered');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('account fetch preserves caller cancellation and forbids private-response caching', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchWithTimeout('http://127.0.0.1:1/', { signal: controller.signal }), { name: 'AbortError' });
  let policy;
  await fetchWithTimeout('https://example.test/', {}, { fetchImpl: async (_input, init) => { policy = init.cache; return new Response('ok'); } });
  assert.equal(policy, 'no-store');
});
