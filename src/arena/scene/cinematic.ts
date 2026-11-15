// The cinematic finish for Operation: Metropolis (the only map that has it; see src/arena/look.ts). It sits on top of
// each weather's own grade (scene/city/atmosphere.ts) rather than replacing it, so Storm Break stays a storm and Blue
// Hour stays night: brighter daylight, a palette pulled toward a muted, filmic military look (less saturation, firmer
// contrast, cooler shade and warmer light), the frame darkening toward its edges, a finer, stronger grain, a little more
// bloom, and a sharpening pass after antialiasing that brings back fine texture. The exposure applies on every profile;
// the rest is post-processing, Medium and above (Low has none on any map).
import type { Atmosphere } from './city/atmosphere';

type V3 = [number, number, number];
export interface Finish { exposure: number; saturation: number; contrast: number; lift: V3; gain: V3; grain: number; vignette: number; vignetteOffset: number; bloom: number; sharpen: number }

export function cinematicFinish(a: Atmosphere): Finish {
  return {
    // Measured against the reference frames: their daylight sits brighter (mean luminance ~0.45 against the street's
    // ~0.3) at the same spread, and a little less colourful than the weather's own grade.
    exposure: 1.3,
    saturation: a.saturation * .9,
    contrast: a.contrast + .1,
    lift: [a.lift[0] * .98, a.lift[1] * .995, a.lift[2] * 1.02],
    gain: [a.gain[0] * 1.025, a.gain[1] * 1.005, a.gain[2] * .97],
    grain: .018,
    vignette: .46, vignetteOffset: .22,
    bloom: a.bloomIntensity * 1.15,
    sharpen: .6,
  };
}
