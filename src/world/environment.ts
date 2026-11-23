// The open world's environment controller (campus and Metropolitan City). One mutable state, advanced once a frame
// by <Lighting> from the shared deterministic schedule (shared/environment.mjs) and the player's time/weather
// settings, and read by the sky, the lights, the post stack, the rain and the material layer below.
//
// Presentation only: nothing here feeds movement, collision, missions or the network.
import * as THREE from 'three';
import { nightAmount, resolveEnvironment, sunDirection, WEATHER } from '../../shared/environment.mjs';

type Params = typeof WEATHER.clear;
const v3 = (r: number, g: number, b: number) => new THREE.Vector3(r, g, b);
const lerp3 = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number) => out.copy(a).lerp(b, t);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Sky radiance anchors (linear, scene-referred; the photographic sky this replaces peaked around 1–3 for blue sky
// and ~4 for sunlit cloud). Interpolated by the sun's elevation, then flattened toward grey by overcast.
const SKY = {
  dayZenith: v3(.26, .55, 1.45), dayHorizon: v3(1.0, 1.12, 1.32),
  goldZenith: v3(.24, .33, .7), goldHorizon: v3(1.75, 1.0, .52),
  duskZenith: v3(.045, .055, .13), duskHorizon: v3(.34, .19, .14),
  nightZenith: v3(.0035, .005, .012), nightHorizon: v3(.014, .017, .03),
};

export const env = {
  hour: 17.35, weather: 'clear' as string, from: 'clear', to: 'clear', blend: 1,
  params: { ...WEATHER.clear } as Params,
  /** Sun and moon (unit vectors towards them), and the one shadow-casting light's direction (whichever is up). */
  sun: v3(.55, .74, .38), moon: v3(-.4, .6, -.3), key: v3(.55, .74, .38),
  elevation: .3, night: 0, /** 0..1: street, window and vehicle lamps on. */ lights: 0,
  keyColor: new THREE.Color(1, .93, .82), keyIntensity: 4.2,
  hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0,
  zenith: v3(0, 0, 0), horizon: v3(0, 0, 0), ground: v3(0, 0, 0), sunGlow: v3(0, 0, 0), sunDisc: v3(0, 0, 0),
  cloudLit: v3(1, 1, 1), cloudShade: v3(.5, .5, .5), overcastColor: v3(.7, .72, .75),
  fogColor: new THREE.Color(), fogNear: 140, fogFar: 950,
  exposure: 1, envIntensity: .92, bloom: .12,
  /** Surface wetness and puddles lag the rain: streets take a minute to soak and several to dry. */
  wet: 0, puddles: 0, rain: 0, wind: .25, lightning: 0,
  /** 0 outdoors, 1 under a roof (set by the rain renderer): indoors, surfaces read dry and no rain falls. */
  shelter: 0,
  /** Bumped whenever the sky changes enough that the reflection probe should be regenerated. */
  revision: 0,
};
export type Environment = typeof env;

/** Uniforms shared by every material that carries the environment layer (one object: updates reach them all). */
export const envUniforms = {
  uEnvWet: { value: 0 }, uEnvPuddles: { value: 0 }, uEnvLights: { value: 0 }, uEnvTime: { value: 0 }, uEnvRain: { value: 0 },
};

let lastKey = '', initialised = false, flashUntil = 0, nextFlash = 0;
const lastProbe = { sun: new THREE.Vector3(), cloud: -1, overcast: -1, night: -1, fog: -1 };
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

/**
 * Advances the environment to real time `ms` (UTC) with the player's settings. `dt` is the real frame time, used
 * only for the lag of wetness behind the rain and for lightning flashes.
 */
export function updateEnvironment(ms: number, dt: number, time: string, weather: string, reduced: boolean) {
  const r = resolveEnvironment(ms, time, weather), p = r.params as Params;
  Object.assign(env, { hour: r.hour, weather: r.weather, from: r.from, to: r.to, blend: r.blend });
  env.params = p;
  const s = sunDirection(r.hour);
  env.sun.set(s.x, s.y, s.z); env.elevation = s.elevation;
  // The moon: roughly opposite the sun, held a little higher so night shadows have a direction.
  env.moon.set(-s.x * .8, Math.max(.35, -s.y), -s.z * .8 + .25).normalize();
  const deg = s.elevation * 180 / Math.PI, night = nightAmount(s.elevation);
  env.night = night;
  const overcast = p.overcast, day = smooth(-4, 10, deg), gold = (1 - smooth(3, 24, deg)) * smooth(-6, 1, deg);

  // ---- sky
  lerp3(env.zenith, SKY.nightZenith, SKY.duskZenith, smooth(-14, -3, deg));
  lerp3(tmp, env.zenith, SKY.dayZenith, day); lerp3(env.zenith, tmp, SKY.goldZenith, gold * .6);
  lerp3(env.horizon, SKY.nightHorizon, SKY.duskHorizon, smooth(-14, -3, deg));
  lerp3(tmp, env.horizon, SKY.dayHorizon, day); lerp3(env.horizon, tmp, SKY.goldHorizon, gold * .4);
  // Overcast: a flat grey dome whose brightness follows the daylight beneath it.
  const grey = .1 + .75 * day + .02 * (1 - night);
  env.overcastColor.set(.62, .66, .7).multiplyScalar(grey * (1 - .45 * p.rain) + (1 - day) * .01);
  env.zenith.lerp(tmp.copy(env.overcastColor).multiplyScalar(.82), overcast * .92);
  env.horizon.lerp(env.overcastColor, overcast * .92);
  env.ground.copy(env.horizon).multiplyScalar(.38);
  // Sunlight colour: white-warm by day, amber at golden hour, red at the horizon.
  const warm = 1 - smooth(2, 30, deg);
  env.keyColor.setRGB(1, .93 - .36 * warm, .84 - .58 * warm);
  env.sunGlow.set(env.keyColor.r, env.keyColor.g, env.keyColor.b).multiplyScalar(1.6 * smooth(-5, 2, deg) * (1 - .9 * overcast));
  env.sunDisc.set(env.keyColor.r, env.keyColor.g, env.keyColor.b).multiplyScalar(60 * smooth(-1.5, 1.5, deg) * (1 - overcast * .97));
  env.cloudLit.set(env.keyColor.r, env.keyColor.g, env.keyColor.b).multiplyScalar(3.4 * day * (1 - .6 * overcast)).add(tmp.copy(env.horizon).multiplyScalar(.6));
  env.cloudShade.copy(env.horizon).multiplyScalar(.55 + .2 * (1 - overcast)).add(tmp2.copy(env.zenith).multiplyScalar(.25));
  // City glow under the clouds at night (sodium and LED light scattered back down).
  if (night > 0) { const glow = tmp.set(.05, .03, .016).multiplyScalar(night * (.4 + .6 * p.cloud)); env.cloudShade.add(glow); env.horizon.add(tmp.multiplyScalar(.7)); }

  // ---- key light (sun or moon), hemisphere fill
  const sunUp = deg > -2.5;
  env.key.copy(sunUp ? env.sun : env.moon);
  if (sunUp) {
    env.keyIntensity = 4.2 * smooth(-2.5, 9, deg) * (1 - .82 * overcast) * (1 - .25 * p.fog);
  } else {
    env.keyColor.setRGB(.55, .66, 1);
    env.keyIntensity = .22 * smooth(-2.5, -9, deg) * (1 - .8 * overcast);
  }
  // Ambient from the sky probe is close to black at night: a dim cool sky and warm city bounce keep the shade
  // readable (players still need to see where they walk). In overcast daylight the fill replaces the lost sun.
  env.hemiSky.setRGB(.11, .13, .2).multiplyScalar(night).add(new THREE.Color(.55, .58, .62).multiplyScalar(overcast * day * .9));
  env.hemiGround.setRGB(.12, .085, .055).multiplyScalar(night).add(new THREE.Color(.3, .28, .25).multiplyScalar(overcast * day * .6));
  env.hemiIntensity = .3 * night + .45 * overcast * day;

  // ---- fog: aerial haze by day, a mist that swallows the skyline in fog and rain
  const fogAmount = Math.min(1, p.fog + .25 * p.rain);
  env.fogNear = 140 * (1 - .93 * fogAmount); env.fogFar = 950 * (1 - .8 * fogAmount);
  env.fogColor.setRGB(env.horizon.x, env.horizon.y, env.horizon.z).multiplyScalar(.42 + .38 * overcast + .15 * p.fog);

  // ---- lamps, exposure, bloom
  env.lights = Math.max(smooth(.08, .55, night), smooth(.5, .95, overcast) * (p.rain + p.fog) * .5 * (1 - smooth(25, 45, deg)));
  env.exposure = (1 + .85 * night) * (1 + .22 * overcast * day) * (1 + .1 * gold);
  env.bloom = .1 + .32 * night + .06 * p.rain;

  // ---- wetness lags the rain (instant when a fixed preset is chosen or on first frame)
  const wetTarget = p.wet, puddleTarget = p.puddles;
  if (!initialised || weather !== 'live') { env.wet = wetTarget; env.puddles = puddleTarget; initialised = true; }
  else {
    const k = (cur: number, target: number) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? 40 : 160)));
    env.wet = k(env.wet, wetTarget); env.puddles = k(env.puddles, puddleTarget);
  }
  env.rain = p.rain; env.wind = p.wind;

  // ---- lightning: brief double flashes at the storm's rate (none under reduced motion)
  const t = ms / 1000;
  if (p.lightning > 0 && !reduced) {
    if (nextFlash === 0 || nextFlash > t + 600) nextFlash = t + 4 + Math.random() * 60 / p.lightning;
    if (t >= nextFlash) { flashUntil = t + .22; nextFlash = t + 3 + Math.random() * 120 / p.lightning; }
    const k = t < flashUntil ? (Math.sin((flashUntil - t) * 60) > -.2 ? 1 : .25) : 0;
    env.lightning = k * (.5 + .5 * night);
  } else env.lightning = 0;

  // ---- shared material uniforms
  envUniforms.uEnvWet.value = env.wet * (1 - env.shelter); envUniforms.uEnvPuddles.value = env.puddles * (1 - env.shelter); envUniforms.uEnvLights.value = env.lights;
  envUniforms.uEnvRain.value = env.rain; envUniforms.uEnvTime.value = t % 3600;

  // ---- reflection probe: regenerate after a perceptible change only
  const key = `${r.weather}`;
  if (key !== lastKey || lastProbe.sun.angleTo(env.sun) > .02 || Math.abs(lastProbe.cloud - p.cloud) > .04 || Math.abs(lastProbe.overcast - overcast) > .04 || Math.abs(lastProbe.night - night) > .03 || Math.abs(lastProbe.fog - p.fog) > .05) {
    lastKey = key; lastProbe.sun.copy(env.sun); lastProbe.cloud = p.cloud; lastProbe.overcast = overcast; lastProbe.night = night; lastProbe.fog = p.fog;
    env.revision++;
  }
  return env;
}

