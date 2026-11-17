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
export function pixelRatio(width: number, height: number, requested: number, maxSize = Infinity): number {
  return Math.min(requested, Math.sqrt(3840 * 2160 / Math.max(1, width * height)), maxSize / Math.max(1, width, height));
}
