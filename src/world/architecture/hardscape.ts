import * as THREE from 'three';
import { rng, wasteBin } from './kit';
import { bench, type BuildContext } from './buildings';
import { BENCHES } from '../../../shared/interactions.mjs';
import { sign } from './signage';
import { PATHS, SURFACE_Y, PLAZA, PITCH, COURT, type PathRect } from '../layout';

const MATERIAL = { pavers: 'pavers', paversGrey: 'paversGrey', granite: 'granite', asphalt: 'asphalt' } as const;

/** Subtract covered spans from [a,b] and return what remains. */
function subtract(a: number, b: number, cuts: [number, number][]) {
  let spans: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts) spans = spans.flatMap(([s0, s1]) => c1 <= s0 || c0 >= s1 ? [[s0, s1]] : [[s0, Math.max(s0, c0)], [Math.min(s1, c1), s1]].filter(([p, q]) => q - p > .05) as [number, number][]);
  return spans;
}

function kerbs(c: BuildContext, p: PathRect) {
  const { kit } = c, road = p.kerb === 'road', w = road ? .22 : .14, top = road ? .16 : SURFACE_Y[p.mat] + .04;
  const others = PATHS.filter(o => o !== p);
  const edge = (horizontal: boolean, fixed: number, from: number, to: number, outward: number) => {
    const cuts: [number, number][] = [];
    for (const o of others) {
      const coversLine = horizontal ? fixed + outward * w / 2 > o.z0 && fixed + outward * w / 2 < o.z1 : fixed + outward * w / 2 > o.x0 && fixed + outward * w / 2 < o.x1;
      if (coversLine) cuts.push(horizontal ? [o.x0, o.x1] : [o.z0, o.z1]);
    }
    for (const g of p.gaps ?? []) if (p[g.edge] === fixed && (g.edge[0] === 'z') === horizontal) cuts.push([g.from, g.to]);
    const d = horizontal ? Math.abs(fixed - PLAZA.z) : Math.abs(fixed - PLAZA.x);
    if (d < PLAZA.r + .3) { const h = Math.sqrt((PLAZA.r + .3) ** 2 - d * d), center = horizontal ? PLAZA.x : PLAZA.z; cuts.push([center - h, center + h]); }
    for (const [s0, s1] of subtract(from, to, cuts)) {
      if (road) {
        for (let s = s0; s < s1 - .01; s += 1) {
          const e = Math.min(s1, s + 1), mid = (s + e) / 2, alt = Math.floor(s) % 2 === 0 ? 'paintWhite' : 'paintDark';
          kit.box(alt, horizontal ? [mid, top / 2, fixed + outward * w / 2] : [fixed + outward * w / 2, top / 2, mid], horizontal ? [e - s, top, w] : [w, top, e - s]);
        }
      } else kit.box('brushed', horizontal ? [(s0 + s1) / 2, top / 2, fixed + outward * w / 2] : [fixed + outward * w / 2, top / 2, (s0 + s1) / 2], horizontal ? [s1 - s0, top, w] : [w, top, s1 - s0], { shadow: false });
    }
  };
  edge(true, p.z0, p.x0 - w, p.x1 + w, -1); edge(true, p.z1, p.x0 - w, p.x1 + w, 1);
  edge(false, p.x0, p.z0, p.z1, -1); edge(false, p.x1, p.z0, p.z1, 1);
}

