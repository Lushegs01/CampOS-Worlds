import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BUILDINGS, DISTRICTS, EXPANSION_TABLES, EXPANSION_PATHS, PARKING, STOPS, TURNAROUNDS, DRIVEWAYS, ROADS } from '../../shared/expansion.mjs';
import { player, useGame } from '../state';
import { Kit, flatRoof, hipRoof, windowUnit, wall, sunshade, fins, breezeScreen, waterTank, acUnit, downpipe, type V3 } from './architecture/kit';
import { sign, place } from './architecture/signage';
import { residentsWing } from './Dorm';
import { DORM_ROOM } from '../../shared/dorm.mjs';
import { CARRIAGEWAY, STRIPS, FILLETS, LIGHTS, KERB, KERB_TOP, SIDEWALK_TOP, ASPHALT_TOP, courtyardLot } from './roads';
import type { MaterialKey, Materials } from './materials';
import { freeze } from './rendering';

type Building = typeof BUILDINGS[number];
const T = .4; // wall thickness, as the shared colliders
function disposeGeometry(g: THREE.Group) { g.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); }
/** District palettes, softened towards the warm off-white of the courtyard's buildings. */
const tint = (b: Building, k = .55) => '#' + new THREE.Color(b.color).lerp(new THREE.Color('#f3ece0'), k).getHexString();
const ACCENT: Record<string, MaterialKey> = { academic: 'concrete', learning: 'brick', residential: 'breezePanel', recreation: 'ribbed', 'student-life': 'paintTerracotta', gateway: 'aluminium' };
const PITCHED = new Set(['residential', 'student-life', 'recreation']);
function storeys(b: Building) { const top = b.h - 1, ground = b.h >= 9 ? 4.2 : 3.6; return { top, ground }; }

// ------------------------------------------------------------------ buildings
/**
 * A two-storey open-plan campus building: plinth, rendered walls with real openings, a projecting
 * floor slab, sunshades and fins, rooftop tanks, and a lit ground-floor interior seen through the
 * storefront. Walls follow the shared colliders exactly (0.4 m thick, a 4 m entrance in front).
 */
