// Okun Bay around and on top of the playable structure: road markings and kerbs, ironwork, light fittings, CCTV,
// palms and shade trees, traffic signals, and everything beyond the site (the skyline, the port's cranes, a ship
// at the quay, the bay and the bridge across it).
import * as THREE from 'three';
import { Props } from '../environment';
import type { Library, PropKey } from '../library';
import { growPalm, growTree } from '../../../world/vegetation/trees';
import { CityBuilder, SignAtlas, signPanel, T, RY, hash, CHUNK_FAR, CHUNK_STATION, type CityMap } from './kit';
import type { CityMats, Glow } from './materials';
import { buildPort, type PortArt } from './port';
import type { Fixture } from './structure';

/** Shared time for wind in leaves, water and signs. */
export const cityTime = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(.4, .8, .4) } };

/** Alpha-tested foliage with wind sway and sun shining through (the campus' foliage shading, with the arena's clock). */
function foliageMaterial(map: THREE.Texture, frond: boolean) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: .42, side: THREE.DoubleSide, vertexColors: true, roughness: .72, metalness: 0, envMapIntensity: .7 });
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, cityTime);
    s.vertexShader = 'uniform float uTime; attribute vec2 aWind; varying vec3 vLeafWorld;\n' + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 wp = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float sway = sin(uTime * 1.1 + wp.x * .07 + wp.z * .05) * .5 + sin(uTime * 2.3 + wp.x * .13) * .25;
          float flutter = sin(uTime * ${frond ? '3.1' : '7.0'} + aWind.x * 3.) * aWind.y;
          float h = max(0., transformed.y) * .012;
          transformed.x += sway * h + flutter * ${frond ? '.06' : '.035'}; transformed.z += sway * h * .6 + flutter * ${frond ? '.05' : '.03'}; transformed.y += flutter * ${frond ? '.08' : '.02'}; }`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLeafWorld = (modelMatrix * vec4(transformed, 1.)).xyz;');
    s.fragmentShader = 'uniform vec3 uSun; varying vec3 vLeafWorld;\n' + s.fragmentShader
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;')
      .replace('#include <opaque_fragment>', `vec3 toCam = normalize(cameraPosition - vLeafWorld); float back = pow(max(0., dot(-toCam, uSun)), 3.);
        outgoingLight += diffuseColor.rgb * vec3(1., .95, .7) * back * .55;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'city-foliage' + (frond ? 'f' : 'l');
  return m;
}

