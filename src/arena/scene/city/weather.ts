// Operation: Metropolis — rain that belongs to the city, and the light hanging in wet or dark air.
//
//   • A heightfield of the map (the highest surface over every half-metre cell) tells the rain where it lands: drops
//     stop at roofs, awnings and canopies, splashes appear on whatever surface is there, the arcade stays dry.
//   • Streaks: thin quads falling along the wind, as long as a raindrop travels in a shutter interval, never thinner
//     than a pixel, faded near the eye. They are lit by the sky (the fog colour) and glint near street lamps.
//   • Curtains: cylinders of falling streak texture at 16–60 m, depth-tested against the buildings, so the distance
//     is veiled by rain rather than just fog.
//   • Splashes: rings and a crown of droplets where drops land, re-seeded each cycle around the player.
//   • Lamps: a soft halo around every street lamp and a faint cone of light under it, stronger in rain and at night.
// All of it is a handful of instanced draws with no per-frame CPU work beyond setting uniforms.
import * as THREE from 'three';
import { heightFogUniforms } from './atmosphere';

type Box = { min: number[]; max: number[]; mat: string };
const NO_ROOF = new Set(['lamppost', 'palm', 'tree', 'rail', 'frame', 'hedge', 'glass']);

/** The highest surface over each 0.5 m cell of the site (R32F); outside it, the street. */
export function heightfield(boxes: Box[], bounds: number[], street: number) {
  const [x0, z0, x1, z1] = bounds, cell = .5, w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell);
  const data = new Float32Array(w * h).fill(street);
  for (const b of boxes) {
    if (NO_ROOF.has(b.mat) || b.max[1] < street - .5) continue;
    if (b.max[0] - b.min[0] < .3 && b.max[2] - b.min[2] < .3) continue;      // posts and poles do not stop rain
    const i0 = Math.max(0, Math.floor((b.min[0] - x0) / cell)), i1 = Math.min(w - 1, Math.ceil((b.max[0] - x0) / cell) - 1);
    const j0 = Math.max(0, Math.floor((b.min[2] - z0) / cell)), j1 = Math.min(h - 1, Math.ceil((b.max[2] - z0) / cell) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (b.max[1] > data[j * w + i]) data[j * w + i] = b.max[1];
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return { tex, origin: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0), sample: (x: number, z: number) => { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); return i < 0 || j < 0 || i >= w || j >= h ? street : data[j * w + i]; } };
}

const HF = /* glsl */`
uniform sampler2D uHeight; uniform vec4 uHeightBox; uniform float uStreetY;
float groundAt(vec2 xz) { vec2 uv = (xz - uHeightBox.xy) / uHeightBox.zw; if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return uStreetY; return texture2D(uHeight, uv).r; }
`;
const LAMPS = /* glsl */`
uniform vec4 uLamps[8]; uniform vec3 uLampColor;
vec3 lampGlint(vec3 p) { vec3 s = vec3(0.); for (int i = 0; i < 8; i++) { vec3 d = p - uLamps[i].xyz; s += uLamps[i].w / (1. + dot(d, d) * .9); } return s * uLampColor; }
`;