function detailedBuilding(kit: Kit, b: Building) {
  const { top, ground } = storeys(b), hw = b.w / 2 + T / 2, hd = b.d / 2 + T / 2, accent = ACCENT[b.district], seed = b.x * .37 + b.z;
  // Evenly spaced openings centred on the facade.
  const row = (x0: number, x1: number, pitch: number, width: number, y0: number, y1: number) => { const n = Math.floor((x1 - x0 - 1.6) / pitch), start = (x0 + x1) / 2 - ((n - 1) * pitch + width) / 2; return Array.from({ length: n }, (_, k) => ({ x0: start + k * pitch, x1: start + k * pitch + width, y0, y1 })); };
  const upper = (x0: number, x1: number) => row(x0, x1, 3, 2.1, ground + .95, top - .7);
  const facade = (pos: V3, rot: number, x0: number, x1: number, kind: 'front' | 'back' | 'side') => kit.within(pos, rot, () => {
    const lower = kind === 'front'
      ? [{ x0: x0 + 1.4, x1: -2.9, y0: .55, y1: ground - .65 }, { x0: 2.9, x1: x1 - 1.4, y0: .55, y1: ground - .65 }]
      : row(x0, x1, 3.4, 1.6, 1.2, ground - .7);
    const door = kind === 'front' ? [{ x0: -2, x1: 2, y0: 0, y1: 3.1 }] : [];
    const ups = upper(x0, x1);
    wall(kit, 'stuccoTint', x0, x1, 0, top, T, [...lower, ...door, ...ups].map(o => ({ ...o })));
    kit.box('concrete', [(x0 + x1) / 2, .25, .04], [x1 - x0 + .1, .5, .08]); // plinth
    sunshade(kit, 'concrete', x0 - .1, x1 + .1, ground + .05, .55, .22);
    for (const o of lower) windowUnit(kit, o, { mullion: kind === 'front' ? 1.6 : 1, tint: kind === 'front' ? 'clear' : undefined, seed, frame: 'aluminium' });
    for (const o of ups) { windowUnit(kit, o, { mullion: 1.05, seed: seed + o.x0, frame: b.district === 'gateway' ? 'darkMetal' : 'aluminium' }); sunshade(kit, 'concrete', o.x0 - .25, o.x1 + .25, o.y1 + .22, .45, .1); }
    if (kind !== 'side') {
      if (accent === 'breezePanel') for (const o of ups.filter((_, i) => i % 3 === 1)) breezeScreen(kit, 'breezePanel', o.x0 - .3, o.x1 + .3, ground + .25, top - .05, .2);
      else if (accent === 'brick') for (const o of ups) kit.box('brick', [o.x0 - .45, (ground + top) / 2, .1], [.5, top - ground - .2, .2]);
      else fins(kit, accent, x0 + .6, x1 - .6, 3, .5, .16, ground + .2, top);
    }
    if (kind === 'side') { acUnit(kit, x0 + 3.2, ground + 1.2); acUnit(kit, x1 - 4.2, 1.9); downpipe(kit, x1 - .5, top); }
    if (kind === 'back') downpipe(kit, x0 + .5, top);
  });
  facade([b.x, 0, b.z + hd], 0, -hw, hw, 'front');
  facade([b.x, 0, b.z - hd], Math.PI, -hw, hw, 'back');
  facade([b.x + hw, 0, b.z], Math.PI / 2, -b.d / 2 + T / 2, b.d / 2 - T / 2, 'side');
  facade([b.x - hw, 0, b.z], -Math.PI / 2, -b.d / 2 + T / 2, b.d / 2 - T / 2, 'side');
  // Floors, ceiling and roof.
  kit.box('terrazzo', [b.x, .01, b.z], [b.w - T, .02, b.d - T]);
  kit.box('concrete', [b.x, ground + .1, b.z], [b.w - T, .2, b.d - T]);
  for (const dx of [-8, 0, 8]) for (const dz of [-6, 4]) kit.box('emissiveWarm', [b.x + dx, ground - .01, b.z + dz], [2.4, .02, .5], { shadow: false });
  if (PITCHED.has(b.district)) { flatRoof(kit, b.x - hw, b.x + hw, b.z - hd, b.z + hd, top, { slab: .25 }); hipRoof(kit, b.district === 'recreation' ? 'roofGreen' : 'roofRed', b.x - hw, b.x + hw, b.z - hd, b.z + hd, top + .25, .3, .9); }
  else { flatRoof(kit, b.x - hw, b.x + hw, b.z - hd, b.z + hd, top, { parapet: .75, eave: .15 }); waterTank(kit, b.x + 9, top + .35, b.z - 7, '#27384a'); waterTank(kit, b.x + 11.2, top + .35, b.z - 7, '#2f2f2f'); kit.box('paintWhite', [b.x - 8, top + .75, b.z - 4], [2.2, .8, 1.4]); }
  // Entrance: canopy on two columns, steps up from the walk, glazed sliding doors left open.
  kit.box('concrete', [b.x, 3.55, b.z + hd + 2.2], [7.5, .22, 4.4]);
  for (const x of [-3.4, 3.4]) kit.box('paintDark', [b.x + x, 1.75, b.z + hd + 4.1], [.2, 3.5, .2]);
  kit.box('granite', [b.x, .03, b.z + hd + 2], [7, .06, 4]);
  for (const x of [-2.6, 2.6]) { kit.add('glassClear', new THREE.PlaneGeometry(1.2, 2.9), { matrix: new THREE.Matrix4().makeTranslation(b.x + x, 1.5, b.z + hd + .04), shadow: false }); kit.box('aluminium', [b.x + x, 2.98, b.z + hd + .04], [1.3, .06, .08]); }
  // Interior tables (the seats are the shared interactive chairs).
  for (const t of EXPANSION_TABLES.filter(t => Math.abs(t.x - b.x) < 14 && Math.abs(t.z - b.z) < 12)) {
    kit.box('wood', [t.x, .75, t.z], [t.w, .05, t.d]); for (const dx of [-.7, .7]) for (const dz of [-.22, .22]) kit.box('darkMetal', [t.x + dx, .37, t.z + dz], [.04, .73, .04]);
  }
  kit.box('paintGreen', [b.x, 1.9, b.z - b.d / 2 + .25], [9, 2, .07]);
}
/** Far-field shell: the same massing and window rhythm, a handful of boxes per building. */
function shellBuilding(kit: Kit, b: Building) {
  const { top, ground } = storeys(b), hw = b.w / 2 + T, hd = b.d / 2 + T, col = tint(b);
  kit.box('stuccoTint', [b.x, top / 2, b.z], [hw * 2, top, hd * 2], { color: col });
  kit.box('concrete', [b.x, ground + .05, b.z], [hw * 2 + 1.1, .22, hd * 2 + 1.1]);
  for (const [w, d] of [[hw * 2 - 2.4, hd * 2 + .04], [hw * 2 + .04, hd * 2 - 2.4]]) { kit.box('glass', [b.x, (ground + top) / 2 + .1, b.z], [w, top - ground - 1.6, d], { color: '#24363d', shadow: false }); kit.box('glass', [b.x, ground / 2, b.z], [w, ground - 1.6, d], { color: '#2b3d42', shadow: false }); }
  if (PITCHED.has(b.district)) hipRoof(kit, b.district === 'recreation' ? 'roofGreen' : 'roofRed', b.x - hw, b.x + hw, b.z - hd, b.z + hd, top, .3, .9);
  else flatRoof(kit, b.x - hw, b.x + hw, b.z - hd, b.z + hd, top, { parapet: .75 });
  kit.box('concrete', [b.x, 3.55, b.z + hd + 2.2], [7.5, .22, 4.4]);
}

