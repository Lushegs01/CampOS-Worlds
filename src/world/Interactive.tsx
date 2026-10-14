import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DOORS, SEATS, LIBRARY_COMPUTERS } from '../../shared/interactions.mjs';
import { BALL_R } from '../../shared/ball.mjs';
import { doorOpen } from '../../shared/campus.mjs';
import type { Materials } from './materials';
import { loadModel } from './assets';
import { surfaceHeight } from './layout';
import { chairPull } from '../avatar/Avatar';
import { avatars } from '../avatar/registry';
import { selfIdNow, tickWorld, world } from '../interaction/world';
import { sfx } from '../interaction/sound';
import { registerMovingCaster } from './shadows';

// Everything players can move: hinged doors, table chairs and basketballs. State comes from the
// shared world (server-authoritative online, local rules offline); this file only presents it.

// ------------------------------------------------------------------ doors
const OPEN_ANGLE = 1.45; // ~83°: the leaf stops short of the wall
function leafMeshes(lib: Materials, len: number, height: number, glass: boolean, dir: number) {
  const g = new THREE.Group(), box = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const c = dir * len / 2;
  if (glass) {
    // Bronze-framed glass leaf with a horizontal push bar on both faces.
    const s = .06;
    box(lib.bronzeFrame, dir * s / 2, height / 2, 0, s, height, .05); box(lib.bronzeFrame, dir * (len - s / 2), height / 2, 0, s, height, .05);
    box(lib.bronzeFrame, c, height - .04, 0, len, .08, .05); box(lib.bronzeFrame, c, .07, 0, len, .14, .05);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len - 2 * s, height - .22), lib.glassClear); pane.position.set(c, height / 2 + .03, 0); g.add(pane);
    const back = pane.clone(); back.rotation.y = Math.PI; g.add(back);
    for (const z of [-.06, .06]) { box(lib.chrome, dir * (len * .55), 1.05, z, len * .7, .035, .035); for (const x of [len * .22, len * .88]) box(lib.chrome, dir * x, 1.05, z * .6, .025, .025, .05); }
  } else {
    // Painted timber leaf with a narrow vision panel and lever handles.
    box(lib.paintGreen, c, height / 2, 0, len - .02, height, .045);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(.18, .7), lib.glassClear); pane.position.set(dir * (len - .3), 1.55, .024); g.add(pane);
    const back = pane.clone(); back.rotation.y = Math.PI; back.position.z = -.024; g.add(back);
    for (const z of [-.05, .05]) { box(lib.chrome, dir * (len - .1), 1.02, z, .03, .03, .05); box(lib.chrome, dir * (len - .16), 1.02, z * 1.35, .14, .022, .022); }
  }
  return g;
}

export function Doors({ lib, distance }: { lib: Materials; distance: number }) {
  const doors = useMemo(() => DOORS.filter(d => !d.locked).map(d => {
    const group = new THREE.Group(); group.name = `door:${d.id}`;
    const y = surfaceHeight(d.x, d.z - .05);
    const leaves = d.leaves.map(l => { const pivot = new THREE.Group(); pivot.position.set(l.hx, y, l.hz); pivot.add(leafMeshes(lib, l.len, d.height, d.glass, l.dir)); group.add(pivot); return { pivot, dir: l.dir }; });
    return { d, group, leaves, angle: 0, vel: 0, open: 0, latched: true };
  }), [lib]);
  useEffect(() => { const off = doors.map(s => registerMovingCaster(s.group)); return () => off.forEach(f => f()); }, [doors]);
  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, .05);
    for (const s of doors) {
      s.group.visible = Math.hypot(camera.position.x - s.d.x, camera.position.z - s.d.z) < distance;
      const open = doorOpen[s.d.id] ?? 0;
      if (open && !s.open) { sfx('door-open', s.d); s.latched = false; }
      s.open = open;
      // A door closer: a slightly overdamped spring towards the target angle (signed by swing side).
      const k = 26, c = 2 * Math.sqrt(k) * 1.1, steps = Math.ceil(dt / .008), h = dt / steps;
      for (let i = 0; i < steps; i++) { s.vel += (k * (open * OPEN_ANGLE - s.angle) - c * s.vel) * h; s.angle += s.vel * h; }
      if (!open && !s.latched && Math.abs(s.angle) < .04) { s.latched = true; sfx('door-close', s.d); }
      for (const l of s.leaves) l.pivot.rotation.y = -l.dir * s.angle;
    }
  });
  return <>{doors.map(s => <primitive key={s.d.id} object={s.group} />)}</>;
}

