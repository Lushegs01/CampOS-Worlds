import * as THREE from 'three';

export const SIGN_FONT = '"Manrope Variable", "DM Sans Variable", system-ui, sans-serif';
export async function signFontsReady() {
  try { await Promise.all([document.fonts.load(`700 64px ${SIGN_FONT}`), document.fonts.load(`500 64px "DM Sans Variable"`)]); } catch { /* fall back to system fonts */ }
}

interface SignOptions {
  text: string; width: number; height: number;
  /** `letters`: free-standing metal letters that cast shadows. `panel`: printed board. */
  kind?: 'letters' | 'panel'; color?: string; background?: string; weight?: number; tracking?: number;
  metalness?: number; roughness?: number; font?: string; align?: CanvasTextAlign; lines?: string[]; lineColors?: string[];
}

const cache = new Map<string, THREE.CanvasTexture>();
function texture(o: SignOptions) {
  const key = JSON.stringify(o);
  let tex = cache.get(key);
  if (tex) return tex;
  const aspect = o.width / o.height, H = 256, W = Math.min(4096, Math.round(H * aspect / 2) * 2), c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  if (o.kind === 'panel' && o.background) { x.fillStyle = o.background; x.fillRect(0, 0, W, H); }
  const lines = o.lines ?? [o.text];
  x.fillStyle = o.kind === 'letters' ? '#ffffff' : (o.color ?? '#ffffff');
  x.textBaseline = 'middle'; x.textAlign = o.align ?? 'center';
  const size = Math.min(H * .78 / lines.length, 200);
  lines.forEach((line, i) => {
    x.font = `${i === 0 ? (o.weight ?? 700) : 500} ${i === 0 ? size : size * .62}px ${o.font ?? SIGN_FONT}`;
    if ('letterSpacing' in x) (x as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(o.tracking ?? .08) * size}px`;
    if (o.lineColors?.[i] && o.kind === 'panel') x.fillStyle = o.lineColors[i];
    const tx = o.align === 'left' ? H * .18 : W / 2, ty = H * ((i + .5) / lines.length);
    x.fillText(line, tx, ty, W * .94);
  });
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = o.kind === 'letters' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/** A sign mesh in its own local frame (faces +Z). */
export function sign(o: SignOptions) {
  const tex = texture(o);
  const material = o.kind === 'letters'
    ? new THREE.MeshStandardMaterial({ color: o.color ?? '#b58a52', metalness: o.metalness ?? .85, roughness: o.roughness ?? .38, alphaMap: tex, alphaTest: .5, envMapIntensity: 1.3 })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: o.roughness ?? .6, metalness: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), material);
  mesh.castShadow = o.kind === 'letters'; mesh.receiveShadow = true;
  if (o.kind === 'letters') mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: tex, alphaTest: .5 });
  mesh.name = `sign:${o.text}`;
  return mesh;
}

export function place(mesh: THREE.Object3D, position: [number, number, number], rotationY = 0) {
  mesh.position.set(...position); mesh.rotation.y = rotationY; mesh.updateMatrix(); mesh.matrixAutoUpdate = false; return mesh;
}
