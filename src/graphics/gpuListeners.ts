import { EventDispatcher } from 'three';

type Listener = (event: { type: 'dispose'; target: unknown }) => void;
type Target = EventDispatcher<{ dispose: object }>;
type Records = Map<Target, Set<Listener>>;
let recording: Records | null = null, patched = false;

/** Three's shared placeholder textures can retain a retired renderer through dispose listeners.
 * Record listeners for the exclusive renderer until R3F finishes its teardown. Remove records as
 * resources are disposed so quality changes do not themselves retain an ever-growing asset list. */
export function trackDisposeListeners(): () => void {
  if (!patched) {
    patched = true;
    const add = EventDispatcher.prototype.addEventListener, remove = EventDispatcher.prototype.removeEventListener;
    EventDispatcher.prototype.addEventListener = function (this: Target, type: string, listener: Listener) {
      if (type === 'dispose' && recording) {
        let listeners = recording.get(this);
        if (!listeners) recording.set(this, listeners = new Set());
        listeners.add(listener);
      }
      return (add as (this: unknown, t: string, l: Listener) => void).call(this, type, listener);
    } as typeof add;
    EventDispatcher.prototype.removeEventListener = function (this: Target, type: string, listener: Listener) {
      if (type === 'dispose' && recording) {
        const listeners = recording.get(this);
        listeners?.delete(listener);
        if (!listeners?.size) recording.delete(this);
      }
      return (remove as (this: unknown, t: string, l: Listener) => void).call(this, type, listener);
    } as typeof remove;
  }
  const mine: Records = new Map(); recording = mine;
  return () => {
    if (recording === mine) recording = null;
    for (const [target, listeners] of mine) for (const listener of listeners) target.removeEventListener('dispose', listener);
    mine.clear();
  };
}
