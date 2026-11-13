// Operation: Metropolis — what weather and age do to a surface, added to the city's PBR materials in their shaders.
//
// A material carries a list of named layers (`userData.layers`, so a clone keeps them) and one compile hook applies
// them in order. All work is a handful of value-noise taps per pixel in world space; nothing is downloaded.
//   macro     large-scale tone and roughness variation (breaks up the repeat of a 2–5 m texture across a façade)
//   road      asphalt's history: rectangular patch repairs with sealed seams, oil stains, polished wheel tracks
//   grime     a darker, browner splash zone at the foot of walls and rain-washed streaks in patches down them
//   wet       rain: porous surfaces darken, everything gets smoother; walls darken in uneven runs
//   puddles   rain on the ground: standing water in the low spots (mirror-smooth, dark, flat), rings from drops
//   interior  the light of the place a surface is in (`inside()` in materials.ts): sky share and interior fill
// Shared parameters (`cityWeather`) are uniform objects every material references, so weather is one write.
import * as THREE from 'three';

export type Layer = 'macro' | 'road' | 'grime' | 'wet' | 'puddles' | 'interior' | 'reflect';
export const cityWeather = {
  uWet: { value: 0 },
  uPuddle: { value: .58 },           // noise threshold for standing water (lower: more puddles)
  uStreet: { value: 5 },             // street level, for the splash zone at the foot of walls
  uRainTime: { value: 0 },
  // Planar reflection of the street (High and Ultra in the rain; see reflection.ts). Strength 0: not drawn.
  uReflectMap: { value: null as THREE.Texture | null },
  uReflectMatrix: { value: new THREE.Matrix4() },
  uReflect: { value: 0 },
  /** QA: show the raw reflection on the street. */
  uReflectDebug: { value: 0 },
  /** The rain heightfield (weather.ts): a surface with something above it stays dry. */
  uHeight: { value: null as THREE.Texture | null },
  uHeightBox: { value: new THREE.Vector4(0, 0, 1, 1) },
};
/** Per-material uniforms (the interior layer's sky share and fill). */
const own = new WeakMap<THREE.Material, Record<string, { value: unknown }>>();
export function layerUniforms(m: THREE.Material, u: Record<string, { value: unknown }>) { own.set(m, { ...(own.get(m) ?? {}), ...u }); }

/** 128² random values, filtered and mip-mapped: one texture fetch is one octave of value noise, and far away it
 *  averages out instead of sparkling. */
function noiseTexture() {
  const n = 128, data = new Uint8Array(n * n * 4);
  let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n * n; i++) { const v = Math.round(rnd() * 255); data.set([v, Math.round(rnd() * 255), Math.round(rnd() * 255), 255], i * 4); }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
cityWeatherNoise();
function cityWeatherNoise() { (cityWeather as unknown as Record<string, { value: unknown }>).uCityNoise = { value: noiseTexture() }; }

const NOISE = /* glsl */`
varying vec3 vCityW; varying vec3 vCityN; uniform sampler2D uCityNoise;
float cH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cN(vec2 p) { return texture2D(uCityNoise, (p + .5) * (1. / 128.)).r; }
// Planar coordinates for a surface: the ground by x/z, a wall by its run and height.
vec2 cityPlane(vec3 p, vec3 n) { return abs(n.y) > .7 ? p.xz : (abs(n.x) > abs(n.z) ? vec2(p.z, p.y) : vec2(p.x, p.y)); }
`;
const RIPPLE = /* glsl */`
// Rings spreading from raindrops: two layers of cells, each with a drop at a random time and place.
vec2 cityRipple(vec2 p, float t) {
  vec2 acc = vec2(0.);
  for (int l = 0; l < 2; l++) {
    vec2 q = p * (l == 0 ? 2.1 : 2.9) + float(l) * 4.37, i = floor(q), f = fract(q);
    float h = cH(i + float(l) * 13.1), ph = fract(t * (.85 + .3 * h) + h);
    vec2 c = .2 + .6 * vec2(cH(i + 3.1), cH(i + 7.7)), dv = f - c; float d = length(dv);
    float x = (d - ph * .48) * 26., w = (1. - ph) * (1. - ph) * step(abs(x), 3.1416);
    acc += dv / (d + 1e-3) * sin(x) * w;
  }
  return acc;
}
`;

const BITS: Record<Layer, number> = { macro: 1, road: 2, grime: 4, wet: 8, puddles: 16, reflect: 32, interior: 64 };
const maskOf = (layers: Layer[]) => layers.reduce((a, l) => a | BITS[l], 0);
/** Defaults for the interior layer's uniforms on materials that do not use it. */
const noInterior = { uSkyShare: { value: 1 }, uFill: { value: new THREE.Color(0, 0, 0) }, uFillScale: { value: 1 } };