// ------------------------------------------------------------------ chairs
type ChairModel = 'schoolChair' | 'monobloc';
const CHAIRS = SEATS.filter(s => s.kind === 'chair') as (typeof SEATS[number] & { model: ChairModel; pull: number })[];
/** Free-standing chairs from the shared seat list. Table chairs slide as their sitter scoots in and out. */
export function Chairs({ distance }: { distance: number }) {
  const [models, setModels] = useState<Partial<Record<ChairModel, GLTF>>>({});
  useEffect(() => { let alive = true; for (const m of ['schoolChair', 'monobloc'] as const) loadModel(`props/${m}.glb`).then(g => { if (alive) setModels(v => ({ ...v, [m]: g })); }); return () => { alive = false; }; }, []);
  const sets = useMemo(() => (Object.entries(models) as [ChairModel, GLTF][]).flatMap(([key, gltf]) => {
    const cells = new Map<string, typeof CHAIRS>();
    for (const s of CHAIRS.filter(s => s.model === key)) { const cell = `${Math.floor(s.x / 16)},${Math.floor(s.z / 16)}`; if (!cells.has(cell)) cells.set(cell, []); cells.get(cell)!.push(s); }
    gltf.scene.updateMatrixWorld(true);
    const parts: THREE.Mesh[] = []; gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh); });
    return [...cells.values()].map(list => {
      const meshes = parts.map(p => { const m = new THREE.InstancedMesh(p.geometry, p.material, list.length); m.castShadow = true; m.receiveShadow = true; m.name = `chairs:${key}`; return { m, local: p.matrixWorld.clone() }; });
      const centre = new THREE.Vector3(list.reduce((a,s)=>a+s.x,0)/list.length, 0, list.reduce((a,s)=>a+s.z,0)/list.length);
      return { list, meshes, centre, last: new Float32Array(list.length).fill(-1) };
    });
  }), [models]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0) }), []);
  useEffect(() => { const off = sets.flatMap(s => s.meshes.map(({ m }) => registerMovingCaster(m))); return () => off.forEach(f => f()); }, [sets]);
  useFrame(({ camera }) => {
    for (const set of sets) {
      const visible = Math.hypot(camera.position.x - set.centre.x, camera.position.z - set.centre.z) < distance + 10;
      for (const { m } of set.meshes) m.visible = visible;
      let dirty = false;
      set.list.forEach((s, i) => {
        const k = chairPull.get(s.id) ?? 1;
        if (set.last[i] === k) return;
        set.last[i] = k; dirty = true;
        const back = s.pull * k;
        tmp.p.set(s.x - Math.sin(s.yaw) * back, surfaceHeight(s.x, s.z), s.z - Math.cos(s.yaw) * back);
        tmp.m.compose(tmp.p, tmp.q.setFromAxisAngle(tmp.up, s.yaw), tmp.one);
        for (const { m, local } of set.meshes) m.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(tmp.m, local));
      });
      if (dirty) for (const { m } of set.meshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    }
  });
  return <>{sets.flatMap(s => s.meshes.map(({ m }) => <primitive key={m.uuid} object={m} />))}</>;
}

// ------------------------------------------------------------------ basketballs
let ballTexture: THREE.CanvasTexture | null = null;
/** Pebbled orange leather with the eight black channels of a regulation ball (equirectangular). */
function basketballTexture() {
  if (ballTexture) return ballTexture;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d')!;
  x.fillStyle = '#c4622d'; x.fillRect(0, 0, 512, 256);
  const img = x.getImageData(0, 0, 512, 256), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * 26; d[i] += n; d[i + 1] += n * .7; d[i + 2] += n * .5; }
  x.putImageData(img, 0, 0);
  x.strokeStyle = '#1b1410'; x.lineWidth = 5;
  x.beginPath(); x.moveTo(0, 128); x.lineTo(512, 128); x.stroke();
  for (const u of [0, 128, 256, 384, 512]) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, 256); x.stroke(); }
  // The two curved channels: in latitude/longitude they trace a sine across the ball.
  for (const phase of [0, Math.PI]) { x.beginPath(); for (let u = 0; u <= 512; u += 4) { const v = 128 + Math.sin(u / 512 * Math.PI * 2 * 2 + phase) * 78; if (u === 0) x.moveTo(u, v); else x.lineTo(u, v); } x.stroke(); }
  ballTexture = new THREE.CanvasTexture(c); ballTexture.colorSpace = THREE.SRGBColorSpace; ballTexture.anisotropy = 4;
  return ballTexture;
}

