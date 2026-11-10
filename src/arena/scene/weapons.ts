// Combat Arena weapons: original, procedurally modelled firearms built from profiled and bevelled parts
// (extruded receivers, curved ribbed magazines, Picatinny rails with individual teeth, slotted
// handguards, ported compensators, optics with lenses and reticles), finished with PBR materials:
// anodised and cerakoted metal, polymer, rubber, wood, glass and brass, with the arena's KTX2 normal
// and wear maps. Named anchors drive animation and placement:
//   muzzle, ejection, gripR, gripL, mag, bolt | pump | slide | cylinder, sight (aim point)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPON_BY_ID, SKIN_BY_ID } from '../../../shared/arena/weapons.mjs';
import type { Library } from './library';

type Mats = ReturnType<typeof makeFinishes>;
const cache = new Map<string, Mats>();
function tex(t: THREE.Texture, repeat: number) { const c = t.clone(); c.repeat.set(repeat, repeat); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c; }
/** Material set for one finish (skin). */
function finishes(lib: Library | null, skin: string): Mats {
  const key = (lib ? 'lib' : 'flat') + skin; let hit = cache.get(key);
  if (!hit) { hit = makeFinishes(lib, skin); cache.set(key, hit); }
  return hit;
}
function makeFinishes(lib: Library | null, skin: string) {
  const [base, dark] = SKIN_BY_ID.get(skin)?.colors ?? ['#4d545c', '#2c3136'];
  const s = lib?.surfaces;
  const metal = (color: string, rough: number, metalness: number, wear = 1) => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness, envMapIntensity: 1.1,
    // A fine pitted grain (parkerised steel, anodised aluminium), never a visible pattern.
    ...(s ? { normalMap: tex(s.concreteFloor.normal, 5 * wear), normalScale: new THREE.Vector2(.18, .18) } : {}),
  });
  const m = {
    receiver: metal(skin === 'standard' ? '#383b3f' : dark, .5, .6),
    furniture: metal(skin === 'standard' ? '#484b4e' : base, .6, .3),
    steel: metal('#3d4045', .38, .95, 2),
    bare: metal('#7d8288', .3, 1, 2),
    polymer: new THREE.MeshStandardMaterial({ color: '#202225', roughness: .72, metalness: .05, envMapIntensity: .7, ...(s ? { normalMap: tex(s.concreteFloor.normal, 6), normalScale: new THREE.Vector2(.25, .25) } : {}) }),
    rubber: new THREE.MeshStandardMaterial({ color: '#151617', roughness: .92, metalness: 0, ...(s ? { normalMap: tex(s.sandbag.normal, 5), normalScale: new THREE.Vector2(.6, .6) } : {}) }),
    wood: new THREE.MeshStandardMaterial({ color: '#7a4f2c', roughness: .55, metalness: 0, ...(s ? { map: tex(s.planks.color, 1), normalMap: tex(s.planks.normal, 1) } : {}) }),
    brass: new THREE.MeshStandardMaterial({ color: '#b48a4f', roughness: .3, metalness: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#3a5a6e', roughness: .05, metalness: .1, transparent: true, opacity: .45, envMapIntensity: 1.6, clearcoat: 1 }),
    reticle: new THREE.MeshBasicMaterial({ color: '#ff3a2a', toneMapped: false }),
    tritium: new THREE.MeshBasicMaterial({ color: '#9dff6a', toneMapped: false }),
    blade: metal('#aab0b6', .22, 1, 3),
  };
  return m;
}

// ---------------------------------------------------------------- modelling kit
type Part = THREE.Mesh;
const V = (x: number, y: number) => new THREE.Vector2(x, y);
function rbox(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, r = .004, name?: string): Part {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)), mat);
  mesh.position.set(x, y, z); if (name) mesh.name = name; g.add(mesh); return mesh;
}
function cyl(g: THREE.Group, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, seg = 18, r2 = r, axis: 'z' | 'y' | 'x' = 'z'): Part {
  const geo = new THREE.CylinderGeometry(r2, r, len, seg, 1); if (axis === 'z') geo.rotateX(Math.PI / 2); else if (axis === 'x') geo.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); g.add(mesh); return mesh;
}
/** A side profile (z forward is −x in the shape, y up) extruded to a width, centred, with bevelled edges. */
function profile(g: THREE.Group, mat: THREE.Material, pts: [number, number][], width: number, x = 0, bevel = .003, name?: string, holes: [number, number][][] = []): Part {
  const shape = new THREE.Shape(pts.map(([z, y]) => V(z, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => V(z, y))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  geo.translate(0, 0, -(width - bevel * 2) / 2); geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.x = x; if (name) mesh.name = name; g.add(mesh); return mesh;
}
/** A Picatinny rail: base with individual recoil-lug teeth. */
function rail(g: THREE.Group, mat: THREE.Material, z0: number, z1: number, y: number, x = 0, axis: 'top' | 'side' = 'top') {
  const len = Math.abs(z1 - z0), parts: THREE.BufferGeometry[] = [];
  const base = new THREE.BoxGeometry(.021, .006, len); base.translate(0, 0, (z0 + z1) / 2); parts.push(base);
  for (let z = Math.min(z0, z1) + .004; z < Math.max(z0, z1) - .004; z += .01) { const t = new THREE.BoxGeometry(.022, .004, .005); t.translate(0, .005, z); parts.push(t); }
  const geo = mergeGeometries(parts); parts.forEach(p => p.dispose());
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, 0); if (axis === 'side') { mesh.rotation.z = Math.PI / 2 * Math.sign(x || 1); } g.add(mesh); return mesh;
}
/** A curved box magazine (side profile arc) with stiffening ribs and a baseplate. */
function curvedMag(g: THREE.Group, m: Mats, length: number, curve: number, width: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Group {
  const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(x, y, z); g.add(mag);
  const pts: [number, number][] = [], back: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10, yy = -t * length, zz = -curve * t * t; pts.push([zz - .016, yy]); back.push([zz + .016 + t * .004, yy]); }
  profile(mag, mat, [...pts, ...back.reverse()], width, 0, .0025);
  for (const k of [.25, .5, .75]) { const yy = -k * length, zz = -curve * k * k; rbox(mag, mat, width + .003, .004, .03, 0, yy, zz, .0015); }
  rbox(mag, m.polymer, width + .006, .012, .044, 0, -length - .004, -curve - .002, .003);
  cyl(mag, m.brass, .0048, .028, 0, .004, .002, 10);
  return mag;
}
function optic(g: THREE.Group, m: Mats, y: number, z: number, kind: 'dot' | 'scope' | 'holo', len = .1) {
  const o = new THREE.Group(); o.position.set(0, y, z); g.add(o);
  if (kind === 'scope') {
    cyl(o, m.receiver, .016, len, 0, .034, 0, 20); cyl(o, m.receiver, .016, .05, 0, .034, -len / 2 - .02, 24, .025); cyl(o, m.receiver, .016, .03, 0, .034, len / 2 + .012, 24, .021);
    cyl(o, m.glass, .023, .002, 0, .034, -len / 2 - .046, 24); cyl(o, m.glass, .02, .002, 0, .034, len / 2 + .028, 24);
    cyl(o, m.receiver, .007, .02, 0, .056, 0, 12, .007, 'y'); cyl(o, m.receiver, .007, .02, .022, .034, 0, 12, .007, 'x');
    for (const zz of [-len * .3, len * .3]) { rbox(o, m.steel, .03, .03, .016, 0, .012, zz, .003); }
    const ret = new THREE.Mesh(new THREE.RingGeometry(.0002, .0006, 8), m.reticle); ret.position.set(0, .034, len / 2 + .03); o.add(ret);
    o.userData.sightY = y + .034;
  } else if (kind === 'holo') {
    rbox(o, m.receiver, .034, .012, .085, 0, .006, 0, .003);
    profile(o, m.receiver, [[-.04, .012], [.035, .012], [.035, .05], [.028, .056], [.02, .05], [.02, .02], [-.025, .02], [-.025, .05], [-.032, .056], [-.04, .05]], .036, 0, .002);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(.026, .028), m.glass); glass.position.set(0, .036, -.025); o.add(glass);
    const ret = new THREE.Mesh(new THREE.RingGeometry(.0018, .0024, 24), m.reticle); ret.position.set(0, .036, -.0245); o.add(ret);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(.0005, 8), m.reticle); dot.position.set(0, .036, -.0244); o.add(dot);
    o.userData.sightY = y + .036;
  } else {
    rbox(o, m.receiver, .03, .016, .04, 0, .008, 0, .003);
    cyl(o, m.receiver, .016, .065, 0, .036, 0, 24); cyl(o, m.receiver, .0185, .012, 0, .036, -.034, 24);
    cyl(o, m.glass, .0145, .002, 0, .036, -.04, 24); cyl(o, m.glass, .0145, .002, 0, .036, .033, 24);
    cyl(o, m.receiver, .0055, .012, 0, .056, 0, 10, .0055, 'y'); cyl(o, m.receiver, .0055, .012, .02, .036, 0, 10, .0055, 'x');
    const dot = new THREE.Mesh(new THREE.CircleGeometry(.0007, 10), m.reticle); dot.position.set(0, .036, -.038); o.add(dot);
    o.userData.sightY = y + .036;
  }
  g.userData.sightY = o.userData.sightY;
  return o;
}
function anchor(g: THREE.Object3D, name: string, x: number, y: number, z: number, rx = 0) { const a = new THREE.Object3D(); a.name = name; a.position.set(x, y, z); a.rotation.x = rx; g.add(a); return a; }
function muzzleFlash(g: THREE.Group, z: number, y: number) {
  const a = anchor(g, 'muzzle', 0, y, z);
  return a;
}