/**
 * One program for every layered city surface: each layer's code is behind a test of the material's `uLayers` bits
 * (a uniform branch, the same for every pixel of a draw). Separate programs per layer combination multiplied the
 * shaders to compile at deployment — which blocks the main thread on drivers without parallel shader compilation.
 */
function apply(shader: THREE.WebGLProgramParametersWithUniforms, m: THREE.Material) {
  Object.assign(shader.uniforms, cityWeather, noInterior, own.get(m) ?? {});
  shader.vertexShader = 'varying vec3 vCityW; varying vec3 vCityN;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 cw = vec4(transformed, 1.);
  #ifdef USE_INSTANCING
    cw = instanceMatrix * cw;
  #endif
    vCityW = (modelMatrix * cw).xyz; vCityN = normalize((vec4(transformedNormal, 0.) * viewMatrix).xyz); }`);
  const pre = NOISE + RIPPLE + `uniform float uWet, uPuddle, uStreet, uRainTime, uReflect, uReflectDebug; uniform sampler2D uReflectMap; uniform mat4 uReflectMatrix;
uniform int uLayers; uniform float uSkyShare, uFillScale; uniform vec3 uFill; uniform sampler2D uHeight; uniform vec4 uHeightBox;
/** 1 where the sky is open above this point (probed a little out from the surface), 0 under a roof or awning. */
float cityOpen(vec3 p, vec3 n) {
  vec3 q = p + n * .35; vec2 uv = (q.xz - uHeightBox.xy) / uHeightBox.zw;
  if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return 1.;
  return step(texture2D(uHeight, uv).r, q.y + .3);
}
bool cityHas(int bit) { return (uLayers & bit) != 0; }
float upwOf(vec3 n) { return smoothstep(.55, .95, normalize(n).y); }
`;
  const body = `float cityPuddle = 0., cityWet = 0.;
{
  vec3 cn = normalize(vCityN); vec2 cp = cityPlane(vCityW, cn); float upw = smoothstep(.55, .95, cn.y), wallw = 1. - abs(cn.y);
  float m1 = cN(cp * .09 + 1.7), m2 = cN(cp * .37 + 5.3), m3 = cN(cp * 1.9);
  if (cityHas(1)) {
    // Large-scale variation: a few per cent of tone and warmth, and of roughness.
    diffuseColor.rgb *= (1. + (m1 - .5) * .24 + (m2 - .5) * .12) * mix(vec3(1.), vec3(1.035, 1., .955), m1 - .3);
    roughnessFactor = clamp(roughnessFactor * (1. + (m2 - .5) * .3 + (m3 - .5) * .1), .04, 1.);
  }
  if (cityHas(2) && upw > .5) {
    // Patch repairs: some 6 × 3 m cells were dug up and resurfaced (darker, smoother), edged by a sealed seam.
    vec2 rc = vCityW.xz / vec2(6.3, 3.1), ri = floor(rc), rf = fract(rc); float rr = cH(ri + 17.3);
    vec2 inset = .12 + .2 * vec2(cH(ri + 3.7), cH(ri + 9.1));
    float patchIn = step(.8, rr) * step(inset.x, rf.x) * step(rf.x, 1. - inset.x * .7) * step(inset.y, rf.y) * step(rf.y, 1. - inset.y * .6);
    vec2 e = min(rf - inset, 1. - vec2(inset.x * .7, inset.y * .6) - rf) * vec2(6.3, 3.1);
    float seam = patchIn * (1. - smoothstep(.02, .06, min(e.x, e.y)));
    diffuseColor.rgb *= 1. - .22 * patchIn; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.03, .03, .032), seam * .8);
    roughnessFactor = mix(roughnessFactor, roughnessFactor * .85, patchIn);
    // Oil: dark, slightly glossy blotches; wheel tracks: a faint polish along the traffic.
    float oil = smoothstep(.7, .86, cN(vCityW.xz * .55 + 11.) * .6 + cN(vCityW.xz * 2.3) * .4);
    diffuseColor.rgb *= 1. - .35 * oil; roughnessFactor *= 1. - .25 * oil;
    float track = smoothstep(.35, .5, abs(fract(vCityW.z / 3.75) - .5)) * .5 + smoothstep(.35, .5, abs(fract(vCityW.x / 3.75) - .5)) * .5;
    roughnessFactor *= 1. - .08 * track * m2;
  }
  if (cityHas(4)) {
    float h = vCityW.y - uStreet;
    float splash = (1. - smoothstep(0., .45 + m3 * .4 + m2 * .3, h)) * step(-.3, h) * wallw;
    float runs = smoothstep(.58, .92, cN(vec2(cp.x * 7.5, cp.y * .22))) * smoothstep(.42, .78, cN(cp * .16 + 9.1)) * wallw;
    float g = clamp(splash * .5 + runs * .32 + (m1 - .5) * .12 * wallw, 0., .62);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.56, .5, .43), g); roughnessFactor = min(1., roughnessFactor + g * .15);
  }
  cityWet = uWet > 0. && (cityHas(8) || cityHas(16)) ? uWet * cityOpen(vCityW, cn) : 0.;
  if (cityHas(8) && cityWet > 0.) {
    float wallWet = mix(.25, .8, cN(vec2(cp.x * 2.3, cp.y * .35 - uRainTime * .05)));
    float w = cityWet * (upw * .9 + (1. - upw) * wallWet * .6);
    diffuseColor.rgb *= 1. - .42 * w; roughnessFactor = mix(roughnessFactor, roughnessFactor * .3 + .06, w);
  }
  if (cityHas(16) && cityWet > 0.) {
    float pn = cN(vCityW.xz * .19 + 3.) * .65 + cN(vCityW.xz * .83 + 1.3) * .35;
    float puddle = smoothstep(uPuddle, uPuddle + .07, pn) * upw * cityWet, damp = smoothstep(uPuddle - .12, uPuddle, pn) * upw * cityWet;
    diffuseColor.rgb *= 1. - .3 * damp - .45 * puddle; roughnessFactor = mix(roughnessFactor, .025, puddle);
    // Standing water is flat (the texture's relief drowns) and rings from the drops spread across it.
    vec2 r = cityRipple(vCityW.xz, uRainTime) * puddle;
    vec3 wn = normalize(vec3(-r.x * .16, 1., -r.y * .16)), wv = normalize((viewMatrix * vec4(wn, 0.)).xyz);
    normal = normalize(mix(normal, wv, max(puddle, .2 * damp)));
    cityPuddle = puddle;
  }
}
`;
  shader.fragmentShader = pre + shader.fragmentShader
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + body)
    // The street's planar reflection: through the (rippled) surface normal, stronger in standing water and at grazing
    // angles; it replaces part of the sky reflection the IBL would put there (which a street canyon would hide).
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  if (cityHas(32) && uReflect > 0. && upwOf(vCityN) > .5) {
    vec4 rc = uReflectMatrix * vec4(vCityW, 1.);
    if (rc.w > 1e-3) {
      vec2 ruv = rc.xy / rc.w + (normal.xy - nonPerturbedNormal.xy) * .05;
      float nv = clamp(dot(normal, normalize(vViewPosition)), 0., 1.), fres = .04 + .96 * pow(1. - nv, 5.);
      float k = uReflect * mix(.35 * cityWet, 1., cityPuddle) * (1. - roughnessFactor * .8);
      vec3 refl = texture2D(uReflectMap, clamp(ruv, .001, .999)).rgb;
      bool bad = any(isnan(refl)) || any(isinf(refl));
      refl = bad ? vec3(0.) : min(refl, vec3(64.));
      if (uReflectDebug > 1.5) refl = bad ? vec3(1., 0., 1.) : vec3(clamp(ruv, 0., 1.), 0.);
      reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, refl * (fres * .88 + .12) * (1. - roughnessFactor), clamp(k, 0., 1.));
      if (uReflectDebug > .5) { reflectedLight.directDiffuse = reflectedLight.indirectDiffuse = reflectedLight.directSpecular = vec3(0.); reflectedLight.indirectSpecular = refl; }
    }
  }`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  if (cityHas(64)) {
    reflectedLight.indirectDiffuse *= uSkyShare; reflectedLight.indirectSpecular *= uSkyShare;
    reflectedLight.indirectDiffuse += uFill * uFillScale * BRDF_Lambert( material.diffuseColor );
  }`);
}

/** Give a material these layers (in addition to any it has). Safe to call again; layers apply in a fixed order. */
export function addLayers<T extends THREE.Material>(m: T, ...layers: Layer[]): T {
  const order: Layer[] = ['macro', 'road', 'grime', 'wet', 'puddles', 'reflect', 'interior'];
  const list = [...new Set([...((m.userData.layers as Layer[] | undefined) ?? []), ...layers])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  m.userData.layers = list;
  installLayers(m);
  return m;
}
/** Remove layers (an interior copy of an outdoor material keeps its age but not the weather). */
export function dropLayers<T extends THREE.Material>(m: T, ...layers: Layer[]): T {
  m.userData.layers = ((m.userData.layers as Layer[] | undefined) ?? []).filter(l => !layers.includes(l));
  installLayers(m); return m;
}
function installLayers(m: THREE.Material) {
  const list = (m.userData.layers as Layer[]) ?? [];
  if (!list.length) { m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => ''; m.needsUpdate = true; return; }
  // The bits live in this material's own uniform (kept across recompiles); the program is shared by all of them.
  const u = own.get(m)?.uLayers as { value: number } | undefined;
  if (u) u.value = maskOf(list); else layerUniforms(m, { uLayers: { value: maskOf(list) } });
  m.onBeforeCompile = shader => apply(shader, m);
  m.customProgramCacheKey = () => 'city-surface';
  m.needsUpdate = true;
}