// ------------------------------------------------------------------------------------------------- material layer
// Appended to existing materials (it chains any onBeforeCompile already set, e.g. the weathering layer), so walls,
// streets, vehicles and glass respond to rain and night without new materials or extra draw calls. All the work is
// behind uniforms: a dry, daylit frame costs a few multiplies per pixel.

const ENV_NOISE = /* glsl */`
float eHash(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}
float eNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(eHash(i),eHash(i+vec2(1,0)),f.x),mix(eHash(i+vec2(0,1)),eHash(i+vec2(1,1)),f.x),f.y);}
`;
const ENV_VERTEX = /* glsl */`#include <worldpos_vertex>
{
  vec4 eW = vec4(transformed, 1.);
  #ifdef USE_BATCHING
    eW = batchingMatrix * eW;
  #endif
  #ifdef USE_INSTANCING
    eW = instanceMatrix * eW;
  #endif
  vEnvWorld = (modelMatrix * eW).xyz;
}`;

export interface EnvLayer {
  /** How much the surface darkens and smooths when wet: 1 asphalt/soil/stucco, ~.5 stone, ~.2 paint/metal. */
  porosity?: number;
  /** Standing water collects on flat, upward-facing parts. */
  puddles?: boolean;
  /** Glazing: 'office' (per-room blinds, tints and lit rooms at night on a facade grid) or 'shop' (lit at night). */
  windows?: 'office' | 'shop';
  /** Asphalt wear: patch repairs with sealed seams, crack networks, oil stains and polished tracks. */
  road?: boolean;
}

