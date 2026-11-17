import { Component, useInsertionEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createGraphicsLifecycle, type GraphicsLifecycle } from './lifecycle';
import { GraphicsSession, rendererSessions } from './session';
import { Canvas, type CanvasProps } from '@react-three/fiber';
import * as THREE from 'three';
import { rememberGraphicsCapabilities } from './capabilities';
import { installCompilation } from './compile';
import { acquireRenderer, pixelRatio, drawingBufferBudget } from './ownership';
import { trackDisposeListeners } from './gpuListeners';
import { QA_HOOKS } from '../qa';
import { createContext, releaseContext } from './context';

type Owner = 'campus' | 'arena';
type Diagnostic = Record<string, unknown>;
/** Adapt from the attainable drawing density, so a capped buffer does not hide every resolution trial. */
export function scenePixelRatio(renderer: THREE.WebGLRenderer, width: number, height: number, requested: number, profile: string) {
  const gl = renderer.getContext();
  const limit = Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
  return pixelRatio(width, height, requested, limit, drawingBufferBudget((navigator as Navigator & { deviceMemory?: number }).deviceMemory, profile));
}
const events: Diagnostic[] = [];
let serial = 0;
let lastContextLoss: Diagnostic | null = null;
let inspect: (() => Diagnostic) | null = null;
let active: { id: number; owner: Owner } | null = null;
export function graphicsDiagnostics() { return { active, lastContextLoss, current: inspect?.() ?? null, events: [...events] }; }
if (QA_HOOKS) Object.assign(window, { __graphics: graphicsDiagnostics });
function record(event: Diagnostic) {
  const entry = { at: performance.now(), ...event };
  events.push(entry);
  if (event.event === 'webglcontextlost' && !event.intentional) lastContextLoss = entry;
  if (events.length > 200) events.shift();
  if (/error|lost|failed/.test(String(event.event))) console.warn('[graphics]', event);
}

type Props = Omit<CanvasProps, 'gl'> & {
  owner: Owner;
  profile: string;
  sceneName: string;
  options: THREE.WebGLRendererParameters & { toneMapping?: THREE.ToneMapping; toneMappingExposure?: number };
  onInterrupted?: () => void;
  onReady?: () => void;
  onRecovering?: () => void;
  onExit?: () => void;
};

