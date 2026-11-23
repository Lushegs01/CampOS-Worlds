// Instanced pedestrians: four body types, each one geometry with tagged parts (legs, arms, head) animated in the
// vertex shader from per-instance gait phase, stride and pose, and coloured per instance (skin, top, bottom,
// shoes, hair, accent). Hundreds of people cost four draw calls; nothing is skinned on the CPU.
import * as THREE from 'three';
import { Builder } from './geom';

// Parts: 0 torso (static), 1 head, 2 L thigh, 3 L shin, 4 R thigh, 5 R shin, 6 L upper arm, 7 L forearm, 8 R upper arm, 9 R forearm.
// Slots: 0 skin, 1 top, 2 bottom, 3 shoes, 4 hair, 5 accent. opt: 1 bag, 2 headwear.
export const POSE = { walk: 0, idle: 1, sit: 2, cower: 3, talk: 4, wave: 5 } as const;
const HIP = .94, KNEE = .5, SH = 1.42, ELB = 1.13;

function body(kind: string) {
  const b = new Builder(), woman = kind.startsWith('woman'), broad = kind === 'manBroad', dress = kind === 'womanDress';
  const sw = woman ? .17 : broad ? .23 : .2, hipW = woman ? .11 : .1;
  const t = (slot: number, part = 0, opt = 0) => ({ slot, part, opt });
  // Torso: chest and abdomen, pelvis in the trousers' colour.
  b.capsule([0, 1.25, 0], woman ? .14 : broad ? .19 : .16, .28, t(1), undefined, [woman ? 1.05 : 1.12, 1, woman ? .72 : .7]);
  b.capsule([0, HIP + .06, 0], woman ? .15 : .14, .06, t(dress ? 1 : 2), undefined, [1.1, 1, .78]);
  b.cyl([0, 1.53, 0], .05, .055, .12, 8, t(0)); // neck
  // Head, ears, nose, hair.
  b.sphere([0, 1.655, .005], .108, [.92, 1.12, 1.02], t(0, 1));
  b.sphere([0, 1.64, .1], .022, [1, 1.2, 1], t(0, 1), 6);
  for (const s of [-1, 1]) b.sphere([s * .1, 1.655, 0], .025, [.6, 1, 1], t(0, 1), 6);
  if (woman) { b.sphere([0, 1.7, -.02], .118, [.98, .95, 1.04], t(4, 1)); b.sphere([0, 1.74, -.12], .08, [1, 1, 1], t(4, 1), 8); }
  else b.sphere([0, 1.695, -.005], .112, [.96, .82, 1.02], t(4, 1));
  // Headwear (a cap, or a gele-style wrap), shown per instance.
  if (woman) b.sphere([0, 1.79, -.03], .14, [1.15, .62, 1.05], t(5, 1, 2), 10);
  else { b.sphere([0, 1.73, -.005], .118, [1, .55, 1.04], t(5, 1, 2), 10); b.box([0, 1.72, .1], [.18, .02, .1], t(5, 1, 2)); }
  // Legs: thigh and shin each about their joint; shoes.
  for (const s of [-1, 1]) {
    const L = s > 0, th = L ? 2 : 4, sh = L ? 3 : 5, x = s * hipW;
    b.capsule([x, (HIP + KNEE) / 2, 0], woman ? .068 : .075, HIP - KNEE - .1, t(dress ? 0 : 2, th));
    b.capsule([x, (KNEE + .1) / 2 + .02, 0], .058, KNEE - .16, t(dress ? 0 : 2, sh));
    b.round([x, .045, .04], [.1, .09, .26], .035, t(3, sh));
  }
  if (dress) b.cyl([0, .7, 0], .17, .29, .58, 12, t(2, 0)); // the dress's skirt (printed fabric)
  // Arms: upper arm and forearm, hands.
  for (const s of [-1, 1]) {
    const L = s > 0, up = L ? 6 : 8, fo = L ? 7 : 9, x = s * sw;
    b.sphere([x, SH, 0], woman ? .06 : .075, [1, 1, 1], t(1, up), 8);
    b.capsule([x + s * .01, (SH + ELB) / 2, 0], woman ? .045 : .052, SH - ELB - .08, t(1, up));
    b.capsule([x + s * .015, ELB - .13, 0], .04, .2, t(0, fo));
    b.sphere([x + s * .015, ELB - .3, .01], .045, [.8, 1.1, 1], t(0, fo), 6);
  }
  // A shoulder bag on the left (shown per instance).
  b.round([.24, 1.0, -.02], [.07, .26, .3], .04, t(5, 0, 1));
  b.box([.05, 1.28, 0], [.02, .62, .05], t(5, 0, 1), [0, 0, .5]);
  const g = b.build();
  g.deleteAttribute('color'); g.deleteAttribute('aTag');
  return g;
}
export const BODY_GEOMETRY = () => ({ man: body('man'), woman: body('woman'), manBroad: body('manBroad'), womanDress: body('womanDress') });

export function peopleMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: .78, metalness: 0, envMapIntensity: .7 });
  const uniforms = { uTime: { value: 0 } };
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
attribute vec4 aPart; attribute vec3 iSkin; attribute vec3 iTop; attribute vec3 iBottom; attribute vec3 iHair; attribute vec4 iShoe; attribute vec3 iAccent; attribute vec4 iAnim;
varying vec3 vCol; varying float vFade;
vec3 rx(vec3 p, vec3 c, float a) { p -= c; float s = sin(a), k = cos(a); return vec3(p.x, p.y * k - p.z * s, p.y * s + p.z * k) + c; }
vec3 rxn(vec3 n, float a) { float s = sin(a), k = cos(a); return vec3(n.x, n.y * k - n.z * s, n.y * s + n.z * k); }
vec3 rz(vec3 p, vec3 c, float a) { p -= c; float s = sin(a), k = cos(a); return vec3(p.x * k - p.y * s, p.x * s + p.y * k, p.z) + c; }
vec3 rzn(vec3 n, float a) { float s = sin(a), k = cos(a); return vec3(n.x * k - n.y * s, n.x * s + n.y * k, n.z); }`)
      .replace('#include <beginnormal_vertex>', `