// ---------------------------------------------------------------- the arsenal
function rifle(g: THREE.Group, m: Mats, o: { barrel: number; stock: 'collapsible' | 'fixed' | 'chassis'; optic: 'dot' | 'holo' | 'scope'; mag: number; magCurve: number; handguard: number; heavy?: boolean; burst?: boolean }) {
  // Upper receiver (flat-top) and lower with magazine well.
  profile(g, m.receiver, [[.13, .006], [.13, .05], [.11, .056], [-.175, .056], [-.18, .04], [-.18, .006]], .062);
  rbox(g, m.receiver, .006, .014, .05, .033, .03, -.02, .002);
  rbox(g, m.steel, .004, .009, .032, .034, .033, -.02, .0015);
  cyl(g, m.steel, .006, .012, .036, .036, .045, 10, .006, 'x');
  profile(g, m.receiver, [[.12, .006], [.12, -.028], [.065, -.038], [-.01, -.03], [-.1, -.03], [-.105, -.075], [-.035, -.075], [-.03, -.03], [-.11, -.03], [-.115, .006]], .058);
  // Trigger guard, trigger and pistol grip.
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.022, .0035, 6, 18, Math.PI), m.receiver); guard.rotation.set(Math.PI, Math.PI / 2, 0); guard.position.set(0, -.03, .03); g.add(guard);
  rbox(g, m.steel, .006, .02, .006, 0, -.032, .028, .002);
  profile(g, m.polymer, [[.05, -.03], [.085, -.03], [.115, -.115], [.098, -.13], [.07, -.122], [.04, -.04]], .032, 0, .004);
  for (let i = 0; i < 5; i++) rbox(g, m.rubber, .033, .003, .014, 0, -.06 - i * .013, .072 + i * .0045, .0012);
  // Charging handle, forward assist, ejection port cover, bolt catch.
  rbox(g, m.receiver, .05, .008, .014, 0, .051, .12, .003, 'bolt');
  rbox(g, m.steel, .02, .016, .07, .03, .028, .0, .002);
  anchor(g, 'ejection', .035, .03, -.0);
  // Handguard (free-float, slotted) with rails, barrel, gas block and muzzle device.
  const hgLen = o.handguard, hg = new THREE.CylinderGeometry(.03, .03, hgLen, 8, 1); hg.rotateX(Math.PI / 2); hg.rotateZ(Math.PI / 8);
  const handguard = new THREE.Mesh(hg, m.furniture); handguard.position.set(0, .024, -.18 - hgLen / 2); g.add(handguard);
  for (let i = 0; i < Math.floor(hgLen / .045); i++) for (const sx of [-1, 1]) rbox(g, m.polymer, .004, .009, .026, sx * .0295, .024, -.2 - i * .045, .0015);
  rail(g, m.receiver, .12, -.18 - hgLen + .01, .059);
  rail(g, m.receiver, -.2, -.18 - hgLen + .02, -.006, 0);
  const bl = o.barrel; cyl(g, m.steel, o.heavy ? .012 : .0095, bl, 0, .024, -.18 - bl / 2, 16);
  rbox(g, m.steel, .022, .03, .02, 0, .028, -.18 - hgLen - .012, .003);
  const mz = -.18 - bl;
  cyl(g, m.steel, .014, .055, 0, .024, mz - .022, 16);
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) rbox(g, m.receiver, .005, .006, .008, sx * .0125, .03, mz - .006 - i * .014, .001);
  muzzleFlash(g, mz - .052, .024);
  // Stock and buffer tube.
  if (o.stock === 'collapsible') {
    cyl(g, m.receiver, .015, .19, 0, .026, .22, 16);
    profile(g, m.polymer, [[.2, .045], [.335, .045], [.345, .03], [.345, -.04], [.33, -.055], [.29, -.05], [.27, -.01], [.2, .005]], .042, 0, .004);
    rbox(g, m.rubber, .044, .1, .012, 0, -.002, .346, .004);
  } else if (o.stock === 'chassis') {
    profile(g, m.receiver, [[.12, .04], [.4, .045], [.42, .03], [.42, -.06], [.36, -.07], [.25, -.035], [.12, -.02]], .036, 0, .004, undefined, [[[.18, .02], [.33, .025], [.33, -.02], [.24, -.012], [.18, .0]]]);
    rbox(g, m.polymer, .03, .02, .1, 0, .062, .3, .005);
    rbox(g, m.rubber, .04, .11, .014, 0, -.01, .426, .004);
  } else {
    profile(g, m.polymer, [[.12, .045], [.36, .05], [.37, .03], [.37, -.065], [.3, -.07], [.2, -.03], [.12, -.012]], .04, 0, .005);
  }
  const optics = optic(g, m, .062, .0, o.optic, o.optic === 'scope' ? .16 : .1); void optics;
  curvedMag(g, m, o.mag, o.magCurve, .024, 0, -.04, -.07, o.heavy ? m.receiver : m.polymer);
  anchor(g, 'gripR', 0, -.07, .085, -.35); anchor(g, 'gripL', 0, .0, -.18 - hgLen * .55);
  if (o.burst) rbox(g, m.steel, .006, .01, .012, -.032, .0, .05, .002);
}
function smg(g: THREE.Group, m: Mats, heavy: boolean) {
  profile(g, m.receiver, [[.1, -.005], [.1, .045], [.08, .052], [-.15, .052], [-.16, .03], [-.16, -.005]], .056);
  profile(g, m.polymer, [[.1, -.005], [.1, -.03], [-.02, -.035], [-.12, -.03], [-.13, -.005]], .052);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.02, .0034, 6, 18, Math.PI), m.receiver); guard.rotation.set(Math.PI, Math.PI / 2, 0); guard.position.set(0, -.03, .035); g.add(guard);
  profile(g, m.polymer, [[.05, -.03], [.082, -.03], [.11, -.11], [.094, -.124], [.068, -.116], [.04, -.04]], .03, 0, .004);
  rail(g, m.receiver, .09, -.15, .055);
  cyl(g, m.receiver, .022, .09, 0, .022, -.2, 16); cyl(g, m.steel, .009, .05, 0, .022, -.265, 14);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) rbox(g, m.polymer, .004, .007, .012, sx * .0215, .022, -.17 - i * .02, .0015);
  muzzleFlash(g, -.295, .022);
  rbox(g, m.receiver, .012, .012, .05, -.03, .035, .03, .003, 'bolt');
  anchor(g, 'ejection', .03, .03, -.02);
  // Folding stock: a skeletal steel loop.
  for (const sx of [-1, 1]) rbox(g, m.steel, .006, .008, .22, sx * .018, .02, .2, .003);
  rbox(g, m.rubber, .05, .07, .012, 0, .0, .31, .004);
  const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(0, -.03, -.05); g.add(mag);
  rbox(mag, m.polymer, .022, heavy ? .15 : .19, .032, 0, -(heavy ? .075 : .095), 0, .004);
  rbox(mag, m.polymer, .028, .012, .04, 0, -(heavy ? .155 : .195), 0, .003);
  optic(g, m, .055, -.02, heavy ? 'holo' : 'dot');
  anchor(g, 'gripR', 0, -.07, .082, -.35); anchor(g, 'gripL', 0, -.005, -.19);
}
function shotgun(g: THREE.Group, m: Mats, auto: boolean) {
  profile(g, m.receiver, [[.1, -.02], [.1, .04], [.085, .05], [-.13, .05], [-.14, .03], [-.14, -.02]], .05, 0, .005);
  const bl = .46;
  cyl(g, m.steel, .012, bl, 0, .03, -.13 - bl / 2, 16);
  cyl(g, m.steel, .013, auto ? .0 : bl * .78, 0, .0, -.13 - bl * .39, 16);
  rbox(g, m.steel, .02, .016, .012, 0, .035, -.13 - bl + .008, .003);
  rbox(g, m.tritium, .004, .004, .004, 0, .044, -.13 - bl + .008, .0015);
  muzzleFlash(g, -.13 - bl - .01, .03);
  anchor(g, 'ejection', .028, .02, -.04);
  if (auto) {
    const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(0, -.02, -.06); g.add(mag);
    rbox(mag, m.polymer, .038, .1, .07, 0, -.05, 0, .006);
    rbox(g, m.furniture, .05, .045, .2, 0, .005, -.24, .01);
    rail(g, m.receiver, .08, -.12, .053); optic(g, m, .053, -.02, 'dot');
  } else {
    const pump = new THREE.Group(); pump.name = 'pump'; g.add(pump);
    rbox(pump, m.furniture, .05, .042, .17, 0, .004, -.26, .012);
    for (let i = 0; i < 6; i++) rbox(pump, m.polymer, .052, .003, .006, 0, .02, -.2 - i * .022, .0012);
    const mag = new THREE.Group(); mag.name = 'mag'; g.add(mag);
  }
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.021, .0035, 6, 18, Math.PI), m.receiver); guard.rotation.set(Math.PI, Math.PI / 2, 0); guard.position.set(0, -.02, .04); g.add(guard);
  profile(g, auto ? m.polymer : m.wood, [[.06, -.02], [.1, -.02], [.36, -.02], [.37, -.03], [.37, -.11], [.34, -.12], [.17, -.065], [.11, -.11], [.085, -.115], [.06, -.03]], .042, 0, .006);
  rbox(g, m.rubber, .044, .095, .016, 0, -.07, .372, .005);
  anchor(g, 'gripR', 0, -.075, .1, -.5); anchor(g, 'gripL', 0, -.005, -.26);
  g.userData.sightY = .044;
}
function sniper(g: THREE.Group, m: Mats, dmr: boolean) {
  if (dmr) { rifle(g, m, { barrel: .46, stock: 'collapsible', optic: 'scope', mag: .1, magCurve: .004, handguard: .34, heavy: true }); return; }
  profile(g, m.receiver, [[.12, .0], [.12, .045], [.1, .052], [-.18, .052], [-.19, .03], [-.19, .0]], .056);
  cyl(g, m.receiver, .022, .3, 0, .03, -.03, 20);
  const bolt = new THREE.Group(); bolt.name = 'bolt'; bolt.position.set(.024, .035, .07); g.add(bolt);
  cyl(bolt, m.bare, .005, .05, .025, 0, 0, 10, .005, 'x'); const knob = new THREE.Mesh(new THREE.SphereGeometry(.011, 14, 10), m.polymer); knob.position.set(.05, -.005, 0); bolt.add(knob);
  const bl = .62; cyl(g, m.steel, .015, bl, 0, .03, -.18 - bl / 2, 18, .012);
  for (let a = 0; a < 6; a++) { const ang = a / 6 * Math.PI * 2, f = rbox(g, m.receiver, .003, .003, bl * .55, Math.cos(ang) * .0135, .03 + Math.sin(ang) * .0135, -.32, .0012); f.rotation.z = ang; }
  rbox(g, m.steel, .034, .028, .06, 0, .03, -.18 - bl - .028, .006);
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) rbox(g, m.receiver, .005, .016, .009, sx * .0172, .03, -.18 - bl - .01 - i * .016, .001);
  muzzleFlash(g, -.18 - bl - .06, .03);
  anchor(g, 'ejection', .03, .04, .0);
  rifleStock(g, m);
  rail(g, m.receiver, .1, -.17, .055); optic(g, m, .055, -.03, 'scope', .2);
  const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(0, -.03, -.06); g.add(mag); rbox(mag, m.receiver, .028, .07, .085, 0, -.035, 0, .004);
  // Folded bipod.
  for (const sx of [-1, 1]) rbox(g, m.steel, .008, .008, .17, sx * .012, -.02, -.33, .003);
  anchor(g, 'gripR', 0, -.075, .1, -.35); anchor(g, 'gripL', 0, -.01, -.24);
}
function rifleStock(g: THREE.Group, m: Mats) {
  profile(g, m.polymer, [[.05, -.03], [.08, -.03], [.11, -.12], [.094, -.132], [.068, -.124], [.04, -.04]], .032, 0, .004);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.021, .0035, 6, 18, Math.PI), m.receiver); guard.rotation.set(Math.PI, Math.PI / 2, 0); guard.position.set(0, -.028, .03); g.add(guard);
  profile(g, m.furniture, [[.12, .03], [.42, .04], [.44, .02], [.44, -.075], [.38, -.085], [.26, -.04], [.12, -.03]], .04, 0, .005, undefined, [[[.17, .01], [.32, .018], [.32, -.03], [.23, -.022], [.17, -.012]]]);
  rbox(g, m.rubber, .044, .12, .014, 0, -.02, .446, .005);
  rbox(g, m.polymer, .034, .018, .12, 0, .056, .3, .005);
}
function lmg(g: THREE.Group, m: Mats) {
  rifle(g, m, { barrel: .52, stock: 'fixed', optic: 'dot', mag: .0001, magCurve: 0, handguard: .3, heavy: true });
  const old = g.getObjectByName('mag'); if (old) old.parent?.remove(old);
  const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(.0, -.035, -.05); g.add(mag);
  rbox(mag, m.polymer, .09, .1, .11, -.03, -.05, 0, .008);
  for (let i = 0; i < 3; i++) rbox(mag, m.rubber, .092, .004, .112, -.03, -.02 - i * .03, 0, .0015);
  rbox(g, m.receiver, .066, .03, .17, 0, .072, -.06, .005);
  profile(g, m.steel, [[.0, .09], [.0, .12], [-.12, .12], [-.12, .09], [-.1, .09], [-.1, .11], [-.02, .11], [-.02, .09]], .012, 0, .002);
  for (const sx of [-1, 1]) rbox(g, m.steel, .009, .009, .19, sx * .014, -.01, -.48, .003);
  cyl(g, m.receiver, .022, .2, 0, .024, -.36, 10);
}
function pistol(g: THREE.Group, m: Mats) {
  const slide = new THREE.Group(); slide.name = 'slide'; g.add(slide);
  profile(slide, m.receiver, [[.06, .0], [.06, .028], [.05, .034], [-.13, .034], [-.135, .02], [-.135, .0]], .028, 0, .003);
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) rbox(slide, m.steel, .002, .022, .003, sx * .0142, .017, .045 - i * .006, .0008);
  rbox(slide, m.steel, .006, .006, .006, 0, .037, -.125, .002); rbox(slide, m.steel, .02, .006, .006, 0, .037, .052, .002);
  rbox(slide, m.tritium, .002, .002, .001, 0, .039, -.122, .0008); for (const sx of [-1, 1]) rbox(slide, m.tritium, .002, .002, .001, sx * .006, .039, .055, .0008);
  rbox(slide, m.steel, .012, .008, .02, .0145, .02, -.01, .002);
  profile(g, m.polymer, [[.05, .0], [.05, -.01], [-.12, -.01], [-.125, .0]], .026, 0, .003);
  rail(g, m.polymer, -.06, -.115, -.014);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.017, .003, 6, 16, Math.PI), m.polymer); guard.rotation.set(Math.PI, Math.PI / 2, 0); guard.position.set(0, -.012, -.01); g.add(guard);
  profile(g, m.polymer, [[.02, -.008], [.058, -.008], [.075, -.1], [.058, -.112], [.032, -.108], [.012, -.03]], .03, 0, .005);
  for (let i = 0; i < 6; i++) rbox(g, m.rubber, .031, .002, .03, 0, -.03 - i * .012, .045 + i * .0028, .001);
  const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(0, -.105, .05); g.add(mag); rbox(mag, m.receiver, .026, .012, .036, 0, -.004, 0, .003);
  muzzleFlash(g, -.14, .017); anchor(g, 'ejection', .016, .03, -.02);
  anchor(g, 'gripR', 0, -.055, .045, -.25); anchor(g, 'gripL', -.012, -.06, .04, -.25);
  g.userData.sightY = .039;
}
function revolver(g: THREE.Group, m: Mats) {
  profile(g, m.bare, [[.05, -.005], [.05, .03], [.02, .04], [-.06, .04], [-.065, .0], [-.06, -.01], [.02, -.01]], .03, 0, .003);
  const cyl6 = new THREE.Group(); cyl6.name = 'cylinder'; cyl6.position.set(0, .015, -.01); g.add(cyl6);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .045, 6), m.bare); drum.rotation.x = Math.PI / 2; cyl6.add(drum);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6, f = rbox(cyl6, m.receiver, .005, .004, .046, Math.cos(a) * .02, Math.sin(a) * .02, 0, .0015); f.rotation.z = a; }
  cyl(g, m.bare, .009, .15, 0, .028, -.13, 16); rbox(g, m.bare, .012, .012, .15, 0, .037, -.13, .003);
  rbox(g, m.steel, .004, .01, .008, 0, .045, -.198, .001);
  profile(g, m.wood, [[.03, -.005], [.062, -.005], [.085, -.095], [.066, -.11], [.04, -.1], [.022, -.03]], .034, 0, .006);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.016, .003, 6, 16, Math.PI), m.bare); guard.rotation.set(Math.PI, Math.PI / 2, 0); guard.position.set(0, -.008, .012); g.add(guard);
  const mag = new THREE.Group(); mag.name = 'mag'; g.add(mag);
  muzzleFlash(g, -.21, .028); anchor(g, 'ejection', .02, .03, .0);
  anchor(g, 'gripR', 0, -.05, .055, -.25); anchor(g, 'gripL', -.012, -.055, .05, -.25);
  g.userData.sightY = .046;
}
function melee(g: THREE.Group, m: Mats, hammer: boolean) {
  if (hammer) {
    cyl(g, m.wood, .015, .42, 0, 0, -.12, 12);
    rbox(g, m.steel, .05, .05, .14, 0, 0, -.33, .006); rbox(g, m.steel, .055, .055, .03, 0, 0, -.27, .004);
    anchor(g, 'gripR', 0, -.0, .06, -.2); anchor(g, 'gripL', -.01, -.02, -.02, -.2);
  } else {
    const blade = new THREE.Shape([V(0, -.012), V(-.16, -.008), V(-.19, .006), V(-.17, .016), V(0, .016)]);
    const geo = new THREE.ExtrudeGeometry(blade, { depth: .003, bevelEnabled: true, bevelThickness: .0015, bevelSize: .002, bevelSegments: 1 });
    geo.rotateY(Math.PI / 2); const bm = new THREE.Mesh(geo, m.blade); bm.position.set(.0025, 0, -.02); g.add(bm);
    rbox(g, m.steel, .02, .045, .01, 0, .002, -.02, .002);
    cyl(g, m.rubber, .013, .11, 0, .002, .04, 12);
    for (let i = 0; i < 5; i++) cyl(g, m.polymer, .0138, .004, 0, .002, .0 + i * .02, 12);
    anchor(g, 'gripR', 0, .0, .04, -.1); anchor(g, 'gripL', -.04, -.06, .05, -.1);
  }
  muzzleFlash(g, -.2, 0); anchor(g, 'ejection', 0, 0, 0); const mag = new THREE.Group(); mag.name = 'mag'; g.add(mag);
  g.userData.sightY = 0;
}