export function buildDressing(b: CityBuilder, m: CityMats, lib: Library, map: CityMap, detail: number, signs: SignAtlas, signMat: THREE.Material, litMat: THREE.Material, fixtures: Fixture[], props: Props, ugProps: Props) {
  const L = map.street, objects: THREE.Object3D[] = [];
  const both = (fn: (s: 1 | -1) => void) => { fn(1); fn(-1); };
  const paint = (x0: number, z0: number, x1: number, z1: number, mat: THREE.Material = m.paintWhite) => b.box(Math.min(x0, x1), L + .004, Math.min(z0, z1), Math.max(x0, x1), L + .012, Math.max(z0, z1), mat, 1);
  b.force = 'out';
  // ---------------------------------------------------------------- carriageway markings
  // Marina Avenue: edge lines, a dashed lane line each side of the median, zebra crossings, stop lines, bus bays.
  for (const z of [-28.75, -21.25]) paint(-49.5, z - .06, 49.5, z + .06, m.paintYellow);
  for (let x = -43; x < 43; x += 6) if (Math.abs(x + 1.5) > 10.5) { paint(x, -27.06, x + 3, -26.94); paint(x, -23.06, x + 3, -22.94); }
  both(s => {
    for (let z = -28.4; z < -21.4; z += .9) paint(s * 43.6, z, s * 46.4, z + .5);              // zebra by the interchange
    for (let x = 10.6; x < 13.4; x += .9) for (const z0 of [-28.6, -23.2]) paint(s * x, z0, s * (x + .5), z0 + 2.4); // crossings to the median station
    paint(s * 47, -28.7, s * 47.3, -21.3);
    // Broad Street and Harbour Road.
    for (let z = -16; z < 9; z += 5) paint(s * 47.06, z, s * 46.94, z + 2.4);
    for (let z = -17.4; z < -11.4; z += .9) paint(s * 44.3, z + 6.8, s * 49.7, z + 7.3);
    for (let x = 14; x < 42; x += 6) paint(s * x, 13.94, s * (x + 3), 14.06);
    for (const z of [11.25, 16.75]) paint(s * 7, z - .06, s * 49.5, z + .06, m.paintYellow);
    // Yard bay lines in front of the warehouse doors and hatching at the port gate.
    for (const x of [38.5, 33.5, 21, 16]) paint(s * x - .05, 19.8, s * x + .05, 21);
    for (let i = 0; i < 5; i++) paint(s * (2.2 + i * .9), 13.2, s * (2.6 + i * .9), 14.4, m.paintYellow);
  });
  // Kerbs along every carriageway edge (granite, a few centimetres proud).
  const kerb = (x0: number, z0: number, x1: number, z1: number) => b.box(Math.min(x0, x1), L - .02, Math.min(z0, z1), Math.max(x0, x1), L + .045, Math.max(z0, z1), m.kerb, 1.5);
  both(s => { kerb(s * 50, -29.16, 0, -29); kerb(s * 50, -21, 0, -20.84); kerb(s * 50.16, -18, s * 50, 11); kerb(s * 44, -18, s * 43.84, -11.2); kerb(s * 44, 7, s * 43.84, 11); kerb(s * 59, 17, s * 44, 17.16); kerb(s * 44, 17, s * 13, 17.16); kerb(s * 28, 10.86, s * 44, 11); });
  // Ironwork and drainage.
  both(s => {
    for (const [x, z] of [[36, -25.9], [18, -22.6], [5, -27.6], [47, -6], [47.2, 6.5], [30, 14.2], [9, 12.4], [52, 13.8]]) props.place('manhole' as PropKey, s * x, L + .005, z, hash(x, z) * 6, 1, 1, 1);
    for (let x = 8; x < 48; x += 13) { b.box(s * x - .25, L + .003, -28.98, s * x + .25, L + .012, -28.8, m.darkSteel, 1); b.box(s * x - .25, L + .003, 16.8, s * x + .25, L + .012, 16.98, m.darkSteel, 1); }
  });
  // ---------------------------------------------------------------- traffic signals at the interchange exits
  both(s => {
    const x = s * 43.4, z = -20.6; b.post(x, z, L, L + 3.4, .06, m.darkSteel, 8);
    b.box(x - .13, L + 2.5, z - .1, x + .13, L + 3.35, z + .1, m.black, 1);
    [m.signalRed, m.signalAmber, m.signalGreen].forEach((mat, i) => { const g = new THREE.CircleGeometry(.085, 12); b.add(g, mat, 1, T(x - s * .135, L + 3.18 - i * .27, z).multiply(RY(-s * Math.PI / 2))); g.dispose(); });
  });
  // Street name plates.
  both(s => {
    for (const [text, x, z, yaw] of [['MARINA AVENUE', 44.2, -18.6, 0], ['BROAD STREET', 50.8, -5.5, Math.PI / 2], ['HARBOUR ROAD', 44.2, 17.4, 0]] as [string, number, number, number][]) {
      b.post(s * x, z, L, L + 2.9, .035, m.steel, 6);
      const uv = signs.text(text, '#0f3d33', '#ffffff', 384, 64);
      for (const f of [0, Math.PI]) signPanel(b, signMat, uv, 1.5, .25, T(s * x, L + 2.75, z).multiply(RY(yaw + f)).multiply(T(.8, 0, .012)));
    }
  });
  b.force = null;

  // ---------------------------------------------------------------- light fittings
  // Station: tube fittings in rows along platforms and corridors (each row also lights the place: see the light pool).
  const tube = (x: number, y: number, z: number, alongX: boolean, where: Fixture['where'], color = '#eaf4ff') => {
    b.force = where; b.box(x - (alongX ? .62 : .07), y - .05, z - (alongX ? .07 : .62), x + (alongX ? .62 : .07), y, z + (alongX ? .07 : .62), where === 'shop' ? m.lampWarm : m.lampCool, 1);
    b.box(x - (alongX ? .68 : .1), y, z - (alongX ? .1 : .68), x + (alongX ? .68 : .1), y + .03, z + (alongX ? .1 : .68), m.white, 1); b.force = null;
    fixtures.push({ p: new THREE.Vector3(x, y - .25, z), where, color });
  };
  const ceil = L - .6 - .02;
  for (let x = -32; x <= 32; x += 4) { tube(x, ceil, -6.4, true, 'ug'); tube(x, ceil, -1, true, 'ug'); tube(x, ceil, 7.2, true, 'ug'); }
  both(s => {
    for (let z = -20; z <= -10; z += 3.4) tube(s * 32, ceil, z, false, 'ug'); for (let z = 10.5; z <= 20.5; z += 3.4) tube(s * 32, ceil, z, false, 'ug');
    for (const [x, z] of [[38, 13], [44, 13], [38, 19], [44, 19]]) tube(s * x, ceil, z, true, 'ug'); for (let x = 16; x <= 28; x += 4) tube(s * x, ceil, -13.5, true, 'ug');
    // Shops, offices, the gallery, the banking hall.
    for (const [x, z, y] of [[41, -37, 3.15], [34, -37, 3.15], [29.5, -37, 3.15], [41, -36, 6.65], [33, -37, 6.65], [18, -35.5, 3.15], [11, -35.5, 3.15], [14, -41, 3.15], [32, -14.5, 3.15], [25, -14.5, 3.15], [16.5, -14.5, 3.15], [11.5, -14.5, 3.15], [32, -14.5, 6.95], [22, -14.5, 6.95], [12, -14.5, 6.95], [39, -3.5, 3.95], [39, 3.5, 3.95], [32, -3.5, 3.95], [32, 3.5, 3.95], [55, 39, 3.15]]) tube(s * x, L + y, z, true, 'shop', '#ffe2bd');
  });
  for (const x of [-4, 4]) tube(x, L + 6.95, -14.5, true, 'shop', '#ffe2bd');
  // CCTV on the station concourse and the port gate.
  if (detail) both(s => { for (const [x, y, z, yaw] of [[33.4, 3.9, -8.6, 2.3], [12, 3.9, 8.6, -1], [13.6, L + 5.5, 21.6, 0]]) (y < L ? ugProps : props).place('camera' as PropKey, s * x, y, z, s > 0 ? yaw : Math.PI - yaw, 1.6, 1.6, 1.6); });
  // Loose stock and rubbish where nobody walks: alley corners, the warehouse walls, the car park corners.
  if (detail) both(s => {
    for (const [x, z] of [[25.2, -42.4], [22.6, -42.6]]) props.place('trashbag' as PropKey, s * x, L, z, hash(x, z) * 6, 1.1, 1.1, 1.1);
    for (const [x, z, n] of [[41.2, 23.2, 3], [15, 38.2, 2], [41.2, 38.2, 2]]) for (let i = 0; i < n; i++) props.place('cement' as PropKey, s * x, L + i * .16, z, hash(x, i) * .4, 1, 1, 1);
    props.place('handTruck' as PropKey, s * 15, L, 23.2, s * 1.2, 1, 1, 1);
    for (const [x, z] of [[47.4, 21.4], [34.6, 21.4]]) ugProps.place('cardboard' as PropKey, s * x, 1, z, hash(x, z) * 3, 1.2, 1.2, 1.2);
  });

  // ---------------------------------------------------------------- palms and shade trees
  const fronds = lib.extra['foliage/palm-frond.ktx2'], leaves = lib.extra['foliage/leaf-broad.ktx2'];
  for (const t of [fronds, leaves]) if (t) { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  const bark = m.bark, frondMat = fronds ? foliageMaterial(fronds, true) : null, leafMat = leaves ? foliageMaterial(leaves, false) : null;
  const palms = map.boxes.filter(x => x.mat === 'palm'), trees = map.boxes.filter(x => x.mat === 'tree');
  const plant = (list: typeof palms, grow: (i: number) => ReturnType<typeof growPalm>, mat: THREE.Material | null, variants: number, scaleOf: (i: number) => number) => {
    for (let v = 0; v < variants; v++) {
      const mine = list.filter((_, i) => i % variants === v); if (!mine.length) continue;
      const g = grow(v);
      const wood = new THREE.InstancedMesh(g.wood, bark, mine.length), crown = mat ? new THREE.InstancedMesh(g.leaves, mat, mine.length) : null;
      mine.forEach((box, i) => { const s = scaleOf(i + v), M = new THREE.Matrix4().compose(new THREE.Vector3((box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(box.min[0], box.min[2]) * 6.28), new THREE.Vector3(s, s, s)); wood.setMatrixAt(i, M); crown?.setMatrixAt(i, M); });
      wood.castShadow = true; wood.receiveShadow = true; wood.computeBoundingSphere(); objects.push(wood);
      if (crown && mat) { crown.castShadow = true; crown.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: (mat as THREE.MeshStandardMaterial).map, alphaTest: .42 }); crown.computeBoundingSphere(); objects.push(crown); }
    }
  };
  plant(palms, v => growPalm(v % 2 ? 'coconut' : 'royal', 11 + v, detail ? 1 : .6, false), frondMat, 2, i => .78 + (i % 3) * .05);
  plant(trees, v => growTree(v % 2 ? 'mango' : 'terminalia', 5 + v, detail ? 1 : .6, false), leafMat, 2, i => .62 + (i % 2) * .08);
  return { objects };
}

