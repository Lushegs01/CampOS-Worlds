// The first-person muzzle: a layered flash that differs every shot, a brief light that falls on the weapon and the
// hands, and barrel smoke that thickens with sustained fire and curls up from the muzzle after the trigger is let go.
// Drawn in the viewmodel scene (its own camera space), so it sits exactly on the model's muzzle. Bounded pools, no
// allocation per shot. The world-side flash light and smoke (Effects.muzzle, the world muzzle light) are unchanged.
import * as THREE from 'three';
import { flashTexture, puffTexture } from './fx';

const SMOKE = 28;
const _c = new THREE.Color(), _mz = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _f = new THREE.Vector3();

export class MuzzleFX {
  readonly group = new THREE.Group();
  private flash = new THREE.Group(); private petals: THREE.Mesh[] = []; private core: THREE.Mesh; private cone: THREE.Mesh;
  private light = new THREE.PointLight('#ffb468', 0, 1.6, 2);
  private flashT = 1; private flashScale = 1;
  private smoke: THREE.InstancedMesh; private ps: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; life: number; size: number; grow: number; rot: number; a: number }[] = [];
  private smokeMat: THREE.MeshBasicMaterial; private next = 0; private wisp = 0;
  constructor(enabled = true) {
    const hot = new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(6, 3.8, 1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const white = hot.clone(); white.color = new THREE.Color(9, 7.5, 5);
    // The petals are drawn opaque-ish (over-bright, alpha from the flash texture) rather than added, so a flash still
    // reads against a bright sky, as a real one does in daylight; the core stays additive and white-hot.
    const petal = new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(3.2, 1.9, .7), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, alphaTest: .02 });
    // Petals: planes along the bore, star-shaped from the front; a stretched forward cone; a white-hot core.
    // (Euler order ZXY: laid along the bore first, then rolled about it, so the petals fan out around the muzzle.)
    for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(.12, .42), petal); p.rotation.order = 'ZXY'; p.rotation.set(-Math.PI / 2, 0, i * Math.PI / 4); p.position.z = -.12; this.petals.push(p); this.flash.add(p); }
    // The face-on star: what the shooter mostly sees, since the petals are edge-on along the line of sight.
    this.cone = new THREE.Mesh(new THREE.PlaneGeometry(.22, .22), petal); this.cone.position.z = -.05; this.flash.add(this.cone);
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(.12, .12), white); this.flash.add(this.core);
    this.flash.visible = false; this.group.add(this.flash, this.light);
    this.smokeMat = new THREE.MeshBasicMaterial({ map: puffTexture(), color: '#94918c', transparent: true, depthWrite: false, opacity: 1, toneMapped: true });
    // Each puff's fade is its instance colour's red channel, applied to alpha (not to the colour: smoke thins, it does
    // not darken).
    this.smokeMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#if defined( USE_COLOR )\n diffuseColor.a *= vColor.r;\n#endif'); };
    this.smoke = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.smokeMat, SMOKE); this.smoke.frustumCulled = false; this.smoke.renderOrder = 5;
    this.smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE * 3).fill(1), 3);
    for (let i = 0; i < SMOKE; i++) { this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 1, life: 1, size: 0, grow: 0, rot: 0, a: 0 }); this.smoke.setMatrixAt(i, _m.makeScale(0, 0, 0)); }
    this.group.add(this.smoke); this.group.visible = enabled;
  }
  /** A shot: `weight` 0.4 (SMG) … 1.5 (shotgun); `ads` dims and shortens the flash as seen over the sights. */
  fire(weight: number, ads: number) {
    this.flashT = 0; this.flashScale = 1.55 * weight * (1 - ads * .3) * (.75 + Math.random() * .5);
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.petals.forEach((p, i) => { const s = .55 + Math.random() * .75; p.scale.set(.8 + Math.random() * .5, s, 1); p.position.z = -.1 * s - .02; p.rotation.z = i * Math.PI / 4 + (Math.random() - .5) * .5; });
    const c = .6 + Math.random() * .6; this.cone.scale.set(c, c, 1); this.cone.rotation.z = Math.random() * Math.PI * 2;
    this.light.intensity = 2.2 * weight;
    // A puff at the muzzle, more for heavier rounds.
    // (Faint, and fainter over the sights, where it hangs between the eye and the target.)
    for (let i = 0; i < (weight > 1 ? 3 : 1); i++) this.puff(.02 + .025 * weight, .6 + Math.random() * .3, (.14 + .08 * Math.min(1, weight)) * (1 - ads * .75));
  }
  private puff(size: number, life: number, alpha: number, fromWisp = false) {
    const p = this.ps[this.next]; this.next = (this.next + 1) % SMOKE;
    Object.assign(p, { x: 0, y: 0, z: 0, t: 0, life, size, grow: fromWisp ? .07 : .32, rot: Math.random() * 6.28, a: alpha,
      vx: (Math.random() - .5) * .08, vy: fromWisp ? .09 + Math.random() * .05 : .05, vz: fromWisp ? -.01 : -.35 - Math.random() * .2 });
  }
  /**
   * Per frame: `muzzle` is the weapon's muzzle anchor (or null when no weapon is drawn), `heat` 0–1 from sustained
   * fire. Smoke lives in camera space, so it trails behind as the weapon moves, as smoke left in the air does.
   */
  update(dt: number, muzzle: THREE.Object3D | null, heat: number, holderQ: THREE.Quaternion) {
    this.flashT += dt;
    const on = !!muzzle && this.flashT < .045;
    this.flash.visible = on;
    if (muzzle) {
      muzzle.getWorldPosition(_mz); _p.copy(_mz); this.flash.position.copy(_p); this.flash.quaternion.copy(holderQ);
      const k = 1 - this.flashT / .045, sc = this.flashScale * (.6 + .4 * Math.max(0, k)); this.flash.scale.setScalar(sc);
      this.light.position.copy(_p).add(_f.set(0, .02, .05));
      // Barrel smoke: a thin wisp off a hot barrel, strongest just after firing stops.
      this.wisp += dt * heat * heat * 14;
      while (this.wisp > 1) { this.wisp -= 1; this.puff(.015, 1.2 + Math.random() * .6, .16 * heat, true); const p = this.ps[(this.next + SMOKE - 1) % SMOKE]; p.x = _p.x; p.y = _p.y + .005; p.z = _p.z; }
    }
    this.light.intensity = Math.max(0, this.light.intensity - dt * 70);
    // Puffs spawned by fire() start at the muzzle on their first update.
    for (let i = 0; i < SMOKE; i++) {
      const p = this.ps[i];
      if (p.t >= p.life) { if (p.size) { p.size = 0; this.smoke.setMatrixAt(i, _m.makeScale(0, 0, 0)); } continue; }
      if (p.t === 0 && muzzle && p.vz < -.2) { p.x = _mz.x; p.y = _mz.y; p.z = _mz.z; }
      p.t += dt; const u = p.t / p.life;
      p.vx *= Math.exp(-dt * 3); p.vz *= Math.exp(-dt * 5); p.vy += dt * .05;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += dt * .6;
      const size = p.size + p.grow * p.t, fade = Math.sin(Math.min(1, u * 4) * Math.PI / 2) * (1 - u) * p.a;
      _q.setFromAxisAngle(_f.set(0, 0, 1), p.rot); _s.set(size, size, size);
      this.smoke.setMatrixAt(i, _m.compose(_p.set(p.x, p.y, p.z), _q, _s));
      this.smoke.setColorAt(i, _c.setRGB(fade, fade, fade));
    }
    this.smoke.instanceMatrix.needsUpdate = true; if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }
  /** How bright the air is where the smoke hangs (0 dark … 1 open daylight): smoke is lit, not glowing. */
  setAmbient(level: number) { this.smokeMat.color.setRGB(.58, .57, .55).multiplyScalar(THREE.MathUtils.clamp(level, .08, 1.1)); }
  dispose() { this.smoke.geometry.dispose(); this.smokeMat.dispose(); this.flash.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
}