export interface WeatherOptions { streaks: number; splashes: number; curtains: number; radius: number }
export function createRain(field: ReturnType<typeof heightfield>, street: number, ambient: THREE.Color, o: WeatherOptions) {
  const group = new THREE.Group(); group.name = 'rain';
  const shared = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uHeight: { value: field.tex }, uHeightBox: { value: field.origin }, uStreetY: { value: street },
    uAmbient: { value: ambient.clone() }, uLamps: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 0)) }, uLampColor: { value: new THREE.Color('#ffd9a8') },
    uWind: { value: new THREE.Vector2(.9, .35) }, uRadius: { value: o.radius }, uPixel: { value: 1 / 720 },
  };
  // ---------------------------------------------------------------- streaks
  {
    const n = o.streaks, quad = new THREE.InstancedBufferGeometry(), base = new THREE.PlaneGeometry(1, 1).translate(0, .5, 0);
    quad.index = base.index; quad.setAttribute('position', base.attributes.position); quad.setAttribute('uv', base.attributes.uv);
    const seed = new Float32Array(n * 4); for (let i = 0; i < n; i++) seed.set([hash(i), hash(i + 1e4), hash(i + 2e4), hash(i + 3e4)], i * 4);
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); quad.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...heightFogUniforms(), fogColor: { value: ambient.clone() }, fogNear: { value: 1 }, fogFar: { value: 1e4 } },
      transparent: true, depthWrite: false, fog: true,
      vertexShader: HF + LAMPS + `#include <fog_pars_vertex>
        uniform float uTime, uRadius, uPixel; uniform vec3 uCam; uniform vec2 uWind; uniform vec3 uAmbient; attribute vec4 aSeed; varying float vA; varying vec2 vUv; varying vec3 vLit;
        void main() {
          float R = uRadius * 2., H = 26., speed = 8.5 + aSeed.w * 2.5;
          vec3 p; p.xz = uCam.xz + mod(aSeed.xy * R - uCam.xz + R * .5, R) - R * .5;
          p.y = uCam.y + 17. - mod(uTime * speed + aSeed.z * H, H);
          vec3 fall = normalize(vec3(uWind.x, -speed, uWind.y)), toCam = normalize(uCam - p), side = normalize(cross(fall, toCam));
          float len = .5 + aSeed.w * .35, dist = length(uCam - p);
          // At least about a pixel wide wherever it is.
          float width = max(.0045, dist * uPixel * 1.6);
          vec3 wp = p + fall * (position.y - .5) * len + side * position.x * width;
          float ground = groundAt(p.xz);
          float hidden = step(p.y - len * .5, ground + .02);
          vA = (1. - hidden) * smoothstep(.6, 2.2, dist) * (1. - smoothstep(uRadius * .75, uRadius, length(p.xz - uCam.xz))) * (.22 + .18 * aSeed.x) * clamp(.0045 / width, .35, 1.);
          vUv = uv; vLit = uAmbient * 1.6 + lampGlint(p);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.); gl_Position = projectionMatrix * mvPosition;
          if (vA <= .001) gl_Position = vec4(2., 2., 2., 1.);
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <fog_pars_fragment>
        varying float vA; varying vec2 vUv; varying vec3 vLit;
        void main() { float across = 1. - abs(vUv.x - .5) * 2., along = smoothstep(0., .3, vUv.y) * smoothstep(1., .55, vUv.y);
          gl_FragColor = vec4(vLit, vA * across * along);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(quad, mat); mesh.frustumCulled = false; mesh.renderOrder = 7; mesh.name = 'rain-streaks'; group.add(mesh);
  }
  // ---------------------------------------------------------------- curtains
  for (let k = 0; k < o.curtains; k++) {
    const r = 16 + k * 18, geo = new THREE.CylinderGeometry(r, r, 46, 40, 1, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...heightFogUniforms(), fogColor: { value: ambient.clone() }, fogNear: { value: 1 }, fogFar: { value: 1e4 }, uLayer: { value: k } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: `#include <fog_pars_vertex>
        uniform vec3 uCam; varying vec2 vUv; varying vec3 vW;
        void main() { vec3 wp = position + vec3(uCam.x, uCam.y + 8., uCam.z); vW = wp; vUv = uv; vec4 mvPosition = viewMatrix * vec4(wp, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <fog_pars_fragment>
        uniform float uTime, uLayer; uniform vec3 uAmbient; varying vec2 vUv; varying vec3 vW;
        float h1(float n) { return fract(sin(n * 78.233) * 43758.5453); }
        void main() {
          // Columns of streaks: each column falls at its own phase; brightness varies along the column.
          float cols = 900. + uLayer * 300., x = vUv.x * cols, c = floor(x), fx = fract(x);
          float y = vUv.y * (14. + uLayer * 4.) + uTime * (3.2 - uLayer * .5) + h1(c) * 17.;
          float streak = smoothstep(.5, .0, abs(fx - .5)) * smoothstep(.55, 1., fract(y)) * step(.35, h1(c + 3.));
          float fade = smoothstep(0., .2, vUv.y) * smoothstep(1., .55, vUv.y);
          gl_FragColor = vec4(uAmbient * 1.8, streak * fade * (.16 - uLayer * .03));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'rain-curtain'; group.add(mesh);
  }
  // ---------------------------------------------------------------- splashes
  if (o.splashes) {
    const n = o.splashes, quad = new THREE.InstancedBufferGeometry(), base = new THREE.PlaneGeometry(1, 1);
    quad.index = base.index; quad.setAttribute('position', base.attributes.position); quad.setAttribute('uv', base.attributes.uv);
    const seed = new Float32Array(n * 3); for (let i = 0; i < n; i++) seed.set([hash(i + 5e4), hash(i + 6e4), hash(i + 7e4)], i * 3);
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3)); quad.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...heightFogUniforms(), fogColor: { value: ambient.clone() }, fogNear: { value: 1 }, fogFar: { value: 1e4 } },
      transparent: true, depthWrite: false, fog: true,
      vertexShader: HF + LAMPS + `#include <fog_pars_vertex>
        uniform float uTime; uniform vec3 uCam, uAmbient; attribute vec3 aSeed; varying vec2 vUv; varying float vAge; varying vec3 vLit; varying float vA;
        float h1(float n) { return fract(sin(n * 78.233) * 43758.5453); }
        void main() {
          float period = .42 + aSeed.z * .25, cyc = floor(uTime / period + aSeed.z * 7.), age = fract(uTime / period + aSeed.z * 7.);
          float R = 22.; vec2 rnd = vec2(h1(aSeed.x * 91. + cyc), h1(aSeed.y * 37. + cyc * 1.7));
          vec2 xz = uCam.xz + (rnd - .5) * R; float y = groundAt(xz);
          float size = .1 + aSeed.x * .1;
          vec3 wp = vec3(xz.x + position.x * size, y + .012, xz.y - position.y * size);
          vAge = age; vUv = uv; vLit = uAmbient * 1.4 + lampGlint(vec3(xz.x, y, xz.y));
          float d = length(xz - uCam.xz); vA = (1. - smoothstep(R * .3, R * .5, d)) * step(y, uCam.y + 1.5);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <fog_pars_fragment>
        varying vec2 vUv; varying float vAge; varying vec3 vLit; varying float vA;
        void main() { float d = length(vUv - .5) * 2., r = vAge * .9;
          float ring = smoothstep(.12, 0., abs(d - r)) * (1. - vAge), dots = step(.82, fract(sin(floor(atan(vUv.y - .5, vUv.x - .5) * 3.) * 12.9898) * 437.5)) * smoothstep(.1, 0., abs(d - r * 1.25)) * (1. - vAge);
          gl_FragColor = vec4(vLit * 1.2, (ring * .3 + dots * .4) * vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(quad, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'rain-splashes'; group.add(mesh);
  }
  /** Per frame: time, camera, the size of a pixel one metre away (2 tan(fov/2) / height), nearest lamps (position and strength). */
  const update = (t: number, cam: THREE.Vector3, pixel: number, lamps: THREE.Vector4[]) => {
    shared.uTime.value = t; shared.uCam.value.copy(cam); shared.uPixel.value = pixel;
    for (let i = 0; i < 8; i++) shared.uLamps.value[i].copy(lamps[i] ?? FAR);
  };
  const dispose = () => { group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); };
  return { group, update, dispose };
}
const FAR = new THREE.Vector4(0, -1000, 0, 0);

/**
 * Halos around lamps and a faint cone of light beneath them: the light scattered by wet or hazy air. `strength`
 * scales with the variant (none at noon, faint at sunset, clear in rain and at night).
 */
export function createLampGlow(heads: THREE.Vector3[], color: THREE.Color, strength: number) {
  const group = new THREE.Group(); group.name = 'lamp-glow';
  if (!heads.length || strength <= 0) return { group, dispose: () => {} };
  // Halos: camera-facing quads (instanced), soft radial falloff.
  const quad = new THREE.InstancedBufferGeometry(), base = new THREE.PlaneGeometry(1, 1);
  quad.index = base.index; quad.setAttribute('position', base.attributes.position); quad.setAttribute('uv', base.attributes.uv);
  const at = new Float32Array(heads.length * 3); heads.forEach((p, i) => at.set([p.x, p.y, p.z], i * 3));
  quad.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 3)); quad.instanceCount = heads.length;
  const halo = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone().multiplyScalar(strength) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aAt; varying vec2 vUv; varying float vFade;
      void main() { vec4 c = viewMatrix * vec4(aAt, 1.); float d = -c.z; vUv = uv; vFade = smoothstep(.5, 3., d) * (1. - smoothstep(90., 160., d));
        c.xy += position.xy * (1.1 + d * .008); gl_Position = projectionMatrix * c; }`,
    fragmentShader: `uniform vec3 uColor; varying vec2 vUv; varying float vFade;
      void main() { float r = length(vUv - .5) * 2.; float g = exp(-r * r * 7.) * .22 + exp(-r * 22.) * .6; gl_FragColor = vec4(uColor * g * vFade, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const halos = new THREE.Mesh(quad, halo); halos.frustumCulled = false; halos.renderOrder = 8; group.add(halos);
  // Cones: a soft-edged open cone under each head, brighter near the lamp and along the axis.
  const cone = new THREE.ConeGeometry(2.4, 5.2, 24, 1, true).translate(0, -2.6, 0), cones = new THREE.InstancedMesh(cone, new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone().multiplyScalar(strength * .045) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main() { vY = -position.y / 5.2; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV;
      void main() { float edge = pow(1. - abs(dot(normalize(vN), normalize(vV))), 1.5); float a = (1. - edge) * (1. - vY) * (1. - vY) * smoothstep(0., .15, vY); gl_FragColor = vec4(uColor * a, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), heads.length);
  const M = new THREE.Matrix4(); heads.forEach((p, i) => cones.setMatrixAt(i, M.makeTranslation(p.x, p.y - .15, p.z)));
  cones.frustumCulled = false; cones.renderOrder = 8; group.add(cones);
  const dispose = () => { quad.dispose(); halo.dispose(); cone.dispose(); (cones.material as THREE.Material).dispose(); cones.dispose(); };
  return { group, dispose };
}
const hash = (i: number) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
