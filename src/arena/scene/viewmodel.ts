// The first-person weapon's motion: one animator shared by the match (src/arena/Scene.tsx) and the QA renders
// (scripts/qa/arena-weapons-page.ts), so what is reviewed is what is played.
//
// Everything is driven by the simulation's own state (shared/arena/sim.mjs: phase, timers, ADS, velocity) and by the
// reload timelines in src/arena/sound/reloads.mjs, which also time the sounds: the magazine leaves the well when the
// "magOut" cue plays, seats when "magSeat" plays, the action is worked when "chargeBack"/"boltRelease" plays. A
// cancelled reload or a weapon switch simply stops reaching the later keys. Nothing here feeds back into aim, recoil
// or hits: it is presentation only.
//
// Camera space: the viewmodel camera sits at the origin looking down −z; +x right, +y up. The holder is posed in
// that space and the weapon hangs from it; part pivots (mag, bolt, slide, pump, cylinder) come from weapons.ts.
import * as THREE from 'three';
import { reloadPlan } from '../sound/reloads.mjs';

export interface VmSim {
  phase: string; pt: number; cool: number; ads: number; sprint: boolean | number; stance: number; grounded: boolean;
  vx: number; vy: number; vz: number; shots: number;
}
export interface VmWeapon {
  id: string; category: string; fire: string; rpm?: number; reloadMode?: string; reload?: number; swap: number; swing?: number; inspect?: number;
}
export interface VmInput {
  dt: number; sim: VmSim; weapon: VmWeapon;
  /** The reload's length in ticks (as started) and whether it began from an empty magazine. */
  reloadTotal: number; reloadEmpty: boolean;
  /** Rounds in the magazine (a pistol's slide locks back on the last one). */
  mag: number;
  /** Look movement this frame (radians), for sway. */
  dyaw: number; dpitch: number;
  /** Gait phase (radians), from the footstep model. */
  bob: number;
}
export interface VmOutput {
  /** Palm targets in camera space, and how far the support hand has turned to hold a magazine (0–1). */
  handR: THREE.Vector3; handL: THREE.Vector3; reachL: number;
  /** Field of view for the viewmodel camera, and the visible ADS blend (0 hip … 1 on the sights, may overshoot). */
  vfov: number; ads: number;
}

/** How each class of weapon moves when it fires: displacement kicks (m, rad) and the action's weight. */
interface Feel { back: number; up: number; roll: number; side: number; shake: number }
const FEEL: Record<string, Feel> = {
  ar: { back: .02, up: .036, roll: .018, side: .011, shake: .0012 },
  smg: { back: .014, up: .026, roll: .024, side: .015, shake: .0016 },
  lmg: { back: .018, up: .03, roll: .016, side: .016, shake: .0018 },
  battle: { back: .028, up: .05, roll: .02, side: .01, shake: .0014 },
  sniper: { back: .05, up: .1, roll: .035, side: .008, shake: 0 },
  shotgun: { back: .055, up: .11, roll: .04, side: .012, shake: 0 },
  pistol: { back: .018, up: .075, roll: .025, side: .01, shake: 0 },
  melee: { back: 0, up: 0, roll: 0, side: 0, shake: 0 },
};
const feelOf = (w: VmWeapon) => FEEL[w.id === 'm7' ? 'battle' : w.category] ?? FEEL.ar;
/** How the empty reload chambers a round: the support hand to a bolt catch (slap), a charging handle (pull), or not at all. */
const CHAMBER: Record<string, 'slap' | 'pull' | 'bolt' | 'none'> = { vanguard: 'slap', m7: 'slap', halcyon: 'pull', wasp: 'pull', kestrel: 'pull', rampart: 'pull', talon: 'pull', anvil: 'pull', longbow: 'bolt', sparrow: 'none', thorn: 'none' };

