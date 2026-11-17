import { useRef, useState } from 'react';
import { Canvas, type CanvasProps } from '@react-three/fiber';
import * as THREE from 'three';
import { rememberGraphicsCapabilities } from './capabilities';
import { installCompilation } from './compile';
import { acquireRenderer, pixelRatio } from './ownership';
import { trackDisposeListeners } from './gpuListeners';
import { QA_HOOKS } from '../qa';

type Owner = 'campus' | 'arena';
type Diagnostic = Record<string, unknown>;
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
};

/** R3F owns the factory renderer. Its forceContextLoss runs AFTER scene/effect and renderer disposal. */
export function ExclusiveCanvas({ owner, profile, sceneName, options, onInterrupted, onCreated, ...props }: Props) {
  const [generation, setGeneration] = useState(0), [failure, setFailure] = useState('');
  const current = useRef({ profile, sceneName, onInterrupted });
  current.current = { profile, sceneName, onInterrupted };
  // Immutable context attributes are chosen once. All profiles can use native AA on the default
  // framebuffer; profiles with post-processing use their own SMAA render targets.
  const [factory] = useState(() => async (defaults: THREE.WebGLRendererParameters) => {
    const release = await acquireRenderer();
    const canvas = defaults.canvas as HTMLCanvasElement;
    const id = ++serial, started = performance.now();
    let renderer: THREE.WebGLRenderer | undefined, retiring = false;
    const snapshot = (event: string, detail?: string): Diagnostic => ({
      event, detail, id, owner, intentional: retiring, activeOwner: active?.owner ?? null,
      scene: current.current.sceneName, profile: current.current.profile,
      elapsedMs: performance.now() - started, devicePixelRatio: window.devicePixelRatio,
      width: renderer?.getContext().drawingBufferWidth ?? canvas.width,
      height: renderer?.getContext().drawingBufferHeight ?? canvas.height,
      dpr: renderer?.getPixelRatio(), memory: renderer ? { ...renderer.info.memory } : null,
      programs: renderer?.info.programs?.length, calls: renderer?.info.render.calls,
    });
    const interrupted = (event: Event) => {
      event.preventDefault();
      record(snapshot(event.type, (event as WebGLContextEvent).statusMessage));
      if (retiring) return;
      current.current.onInterrupted?.();
      setFailure(`${owner === 'campus' ? 'Campus' : 'Arena'} graphics were interrupted.`);
    };
    const restored = () => {
      record(snapshot('webglcontextrestored'));
      // Reconstruct all targets, shader gates and environments through a fresh renderer.
      if (!retiring) { setFailure(''); setGeneration(n => n + 1); }
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
      renderer = new THREE.WebGLRenderer({ ...defaults, ...options, powerPreference: 'default' });
      if (options.toneMapping !== undefined) renderer.toneMapping = options.toneMapping;
      if (options.toneMappingExposure !== undefined) renderer.toneMappingExposure = options.toneMappingExposure;
      const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      rememberGraphicsCapabilities({ gpu: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), maxTexture: renderer.capabilities.maxTextureSize });
      active = { owner, id }; inspect = () => snapshot('sample');
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
      renderer.setPixelRatio = value => { requested = value; setPixelRatio(pixelRatio(width, height, requested, limit)); };
      renderer.setSize = (w, h, updateStyle) => {
        if (resizing) { setSize(w, h, updateStyle); return; }
        width = w; height = h; resizing = true;
        try { setPixelRatio(pixelRatio(w, h, requested, limit)); setSize(w, h, updateStyle); }
        finally { resizing = false; }
      };
      const cancelCompilation = installCompilation(renderer, (name, detail) => record(snapshot(name, detail)));
      const shaderError = renderer.debug.onShaderError;
      renderer.debug.onShaderError = (context, program, vertex, fragment) => {
        record(snapshot('shader-error', [context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)].join('\n')));
        shaderError?.(context, program, vertex, fragment);
      };
      const dispose = renderer.dispose.bind(renderer), lose = renderer.forceContextLoss.bind(renderer);
      renderer.dispose = () => { retiring = true; record(snapshot('dispose')); cancelCompilation(); dispose(); };
      renderer.forceContextLoss = () => {
        retiring = true; lose();
        // Fail closed if the browser cannot confirm release. Never start a competing context.
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
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
      detach();
      if (renderer && !renderer.getContext().isContextLost()) release('Renderer setup failed and context release could not be confirmed. Reload graphics.');
      else { if (active?.id === id) { active = null; inspect = null; } release(); }
      throw error;
    }
  });
  return <>
    {!failure && <Canvas {...props} key={generation} gl={factory} onCreated={state => { onCreated?.(state); }} />}
    {failure && <div className="graphics-error" style={{ position: 'fixed', zIndex: 200 }} role="alert"><h2>{failure}</h2><p>Your session is preserved. Rebuild graphics to continue.</p><button className="primary" onClick={() => { setGeneration(n => n + 1); setFailure(''); }}>Rebuild {owner} graphics</button></div>}
  </>;
}