/** Factory/configuration failures belong to this graphics attempt, not the Arena asset boundary. */
class GraphicsBoundary extends Component<{ lifecycle: GraphicsLifecycle; generation: number; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.lifecycle.fail(this.props.generation, error.message); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** R3F owns each factory renderer; the lease extends through its complete teardown. */
export function ExclusiveCanvas({ owner, profile, sceneName, options, onInterrupted, onReady, onRecovering, onExit, onCreated, children, ...props }: Props) {
  const current = useRef({ profile, sceneName, options, onInterrupted, onReady, onRecovering });
  current.current = { profile, sceneName, options, onInterrupted, onReady, onRecovering };
  const [lifecycle] = useState(() => createGraphicsLifecycle((before, next) => {
    if (before.phase === next.phase) return;
    record({ event: 'lifecycle', owner, from: before.phase, phase: next.phase, generation: next.generation, rendererId: next.rendererId, error: next.error });
    if (next.phase === 'READY') current.current.onReady?.();
    if (next.phase === 'RECOVERING') current.current.onRecovering?.();
    if (next.phase === 'CONTEXT_LOST' || next.phase === 'RECOVERY_FAILED') {
      current.current.onInterrupted?.();
      window.dispatchEvent(new Event('gameinputreset'));
    }
  }));
  const state = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);
  const generation = state.generation;
  // Like R3F, invalidate only on final removal, not StrictMode effect replay or Activity hiding.
  useInsertionEffect(() => () => lifecycle.dispose(), [lifecycle]);
  const session = useMemo(() => ({ lifecycle, generation }), [lifecycle, generation]);
  // Each factory closes over its attempt. It must never borrow the newer generation from a ref.
  const factory = useMemo(() => async (defaults: THREE.WebGLRendererParameters) => {
    const release = await acquireRenderer();
    if (!lifecycle.current(generation)) { release(); throw new DOMException('Graphics attempt retired', 'AbortError'); }
    const canvas = defaults.canvas as HTMLCanvasElement;
    const id = ++serial, started = performance.now();
    let nativeContext: WebGL2RenderingContext | undefined;
    let renderer: THREE.WebGLRenderer | undefined, retiring = false, pendingCompilations = () => 0;
    const owns = () => !retiring && active?.id === id && lifecycle.current(generation, id);
    const snapshot = (event: string, detail?: string): Diagnostic => ({
      event, detail, id, owner, generation, lifecycle: { ...lifecycle.getSnapshot() }, intentional: retiring || !lifecycle.current(generation), activeOwner: active?.owner ?? null,
      scene: current.current.sceneName, profile: current.current.profile,
      elapsedMs: performance.now() - started, devicePixelRatio: window.devicePixelRatio,
      width: renderer?.getContext().drawingBufferWidth ?? canvas.width,
      height: renderer?.getContext().drawingBufferHeight ?? canvas.height,
      dpr: renderer?.getPixelRatio(), memory: renderer ? { ...renderer.info.memory } : null,
      programs: renderer?.info.programs?.length, calls: renderer?.info.render.calls,
      pendingCompilations: pendingCompilations(),
    });
    const interrupted = (event: Event) => {
      event.preventDefault();
      record(snapshot(event.type, (event as WebGLContextEvent).statusMessage));
      // A creation attempt can fail before Three successfully obtains a usable context. The
      // constructor result, not this early event, decides whether initialization failed.
      if (!owns() || !renderer?.getContext().isContextLost()) return;
      lifecycle.lost(generation, id, `${owner === 'campus' ? 'Campus' : 'Arena'} graphics were interrupted.`);
    };
    const restored = () => {
      record(snapshot('webglcontextrestored'));
      // Keep the lost canvas/listeners mounted until this event or a manual retry. Rebuild all
      // renderer-dependent resources through a fresh, exclusive attempt, then require a frame.
      if (owns() && !renderer?.getContext().isContextLost()) lifecycle.recover(generation);
    };
    canvas.dataset.graphicsOwner = owner;
    canvas.addEventListener('webglcontextcreationerror', interrupted);
    canvas.addEventListener('webglcontextlost', interrupted);
    canvas.addEventListener('webglcontextrestored', restored);
    const stopTracking = trackDisposeListeners();
    const detach = () => {
      canvas.removeEventListener('webglcontextcreationerror', interrupted);
      canvas.removeEventListener('webglcontextlost', interrupted);
      canvas.removeEventListener('webglcontextrestored', restored);
      stopTracking();
    };
    try {
      const parameters = { ...defaults, ...current.current.options, powerPreference: 'default' as const };
      // Keep the initial allocation tiny; the budgeted setSize below owns the real viewport.
      canvas.width = canvas.height = 1;
      nativeContext = await createContext(canvas, {
        alpha: true, depth: parameters.depth ?? true, stencil: parameters.stencil ?? false,
        antialias: parameters.antialias ?? false, premultipliedAlpha: parameters.premultipliedAlpha ?? true,
        preserveDrawingBuffer: parameters.preserveDrawingBuffer ?? false, powerPreference: 'default',
        failIfMajorPerformanceCaveat: false,
      }, () => lifecycle.current(generation), (event, detail) => record({ ...snapshot(event), ...detail }));
      if (!lifecycle.current(generation)) throw new DOMException('Graphics attempt retired', 'AbortError');
      renderer = new THREE.WebGLRenderer({ ...parameters, context: nativeContext });
      if (current.current.options.toneMapping !== undefined) renderer.toneMapping = current.current.options.toneMapping;
      if (current.current.options.toneMappingExposure !== undefined) renderer.toneMappingExposure = current.current.options.toneMappingExposure;
      const gl = renderer.getContext();
      if (gl.isContextLost()) throw new Error('The new WebGL context is unavailable.');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      rememberGraphicsCapabilities({ gpu: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), maxTexture: renderer.capabilities.maxTextureSize });
      if (!lifecycle.attach(generation, id)) throw new DOMException('Graphics attempt retired', 'AbortError');
      active = { owner, id }; inspect = () => snapshot('sample');
      rendererSessions.set(renderer, { id, owns });
      record({ ...snapshot('created'), capabilities: {
        version: gl.getParameter(gl.VERSION), vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTextureSize: renderer.capabilities.maxTextureSize, maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxSamples: renderer.capabilities.maxSamples,
      } });
      // Enforce the same budget for adaptive DPR updates and viewport changes.
      const setPixelRatio = renderer.setPixelRatio.bind(renderer), setSize = renderer.setSize.bind(renderer);
      let requested = 1, width = 1, height = 1, resizing = false;
      const limit = Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      const budget = () => drawingBufferBudget((navigator as Navigator & { deviceMemory?: number }).deviceMemory, current.current.profile);
      renderer.setPixelRatio = value => { requested = value; setPixelRatio(pixelRatio(width, height, requested, limit, budget())); };
      renderer.setSize = (w, h, updateStyle) => {
        if (resizing) { setSize(w, h, updateStyle); return; }
        width = w; height = h; resizing = true;
        try { setPixelRatio(pixelRatio(w, h, requested, limit, budget())); setSize(w, h, updateStyle); }
        finally { resizing = false; }
      };
      const cancelCompilation = installCompilation(renderer, (name, detail) => record(snapshot(name, detail)));
      pendingCompilations = cancelCompilation.pending;
      const shaderError = renderer.debug.onShaderError;
      renderer.debug.onShaderError = (context, program, vertex, fragment) => {
        const detail = [context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)].join('\n');
        record(snapshot('shader-error', detail));
        if (owns()) lifecycle.fail(generation, 'A graphics shader could not be compiled.', id);
        shaderError?.(context, program, vertex, fragment);
      };
      const dispose = renderer.dispose.bind(renderer), lose = renderer.forceContextLoss.bind(renderer);
      renderer.dispose = () => { retiring = true; record(snapshot('dispose')); cancelCompilation(); dispose(); };
      renderer.forceContextLoss = () => {
        retiring = true; lose();
        if (!gl.isContextLost()) {
          record(snapshot('teardown-failed', 'WebGL context release could not be confirmed.'));
          detach(); release('The previous WebGL context could not be released. Reload to rebuild graphics.'); return;
        }
        record(snapshot('released')); detach();
        if (active?.id === id) { active = null; inspect = null; }
        release();
      };
      return renderer;
    } catch (error) {
      record(snapshot('creation-error', String(error)));
      retiring = true;
      try { renderer?.dispose(); } catch (disposeError) { record(snapshot('dispose-error', String(disposeError))); }
      // The constructor can fail before assigning renderer, but the native allocation is ours.
      const released = !nativeContext || releaseContext(nativeContext);
      detach();
      if (!released) release('Renderer setup failed and context release could not be confirmed. Reload graphics.');
      else { if (active?.id === id) { active = null; inspect = null; } release(); }
      lifecycle.fail(generation, String(error instanceof Error ? error.message : error));
      throw error;
    }
  }, [lifecycle, generation, owner]);
  const recovering = state.phase === 'RECOVERING';
  const interrupted = state.phase === 'CONTEXT_LOST' || state.phase === 'RECOVERY_FAILED';
  return <>
    <GraphicsBoundary key={generation} lifecycle={lifecycle} generation={generation}>
      <Canvas {...props} gl={factory} onCreated={onCreated}>
        <GraphicsSession.Provider value={session}>{children}</GraphicsSession.Provider>
      </Canvas>
    </GraphicsBoundary>
    {(interrupted || recovering) && <div className="graphics-error" data-graphics-recovery={owner} data-graphics-phase={state.phase} style={{ position: 'fixed', zIndex: 200 }} role="alert">
      <h2>{recovering ? `Rebuilding ${owner} graphics…` : state.phase === 'CONTEXT_LOST' ? state.error : `${owner === 'campus' ? 'Campus' : 'Arena'} graphics recovery failed.`}</h2>
      <p>{recovering ? 'Preparing resources and validating the first frame. Your session is preserved.' : state.phase === 'RECOVERY_FAILED' ? state.error : 'Your session is preserved. Rebuild graphics to continue.'}</p>
      <button className="primary" disabled={recovering} onClick={() => lifecycle.recover(generation)}>{recovering ? 'Rebuilding graphics…' : `Rebuild ${owner} graphics`}</button>
      {onExit && <button className="secondary" onClick={onExit}>Return to campus</button>}
    </div>}
  </>;
}