export function environmentLayer<T extends THREE.Material>(material: T, o: EnvLayer = {}): T {
  if (material.userData.envLayer) return material;
  material.userData.envLayer = o;
  // The previous cache key is taken now: three's default key is the onBeforeCompile source, which the wrapper below
  // would make identical for every material and so let unrelated shaders share a program.
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  const porosity = (o.porosity ?? .5).toFixed(3);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, envUniforms);
    shader.vertexShader = 'varying vec3 vEnvWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', ENV_VERTEX);
    shader.fragmentShader = `varying vec3 vEnvWorld; uniform float uEnvWet, uEnvPuddles, uEnvLights, uEnvTime, uEnvRain;\n${ENV_NOISE}` + shader.fragmentShader.replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        vec3 eN = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
        float eUp = smoothstep(.6, .95, eN.y);
        ${o.windows ? '' : `
        if (uEnvWet > .001) {
          // Vertical faces wet in uneven runs; upward faces evenly.
          float eRun = mix(.55 + .45 * eNoise(vec2(dot(vEnvWorld.xz, vec2(.7, .7)) * 1.7, vEnvWorld.y * .25)), 1., eUp);
          float eW = uEnvWet * eRun * ${porosity};
          diffuseColor.rgb *= 1. - .5 * eW;
          roughnessFactor = mix(roughnessFactor, mix(.32, .1, eUp), clamp(uEnvWet * eRun, 0., 1.) * .85);
          ${o.puddles ? `
          float eP = eNoise(vEnvWorld.xz * .16) * .62 + eNoise(vEnvWorld.xz * .63 + 7.) * .38;
          float ePud = smoothstep(.69 - .3 * uEnvPuddles, .74 - .3 * uEnvPuddles, 1. - eP) * eUp * step(.001, uEnvPuddles);
          diffuseColor.rgb *= 1. - .55 * ePud;
          roughnessFactor = mix(roughnessFactor, .03, ePud);
          metalnessFactor = mix(metalnessFactor, 0., ePud);
          // Rain rings on standing water: two layers of expanding ripples perturb the normal.
          if (uEnvRain > .01 && ePud > .05) {
            vec2 eQ = vEnvWorld.xz * 2.2;
            vec2 eC = floor(eQ), eF = fract(eQ) - .5;
            float eT = fract(uEnvTime * .9 + eHash(eC) * 7.), eD = length(eF - (vec2(eHash(eC + 3.), eHash(eC + 9.)) - .5) * .5);
            float eRing = sin((eD - eT * .45) * 40.) * (1. - eT) * smoothstep(.45, .0, eD) * step(eD, eT * .45 + .05);
            normal = normalize(normal + (viewMatrix * vec4(eF.x * eRing, 0., eF.y * eRing, 0.)).xyz * .6 * uEnvRain * ePud);
          }` : ''}
        }`}
        ${o.windows === 'office' ? `
        // Facade grid: bays ~2.6 m along the face, storeys ~3.5 m. Each room gets its own blinds (lowered to a
        // random height, in one of a few fabric tones), a slightly different glass smoothness, and at night a
        // seeded chance of being lit, warm or cool. Without this every window was the same dark mirror.
        float eAlong = abs(eN.x) > .5 ? vEnvWorld.z : vEnvWorld.x;
        vec2 eCell = floor(vec2(eAlong / 2.6, vEnvWorld.y / 3.5));
        float eH = eHash(eCell + floor(vec2(abs(eN.x) > .5 ? vEnvWorld.x : vEnvWorld.z) / 9.) * 17.);
        vec2 eIn = fract(vec2(eAlong / 2.6, vEnvWorld.y / 3.5));
        {
          float eB = eHash(eCell * 3.1 + 5.), eDrop = eB < .45 ? 0. : (eB - .45) * 1.5;
          float eBlind = step(1. - eDrop, eIn.y) * step(.5, eHash(eCell + 11.) + .2);
          vec3 eFabric = mix(vec3(.42, .38, .31), vec3(.62, .6, .55), eHash(eCell + 2.));
          diffuseColor.rgb = mix(diffuseColor.rgb, eFabric * (.9 + .2 * step(.5, fract(eIn.y * 40.))), eBlind * .85);
          roughnessFactor = mix(roughnessFactor + eHash(eCell + 7.) * .08, .75, eBlind);
          // Daytime depth: an unlit interior reads darker toward the floor of each storey.
          diffuseColor.rgb *= mix(1., .7 + .3 * eIn.y, 1. - eBlind);
        }
        if (uEnvLights > .001) {
          float eLit = step(.52, eH);
          vec3 eCol = mix(vec3(1., .72, .42), vec3(.78, .86, 1.), step(.82, eH));
          float eFall = .55 + .45 * smoothstep(0., .5, eIn.y) * (1. - .5 * abs(eIn.x - .5));
          totalEmissiveRadiance += eCol * eLit * eFall * uEnvLights * (.45 + .8 * eHash(eCell * 1.7));
        }` : ''}
        ${o.road ? `
        {
          // Repairs: rectangular patches on a 7 x 4 m grid, darker, smoother and sealed at the edges.
          vec2 eG = vEnvWorld.xz / vec2(7., 4.), eGc = floor(eG), eGf = fract(eG);
          float ePatch = step(.82, eHash(eGc + 31.)) * step(.08, eGf.x) * step(eGf.x, .92) * step(.12, eGf.y) * step(eGf.y, .88);
          float eSeam = ePatch * (1. - step(.1, eGf.x) * step(eGf.x, .9) * step(.14, eGf.y) * step(eGf.y, .86));
          diffuseColor.rgb *= 1. - .2 * ePatch - .25 * eSeam;
          roughnessFactor = mix(roughnessFactor, .35, eSeam); // tar sealant: dark and a little glossy
          roughnessFactor = mix(roughnessFactor, roughnessFactor * .8, ePatch);
          // Cracks: a ridged noise network, only in worn zones.
          float eWorn = smoothstep(.55, .75, eNoise(vEnvWorld.xz * .07 + 3.));
          float eK = abs(eNoise(vEnvWorld.xz * .9) - .5) + abs(eNoise(vEnvWorld.xz * 2.3 + 9.) - .5) * .5;
          float eCrack = (1. - smoothstep(.0, .025, eK)) * eWorn * (1. - ePatch);
          diffuseColor.rgb *= 1. - .55 * eCrack;
          // Oil drips and tyre polish: soft dark blotches, slightly glossier.
          float eOil = smoothstep(.72, .9, eNoise(vEnvWorld.xz * .45 + 17.)) * smoothstep(.4, .7, eNoise(vEnvWorld.xz * .05));
          diffuseColor.rgb *= 1. - .3 * eOil;
          roughnessFactor = mix(roughnessFactor, roughnessFactor * .7, eOil);
          // Large-scale tone so long straight roads do not read as one repeated texture.
          diffuseColor.rgb *= .9 + .2 * eNoise(vEnvWorld.xz * .015);
        }` : ''}
        ${o.windows === 'shop' ? `totalEmissiveRadiance += vec3(1., .8, .55) * uEnvLights * .3;` : ''}
      }`);
  };
  material.customProgramCacheKey = () => `${previousKey}|env:${porosity}:${o.puddles ? 1 : 0}:${o.windows ?? ''}:${o.road ? 1 : 0}`;
  material.needsUpdate = true;
  return material;
}

// -------------------------------------------------------------------------------------------------- lamp materials
/** Emissive lamp materials whose brightness follows `env.lights` (street lamp lenses, tower beacons, ad panels). */
const lamps: { m: THREE.MeshStandardMaterial; day: number; night: number }[] = [];
export function registerLamp(m: THREE.MeshStandardMaterial, day: number, night: number) {
  if (!lamps.some(l => l.m === m)) lamps.push({ m, day, night });
  return () => { const i = lamps.findIndex(l => l.m === m); if (i >= 0) lamps.splice(i, 1); };
}
export function updateLamps() { for (const l of lamps) l.m.emissiveIntensity = l.day + (l.night - l.day) * env.lights; }