const MOVING = new Set(['mag', 'bolt', 'pump', 'slide', 'cylinder']);
/** Merge a weapon's many small parts into one mesh per material (moving parts keep their own group). */
function bake(root: THREE.Group) {
  const mergeUnder = (owner: THREE.Object3D) => {
    owner.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(owner.matrixWorld).invert(), groups = new Map<THREE.Material, THREE.BufferGeometry[]>(), remove: THREE.Mesh[] = [];
    const visit = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (c !== owner && MOVING.has(c.name)) continue;
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh && !MOVING.has(mesh.name)) {
          const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
          for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
          if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
          const list = groups.get(mesh.material as THREE.Material) ?? []; list.push(geo); groups.set(mesh.material as THREE.Material, list); remove.push(mesh);
        }
        visit(c);
      }
    };
    visit(owner);
    for (const m of remove) { m.parent?.remove(m); m.geometry.dispose(); }
    for (const [mat, list] of groups) { const merged = mergeGeometries(list); list.forEach(x => x.dispose()); if (merged) { const mesh = new THREE.Mesh(merged, mat); mesh.frustumCulled = false; owner.add(mesh); } }
  };
  const movers: THREE.Object3D[] = []; root.traverse(o => { if (MOVING.has(o.name)) movers.push(o); });
  // A moving part that is itself a single mesh (a bolt handle) becomes a group holding it.
  for (const m of movers) if ((m as THREE.Mesh).isMesh) { const g = new THREE.Group(); g.name = m.name; g.position.copy(m.position); g.quaternion.copy(m.quaternion); m.name = ''; m.position.set(0, 0, 0); m.quaternion.identity(); m.parent!.add(g); g.add(m); }
  const groups: THREE.Object3D[] = []; root.traverse(o => { if (MOVING.has(o.name)) groups.push(o); });
  for (const g of groups) mergeUnder(g);
  mergeUnder(root);
}

