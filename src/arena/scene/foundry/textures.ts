// Procedural, canvas-baked PBR sets for the Foundry look (no download): brushed steel for catwalks, trusses, columns
// and machine frames, and worn yellow/black hazard striping for industrial edges. Each set is albedo, a tangent-space
// normal map (derived from a baked height field) and an "arm" map (AO / roughness / metal, the layout the arena's
// Poly Haven sets use), so they plug into the same material code.
import * as THREE from 'three';

export interface BakedSet { color: THREE.Texture; normal: THREE.Texture; arm: THREE.Texture; dispose(): void }

/** Deterministic value noise and fbm (CPU side, for baking). */
function lattice(seed: number) {
  const h = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const n = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(xi, yi), h(xi + 1, yi), u), THREE.MathUtils.lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  };
  /** Tileable fbm over a period of `p` lattice cells. */
  const fbm = (x: number, y: number, p: number, oct = 4) => {
    let a = 0, amp = .5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const P = p * f, X = ((x * f) % P + P) % P, Y = ((y * f) % P + P) % P;
      // Tile by blending with the wrapped copy (cheap and seamless enough for a 1–2 m repeat).
      const wx = X / P, wy = Y / P;
      const a00 = n(X, Y), a10 = n(X - P, Y), a01 = n(X, Y - P), a11 = n(X - P, Y - P);
      a += amp * THREE.MathUtils.lerp(THREE.MathUtils.lerp(a00, a10, wx), THREE.MathUtils.lerp(a01, a11, wx), wy);
      norm += amp; amp *= .5; f *= 2;
    }
    return a / norm;
  };
  return { h, n, fbm };
}

function texture(data: Uint8Array, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

/** A tangent-space normal map from a tileable height field (central differences). */
function normalFrom(height: Float32Array, size: number, strength: number) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (i: number, j: number) => height[((j + size) % size) * size + ((i + size) % size)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * size + x) * 4;
    out[k] = (-dx / l * .5 + .5) * 255; out[k + 1] = (dy / l * .5 + .5) * 255; out[k + 2] = (1 / l * .5 + .5) * 255; out[k + 3] = 255;
  }
  return out;
}

/**
 * Brushed steel: fine directional grain along U (the brush strokes), long soft roughness streaks, scattered scratches
 * and faint water spotting. Roughness centres on ~0.28 (multiplied by the material's roughness factor of 1).
 */
export function brushedSteel(size = 512): BakedSet {
  const { h, n, fbm } = lattice(3.1), height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4), arm = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    // Brush grain: high frequency across V, stretched along U.
    const grain = n(u * 6, v * size * .9) * .6 + n(u * 14 + 3, v * size * .45) * .4;
    const streak = fbm(u * 2, v * 24, 2 * 1, 3);
    const spots = Math.max(0, fbm(u * 8, v * 8, 8, 3) - .62) * 3;
    const scratch = h(Math.floor(u * 64), Math.floor(v * 900)) > .9965 ? 1 : 0;
    height[i] = grain * .35 + scratch * -.6;
    const tone = .55 + (grain - .5) * .08 + (streak - .5) * .1 - spots * .06 + scratch * .1;
    color[i * 4] = color[i * 4 + 1] = color[i * 4 + 2] = THREE.MathUtils.clamp(tone, 0, 1) * 255;
    color[i * 4 + 2] = Math.min(255, color[i * 4 + 2] * 1.03); color[i * 4 + 3] = 255;
    const rough = THREE.MathUtils.clamp(.28 + (streak - .5) * .14 + (grain - .5) * .06 + spots * .18 - scratch * .1, .14, .6);
    arm[i * 4] = 255 * (1 - spots * .12); arm[i * 4 + 1] = rough * 255; arm[i * 4 + 2] = 255; arm[i * 4 + 3] = 255;
  }
  const c = texture(color, size, true), nm = texture(normalFrom(height, size, 2.2), size, false), a = texture(arm, size, false);
  return { color: c, normal: nm, arm: a, dispose() { c.dispose(); nm.dispose(); a.dispose(); } };
}

/**
 * Yellow/black hazard striping at 45° (one texture repeat = four stripe pairs), worn: chipped through to primer and
 * bare steel where the noise says so, grimy toward the bottom of each repeat, with scuffs across it. Painted (not
 * metal) except where chipped.
 */
export function hazardStripes(size = 512): BakedSet {
  const { h, fbm } = lattice(7.7), height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4), arm = new Uint8Array(size * size * 4);
  const yellow = [227, 171, 34], black = [22, 22, 20], primer = [92, 84, 74], steel = [150, 152, 156];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const s = ((u + v) * 4) % 1, stripe = s < .5 ? 1 : 0;
    // Soft stripe edge (anti-aliased in the bake).
    const edge = Math.min(Math.abs(s - .5), Math.abs(s), Math.abs(1 - s)) * size / 4;
    const mixK = THREE.MathUtils.clamp(edge, 0, 1);
    const base = stripe ? yellow : black;
    const wear = fbm(u * 6, v * 6, 6, 5), chip = wear > .68 ? (wear > .74 ? 2 : 1) : 0;
    const grime = fbm(u * 3 + 9, v * 3, 3, 4) * .5 + (1 - v) * .1;
    const scuff = h(Math.floor(u * 300), Math.floor(v * 18)) > .985 ? .5 : 0;
    let rgb = base.map((c, k) => THREE.MathUtils.lerp((stripe ? black : yellow)[k], c, mixK));
    if (chip === 1) rgb = primer; else if (chip === 2) rgb = steel;
    rgb = rgb.map(c => c * (1 - grime * .45) * (1 - scuff * .25));
    color[i * 4] = rgb[0]; color[i * 4 + 1] = rgb[1]; color[i * 4 + 2] = rgb[2]; color[i * 4 + 3] = 255;
    height[i] = chip ? -.4 * chip : 0;
    const rough = chip === 2 ? .32 : chip === 1 ? .78 : .5 + grime * .3 + scuff * .2;
    arm[i * 4] = 255 * (1 - grime * .25); arm[i * 4 + 1] = THREE.MathUtils.clamp(rough, 0, 1) * 255; arm[i * 4 + 2] = chip === 2 ? 255 : 0; arm[i * 4 + 3] = 255;
  }
  const c = texture(color, size, true), nm = texture(normalFrom(height, size, 1.5), size, false), a = texture(arm, size, false);
  return { color: c, normal: nm, arm: a, dispose() { c.dispose(); nm.dispose(); a.dispose(); } };
}
