// Combat Arena effects: GPU-instanced particle systems (one draw call each for additive light —
// sparks, flashes, fire — and for alpha smoke and dust), bullet-hole decals that differ by surface,
// streak tracers, and an explosion light. All pooled and preallocated: a firefight allocates nothing.
import * as THREE from 'three';
import { softTexture } from './world';
import type { SurfaceKind } from './environment';

const VERT = /* glsl */`
attribute vec4 aColor; attribute vec4 aData; // data: size, rotation, stretch, unused
varying vec4 vColor; varying vec2 vUv;
void main() {
  vUv = uv; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  float c = cos(aData.y), s = sin(aData.y);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aData.x;
  p.y *= 1.0 + aData.z;
  mv.xy += p;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform sampler2D map; uniform float uLight; varying vec4 vColor; varying vec2 vUv;
void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(vColor.rgb * t.rgb * uLight, vColor.a * t.a); if (gl_FragColor.a < .003) discard; }`;

/** Where debris lands: the surface under (x, z) at or below y (the arena's maps set this; flat ground by default). */
export type Ground = (x: number, y: number, z: number) => number;
let ground: Ground = () => 0;
export function setEffectsGround(fn: Ground | null) { ground = fn ?? (() => 0); }

/** Smoke and dust: a soft, irregular puff (several overlapping blobs with ragged edges), not a perfect disc. */
let puff: THREE.Texture | null = null;
export function puffTexture() {
  if (puff) return puff;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!;
  const rnd = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.283, d = Math.pow(rnd(), .7) * S * .26, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, r = S * (.1 + rnd() * .16);
    const grad = g.createRadialGradient(x, y, 0, x, y, r); grad.addColorStop(0, `rgba(255,255,255,${.22 + rnd() * .2})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
  }
  // Fade to nothing at the edge of the quad.
  const img = g.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - S / 2 + .5, y - S / 2 + .5) / (S / 2), k = Math.max(0, 1 - d * d), i = (y * S + x) * 4 + 3; img.data[i] = Math.min(255, img.data[i] * 1.6 * k); }
  g.putImageData(img, 0, 0);
  puff = new THREE.CanvasTexture(c); return puff;
}
/** A muzzle flash: a hot core and uneven petals of flame (drawn once; rotated and scaled per shot). */
let flash: THREE.Texture | null = null;
export function flashTexture() {
  if (flash) return flash;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * .22); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(.4, 'rgba(255,240,200,.7)'); core.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = core; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * 6.283 + (i % 2) * .3, len = S * (.3 + (i * 37 % 11) / 11 * .18), w = S * .05;
    g.save(); g.translate(S / 2, S / 2); g.rotate(a);
    const grad = g.createLinearGradient(0, 0, len, 0); grad.addColorStop(0, 'rgba(255,230,170,.9)'); grad.addColorStop(.5, 'rgba(255,170,80,.45)'); grad.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grad; g.beginPath(); g.moveTo(0, -w); g.quadraticCurveTo(len * .5, -w * .6, len, 0); g.quadraticCurveTo(len * .5, w * .6, 0, w); g.closePath(); g.fill(); g.restore();
  }
  flash = new THREE.CanvasTexture(c); return flash;
}

type P = { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; age: number; size: number; grow: number; rot: number; spin: number; r: number; g: number; b: number; a: number; drag: number; gravity: number; stretch: number; floor: number };
class Particles {
  mesh: THREE.InstancedMesh; private ps: P[]; private color: THREE.InstancedBufferAttribute; private data: THREE.InstancedBufferAttribute; private next = 0; private m = new THREE.Matrix4();
  constructor(count: number, additive: boolean) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); this.data = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.color.setUsage(THREE.DynamicDrawUsage); this.data.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aColor', this.color); geo.setAttribute('aData', this.data);
    // Light particles glow by themselves; smoke and dust take the scene's ambient level (uLight) so they are not bright at night.
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: additive ? softTexture() : puffTexture() }, uLight: { value: 1 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, count); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 6 : 5;
    this.ps = Array.from({ length: count }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, age: 0, size: .1, grow: 0, rot: 0, spin: 0, r: 1, g: 1, b: 1, a: 1, drag: 0, gravity: 0, stretch: 0, floor: 0 }));
    for (let i = 0; i < count; i++) { this.m.makeTranslation(0, -999, 0); this.mesh.setMatrixAt(i, this.m); }
  }
  emit(o: Partial<P> & { x: number; y: number; z: number }) { const p = this.ps[this.next]; this.next = (this.next + 1) % this.ps.length; Object.assign(p, { alive: true, age: 0, vx: 0, vy: 0, vz: 0, life: 1, size: .1, grow: 0, rot: Math.random() * 6.28, spin: 0, r: 1, g: 1, b: 1, a: 1, drag: 0, gravity: 0, stretch: 0 }, o); p.floor = o.gravity ? ground(o.x, o.y + .05, o.z) : -1e9; }
  update(dt: number) {
    const c = this.color.array as Float32Array, d = this.data.array as Float32Array;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      if (!p.alive) { if (c[i * 4 + 3] !== 0) { c[i * 4 + 3] = 0; this.m.makeTranslation(0, -999, 0); this.mesh.setMatrixAt(i, this.m); } continue; }
      p.age += dt; if (p.age >= p.life) { p.alive = false; continue; }
      const k = p.age / p.life, damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vy = p.vy * damp - p.gravity * dt; p.vz *= damp; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor + .02 && p.gravity > 0) { p.y = p.floor + .02; p.vy *= -.3; p.vx *= .5; p.vz *= .5; }
      p.rot += p.spin * dt;
      this.m.makeTranslation(p.x, p.y, p.z); this.mesh.setMatrixAt(i, this.m);
      const fade = k < .1 ? k / .1 : 1 - (k - .1) / .9;
      c[i * 4] = p.r; c[i * 4 + 1] = p.g; c[i * 4 + 2] = p.b; c[i * 4 + 3] = p.a * fade;
      d[i * 4] = p.size + p.grow * p.age; d[i * 4 + 1] = p.rot; d[i * 4 + 2] = p.stretch;
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.color.needsUpdate = true; this.data.needsUpdate = true;
  }
}

/** Bullet holes: instanced quads lying on the hit surface; the look depends on the material. */
function holeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30); grad.addColorStop(0, 'rgba(10,9,8,1)'); grad.addColorStop(.18, 'rgba(25,22,20,.95)'); grad.addColorStop(.3, 'rgba(70,64,58,.6)'); grad.addColorStop(.55, 'rgba(120,112,100,.25)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(20,18,16,.6)'; g.lineWidth = 1;
  for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28 + Math.random() * .5; g.beginPath(); g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); g.lineTo(32 + Math.cos(a) * (12 + Math.random() * 14), 32 + Math.sin(a) * (12 + Math.random() * 14)); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
class Decals {
  mesh: THREE.InstancedMesh; private i = 0; private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private n = new THREE.Vector3();
  constructor(count: number) {
    const mat = new THREE.MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: .9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count); this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    for (let k = 0; k < count; k++) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(k, this.m); }
  }
  add(at: THREE.Vector3, normal: THREE.Vector3, size: number, tint: THREE.Color) {
    this.n.copy(normal).normalize();
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    this.m.compose(at.clone().addScaledVector(this.n, .004), this.q, this.s.setScalar(size));
    this.mesh.setMatrixAt(this.i, this.m); this.mesh.setColorAt(this.i, tint); this.i = (this.i + 1) % this.mesh.count;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true;
  }
}

const IMPACT: Record<SurfaceKind, { dust: [number, number, number]; sparks: number; chips: number; tint: string; hole: number }> = {
  concrete: { dust: [.72, .7, .66], sparks: 0, chips: 5, tint: '#ffffff', hole: .09 },
  brick: { dust: [.66, .44, .36], sparks: 0, chips: 5, tint: '#d9b0a0', hole: .1 },
  metal: { dust: [.32, .3, .28], sparks: 9, chips: 0, tint: '#9aa0a8', hole: .055 },
  wood: { dust: [.6, .46, .3], sparks: 0, chips: 6, tint: '#b49070', hole: .07 },
  sand: { dust: [.78, .68, .5], sparks: 0, chips: 0, tint: '#ffffff', hole: 0 },
  dirt: { dust: [.55, .47, .38], sparks: 0, chips: 2, tint: '#cfc2b0', hole: .08 },
  foliage: { dust: [.3, .4, .22], sparks: 0, chips: 4, tint: '#ffffff', hole: 0 },
};

/** The whole effects layer for the world scene. */
export class Effects {
  group = new THREE.Group(); private glow: Particles; private smoke: Particles; private decals: Decals; private tracers: { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; len: number; t: number; speed: number }[] = [];
  private light = new THREE.PointLight('#ffb35a', 0, 22, 2); private lightT = 0; private ti = 0; private scale: number;
  constructor(scale: number, decals: number) {
    this.scale = scale;
    this.glow = new Particles(Math.round(500 * Math.max(.5, scale)), true); this.smoke = new Particles(Math.round(400 * Math.max(.5, scale)), false);
    this.decals = new Decals(decals);
    const tgeo = new THREE.PlaneGeometry(.035, 1); tgeo.translate(0, -.5, 0); tgeo.rotateX(-Math.PI / 2);
    const tmat = new THREE.MeshBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (let i = 0; i < 24; i++) { const mesh = new THREE.Mesh(tgeo, tmat); mesh.visible = false; this.group.add(mesh); this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, t: 1, speed: 420 }); }
    this.group.add(this.glow.mesh, this.smoke.mesh, this.decals.mesh, this.light);
  }
  /** How much light falls on smoke and dust (1 in daylight; less in overcast, much less at night). */
  setAmbient(k: number) { (this.smoke.mesh.material as THREE.ShaderMaterial).uniforms.uLight.value = k; }
  /** A bullet travelling from `from` to `to`: a short bright streak moving at ~420 m/s. */
  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const t = this.tracers[this.ti++ % this.tracers.length], len = from.distanceTo(to); if (len < 1) return;
    t.from.copy(from); t.dir.copy(to).sub(from).normalize(); t.len = len; t.t = 0; t.mesh.visible = true;
  }
  impact(at: THREE.Vector3, normal: THREE.Vector3, kind: SurfaceKind, flesh = false) {
    const s = this.scale;
    if (flesh) { for (let i = 0; i < 6 * s + 2; i++) this.smoke.emit({ x: at.x, y: at.y, z: at.z, vx: (Math.random() - .5) * 1.5, vy: Math.random() * 1.2, vz: (Math.random() - .5) * 1.5, size: .08, grow: .5, life: .35, r: .55, g: .06, b: .05, a: .8, drag: 4 }); return; }
    const f = IMPACT[kind], n = normal;
    for (let i = 0; i < 4 * s + 2; i++) this.smoke.emit({ x: at.x, y: at.y, z: at.z, vx: n.x * (1 + Math.random() * 2) + (Math.random() - .5), vy: n.y * (1 + Math.random() * 2) + Math.random() * .8, vz: n.z * (1 + Math.random() * 2) + (Math.random() - .5), size: .07, grow: .8 + Math.random() * .6, life: .7 + Math.random() * .6, r: f.dust[0], g: f.dust[1], b: f.dust[2], a: .55, drag: 3.5, spin: (Math.random() - .5) * 2 });
    for (let i = 0; i < f.chips * s; i++) this.smoke.emit({ x: at.x, y: at.y, z: at.z, vx: n.x * 3 + (Math.random() - .5) * 4, vy: n.y * 3 + Math.random() * 3, vz: n.z * 3 + (Math.random() - .5) * 4, size: .018, life: .6, r: f.dust[0] * .6, g: f.dust[1] * .6, b: f.dust[2] * .6, a: 1, gravity: 9.8, drag: .5 });
    for (let i = 0; i < f.sparks * s; i++) this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: n.x * 4 + (Math.random() - .5) * 7, vy: n.y * 4 + Math.random() * 4, vz: n.z * 4 + (Math.random() - .5) * 7, size: .025, life: .25 + Math.random() * .25, r: 1, g: .75, b: .35, a: 1, gravity: 9.8, drag: 1.5, stretch: 2 });
    if (f.hole) this.decals.add(at, normal, f.hole * (.8 + Math.random() * .4), new THREE.Color(f.tint));
  }
  muzzle(at: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 2 * this.scale + 1; i++) this.smoke.emit({ x: at.x + dir.x * .1, y: at.y + dir.y * .1, z: at.z + dir.z * .1, vx: dir.x * 1.2 + (Math.random() - .5) * .3, vy: .35 + Math.random() * .3, vz: dir.z * 1.2 + (Math.random() - .5) * .3, size: .06, grow: .5, life: .9, r: .7, g: .7, b: .7, a: .22, drag: 2 });
  }
  explosion(at: THREE.Vector3, r: number) {
    const s = this.scale;
    for (let i = 0; i < 26 * s + 6; i++) { const a = Math.random() * 6.28, up = Math.random(); this.glow.emit({ x: at.x, y: at.y + .3, z: at.z, vx: Math.cos(a) * (2 + Math.random() * 6), vy: 1 + up * 6, vz: Math.sin(a) * (2 + Math.random() * 6), size: .5 + Math.random() * .6, grow: 1.5, life: .35 + Math.random() * .3, r: 1, g: .55 + Math.random() * .2, b: .2, a: .9, drag: 3 }); }
    for (let i = 0; i < 20 * s + 6; i++) { const a = Math.random() * 6.28; this.smoke.emit({ x: at.x, y: at.y + .4, z: at.z, vx: Math.cos(a) * (1 + Math.random() * 3), vy: .8 + Math.random() * 3, vz: Math.sin(a) * (1 + Math.random() * 3), size: .9, grow: 1.2 + r * .1, life: 2.2 + Math.random() * 1.5, r: .22, g: .2, b: .19, a: .75, drag: 1.4, spin: (Math.random() - .5) }); }
    for (let i = 0; i < 18 * s; i++) { const a = Math.random() * 6.28; this.smoke.emit({ x: at.x, y: at.y + .2, z: at.z, vx: Math.cos(a) * (4 + Math.random() * 6), vy: 3 + Math.random() * 6, vz: Math.sin(a) * (4 + Math.random() * 6), size: .04, life: 1.4, r: .12, g: .11, b: .1, a: 1, gravity: 9.8, drag: .3 }); }
    // The ground ring of dust and the scorch mark sit on whatever the blast stood on.
    const floor = ground(at.x, at.y + .3, at.z);
    for (let i = 0; i < 24; i++) { const a = i / 24 * 6.28; this.smoke.emit({ x: at.x, y: floor + .15, z: at.z, vx: Math.cos(a) * 7, vy: .2, vz: Math.sin(a) * 7, size: .5, grow: 1.5, life: 1.2, r: .55, g: .5, b: .42, a: .45, drag: 2.5 }); }
    if (at.y - floor < 1.5) this.decals.add(new THREE.Vector3(at.x, floor + .01, at.z), new THREE.Vector3(0, 1, 0), r * .5, new THREE.Color('#2a2622'));
    this.light.position.copy(at).setY(at.y + 1); this.lightT = .45;
  }
  smokeCloud(at: THREE.Vector3, r: number, seconds: number) {
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, d = Math.random() * r * .6; this.smoke.emit({ x: at.x + Math.cos(a) * d, y: at.y + .4 + Math.random() * 2, z: at.z + Math.sin(a) * d, vx: Math.cos(a) * .3, vy: .08, vz: Math.sin(a) * .3, size: r * .7, grow: r * .05, life: seconds, r: .78, g: .78, b: .76, a: .92, drag: .4, spin: (Math.random() - .5) * .2 }); }
  }
  /** A drifting mote of dust in the air (wind-borne; subtle). */
  mote(at: THREE.Vector3) { this.smoke.emit({ x: at.x, y: at.y, z: at.z, vx: .5 + Math.random() * .4, vy: .04, vz: .2, size: .012 + Math.random() * .02, life: 5, r: .9, g: .86, b: .76, a: .28 }); }
  flashbang(at: THREE.Vector3) { for (let i = 0; i < 10; i++) this.glow.emit({ x: at.x, y: at.y + .2, z: at.z, size: 1.5 + i * .3, life: .25, r: 1, g: 1, b: 1, a: 1 }); this.light.color.set('#ffffff'); this.light.position.copy(at); this.lightT = .2; }
  capture(at: THREE.Vector3, color: THREE.Color, r: number) {
    for (let i = 0; i < 40 * this.scale; i++) { const a = i / 40 * 6.28; this.glow.emit({ x: at.x + Math.cos(a) * r, y: .15, z: at.z + Math.sin(a) * r, vy: 1.5 + Math.random(), size: .12, life: .9, r: color.r, g: color.g, b: color.b, a: .9, drag: .5 }); }
  }
  update(dt: number) {
    this.glow.update(dt); this.smoke.update(dt);
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.t += dt * t.speed; const head = Math.min(t.t, t.len), tail = Math.max(0, head - 5);
      if (tail >= t.len) { t.mesh.visible = false; continue; }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, head);
      t.mesh.lookAt(t.mesh.position.clone().add(t.dir)); t.mesh.scale.set(1, 1, Math.max(.01, head - tail));
    }
    if (this.lightT > 0) { this.lightT -= dt; this.light.intensity = Math.max(0, this.lightT / .45) * 260; if (this.lightT <= 0) { this.light.intensity = 0; this.light.color.set('#ffb35a'); } }
  }
}

/** Brass casings ejected by the first-person weapon (camera space, so they never clip the world). */
export class Casings {
  mesh: THREE.InstancedMesh; private ps: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; rx: number; ry: number; spin: number }[] = []; private i = 0; private m = new THREE.Matrix4(); private e = new THREE.Euler(); private q = new THREE.Quaternion(); private one = new THREE.Vector3(1, 1, 1);
  constructor(count: number) {
    const geo = new THREE.CylinderGeometry(.0048, .0048, .03, 8); geo.rotateX(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#c39a55', metalness: 1, roughness: .28 }), Math.max(1, count)); this.mesh.frustumCulled = false;
    for (let k = 0; k < this.mesh.count; k++) { this.ps.push({ x: 0, y: -9, z: 0, vx: 0, vy: 0, vz: 0, t: 9, rx: 0, ry: 0, spin: 0 }); this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(k, this.m); }
  }
  eject(at: THREE.Vector3, shell = false) { const p = this.ps[this.i]; this.i = (this.i + 1) % this.ps.length; Object.assign(p, { x: at.x, y: at.y, z: at.z, vx: 1.1 + Math.random() * .5, vy: 1.2 + Math.random() * .6, vz: .3 + Math.random() * .3, t: 0, rx: Math.random() * 6, ry: Math.random() * 6, spin: 18 + Math.random() * 10 }); void shell; }
  update(dt: number) {
    for (let k = 0; k < this.ps.length; k++) {
      const p = this.ps[k]; if (p.t > .7) { if (p.t < 9) { p.t = 9; this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(k, this.m); } continue; }
      p.t += dt; p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += p.spin * dt; p.ry += p.spin * .6 * dt;
      this.mesh.setMatrixAt(k, this.m.compose(new THREE.Vector3(p.x, p.y, p.z), this.q.setFromEuler(this.e.set(p.rx, p.ry, 0)), this.one));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
