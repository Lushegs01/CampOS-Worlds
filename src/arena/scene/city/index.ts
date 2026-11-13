// Operation: Metropolis — the city of Okun Bay, built for the Combat Arena's renderer.
//
// Static art is merged per material and per region (a 3 × 3 grid of the street level, the station, and everything
// beyond the site), so a frame draws only the regions in view and never the station from the street or the street
// from the station. What moves is small and stateless: the train (from the match clock), glass panes (from the
// server's list of broken ones), rain, the fountain, signals, bridge traffic, and a small pool of real lights that
// follows the player from fitting to fitting.
import * as THREE from 'three';
import { Props } from '../environment';
import { CITY_PROPS, DECOR_PROPS, type Library, type PropKey } from '../library';
import type { ArenaQuality } from '../world';
import { trainAt } from '../../../../shared/arena/metropolis.mjs';
import { cityMaterials, clearCityMaterials, inside, interiorUniforms, type Where } from './materials';
import { CityBuilder, SignAtlas, placeFinder, streetExtras, CHUNK_FAR, CHUNK_STATION, T, RY, type CityMap } from './kit';
import { buildStructure, type Fixture } from './structure';
import { buildProps } from './props';
import { buildDressing, buildBackdrop, cityTime } from './world';
import { atmosphereOf } from './atmosphere';
import { cityWeather } from './surfaces';
import { setWindowLight } from './windows';
import { heightfield, createRain, createLampGlow } from './weather';
import { REFLECTED } from './reflection';

export interface CityLighting { glow: number; rain: boolean; wet: number }
/** The city's own light level and weather for a variant (everything else about it is in atmosphere.ts). */
export function cityLighting(variant: string): CityLighting { const a = atmosphereOf(variant); return { glow: a.glowLevel, rain: a.rain, wet: a.wet }; }

const STREET_WELLS: [number, number][] = [[-26, -19.5], [26, -19.5], [-26, 18.2], [26, 18.2], [-16, -7.4], [16, -7.4]];