export function buildHardscape(c: BuildContext) {
  const { kit } = c, rand = rng(5);
  for (const p of PATHS) {
    const y = SURFACE_Y[p.mat];
    kit.box(MATERIAL[p.mat], [(p.x0 + p.x1) / 2, (y - .08) / 2, (p.z0 + p.z1) / 2], [p.x1 - p.x0, y + .08, p.z1 - p.z0], { shadow: false });
    if (p.kerb !== 'none') kerbs(c, p);
  }

  // The Confluence: hexagonal paving, granite bands, a fountain pool and the bronze landmark.
  const flat = (g: THREE.BufferGeometry, y: number) => g.rotateX(-Math.PI / 2).translate(PLAZA.x, y, PLAZA.z);
  kit.add('hexPaving', flat(new THREE.CircleGeometry(PLAZA.r, 96), SURFACE_Y.plaza), { shadow: false });
  kit.add('granite', flat(new THREE.RingGeometry(PLAZA.r - .3, PLAZA.r, 96, 1), SURFACE_Y.plaza + .006), { shadow: false });
  kit.add('granite', flat(new THREE.RingGeometry(9.6, 9.95, 96, 1), SURFACE_Y.plaza + .004), { shadow: false });
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; kit.box('bronze', [Math.cos(a) * 9.78, SURFACE_Y.plaza + .006, Math.sin(a) * 9.78], [.6, .01, .05], { rotY: -a, shadow: false }); }
  const rim = new THREE.LatheGeometry([[5.85, 0], [5.85, .42], [5.92, .5], [6.28, .5], [6.36, .44], [6.36, 0]].map(([x, y]) => new THREE.Vector2(x, y)), 96);
  kit.add('granite', rim.translate(0, SURFACE_Y.plaza, 0));
  kit.add('poolTile', flat(new THREE.CircleGeometry(5.86, 64), SURFACE_Y.plaza + .02), { shadow: false });
  kit.cylinder('concrete', [0, 0, 0], 2.75, 3.0, .95, 48);
  kit.cylinder('granite', [0, .95, 0], 2.9, 2.9, .08, 48);
  for (const v of [-1, 1]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(3, .34, 24, 160, Math.PI * 1.8), undefined);
    arc.rotation.set(.25 * v, .3 * v, .55 * v); arc.position.y = 5; arc.updateMatrix();
    kit.add('bronze', arc.geometry, { matrix: arc.matrix, keepUV: true });
  }
  kit.add('bronze', new THREE.SphereGeometry(.7, 32, 20).translate(0, 6, 0), { keepUV: true });
  c.signs.push(kit.place(sign({ text: 'THE CONFLUENCE', kind: 'letters', width: 4.2, height: .4, color: '#c19256' }), [0, .5, 3.0]));

  // Roads: lane markings, a zebra crossing at the gate and a speed bump on the apron.
  for (let x = -90; x < 87; x += 9) if (Math.abs(x + 1.5) > 9) kit.box('lineWhite', [x + 1.5, SURFACE_Y.asphalt + .003, 55.55], [3, .006, .14], { shadow: false });
  kit.box('lineWhite', [0, SURFACE_Y.asphalt + .003, 52.1], [180, .006, .12], { shadow: false });
  // The south edge line breaks for the avenue junction and the car park.
  for (const [a, b] of [[-90, -10], [31, 90]]) kit.box('lineWhite', [(a + b) / 2, SURFACE_Y.asphalt + .003, 59.0], [b - a, .006, .12], { shadow: false });
  for (let z = 52.4; z < 58.9; z += 1) kit.box('lineWhite', [0, SURFACE_Y.asphalt + .004, z], [3.4, .006, .5], { shadow: false });
  for (let x = -59; x < -7; x += 5) kit.box('paintYellow', [x + 1.2, SURFACE_Y.asphalt + .003, 45.75], [2.4, .006, .12], { shadow: false });
  for (let i = 0; i < 12; i++) kit.box(i % 2 ? 'paintYellow' : 'paintDark', [-5.85 + i * 1.065, SURFACE_Y.asphalt, 46.4], [1.065, .14, .5], { shadow: false });
  for (const [a, b] of [[-59.5, -36.5]]) { kit.box('paintYellow', [(a + b) / 2, SURFACE_Y.asphalt + .003, 38.5], [b - a, .006, .12], { shadow: false }); kit.box('paintYellow', [(a + b) / 2, SURFACE_Y.asphalt + .003, 42.9], [b - a, .006, .12], { shadow: false }); }
  const bus = sign({ text: 'BUS STOP', kind: 'letters', width: 5, height: 1.2, color: '#e2b440', metalness: 0, roughness: .8 });
  bus.castShadow = false; bus.position.set(-48, SURFACE_Y.asphalt + .006, 40.7); bus.rotation.set(-Math.PI / 2, 0, 0); c.signs.push(bus);

  sports(c, rand);
  scatter(c, rand);
}