vec3 animPos = position; vec3 objectNormal = normal;
{
  float part = floor(aPart.x + .5), slot = floor(aPart.y + .5), opt = floor(aPart.z + .5);
  float ph = iAnim.x, amp = iAnim.y, pose = floor(iAnim.z + .5), flags = iAnim.w;
  float t = uTime + ph * .37;
  bool bag = mod(flags, 2.) > .5, hat = flags > 1.5;
  if ((opt == 1. && !bag) || (opt == 2. && !hat)) animPos = vec3(0., 1.2, 0.);
  // Joint angles (radians, about x; negative swings forward).
  float s = sin(ph), c2 = sin(ph + 1.57);
  float hipL = -s * .52 * amp, hipR = s * .52 * amp;
  float kneeL = max(0., sin(ph + 2.2)) * .95 * amp + .05, kneeR = max(0., sin(ph + 2.2 + 3.1416)) * .95 * amp + .05;
  float shL = s * .42 * amp, shR = -s * .42 * amp, elL = -.25 - max(0., s) * .35 * amp, elR = -.25 - max(0., -s) * .35 * amp;
  float lean = amp > 1.25 ? .2 : .04 * amp, drop = 0., armOut = .06;
  float bob = abs(c2) * .035 * amp;
  if (pose == 1.) { hipL = hipR = 0.; kneeL = kneeR = .03; float br = sin(t * 1.3) * .02; shL = br + .05; shR = -br + .05; elL = elR = -.18; lean = 0.; bob = 0.; }
  if (pose == 2.) { hipL = hipR = -1.5; kneeL = kneeR = 1.5; shL = shR = -.35; elL = elR = -.7; lean = -.04; drop = -.47; bob = 0.; }
  if (pose == 3.) { hipL = hipR = -2.0; kneeL = kneeR = 2.25; shL = shR = -2.7; elL = elR = -1.3; lean = .75; drop = -.52; bob = 0.; armOut = .25; }
  if (pose == 4.) { hipL = hipR = 0.; kneeL = kneeR = .04; shL = .05; elL = -.2; shR = -.55 + sin(t * 2.7) * .28; elR = -1.25 + sin(t * 3.4) * .3; lean = 0.; bob = 0.; }
  if (pose == 5.) { hipL = hipR = 0.; kneeL = kneeR = .04; shL = .05; elL = -.2; shR = -2.6; elR = -.3 + sin(t * 9.) * .35; lean = 0.; bob = 0.; }
  vec3 hip = vec3(sign(animPos.x) * .1, ${HIP.toFixed(2)}, 0.), knee = vec3(hip.x, ${KNEE.toFixed(2)}, 0.);
  if (part == 3. || part == 5.) { float k = part == 3. ? kneeL : kneeR; animPos = rx(animPos, knee, k); objectNormal = rxn(objectNormal, k); }
  if (part >= 2. && part <= 5.) { float h = part <= 3. ? hipL : hipR; animPos = rx(animPos, hip, h); objectNormal = rxn(objectNormal, h); }
  if (part >= 6.) {
    float sd = part <= 7. ? 1. : -1.; vec3 shp = vec3(sd * .2, ${SH.toFixed(2)}, 0.), elp = vec3(sd * .215, ${ELB.toFixed(2)}, 0.);
    if (part == 7. || part == 9.) { float e = part == 7. ? elL : elR; animPos = rx(animPos, elp, e); objectNormal = rxn(objectNormal, e); }
    float a = part <= 7. ? shL : shR; animPos = rx(animPos, shp, a); objectNormal = rxn(objectNormal, a);
    animPos = rz(animPos, shp, sd * armOut); objectNormal = rzn(objectNormal, sd * armOut);
  }
  if (part == 0. && animPos.y < ${HIP.toFixed(2)} + .02 && pose != 2.) {} // pelvis and skirt stay with the hips
  if (part == 1. || part >= 6. || (part == 0. && animPos.y > ${HIP.toFixed(2)} + .05)) { animPos = rx(animPos, vec3(0., ${HIP.toFixed(2)}, 0.), lean); objectNormal = rxn(objectNormal, lean); }
  if (part == 1.) { float look = (pose == 1. || pose == 4.) ? sin(t * .6) * .35 : 0.; vec3 nk = vec3(0., 1.53, 0.); vec3 q = animPos - nk; float sn = sin(look), cs = cos(look); animPos = vec3(q.x * cs + q.z * sn, q.y, -q.x * sn + q.z * cs) + nk; }
  animPos.y += bob + drop;
  vCol = slot == 0. ? iSkin : slot == 1. ? iTop : slot == 2. ? iBottom : slot == 3. ? iShoe.rgb : slot == 4. ? iHair : iAccent;
  vFade = iShoe.w;
}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = animPos;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCol; varying float vFade;')
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = vCol;
if (vFade < .999) { float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453); if (n > vFade) discard; }`);
  };
  m.customProgramCacheKey = () => 'city-people';
  return { material: m, uniforms };
}

/** A soft round contact shadow (shared by people and vehicles). */
export function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(.55, 'rgba(0,0,0,0.32)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
