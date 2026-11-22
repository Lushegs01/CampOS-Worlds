// Foundry night shift: wet concrete and weathering, as shader layers on the arena's existing PBR materials.
//
// Wet ground: a multi-octave noise mask (world space, so the same puddles are always in the same place) splits the
// yard floor into damp concrete (roughness ~0.72–0.85, darkened) and standing water (roughness ~0.06–0.12, a flat
// mirror with fine animated ripples). Overhead practicals then streak across the puddles as real specular
// highlights, and on High/Ultra the planar reflection (city/reflection.ts, reused) shows the yard upside down in them.
//
// Weathering (walls, columns, cover): grime and damp wicking up from the floor, rain streaks down vertical faces and
// broad tonal variation, so large concrete and brick faces stop reading as one flat tile.
import * as THREE from 'three';
import type { FoundryLook } from './look';

/** Shared uniforms: the reflection writes the map/matrix/strength, the frame loop advances time. */
export const foundryWet = {
  uReflectMap: { value: null as THREE.Texture | null },
  uReflectMatrix: { value: new THREE.Matrix4() },
  uReflect: { value: 0 },
  uWetTime: { value: 0 },
  uPuddles: { value: .38 },
  uDamp: { value: new THREE.Vector2(.72, .85) },
  uPuddleRough: { value: new THREE.Vector2(.06, .12) },
  /** Strength of the baked practical pools on the floor. */
  uGlowK: { value: 6 },
};
/** `realLights`: the profile has a pool of real practical lights near the player, so the baked pools are lighter. */
export function configureWet(look: FoundryLook, realLights = 0) {
  foundryWet.uGlowK.value = realLights ? 3.5 : 6;
  foundryWet.uPuddles.value = look.puddles; foundryWet.uDamp.value.set(...look.dampRough); foundryWet.uPuddleRough.value.set(...look.puddleRough);
}

export const NOISE_GLSL = /* glsl */`
float fwH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fwN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(fwH(i), fwH(i + vec2(1., 0.)), f.x), mix(fwH(i + vec2(0., 1.)), fwH(i + vec2(1., 1.)), f.x), f.y); }
float fwFbm(vec2 p) { float a = 0., k = .5; for (int i = 0; i < 4; i++) { a += k * fwN(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; k *= .5; } return a / .9375; }
`;

/** GLSL for the ground: declarations (prepended) and the bodies spliced into the ground's own chunk replacements. */
export const WET_GROUND = {
  pars: NOISE_GLSL + /* glsl */`
uniform sampler2D uReflectMap; uniform mat4 uReflectMatrix; uniform float uReflect, uWetTime, uPuddles, uGlowK; uniform vec2 uDamp, uPuddleRough;
/** Rain-drop ripples: expanding rings in a jittered grid (two layers), as a tangent-space slope. */
vec2 fwRipple(vec2 p, float t) {
  vec2 acc = vec2(0.);
  for (int l = 0; l < 2; l++) {
    vec2 q = p * (l == 0 ? 5.5 : 8.3) + float(l) * 7.3, c = floor(q), f = fract(q) - .5;
    float r = fwH(c + float(l)), phase = fract(t * (.55 + r * .5) + r);
    vec2 o = f - (vec2(fwH(c + 3.1), fwH(c + 5.7)) - .5) * .5;
    // A thin ring (a couple of wavelengths) that weakens as it spreads; some cells stay calm.
    float d = length(o), x = d - phase * .4, ring = sin(x * 90.) * exp(-x * x * 900.) * (1. - phase) * (1. - phase) * step(.35, r);
    acc += o / max(d, 1e-3) * ring;
  }
  return acc;
}
`,
  /** After the albedo is known (map_fragment): the masks, and darkening by water. Needs `wuv` and the splat weights. */
  mask: /* glsl */`
float fwBig = fwFbm(wuv * .085), fwMid = fwFbm(wuv * .31 + 11.), fwFine = fwFbm(wuv * 1.7 + 4.);
// (fbm clusters about 0.5: stretch it so the coverage threshold below means what it says.)
float fwField = clamp((fwBig * .62 + fwMid * .3 + fwFine * .08 - .5) * 2.6 + .5, 0., 1.);
// Water collects in road ruts and in the yard's low spots; much less on gravel and under the sheds.
vec4 fwShel = texture2D(tShelter, (vGround.xz - uShOrigin) / uShSize); float fwShelter = fwShel.a;
float fwBias = (wR * .08 - wG * .25 - wD * .05) - fwShelter * .1;
float fwPuddle = smoothstep(1. - uPuddles - .03, 1. - uPuddles + .05, fwField + fwBias);
float fwDampEdge = smoothstep(1. - uPuddles - .16, 1. - uPuddles, fwField + fwBias);
// Wet albedo: porous concrete darkens and saturates a little; under standing water darker still.
diffuseColor.rgb *= mix(.62, 1., fwFine * .3) * mix(1., .78, fwDampEdge);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.48, .5, .5), fwPuddle);`,
  rough: /* glsl */`
roughnessFactor = mix(uDamp.x, uDamp.y, clamp(roughnessFactor * .7 + fwMid * .5, 0., 1.)) * mix(1., .85, fwDampEdge);
roughnessFactor = mix(roughnessFactor, mix(uPuddleRough.x, uPuddleRough.y, fwFine), fwPuddle);`,
  /** Tangent-space `tn` is the blended surface normal; standing water flattens it and adds ripples. */
  normal: /* glsl */`
vec2 fwR = fwRipple(wuv, uWetTime) * .06 + (vec2(fwN(wuv * 9. + uWetTime * .3), fwN(wuv * 9. - uWetTime * .27 + 9.)) - .5) * .02;
tn = normalize(mix(tn, vec3(fwR, 1.), fwPuddle * .97));`,
  /** In the lighting (after aomap_fragment): the planar reflection where it is drawn, by Fresnel and wetness. */
  reflect: /* glsl */`
if (uReflect > 0.) {
  vec4 fwRc = uReflectMatrix * vec4(vGround, 1.);
  if (fwRc.w > 0.) {
    vec2 fwUv = fwRc.xy / fwRc.w + (normal.xy - nonPerturbedNormal.xy) * .06;
    float fwNv = clamp(dot(normal, normalize(vViewPosition)), 0., 1.), fwFres = .02 + .98 * pow(1. - fwNv, 5.);
    float fwK = uReflect * mix(.22 * fwDampEdge, 1., fwPuddle) * (1. - roughnessFactor * .85);
    vec3 fwRefl = texture2D(uReflectMap, clamp(fwUv, .001, .999)).rgb;
    fwRefl = any(isnan(fwRefl)) || any(isinf(fwRefl)) ? vec3(0.) : min(fwRefl, vec3(48.));
    reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, fwRefl * (fwFres * .9 + .1), clamp(fwK, 0., 1.));
  }
}
// Practical light pools (baked per fixture; see shelterTexture): diffuse on the concrete, a glossy sheen where it is wet.
{
  vec3 fwGlow = fwShel.rgb * fwShel.rgb * uGlowK;
  reflectedLight.indirectDiffuse += fwGlow * BRDF_Lambert(diffuseColor.rgb);
  float fwNv2 = clamp(dot(normal, normalize(vViewPosition)), 0., 1.);
  reflectedLight.indirectSpecular += fwGlow * mix(.03 * fwDampEdge, .2, fwPuddle) * (.2 + .8 * pow(1. - fwNv2, 3.));
}`,
};