/** A weapon model in metres (forward −z). `lib` adds the PBR maps; without it flat PBR colours are used. */
export function weaponModel(id: string, skin = 'standard', lib: Library | null = null) {
  const w = WEAPON_BY_ID.get(id)!, g = new THREE.Group(), m = finishes(lib, skin);
  g.userData.sightY = .09;
  switch (id) {
    case 'vanguard': rifle(g, m, { barrel: .36, stock: 'collapsible', optic: 'dot', mag: .14, magCurve: .03, handguard: .3 }); break;
    case 'halcyon': rifle(g, m, { barrel: .44, stock: 'fixed', optic: 'holo', mag: .12, magCurve: .022, handguard: .34, burst: true }); break;
    case 'wasp': smg(g, m, false); break;
    case 'kestrel': smg(g, m, true); break;
    case 'bastion': shotgun(g, m, false); break;
    case 'rampart': shotgun(g, m, true); break;
    case 'longbow': sniper(g, m, false); break;
    case 'talon': sniper(g, m, true); break;
    case 'anvil': lmg(g, m); break;
    case 'sparrow': pistol(g, m); break;
    case 'thorn': revolver(g, m); break;
    case 'knife': melee(g, m, false); break;
    case 'hammer': melee(g, m, true); break;
    default: rifle(g, m, { barrel: .36, stock: 'collapsible', optic: 'dot', mag: .14, magCurve: .03, handguard: .3 });
  }
  bake(g);
  for (const name of ['mag', 'bolt', 'pump', 'slide', 'cylinder']) { const p = g.getObjectByName(name); if (p) p.userData.rest = p.position.clone(); }
  g.userData.category = w?.category;
  return g;
}

