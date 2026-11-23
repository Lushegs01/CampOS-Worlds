// A tiny geometry builder for the city's instanced models: parts are shaped, coloured and tagged with per-vertex
// attributes (colour, paint mask, lamp kind, roughness/metalness, body part), then merged into one geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface Tags { color?: string; paint?: number; lamp?: number; rough?: number; metal?: number; part?: number; slot?: number; opt?: number }
export class Builder {
  parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, m: THREE.Matrix4 | null, t: Tags = {}) {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    const n = geo.attributes.position.count, c = new THREE.Color(t.color ?? '#ffffff').convertSRGBToLinear();
    const fill = (size: number, v: number[]) => { const a = new Float32Array(n * size); for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) a[i * size + k] = v[k]; return new THREE.BufferAttribute(a, size); };
    geo.setAttribute('color', fill(3, [c.r, c.g, c.b]));
    geo.setAttribute('aTag', fill(4, [t.paint ?? 0, t.lamp ?? 0, t.rough ?? .6, t.metal ?? 0]));
    geo.setAttribute('aPart', fill(4, [t.part ?? 0, t.slot ?? 0, t.opt ?? 0, 0]));
    this.parts.push(geo);
    g.dispose();
    return this;
  }
  box(p: [number, number, number], s: [number, number, number], t: Tags = {}, rot?: [number, number, number]) {
    return this.add(new THREE.BoxGeometry(...s), mat(p, rot), t);
  }
  round(p: [number, number, number], s: [number, number, number], r: number, t: Tags = {}, rot?: [number, number, number]) {
    return this.add(new RoundedBoxGeometry(s[0], s[1], s[2], 2, Math.min(r, Math.min(...s) / 2 - .001)), mat(p, rot), t);
  }
  cyl(p: [number, number, number], r0: number, r1: number, h: number, seg: number, t: Tags = {}, rot?: [number, number, number]) {
    return this.add(new THREE.CylinderGeometry(r0, r1, h, seg), mat(p, rot), t);
  }
  sphere(p: [number, number, number], r: number, s: [number, number, number] = [1, 1, 1], t: Tags = {}, seg = 10) {
    const m = mat(p); m.scale(new THREE.Vector3(...s));
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg * .7 | 0)), m, t);
  }
  capsule(p: [number, number, number], r: number, len: number, t: Tags = {}, rot?: [number, number, number], s: [number, number, number] = [1, 1, 1]) {
    const m = mat(p, rot); m.scale(new THREE.Vector3(...s));
    return this.add(new THREE.CapsuleGeometry(r, len, 3, 8), m, t);
  }
  /** A tapered box: bottom w0×d0 at y0, top w1×d1 at y1 (top shifted forward by dz). Used for glasshouses. */
  taper(p: [number, number, number], w0: number, d0: number, w1: number, d1: number, h: number, dz: number, t: Tags = {}) {
    const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1), a = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      const top = a.getY(i) > 0, x = a.getX(i), z = a.getZ(i);
      a.setXYZ(i, x * (top ? w1 : w0), top ? h : 0, z * (top ? d1 : d0) + (top ? dz : 0));
    }
    g.computeVertexNormals();
    return this.add(g, mat(p), t);
  }
  build() { const g = mergeGeometries(this.parts, false)!; this.parts.forEach(p => p.dispose()); this.parts = []; g.computeBoundingSphere(); return g; }
}
export function mat(p: [number, number, number], rot?: [number, number, number]) {
  const m = new THREE.Matrix4();
  if (rot) m.makeRotationFromEuler(new THREE.Euler(...rot, 'YXZ'));
  m.setPosition(...p); return m;
}
