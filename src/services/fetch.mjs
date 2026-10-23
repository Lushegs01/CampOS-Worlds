/** Bound account/API requests, preserve caller cancellation and avoid browser caches of private data. */
export async function fetchWithTimeout(input, init = {}, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const controller = new AbortController(), signal = init.signal ?? (input instanceof Request ? input.signal : null);
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Campus service timed out', 'TimeoutError')), timeoutMs);
  try { return await fetchImpl(input, { ...init, cache: 'no-store', signal: controller.signal }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
