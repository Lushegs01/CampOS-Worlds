/** Allocate on the owned canvas only; never probe a second hidden GPU context. */
export async function createContext(
  canvas: HTMLCanvasElement,
  requested: WebGLContextAttributes,
  current: () => boolean,
  report: (event: string, detail: Record<string, unknown>) => void,
): Promise<WebGL2RenderingContext> {
  // Some drivers reclaim a lost context asynchronously. One delayed, smaller attempt also
  // handles MSAA allocation failures without opening overlapping renderers or retry loops.
  const attempts = [requested, { ...requested, antialias: false, stencil: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false }];
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 150));
    if (!current()) throw new DOMException('Graphics attempt retired', 'AbortError');
    const attributes = attempts[attempt];
    let gl: WebGL2RenderingContext | null = null;
    try { gl = canvas.getContext('webgl2', attributes); }
    catch (error) { report('context-request-error', { attempt, detail: String(error) }); }
    report('context-request', { attempt, attributes, success: !!gl });
    if (gl) return gl;
  }
  throw new Error('The browser could not start WebGL 2, even with antialiasing disabled. Close other game tabs, then rebuild graphics. If it still fails, restart the browser and check that graphics acceleration is enabled.');
}

/** Also covers a Three constructor that throws after receiving a native context. */
export function releaseContext(gl: WebGL2RenderingContext): boolean {
  try {
    if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
    return gl.isContextLost();
  } catch { return false; }
}
