// three.js renderers register a 'dispose' listener on every texture, geometry and material they upload — including
// three's own module-level placeholder textures (used for empty sampler uniforms), which every renderer shares and
// which are never disposed. A renderer that has been thrown away therefore stays reachable through those listeners,
// with its WebGL context, canvas and GPU bookkeeping: one more per match, for the life of the page.
//
// While an arena scene is mounted, the 'dispose' listeners added are recorded; when it unmounts they are removed,
// so the old renderer can be garbage-collected. (Its GPU resources are released separately, and the context is lost.)
import { EventDispatcher } from 'three';

type Listener = (event: { type: 'dispose'; target: unknown }) => void;
type Record_ = { target: EventDispatcher<{ dispose: object }>; listener: Listener };
let recording: Record_[] | null = null, patched = false;

/** Start recording; the returned function removes everything recorded since. */
export function trackDisposeListeners(): () => void {
  if (!patched) {
    patched = true;
    const add = EventDispatcher.prototype.addEventListener;
    EventDispatcher.prototype.addEventListener = function (this: EventDispatcher<{ dispose: object }>, type: string, listener: Listener) {
      if (type === 'dispose' && recording) recording.push({ target: this, listener });
      return (add as (this: unknown, t: string, l: Listener) => void).call(this, type, listener);
    } as typeof EventDispatcher.prototype.addEventListener;
  }
  const mine: Record_[] = []; recording = mine;
  return () => {
    if (recording === mine) recording = null;
    for (const r of mine) r.target.removeEventListener('dispose', r.listener as never);
    mine.length = 0;
  };
}
