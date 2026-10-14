// Text that players write for other players (names, chat). Shared by the room server and clients.

// Control characters, plus bidirectional overrides and zero-width characters that can disguise
// text or make one name look like another.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
/** Strip hidden characters, trim and cap the length. Non-strings become ''. */
export function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(HIDDEN, '').trim().slice(0, max) : '';
}

// Names a guest may not take: they read as staff, the platform or a verified account.
const RESERVED = /^(admin|administrator|moderator|mod|staff|official|support|system|campos|campos worlds|room operator|operator|security)$/i;
const MARKS = /[✓✔☑✅@]/g;
/** A guest's display name: cleaned, without verification marks or handles, never a reserved name. */
export function guestName(value, fallback = 'Explorer') {
  const name = cleanText(value, 24).replace(MARKS, '').replace(/\s+/g, ' ').trim();
  return !name || RESERVED.test(name) ? fallback : name;
}
