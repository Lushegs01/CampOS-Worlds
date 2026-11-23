// The city's hour. The world is lit for golden hour (src/world/Sky.tsx: "Golden hour, all day"), so the population
// runs on the matching early-evening hour: the commute home, busy shops, headlights coming on. QA and the
// cinematic director can set another hour to see the city's daily rhythm (density follows activityAt()).
export const cityHour = { override: null as number | null, now(): number { return this.override ?? 17.6; } };
/** 0 in full daylight, 1 at night: headlight and tail-lamp intensity. */
export function nightFactor(h: number) { const d = ((h % 24) + 24) % 24; return d >= 19.5 || d < 5.5 ? 1 : d > 17 ? (d - 17) / 2.5 * .7 : d < 7 ? (7 - d) / 1.5 * .7 : 0; }