/** The same weapon merged per material: a few draw calls for third-person use. */
export function weaponLowDetail(id: string, skin: string, lib: Library | null) {
  const src = weaponModel(id, skin, lib), groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.updateMatrixWorld(true);
  src.traverse(o => { const mesh = o as THREE.Mesh; if (!mesh.isMesh || (mesh.material as THREE.Material).transparent) return; const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); const list = groups.get(mesh.material as THREE.Material) ?? []; list.push(g); groups.set(mesh.material as THREE.Material, list); });
  const out = new THREE.Group();
  for (const [mat, list] of groups) { const merged = mergeGeometries(list); if (merged) out.add(new THREE.Mesh(merged, mat)); list.forEach(g => g.dispose()); }
  const muzzle = src.getObjectByName('muzzle'); if (muzzle) { const a = new THREE.Object3D(); a.name = 'muzzle'; a.position.copy(muzzle.getWorldPosition(new THREE.Vector3())); out.add(a); }
  for (const n of ['gripR', 'gripL']) { const s = src.getObjectByName(n); if (s) { const a = new THREE.Object3D(); a.name = n; a.position.copy(s.getWorldPosition(new THREE.Vector3())); out.add(a); } }
  return out;
}

// ---------------------------------------------------------------- first-person arms
/** Sleeved arms and tactical gloves, posed each frame by two-bone IK to the weapon's grip anchors. */
export function createArms(lib: Library | null, team: number) {
  const sleeve = new THREE.MeshStandardMaterial({ color: team === 0 ? '#4c5838' : '#9c8460', roughness: .92, metalness: 0, ...(lib ? { normalMap: tex(lib.surfaces.sandbag.normal, 3), normalScale: new THREE.Vector2(.8, .8) } : {}) });
  const glove = new THREE.MeshStandardMaterial({ color: '#2a2b2c', roughness: .78, metalness: 0, ...(lib ? { normalMap: tex(lib.surfaces.concreteFloor.normal, 4), normalScale: new THREE.Vector2(.4, .4) } : {}) });
  const knuckle = new THREE.MeshStandardMaterial({ color: '#1a1b1c', roughness: .6, metalness: .1 });
  const make = (side: 1 | -1) => {
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(.048, .2, 4, 12), sleeve);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(.04, .2, 4, 12), sleeve);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(.042, .045, .05, 12), glove);
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new RoundedBoxGeometry(.075, .028, .085, 2, .012), glove); palm.position.set(0, 0, -.01); hand.add(palm);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(.0095, .045, 3, 8), glove); f.position.set(-.028 + i * .019, -.018, -.06); f.rotation.x = 1.2; hand.add(f); const k = new THREE.Mesh(new RoundedBoxGeometry(.016, .008, .014, 1, .003), knuckle); k.position.set(-.028 + i * .019, .016, -.04); hand.add(k); }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(.011, .04, 3, 8), glove); thumb.position.set(side * .04, .0, -.02); thumb.rotation.set(.6, 0, side * -.9); hand.add(thumb);
    const group = new THREE.Group(); group.add(upper, fore, cuff, hand);
    return { group, upper, fore, cuff, hand, side };
  };
  return { right: make(1), left: make(-1) };
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
/** Two-bone IK: place an arm from shoulder to target with the elbow toward `pole`. */
export function poseArm(arm: ReturnType<typeof createArms>['right'], shoulder: THREE.Vector3, target: THREE.Vector3, targetQuat: THREE.Quaternion, pole: THREE.Vector3, l1 = .3, l2 = .28) {
  const d = Math.min(target.distanceTo(shoulder), l1 + l2 - 1e-3);
  const dir = _a.copy(target).sub(shoulder).normalize();
  const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const bend = _b.copy(pole).sub(shoulder); bend.sub(_c.copy(dir).multiplyScalar(bend.dot(dir))).normalize();
  const elbow = _d.copy(shoulder).addScaledVector(dir, Math.cos(a) * l1).addScaledVector(bend, Math.sin(a) * l1);
  const wrist = target;
  const segment = (mesh: THREE.Mesh, p: THREE.Vector3, q: THREE.Vector3) => { mesh.position.copy(p).add(q).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(UP, _c.copy(q).sub(p).normalize()); };
  segment(arm.upper, shoulder, elbow); segment(arm.fore, elbow, wrist);
  arm.cuff.position.copy(wrist).addScaledVector(_c.copy(elbow).sub(wrist).normalize(), .03); arm.cuff.quaternion.copy(arm.fore.quaternion);
  arm.hand.position.copy(wrist); arm.hand.quaternion.copy(targetQuat);
  void _q;
}
