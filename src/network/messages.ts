// Independent of accounts, UI, world state and the socket. Feature modules may subscribe while
// those modules are still initialising; keeping this leaf dependency avoids a circular-import TDZ.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoomListener = (message: any) => void;
const listeners = new Set<RoomListener>();
export function onRoomMessage(listener: RoomListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitRoomMessage(message: unknown) {
  for (const listener of listeners) listener(message);
}
