// Combat Arena map rendering: the map's boxes merged into one mesh per material (a dozen draw calls
// for a whole map), world-space texture coordinates so textures keep their scale on any box, and small
// procedural textures drawn once on a canvas (nothing to download).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../../world/quality';

export interface ArenaQuality { dpr: number; antialias: boolean; shadows: boolean; effects: number; textures: boolean; fogFar: number; shadowSize: number }
export const ARENA_QUALITY: Record<Quality, ArenaQuality> = {
  low: { dpr: 1, antialias: false, shadows: false, effects: .5, textures: false, fogFar: 95, shadowSize: 0 },
  medium: { dpr: 1.5, antialias: true, shadows: false, effects: 1, textures: true, fogFar: 150, shadowSize: 0 },
  high: { dpr: 2, antialias: true, shadows: true, effects: 1, textures: true, fogFar: 190, shadowSize: 2048 },
};

type Pattern = 'concrete' | 'brick' | 'metal' | 'grate' | 'wood' | 'stripes' | 'ribs' | 'stone' | 'leaf' | 'plain' | 'grid';
const MATERIALS: Record<string, { color: string; pattern: Pattern; scale: number; rough?: number; metal?: number; emissive?: string }> = {
  perimeter: { color: '#6a6e72', pattern: 'concrete', scale: 3 },
  brick: { color: '#94574a', pattern: 'brick', scale: 2.4 },
  concrete: { color: '#a29e95', pattern: 'concrete', scale: 3 },
  roof: { color: '#4b5056', pattern: 'ribs', scale: 2 },
  grate: { color: '#6f7479', pattern: 'grate', scale: 1, metal: .5, rough: .5 },
  rail: { color: '#d9a93b', pattern: 'stripes', scale: 1.2, metal: .3, rough: .45 },
  metal: { color: '#7d8389', pattern: 'metal', scale: 1.5, metal: .55, rough: .45 },
  crate: { color: '#a77b47', pattern: 'wood', scale: 1.2 },
  machine: { color: '#476a74', pattern: 'metal', scale: 1.5, metal: .6, rough: .4 },
  pillar: { color: '#878379', pattern: 'concrete', scale: 2 },
  'container-red': { color: '#a9402f', pattern: 'ribs', scale: 1.4, metal: .35, rough: .55 },
  'container-blue': { color: '#305f8d', pattern: 'ribs', scale: 1.4, metal: .35, rough: .55 },
  'container-yellow': { color: '#cf9d30', pattern: 'ribs', scale: 1.4, metal: .35, rough: .55 },
  'container-stack': { color: '#5d6e48', pattern: 'ribs', scale: 1.4, metal: .35, rough: .55 },
  sandbag: { color: '#a08f66', pattern: 'concrete', scale: 1 },
  barrier: { color: '#cbc6ba', pattern: 'stripes', scale: 2.4 },
  stone: { color: '#d3bf98', pattern: 'stone', scale: 2 },
  timber: { color: '#8f6140', pattern: 'wood', scale: 1.6 },
  hedge: { color: '#46743d', pattern: 'leaf', scale: 1.2 },
  bronze: { color: '#9b7440', pattern: 'metal', scale: 1, metal: .7, rough: .35 },
};