export function Balls() {
  const balls = useMemo(() => world.balls.map(b => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 18), new THREE.MeshStandardMaterial({ map: basketballTexture(), roughness: .72, metalness: 0 }));
    mesh.castShadow = true; mesh.name = `ball:${b.id}`; mesh.position.set(b.x, b.y, b.z);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(.16, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: .32, depthWrite: false, toneMapped: false }));
    blob.renderOrder = 1;
    return { id: b.id, mesh, blob, offset: new THREE.Vector3(), prev: new THREE.Vector3(b.x, b.y, b.z), state: b.state };
  }), []);
  const tmp = useMemo(() => ({ target: new THREE.Vector3(), axis: new THREE.Vector3(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) }), []);
  useEffect(() => { const off = balls.map(v => registerMovingCaster(v.mesh)); return () => off.forEach(f => f()); }, [balls]);
  useFrame((_, raw) => {
    const dt = Math.min(raw, .05);
    tickWorld(dt);
    for (const v of balls) {
      const b = world.balls.find(x => x.id === v.id)!; if (!b) continue;
      const holder = b.state === 'held' ? avatars.get(b.holder === selfIdNow() ? 'local' : b.holder ?? '') : undefined;
      if (holder?.holding) tmp.target.copy(holder.ball); else tmp.target.set(b.x, b.y, b.z);
      // Hide discontinuities (pick-ups, releases, network corrections) behind a quickly decaying offset.
      if (b.state !== v.state) { v.offset.add(v.mesh.position).sub(tmp.target); if (v.offset.length() > 2.5) v.offset.set(0, 0, 0); v.state = b.state; }
      v.offset.multiplyScalar(Math.exp(-dt * (b.state === 'held' ? 16 : 10)));
      v.mesh.position.copy(tmp.target).add(v.offset);
      // Roll with the distance travelled; a released shot carries backspin.
      const dx = v.mesh.position.x - v.prev.x, dz = v.mesh.position.z - v.prev.z, dist = Math.hypot(dx, dz);
      if (dist > 1e-4 && dist < 1) { tmp.axis.set(dz, 0, -dx).normalize(); v.mesh.quaternion.premultiply(tmp.q.setFromAxisAngle(tmp.axis, (b.state === 'flight' ? -1.2 : 1) * dist / BALL_R)); }
      v.prev.copy(v.mesh.position);
      const ground = surfaceHeight(v.mesh.position.x, v.mesh.position.z), lift = Math.max(0, v.mesh.position.y - ground - BALL_R);
      v.blob.position.set(v.mesh.position.x, ground + .015, v.mesh.position.z);
      v.blob.scale.setScalar(1 + lift * .25); (v.blob.material as THREE.MeshBasicMaterial).opacity = .32 / (1 + lift * 1.6);
    }
  });
  return <>{balls.map(v => <group key={v.id}><primitive object={v.mesh} /><primitive object={v.blob} /></group>)}</>;
}

// ------------------------------------------------------------------ library computers
function screenTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 320; const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 320); g.addColorStop(0, '#1d3b31'); g.addColorStop(1, '#10241d'); x.fillStyle = g; x.fillRect(0, 0, 512, 320);
  x.fillStyle = '#e9c46a'; x.font = '600 30px "Manrope Variable", sans-serif'; x.fillText('Adunni Library', 34, 64);
  x.fillStyle = '#d8e4dc'; x.font = '400 19px "DM Sans Variable", sans-serif'; x.fillText('Search the catalogue', 34, 100);
  x.fillStyle = '#f5f1e6'; x.fillRect(34, 124, 444, 44); x.fillStyle = '#7d8a83'; x.fillText('Title, author or subject…', 50, 153);
  x.fillStyle = 'rgba(233,196,106,.85)'; for (let i = 0; i < 3; i++) x.fillRect(34, 196 + i * 34, 300 - i * 60, 14);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function Computers() {
  const material = useMemo(() => new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false }), []);
  return <>{LIBRARY_COMPUTERS.map(c => <mesh key={c.id} material={material} position={[c.x - .156, surfaceHeight(c.x, c.z) + 1.03, c.z]} rotation-y={Math.PI / 2}><planeGeometry args={[.5, .31]} /></mesh>)}</>;
}

