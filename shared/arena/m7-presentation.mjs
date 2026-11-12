// One timeline for the visible reload and mechanical Foley (normalised authoritative reload time).
export const M7_RELOAD = Object.freeze({ reach: .08, release: .14, removed: .34, return: .46, seated: .68, handBack: .8, action: .8, actionEnd: .94, ready: .96 });
/** @type {ReadonlyArray<readonly [number, string]>} */
export const M7_RELOAD_CUES = Object.freeze([
  [.14, 'm7-release'], [.34, 'm7-out'], [.68, 'm7-insert'], [.8, 'm7-action'], [.96, 'm7-ready'],
]);