function sports(c: BuildContext, rand: () => number) {
  const { kit } = c, y = .03;
  // Acrylic basketball court on a rubberised surround.
  kit.box('courtGreen', [(COURT.x0 + COURT.x1) / 2, y / 2, (COURT.z0 + COURT.z1) / 2], [COURT.x1 - COURT.x0 - .2, y, COURT.z1 - COURT.z0 - .2], { shadow: false });
  const cx = 44, cz = 24, W = 15, L = 28;
  kit.box('courtBlue', [cx, y + .003, cz], [W, .006, L], { shadow: false });
  const line = (x0: number, z0: number, x1: number, z1: number) => kit.box('lineWhite', [(x0 + x1) / 2, y + .007, (z0 + z1) / 2], [Math.max(.05, Math.abs(x1 - x0)), .004, Math.max(.05, Math.abs(z1 - z0))], { shadow: false });
  line(cx - W / 2, cz - L / 2, cx + W / 2, cz - L / 2); line(cx - W / 2, cz + L / 2, cx + W / 2, cz + L / 2); line(cx - W / 2, cz - L / 2, cx - W / 2, cz + L / 2); line(cx + W / 2, cz - L / 2, cx + W / 2, cz + L / 2); line(cx - W / 2, cz, cx + W / 2, cz);
  const ring = (r0: number, r1: number, z: number, start = 0, len = Math.PI * 2) => kit.add('lineWhite', new THREE.RingGeometry(r0, r1, 64, 1, start, len).rotateX(-Math.PI / 2).translate(cx, y + .008, z), { shadow: false });
  ring(1.775, 1.825, cz);
  for (const s of [-1, 1]) {
    const base = cz + s * L / 2, hoop = base - s * 1.575;
    line(cx - 2.45, base, cx - 2.45, base - s * 5.8); line(cx + 2.45, base, cx + 2.45, base - s * 5.8); line(cx - 2.45, base - s * 5.8, cx + 2.45, base - s * 5.8);
    kit.box('courtRed', [cx, y + .005, base - s * 2.9], [4.85, .004, 5.75], { shadow: false });
    ring(1.775, 1.825, base - s * 5.8, s > 0 ? 0 : Math.PI, Math.PI);
    ring(6.725, 6.775, hoop, s > 0 ? .28 : Math.PI + .28, Math.PI - .56);
    for (const dx of [-6.6, 6.6]) line(cx + dx, base, cx + dx, base - s * 2.99);
    // Hoop: padded pole, arm, glass backboard, rim and net.
    const pole = base + s * 1.0;
    kit.box('paintDark', [cx, 1.6, pole], [.18, 3.2, .18]).box('paintTerracotta', [cx, .9, pole], [.26, 1.8, .26]).box('paintDark', [cx, 3.2, (pole + base - s * 1.2) / 2], [.12, .12, Math.abs(pole - (base - s * 1.2))]);
    kit.box('glassClear', [cx, 3.35, base - s * 1.2], [1.8, 1.05, .03], { shadow: false });
    for (const [bx, by, bw, bh] of [[0, 3.35 + .51, 1.8, .04], [0, 3.35 - .51, 1.8, .04], [-.88, 3.35, .04, 1.05], [.88, 3.35, .04, 1.05], [0, 3.17, .59, .03], [0, 3.62, .59, .03], [-.28, 3.4, .03, .45], [.28, 3.4, .03, .45]]) kit.box('paintWhite', [cx + bx, by, base - s * 1.215], [bw, bh, .02]);
    kit.add('paintTerracotta', new THREE.TorusGeometry(.225, .012, 8, 32).rotateX(Math.PI / 2).translate(cx, 3.05, hoop), { keepUV: true });
    c.hoopNets.push({ x: cx, z: hoop });
  }
  // Chain-link cage matching the shared colliders.
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= n; i++) kit.cylinder('steel', [x0 + (x1 - x0) * i / n, 0, z0 + (z1 - z0) * i / n], .035, .035, 3.5, 8);
    kit.add('steel', new THREE.CylinderGeometry(.025, .025, len, 6).rotateZ(Math.PI / 2).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, 3.48, (z0 + z1) / 2), { keepUV: true });
    c.chainLink.push({ x0, z0, x1, z1, height: 3.45 });
  };
  fence(COURT.x0, COURT.z0, COURT.x1, COURT.z0); fence(COURT.x1, COURT.z0, COURT.x1, COURT.z1); fence(COURT.x0, COURT.z1, COURT.x1, COURT.z1);
  fence(COURT.x0, COURT.z0, COURT.x0, 15.4); fence(COURT.x0, 31.5, COURT.x0, COURT.z1);
  // Aluminium bleachers and floodlights.
  for (let tier = 0; tier < 4; tier++) {
    kit.box('aluminium', [57.4 + tier * .7, .42 + tier * .42, 24], [.5, .04, 14]).box('aluminium', [57.65 + tier * .7, .2 + tier * .42, 24], [.04, .4, 14], { shadow: false });
  }
  for (let z = 17; z <= 31; z += 3.5) for (let tier = 0; tier < 4; tier++) kit.box('steel', [57.4 + tier * .7, (.42 + tier * .42) / 2, z], [.05, .42 + tier * .42, .05]);
  for (const [x, z] of [[33.2, 9.2], [54.8, 9.2], [33.2, 38.8], [54.8, 38.8]]) { kit.cylinder('steel', [x, 0, z], .09, .14, 9.5, 10); kit.box('darkMetal', [x, 9.6, z], [1.2, .5, .25], { rotY: Math.atan2(cz - z, cx - x) + Math.PI / 2 }); }

  // Football pitch lines, goals and corner flags.
  const P = PITCH, pcx = (P.x0 + P.x1) / 2, pcz = (P.z0 + P.z1) / 2, py = .012;
  const pline = (x0: number, z0: number, x1: number, z1: number) => kit.box('lineWhite', [(x0 + x1) / 2, py, (z0 + z1) / 2], [Math.max(.08, Math.abs(x1 - x0)), .01, Math.max(.08, Math.abs(z1 - z0))], { shadow: false });
  pline(P.x0, P.z0, P.x1, P.z0); pline(P.x0, P.z1, P.x1, P.z1); pline(P.x0, P.z0, P.x0, P.z1); pline(P.x1, P.z0, P.x1, P.z1); pline(P.x0, pcz, P.x1, pcz);
  kit.add('lineWhite', new THREE.RingGeometry(2.9, 3.0, 64).rotateX(-Math.PI / 2).translate(pcx, py + .001, pcz), { shadow: false });
  for (const s of [-1, 1]) {
    const gz = s < 0 ? P.z0 : P.z1;
    pline(pcx - 4, gz - s * 4, pcx + 4, gz - s * 4); pline(pcx - 4, gz, pcx - 4, gz - s * 4); pline(pcx + 4, gz, pcx + 4, gz - s * 4);
    for (const dx of [-2.5, 2.5]) kit.cylinder('paintWhite', [pcx + dx, 0, gz], .05, .05, 2, 10);
    kit.add('paintWhite', new THREE.CylinderGeometry(.05, .05, 5, 10).rotateZ(Math.PI / 2).translate(pcx, 2, gz), { keepUV: true });
    for (const dx of [-2.5, 2.5]) kit.box('steel', [pcx + dx, 1, gz + s * .9], [.03, 2, .03]);
    c.goalNets.push({ x: pcx, z: gz, dir: s });
  }
  for (const x of [P.x0, P.x1]) for (const z of [P.z0, P.z1]) { kit.cylinder('paintYellow', [x, 0, z], .02, .02, 1.5, 6); kit.box('paintTerracotta', [x + .15, 1.35, z], [.3, .25, .01], { shadow: false }); }
  void rand;
}