// ====================================================================================== beyond the site
/**
 * Distant towers: the façade is drawn by the shader in world space — 3.4 m storeys, bays, a frame around every window,
 * reflective glass (dark by day, so the sky shows in it through the image-based light), offices lit at random at
 * dusk and night (the material's emissive strength, set by the variant), and a style per material: punched windows
 * in concrete, ribbon glazing between spandrel bands, or a curtain wall.
 */
function skylineMaterial(style: number, color: string) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: .75, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0 });
  m.userData.fixed = true;
  m.onBeforeCompile = s => {
    s.uniforms.uStyle = { value: style };
    s.vertexShader = 'varying vec3 vTw; varying vec3 vTn;\n' + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vTw = (modelMatrix * vec4(transformed, 1.)).xyz; vTn = normalize(mat3(modelMatrix) * objectNormal);`);
    s.fragmentShader = `uniform float uStyle; varying vec3 vTw; varying vec3 vTn;
      float tH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n` + s.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float twin = 0., tlit = 0.;
        if (abs(vTn.y) < .5) {
          float u = abs(vTn.x) > abs(vTn.z) ? vTw.z : vTw.x, v = vTw.y - 5.;
          float bay = uStyle < .5 ? 2.6 : uStyle < 1.5 ? 1.6 : 1.5, storey = 3.4;
          vec2 cell = vec2(floor(u / bay), floor(v / storey)), f = vec2(fract(u / bay), fract(v / storey));
          vec2 lo = uStyle < .5 ? vec2(.22, .3) : uStyle < 1.5 ? vec2(.03, .34) : vec2(.03, .08), hi = uStyle < .5 ? vec2(.78, .8) : uStyle < 1.5 ? vec2(.97, .88) : vec2(.97, .94);
          // Anti-aliased window mask (it is mostly seen far away).
          vec2 w = fwidth(vec2(u / bay, v / storey)) * 1.2;
          vec2 inX = smoothstep(lo - w, lo + w, f) * (1. - smoothstep(hi - w, hi + w, f));
          twin = inX.x * inX.y * step(0., v);
          float r = tH(cell + floor(u / 31.) * 7.1);
          tlit = step(.62, r) * twin;
          diffuseColor.rgb = mix(diffuseColor.rgb * (.85 + .3 * tH(vec2(cell.y, floor(u / 40.)))), vec3(.02, .025, .03) + vec3(.03, .025, .02) * r, twin);
          roughnessFactor = mix(roughnessFactor, .08 + .1 * tH(cell + 3.), twin);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= tlit * (tH(vec2(floor(vTw.x), floor(vTw.y / 3.4))) > .5 ? vec3(1., .82, .55) : vec3(.8, .9, 1.)) * .9;`);
  };
  m.customProgramCacheKey = () => 'city-skyline';
  return m;
}