function districtDetail(id: string, lib: Materials) {
  const kit = new Kit(), g = new THREE.Group(), district = DISTRICTS.find(d => d.id === id)!;
  for (const b of BUILDINGS.filter(b => b.district === id)) {
    tintedKit(kit, tint(b), () => detailedBuilding(kit, b));
    g.add(place(sign({ text: b.name, kind: 'panel', width: 7, height: .7, background: '#233e34', color: '#f7ead2' }), [b.x, 3.1, b.z + b.d / 2 + T + 4.42]));
    g.add(place(sign({ text: id === 'academic' || id === 'learning' ? 'SHARED LEARNING · DEMONSTRATION' : 'WELCOME · COMMON ROOM', kind: 'panel', width: 7, height: .5, background: '#233e34', color: '#f7ead2' }), [b.x, 2.3, b.z - b.d / 2 + .3]));
  }
  // Palm House: the residents' wing with everyone's own room (src/world/Dorm.tsx, shared/dorm.mjs).
  if (id === 'residential') for (const s of residentsWing(kit)) g.add(s);
  // Shuttle stop: steel frame, translucent roof, back screen, bench and timetable.
  const stop = STOPS.find(s => s.id === id)!;
  kit.within([stop.x, 0, stop.z], 0, () => {
    kit.box('granite', [0, .05, 0], [7.4, .1, 3.2]);
    for (const x of [-3.2, 3.2]) { kit.box('darkMetal', [x, 1.4, 1.2], [.1, 2.8, .1]); kit.box('darkMetal', [x, 1.25, -1.2], [.1, 2.5, .1]); }
    kit.box('darkMetal', [0, 2.62, 0], [7, .1, 2.8], { rotX: .08 }); kit.box('glassClear', [0, 2.7, 0], [6.8, .03, 2.7], { rotX: .08, shadow: false });
    kit.box('glassClear', [0, 1.4, 1.22], [6.3, 2.1, .03], { shadow: false }); kit.box('darkMetal', [0, .32, 1.22], [6.4, .06, .06]);
    kit.box('wood', [0, .48, .85], [5, .06, .45]); for (const x of [-2.2, 0, 2.2]) kit.box('darkMetal', [x, .23, .85], [.06, .46, .4]);
  });
  g.add(place(sign({ text: `${district.name}\nSHUTTLE STOP · communal fleet`, kind: 'panel', width: 3.2, height: .9, background: '#234738', color: '#f7ead2' }), [stop.x + 1.4, 1.6, stop.z + 1.18], Math.PI));
  if (id === 'recreation') {
    const x = district.x - 100, z = district.z - 90;
    kit.box('courtGreen', [x, .012, z], [72, .02, 109]);
    for (const dx of [-34, 34]) kit.box('lineWhite', [x + dx, .03, z], [.12, .02, 105]);
    for (const dz of [-52.5, 0, 52.5]) kit.box('lineWhite', [x, .03, z + dz], [68, .02, .12]);
    kit.add('lineWhite', new THREE.RingGeometry(9.1, 9.22, 64).rotateX(-Math.PI / 2).translate(x, .031, z));
    for (const s of [-1, 1]) { kit.box('lineWhite', [x, .03, z + s * (52.5 - 16.5)], [40.3, .02, .12]); for (const dx of [-20.15, 20.15]) kit.box('lineWhite', [x + dx, .03, z + s * (52.5 - 8.25)], [.12, .02, 16.5]); }
    for (const dz of [-52.5, 52.5]) { for (const dx of [-3.66, 3.66]) kit.box('paintWhite', [x + dx, 1.22, z + dz], [.12, 2.44, .12]); kit.box('paintWhite', [x, 2.44, z + dz], [7.44, .12, .12]); }
  }
  g.add(kit.build(lib, `district:${id}`)); return freeze(g);
}
/** Wraps Kit.add so every part added inside `fn` that uses the tinted stucco gets the given vertex colour. */
function tintedKit(kit: Kit, color: string, fn: () => void) {
  const add = kit.add.bind(kit);
  kit.add = (mat, geometry, o = {}) => add(mat, geometry, mat === 'stuccoTint' && !o.color ? { ...o, color } : o);
  try { fn(); } finally { kit.add = add; }
}
function districtShells(id: string, lib: Materials) {
  const kit = new Kit();
  for (const b of BUILDINGS.filter(b => b.district === id)) shellBuilding(kit, b);
  if (id === 'residential') kit.box('stucco', [(DORM_ROOM.x0 + DORM_ROOM.x1) / 2, 1.75, (DORM_ROOM.z0 + DORM_ROOM.z1) / 2 - .2], [DORM_ROOM.x1 - DORM_ROOM.x0 + .6, 3.5, DORM_ROOM.z1 - DORM_ROOM.z0 + .5]);
  return freeze(kit.build(lib, `district-far:${id}`));
}