/** Contemporary LED street lamp: tapered steel column, slim arm and a luminaire with a glowing lens. */
function lamp(kit: BuildContext['kit'], x: number, z: number, rotY: number, height = 5.2) {
  kit.within([x, 0, z], rotY, () => {
    kit.cylinder('granite', [0, 0, 0], .2, .24, .32, 8).cylinder('darkMetal', [0, .32, 0], .045, .075, height - .32, 8);
    kit.box('darkMetal', [0, height - .04, .42], [.06, .06, .9]).box('darkMetal', [0, height - .02, .86], [.24, .09, .5]);
    kit.box('emissiveWarm', [0, height - .07, .86], [.18, .01, .42], { shadow: false });
  });
}

/** Street furniture: lamps, bins, benches and bollards. */
function scatter(c: BuildContext, rand: () => number) {
  const { props, kit } = c;
  const lampAt = (x: number, z: number, r: number, h?: number) => lamp(kit, x, z, r, h);
  for (const z of [37, 25, -18]) { lampAt(-4.6, z, Math.PI / 2); lampAt(4.6, z, -Math.PI / 2); }
  for (const x of [-40, -28, -16, 16, 24]) lampAt(x, 13.1, Math.PI);
  for (const x of [-44, -32, -20, 20, 32, 44]) lampAt(x, -26.6, 0);
  for (const x of [-26, -18, -8]) lampAt(x, 30.1, Math.PI);
  for (const x of [-52, -40]) lampAt(x, 34.6, 0);
  for (let x = -84; x <= 84; x += 14) if (Math.abs(x) > 8) lampAt(x, 60.1, Math.PI, 7.5);
  for (const [x, z] of [[-4.8, 34], [4.8, 22], [-11, 13.4], [11, 13.4], [-12, -26.6], [12, -26.6], [-30.8, 29.9], [-38, 34.6], [9, -.9]]) wasteBin(kit, x, z, rand() * 6);
  // Every bench is a sittable seat pair defined once in shared/interactions.mjs.
  for (const b of BENCHES) bench(kit, b.x, b.z, b.yaw, b.len);
  props.at('picnic', -25, 18.5, .3); props.at('picnic', 37, 7.2, -.2); props.at('picnic', -40, -34, 1.4);
  props.at('hydrant', 9.4, 49.3, 0); props.at('hydrant', -36.5, -2.4, 0);
  // Granite bollards across the gate apron keep vehicles to the road lane.
  for (const x of [-2.6, 0, 2.6]) kit.cylinder('granite', [x, 0, 43.0], .16, .18, .8, 14);
}
