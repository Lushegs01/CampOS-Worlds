import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { COLLIDERS, TREES } from '../../shared/campus.mjs';
import { NOISE_GLSL, type SurfaceSets } from './materials';
import { PATHS, PLAZA, PITCH, COURT, FOOTPRINTS, BEDS, HEDGES, inRect } from './layout';
import type { QualityProfile } from './quality';

// Layout mask: R lawn, G worn laterite, B bed soil, A football pitch. 0.25 m per texel.
export const MASK = { x0: -80, z0: -76, size: 160, res: 640 };
let maskTexture: THREE.DataTexture | null = null;

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
// Informal shortcuts students wear across lawns: a small detail that makes a campus feel used.
const DESIRE_LINES: [number, number, number, number][] = [[4.2, 30, 10.4, 21], [-4.2, 40, -12, 29.7], [-30, 3.2, -37, 7.4], [17, 12.6, 24.5, 17], [-8.4, -11.3, -16, -26.2], [8.6, -11, 13, -26]];

export function layoutMask() {
  if (maskTexture) return maskTexture;
  // Stamp each shape over its own pixel bounds (O(shape area)) rather than testing every shape
  // at every texel; this keeps generation to a few hundred milliseconds on a phone.
  const { res, size, x0, z0 } = MASK, step = size / res, N = res * res;
  const lawn = new Float32Array(N), wear = new Float32Array(N), bed = new Float32Array(N), pitch = new Uint8Array(N);
  const hash = (x: number, z: number) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x: number, z: number) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) + (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v; };
  const wx = (i: number) => x0 + (i + .5) * step, wz = (j: number) => z0 + (j + .5) * step;
  const span = (a: number, b: number, origin: number) => [Math.max(0, Math.floor((a - origin) / step)), Math.min(res - 1, Math.ceil((b - origin) / step))];
  const stamp = (bx0: number, bx1: number, bz0: number, bz1: number, fn: (o: number, x: number, z: number) => void) => {
    const [i0, i1] = span(bx0, bx1, x0), [j0, j1] = span(bz0, bz1, z0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * res + i, wx(i), wz(j));
  };
  // Lawn everywhere inside the walls, then carve out paths, plazas and structures.
  stamp(-69.3, 69.3, -64.3, 49.7, o => { lawn[o] = 1; });
  for (const p of PATHS) stamp(p.x0, p.x1, p.z0, p.z1, (o, x, z) => { if (inRect(x, z, p)) lawn[o] = 0; });
  stamp(PLAZA.x - PLAZA.r, PLAZA.x + PLAZA.r, PLAZA.z - PLAZA.r, PLAZA.z + PLAZA.r, (o, x, z) => { if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r) lawn[o] = 0; });
  for (const b of [...FOOTPRINTS, COURT]) stamp(b.x0, b.x1, b.z0, b.z1, o => { lawn[o] = 0; });
  for (const c of COLLIDERS) stamp(c.x - c.w / 2, c.x + c.w / 2, c.z - c.d / 2, c.z + c.d / 2, o => { lawn[o] = 0; });
  stamp(PITCH.x0, PITCH.x1, PITCH.z0, PITCH.z1, o => { lawn[o] = 1; pitch[o] = 1; });
  // Wear: soft edges along walkways, desire lines, goal mouths and a few naturally thin patches.
  for (const p of PATHS.filter(p => p.mat !== 'asphalt')) stamp(p.x0 - .6, p.x1 + .6, p.z0 - .6, p.z1 + .6, (o, x, z) => {
    const d = Math.hypot(Math.max(p.x0 - x, 0, x - p.x1), Math.max(p.z0 - z, 0, z - p.z1));
    if (d > 0 && d < .55) wear[o] = Math.max(wear[o], (1 - d / .55) * .35 * (.3 + vnoise(x * .9, z * .9)));
  });
  for (const [ax, az, bx, bz] of DESIRE_LINES) stamp(Math.min(ax, bx) - .8, Math.max(ax, bx) + .8, Math.min(az, bz) - .8, Math.max(az, bz) + .8, (o, x, z) => {
    const d = segmentDistance(x, z, ax, az, bx, bz); if (d < .7) wear[o] = Math.max(wear[o], (1 - d / .7) * (.55 + .5 * vnoise(x * 2.3, z * 2.3)));
  });
  const gx = (PITCH.x0 + PITCH.x1) / 2;
  for (const gz of [PITCH.z0, PITCH.z1]) stamp(gx - 5, gx + 5, gz - 3.6, gz + 3.6, (o, x, z) => { const d = Math.hypot((x - gx) * .7, z - gz); if (d < 3.5) wear[o] = Math.max(wear[o], (1 - d / 3.5) * .8 * vnoise(x * .9, z * .9)); });
  for (let o = 0; o < N; o++) { const x = wx(o % res), z = wz(Math.floor(o / res)); wear[o] = Math.max(wear[o], Math.max(0, vnoise(x * .11, z * .11) - .78) * 1.6); }
  // Beds: mulched tree pits, flower beds and the soil under hedges.
  for (const t of TREES) { const r = t.species === 'royal' || t.species === 'coconut' ? .75 : 1.25 * t.s; stamp(t.x - r, t.x + r, t.z - r, t.z + r, (o, x, z) => { const d = Math.hypot(x - t.x, z - t.z); if (d < r) bed[o] = Math.max(bed[o], Math.min(1, (r - d) / .35) * .7); }); }
  for (const b of BEDS) stamp(b.x - b.r1 - .2, b.x + b.r1 + .2, b.z - b.r1 - .2, b.z + b.r1 + .2, (o, x, z) => { const d = Math.hypot(x - b.x, z - b.z); if (d > b.r0 - .15 && d < b.r1 + .15) bed[o] = 1; });
  for (const h of HEDGES) for (let k = 0; k < h.points.length - 1; k++) {
    const [ax, az] = h.points[k], [bx, bz] = h.points[k + 1], w = h.width / 2 + .2;
    stamp(Math.min(ax, bx) - w, Math.max(ax, bx) + w, Math.min(az, bz) - w, Math.max(az, bz) + w, (o, x, z) => { if (segmentDistance(x, z, ax, az, bx, bz) < w) bed[o] = 1; });
  }
  const data = new Uint8Array(N * 4);
  for (let o = 0; o < N; o++) { const l = lawn[o]; data[o * 4] = l * 255; data[o * 4 + 1] = Math.min(255, wear[o] * l * 255); data[o * 4 + 2] = Math.round(bed[o] * 255); data[o * 4 + 3] = pitch[o] * 255; }
  maskTexture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  maskTexture.magFilter = THREE.LinearFilter; maskTexture.minFilter = THREE.LinearMipmapLinearFilter; maskTexture.generateMipmaps = true; maskTexture.needsUpdate = true;
  return maskTexture;
}

