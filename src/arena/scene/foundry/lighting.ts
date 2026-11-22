// Foundry night shift: the light rig and the air.
//
//  · Floodlights on the four corner towers (SpotLights), alternating emerald and amber, aimed into the yard. On Medium
//    and up one or two of them cast shadows (redrawn on a slow, staggered schedule: only players move in them).
//  · Overhead practicals under the roofs: every fitting glows, and a small pool of real point lights (the profile's
//    `lights` count) follows the player, always lighting the fittings nearest the camera and cross-fading as it moves
//    (so a fixed shader light count lights the whole map).
//  · Volumetric cones: soft additive Fresnel cones under every fitting and a long beam from every floodlight (two
//    instanced meshes: two draw calls), fading with the exponential haze and as the camera walks into them.
//  · Dust: motes drifting inside the cones only, so they show where the light is (one point cloud, one draw call).
import * as THREE from 'three';
import { fixtureTone, toneColor, type FoundryLook } from './look';
import type { ArenaQuality } from '../world';

type Box = { min: number[]; max: number[] };

const CONE_VERT = /* glsl */`
varying vec3 vWorld, vNrm; varying float vAlong; varying vec3 vTint;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec4 w = m * vec4(position, 1.); vWorld = w.xyz; vNrm = normalize(mat3(m) * normal); vAlong = uv.y;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.);
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CONE_FRAG = /* glsl */`
uniform float uIntensity, uFog, uNear, uPow, uTop;
varying vec3 vWorld, vNrm; varying float vAlong; varying vec3 vTint;
void main() {
  vec3 v = cameraPosition - vWorld; float d = length(v); v /= max(d, 1e-4);
  // Fresnel-style: bright where the cone faces the eye (its core), soft to nothing at its silhouette.
  float core = pow(abs(dot(normalize(vNrm), v)), 1.6);
  // Strongest at the fitting, thinning toward the floor, fading out before it touches it.
  // (uTop < 1 fades the apex: a floodlight's beam would otherwise bloom into a disc at the lamp.)
  float fall = pow(vAlong, uPow) * smoothstep(0., .18, vAlong) * smoothstep(1., uTop, vAlong);
  float a = core * fall * smoothstep(uNear * .3, uNear, d) * exp(-uFog * uFog * d * d);
  gl_FragColor = vec4(vTint * uIntensity * a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const DUST_VERT = /* glsl */`
attribute vec4 aSeed; attribute vec3 aTint; uniform float uTime, uSize, uScale;
varying vec3 vTint; varying float vA;
void main() {
  float t = uTime * (.6 + aSeed.w * .5) + aSeed.x * 40.;
  vec3 drift = vec3(sin(t * .31 + aSeed.y * 6.3), sin(t * .17 + aSeed.z * 5.1) * .7, cos(t * .27 + aSeed.x * 9.2)) * .22;
  vec4 mv = modelViewMatrix * vec4(position + drift, 1.);
  // Motes catch the light and lose it as they turn.
  vA = .35 + .65 * pow(.5 + .5 * sin(t * 1.7 + aSeed.y * 12.), 3.);
  vTint = aTint;
  gl_PointSize = uSize * uScale * (.6 + aSeed.w) / max(-mv.z, .5);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = /* glsl */`
uniform float uIntensity, uFog; varying vec3 vTint; varying float vA;
void main() {
  vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.;
  float d = gl_FragCoord.z / gl_FragCoord.w;
  float a = (1. - r) * (1. - r) * vA * exp(-uFog * uFog * d * d);
  if (a <= .002) discard;
  gl_FragColor = vec4(vTint * uIntensity * a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The floor under a fitting: the highest box top below it (an upper deck, a crate stack), else the ground. */
function floorUnder(p: THREE.Vector3, boxes: Box[]) {
  let y = 0;
  for (const b of boxes) if (b.max[1] <= p.y - .3 && p.x > b.min[0] && p.x < b.max[0] && p.z > b.min[2] && p.z < b.max[2]) y = Math.max(y, b.max[1]);
  return y;
}

export interface Fixture { at: THREE.Vector3; floor: number; tone: number; color: THREE.Color }

export function createFoundryRig(look: FoundryLook, q: ArenaQuality, map: { boxes: Box[]; bounds: number[] }, fittings: THREE.Vector3[]) {
  const group = new THREE.Group(); group.name = 'foundry-rig';
  const [bx0, bz0, bx1, bz1] = map.bounds, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
  const roofs: Fixture[] = fittings.filter(p => p.y < 9).map(p => { const tone = fixtureTone(p); return { at: p.clone(), floor: floorUnder(p, map.boxes), tone, color: toneColor(look, tone) }; });
  // Towers alternate around the yard by diagonal (each side of the yard gets one of each colour).
  const towers: Fixture[] = fittings.filter(p => p.y >= 9).map(p => { const tone = (p.x < cx) === (p.z < cz) ? 0 : 1; return { at: p.clone(), floor: 0, tone, color: toneColor(look, tone) }; });

  // ---------------------------------------------------------------- hemisphere fill
  const fill = new THREE.HemisphereLight(look.fillSky, look.fillGround, look.fill); group.add(fill);

  // ---------------------------------------------------------------- floodlights
  const shadowed = q.shadows && q.post ? (q.aoHigh ? 2 : q.lights >= 4 ? 2 : 1) : 0;
  const floods = towers.map((t, i) => {
    const s = new THREE.SpotLight(t.color, look.flood, 0, .36, .8, 2);
    s.position.copy(t.at).y -= .3;
    // Aimed 70 % of the way to the middle, a little above the ground: four separate pools raking across the yard and
    // up the warehouse's corners (the building everyone fights around reads against the dark), dark between them.
    s.target.position.set(t.at.x + (cx - t.at.x) * .7, 1.5, t.at.z + (cz - t.at.z) * .7);
    // Diagonal towers (0 and 3) cast shadows first, so the two shadowed lights cross the whole yard.
    const order = i === 0 ? 0 : i === 3 ? 1 : 2 + i;
    if (order < shadowed) {
      s.castShadow = true; const size = q.aoHigh ? 2048 : 1024; s.shadow.mapSize.set(size, size);
      s.shadow.camera.near = 4; s.shadow.camera.far = 95; s.shadow.bias = -.00035; s.shadow.normalBias = .05; s.shadow.radius = 3;
      s.shadow.autoUpdate = false; s.shadow.needsUpdate = true;
    }
    group.add(s, s.target);
    return s;
  });

  // ---------------------------------------------------------------- practical pool (follows the camera)
  const pool = Array.from({ length: Math.min(q.lights, roofs.length) }, () => {
    const l = new THREE.PointLight('#ffffff', 0, look.practicalRange, 2); group.add(l);
    return { l, fixture: -1, level: 0 };
  });

  // ---------------------------------------------------------------- glowing fittings get their cones, towers their beams
  const cones = (() => {
    if (!roofs.length) return null;
    const g = new THREE.CylinderGeometry(.16, 1, 1, 24, 1, true); g.translate(0, -.5, 0);
    const m = new THREE.ShaderMaterial({ vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true,
      uniforms: { uIntensity: { value: look.cone }, uFog: { value: look.fogDensity }, uNear: { value: 2.2 }, uPow: { value: 1.4 }, uTop: { value: 1.0001 } } });
    const mesh = new THREE.InstancedMesh(g, m, roofs.length); mesh.name = 'foundry-cones';
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
    roofs.forEach((f, i) => { const h = Math.max(.5, f.at.y - .05 - f.floor); M.compose(new THREE.Vector3(f.at.x, f.at.y - .05, f.at.z), Q, new THREE.Vector3(.5 + h * .42, h, .5 + h * .42)); mesh.setMatrixAt(i, M); mesh.setColorAt(i, f.color); });
    mesh.computeBoundingSphere(); mesh.frustumCulled = false; mesh.renderOrder = 5;
    return mesh;
  })();
  const beams = (() => {
    if (!floods.length) return null;
    const g = new THREE.CylinderGeometry(.03, 1, 1, 32, 1, true); g.translate(0, -.5, 0);
    const m = new THREE.ShaderMaterial({ vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true,
      uniforms: { uIntensity: { value: look.cone * .4 }, uFog: { value: look.fogDensity * .6 }, uNear: { value: 6 }, uPow: { value: 1.2 }, uTop: { value: .75 } } });
    const mesh = new THREE.InstancedMesh(g, m, floods.length); mesh.name = 'foundry-beams';
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), dir = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    floods.forEach((s, i) => {
      dir.subVectors(s.target.position, s.position); const len = dir.length() * 1.15; dir.normalize();
      Q.setFromUnitVectors(down, dir); const r = Math.tan(s.angle) * len * .8;
      M.compose(s.position, Q, new THREE.Vector3(r, len, r)); mesh.setMatrixAt(i, M); mesh.setColorAt(i, s.color);
    });
    mesh.computeBoundingSphere(); mesh.frustumCulled = false; mesh.renderOrder = 5;
    return mesh;
  })();
  if (cones) group.add(cones); if (beams) group.add(beams);

  // ---------------------------------------------------------------- dust in the light
  const dust = (() => {
    const per = Math.round(22 * look.dust * q.effects), perBeam = Math.round(90 * look.dust * q.effects);
    const n = per * roofs.length + perBeam * floods.length; if (!n) return null;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), tint = new Float32Array(n * 3);
    let k = 0; const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const put = (p: THREE.Vector3, c: THREE.Color) => { pos.set([p.x, p.y, p.z], k * 3); seed.set([rnd(), rnd(), rnd(), rnd()], k * 4); tint.set([c.r, c.g, c.b], k * 3); k++; };
    const p = new THREE.Vector3();
    for (const f of roofs) for (let i = 0; i < per; i++) {
      const t = .12 + rnd() * .8, h = f.at.y - f.floor, r = (.08 + t * .42 * h * .6) * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
      put(p.set(f.at.x + Math.cos(a) * r, f.at.y - t * h, f.at.z + Math.sin(a) * r), f.color);
    }
    for (const s of floods) {
      const dir = new THREE.Vector3().subVectors(s.target.position, s.position), len = dir.length(); dir.normalize();
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(side, dir);
      for (let i = 0; i < perBeam; i++) {
        // Toward the ground end of the beam, where the player sees it from inside the yard.
        // Toward the ground end of the beam and never high in the air (motes there read as stars against the night sky).
        const t = .62 + rnd() * .38, r = Math.tan(s.angle) * len * t * .55 * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
        p.copy(s.position).addScaledVector(dir, len * t).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
        p.y = Math.min(p.y, 1 + rnd() * 4); if (p.y < .15) p.y = .15 + rnd() * 2;
        put(p, s.color);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true,
      uniforms: { uTime: { value: 0 }, uSize: { value: .016 }, uScale: { value: 600 }, uIntensity: { value: .7 }, uFog: { value: look.fogDensity } } });
    const pts = new THREE.Points(g, m); pts.name = 'foundry-dust'; pts.frustumCulled = false; pts.renderOrder = 6;
    return pts;
  })();
  if (dust) group.add(dust);

  // ---------------------------------------------------------------- per frame
  let assignAt = 0, frame = 0;
  const near: number[] = [];
  /** Point the pool at the fittings nearest the camera; cross-fade lights that change fitting. */
  function update(dt: number, cam: THREE.Vector3, drawHeight: number, shadowsLive: boolean) {
    frame++;
    if (dust) { const u = (dust.material as THREE.ShaderMaterial).uniforms; u.uTime.value += dt; u.uScale.value = drawHeight * .62; /* ≈ pixels per metre at 1 m for the arena's field of view */ }
    if ((assignAt -= dt) <= 0 && pool.length) {
      assignAt = .3;
      near.length = 0;
      roofs.map((f, i) => [i, (f.at.x - cam.x) ** 2 + ((f.at.y - cam.y) * 1.6) ** 2 + (f.at.z - cam.z) ** 2] as const).sort((a, b) => a[1] - b[1]).slice(0, pool.length).forEach(([i]) => near.push(i));
      // Keep slots whose fitting is still wanted; free the rest for the new ones.
      // (A slot fading out toward fitting i holds -2 - i.)
      const target = (f: number) => (f <= -2 ? -2 - f : f);
      const free = pool.filter(s => !near.includes(target(s.fixture))), taken = new Set(pool.map(s => target(s.fixture)));
      for (const i of near) if (!taken.has(i)) { const s = free.shift(); if (s) s.fixture = -2 - i; /* pending: fade out, then move */ }
    }
    for (const s of pool) {
      if (s.fixture <= -2) { s.level -= dt * 4; if (s.level <= 0) { s.level = 0; s.fixture = -2 - s.fixture; const f = roofs[s.fixture]; s.l.position.set(f.at.x, f.at.y - .25, f.at.z); s.l.color.copy(f.color); } }
      else if (s.fixture >= 0) s.level = Math.min(1, s.level + dt * 4);
      s.l.intensity = look.practical * s.level;
    }
    // Shadowed floodlights: redrawn in turn (one per call, every 10 frames on Medium/High, every 4 on Ultra).
    if (shadowsLive) {
      const every = q.aoHigh ? 4 : 10, list = floods.filter(f => f.castShadow);
      if (list.length && frame % every === 0) list[(frame / every) % list.length | 0].shadow.needsUpdate = true;
    }
  }
  /** Redraw every shadow once (set dressing arrived, a door moved). */
  function refreshShadows() { for (const f of floods) if (f.castShadow) f.shadow.needsUpdate = true; }

  /** The light falling on the first-person weapon: the strongest practical or floodlight near the camera. */
  const sampleOut = { color: new THREE.Color(), intensity: 0, dir: new THREE.Vector3(0, 1, 0) };
  const tmp = new THREE.Vector3(), axis = new THREE.Vector3(), toCam = new THREE.Vector3();
  function sample(cam: THREE.Vector3) {
    let best = 0; sampleOut.intensity = 0; sampleOut.color.setRGB(0, 0, 0);
    const consider = (p: THREE.Vector3, c: THREE.Color, I: number) => {
      tmp.subVectors(p, cam); const d2 = Math.max(1, tmp.lengthSq()), e = I / d2;
      sampleOut.color.r += c.r * e; sampleOut.color.g += c.g * e; sampleOut.color.b += c.b * e;
      if (e > best) { best = e; sampleOut.dir.copy(tmp).normalize(); }
      sampleOut.intensity += e;
    };
    for (const s of pool) if (s.level > 0) consider(s.l.position, s.l.color, s.l.intensity);
    for (const f of floods) {
      axis.subVectors(f.target.position, f.position).normalize(); toCam.subVectors(cam, f.position).normalize();
      const inBeam = THREE.MathUtils.smoothstep(toCam.dot(axis), Math.cos(f.angle), Math.cos(f.angle * .4));
      if (inBeam > 0) consider(f.position, f.color, f.intensity * inBeam);
    }
    const m = Math.max(sampleOut.color.r, sampleOut.color.g, sampleOut.color.b, 1e-4); sampleOut.color.multiplyScalar(1 / m);
    return sampleOut;
  }
  function dispose() {
    for (const o of [cones, beams, dust]) if (o) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    for (const f of floods) f.shadow.dispose();
  }
  return { group, update, sample, refreshShadows, dispose, floods, roofs, towers, cones, beams, dust, fill };
}
export type FoundryRig = ReturnType<typeof createFoundryRig>;