export function buildBackdrop(b: CityBuilder, m: CityMats, map: CityMap, detail: number, glows: Glow[], port: PortArt) {
  const L = map.street, [bx0, bz0, bx1, bz1] = map.bounds, objects: THREE.Object3D[] = [];
  const far = (g: THREE.BufferGeometry, mat: THREE.Material, M: THREE.Matrix4, scale = 6, keepUV = false) => { b.add(g, mat, scale, M, false, keepUV, CHUNK_FAR); g.dispose(); };
  const fbox = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material, scale = 6) => far(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), scale);
  b.force = 'out';
  // The ground beyond the walls: city blocks to the north, east and west, the quay apron to the south.
  fbox(bx0 - 400, L - .6, bz0 - 400, bx1 + 400, L - .02, bz0, m.yard, 6); fbox(bx0 - 400, L - .6, bz0, bx0, L - .02, bz1 + 9, m.yard, 6); fbox(bx1, L - .6, bz0, bx1 + 400, L - .02, bz1 + 9, m.yard, 6);
  fbox(bx0, L - 2.6, bz1, bx1, L - .02, bz1 + 9, m.concrete, 4); fbox(bx0 - 400, L - 2.6, bz1 + 8.6, bx1 + 400, L + .25, bz1 + 9, m.precast, 4);
  for (let x = bx0 + 6; x < bx1; x += 12) { far(new THREE.CylinderGeometry(.22, .3, .55, 10), m.black, T(x, L + .27, bz1 + 7.6)); }
  // Skyline: towers in three rings, nearer ones with modelled crowns, all with a window grid that lights up at night.
  const towers = [0, 1, 2].map(i => { const mat = skylineMaterial(i, ['#b9b4aa', '#c9bba3', '#8d9aa3'][i]); glows.push({ m: mat, day: 0, night: 1.3 }); return mat; });
  const tower = (x: number, z: number, w: number, d: number, h: number, k: number) => {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv as THREE.BufferAttribute, pos = g.attributes.position, nor = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) { const side = Math.abs(nor.getY(i)) > .5; uv.setXY(i, side ? 0 : (Math.abs(nor.getX(i)) > .5 ? pos.getZ(i) : pos.getX(i)) / 12, side ? 0 : pos.getY(i) / 24); }
    far(g, towers[k % 3], T(x, L + h / 2, z), 1, true);
    if (h > 50) { fbox(x - w * .3, L + h, z - d * .3, x + w * .3, L + h + 5, z + d * .3, m.curtain, 8); far(new THREE.CylinderGeometry(.15, .3, 12, 6), m.stainless, T(x, L + h + 11, z)); far(new THREE.BoxGeometry(.5, .5, .5), m.beacon, T(x, L + h + 17.2, z)); }
  };
  const n = detail ? 46 : 26;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 1.25 + Math.PI * .875, ring = i % 3, r = 105 + ring * 70 + hash(i, 4) * 40, x = Math.cos(a) * r * 1.25, z = Math.sin(a) * r * .95 - 30;
    if (z > bz1 - 20) continue;
    tower(x, z, 16 + hash(i, 1) * 16, 16 + hash(i, 2) * 14, 28 + hash(i, 3) * (40 + ring * 55), i);
  }
  // The port beyond the quay: ship-to-shore cranes over a container ship alongside, the far terminal's stacks and
  // gantries, floodlight masts (./port.ts).
  const portLights = buildPort(b, m, port, map.bounds, L, detail, m.lamp);
  // The ship, at the east berth under the third crane (the basin in front of the yard stays open water, so the low
  // southern sun is seen over it): hull, accommodation block, containers stacked on deck.
  const sx = 95, sz = bz1 + 38, hull = new THREE.BoxGeometry(150, 11, 22), hp = hull.attributes.position;
  for (let i = 0; i < hp.count; i++) { const x = hp.getX(i), y = hp.getY(i); if (y < 0) hp.setZ(i, hp.getZ(i) * .72); if (Math.abs(x) > 70) hp.setZ(i, hp.getZ(i) * .35); }
  hull.computeVertexNormals(); far(hull, m.flat('#1d2f45', { roughness: .55 }), T(sx, L - 1.5, sz), 6);
  fbox(sx - 75, L + 3.8, sz - 11, sx + 75, L + 4.2, sz + 11, m.red, 4); fbox(sx + 52, L + 4, sz - 9, sx + 64, L + 24, sz + 9, m.white, 4); fbox(sx + 55, L + 24, sz - 3, sx + 60, L + 29, sz + 3, m.orange, 4);
  const cols = ['container-blue', 'container-red', 'container-green', 'container-yellow'];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 3; j++) { const hgt = 2 + Math.floor(hash(i, j) * 4); for (let k = 0; k < hgt; k++) fbox(sx - 68 + i * 7.2, L + 4.2 + k * 2.6, sz - 9 + j * 6.2, sx - 68 + i * 7.2 + 6.9, L + 6.8 + k * 2.6, sz - 9 + j * 6.2 + 5.9, m.container(cols[Math.floor(hash(i * 3 + k, j * 5) * 4)]), 2); }
  // The bridge across the bay: a long low viaduct with a cable-stayed centre span.
  const bz = bz1 + 250;
  fbox(-520, L + 13, bz - 5, 520, L + 14.6, bz + 5, m.precast, 8);
  for (let x = -500; x <= 500; x += 40) fbox(x - 1.5, L - 3, bz - 3, x + 1.5, L + 13, bz + 3, m.concrete, 6);
  for (const x of [-60, 60]) { fbox(x - 2, L - 3, bz - 2, x + 2, L + 62, bz + 2, m.precast, 6); for (let k = 1; k <= 6; k++) for (const s of [-1, 1]) far(new THREE.CylinderGeometry(.12, .12, Math.hypot(k * 9, 44 - k * 2.5), 4), m.white, T(x + s * k * 4.5, L + 14.6 + (44 - k * 2.5) / 2 + k * 1.2, bz).multiply(new THREE.Matrix4().makeRotationZ(s * Math.atan2(k * 9, 44 - k * 2.5)))); }
  b.force = null;
  // The bay: a reflective sheet with slow swell (two moving normal octaves from a noise function).
  const sea = new THREE.MeshStandardMaterial({ color: '#27505c', roughness: .16, metalness: .55, envMapIntensity: 1.6 });
  sea.onBeforeCompile = s => {
    Object.assign(s.uniforms, cityTime);
    s.vertexShader = 'varying vec3 vSea;\n' + s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvSea = (modelMatrix * vec4(transformed, 1.)).xyz;');
    s.fragmentShader = `uniform float uTime; varying vec3 vSea;
      float sh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float sn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
      float swell(vec2 p){ return sn(p * .22 + uTime * vec2(.12, .07)) * .6 + sn(p * .71 - uTime * vec2(.21, .16)) * .3 + sn(p * 2.3 + uTime * .5) * .1; }\n` + s.fragmentShader
      .replace('#include <normal_fragment_maps>', `{ float e = .35; float h0 = swell(vSea.xz), hx = swell(vSea.xz + vec2(e, 0.)), hz = swell(vSea.xz + vec2(0., e));
        float fade = clamp(1. - length(vSea.xz - cameraPosition.xz) / 420., .15, 1.);
        normal = normalize((viewMatrix * vec4(normalize(vec3((h0 - hx) * 1.1 * fade, 1., (h0 - hz) * 1.1 * fade)), 0.)).xyz); }`);
  };
  sea.customProgramCacheKey = () => 'city-sea'; sea.userData.fixed = true;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 900).rotateX(-Math.PI / 2), sea); water.position.set(0, L - 2.2, bz1 + 9 + 450); water.receiveShadow = false; water.userData.chunk = CHUNK_FAR; water.name = 'bay';
  objects.push(water);
  // Traffic on the bridge: instanced cars, moved along the deck every frame (headlamps at night).
  const count = detail ? 26 : 12, carGeo = new THREE.BoxGeometry(4.4, 1.5, 1.9), cars = new THREE.InstancedMesh(carGeo, m.flat('#d9d9d4', { roughness: .4 }), count), lampGeo = new THREE.PlaneGeometry(1.7, .5);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff3cf', transparent: true, opacity: 0, depthWrite: false }); glows.push({ m: lampMat, day: 0, night: 1 });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
  for (let i = 0; i < count; i++) cars.setColorAt(i, new THREE.Color(['#d9d9d4', '#28303a', '#8c2f2a', '#e8c21c', '#f4f4f0', '#2f6f9f'][i % 6]));
  cars.frustumCulled = lamps.frustumCulled = false; cars.userData.chunk = lamps.userData.chunk = CHUNK_FAR; objects.push(cars, lamps);
  const M = new THREE.Matrix4();
  const traffic = (t: number) => {
    for (let i = 0; i < count; i++) {
      const dir = i % 2 ? 1 : -1, speed = 15 + (i % 5) * 2.2, x = ((((i * 83.7 + t * speed * dir) % 1000) + 1000) % 1000) - 500, z = bz + dir * 2.4;
      M.makeTranslation(x, L + 15.4, z); cars.setMatrixAt(i, M);
      M.makeRotationY(dir > 0 ? Math.PI / 2 : -Math.PI / 2).setPosition(x + dir * 2.25, L + 15.2, z); lamps.setMatrixAt(i, M);
    }
    cars.instanceMatrix.needsUpdate = true; lamps.instanceMatrix.needsUpdate = true;
  };
  traffic(0);
  void CHUNK_STATION; void RY;
  return { objects, traffic, portLights };
}
