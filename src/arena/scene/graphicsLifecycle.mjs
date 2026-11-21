/** @typedef {'INITIALIZING' | 'READY' | 'CONTEXT_LOST' | 'RECOVERING' | 'RECOVERY_FAILED' | 'DISPOSED'} GraphicsState */

/** One Arena owner; generations reject callbacks from retired renderer/resources. */
export function createGraphicsLifecycle() {
  let generation = 0;
  /** @type {{ state: GraphicsState, error: string, generation: number }} */
  let snapshot = { state: 'INITIALIZING', error: '', generation };
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const allowed = {
    INITIALIZING: ['READY', 'CONTEXT_LOST', 'RECOVERING', 'RECOVERY_FAILED', 'DISPOSED'],
    READY: ['CONTEXT_LOST', 'RECOVERING', 'RECOVERY_FAILED', 'DISPOSED'],
    CONTEXT_LOST: ['RECOVERING', 'RECOVERY_FAILED', 'DISPOSED'],
    RECOVERING: ['READY', 'CONTEXT_LOST', 'RECOVERY_FAILED', 'DISPOSED'],
    RECOVERY_FAILED: ['RECOVERING', 'DISPOSED'], DISPOSED: [],
  };
  /** @param {number} id @param {GraphicsState} state @param {string} [error] */
  const transition = (id, state, error = '') => {
    if (id !== generation || !allowed[snapshot.state].includes(state)) return false;
    snapshot = { state, error, generation };
    listeners.forEach(fn => fn());
    return true;
  };
  const invalidate = () => {
    generation++;
    snapshot = { ...snapshot, generation };
    listeners.forEach(fn => fn());
  };
  return {
    getSnapshot: () => snapshot,
    /** @param {() => void} fn */
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    begin() {
      generation++;
      snapshot = { state: generation === 1 ? 'INITIALIZING' : 'RECOVERING', error: '', generation };
      listeners.forEach(fn => fn());
      return generation;
    },
    transition,
    /** @param {number} id */
    retire(id) { if (id === generation) { transition(id, 'DISPOSED'); invalidate(); } },
    /** @param {number} id */
    restore(id) {
      if (snapshot.state !== 'CONTEXT_LOST') return false;
      if (!transition(id, 'RECOVERING')) return false;
      invalidate();
      return true;
    },
    retry() {
      if (!['CONTEXT_LOST', 'RECOVERY_FAILED'].includes(snapshot.state)) return false;
      transition(generation, 'RECOVERING');
      invalidate();
      return true;
    },
  };
}