export function buildCity(lib: Library, map: CityMap, q: ArenaQuality, variant: string) {
  const L = map.street, where = placeFinder(map), m = cityMaterials(lib), b = new CityBuilder(lib, L, where, !q.detail);
  const signs = new SignAtlas(q.detail ? 2048 : 1024), fixtures: Fixture[] = [];
  const signMat = new THREE.MeshStandardMaterial({ map: null, roughness: .55, metalness: .1 }), litMat = new THREE.MeshStandardMaterial({ map: null, emissive: '#ffffff', emissiveIntensity: .9, roughness: .5 });
  signMat.userData.fixed = litMat.userData.fixed = true; m.glows.push({ m: litMat, day: .9, night: 1.6 });
  const props = new Props(), ugProps = new Props();
  const aircon = (M: THREE.Matrix4) => { const p = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3(); M.decompose(p, r, s); const e = new THREE.Euler().setFromQuaternion(r, 'YXZ'); props.place('aircon' as PropKey, p.x, p.y, p.z, e.y, .8, .8, .8); };

  buildStructure(b, m, map, q.detail, signs, signMat, fixtures, aircon);
  // Lamps and palms are in the collision map; `streetExtras` only covers a map version without them.
  const art = map.boxes.some(x => x.mat === 'lamppost') ? map : { ...map, boxes: [...map.boxes, ...streetExtras(L)] };
  buildProps(b, m, lib, art, q.detail, signs, signMat, litMat, fixtures, props, ugProps);
  const dressing = buildDressing(b, m, lib, art, q.detail, signs, signMat, litMat, fixtures, props, ugProps);
  const backdrop = buildBackdrop(b, m, map, q.detail, m.glows);
  const atlas = signs.map(); signMat.map = atlas; litMat.map = atlas; litMat.emissiveMap = atlas;

  const statics = b.meshes(q.shadows);
  const reflectable = new Set<THREE.Material>([...m.render, m.brick, m.panel, m.cladding, m.stone, m.block, m.blockwork, m.concrete, m.precast, m.plaster, m.sheetBlue, m.sheetCream, m.sheetGreen, m.window, m.curtain, m.curtainGreen, m.white, m.blue, m.red, m.green, m.orange, m.yellow, ...m.bodies, m.lamp, m.lampWarm, m.lampCool, m.led, m.room, signMat, litMat, m.glassDark]);
  for (const mesh of statics) {
    if (mesh.userData.chunk === CHUNK_FAR) mesh.castShadow = false; if ((mesh.material as THREE.Material).transparent) { mesh.castShadow = false; mesh.renderOrder = 2; }
    // What a puddle shows: the built fabric and the skyline above the street (not the station, not small detail).
    // (The street itself — slabs, kerbs, markings, everything that ends within 30 cm of street level — is the mirror,
    // and its undersides would block the view from below.)
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    // Only what reads in a puddle: façades, glass, the city's lights, vehicles' bodies and the skyline — not trims,
    // steelwork or furniture (each material is a draw call per region in the reflection pass too).
    const mat = mesh.material as THREE.Material, base = (mat.userData.base as THREE.Material | undefined) ?? mat;
    if (mesh.userData.chunk !== CHUNK_STATION && (mesh.geometry.boundingSphere?.radius ?? 0) > 2 && mesh.geometry.boundingBox!.max.y > L + .3 && (mesh.userData.chunk === CHUNK_FAR || reflectable.has(base))) mesh.layers.enable(REFLECTED);
  }
  const present = new Set(Object.keys(lib.props));
  const tag = (o: THREE.Object3D, chunk: number, ug = false) => { o.userData.chunk = chunk; if (ug) { const im = o as THREE.InstancedMesh; im.material = inside(im.material as THREE.Material, 'ug'); im.castShadow = false; } return o; };
  const propMeshes = (only: (k: PropKey) => boolean) => [...props.meshes(lib, q.shadows, only).map(o => tag(o, -1)), ...ugProps.meshes(lib, false, only).map(o => tag(o, CHUNK_STATION, true))];
  const objects: THREE.Object3D[] = [...statics, ...propMeshes(k => present.has(k)), ...dressing.objects.map(o => tag(o, -1)), ...backdrop.objects];

  // ---------------------------------------------------------------- glass panes (broken by the server)
  const paneGeo = new THREE.BoxGeometry(1, 1, 1), panes = new THREE.InstancedMesh(paneGeo, m.glass, map.glass.length), M = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const shardTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; g.clearRect(0, 0, 128, 128); g.fillStyle = 'rgba(190,220,230,.55)'; g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1;
    for (let i = 0; i < 26; i++) { const side = i % 4, t = hash2(i) * 128, depth = 8 + hash2(i + 40) * 30, wd = 6 + hash2(i + 80) * 16; g.beginPath(); if (side === 0) { g.moveTo(t - wd, 0); g.lineTo(t + wd, 0); g.lineTo(t + (hash2(i + 9) - .5) * 10, depth); } else if (side === 1) { g.moveTo(t - wd, 128); g.lineTo(t + wd, 128); g.lineTo(t, 128 - depth); } else if (side === 2) { g.moveTo(0, t - wd); g.lineTo(0, t + wd); g.lineTo(depth, t); } else { g.moveTo(128, t - wd); g.lineTo(128, t + wd); g.lineTo(128 - depth, t); } g.closePath(); g.fill(); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const shardMat = new THREE.MeshStandardMaterial({ map: shardTex, transparent: true, alphaTest: .08, roughness: .08, envMapIntensity: 2, side: THREE.DoubleSide, depthWrite: false });
  const shards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), shardMat, map.glass.length);
  const paneMatrix = (i: number, plane: boolean) => { const g = map.glass[i], sx = g.max[0] - g.min[0], sy = g.max[1] - g.min[1], sz = g.max[2] - g.min[2]; M.makeTranslation((g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2, (g.min[2] + g.max[2]) / 2); return plane ? M.multiply(g.alongZ ? RY(Math.PI / 2) : RY(0)).scale(new THREE.Vector3(g.alongZ ? sz : sx, sy, 1)) : M.scale(new THREE.Vector3(g.alongZ ? .012 : sx, sy, g.alongZ ? sz : .012)); };
  const broken = new Set<number>();
  const setPanes = (list: Iterable<number>) => { broken.clear(); for (const i of list) broken.add(i); for (let i = 0; i < map.glass.length; i++) { panes.setMatrixAt(i, broken.has(i) ? ZERO : paneMatrix(i, false)); shards.setMatrixAt(i, broken.has(i) ? paneMatrix(i, true) : ZERO); } panes.instanceMatrix.needsUpdate = shards.instanceMatrix.needsUpdate = true; };
  setPanes([]); panes.renderOrder = shards.renderOrder = 3; panes.frustumCulled = shards.frustumCulled = false; panes.userData.chunk = shards.userData.chunk = -1; objects.push(panes, shards);
  /** Break pane i; returns its centre and the direction it faces (for the burst of fragments and its sound), or null if it was broken already. */
  const breakPane = (i: number) => {
    if (broken.has(i) || !map.glass[i]) return null; broken.add(i);
    panes.setMatrixAt(i, ZERO); shards.setMatrixAt(i, paneMatrix(i, true)); panes.instanceMatrix.needsUpdate = shards.instanceMatrix.needsUpdate = true;
    const g = map.glass[i]; return { at: new THREE.Vector3((g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2, (g.min[2] + g.max[2]) / 2), normal: g.alongZ ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), size: Math.max(g.max[0] - g.min[0], g.max[2] - g.min[2]) };
  };

  // ---------------------------------------------------------------- the train
  const train = new THREE.Group(); train.name = 'metropolis-train'; train.visible = false; train.userData.chunk = CHUNK_STATION;
  {
    const tb = new CityBuilder(lib, L, () => 'ug'), tr = map.train, cars = 3, gap = .6, carLen = (tr.length - gap * (cars - 1)) / cars, zc = (tr.z0 + tr.z1) / 2, hw = (tr.z1 - tr.z0) / 2 - .12;
    for (let c = 0; c < cars; c++) {
      const x0 = c * (carLen + gap), x1 = x0 + carLen;
      tb.rbox(x0, .55, zc - hw, x1, tr.top, zc + hw, m.stainless, .25); tb.box(x0 + .05, .55, zc - hw - .01, x1 - .05, 1.3, zc + hw + .01, m.blue, 2);
      tb.box(x0 + .8, 1.75, zc - hw - .015, x1 - .8, 2.75, zc + hw + .015, m.lampWarm, 2);
      for (let x = x0 + 2.2; x < x1 - 2; x += 4.3) tb.box(x, .6, zc - hw - .02, x + 1.5, 2.9, zc + hw + .02, m.stainless, 1);
      for (const x of [x0 + 2, x1 - 2]) tb.box(x - 1.1, .12, zc - 1, x + 1.1, .55, zc + 1, m.black, 1);
      if (c < cars - 1) tb.box(x1, .8, zc - hw + .3, x1 + gap, tr.top - .3, zc + hw - .3, m.rubber, 1);
    }
    for (const x of [-.02, tr.length + .0]) { tb.box(x - .02, 1.6, zc - hw + .25, x + .02, 2.9, zc + hw - .25, m.glassDark, 1); for (const s of [-1, 1]) tb.box(x - .03, .8, zc + s * (hw - .45) - .16, x + .03, 1.05, zc + s * (hw - .45) + .16, m.headlamp, 1); tb.box(x - .03, 3.0, zc - .7, x + .03, 3.3, zc + .7, m.led, 1); }
    for (const mesh of tb.meshes(false)) { mesh.frustumCulled = false; train.add(mesh); }
  }
  objects.push(train);

  // ---------------------------------------------------------------- fountain
  const jets = (() => {
    const n = q.detail ? 420 : 200, seedA = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
    for (let i = 0; i < n; i++) { seedA[i * 3] = hash2(i) * 6.283; seedA[i * 3 + 1] = hash2(i + 500); seedA[i * 3 + 2] = Math.floor(hash2(i + 900) * 9); }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 3)); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, L + 1.5, 2.4), 6);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { ...cityTime, uBase: { value: new THREE.Vector3(0, L + .05, 2.4) }, uBright: { value: 1 } },
      vertexShader: `uniform float uTime; uniform vec3 uBase; attribute vec3 aSeed; varying float vA;
        void main(){ float jet = aSeed.z, ring = jet < 1. ? 0. : 2.6; float a = jet < 1. ? aSeed.x : (jet - 1.) / 8. * 6.2832;
          float life = fract(uTime * (.55 + .1 * fract(jet * .37)) + aSeed.y), v0 = jet < 1. ? 6.6 : 4.3, t = life * (2. * v0 / 9.8);
          vec3 p = uBase + vec3(cos(a) * ring, 0., sin(a) * ring); float out0 = jet < 1. ? .5 : -.75;
          p.xz += vec2(cos(a + aSeed.x * .12), sin(a + aSeed.x * .12)) * out0 * t; p.y += v0 * t - 4.9 * t * t;
          vA = (1. - life) * .8 + .1; vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = (jet < 1. ? 70. : 46.) / -mv.z; }`,
      fragmentShader: 'uniform float uBright; varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(vec3(.82, .92, 1.) * uBright, vA * smoothstep(.5, .1, d) * .7); }' });
    const pts = new THREE.Points(geo, mat); pts.userData.chunk = -1; pts.renderOrder = 4;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.5, 40).rotateX(-Math.PI / 2), m.water); pool.position.set(0, L + .045, 2.4); pool.userData.chunk = -1; pool.renderOrder = 1;
    objects.push(pts, pool); return mat;
  })();

  // ---------------------------------------------------------------- weather
  const light = cityLighting(variant), atmo = atmosphereOf(variant);
  const field = heightfield(map.boxes, map.bounds, L);
  /** The city's shared weather and room-light state (set when the scene mounts; reset by dispose()). */
  const activate = () => { cityWeather.uWet.value = light.wet; cityWeather.uStreet.value = L; cityWeather.uPuddle.value = .56; cityWeather.uHeight.value = field.tex; cityWeather.uHeightBox.value.copy(field.origin); setWindowLight(light.glow, light.rain); };
  activate();
  const ambient = new THREE.Color(...atmo.fog);
  const rain = light.rain ? createRain(field, L, ambient, q.effects >= 1.2 ? { streaks: 9000, splashes: 420, curtains: 3, radius: 24 } : q.effects >= 1 ? { streaks: 6500, splashes: 280, curtains: 3, radius: 22 } : { streaks: 2600, splashes: 90, curtains: 1, radius: 16 }) : null;
  if (rain) { rain.group.userData.chunk = -1; objects.push(rain.group); }
  // Street lamps: their heads (the outdoor fittings), a halo and a cone of light in wet or dark air.
  const heads = fixtures.filter(f => f.where === 'out').map(f => f.p.clone().add(new THREE.Vector3(0, .26, 0)));
  const glowStrength = light.glow > .7 ? 1.2 : light.rain ? .16 : light.glow * .3;   // daylight washes the scatter out
  const cones = light.glow > .7;                                                          // beams of light read only in the dark
  const lampGlow = createLampGlow(heads, new THREE.Color('#ffd7a3'), glowStrength, cones); lampGlow.group.userData.chunk = -1; lampGlow.group.traverse(o => o.layers.enable(REFLECTED)); objects.push(lampGlow.group);
  const nearLamps: THREE.Vector4[] = [];
  // The city's own lights, by variant.
  for (const g of m.glows) { const v = g.day + (g.night - g.day) * light.glow; if ((g.m as THREE.MeshBasicMaterial).isMeshBasicMaterial) (g.m as THREE.MeshBasicMaterial).opacity = v; else (g.m as THREE.MeshStandardMaterial).emissiveIntensity = v; }
  jets.uniforms.uBright.value = 1 - light.glow * .45;

  // ---------------------------------------------------------------- a pool of real lights that follows the player
  const pool = Array.from({ length: q.lights }, () => { const l = new THREE.PointLight('#ffffff', 0, 13, 1.8); l.userData.chunk = -1; objects.push(l); return l; });
  const byWhere: Record<string, Fixture[]> = { ug: [], shop: [], hall: [], out: [] }; for (const f of fixtures) byWhere[f.where].push(f);
  let poolAt = -1, camWhere: Where = 'out';
  const assign = (cam: THREE.Vector3) => {
    if (!pool.length) return;
    camWhere = where(cam.x, cam.y - 1.2, cam.z);
    const lit = camWhere === 'ug' ? byWhere.ug : [...byWhere.shop, ...byWhere.hall, ...(light.glow > .3 ? byWhere.out : [])];
    const near = lit.map(f => ({ f, d: f.p.distanceToSquared(cam) })).sort((a, c) => a.d - c.d);
    pool.forEach((l, i) => { const n = near[i]; if (!n || n.d > 30 * 30) { l.intensity = 0; return; } l.position.copy(n.f.p); l.color.set(n.f.color); l.distance = n.f.where === 'out' ? 20 : n.f.where === 'hall' ? 16 : 11; l.intensity = n.f.where === 'out' ? 70 * light.glow : n.f.where === 'ug' ? 26 : n.f.where === 'hall' ? 34 : 18; });
  };

  // ---------------------------------------------------------------- per frame
  let lastUnder: boolean | null = null, lastNear = false, pixel = 1 / 720;
  const signal = [m.signalRed, m.signalAmber, m.signalGreen];
  /**
   * `elapsedMs`: time since the match started (−1 outside a match). Returns the train's state for sound and warnings.
   */
  const update = (t: number, cam: THREE.Vector3, elapsedMs: number, covered: boolean) => {
    cityTime.uTime.value = t;
    // Regions: the station is drawn only from inside it or from the head of a stair; the street only from above
    // ground or near a stair.
    const under = cam.y < L - .4; let near = false;
    for (const [x, z] of STREET_WELLS) if ((cam.x - x) ** 2 + (cam.z - z) ** 2 < (under ? 20 * 20 : 17 * 17)) { near = true; break; }
    if (under !== lastUnder || near !== lastNear) {
      lastUnder = under; lastNear = near;
      for (const o of objects) { const c = o.userData.chunk as number | undefined; if (c === undefined) continue; if (c === CHUNK_STATION) o.visible = under || near; else if (c === CHUNK_FAR) o.visible = !under; else o.visible = !under || near; }
    }
    void covered;
    cityWeather.uRainTime.value = t;
    if (rain) { rain.group.visible = !under; rain.update(t, cam, pixel, nearLamps); }
    if (!under) backdrop.traffic(t);
    // Signals: 9 s green, 2 s amber, 9 s red.
    const phase = t % 20, on = phase < 9 ? 2 : phase < 11 ? 1 : 0, lvl = 3 + light.glow * 2;
    signal.forEach((mat, i) => { mat.emissiveIntensity = i === on ? lvl : .05; });
    m.beacon.emissiveIntensity = (Math.sin(t * 2.6) > .55 ? 1 : .08) * (2 + light.glow * 4);
    if (t - poolAt > .3 || t < poolAt) {
      poolAt = t; assign(cam);
      // The lamps nearest the eye, for the rain's glints.
      const k = light.rain ? 2.2 : 0;
      nearLamps.length = 0; for (const h of [...heads].sort((a, b) => a.distanceToSquared(cam) - b.distanceToSquared(cam)).slice(0, 8)) nearLamps.push(new THREE.Vector4(h.x, h.y, h.z, k));
    }
    // The train, from the timetable.
    const tr = elapsedMs >= 0 ? trainAt(elapsedMs, map.train) : null;
    if (tr && !tr.warning) { train.visible = under || near; train.position.x = tr.x0; return { warning: false, x0: tr.x0 as number, x1: tr.x1 as number, dir: tr.dir as number, inMs: 0 }; }
    train.visible = false;
    return tr ? { warning: true, x0: 0, x1: 0, dir: tr.dir as number, inMs: tr.inMs as number } : null;
  };
  /** A controlled power failure: interior and station lighting dips (0 normal … 1 dark). */
  const setPower = (out: number) => { interiorUniforms.uFillScale.value = 1 - .8 * out; };

  const wanted: PropKey[] = [...DECOR_PROPS, ...CITY_PROPS];
  const decor = (keys: PropKey[]) => { const add = propMeshes(k => keys.includes(k) && !present.has(k)); for (const k of keys) present.add(k); for (const o of add) { const c = o.userData.chunk as number; o.visible = c === CHUNK_STATION ? !!(lastUnder || lastNear) : !lastUnder || lastNear; } objects.push(...add); return add; };
  const dispose = () => { clearCityMaterials(); atlas.dispose(); shardTex.dispose(); interiorUniforms.uFillScale.value = 1; rain?.dispose(); lampGlow.dispose(); field.tex.dispose(); cityWeather.uWet.value = 0; cityWeather.uReflect.value = 0; cityWeather.uHeight.value = null; };
  void T;
  // The renderer's per-frame entry: the match clock, the server's broken panes, the camera, whether it is under cover.
  let paneKey = '', clock = 0;
  const frame = (elapsed: number, brokenNow: Set<number>, cam: THREE.Vector3, covered: boolean, dt: number) => {
    clock += dt;
    if (brokenNow.size !== broken.size || (brokenNow.size && [...brokenNow].join() !== paneKey)) {
      if (brokenNow.size < broken.size) setPanes(brokenNow); else for (const i of brokenNow) if (!broken.has(i)) { const hit = breakPane(i); if (hit) onBreak?.(hit); }
      paneKey = [...brokenNow].join();
    }
    return update(clock, cam, elapsed, covered);
  };
  let onBreak: ((hit: NonNullable<ReturnType<typeof breakPane>>) => void) | null = null;
  const group = new THREE.Group(); group.name = 'metropolis'; group.add(...objects);
  return { objects: [group] as THREE.Object3D[], group, lights: [] as THREE.Vector3[], setPixel: (px: number) => { pixel = px; }, activate, rainGroup: rain?.group ?? null, atmosphere: atmo, sampleHeight: field.sample, decor: (keys: PropKey[]) => decor(keys), wanted, update: frame, onPaneBreak: (fn: typeof onBreak) => { onBreak = fn; }, setPanes, setPower, lighting: light, dispose, fixtures, placeOf: where };
}
export type City = ReturnType<typeof buildCity>;
const hash2 = (i: number) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
