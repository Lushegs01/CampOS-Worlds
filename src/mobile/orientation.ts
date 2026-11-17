/** Read the viewport, rather than the sensor: split-screen and browser chrome change usable space. */
export function portraitBlocked() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (orientation: portrait)').matches;
}

type Lockable = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
let pending: Promise<void> | null = null;
/** Call directly from a play/fullscreen button. Unsupported and refused locks use the rotate overlay. */
export function enterLandscape(): Promise<void> {
  if (!matchMedia('(pointer: coarse)').matches) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    const orientation = screen.orientation as Lockable | undefined;
    // iOS has no lock API: do not ask for fullscreen when it cannot help.
    if (!orientation?.lock) return;
    const installed = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    try {
      if (!document.fullscreenElement && !installed) {
        if (!document.documentElement.requestFullscreen) return;
        await document.documentElement.requestFullscreen();
      }
      await orientation.lock('landscape');
    } catch { /* Rotation remains available even if permission or fullscreen was refused. */ }
  })().finally(() => { pending = null; });
  return pending;
}
