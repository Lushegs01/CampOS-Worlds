// The city's hour follows the open world's time of day (src/world/environment.ts, shared/environment.mjs), so the
// population and the lamps keep the sky's rhythm: the commute home at dusk, headlights after dark. QA and the
// cinematic director can still set another hour (density follows activityAt()).
import { env } from '../world/environment';
export const cityHour = { override: null as number | null, now(): number { return this.override ?? env.hour; } };
/** 0 in full daylight, 1 at night: headlight and tail-lamp intensity. */
export function nightFactor(h: number) { const d = ((h % 24) + 24) % 24; return d >= 19.5 || d < 5.5 ? 1 : d > 17 ? (d - 17) / 2.5 * .7 : d < 7 ? (7 - d) / 1.5 * .7 : 0; }