const clamp01 = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x;
/** Smootherstep of k between a and b. */
const ease = (k: number, a: number, b: number) => { const t = clamp01((k - a) / Math.max(1e-6, b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Accelerating into a stop (a magazine driven home). */
const easeIn = (k: number, a: number, b: number) => { const t = clamp01((k - a) / Math.max(1e-6, b - a)); return t * t * (2 - t * t) * .5 + t * t * .5; };
const win = (k: number, a: number, b: number, c: number, d: number) => ease(k, a, b) * (1 - ease(k, c, d));
const lerpV = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number) => out.copy(a).lerp(b, t);

/** A damped spring (unit mass): stiffness k, damping c. */
class Spring {
  x = 0; v = 0; k: number; c: number;
  constructor(k: number, c: number) { this.k = k; this.c = c; }
  step(dt: number, target = 0) { const h = Math.min(dt, 1 / 30); this.v += (-this.k * (this.x - target) - this.c * this.v) * h; this.x += this.v * h; return this.x; }
}

const _eA = new THREE.Euler(), _eB = new THREE.Euler(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion();
const POUCH = new THREE.Vector3(-.17, -.56, -.2);
/** The melee support hand's guard, in camera space: low left, in view at the hip field of view. */
const GUARD = new THREE.Vector3(-.17, -.14, -.4);

export class ViewmodelAnimator {
  // Recoil: displacement springs (back, pitch, roll, yaw), a settling spring for impacts (seat, chamber, landing), the
  // visible ADS blend, sway and sprint.
  private kz = new Spring(320, 19); private kp = new Spring(260, 17); private kr = new Spring(220, 16); private ky = new Spring(240, 18);
  private jolt = new Spring(380, 16); private land = new Spring(90, 13);
  private adsS = new Spring(420, 30);
  private swayX = 0; private swayY = 0; private sprintK = 0; private breath = 0; private slideKick = 0; private heat = 0; private shakeT = 0;
  private cyl = 0; private lastK = -1; private lastPhase = '';
  /** An empty reload's discarded magazine, falling in camera space. */
  private drop = { on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), spin: 0, t: 0 };
  private handL = new THREE.Vector3(-.2, -.3, .1); private handR = new THREE.Vector3(.2, -.3, .1);
  private out: VmOutput = { handR: new THREE.Vector3(), handL: new THREE.Vector3(), reachL: 0, vfov: 50, ads: 0 };

  /** Our own shot (server-confirmed or predicted: presentation only). */
  shot(w: VmWeapon, ads: number) {
    const f = feelOf(w), a = ads * ads, r = () => Math.random() - .5;
    // A snap into the shoulder and up; less sideways on the sights, where the shooter's cheek and both hands hold it.
    this.kz.x += f.back * (1 - a * .45); this.kz.v += f.back * 9;
    this.kp.x += f.up * (1 - a * .15) * (.85 + Math.random() * .3); this.kp.v += f.up * 6;
    this.kr.x += r() * f.roll * 2 * (1 - a * .55); this.ky.x += r() * f.side * 2 * (1 - a * .5);
    this.slideKick = 1; this.heat = Math.min(1, this.heat + .08); this.shakeT = .06;
  }
  /** A landing: the weapon dips with the knees. */
  landed(speed: number) { this.land.v -= Math.min(1.2, speed * .09); }
  /** Barrel heat 0–1 from sustained fire (for smoke). */
  get barrelHeat() { return this.heat; }

  update(inp: VmInput, gun: THREE.Object3D, holder: THREE.Object3D): VmOutput {
    const { dt, sim: s, weapon: w } = inp, out = this.out, ud = gun.userData;
    const sightY = (ud.sightY as number) ?? .09, melee = w.fire === 'melee', sidearm = w.category === 'pistol';
    // ---------------------------------------------------------------- springs
    this.kz.step(dt); this.kp.step(dt); this.kr.step(dt); this.ky.step(dt); this.jolt.step(dt); this.land.step(dt);
    const adsV = this.adsS.step(dt, s.ads); out.ads = adsV;
    this.slideKick *= Math.exp(-dt * 26); this.heat = Math.max(0, this.heat - dt * .35); this.shakeT = Math.max(0, this.shakeT - dt);
    this.swayX += (THREE.MathUtils.clamp(inp.dyaw * .9, -.05, .05) - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (THREE.MathUtils.clamp(-inp.dpitch * .9, -.04, .04) - this.swayY) * Math.min(1, dt * 9);
    this.breath += dt; this.sprintK += ((s.sprint ? 1 : 0) - this.sprintK) * Math.min(1, dt * 9);
    const speed = Math.hypot(s.vx, s.vz), moving = s.grounded ? Math.min(1, speed / 5) : 0;
    const a = clamp01(adsV), ads = a * a * (3 - 2 * a), hipK = 1 - ads, bob = inp.bob, sk = this.sprintK;

    // ---------------------------------------------------------------- base pose: hip → sights
    // Hip: low in the right of the frame, muzzle turned in toward the centre and canted a little, the stock tucked
    // into the shoulder (as the reference footage holds a rifle); sidearms further out, blades low and turned.
    const hip = melee ? v1.set(.15, -.17, -.42) : sidearm ? v1.set(.095, -sightY - .085, -.5) : v1.set(.125, -sightY - .068, -.33);
    const aim = v2.set(0, -sightY, (ud.adsZ as number) ?? -.28);
    let x = hip.x + (aim.x - hip.x) * ads, y = hip.y + (aim.y - hip.y) * ads, z = hip.z + (aim.z - hip.z) * ads;
    // (The knife is carried turned across the body, tip raised, so its blade reads along its length rather than end on.)
    const knife = w.id === 'knife';
    let rx = melee ? (knife ? .34 : .22) : sidearm ? 0 : .025 * hipK, ry = (melee ? (knife ? .62 : .14) : sidearm ? .06 : .17) * hipK, rz = (melee ? -.25 : sidearm ? 0 : .07) * hipK;
    // Bringing it up: a small arc (dip, then rise into the eye line) and the muzzle leading, settling on arrival.
    const arc = Math.sin(Math.PI * clamp01(a));
    y -= .014 * arc; rx += .035 * arc; x += .01 * arc;
    // Overshoot past the sights (spring > 1) pulls the weapon a touch closer: the cheek meeting the stock.
    if (adsV > 1) z += (adsV - 1) * .06;
    // Idle breathing (a slow figure of eight on the sights), look sway, walk bob.
    const br = this.breath;
    x += this.swayX + Math.cos(bob) * .0065 * moving * (hipK * .9 + .1) + Math.sin(br * .9) * (.0012 * hipK + .0005 * ads);
    y += this.swayY - Math.abs(Math.sin(bob)) * .008 * moving * (hipK * .9 + .1) + Math.sin(br * 1.8) * (.0016 * hipK + .00035 * ads);
    rz += -this.swayX * 1.4 + Math.sin(bob) * .012 * moving * hipK; rx += this.swayY * .8 + Math.sin(br * 1.8 + .6) * .0012 * ads; ry += Math.sin(br * .9 + .3) * .0012 * ads;
    // Sprint: high-ready, canted across the body, with a heavier bob.
    if (!melee) { x -= .01 * sk; y += (-.03 + Math.sin(bob * 2) * .014) * sk; z += .03 * sk; rx += -.32 * sk; ry += .5 * sk; rz += .42 * sk; x += Math.cos(bob) * .012 * sk; }
    else { y += Math.sin(bob * 2) * .015 * sk; rx -= .2 * sk; }
    if (!s.grounded) { y += THREE.MathUtils.clamp(-s.vy * .004, -.03, .03); rx += THREE.MathUtils.clamp(s.vy * .008, -.06, .06); }
    if (s.stance === 2) { rz += .26; y -= .02; x += .02; }
    y += this.land.x * .05;
    // Recoil and impacts.
    z += this.kz.x; rx += this.kp.x; rz += this.kr.x; ry += this.ky.x; y += this.kp.x * .1 + this.jolt.x * .02; rx += this.jolt.x * .05;
    if (this.shakeT > 0) { const f = feelOf(w).shake * (1 - ads * .5); x += (Math.random() - .5) * f; y += (Math.random() - .5) * f; }

    // ---------------------------------------------------------------- phases
    const mag = gun.getObjectByName('mag'), bolt = gun.getObjectByName('bolt'), pump = gun.getObjectByName('pump'), slide = gun.getObjectByName('slide'), cyl = gun.getObjectByName('cylinder');
    for (const o of [mag, bolt, pump, slide, cyl]) if (o?.userData.rest) { o.position.copy(o.userData.rest as THREE.Vector3); o.rotation.set(0, 0, 0); o.visible = true; }
    let leftOff = 0, rightToBolt = 0, reachL = 0, tRx = 0, tRy = 0, tRz = 0;
    /** Where the support hand is, as a function of where things are once the holder is posed (filled in below). */
    let hand: ((grip: THREE.Vector3) => THREE.Vector3) | null = null;
    let magWorld: THREE.Vector3 | null = null, magRock = 0;
    if (s.phase !== this.lastPhase) { if (s.phase === 'reload') { this.lastK = -1; this.drop.on = false; } this.lastPhase = s.phase; }
    if (s.phase === 'reload') {
      const k = clamp01(1 - s.pt / Math.max(1, inp.reloadTotal)), plan = reloadPlan(w.id, inp.reloadEmpty);
      if (w.reloadMode === 'shell' || !plan) {
        // Shell by shell: rolled over to show the loading port; the support hand pushes each shell in.
        const u = s.pt <= (w.reload ?? 1) ? 1 - s.pt / Math.max(1, w.reload ?? 1) : 0, inK = ease(clamp01(1 - s.pt / Math.max(1, inp.reloadTotal)), 0, .12);
        rx += .3 * inK; rz -= .42 * inK; y -= .03 * inK; ry += .1 * inK; leftOff = Math.sin(u * Math.PI) * .12;
        if (u > .5 && u < .6) this.jolt.v += .6;
      } else {
        const [t0, t1, t2, t3] = plan.tilt, tilt = win(k, t0, t1, t2, t3);
        // Turned to show the magazine well: raised into view, rolled right, the left side turned toward the eye.
        const pk = sidearm ? .5 : 1; tRx = .16 * tilt * pk; tRy = .3 * tilt * pk; tRz = -.7 * tilt * pk; rx += tRx; ry += tRy; rz += tRz; y += (sidearm ? .02 : .095) * tilt; x -= .035 * tilt * pk; z += (sidearm ? -.03 : .015) * tilt;
        const empty = inp.reloadEmpty, h = plan.hand, chamber = empty ? CHAMBER[w.id] ?? 'pull' : 'none';
        if (plan.out && plan.in && mag) {
          const [o0, o1] = plan.out, [i0, i1] = plan.in, mid = (o1 + i0) / 2, seat = plan.seat ?? i1;
          // Body reactions: a dip as the old magazine is stripped, a push up as the new one is driven home.
          y -= .008 * win(k, o0, (o0 + o1) / 2, (o0 + o1) / 2, o1); rx -= .03 * win(k, i0, i1 - .02, i1, i1 + .04);
          if (this.lastK >= 0 && this.lastK < seat && k >= seat) { this.jolt.v += 2.2; this.kp.v += .5; }
          // Rocking the curved magazines (AK, SMGs) out and in: the front lips hook, the back swings.
          const rock = ['halcyon', 'wasp', 'kestrel'].includes(w.id) ? .38 : .08;
          const restL = mag.userData.rest as THREE.Vector3, axis = v3.set(0, -1, -.1).normalize();
          const outL = restL.clone().addScaledVector(axis, .17), preL = restL.clone().addScaledVector(axis, .12);
          if (empty && k >= o0) {
            // Dropped free: it falls away under gravity, tumbling, and leaves the frame.
            if (!this.drop.on) { this.drop.on = true; this.drop.t = 0; this.drop.spin = (Math.random() - .5) * 6; this.drop.p.set(NaN, 0, 0); }
          }
          if (k < o0) { magWorld = null; }
          else if (k < o1 && !empty) { const e = ease(k, o0, o1); magWorld = restL.clone().lerp(outL, e); magRock = rock * e; }
          else if (k < mid && !empty) { magWorld = outL.clone(); magRock = rock; }
          else if (k < i0) { magWorld = preL.clone(); magRock = rock * .7; }
          else if (k < i1) { const e = easeIn(k, i0, i1); magWorld = preL.clone().lerp(restL, e); magRock = rock * .7 * (1 - e); }
          // Hand keys (camera space positions resolved once the holder is posed).
          const kHand = h, toMag = empty ? 0 : ease(k, kHand[0], kHand[1]);
          hand = grip => {
            const grab = (local: THREE.Vector3) => gun.localToWorld(v1.copy(local)).addScaledVector(v2.set(0, 1, 0).applyQuaternion(holder.getWorldQuaternion(q1)), -.075);
            const atRest = grab(restL).clone();
            let p: THREE.Vector3;
            if (!empty && k < o1) p = lerpV(new THREE.Vector3(), grip, k < o0 ? atRest : grab(magWorld ?? restL).clone(), toMag);
            else if (empty && k < o1) p = lerpV(new THREE.Vector3(), grip, POUCH, ease(k, kHand[0], o1));
            else if (k < mid) p = lerpV(new THREE.Vector3(), grab(outL).clone(), POUCH, ease(k, o1, mid));
            else if (k < i0) p = lerpV(new THREE.Vector3(), POUCH, grab(preL).clone(), ease(k, mid, i0));
            else if (k < i1) p = grab(magWorld ?? restL).clone();
            else {
              // After the seat: a palm tap, then back to the handguard, or (from empty) to the action first.
              p = atRest.clone(); p.y += .012 * Math.sin(clamp01((k - seat) / .05) * Math.PI);
              const charge = gun.getObjectByName('charge');
              if (chamber !== 'none' && chamber !== 'bolt' && plan.rack && charge) {
                const [r0, r1] = plan.rack, at = charge.getWorldPosition(new THREE.Vector3());
                if (chamber === 'pull') { const back = gun.localToWorld(new THREE.Vector3().copy(charge.position).add(v2.set(0, 0, .07))); const pull = win(k, r0, r0 + (r1 - r0) * .45, r0 + (r1 - r0) * .45, r0 + (r1 - r0) * .5); at.lerp(back, pull); }
                p.lerp(at, win(k, i1 + .02, r0, r1, Math.min(1, r1 + .06)));
                if (k >= r1 - .02) p.lerp(grip, ease(k, r1, Math.min(1, r1 + .08)));
              } else p.lerp(grip, ease(k, h[2], h[3]));
            }
            return p;
          };
          reachL = (empty ? ease(k, o1, mid) : toMag) * (1 - ease(k, h[2], h[3]));
          if (empty && chamber !== 'none' && plan.rack) reachL *= 1 - ease(k, i1, i1 + .06);
          // The chambering itself: a bolt catch slapped, a handle pulled and let fly, or the bolt worked.
          if (empty && plan.rack) {
            const [r0, r1] = plan.rack, c = Math.sin(clamp01((k - r0) / Math.max(1e-3, r1 - r0)) * Math.PI);
            const strike = chamber === 'slap' ? r0 + (r1 - r0) * .15 : r0 + (r1 - r0) * .5;
            if (this.lastK >= 0 && this.lastK < strike && k >= strike) { this.jolt.v += 2.6; this.kz.v += .35; }
            if (bolt) bolt.position.z += c * .05; if (slide) slide.position.z += (k < r0 ? .035 : 0); z += c * .01;
            if (chamber === 'bolt') { rightToBolt = c; rz -= c * .12; }
            if (chamber === 'pull') { rz += c * .06; ry -= c * .05; }
          }
        } else if (plan.cyl && cyl) {
          // A revolver's cylinder swings out for the ejector and the speed-loader, then closes.
          const open = ease(k, plan.cyl[0], plan.cyl[0] + .08) * (1 - ease(k, plan.cyl[1] - .05, plan.cyl[1])); cyl.position.x -= open * .028; rz -= open * .22;
          reachL = ease(k, h[0], h[1]) * (1 - ease(k, h[2], h[3]));
        }
        if (this.drop.on) this.drop.t += dt;
      }
      this.lastK = k;
    } else { this.lastK = -1; this.drop.on = false; }
    if (s.phase === 'inspect' && w.id === 'm7') {
      const k = 1 - s.pt / (w.inspect ?? 144), blend = Math.sin(Math.PI * k) ** 2;
      x -= .045 * blend; y += .075 * blend; z -= .06 * blend; rz -= .85 * blend; ry += .55 * blend; rx += .12 * blend;
    }
    if (s.phase === 'switch') { const k = s.pt / Math.max(1, w.swap), e = k * k; y -= e * .42; rx -= e * 1.0; rz += e * .3; }
    if (s.phase === 'melee') { const total = melee ? w.swing ?? 30 : 30, k = 1 - s.pt / total, sw = Math.sin(Math.min(1, k * 1.25) * Math.PI); if (melee) { x -= sw * .16; z -= sw * .18; ry += sw * .9; rz += sw * .5; } else { z -= sw * .2; ry += sw * .75; rx += sw * .25; x -= sw * .08; } }
    if (s.phase === 'throw') { const k = 1 - s.pt / 22, sw = Math.sin(k * Math.PI); y -= sw * .32; rx -= sw * .7; }
    // Actions that cycle between shots: pump, bolt, slide, cylinder.
    if (w.rpm && s.cool > 0 && s.phase === 'ready') {
      const u = 1 - s.cool / (3600 / w.rpm);
      if (pump) { const c = Math.sin(clamp01((u - .12) / .5) * Math.PI); pump.position.z += c * .085; leftOff = c * .085; rz += c * .05; rx += c * .03; }
      if (bolt && w.fire === 'bolt') { const c = Math.sin(clamp01((u - .15) / .55) * Math.PI); bolt.position.z += c * .075; bolt.position.y += Math.min(1, c * 2) * .012; rightToBolt = Math.min(1, c * 1.6); rz -= c * .12; rx += c * .04; }
    }
    // The slide: blown back with each shot, locked open on an empty magazine until the reload drops it.
    if (slide) { slide.position.z += this.slideKick * .028; if (inp.mag === 0 && s.phase === 'ready') slide.position.z += .032; }
    if (cyl) { this.cyl += (s.shots * Math.PI / 3 - this.cyl) * Math.min(1, dt * 18); cyl.rotation.z = this.cyl; }

    // The reload turn pivots about the firing hand on the pistol grip (the stock stays in the shoulder), not about the
    // weapon's origin: shift the holder so the grip stays where the untilted pose put it.
    const gR0 = gun.getObjectByName('gripR');
    if (gR0 && (tRx || tRy || tRz)) {
      const g = v1.copy(gR0.position).add(gun.position), a = v2.copy(g).applyEuler(_eA.set(rx - tRx, ry - tRy, rz - tRz)), b = v3.copy(g).applyEuler(_eB.set(rx, ry, rz));
      x += a.x - b.x; y += a.y - b.y; z += a.z - b.z;
    }
    holder.position.set(x, y, z); holder.rotation.set(rx, ry, rz); holder.updateMatrixWorld(true);
    // The magazine, now the weapon is placed: in the well, on its way, in the hand, or falling.
    if (mag) {
      const restL = mag.userData.rest as THREE.Vector3;
      if (this.drop.on && s.phase === 'reload') {
        if (Number.isNaN(this.drop.p.x)) { gun.localToWorld(this.drop.p.copy(restL)); this.drop.v.set(-.15, -.6, .05); }
        else { this.drop.v.y -= 9.8 * dt; this.drop.p.addScaledVector(this.drop.v, dt); }
        mag.position.copy(gun.worldToLocal(v1.copy(this.drop.p))); mag.rotation.x = this.drop.spin * this.drop.t; mag.rotation.z = this.drop.spin * .4 * this.drop.t;
        if (this.drop.p.y < -.9) mag.visible = false;
        // The new one, once the hand brings it.
        const plan = reloadPlan(w.id, true), k = this.lastK;
        if (plan?.out && plan.in && k >= (plan.out[1] + plan.in[0]) / 2) { this.drop.on = false; }
      }
      if (!this.drop.on && magWorld) { mag.position.copy(magWorld); mag.rotation.x = magRock; }
      if (!this.drop.on && s.phase === 'reload') {
        const plan = reloadPlan(w.id, inp.reloadEmpty), k = this.lastK;
        // Between leaving the frame and coming back, the magazine travels with the hand (off screen).
        if (plan?.out && plan.in && k > plan.out[1] && k < plan.in[0]) {
          const mid = (plan.out[1] + plan.in[0]) / 2, e = k < mid ? ease(k, plan.out[1], mid) : 1 - ease(k, mid, plan.in[0]);
          const restW = gun.localToWorld(v1.copy(restL).addScaledVector(v3.set(0, -1, -.1).normalize(), k < mid ? .17 : .12));
          restW.lerp(v2.copy(POUCH).add(v3.set(0, .075, 0)), e);
          mag.position.copy(gun.worldToLocal(restW)); mag.visible = e < .97;
        }
      }
    }
    // ---------------------------------------------------------------- hands
    const gR = gun.getObjectByName('gripR'), gL = gun.getObjectByName('gripL');
    if (gR && gL) {
      gR.getWorldPosition(v1); if (rightToBolt && bolt) v1.lerp(bolt.getWorldPosition(v3), rightToBolt * .85); this.handR.copy(v1);
      const grip = gL.getWorldPosition(new THREE.Vector3()); grip.z += leftOff;
      let want = grip;
      if (hand) want = hand(grip);
      if (s.phase === 'throw' || (s.phase === 'melee' && !melee)) want = grip.lerp(v3.set(-.25, -.5, .1), .9);
      // Melee weapons are held in the firing hand alone. The support hand stays in view as a guard: a loose fist low
      // in the left of the frame, rising and falling with the stride (pumping when sprinting), drawn back toward the
      // chest as the blade swings through (the counterbalance of a real cut) and forward again on recovery.
      if (melee && s.phase !== 'throw') {
        const swing = s.phase === 'melee' ? Math.sin(clamp01(1 - s.pt / Math.max(1, w.swing ?? 30)) * Math.PI) : 0;
        const raise = s.phase === 'switch' ? clamp01(s.pt / Math.max(1, w.swap ?? 18)) : 0;
        want = v3.set(GUARD.x + this.swayX * .6 - swing * .05 + Math.cos(bob) * .006 * moving,
          GUARD.y + this.swayY * .5 - Math.abs(Math.sin(bob)) * .01 * moving + Math.sin(bob) * .035 * sk - swing * .035 - raise * .12,
          GUARD.z + Math.cos(bob) * .035 * sk + swing * .09);
      }
      // The hand follows its target quickly but not instantly (a reach has weight; a tap stays crisp).
      this.handL.lerp(want, Math.min(1, dt * (s.phase === 'reload' ? 22 : 30)));
    }
    out.handR.copy(this.handR); out.handL.copy(this.handL); out.reachL = reachL;
    // Viewmodel field of view: wide enough at the hip to show both hands, narrowed on the sights so the optic fills
    // the eye as it does through a real sight (irons a little wider, pistols wider still).
    const optic = !!gun.getObjectByName('reticle'), adsFov = sidearm ? 34 : optic ? 30 : 36, hipFov = sidearm ? 42 : 50;
    out.vfov = hipFov + (adsFov - hipFov) * ads + this.sprintK * 2;
    return out;
  }
}
