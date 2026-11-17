/** A lease includes R3F's entire teardown, not just the lifetime of the DOM canvas. */
let tail: Promise<string | undefined> = Promise.resolve(undefined);
export async function acquireRenderer(): Promise<(failure?: string) => void> {
  const previous = tail;
  let release!: (failure?: string) => void;
  tail = new Promise<string | undefined>(resolve => { release = resolve; });
  const failure = await previous;
  if (failure) { release(failure); throw new Error(failure); }
  return release;
}

/** Cap pixels as well as DPR: a Retina/4K laptop must not allocate unbounded post buffers. */
export function drawingBufferBudget(memory: number | undefined, profile: string): number {
  // A half-float post stack owns several full-size targets. Bound those before allocating them.
  if (memory !== undefined && memory <= 2) return 1920 * 1080;
  if (memory !== undefined && memory <= 4 || profile === 'low' || profile === 'medium') return 2560 * 1440;
  return 3840 * 2160;
}
export function pixelRatio(width: number, height: number, requested: number, maxSize = Infinity, maxPixels = 3840 * 2160): number {
  return Math.min(requested, Math.sqrt(maxPixels / Math.max(1, width * height)), maxSize / Math.max(1, width, height));
}