const textures = new Map<string, THREE.Texture>();
/** A small tiling greyscale texture (multiplied with the material colour). */
function texture(pattern: Pattern): THREE.Texture {
  const hit = textures.get(pattern); if (hit) return hit;
  const size = 128, c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 17; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, size, size);
  const speckle = (n: number, a: number) => { for (let i = 0; i < n; i++) { const v = 150 + r() * 105; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2); } };
  switch (pattern) {
    case 'concrete': speckle(900, .35); g.strokeStyle = 'rgba(90,90,90,.25)'; g.lineWidth = 2; g.strokeRect(0, 0, size, size); break;
    case 'brick': g.fillStyle = '#d6d6d6'; for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { const o = y % 2 ? 16 : 0; g.fillStyle = `rgb(${200 + r() * 40 | 0},${200 + r() * 40 | 0},${200 + r() * 40 | 0})`; g.fillRect(x * 32 + o + 1, y * 16 + 1, 30, 14); } speckle(300, .2); break;
    case 'metal': speckle(400, .2); g.fillStyle = 'rgba(120,120,120,.25)'; for (let i = 0; i < 6; i++) g.fillRect(0, r() * size, size, 1); break;
    case 'grate': g.fillStyle = '#9a9a9a'; for (let i = 0; i < size; i += 16) { g.fillRect(i, 0, 3, size); g.fillRect(0, i, size, 3); } break;
    case 'wood': for (let y = 0; y < size; y += 4) { const v = 190 + r() * 50 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, size, 4); } g.fillStyle = 'rgba(60,60,60,.5)'; g.fillRect(0, 0, size, 3); g.fillRect(0, 62, size, 3); break;
    case 'stripes': g.fillStyle = '#4a4a4a'; for (let i = -size; i < size * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - size, size); g.lineTo(i - size, size); g.fill(); } break;
    case 'ribs': for (let x = 0; x < size; x += 16) { g.fillStyle = 'rgba(80,80,80,.45)'; g.fillRect(x, 0, 4, size); g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(x + 5, 0, 2, size); } speckle(200, .2); break;
    case 'stone': for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) { const v = 205 + r() * 40 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x * 64 + (y % 2) * 32 + 1, y * 32 + 1, 62, 30); } speckle(500, .15); break;
    case 'leaf': for (let i = 0; i < 700; i++) { const v = 120 + r() * 135 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(r() * size, r() * size, 2 + r() * 4, 0, 6.3); g.fill(); } break;
    case 'grid': speckle(1200, .25); g.strokeStyle = 'rgba(70,70,70,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, size - 2, size - 2); g.strokeStyle = 'rgba(70,70,70,.15)'; g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.moveTo(0, size / 2); g.lineTo(size, size / 2); g.stroke(); break;
    default: break;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  textures.set(pattern, t);
  return t;
}

type Box = { min: number[]; max: number[]; mat: string };
/** One merged mesh per material. World-space UVs: `scale` metres per texture repeat. */
export function buildMap(boxes: Box[], q: ArenaQuality) {
  const groups = new Map<string, THREE.BufferGeometry[]>();
  for (const b of boxes) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const def = MATERIALS[b.mat] ?? MATERIALS.concrete;
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
      if (nx > .5) uv.setXY(i, z / def.scale, y / def.scale); else if (ny > .5) uv.setXY(i, x / def.scale, z / def.scale); else uv.setXY(i, x / def.scale, y / def.scale);
    }
    geo.deleteAttribute('uv'); geo.setAttribute('uv', uv);
    const list = groups.get(b.mat) ?? []; list.push(geo.toNonIndexed()); groups.set(b.mat, list);
    geo.dispose();
  }
  const meshes: THREE.Mesh[] = [];
  for (const [mat, list] of groups) {
    const merged = mergeGeometries(list, false); list.forEach(g => g.dispose());
    const def = MATERIALS[mat] ?? MATERIALS.concrete;
    const material = q.textures
      ? new THREE.MeshStandardMaterial({ color: def.color, roughness: def.rough ?? .85, metalness: def.metal ?? 0, map: texture(def.pattern) })
      : new THREE.MeshLambertMaterial({ color: def.color });
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = q.shadows; mesh.receiveShadow = q.shadows; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.name = 'map:' + mat;
    meshes.push(mesh);
  }
  return meshes;
}
export function groundMaterial(color: string, q: ArenaQuality, size: number) {
  if (!q.textures) return new THREE.MeshLambertMaterial({ color });
  const t = texture('grid').clone(); t.needsUpdate = true; t.repeat.set(size / 4, size / 4);
  return new THREE.MeshStandardMaterial({ color, roughness: .95, map: t });
}

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
