import { createContext, useContext, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import type { GraphicsLifecycle } from './lifecycle';

export const GraphicsSession = createContext<{ lifecycle: GraphicsLifecycle; generation: number } | null>(null);
export const rendererSessions = new WeakMap<THREE.WebGLRenderer, { id: number; owns: () => boolean }>();

/** Ready is proved at the end of the scene's actual render pass, never by mount/download completion. */
export function useGraphicsSession() {
  const session = useContext(GraphicsSession), gl = useThree(s => s.gl);
  if (!session) throw new Error('A graphics session requires ExclusiveCanvas.');
  const { lifecycle, generation } = session;
  return useMemo(() => {
    const mine = () => rendererSessions.get(gl);
    const current = () => { const r = mine(); return !!r && r.owns() && lifecycle.current(generation, r.id); };
    const canRender = () => {
      const phase = lifecycle.getSnapshot().phase;
      return current() && !gl.getContext().isContextLost() && (phase === 'INITIALIZING' || phase === 'RECOVERING' || phase === 'READY');
    };
    return {
      isReady: () => canRender() && lifecycle.getSnapshot().phase === 'READY',
      canRender,
      beginFrame: () => {
        if (!canRender()) return false;
        // Attribute validation errors to this complete pass, not an older optional/probe call.
        if (lifecycle.getSnapshot().phase !== 'READY' && lifecycle.getSnapshot().resourcesReady) {
          const context = gl.getContext();
          for (let i = 0; i < 16 && context.getError() !== context.NO_ERROR; i++) { /* drain prior errors once */ }
        }
        return canRender();
      },
      preparing: () => { const r = mine(); if (r && current()) lifecycle.preparing(generation, r.id); },
      resourcesReady: () => { const r = mine(); if (r && canRender()) lifecycle.resourcesReady(generation, r.id); },
      frameRendered: () => {
        const r = mine(); if (!r || !canRender()) return;
        if (!lifecycle.getSnapshot().resourcesReady) return;
        if (lifecycle.getSnapshot().phase !== 'READY') {
          const context = gl.getContext(), error = context.getError();
          if (error !== context.NO_ERROR) { lifecycle.fail(generation, `The first graphics frame failed (WebGL ${error}).`, r.id); return; }
        }
        lifecycle.frameRendered(generation, r.id);
      },
      fail: (error: unknown) => { const r = mine(); if (r && current() && !gl.getContext().isContextLost()) lifecycle.fail(generation, String(error instanceof Error ? error.message : error), r.id); },
    };
  }, [lifecycle, generation, gl]);
}
