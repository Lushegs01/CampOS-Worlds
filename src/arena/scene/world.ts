// Combat Arena rendering profiles and small shared textures. The environment itself is built in
// scene/environment.ts from the arena asset pack; every profile uses the same models and PBR materials
// and scales resolution, shadows, post-processing and effect counts (never a different art style).
import * as THREE from 'three';
import type { Quality } from '../../world/quality';

export interface ArenaQuality {
  dpr: number; antialias: boolean; shadows: boolean; shadowSize: number; shadowEvery: number; post: boolean; ao: boolean; bloom: boolean;
  effects: number; anisotropy: number; detail: number; fogFar: number; decals: number; casings: number; ik: boolean; lights: number;
  /** Load the 512² texture tier (public/assets/arena/mobile): same art, a third of the download. */
  mobileAssets: boolean;
  /** Ambient occlusion at full resolution and the higher sample count (Ultra). */
  aoHigh?: boolean;
}
/** The arena's profiles: the campus' three plus Ultra (arena only: the campus keeps its own three). */
export type ArenaQualityId = Quality | 'ultra';
export const ARENA_QUALITY: Record<ArenaQualityId, ArenaQuality> = {
  // Phones: native-ish resolution, a static sun shadow, no post stack, fewer particles.
  low: { dpr: 1, antialias: true, shadows: true, shadowSize: 1024, shadowEvery: 0, post: false, ao: false, bloom: false, effects: .5, anisotropy: 2, detail: 0, fogFar: 140, decals: 24, casings: 10, ik: true, lights: 0, mobileAssets: true },
  // Ordinary laptops: SMAA, restrained bloom, a sharper shadow refreshed every other frame.
  medium: { dpr: 1.5, antialias: false, shadows: true, shadowSize: 2048, shadowEvery: 2, post: true, ao: false, bloom: true, effects: 1, anisotropy: 4, detail: 1, fogFar: 190, decals: 64, casings: 24, ik: true, lights: 2, mobileAssets: false },
  // Desktop GPUs: ambient occlusion, full-rate 4K shadows, every effect.
  high: { dpr: 2, antialias: false, shadows: true, shadowSize: 4096, shadowEvery: 1, post: true, ao: true, bloom: true, effects: 1, anisotropy: 8, detail: 1, fogFar: 240, decals: 120, casings: 40, ik: true, lights: 4, mobileAssets: false },
  // Strong desktop GPUs: full-resolution high-quality ambient occlusion, the sharpest shadow filtering, 16× anisotropy,
  // more fittings casting real light, more decals and casings kept, a longer view. Same models and materials.
  ultra: { dpr: 2, antialias: false, shadows: true, shadowSize: 4096, shadowEvery: 1, post: true, ao: true, aoHigh: true, bloom: true, effects: 1.25, anisotropy: 16, detail: 1, fogFar: 300, decals: 200, casings: 60, ik: true, lights: 6, mobileAssets: false },
};

/** A soft round sprite texture (smoke, flashes, sparks). */
let soft: THREE.Texture | null = null;
export function softTexture() {
  if (soft) return soft;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.4, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  soft = new THREE.CanvasTexture(c); return soft;
}
/** Text on a sprite (name tags, objective letters). */
export function labelTexture(text: string, color: string, size = 64, bold = true) {
  const c = document.createElement('canvas'); const g = c.getContext('2d')!;
  g.font = `${bold ? 700 : 500} ${size}px 'Manrope Variable', system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + size * .6; c.width = w; c.height = Math.ceil(size * 1.4);
  g.font = `${bold ? 700 : 500} ${size}px 'Manrope Variable', system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = size / 7; g.strokeStyle = 'rgba(10,14,18,.85)';
  g.strokeText(text, w / 2, c.height / 2); g.fillStyle = color; g.fillText(text, w / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, aspect: w / c.height };
}
export const TEAM_COLORS = { friend: '#4fb3ff', enemy: '#ff5a48', neutral: '#f2efe6' };
