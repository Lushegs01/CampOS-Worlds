import { create } from 'zustand';

// Opt-in gameplay statistics (server/analytics.mjs; definitions in docs/ANALYTICS.md). Off until the
// player turns it on in Settings. The browser id is random, kept only in this browser, and the room
// stores just a keyed hash of it; it is never sent anywhere else.
const KEY = 'campos-analytics';
function load(): { consent: boolean; install: string } {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (v && typeof v.install === 'string') return { consent: v.consent === true, install: v.install }; } catch { /* storage unavailable */ }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return { consent: false, install: btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
}
export const useAnalytics = create<{ consent: boolean; install: string }>(() => load());
export function setAnalyticsConsent(consent: boolean) {
  useAnalytics.setState({ consent });
  try { localStorage.setItem(KEY, JSON.stringify(useAnalytics.getState())); } catch { /* storage unavailable */ }
}
/** What the join message carries: nothing at all without consent. */
export const analyticsPayload = () => { const a = useAnalytics.getState(); return a.consent ? { consent: true, install: a.install } : { consent: false }; };
