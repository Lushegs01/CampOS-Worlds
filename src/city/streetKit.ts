// Street infrastructure that the city simulation uses: signal heads (lamps driven by the shared signal clock),
// pedestrian signals, zebra crossings and stop lines at every controlled junction, give-way signs, bus shelters,
// benches and bins. Static parts are merged; the lamps are one instanced mesh whose colours change with the phases.
import * as THREE from 'three';
import { Builder, mat } from './geom';
import { SIGNAL_HEADS, CROSSWALKS, GIVE_WAY, FURNITURE, JUNCTION, LANES, WALK, signalAspect, walkSignal } from '../../shared/city/network.mjs';
import { vehicleMaterial } from './vehicleKit';

const POLE = { color: '#3b4046', rough: .45, metal: .7 }, HOUSING = { color: '#1b1d20', rough: .5, metal: .3 };
export interface Lamp { node: string; axis: string; kind: 'veh' | 'ped'; colour: 0 | 1 | 2; x: number; y: number; z: number }

export function buildStreetKit() {
  const b = new Builder(), lamps: Lamp[] = [];
  // Vehicle signal heads: a pole on the kerb, an outreach arm over the lane, a three-lamp head facing the traffic.
  for (const h of SIGNAL_HEADS) {
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw); // facing, and to its left
    b.cyl([h.x, 2.6, h.z], .075, .09, 5.2, 10, POLE);
    // Arm reaching over the lane (towards the road centre = the head's left as it faces the traffic).
    b.box([h.x + lx * 1.4, 5.05, h.z + lz * 1.4], [.08, .08, 2.8], POLE, [0, h.yaw + Math.PI / 2, 0]);
    for (const [ox, y] of [[2.7, 4.35], [0, 2.75]] as const) {
      const cx = h.x + lx * ox, cz = h.z + lz * ox;
      b.box([cx, y, cz], [.34, 1.0, .26], HOUSING, [0, h.yaw, 0]);
      b.box([cx - fx * .14, y, cz - fz * .14], [.5, 1.16, .03], { color: '#111214', rough: .7 }, [0, h.yaw, 0]); // backplate
      ([0, 1, 2] as const).forEach(k => {
        const ly = y + .3 - k * .3;
        b.box([cx + fx * .16 + 0, ly + .1, cz + fz * .16], [.26, .03, .14], HOUSING, [0, h.yaw, 0]); // visor
        lamps.push({ node: h.node, axis: h.axis ?? 'h', kind: 'veh', colour: k as 0 | 1 | 2, x: cx + fx * .135, y: ly, z: cz + fz * .135 });
      });
    }
  }
  // Pedestrian signals at both ends of each signalised crosswalk, and the zebra markings.
  const zebra = new Builder();
  for (const c of CROSSWALKS) {
    const j = JUNCTION.get(c.node)!;
    const across = c.axis === 'v' ? 'x' : 'z'; // a crosswalk over a north–south arm runs east–west
    for (let k = -3.6; k <= 3.61; k += 1.0) zebra.box(across === 'x' ? [c.x + k, .036, c.z] : [c.x, .036, c.z + k], across === 'x' ? [.5, .012, 3] : [3, .012, .5], { color: '#e9e7e0', rough: .7 });
    if (j.control !== 'signal') continue;
    for (const id of [c.a, c.b]) {
      const w = WALK[id], dx = c.x - w.x, dz = c.z - w.z, d = Math.hypot(dx, dz) || 1, yaw = Math.atan2(-dx / d, -dz / d);
      const px = w.x + (across === 'x' ? 0 : 1.6 * Math.sign(w.x - j.x || 1)) - dx / d * .6, pz = w.z + (across === 'z' ? 0 : 1.6 * Math.sign(w.z - j.z || 1)) - dz / d * .6;
      b.cyl([px, 1.3, pz], .05, .05, 2.6, 8, POLE);
      b.box([px, 2.45, pz], [.28, .5, .2], HOUSING, [0, yaw + Math.PI, 0]);
      lamps.push({ node: c.node, axis: c.axis, kind: 'ped', colour: 0, x: px + dx / d * .11, y: 2.57, z: pz + dz / d * .11 });
      lamps.push({ node: c.node, axis: c.axis, kind: 'ped', colour: 2, x: px + dx / d * .11, y: 2.33, z: pz + dz / d * .11 });
    }
  }
  // Stop lines at controlled junctions.
  for (const l of LANES) {
    const j = JUNCTION.get(l.to)!; if (j.control === 'none' || j.control === 'end') continue;
    const e = l.pts.at(-1)!, yaw = Math.atan2(l.dir.x, l.dir.z);
    zebra.add(new THREE.BoxGeometry(3.7, .012, .4), mat([e.x + l.dir.x * .4, .036, e.z + l.dir.z * .4], [0, yaw, 0]), { color: '#ecebe5', rough: .7 });
    if (j.control === 'priority' && l.axis === 'v') for (let k = -1.5; k <= 1.51; k += .75) zebra.add(new THREE.BoxGeometry(.5, .012, .35), mat([e.x + l.dir.x * 1.2 - l.dir.z * k, .036, e.z + l.dir.z * 1.2 + l.dir.x * k], [0, yaw, 0]), { color: '#ecebe5', rough: .7 });
  }
  // Give-way signs.
  for (const g of GIVE_WAY) {
    b.cyl([g.x, 1.2, g.z], .04, .04, 2.4, 8, POLE);
    const tri = new THREE.CylinderGeometry(.42, .42, .04, 3); tri.rotateX(Math.PI / 2); tri.rotateZ(Math.PI);
    b.add(tri, mat([g.x, 2.25, g.z], [0, g.yaw, 0]), { color: '#c8302a', rough: .5 });
    const inner = new THREE.CylinderGeometry(.27, .27, .045, 3); inner.rotateX(Math.PI / 2); inner.rotateZ(Math.PI);
    b.add(inner, mat([g.x + Math.sin(g.yaw) * .005, 2.27, g.z + Math.cos(g.yaw) * .005], [0, g.yaw, 0]), { color: '#f2f0ea', rough: .5 });
  }
  // Benches, bus shelters and bins.
  const ADS = ['#c8402e', '#1f6b52', '#2f4b6e', '#d9a03a', '#5b4a7a'];
  FURNITURE.forEach((f, i) => {
    const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), lx = Math.cos(f.yaw), lz = -Math.sin(f.yaw);
    const at = (a: number, s: number, y: number) => [f.x + lx * a + fx * s, y, f.z + lz * a + fz * s] as [number, number, number];
    const bench = (s: number) => {
      for (const k of [-.12, .04, .2]) b.box(at(0, s + k, .45), [1.9, .04, .12], { color: '#8a5a3a', rough: .7 }, [0, f.yaw, 0]);
      b.box(at(0, s - .25, .72), [1.9, .3, .04], { color: '#8a5a3a', rough: .7 }, [0, f.yaw, 0]);
      for (const a of [-.8, .8]) b.box(at(a, s, .22), [.06, .44, .46], { color: '#2c3034', metal: .7, rough: .4 }, [0, f.yaw, 0]);
    };
    if (f.kind === 'bench') { bench(0); b.cyl(at(1.5, -.1, .45), .23, .2, .9, 12, { color: '#2f5a46', rough: .5, metal: .3 }); return; }
    // Bus shelter: posts, roof, back glass panel and an illuminated advertising panel at one end.
    for (const a of [-1.8, 1.8]) for (const s of [-.75, .55]) b.box(at(a, s, 1.25), [.07, 2.5, .07], { color: '#3b4046', metal: .8, rough: .35 }, [0, f.yaw, 0]);
    b.box(at(0, -.1, 2.55), [3.9, .08, 1.7], { color: '#3b4046', metal: .7, rough: .4 }, [0, f.yaw, 0]);
    b.box(at(0, -.78, 1.35), [3.5, 1.6, .03], { color: '#9fb1b8', rough: .1, metal: .2 }, [0, f.yaw, 0]);
    b.box(at(1.82, -.1, 1.3), [.06, 1.9, 1.3], { lamp: 8, color: ADS[i % ADS.length], rough: .3 }, [0, f.yaw + Math.PI / 2, 0]);
    b.box(at(0, .58, 2.4), [1.3, .22, .05], { color: '#1f3559', rough: .4 }, [0, f.yaw, 0]); // stop name board
    bench(-.45);
  });
  const { material, uniforms } = vehicleMaterial('body');
  const geo = b.build(), stat = new THREE.Mesh(geo, material);
  const zg = zebra.build(), zmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const marks = new THREE.Mesh(zg, zmat); marks.receiveShadow = true;
  // iPaint/iLamps defaults for the shared material (a non-instanced mesh reads attribute values per vertex).
  for (const g of [geo]) { const n = g.attributes.position.count; g.setAttribute('iPaint', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); g.setAttribute('iLamps', new THREE.BufferAttribute(new Float32Array(n * 4), 4)); }
  stat.castShadow = true; stat.receiveShadow = true; stat.name = 'city:street-kit'; marks.name = 'city:markings';
  // Lamps: discs, coloured each phase.
  const disc = new THREE.CircleGeometry(.1, 14);
  const lampMesh = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ toneMapped: false }), lamps.length);
  const m4 = new THREE.Matrix4();
  lamps.forEach((l, i) => {
    const h = l.kind === 'veh' ? SIGNAL_HEADS.find(s => s.node === l.node && s.axis === l.axis && Math.hypot(s.x - l.x, s.z - l.z) < 3.2) : null;
    const yaw = h ? h.yaw : Math.atan2(JUNCTION.get(l.node)!.x - l.x, JUNCTION.get(l.node)!.z - l.z) + Math.PI;
    m4.makeRotationY(yaw); m4.setPosition(l.x, l.y, l.z); lampMesh.setMatrixAt(i, m4);
  });
  lampMesh.name = 'city:signal-lamps'; lampMesh.frustumCulled = false;
  const OFF = new THREE.Color('#1a1c1e'), ON = [new THREE.Color(4, .25, .15), new THREE.Color(4, 2.2, .2), new THREE.Color(.3, 3.6, 1.2)], WALKC = new THREE.Color(3, 3, 3), DONT = new THREE.Color(4, .9, .1);
  let lastKey = '';
  function update(time: number) {
    const key = String(Math.floor(time * 4)); if (key === lastKey) return; lastKey = key;
    lamps.forEach((l, i) => {
      const j = JUNCTION.get(l.node)!;
      let c = OFF;
      if (l.kind === 'veh') { const a = signalAspect(j, l.axis, time); if ((a === 'red' && l.colour === 0) || (a === 'amber' && l.colour === 1) || (a === 'green' && l.colour === 2)) c = ON[l.colour]; }
      else { const w = walkSignal(j, l.axis, time); if (l.colour === 2 && w === 'walk') c = WALKC; if (l.colour === 0 && (w === 'dont' || (w === 'flash' && Math.floor(time * 2) % 2 === 0))) c = DONT; }
      lampMesh.setColorAt(i, c);
    });
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
  }
  update(0);
  return { stat, marks, lampMesh, update, uniforms, lamps };
}
