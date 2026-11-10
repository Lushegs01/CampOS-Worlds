// Combat Arena graphics recommendation from what the device can actually do, not from its user agent:
// the GPU the browser reports (WebGL's unmasked renderer, where the browser shares it), the largest
// texture it accepts, memory and processor hints, touch input and screen size. It is only a starting point:
// the player can choose any profile, and the adaptive renderer (shared/arena/adaptive.mjs) lowers the
// resolution, then the profile, if the frame rate still cannot be held.
import type { Quality } from '../world/quality';

export interface DeviceReport { quality: Quality; gpu: string; tier: 'low' | 'mid' | 'high' | 'unknown'; reasons: string[]; maxTexture: number; memory: number; cores: number; touch: boolean }
let cached: DeviceReport | null = null;

// Mobile and integrated GPUs that hold 30 fps only at the Low profile's cost, and desktop-class GPUs.
const LOW_GPU = /(Mali-(4\d\d|T\d+|G(31|51|52|57|68))|Adreno \(TM\) ([2-5]\d\d|6[0-1]\d)|PowerVR|SwiftShader|llvmpipe|softpipe|Intel\(R\) (HD|UHD) Graphics( [2-6]\d\d)?\b|Microsoft Basic Render)/i;
const HIGH_GPU = /(RTX|GTX 1[6-9]|GTX [2-9]\d|Radeon (RX|Pro)|Apple M[1-9]|Arc\(TM\)|Adreno \(TM\) (7[3-9]\d|8\d\d)|Mali-G7[1-9]\d)/i;

export function recommendQuality(): DeviceReport {
  if (cached) return cached;
  const reasons: string[] = [];
  if (typeof window === 'undefined') return { quality: 'medium', gpu: '', tier: 'unknown', reasons: ['no window'], maxTexture: 0, memory: 0, cores: 0, touch: false };
  const touch = matchMedia('(pointer: coarse)').matches, memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 0, cores = navigator.hardwareConcurrency ?? 0;
  const saveData = !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  let gpu = '', maxTexture = 0;
  try {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) ?? '');
      maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else reasons.push('no WebGL');
  } catch { reasons.push('GPU not readable'); }
  const tier: DeviceReport['tier'] = !gpu ? 'unknown' : LOW_GPU.test(gpu) ? 'low' : HIGH_GPU.test(gpu) ? 'high' : 'mid';
  let score = tier === 'high' ? 2 : tier === 'mid' ? 1 : tier === 'low' ? 0 : touch ? 0 : 1;
  if (tier !== 'unknown') reasons.push(`GPU ${tier}`);
  if (maxTexture && maxTexture < 8192) { score = Math.min(score, 0); reasons.push('small texture limit'); }
  if (memory && memory <= 3) { score = Math.min(score, 0); reasons.push(`${memory} GB memory`); } else if (memory && memory <= 4) { score = Math.min(score, 1); reasons.push(`${memory} GB memory`); }
  if (cores && cores <= 4) { score = Math.min(score, touch ? 0 : 1); reasons.push(`${cores} cores`); }
  // Phones: the battery and heat budget is smaller than the GPU suggests; Medium only on the strongest.
  if (touch) { score = Math.min(score, tier === 'high' && memory >= 6 ? 1 : 0); reasons.push('touch device'); }
  if (saveData) { score = 0; reasons.push('data saver'); }
  const quality: Quality = score >= 2 ? 'high' : score === 1 ? 'medium' : 'low';
  cached = { quality, gpu, tier, reasons, maxTexture, memory, cores, touch };
  return cached;
}
