export type GraphicsPhase = 'INITIALIZING' | 'READY' | 'CONTEXT_LOST' | 'RECOVERING' | 'RECOVERY_FAILED' | 'DISPOSED';
export interface GraphicsState {
  phase: GraphicsPhase;
  generation: number;
  rendererId: number | null;
  resourcesReady: boolean;
  error: string;
}

/** One canvas owner's lifecycle. Every asynchronous result must carry its original attempt/renderer. */
export function createGraphicsLifecycle(onTransition?: (previous: GraphicsState, next: GraphicsState) => void) {
  let state: GraphicsState = { phase: 'INITIALIZING', generation: 1, rendererId: null, resourcesReady: false, error: '' };
  const listeners = new Set<() => void>();
  const publish = (next: GraphicsState) => { const previous = state; state = next; onTransition?.(previous, next); for (const listener of listeners) listener(); };
  const current = (generation: number, id?: number) => state.phase !== 'DISPOSED' && state.generation === generation && (id === undefined || state.rendererId === id);
  const working = () => state.phase === 'INITIALIZING' || state.phase === 'RECOVERING' || state.phase === 'READY';
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    current,
    attach(generation: number, id: number) {
      if (!current(generation) || !working() || state.rendererId !== null) return false;
      publish({ ...state, rendererId: id }); return true;
    },
    preparing(generation: number, id: number) {
      if (!current(generation, id) || !working()) return false;
      if (state.resourcesReady || state.phase === 'READY') publish({ ...state, phase: state.phase === 'READY' ? 'INITIALIZING' : state.phase, resourcesReady: false });
      return true;
    },
    resourcesReady(generation: number, id: number) {
      if (!current(generation, id) || !working()) return false;
      if (!state.resourcesReady) publish({ ...state, resourcesReady: true });
      return true;
    },
    frameRendered(generation: number, id: number) {
      if (!current(generation, id) || !working() || !state.resourcesReady) return false;
      if (state.phase !== 'READY') publish({ ...state, phase: 'READY', error: '' });
      return true;
    },
    lost(generation: number, id: number, error: string) {
      if (!current(generation, id) || !working()) return false;
      publish({ ...state, phase: 'CONTEXT_LOST', resourcesReady: false, error }); return true;
    },
    fail(generation: number, error: string, id?: number) {
      if (!current(generation, id) || state.phase === 'CONTEXT_LOST') return false;
      publish({ ...state, phase: 'RECOVERY_FAILED', resourcesReady: false, error }); return true;
    },
    recover(generation: number) {
      if (!current(generation) || !['CONTEXT_LOST', 'RECOVERY_FAILED'].includes(state.phase)) return false;
      publish({ phase: 'RECOVERING', generation: generation + 1, rendererId: null, resourcesReady: false, error: '' }); return true;
    },
    dispose() {
      // Final removal invalidates callbacks synchronously, without scheduling a React update during unmount.
      state = { ...state, phase: 'DISPOSED', resourcesReady: false }; listeners.clear();
    },
  };
}
export type GraphicsLifecycle = ReturnType<typeof createGraphicsLifecycle>;