/** Shared uniforms of the weathering layer. */
const weatherUniforms = { uWeatherGrime: { value: 1 } };
/**
 * Grime, damp and streaks on walls, columns and cover (world space). Patches the material in place; safe to call
 * again. `strength` scales the effect (brick and concrete 1, painted steel less).
 */
export function weather<T extends THREE.MeshStandardMaterial>(m: T, strength = 1): T {
  if (m.userData.foundryWeather) return m;
  m.userData.foundryWeather = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    Object.assign(shader.uniforms, weatherUniforms, { uWeatherK: { value: strength } });
    shader.vertexShader = 'varying vec3 vFwPos; varying vec3 vFwNrm;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 fwp = vec4(transformed, 1.); vec3 fwn = objectNormal;
  #ifdef USE_INSTANCING
    fwp = instanceMatrix * fwp; fwn = mat3(instanceMatrix) * fwn;
  #endif
    vFwPos = (modelMatrix * fwp).xyz; vFwNrm = normalize(mat3(modelMatrix) * fwn); }`);
    shader.fragmentShader = 'varying vec3 vFwPos; varying vec3 vFwNrm; uniform float uWeatherGrime, uWeatherK;\n' + NOISE_GLSL + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{
  vec3 fn = normalize(vFwNrm); float vert = 1. - abs(fn.y);
  // Horizontal coordinate along the face (for streaks) and the height above the yard floor.
  float along = dot(vFwPos.xz, normalize(vec2(-fn.z, fn.x) + 1e-4)), hgt = vFwPos.y;
  float tone = fwFbm(vec2(along, hgt) * .22 + vFwPos.xz * .05);
  float streak = smoothstep(.45, .85, fwN(vec2(along * 2.6, hgt * .12))) * smoothstep(-.5, 2.5, hgt) * vert;
  float base = 1. - smoothstep(0., .55 + fwFbm(vec2(along * .9, 3.)) * .9, hgt);
  float k = uWeatherGrime * uWeatherK;
  diffuseColor.rgb *= 1. + (tone - .5) * .22 * k;
  diffuseColor.rgb *= 1. - k * (streak * .28 + base * .38);
  // Damp wicks up from the wet floor: darker and smoother at the foot of walls and cover.
  roughnessFactor = clamp(roughnessFactor * (1. - k * (base * .38 + streak * .12)) * (1. + (tone - .5) * .2 * k), .05, 1.);
}`);
  };
  // (The default key is the onBeforeCompile source, now this wrapper's for every weathered material: add the original.)
  const prevKey = prev ? prev.toString() : '';
  m.customProgramCacheKey = () => 'fw-weather|' + prevKey;
  m.needsUpdate = true;
  return m;
}
