/** Browsers can deny storage while still allowing play; retain the room token in memory then. */
export function createSession(storage) {
  let token = null;
  return {
    get() { try { token = storage().getItem('campus-session') || token; } catch { /* storage denied */ } return token; },
    set(value) { token = value; try { storage().setItem('campus-session', value); } catch { /* memory only */ } },
  };
}
