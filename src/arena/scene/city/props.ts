// Everything that stands in Okun Bay's streets and rooms, drawn to fill its collision box exactly: vehicles, kiosks,
// shelters, planters, furniture, roof plant, station fittings, the spire and the fountain.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Props } from '../environment';
import type { Library, PropKey } from '../library';
import { buildVehicleModel } from '../../../world/vehicleModels';
import { CityBuilder, SignAtlas, signPanel, T, RY, hash, type Box, type CityMap } from './kit';
import type { CityMats } from './materials';
import type { Fixture } from './structure';
import { portContainer, type PortArt } from './port';

const wheel = (b: CityBuilder, m: CityMats, x: number, y: number, z: number, r: number, w: number, alongX: boolean) => {
  const g = new THREE.CylinderGeometry(r, r, w, 18), h = new THREE.CylinderGeometry(r * .55, r * .55, w + .02, 12);
  const M = T(x, y, z).multiply(alongX ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  b.add(g, m.rubber, 1, M); b.add(h, m.steel, 1, M); g.dispose(); h.dispose();
};

export function buildProps(b: CityBuilder, m: CityMats, lib: Library, map: CityMap, detail: number, signs: SignAtlas, signMat: THREE.Material, litMat: THREE.Material, fixtures: Fixture[], props: Props, ugProps: Props, port: PortArt) {
  const L = map.street;
  let kioskNo = 0, carNo = 0;
  const KIOSKS: [string, string, string, THREE.Material][] = [['NEWS & AIRTIME', '#14365c', '#ffffff', m.blue], ['FRESH JUICE', '#1f5d4a', '#f6e7b4', m.green], ['SUYA SPOT', '#8c2f2a', '#fff3dc', m.red], ['OKUN LOTTO', '#e0b21c', '#1d1f22', m.yellow], ['PHONE REPAIRS', '#2b2d30', '#ffb347', m.orange], ['PLAZA INFO', '#f4f4f0', '#14365c', m.white]];
  /** Local frame of a box: long axis `u`. Returns a matrix taking (u, y, v) to the world, centred on the box's base. */
  const frame = (box: Box) => { const [x0, y0, z0] = box.min, [x1, , z1] = box.max, alongX = x1 - x0 >= z1 - z0; return { M: T((x0 + x1) / 2, y0, (z0 + z1) / 2).multiply(RY(alongX ? 0 : -Math.PI / 2)), len: alongX ? x1 - x0 : z1 - z0, wid: alongX ? z1 - z0 : x1 - x0, alongX }; };
  const local = (M: THREE.Matrix4) => ({
    box: (u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, mat: THREE.Material, scale = 1) => { const g = new THREE.BoxGeometry(Math.max(1e-3, u1 - u0), Math.max(1e-3, y1 - y0), Math.max(1e-3, v1 - v0)); b.add(g, mat, scale, M.clone().multiply(T((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2))); g.dispose(); },
    rbox: (u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, mat: THREE.Material, r = .1) => { const g = new RoundedBoxGeometry(u1 - u0, y1 - y0, v1 - v0, 2, Math.min(r, (u1 - u0) / 2.1, (y1 - y0) / 2.1, (v1 - v0) / 2.1)); b.add(g, mat, 1, M.clone().multiply(T((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2))); g.dispose(); },
    wheel: (u: number, v: number, r: number, w = .28) => { const g = new THREE.CylinderGeometry(r, r, w, 16), h = new THREE.CylinderGeometry(r * .55, r * .55, w + .02, 10), X = M.clone().multiply(T(u, r, v)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); b.add(g, m.rubber, 1, X); b.add(h, m.steel, 1, X); g.dispose(); h.dispose(); },
    M,
  });
  void wheel;

  for (const box of map.boxes) {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, h = y1 - y0, seed = Math.abs(cx) * 7.1 + cz * 3.3 + y0;
    const ug = y0 < L - .5, P = ug ? ugProps : props;
    switch (box.mat) {
      // ------------------------------------------------------------ vehicles
      case 'car': {
        const model = buildVehicleModel(`metro-${carNo}`, 'car'), paint = m.bodies[(carNo++ + (cx > 0 ? 3 : 0)) % m.bodies.length];
        const yaw = w > d ? (hash(seed) > .5 ? Math.PI / 2 : -Math.PI / 2) : hash(seed) > .5 ? 0 : Math.PI;
        b.bake(model.root, T(cx, y0, cz).multiply(RY(yaw)), mat => (mat.name === 'paint' || mat.name.startsWith('paint') ? paint : mat));
        break;
      }
      case 'bus': {
        // An Okun Metro city bus: two-tone body, a glazed band, doors, a lit destination board.
        const f = frame(box), l = local(f.M), H = h, W = f.wid / 2, Ln = f.len / 2;
        l.rbox(-Ln, .34, -W, Ln, H, W, m.bodies[0], .22); l.box(-Ln + .02, .34, -W - .01, Ln - .02, 1.15, W + .01, m.blue, 2);
        l.box(-Ln + .5, 1.5, -W - .015, Ln - .7, 2.45, W + .015, m.glassDark, 2); l.box(Ln - .04, 1.35, -W + .15, Ln + .015, 2.55, W - .15, m.glassDark, 2);
        l.box(Ln - .02, 2.6, -W + .3, Ln + .02, 2.9, W - .3, m.led, 1); l.box(-Ln - .015, 1.6, -W + .3, -Ln + .02, 2.5, W - .3, m.glassDark, 1);
        for (const s of [-1, 1]) { l.box(Ln - .05, .7, s * (W - .45) - .16, Ln + .02, .95, s * (W - .45) + .16, m.headlamp, 1); l.box(-Ln - .02, .8, s * (W - .4) - .12, -Ln + .03, 1.1, s * (W - .4) + .12, m.taillamp, 1); for (const u of [-Ln + 2, Ln - 2.3]) l.wheel(u, s * (W - .16), .5, .3); }
        for (const u of [Ln - 1.9, -.4]) l.box(u, .4, W - .005, u + 1.2, 2.5, W + .02, m.frame, 1);
        // Window pillars, wheel arches, bumpers, the rear engine grille and a roof-mounted air-conditioning pod.
        for (let u = -Ln + .5; u < Ln - .7; u += 1.35) for (const s of [-1, 1]) l.box(u - .05, 1.5, s * W - .025, u + .05, 2.45, s * W + .025, m.black, 1);
        for (const s of [-1, 1]) for (const u of [-Ln + 2, Ln - 2.3]) l.box(u - .62, .3, s * W - .03, u + .62, 1.08, s * W + .03, m.black, 1);
        l.rbox(Ln - .12, .3, -W + .05, Ln + .06, .62, W - .05, m.black, .05); l.rbox(-Ln - .06, .3, -W + .05, -Ln + .12, .62, W - .05, m.black, .05);
        for (let k = 0; k < 6; k++) l.box(-Ln - .03, .72 + k * .1, -W + .5, -Ln + .01, .76 + k * .1, W - .5, m.darkSteel, 1);
        l.rbox(-Ln + .6, H, -W + .4, -Ln + 3.2, H + .26, W - .4, m.white, .08);
        signPanel(b, signMat, signs.text('OKUN METRO', '#f4f4f0', '#14365c', 512, 96, 'Route 12 · Marina – Port'), 3.4, .62, f.M.clone().multiply(T(-1.5, 1.05, -W - .02)).multiply(RY(Math.PI)));
        break;
      }
      case 'van': {
        const f = frame(box), l = local(f.M), W = f.wid / 2, Ln = f.len / 2, cab = Ln - 1.9;
        l.rbox(cab, .5, -W + .08, Ln, h * .72, W - .08, m.bodies[3], .2); l.box(cab + .5, h * .42, -W + .06, Ln + .012, h * .68, W - .06, m.glassDark, 1);
        l.rbox(-Ln, .75, -W, cab - .08, h, W, m.white, .05); l.box(-Ln + .2, .5, -W + .3, Ln - .5, .75, W - .3, m.darkSteel, 1);
        for (const s of [-1, 1]) { for (const u of [-Ln + 1.5, Ln - 1.1]) l.wheel(u, s * (W - .16), .42); l.box(Ln - .03, .7, s * (W - .4) - .13, Ln + .02, .92, s * (W - .4) + .13, m.headlamp, 1); l.box(-Ln - .02, .8, s * (W - .25) - .08, -Ln + .02, 1.1, s * (W - .25) + .08, m.taillamp, 1); }
        l.box(-Ln - .02, .8, -W + .12, -Ln + .01, h - .12, W - .12, m.shutter, 1.2);
        signPanel(b, signMat, signs.text('BAY LOGISTICS', '#f1ece2', '#b5402f', 512, 96, 'Port of Okun Bay'), 3, .6, f.M.clone().multiply(T(-1.2, h * .62, W + .012)));
        break;
      }
      case 'truck': {
        // A tractor unit and a skeletal trailer carrying a container (the container fills most of the box).
        const f = frame(box), l = local(f.M), W = f.wid / 2, Ln = f.len / 2, cab = Ln - 2.5, flip = hash(seed) > .5 ? 1 : 1;
        void flip;
        l.rbox(cab, .9, -W + .12, Ln - .02, 3.25, W - .12, m.bodies[(Math.floor(hash(seed) * 3) + 1) % m.bodies.length], .22); l.box(Ln - .5, 1.9, -W + .2, Ln, 2.9, W - .2, m.glassDark, 1);
        l.box(-Ln + .1, .95, -W + .45, cab + 1.2, 1.25, W - .45, m.darkSteel, 1);
        for (const s of [-1, 1]) { for (const u of [-Ln + 1.1, -Ln + 2.4, cab - .6, Ln - .9]) l.wheel(u, s * (W - .2), .52, .34); l.box(Ln - .04, 1.05, s * (W - .5) - .15, Ln + .01, 1.3, s * (W - .5) + .15, m.headlamp, 1); l.box(-Ln - .01, 1.0, s * (W - .4) - .1, -Ln + .03, 1.2, s * (W - .4) + .1, m.taillamp, 1); }
        const boxLen = Math.min(f.len - 3.2, 12.2), c0 = -Ln + .15;
        const world = new THREE.Box3(new THREE.Vector3(c0, 1.3, -1.22), new THREE.Vector3(c0 + boxLen, Math.max(1.4, h), 1.22)).applyMatrix4(f.M);
        portContainer(b, m, port, { min: world.min.toArray(), max: world.max.toArray(), mat: ['container-blue', 'container-red', 'container-green'][Math.floor(hash(seed, 2) * 3)] });
        break;
      }
      case 'pickup': {
        const f = frame(box), l = local(f.M), W = f.wid / 2, Ln = f.len / 2, paint = m.bodies[(Math.floor(hash(seed) * 5) + 2) % m.bodies.length];
        l.rbox(-Ln, .45, -W, Ln, 1.05, W, paint, .12); l.rbox(-.3, 1.0, -W + .06, Ln - 1.3, h, W - .06, paint, .18); l.box(-.25, 1.15, -W + .04, Ln - 1.35, h - .1, W - .04, m.glassDark, 1);
        l.box(-Ln + .12, 1.05, -W + .1, -.4, 1.12, W - .1, m.black, 1);
        for (const s of [-1, 1]) { for (const u of [-Ln + 1, Ln - 1]) l.wheel(u, s * (W - .14), .4); l.box(Ln - .03, .72, s * (W - .32) - .13, Ln + .015, .92, s * (W - .32) + .13, m.headlamp, 1); l.box(-Ln - .015, .75, s * (W - .14) - .06, -Ln + .02, 1, s * (W - .14) + .06, m.taillamp, 1); }
        break;
      }
      case 'forklift': {
        const f = frame(box), l = local(f.M), W = f.wid / 2, Ln = f.len / 2;
        l.rbox(-Ln, .3, -W, Ln - .9, 1.05, W, m.orange, .1); l.box(-Ln, 1.05, -W + .05, -Ln + .5, 1.3, W - .05, m.black, 1);
        for (const [u, v] of [[-Ln + .06, -W + .06], [-Ln + .06, W - .06], [.1, -W + .06], [.1, W - .06]]) l.box(u - .04, 1.05, v - .04, u + .04, h, v + .04, m.black, 1);
        l.box(-Ln, h - .06, -W, .2, h, W, m.black, 1); l.box(Ln - .9, .1, -W + .12, Ln - .8, h + .2, -W + .22, m.darkSteel, 1); l.box(Ln - .9, .1, W - .22, Ln - .8, h + .2, W - .12, m.darkSteel, 1);
        l.box(Ln - .8, .12, -.32, Ln, .17, -.2, m.steel, 1); l.box(Ln - .8, .12, .2, Ln, .17, .32, m.steel, 1);
        for (const s of [-1, 1]) { l.wheel(-Ln + .45, s * (W - .1), .26, .18); l.wheel(Ln - 1.2, s * (W - .1), .32, .2); }
        break;
      }
      // ------------------------------------------------------------ containers, crates, barriers
      case 'container-red': case 'container-blue': case 'container-yellow': case 'container-green': portContainer(b, m, port, box); break;
      case 'crate': {
        const layers = Math.max(1, Math.round(h / .75)), alongX = w >= d, len = alongX ? w : d, cols = Math.max(1, Math.round(len / 1.25));
        for (let l = 0; l < layers; l++) for (let i = 0; i < cols; i++) {
          const a = (alongX ? x0 : z0) + i * len / cols, e = a + len / cols, ya = y0 + l * h / layers, yb = ya + h / layers, key = (['crate', 'milCrate', 'oldCrate'] as PropKey[])[Math.floor(hash(a, ya) * 3)];
          if (alongX) P.fit(lib, key, a + .02, ya, z0 + .02, e - .02, yb, z1 - .02); else P.fit(lib, key, x0 + .02, ya, a + .02, x1 - .02, yb, e - .02);
        }
        break;
      }
      case 'barrier': { const alongX = w >= d, len = alongX ? w : d, n = Math.max(1, Math.round(len / 1.6)); for (let i = 0; i < n; i++) { const a = (alongX ? x0 : z0) + i * len / n, e = a + len / n; if (alongX) P.fit(lib, 'jersey', a, y0, z0, e, y1, z1); else P.fit(lib, 'jersey', x0, y0, a, x1, y1, e); } break; }
      // ------------------------------------------------------------ street furniture
      case 'kiosk': {
        if (ug) {
          // The station's ticket office: a glazed counter under a lit header.
          b.box(x0, y0, z0, x1, y0 + 1.05, z1, m.ugWall, 1.2); b.box(x0 + .04, y0 + 1.05, z0 + .04, x1 - .04, y1 - .45, z1 - .04, m.glassDark, 2); b.box(x0, y1 - .45, z0, x1, y1, z1, m.blue, 2);
          for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) b.box(px - .05, y0, pz - .05, px + .05, y1, pz + .05, m.stainless, 1);
          signPanel(b, litMat, signs.text('TICKETS', '#14365c', '#ffffff', 256, 64), w * .8, .32, T(cx, y1 - .22, z1 + .012)); signPanel(b, litMat, signs.text('TICKETS', '#14365c', '#ffffff', 256, 64), w * .8, .32, T(cx, y1 - .22, z0 - .012).multiply(RY(Math.PI)));
          break;
        }
        const [name, bg, fg, paint] = KIOSKS[kioskNo++ % KIOSKS.length], f = frame(box), l = local(f.M), W = f.wid / 2, Ln = f.len / 2;
        l.box(-Ln, 0, -W, Ln, .9, W, paint, 1.5); l.box(-Ln, .9, -W, Ln, h - .5, W, m.white, 1.5); l.box(-Ln + .15, .95, W - .02, Ln - .15, h - .62, W + .02, m.shutter, 1.2); l.box(-Ln - .12, h - .5, -W - .12, Ln + .12, h - .38, W + .5, m.frame, 1);
        l.box(-Ln - .04, h - .38, -W - .04, Ln + .04, h, W + .04, paint, 1.5); l.box(-Ln + .1, .88, W, Ln - .1, .94, W + .28, m.stainless, 1);
        for (const s of [1, -1]) signPanel(b, signMat, signs.text(name, bg, fg, 512, 96), f.len * .92, .36, f.M.clone().multiply(T(0, h - .19, s * (W + .045))).multiply(RY(s > 0 ? 0 : Math.PI)));
        break;
      }
      case 'guardhouse': {
        b.box(x0, y0, z0, x1, y0 + 1, z1, m.white, 2); b.box(x0 + .03, y0 + 1, z0 + .03, x1 - .03, y1 - .5, z1 - .03, m.glassDark, 2); b.box(x0 - .25, y1 - .5, z0 - .25, x1 + .25, y1 - .35, z1 + .25, m.blue, 2); b.box(x0, y1 - .35, z0, x1, y1, z1, m.white, 2);
        for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) b.box(px - .06, y0, pz - .06, px + .06, y1 - .35, pz + .06, m.blue, 1);
        signPanel(b, signMat, signs.text('PORT GATE 2', '#14365c', '#ffffff', 256, 64, 'Port of Okun Bay'), w * .9, .32, T(cx, y1 - .18, z0 - .012).multiply(RY(Math.PI))); signPanel(b, signMat, signs.text('PORT GATE 2', '#14365c', '#ffffff', 256, 64, 'Port of Okun Bay'), w * .9, .32, T(cx, y1 - .18, z1 + .012));
        break;
      }
      case 'shelter': {
        const f = frame(box), l = local(f.M), W = f.wid / 2, Ln = f.len / 2;
        for (const u of [-Ln + .06, Ln - .06]) for (const v of [-W + .06, W - .1]) l.box(u - .05, 0, v - .05, u + .05, h - .08, v + .05, m.frame, 1);
        l.box(-Ln - .15, h - .1, -W - .1, Ln + .15, h, W + .35, m.frame, 1); l.box(-Ln + .1, .35, -W + .02, Ln - .1, h - .25, -W + .08, m.glassDark, 2);
        l.box(-Ln + .3, .42, -W + .25, Ln - 1.2, .48, -W + .65, m.wood, 1); l.box(Ln - 1.04, .16, -W + .07, Ln - .06, h - .26, -W + .15, m.frame, 1);
        { const ads: [string, string, string, string, string][] = [['STAY CONNECTED', 'Unlimited 5G across Okun Bay', 'OKUN TELECOM', '#0f3d6e', '#1b8fbf'], ['TASTE THE COAST', 'Fresh from the lagoon every morning', 'KOLA CAFÉ', '#8c2f2a', '#e0862b'], ['BUILD YOUR FUTURE', 'Evening classes start Monday', 'BAYSIDE INSTITUTE', '#1f5d4a', '#88b04b']];
          const ad = ads[Math.floor(hash(seed) * ads.length)], uv = signs.poster(ad[0], ad[1], ad[2], ad[3], ad[4]);
          for (const sgn of [-1, 1]) signPanel(b, litMat, uv, .9, h - .5, f.M.clone().multiply(T(Ln - .55, (h - .1) / 2 + .03, -W + .11 + sgn * .045)).multiply(RY(sgn > 0 ? 0 : Math.PI))); }
        signPanel(b, signMat, signs.text('MARINA AVENUE', '#14365c', '#ffffff', 512, 96, 'Routes 4 · 12 · 31'), f.len * .7, .3, f.M.clone().multiply(T(0, h - .05 + .22, W + .2)));
        break;
      }
      case 'planter': {
        b.box(x0, y0, z0, x1, y1 - .06, z1, m.precast, 2); b.box(x0 - .04, y1 - .12, z0 - .04, x1 + .04, y1 - .04, z1 + .04, m.plaza, 2); b.box(x0 + .12, y1 - .06, z0 + .12, x1 - .12, y1, z1 - .12, m.soil, 1.5);
        // Low planting along the top (clipped hedge in long planters, shrubs in square ones).
        if (Math.max(w, d) > 4) b.rbox(x0 + .16, y1 - .02, z0 + .12, x1 - .16, y1 + .42, z1 - .12, m.hedge, .12, 1.2);
        else for (let i = 0; i < 4; i++) { const px = cx + (i % 2 ? .45 : -.45) * (w - .9), pz = cz + (i < 2 ? .45 : -.45) * (d - .9), r = .38 + hash(seed, i) * .16; b.rbox(px - r, y1 - .05, pz - r, px + r, y1 + r * 1.3, pz + r, m.hedge, r * .8, 1.2); }
        break;
      }
      case 'hedge': b.box(x0, y0, z0, x1, y0 + .55, z1, m.precast, 2); b.rbox(x0 + .04, y0 + .5, z0 + .04, x1 - .04, y1, z1 - .04, m.hedge, .14, 1.2); break;
      case 'bench': {
        if (!ug && h < .6 && lib.props.parkBench) { P.fit(lib, 'parkBench' as PropKey, x0, y0, z0, x1, y0 + .85, z1); break; }
        const f = frame(box), l = local(f.M), W = f.wid / 2, Ln = f.len / 2; l.box(-Ln, h - .07, -W, Ln, h, W, ug ? m.stainless : m.wood, 1); for (const u of [-Ln + .2, Ln - .2]) l.box(u - .04, 0, -W + .05, u + .04, h - .07, W - .05, m.darkSteel, 1);
        if (ug) l.box(-Ln, h, -W, Ln, h + .4, -W + .05, m.stainless, 1);
        break;
      }
      case 'bin': { const n = Math.max(1, Math.round(Math.max(w, d) / .7)); for (let i = 0; i < n; i++) { const px = w >= d ? x0 + (i + .5) * w / n : cx, pz = w >= d ? cz : z0 + (i + .5) * d / n; b.rbox(px - .3, y0, pz - .3, px + .3, y1 - .08, pz + .3, i % 2 ? m.green : m.blue, .06); b.box(px - .33, y1 - .08, pz - .33, px + .33, y1, pz + .33, m.black, 1); for (const s of [-1, 1]) b.box(px + s * .26 - .04, y0, pz + .22, px + s * .26 + .04, y0 + .14, pz + .3, m.rubber, 1); } break; }
      case 'bollard': b.post(cx, cz, y0, y1 - .05, Math.min(w, d) / 2 - .04, m.darkSteel, 14); b.post(cx, cz, y1 - .05, y1, Math.min(w, d) / 2, m.yellow, 14); b.post(cx, cz, y0 + h * .55, y0 + h * .7, Math.min(w, d) / 2 - .035, m.white, 14); break;
      case 'utility': b.rbox(x0, y0 + .08, z0, x1, y1, z1, m.steel, .04); b.box(x0 - .03, y0, z0 - .03, x1 + .03, y0 + .08, z1 + .03, m.concrete, 1); b.box(cx - .01, y0 + .15, z0 - .008, cx + .01, y1 - .1, z1 + .008, m.darkSteel, 1); b.box(x0 + .1, y1 - .3, z1, x0 + .32, y1 - .12, z1 + .008, m.yellow, 1); break;
      case 'lamppost': {
        // The column; the lantern arm reaches over the carriageway (toward the nearest road axis).
        b.post(cx, cz, y0, y0 + .9, .11, m.darkSteel, 10, .08); b.post(cx, cz, y0 + .9, y1 + 1.4, .08, m.darkSteel, 8, .05);
        const dz = Math.abs(cz + 25) < 6 ? Math.sign(-25 - cz) : Math.abs(cz - 14) < 5 ? Math.sign(14 - cz) : 0, dx = dz ? 0 : (Math.abs(cx) > 40 ? Math.sign(-cx) * -1 : hash(seed) > .5 ? 1 : -1), top = y1 + 1.35;
        b.cyl(new THREE.Vector3(cx, top, cz), new THREE.Vector3(cx + dx * 1.5, top + .12, cz + dz * 1.5), .035, m.darkSteel, 6);
        b.rbox(cx + dx * 1.5 - .16 - Math.abs(dx) * .22, top + .02, cz + dz * 1.5 - .16 - Math.abs(dz) * .22, cx + dx * 1.5 + .16 + Math.abs(dx) * .22, top + .16, cz + dz * 1.5 + .16 + Math.abs(dz) * .22, m.darkSteel, .05);
        b.box(cx + dx * 1.5 - .12 - Math.abs(dx) * .18, top, cz + dz * 1.5 - .12 - Math.abs(dz) * .18, cx + dx * 1.5 + .12 + Math.abs(dx) * .18, top + .025, cz + dz * 1.5 + .12 + Math.abs(dz) * .18, m.lamp, 1);
        fixtures.push({ p: new THREE.Vector3(cx + dx * 1.5, top - .3, cz + dz * 1.5), where: 'out', color: '#ffe2b4' });
        break;
      }
      // ------------------------------------------------------------ interiors
      case 'counter': b.box(x0, y0, z0, x1, y1 - .05, z1, m.wood, 1.5); b.box(x0 - .03, y1 - .05, z0 - .03, x1 + .03, y1, z1 + .03, m.stone, 1.5); b.box(x0 - .005, y0, z0 - .005, x1 + .005, y0 + .1, z1 + .005, m.black, 1); break;
      case 'desk': if (lib.props.officeDesk) P.fit(lib, 'officeDesk' as PropKey, x0, y0, z0, x1, y1, z1); else { b.box(x0, y1 - .04, z0, x1, y1, z1, m.wood, 1); b.box(x0 + .03, y0, z0 + .03, x0 + .5, y1 - .04, z1 - .03, m.steel, 1); b.box(x1 - .07, y0, z0 + .03, x1 - .03, y1 - .04, z1 - .03, m.steel, 1); } break;
      case 'table': { b.post(cx, cz, y0, y1 - .04, .05, m.darkSteel, 8); b.post(cx, cz, y0, y0 + .03, .3, m.darkSteel, 12); b.box(x0 + .1, y1 - .04, z0 + .1, x1 - .1, y1, z1 - .1, m.wood, 1); for (const [sx, sz] of [[1, 0], [-1, 0]]) props.place('monobloc' as PropKey, cx + sx * (w / 2 - .05), y0, cz + sz * .3, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 1, 1); break; }
      case 'shelf': case 'rack': {
        // Steel uprights and decks loaded with stock.
        const alongX = w >= d, len = alongX ? w : d, levels = Math.max(2, Math.round(h / .7)), up = m.blue, deck = box.mat === 'rack' ? m.orange : m.steel;
        for (let t = 0; t <= len + .01; t += len / Math.max(1, Math.round(len / 1.4))) for (const s of [0, 1]) { const px = alongX ? x0 + t : s ? x1 - .04 : x0 + .04, pz = alongX ? (s ? z1 - .04 : z0 + .04) : z0 + t; b.box(px - .035, y0, pz - .035, px + .035, y1, pz + .035, up, 1); }
        for (let k = 0; k < levels; k++) {
          const y = y0 + .12 + k * (h - .15) / levels; b.box(x0, y, z0, x1, y + .05, z1, deck, 1);
          for (let t = .15; t < len - .5; t += .62 + hash(seed, k * 9 + t) * .4) {
            const bw = .42 + hash(seed + t, k) * .3, bh = Math.min((h - .15) / levels - .1, .28 + hash(seed, t + k) * .32), mat = [m.wood, m.white, m.blue, m.red, m.yellow, m.plastic][Math.floor(hash(t, seed + k) * 6)];
            if (alongX) b.box(x0 + t, y + .05, z0 + .06, x0 + t + bw, y + .05 + bh, z1 - .06, mat, 1); else b.box(x0 + .06, y + .05, z0 + t, x1 - .06, y + .05 + bh, z0 + t + bw, mat, 1);
          }
        }
        break;
      }
      case 'cabinet': b.rbox(x0, y0, z0, x1, y1, z1, m.steel, .03); { const alongX = w >= d, n = Math.max(1, Math.round((alongX ? w : d) / .5)); for (let i = 1; i < n; i++) { if (alongX) b.box(x0 + i * w / n - .006, y0 + .05, z0 - .004, x0 + i * w / n + .006, y1 - .05, z1 + .004, m.darkSteel, 1); else b.box(x0 - .004, y0 + .05, z0 + i * d / n - .006, x1 + .004, y1 - .05, z0 + i * d / n + .006, m.darkSteel, 1); } } break;
      case 'partition': b.box(x0, y0 + .1, z0, x1, y1, z1, m.glassDark, 1); b.box(x0, y0, z0 - .01, x1, y0 + .1, z1 + .01, m.frame, 1); b.box(x0, y1, z0 - .01, x1, y1 + .04, z1 + .01, m.frame, 1); break;
      case 'sofa': if (lib.props.sofa) P.fit(lib, 'sofa' as PropKey, x0, y0, z0, x1, y1, z1); else b.rbox(x0, y0, z0, x1, y1, z1, m.blue, .15); break;
      case 'atm': case 'vending': {
        const paint = box.mat === 'atm' ? m.green : hash(seed) > .5 ? m.red : m.blue; b.rbox(x0, y0, z0, x1, y1, z1, paint, .04);
        // The lit front faces the open side (the larger room beyond the nearest wall).
        const alongX = w >= d; if (alongX) { const s = ug ? (cz < -6 ? 1 : cz > 6 ? -1 : 1) : 1; b.box(x0 + .08, y0 + h * .35, s > 0 ? z1 : z0 - .012, x1 - .08, y1 - .12, s > 0 ? z1 + .012 : z0, m.led, 1); } else { const s = cx < 0 ? (hash(seed, 2) > 0 ? 1 : -1) : -1; b.box(s > 0 ? x1 : x0 - .012, y0 + h * .35, z0 + .08, s > 0 ? x1 + .012 : x0, y1 - .12, z1 - .08, m.led, 1); b.box(s > 0 ? x0 - .012 : x1, y0 + h * .35, z0 + .08, s > 0 ? x0 : x1 + .012, y1 - .12, z1 - .08, m.led, 1); }
        break;
      }
      case 'faregate': b.rbox(x0, y0, z0, x1, y1, z1, m.stainless, .05); b.box(x0 - .004, y1 - .2, z0 + .1, x1 + .004, y1 - .08, z0 + .3, m.signalGreen, 1); break;
      case 'switchgear': b.rbox(x0, y0, z0, x1, y1, z1, m.steel, .03); for (let z = z0 + .25; z < z1 - .2; z += .6) { b.box(x1, y0 + .2, z, x1 + .01, y1 - .2, z + .5, m.darkSteel, 1); b.box(x1 + .01, y1 - .5, z + .2, x1 + .018, y1 - .42, z + .3, m.signalGreen, 1); } break;
      // ------------------------------------------------------------ columns
      case 'column': if (w < .6) b.post(cx, cz, y0, y1, w / 2, m.steel, 12); else { b.post(cx, cz, y0, y1, w / 2 - .04, m.precast, 20); b.box(x0, y0, z0, x1, y0 + .25, z1, m.stone, 1); b.box(x0, y1 - .22, z0, x1, y1, z1, m.precast, 1); } break;
      case 'ug-column': b.box(x0, y0, z0, x1, y1, z1, m.ugWall, 1.2); b.box(x0 - .012, y0, z0 - .012, x1 + .012, y0 + .9, z1 + .012, m.stainless, 1); b.box(x0 - .012, y0 + 1.5, z0 - .012, x1 + .012, y0 + 1.95, z1 + .012, m.blue, 1); break;
      case 'ug-room': b.box(x0, y0, z0, x1, y1, z1, m.ugWall, 1.2); b.box(x0 + .5, y0 + 1, z1, x1 - .5, y0 + 2, z1 + .02, m.glassDark, 1); b.box(x0 + .4, y0 + 2.2, z1, x1 - .4, y0 + 2.6, z1 + .03, m.blue, 1); signPanel(b, litMat, signs.text('STATION CONTROL', '#14365c', '#ffffff', 512, 64), w - 1, .34, T(cx, y0 + 2.4, z1 + .035)); b.box(x0 - .02, y0 + 1.2, cz - .5, x0, y0 + 2.2, cz + .5, m.led, 1); b.box(x1, y0 + 1.2, cz - .5, x1 + .02, y0 + 2.2, cz + .5, m.led, 1); break;
      // ------------------------------------------------------------ roofs
      case 'tank': {
        // A ribbed polyethylene water tank on a steel stand: on every roof in the city.
        const r = Math.min(w, d) / 2 - .05, stand = .55, body = h - stand - .25, pts: THREE.Vector2[] = [];
        for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(r * (1 - .02 * Math.cos(t * Math.PI * 10)) * (t > .93 ? 1 - (t - .93) * 3 : 1), t * body)); }
        pts.push(new THREE.Vector2(r * .35, body + .2), new THREE.Vector2(0, body + .24));
        const g = new THREE.LatheGeometry(pts, 20); b.add(g, hash(seed) > .7 ? m.green : m.tank, 1, T(cx, y0 + stand, cz)); g.dispose();
        b.box(x0 + .05, y0 + stand - .08, z0 + .05, x1 - .05, y0 + stand, z1 - .05, m.steel, 1); for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.box(cx + sx * (r - .05) - .04, y0, cz + sz * (r - .05) - .04, cx + sx * (r - .05) + .04, y0 + stand, cz + sz * (r - .05) + .04, m.steel, 1);
        b.cyl(new THREE.Vector3(cx + r, y0 + stand + .15, cz), new THREE.Vector3(cx + r + .12, y0 + .05, cz), .025, m.plastic, 6);
        break;
      }
      case 'ac': if (lib.props.aircon) props.fit(lib, 'aircon' as PropKey, x0, y0 + .1, z0, x1, y1, z1); else b.rbox(x0, y0 + .1, z0, x1, y1, z1, m.white, .04); b.box(x0, y0, z0 + .1, x1, y0 + .1, z0 + .2, m.steel, 1); b.box(x0, y0, z1 - .2, x1, y0 + .1, z1 - .1, m.steel, 1); break;
      case 'vent': b.box(x0, y0, z0, x1, y1 - .3, z1, m.steel, 1.5); for (let y = y0 + .15; y < y1 - .4; y += .12) b.box(x0 - .012, y, z0 + .1, x1 + .012, y + .05, z1 - .1, m.darkSteel, 1); b.post(cx - w * .22, cz, y1 - .3, y1, .22, m.steel, 12, .3); b.post(cx + w * .22, cz, y1 - .3, y1, .22, m.steel, 12, .3); break;
      case 'plant': b.box(x0, y0, z0, x1, y1 - .12, z1, m.cladding, 3); b.box(x0 - .08, y1 - .12, z0 - .08, x1 + .08, y1, z1 + .08, m.steel, 1); for (let y = y0 + .4; y < y1 - .5; y += .14) b.box(x0 + .2, y, z1, x1 - .2, y + .06, z1 + .02, m.darkSteel, 1); b.box(x0 - .02, y0, cz - .45, x0, y0 + 2, cz + .45, m.steel, 1); break;
      // ------------------------------------------------------------ plaza, station entrances, transit
      case 'plinth': b.box(x0, y0, z0, x1, y1, z1, m.plaza, 2); b.box(x0 + .5, y1, z0 + .5, x1 - .5, y1 + .18, z1 - .5, m.stone, 2); break;
      case 'spire': {
        // The Okun Spire: a twisting bronze blade rising from a stone drum, a ring two-thirds up, a light at the tip.
        const H = h + 4, seg = 28, g = new THREE.CylinderGeometry(.12, w / 2 - .08, H, 4, seg, false), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const y = p.getY(i) / H + .5, a = y * Math.PI * .9, x = p.getX(i), z = p.getZ(i); p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), p.getY(i), x * Math.sin(a) + z * Math.cos(a)); }
        g.computeVertexNormals(); b.add(g, m.bronze, 1, T(cx, y0 + H / 2, cz)); g.dispose();
        b.post(cx, cz, y0 - .3, y0 + .5, w / 2 + .15, m.stone, 24);
        const ring = new THREE.TorusGeometry(1.5, .07, 8, 40); b.add(ring, m.stainless, 1, T(cx, y0 + H * .62, cz).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - .25))); ring.dispose();
        b.post(cx, cz, y0 + H, y0 + H + .3, .1, m.lamp, 8);
        break;
      }
      case 'fountain-wall': {
        // One segment of the ring: a stone seat wall, its inner face toward the fountain.
        const a = Math.atan2(cz - 2.4, cx), g = new THREE.CylinderGeometry(6.2, 6.2, h, 10, 1, false, -Math.PI / 2 - a - .2, .4), gi = new THREE.CylinderGeometry(4.75, 4.75, h, 10, 1, false, -Math.PI / 2 - a - .23, .46);
        void g; void gi;
        const M = T(cx, y0, cz).multiply(RY(-a + Math.PI / 2)), seat = new THREE.BoxGeometry(2.5, h - .08, 1.5), cap = new THREE.BoxGeometry(2.62, .08, 1.62);
        b.add(seat, m.stone, 2, M.clone().multiply(T(0, (h - .08) / 2, 0))); b.add(cap, m.plaza, 2, M.clone().multiply(T(0, h - .04, 0))); seat.dispose(); cap.dispose(); g.dispose(); gi.dispose();
        break;
      }
      case 'headhouse': {
        // The back wall of a station entrance: stone, the line's roundel and the station name, a glazed canopy over the stair.
        b.box(x0, y0, z0, x1, y1, z1, m.stone, 2); b.box(x0 - .04, y1, z0 - .04, x1 + .04, y1 + .1, z1 + .04, m.frame, 1);
        const alongZ = d > w, east = alongZ ? (Math.abs(cx) > 20 ? cx > 0 ? -1 : 1 : cx > 0 ? 1 : -1) : 1;
        // The stair runs away from this wall along x; the sign faces down the stair and the canopy covers it.
        const stairDir = Math.abs(cx) > 20 ? (cx < 0 ? 1 : -1) : (cx < 0 ? -1 : 1);
        void east;
        for (const s of [-1, 1]) { const uv = signs.slot(512, 128, (g2, W, H) => { g2.fillStyle = '#14365c'; g2.fillRect(0, 0, W, H); g2.fillStyle = '#fff'; g2.beginPath(); g2.arc(64, H / 2, 44, 0, 7); g2.fill(); g2.fillStyle = '#d9372b'; g2.font = '800 62px "Manrope Variable", sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('M', 64, H / 2 + 4); g2.fillStyle = '#fff'; g2.textAlign = 'left'; g2.font = '800 50px "Manrope Variable", sans-serif'; g2.fillText('Plaza Station', 128, H * .42); g2.font = '600 24px "Manrope Variable", sans-serif'; g2.fillText('Okun Metro · Blue Line', 130, H * .78); });
          signPanel(b, litMat, uv, d - .5, (d - .5) / 4, T(s > 0 ? x1 + .012 : x0 - .012, y1 - .55, cz).multiply(RY(s > 0 ? Math.PI / 2 : -Math.PI / 2))); }
        const len = 8.2, xa = stairDir > 0 ? x1 : x0 - len, xb = xa + len;
        b.force = 'out';
        for (const z of [z0 + .1, z1 - .1]) { for (let x = xa + .3; x < xb; x += 2.6) b.box(x - .04, L, z - .04, x + .04, y1 + .1, z + .04, m.frame, 1); b.box(xa, y1 + .04, z - .04, xb, y1 + .12, z + .04, m.frame, 1); }
        b.box(xa, y1 + .12, z0 - .15, xb, y1 + .15, z1 + .15, m.glass, 1); for (let x = xa; x <= xb + .01; x += len / 4) b.box(x - .03, y1 + .1, z0 - .15, x + .03, y1 + .17, z1 + .15, m.frame, 1);
        b.force = null;
        break;
      }
      case 'art-wall': {
        b.box(x0, y0, z0, x1, y1, z1, m.precast, 2);
        // A tiled mural in indigo and ochre: interlocking triangles and bands (drawn, not sampled from any artwork).
        const uv = signs.slot(512, 384, (g2, W, H) => { g2.fillStyle = '#17325a'; g2.fillRect(0, 0, W, H); const cols = ['#e0b21c', '#f1ece2', '#b5402f', '#2f6f9f', '#1f5d4a']; for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) { const x = c * 64, y = r * 64, k = (r * 3 + c * 5) % cols.length; g2.fillStyle = cols[k]; g2.beginPath(); if ((r + c) % 2) { g2.moveTo(x + 4, y + 60); g2.lineTo(x + 32, y + 4); g2.lineTo(x + 60, y + 60); } else { g2.moveTo(x + 4, y + 4); g2.lineTo(x + 60, y + 4); g2.lineTo(x + 32, y + 60); } g2.closePath(); g2.fill(); if (r % 3 === 1) { g2.fillStyle = '#17325a'; g2.beginPath(); g2.arc(x + 32, y + 36, 9, 0, 7); g2.fill(); } } });
        for (const s of [-1, 1]) signPanel(b, signMat, uv, d - .2, h - .3, T(s > 0 ? x1 + .012 : x0 - .012, y0 + h / 2 + .05, cz).multiply(RY(s > 0 ? Math.PI / 2 : -Math.PI / 2)));
        break;
      }
      case 'brt-platform': b.box(x0, y0, z0, x1, y1, z1, m.plaza, 2); b.box(x0, y1, z0, x1, y1 + .006, z0 + .3, m.tactile, .6); b.box(x0, y1, z1 - .3, x1, y1 + .006, z1, m.tactile, .6); break;
      case 'brt-screen': {
        // Opaque backlit panels in a steel frame (advertising and the line map).
        b.box(x0, y0, z0, x1, y1, z1, m.frame, 1); const alongX = w >= d;
        const uv = alongX ? signs.text('BRT · MARINA STATION', '#0d1b2a', '#ffb347', 512, 96, 'Okun Tower  ·  Central Plaza  ·  Port Gate 2') : signs.text('OKUN METRO', '#14365c', '#ffffff', 256, 128, 'Next: Port Gate 2');
        if (alongX) for (const s of [-1, 1]) signPanel(b, litMat, uv, w - .3, Math.min(h - .4, (w - .3) / 5.3), T(cx, y0 + h * .62, s > 0 ? z1 + .012 : z0 - .012).multiply(RY(s > 0 ? 0 : Math.PI)));
        else for (const s of [-1, 1]) signPanel(b, litMat, uv, d - .3, (d - .3) / 2, T(s > 0 ? x1 + .012 : x0 - .012, y0 + h * .58, cz).multiply(RY(s > 0 ? Math.PI / 2 : -Math.PI / 2)));
        break;
      }
    }
  }
}