function District({ id, lib }: { id: string; lib: Materials }) {
  const [near, setNear] = useState(false), elapsed = useRef(0), quality = useGame(s => s.quality), d = DISTRICTS.find(d => d.id === id)!;
  const shells = useMemo(() => districtShells(id, lib), [id, lib]);
  useEffect(() => () => disposeGeometry(shells), [shells]);
  useFrame((_, dt) => { elapsed.current += dt; if (elapsed.current < .5) return; elapsed.current = 0; const range = quality === 'low' ? 230 : 360; const distance = Math.hypot(player.x - d.x - 96, player.z - d.z + 30); setNear(old => distance < (old ? range + 70 : range)); });
  return near ? <Detail id={id} lib={lib} /> : <primitive object={shells} />;
}
function Detail({ id, lib }: { id: string; lib: Materials }) { const g = useMemo(() => districtDetail(id, lib), [id, lib]); useEffect(() => () => disposeGeometry(g), [g]); return <primitive object={g} />; }

// ------------------------------------------------------------------ roads
function quarterFillet(kit: Kit, f: typeof FILLETS[number]) {
  // The square between two arms minus a quarter disc centred on its outer corner: a curb return.
  const W = 4, p0 = [f.x + f.qx * W, f.z + f.qz * W], c = [f.x + f.qx * (W + f.r), f.z + f.qz * (W + f.r)], steps = 12, pos: number[] = [];
  const arc = (a: number, r: number) => [c[0] - f.qx * r * Math.sin(a), c[1] - f.qz * r * Math.cos(a)];
  for (let i = 0; i < steps; i++) {
    const a = arc(i / steps * Math.PI / 2, f.r), b = arc((i + 1) / steps * Math.PI / 2, f.r);
    // Wind each triangle so it faces up (+y) whatever the quadrant.
    const cross = (a[0] - p0[0]) * (b[1] - p0[1]) - (a[1] - p0[1]) * (b[0] - p0[0]);
    const [u, v] = cross < 0 ? [a, b] : [b, a];
    pos.push(p0[0], ASPHALT_TOP + .002, p0[1], u[0], ASPHALT_TOP + .002, u[1], v[0], ASPHALT_TOP + .002, v[1]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  kit.add('asphalt', g, { shadow: false });
  const rr = f.r - KERB / 2, len = rr * Math.PI / 2 / steps + .03;
  for (let i = 0; i < steps; i++) { const a = (i + .5) / steps * Math.PI / 2, [x, z] = arc(a, rr); kit.box('brushed', [x, KERB_TOP / 2, z], [KERB, KERB_TOP, len], { rotY: Math.atan2(-f.qx * Math.cos(a), f.qz * Math.sin(a)) }); }
}
function buildNetwork(lib: Materials) {
  const k = new Kit(), slab = (mat: MaterialKey, r: { x0: number; x1: number; z0: number; z1: number }, top: number, base = 0, o = {}) => k.box(mat, [(r.x0 + r.x1) / 2, (top + base) / 2, (r.z0 + r.z1) / 2], [r.x1 - r.x0, top - base, r.z1 - r.z0], { shadow: false, ...o });
  for (const r of CARRIAGEWAY) slab('asphalt', r, ASPHALT_TOP, -.05);
  for (const f of FILLETS) quarterFillet(k, f);
  for (const t of TURNAROUNDS) {
    k.add('asphalt', new THREE.CircleGeometry(t.r, 40).rotateX(-Math.PI / 2).translate(t.x, ASPHALT_TOP + .001, t.z), { shadow: false });
    const road = ROADS.find(r => (r.a.x === t.x && r.a.z === t.z) || (r.b.x === t.x && r.b.z === t.z))!, other = road.a.x === t.x && road.a.z === t.z ? road.b : road.a;
    const entry = Math.atan2(Math.sign(other.x - t.x), Math.sign(other.z - t.z));
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, d = Math.atan2(Math.sin(a - entry), Math.cos(a - entry)); if (Math.abs(d) < .45) continue; const rr = t.r + KERB / 2; k.box('brushed', [t.x + Math.sin(a) * rr, KERB_TOP / 2, t.z + Math.cos(a) * rr], [KERB, KERB_TOP, rr * Math.PI * 2 / 48 + .03], { rotY: a + Math.PI / 2 }); }
  }
  for (const s of STRIPS) {
    if (s.kind === 'kerb') slab('brushed', s, KERB_TOP, 0, { shadow: true });
    else if (s.kind === 'sidewalk') slab('paversGrey', s, SIDEWALK_TOP, -.02);
    else slab('lineWhite', s, ASPHALT_TOP + .004, ASPHALT_TOP);
  }
  for (const p of PARKING) slab('asphalt', { x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 }, ASPHALT_TOP - .002, -.05);
  for (const d of DRIVEWAYS) slab('asphalt', { x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - d.d / 2, z1: d.z + d.d / 2 }, ASPHALT_TOP - .003, -.05);
  slab('asphalt', courtyardLot, ASPHALT_TOP - .004, -.05);
  for (const p of EXPANSION_PATHS) slab('pavers', { x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 }, .05, -.02);
  for (const p of PARKING) { slab('brushed', { x0: p.x - p.w / 2 - KERB, x1: p.x + p.w / 2 + KERB, z0: p.z + p.d / 2, z1: p.z + p.d / 2 + KERB }, KERB_TOP, 0, { shadow: true }); }
  return freeze(k.build(lib, 'campus-roads'));
}

/** Street lights: one instanced draw for the steelwork and one for the lamp lenses. */
function StreetLights({ lib }: { lib: Materials }) {
  const meshes = useMemo(() => {
    const parts = [new THREE.CylinderGeometry(.065, .1, 8, 8).translate(0, 4, 0), new THREE.BoxGeometry(.07, .07, 1.7).translate(0, 7.92, .82), new THREE.BoxGeometry(.32, .12, .62).translate(0, 7.88, 1.55), new THREE.CylinderGeometry(.16, .2, .5, 8).translate(0, .25, 0)].map(g => g.toNonIndexed());
    const steel = new THREE.BufferGeometry(); const merged = parts.reduce((acc, g) => { for (const k of ['position', 'normal'] as const) acc[k].push(...(g.getAttribute(k).array as Float32Array)); return acc; }, { position: [] as number[], normal: [] as number[] });
    steel.setAttribute('position', new THREE.Float32BufferAttribute(merged.position, 3)); steel.setAttribute('normal', new THREE.Float32BufferAttribute(merged.normal, 3));
    const lens = new THREE.PlaneGeometry(.26, .5).rotateX(Math.PI / 2).translate(0, 7.81, 1.58);
    const a = new THREE.InstancedMesh(steel, lib.steel, LIGHTS.length), b = new THREE.InstancedMesh(lens, lib.emissiveWarm, LIGHTS.length), o = new THREE.Object3D();
    LIGHTS.forEach((l, i) => { o.position.set(l.x, 0, l.z); o.rotation.y = l.yaw; o.updateMatrix(); a.setMatrixAt(i, o.matrix); b.setMatrixAt(i, o.matrix); });
    a.castShadow = true; a.name = 'street-lights'; b.name = 'street-lights:lens';
    for (const m of [a, b]) { m.computeBoundingSphere(); freeze(m); }
    return [a, b];
  }, [lib]);
  useEffect(() => () => meshes.forEach(m => { m.geometry.dispose(); m.dispose(); }), [meshes]);
  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>;
}

export default function Expansion({ lib }: { lib: Materials }) {
  const network = useMemo(() => buildNetwork(lib), [lib]);
  useEffect(() => () => disposeGeometry(network), [network]);
  return <group name="open-world" matrixAutoUpdate={false}><primitive object={network} /><StreetLights lib={lib} />{DISTRICTS.map(d => <District key={d.id} id={d.id} lib={lib} />)}</group>;
}