/** Terrain height: the campus is graded flat; hills and a forested ridge rise beyond the walls. */
export function terrainHeight(x: number, z: number) {
  const ox = Math.max(0, Math.abs(x) - 72), oz = Math.max(0, z < 0 ? -z - 67 : z - 62), d = Math.hypot(ox, oz);
  if (d <= 0) return 0;
  const ramp = Math.min(1, d / 90), n = Math.sin(x * .021) * Math.cos(z * .017) * .5 + Math.sin(x * .047 + z * .031) * .3 + Math.sin((x - z) * .011) * .6;
  return ramp * ramp * (14 + 16 * n) + Math.min(d, 6) * .12;
}

export function Ground({ surfaces, quality }: { surfaces: SurfaceSets; quality: QualityProfile }) {
  const geometry = useMemo(() => {
    // Dense in the campus (1 m), coarser beyond; positions in metres with world-space UVs.
    const g = new THREE.PlaneGeometry(1400, 1400, quality.terrainSegments, quality.terrainSegments); g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), z = p.getZ(i);
      // Pull vertices towards the centre so the campus area gets most of the resolution.
      const f = (v: number) => v * (.35 + .65 * Math.abs(v) / 700);
      x = f(x); z = f(z);
      p.setXYZ(i, x, terrainHeight(x, z) - .002, z); uv.setXY(i, x, -z);
    }
    g.computeVertexNormals();
    return g;
  }, [quality.terrainSegments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: surfaces.grass.color, normalMap: surfaces.grass.normal, roughness: 1, metalness: 0 });
    const mask = layoutMask();
    const uniforms = {
      uGrass: { value: surfaces.grass.color }, uGrassN: { value: surfaces.grass.normal }, uGrassARM: { value: surfaces.grass.arm },
      uGrass2: { value: surfaces.grass2.color }, uGrass2N: { value: surfaces.grass2.normal },
      uSoil: { value: surfaces.laterite.color }, uSoilN: { value: surfaces.laterite.normal },
      uMask: { value: mask }, uMaskRect: { value: new THREE.Vector4(MASK.x0, MASK.z0, MASK.size, MASK.size) },
    };
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.)).xyz;');
      shader.fragmentShader = `varying vec3 vWorldPos;
        uniform sampler2D uGrass, uGrassN, uGrassARM, uGrass2, uGrass2N, uSoil, uSoilN, uMask; uniform vec4 uMaskRect;
        ${NOISE_GLSL}
        const mat2 ROT = mat2(.7648, .6442, -.6442, .7648);
        vec4 gMask; float gBlend, gSoil, gBed; vec2 gUv;
      ` + shader.fragmentShader
        .replace('#include <map_fragment>', /* glsl */`
          gUv = vec2(vWorldPos.x, -vWorldPos.z);
          gMask = texture2D(uMask, (vWorldPos.xz - uMaskRect.xy) / uMaskRect.zw);
          float outside = 1. - step(abs(vWorldPos.x), 69.6) * step(-64.6, vWorldPos.z) * step(vWorldPos.z, 50.2);
          #ifdef GROUND_LAYERS
            float macro = cFbm(vWorldPos.xz * .018), detail = cFbm(vWorldPos.xz * .11 + 13.);
          #else
            float macro = cNoise(vWorldPos.xz * .018), detail = cNoise(vWorldPos.xz * .11 + 13.);
          #endif
          #ifdef GROUND_LAYERS
            vec3 g1 = mix(texture2D(uGrass, gUv / 2.6).rgb, texture2D(uGrass, ROT * gUv / 7.3).rgb, .45);
            vec3 g2 = texture2D(uGrass2, ROT * gUv / 3.4).rgb;
          #else
            vec3 g1 = texture2D(uGrass, gUv / 3.2).rgb; vec3 g2 = g1 * vec3(.9, .95, .85);
          #endif
          gBlend = smoothstep(.35, .75, detail);
          vec3 lawn = mix(g1, g2, gBlend * .55) * vec3(.82, 1.08, .74);
          lawn *= .82 + .36 * macro;
          lawn = mix(lawn, lawn * vec3(1.18, 1.05, .72), smoothstep(.62, .85, detail) * .5);
          // Mown stripes on the football pitch.
          lawn *= 1. + gMask.a * (step(.5, fract((vWorldPos.x + 66.) / 5.)) - .5) * .12;
          vec3 soil = texture2D(uSoil, gUv / 2.2).rgb * vec3(1.08, .96, .9);
          gSoil = clamp(gMask.g * (1. - outside) * 1.35, 0., 1.);
          gBed = gMask.b * (1. - outside);
          vec3 albedo = mix(lawn, soil, smoothstep(.12, .75, gSoil));
          albedo = mix(albedo, vec3(.085, .06, .042) * (.85 + .3 * detail), gBed * .9);
          // Beyond the walls: secondary forest and bush on the ridges, meadow in the hollows.
          #ifdef GROUND_LAYERS
            float canopy = smoothstep(.38, .62, cFbm(vWorldPos.xz * .012 + 31.) + cNoise(vWorldPos.xz * .09) * .25);
            vec3 forest = mix(vec3(.035, .06, .025), vec3(.085, .12, .045), cFbm(vWorldPos.xz * .07));
          #else
            float canopy = smoothstep(.38, .62, macro);
            vec3 forest = mix(vec3(.035, .06, .025), vec3(.085, .12, .045), detail);
          #endif
          vec3 meadow = mix(g2, g1, .5) * vec3(.62, .86, .48) * (.75 + .4 * macro);
          albedo = mix(albedo, mix(meadow, forest, canopy), outside);
          diffuseColor.rgb *= albedo;
        `)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #ifdef GROUND_LAYERS
            vec3 nA = texture2D(uGrassN, gUv / 2.6).xyz * 2. - 1.;
            vec3 nB = texture2D(uGrass2N, ROT * gUv / 3.4).xyz * 2. - 1.; nB.xy = transpose(ROT) * nB.xy;
            vec3 nS = texture2D(uSoilN, gUv / 2.2).xyz * 2. - 1.;
            vec3 mapN = normalize(mix(mix(nA, nB, gBlend * .55), nS, smoothstep(.12, .75, gSoil)));
            mapN.xy *= .9;
            normal = normalize(tbn * mapN);
          #endif
        `)
        .replace('#include <roughnessmap_fragment>', /* glsl */`
          float roughnessFactor = mix(.96, .9, gSoil) - gBlend * .03;
        `)
        .replace('#include <aomap_fragment>', /* glsl */`
          #include <aomap_fragment>
          #ifdef GROUND_LAYERS
            float gAO = mix(texture2D(uGrassARM, gUv / 2.6).r, 1., .35);
            reflectedLight.indirectDiffuse *= gAO;
          #endif
        `);
    };
    m.customProgramCacheKey = () => 'ground' + (quality.groundLayers ? 'L' : '');
    m.defines = quality.groundLayers ? { GROUND_LAYERS: '' } : {};
    return m;
  }, [surfaces, quality.groundLayers]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} receiveShadow name="ground" />;
}
