import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TREES } from '../../shared/campus.mjs';
import { growTree, growPalm, type Species, type TreeGeometry } from './vegetation/trees';
import { rng } from './architecture/kit';
import { cached, loadTexture, suspend } from './assets';
import { NOISE_GLSL, type Materials } from './materials';
import { HEDGES, BEDS, isLawn, onPath } from './layout';
import { layoutMask, MASK, terrainHeight } from './Ground';
import type { QualityProfile } from './quality';

const wind = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(.55, .74, .38) } };
export function setSunDirection(d: THREE.Vector3) { wind.uSun.value.copy(d).normalize(); }

/** Alpha-tested foliage: wind sway, unflipped (hull) normals on both faces, sun translucency. */
function foliageMaterial(map: THREE.Texture, kind: 'card' | 'frond' | 'hedge') {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: .42, side: THREE.DoubleSide, vertexColors: true, roughness: .72, metalness: 0, envMapIntensity: .7 });
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, wind);
    s.vertexShader = `uniform float uTime; attribute vec2 aWind; varying vec3 vLeafWorld;\n` + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float sway = sin(uTime * 1.1 + wp.x * .07 + wp.z * .05) * .5 + sin(uTime * 2.3 + wp.x * .13) * .25;
          float flutter = sin(uTime * ${kind === 'frond' ? '3.1' : '7.0'} + aWind.x * 3.) * aWind.y;
          float h = max(0., transformed.y) * ${kind === 'hedge' ? '.02' : '.012'};
          transformed.x += (sway * h + flutter * ${kind === 'frond' ? '.06' : '.035'});
          transformed.z += (sway * h * .6 + flutter * ${kind === 'frond' ? '.05' : '.03'});
          transformed.y += flutter * ${kind === 'frond' ? '.08' : '.02'};
        }`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLeafWorld = (modelMatrix * vec4(transformed, 1.)).xyz;');
    s.fragmentShader = `uniform vec3 uSun; varying vec3 vLeafWorld;\n` + s.fragmentShader
      .replace('#include <normal_fragment_begin>', `float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;`)
      .replace('#include <opaque_fragment>', `
        vec3 toCam = normalize(cameraPosition - vLeafWorld);
        float back = pow(max(0., dot(-toCam, uSun)), 3.);
        outgoingLight += diffuseColor.rgb * vec3(1., .95, .7) * back * .55;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'foliage-' + kind;
  return m;
}

interface Group { species: Species; variant: number; geometry: TreeGeometry | null; matrices: THREE.Matrix4[]; colors: THREE.Color[]; palm: boolean; royal: boolean; castShadow: boolean }
const yieldToBrowser = () => new Promise<void>(r => setTimeout(r, 0));

function speciesGeometry(species: Species, variant: number, density: number, lite: boolean) {
  return species === 'royal' || species === 'coconut' ? growPalm(species, variant + 1, density, lite) : growTree(species, variant + 1 + species.length * 31, density, lite);
}

