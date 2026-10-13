export type Quality = 'low' | 'medium' | 'high';

export interface QualityProfile {
  /** Device-pixel-ratio ceiling. */
  dpr: number;
  /** Sun shadow map resolution; `static` renders the campus shadow once instead of every frame. */
  shadowSize: number; shadowMode: 'static' | 'every-2nd-frame' | 'every-frame'; shadowRadius: number;
  /** Screen-space ambient occlusion and SMAA through the post stack (otherwise native MSAA). */
  post: boolean;
  /** Instanced grass blades drawn around the camera. */
  grassBlades: number; grassRadius: number;
  /** Fraction of leaf cards generated per tree, and how far fine detail props are drawn. */
  foliage: number; detailDistance: number;
  anisotropy: number; skyTexture: 'sky.jpg' | 'sky-low.jpg';
  /** Multi-layer anti-tiling ground shading. */
  groundLayers: boolean;
  materialDetail: boolean;
  terrainSegments: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { dpr: 1, shadowSize: 1024, shadowMode: 'static', shadowRadius: 2, post: false, grassBlades: 0, grassRadius: 0, foliage: .35, detailDistance: 28, anisotropy: 2, skyTexture: 'sky-low.jpg', groundLayers: false, materialDetail: false, terrainSegments: 64 },
  medium: { dpr: 1.5, shadowSize: 2048, shadowMode: 'every-2nd-frame', shadowRadius: 3, post: false, grassBlades: 16000, grassRadius: 8, foliage: .8, detailDistance: 65, anisotropy: 4, skyTexture: 'sky.jpg', groundLayers: true, materialDetail: true, terrainSegments: 140 },
  high: { dpr: 2, shadowSize: 4096, shadowMode: 'every-2nd-frame', shadowRadius: 3, post: true, grassBlades: 52000, grassRadius: 11, foliage: 1, detailDistance: 140, anisotropy: 8, skyTexture: 'sky.jpg', groundLayers: true, materialDetail: true, terrainSegments: 200 },
};

/** First-visit default: phones and small touch screens start on Low, laptops on Medium. */
export function suggestedQuality(): Quality {
  if (typeof window === 'undefined') return 'medium';
  const touch = matchMedia('(pointer: coarse)').matches;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  if (touch) return 'low';
  if (memory <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4) return 'low';
  return 'medium';
}
