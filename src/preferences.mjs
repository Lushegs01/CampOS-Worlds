import { sanitizeAvatar, LOCATIONS, TOKENS, TOUR } from '../shared/campus.mjs';

// Storage can contain an older schema or incomplete values. Only persisted preferences may hydrate
// the store: invalid quality/arrays used to crash rendering, and saved keys could replace live methods.
export function preferences(saved, current) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const finite = (v, fallback, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  const strings = (v, fallback, allowed) => Array.isArray(v)
    ? [...new Set(v.filter(x => typeof x === 'string' && x.length <= 128 && (!allowed || allowed.has(x))))].slice(0, 500)
    : fallback;
  return {
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 32) : current.name,
    avatar: sanitizeAvatar(s.avatar ?? {}),
    quality: ['low', 'medium', 'high'].includes(s.quality) ? s.quality : current.quality,
    volume: finite(s.volume, current.volume, 0, 1),
    reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : current.reducedMotion,
    discovered: strings(s.discovered, current.discovered, new Set(LOCATIONS.map(l => l.id))),
    tokens: strings(s.tokens, current.tokens, new Set(TOKENS.map(t => t.id))),
    muted: strings(s.muted, current.muted),
    tour: typeof s.tour === 'boolean' ? s.tour : current.tour,
    tourStep: Math.floor(finite(s.tourStep, current.tourStep, 0, TOUR.length)),
    bestScore: Math.floor(finite(s.bestScore, current.bestScore, 0, Number.MAX_SAFE_INTEGER)),
  };
}