/** Place every tree, then grow each unique variant in its own task so the page stays responsive. */
async function plantTrees(density: number) {
  const groups = new Map<string, Group>(), r = rng(99);
  const add = (species: Species, x: number, z: number, scale: number, rot: number, shadow: boolean, variant: number) => {
    const key = `${species}:${variant}:${shadow}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { species, variant, geometry: null, matrices: [], colors: [], palm: species === 'royal' || species === 'coconut', royal: species === 'royal', castShadow: shadow });
    g.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrainHeight(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(scale, scale * (.92 + r() * .16), scale)));
    g.colors.push(new THREE.Color(.86 + r() * .2, .9 + r() * .2, .8 + r() * .2));
  };
  (TREES as { x: number; z: number; species: Species; s: number }[]).forEach((t, i) => add(t.species, t.x, t.z, t.s, r() * Math.PI * 2, true, i % 3));
  // Forest belt and ridge beyond the boundary walls: lighter variants without shadows.
  // Rounded crowns read best as a distant tree line; palms punctuate it.
  const belt = ['mango', 'neem', 'mango', 'flamboyant', 'mango', 'coconut', 'neem'] as Species[];
  // A dense band hugging the walls closes the horizon; sparser trees climb the ridges behind.
  const beltCount = Math.round(460 * Math.pow(density, 1.5));
  for (let i = 0; i < beltCount; i++) {
    const inner = i % 5 < 3, a = r() * Math.PI * 2, d = inner ? 82 + r() * 34 : 110 + Math.pow(r(), .7) * 160, x = Math.cos(a) * d * 1.05, z = Math.sin(a) * d - 4;
    if (Math.abs(x) < 78 && z > -72 && z < 68) continue;
    if (z > 51 && z < 66 && Math.abs(x) < 150) continue;
    add(belt[i % belt.length], x, z, .9 + r() * .5, r() * Math.PI * 2, false, i % 2);
  }
  for (const g of groups.values()) { g.geometry = speciesGeometry(g.species, g.variant, density * (g.castShadow ? 1 : .7), !g.castShadow); await yieldToBrowser(); }
  return [...groups.values()] as (Group & { geometry: TreeGeometry })[];
}

/** Hedge and bed cards scattered over rounded volumes, using the hedge atlas. */
function plantGardens(density: number) {
  const r = rng(7), cards: { p: THREE.Vector3; n: THREE.Vector3; size: number; cell: number; tint: number }[] = [];
  const add = (p: THREE.Vector3, n: THREE.Vector3, size: number, cell: number) => cards.push({ p, n, size, cell, tint: .75 + r() * .4 });
  for (const h of HEDGES) for (let k = 0; k < h.points.length - 1; k++) {
    const [ax, az] = h.points[k], [bx, bz] = h.points[k + 1], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let s = 0; s < len; s += .22 / density) {
      const x = ax + dx * s, z = az + dz * s;
      if (onPath(x, z, .45)) continue;
      for (let i = 0; i < 3; i++) {
        const side = r() * 2 - 1, up = r(), across = side * h.width / 2, y = h.height * (.25 + .75 * up);
        const p = new THREE.Vector3(x - dz * across, Math.min(h.height, y + (Math.abs(side) < .6 ? h.height * .2 : 0)), z + dx * across);
        const n = new THREE.Vector3(-dz * side, .6 + up, dx * side).normalize();
        add(p, n, .55 + r() * .25, h.flowers && r() < .45 ? 1 + h.flowers : Math.floor(r() * 2));
      }
    }
  }
  const ring = BEDS[0];
  for (const b of BEDS) {
    const area = Math.PI * (b.r1 * b.r1 - b.r0 * b.r0), n = Math.round(area * 7 * density);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(b.r0 * b.r0 + r() * (b.r1 * b.r1 - b.r0 * b.r0)), x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
      if (b === ring && onPath(x, z, .25)) continue;
      if (b !== ring && !isLawn(x, z)) continue;
      const p = new THREE.Vector3(x, .12 + r() * .3, z), n2 = new THREE.Vector3(r() - .5, 1.2, r() - .5).normalize();
      add(p, n2, .45 + r() * .3, r() < .6 ? (b.palette === 'gold' ? 3 : 2) : Math.floor(r() * 2));
    }
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], wnd: number[] = [], right = new THREE.Vector3(), up = new THREE.Vector3();
  for (const c of cards) {
    right.set(r() - .5, 0, r() - .5).cross(c.n).normalize(); if (right.lengthSq() < .01) right.set(1, 0, 0); up.crossVectors(c.n, right);
    const h = c.size / 2, u0 = (c.cell % 2) * .5, v0 = c.cell < 2 ? .5 : 0, bent = c.n.clone().lerp(new THREE.Vector3(0, 1, 0), .5).normalize();
    const corners = [[-h, -h, u0, v0], [h, -h, u0 + .5, v0], [h, h, u0 + .5, v0 + .5], [-h, h, u0, v0 + .5]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [a, b, cu, cv] = corners[k];
      pos.push(c.p.x + right.x * a + up.x * b, Math.max(.03, c.p.y + right.y * a + up.y * b), c.p.z + right.z * a + up.z * b);
      nor.push(bent.x, bent.y, bent.z); uv.push(cu, cv); col.push(c.tint, c.tint, c.tint); wnd.push(c.p.x + c.p.z, .4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wnd, 2)); g.computeBoundingSphere();
  return g;
}

export function Vegetation({ lib, quality, reduced }: { lib: Materials; quality: QualityProfile; reduced: boolean }) {
  const atlases = suspend(cached('foliage', () => Promise.all(['foliage/leaf-broad.ktx2', 'foliage/leaf-pinnate.ktx2', 'foliage/leaf-hedge.ktx2', 'foliage/palm-frond.ktx2'].map(p => loadTexture(p).then(t => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; })))));
  const materials = useMemo(() => ({
    broad: foliageMaterial(atlases[0], 'card'), pinnate: foliageMaterial(atlases[1], 'card'), hedge: foliageMaterial(atlases[2], 'hedge'), frond: foliageMaterial(atlases[3], 'frond'),
    royal: Object.assign(lib.palmBark.clone(), { vertexColors: true, color: new THREE.Color('#c9c4bb') }), coconut: Object.assign(lib.palmBark.clone(), { vertexColors: true }),
  }), [atlases, lib]);
  // Generated after the campus has appeared; trees stream in without blocking the first frame.
  const trees = suspend(cached(`trees:${quality.foliage}`, () => yieldToBrowser().then(() => plantTrees(quality.foliage))));
  const gardens = suspend(cached(`gardens:${quality.foliage}`, () => yieldToBrowser().then(() => plantGardens(quality.foliage))));
  const meshes = useMemo(() => {
    const out: THREE.Object3D[] = [];
    for (const g of trees) {
      const leafMat = g.geometry.atlas === 'frond' ? materials.frond : g.geometry.atlas === 'broad' ? materials.broad : materials.pinnate;
      const woodMat = g.palm ? (g.royal ? materials.royal : materials.coconut) : lib.bark;
      const wood = new THREE.InstancedMesh(g.geometry.wood, woodMat, g.matrices.length), leaves = new THREE.InstancedMesh(g.geometry.leaves, leafMat, g.matrices.length);
      g.matrices.forEach((m, i) => { wood.setMatrixAt(i, m); leaves.setMatrixAt(i, m); leaves.setColorAt(i, g.colors[i]); });
      for (const m of [wood, leaves]) { m.castShadow = g.castShadow; m.receiveShadow = true; m.computeBoundingSphere(); }
      leaves.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMat.map, alphaTest: .42 });
      wood.name = 'trees:wood'; leaves.name = 'trees:leaves'; out.push(wood, leaves);
    }
    const garden = new THREE.Mesh(gardens, materials.hedge);
    garden.castShadow = true; garden.receiveShadow = true; garden.name = 'gardens';
    garden.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: materials.hedge.map, alphaTest: .42 });
    out.push(garden);
    return out;
  }, [materials, lib, trees, gardens]);
  // Geometry belongs to the session cache; quality switches must not dispose shared buffers.
  useEffect(() => () => meshes.forEach(m => { const mesh = m as THREE.InstancedMesh; if (mesh.isInstancedMesh) mesh.dispose(); mesh.customDepthMaterial?.dispose(); }), [meshes]);
  useFrame((_, dt) => { if (!reduced) wind.uTime.value += dt; });
  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}{quality.grassBlades > 0 && <Grass count={quality.grassBlades} radius={quality.grassRadius} />}</>;
}

/** GPU grass: blades on a toroidal grid that travels with the camera, masked to lawns. */
function Grass({ count, radius }: { count: number; radius: number }) {
  const mesh = useMemo(() => {
    const blade = new THREE.BufferGeometry(), segs = 3, pos: number[] = [], idx: number[] = [], t: number[] = [];
    for (let i = 0; i <= segs; i++) { const v = i / segs, w = .011 * (1 - v * .8); pos.push(-w, v, 0, w, v, 0); t.push(v, v); }
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); blade.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1)); blade.setIndex(idx);
    blade.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    const geo = new THREE.InstancedBufferGeometry().copy(blade as unknown as THREE.InstancedBufferGeometry); geo.instanceCount = count;
    const r = rng(3), offsets = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { offsets[i * 4] = (r() * 2 - 1) * radius; offsets[i * 4 + 1] = (r() * 2 - 1) * radius; offsets[i * 4 + 2] = r() * Math.PI * 2; offsets[i * 4 + 3] = r(); }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .85, side: THREE.DoubleSide });
    const uniforms = { uTime: wind.uTime, uCam: { value: new THREE.Vector2() }, uRadius: { value: radius }, uMask: { value: layoutMask() }, uMaskRect: { value: new THREE.Vector4(MASK.x0, MASK.z0, MASK.size, MASK.size) } };
    mat.onBeforeCompile = s => {
      Object.assign(s.uniforms, uniforms);
      s.vertexShader = `uniform float uTime, uRadius; uniform vec2 uCam; uniform sampler2D uMask; uniform vec4 uMaskRect; attribute vec4 aOffset; attribute float aT; varying float vT; varying float vShade;\n${NOISE_GLSL}\n` + s.vertexShader
        .replace('#include <begin_vertex>', `
          vec2 rel = mod(aOffset.xy - uCam + uRadius, 2. * uRadius) - uRadius;
          vec2 world = uCam + rel;
          vec4 mask = texture2D(uMask, (world - uMaskRect.xy) / uMaskRect.zw);
          float lawn = mask.r * (1. - mask.g * .8) * (1. - mask.b) * (1. - mask.a * .55);
          float fade = 1. - smoothstep(uRadius * .55, uRadius, length(rel));
          float h = (.05 + .1 * cNoise(world * .7) + .05 * aOffset.w) * lawn * fade;
          float c = cos(aOffset.z), s = sin(aOffset.z);
          vec3 transformed = vec3(position.x * c, position.y * h, position.x * s);
          float bend = (sin(uTime * 1.7 + world.x * .6 + world.y * .4) * .5 + .5) * aT * aT * h * .55;
          transformed.x += bend * .8 + aT * aT * h * .25 * cos(aOffset.w * 6.28); transformed.z += bend * .5;
          transformed.xz += world;
          vT = aT; vShade = .78 + .4 * cNoise(world * .23) + aOffset.w * .1;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(0., 1., 0.));');
      s.fragmentShader = `varying float vT; varying float vShade;\n` + s.fragmentShader.replace('#include <map_fragment>', `
          diffuseColor.rgb = mix(vec3(.07, .11, .035), vec3(.22, .3, .1), vT) * vShade;`);
    };
    mat.customProgramCacheKey = () => 'grass';
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.receiveShadow = true; m.name = 'grass';
    return { m, uniforms };
  }, [count, radius]);
  useFrame(({ camera }) => { mesh.uniforms.uCam.value.set(camera.position.x, camera.position.z); });
  useEffect(() => () => { mesh.m.geometry.dispose(); (mesh.m.material as THREE.Material).dispose(); }, [mesh]);
  return <primitive object={mesh.m} />;
}

