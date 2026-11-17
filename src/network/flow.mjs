/** Bound browser TCP buffering and speculative simulation independently of rendering quality. */
export const MAX_BUFFERED_BYTES = 64 * 1024;
export const MAX_PENDING_COMMANDS = 120; // two seconds of 60 Hz Arena prediction
export function canPredict(pending, bufferedBytes) {
  return pending < MAX_PENDING_COMMANDS && bufferedBytes <= MAX_BUFFERED_BYTES;
}
/** Match/connection-scoped timestamp guard: reject an entire stale snapshot, including its HUD and life. */
export function createSnapshotOrder() {
  let latest = -Infinity;
  return {
    reset() { latest = -Infinity; },
    accept(at) { if (!Number.isFinite(at) || at <= latest) return false; latest = at; return true; },
  };
}
