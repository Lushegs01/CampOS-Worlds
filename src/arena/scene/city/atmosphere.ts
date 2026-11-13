// Operation: Metropolis — sky, image-based light, aerial perspective and exposure, one coherent model per weather.
//
// Every variant is described once (ATMOSPHERE) and everything that lights the city reads from it:
//   • the sky dome: a sky-radiance model (zenith/horizon gradient, Mie glow around the sun, the sun's disc, a cloud
//     layer lit from the sun and, at night, from the city below), optionally blended with the photographic sky;
//   • the image-based light: that same sky (and a ground hemisphere) rendered into a cube map and prefiltered, so
//     what reflects in a window or a puddle and what fills a shadow is the sky the player can actually see;
//   • the sun: direction, colour and strength, and how soft its shadow is;
//   • aerial perspective: exponential height fog, integrated along each view ray (thicker in the street than over the
//     roofs), whose colour brightens toward the sun and matches the sky's horizon, so far towers sink into the haze
//     they stand in rather than into a flat colour;
//   • exposure and grade: a base exposure per variant and a slow adaptation when the player goes in or out.
// Values are linear radiance in the renderer's units (the sun's intensity is the irradiance it delivers).
import * as THREE from 'three';
import type { Library } from '../library';

type V3 = [number, number, number];
export interface Atmosphere {
  sunDir: V3; sunColor: V3; sun: number; shadowSoft: number;
  zenith: V3; horizon: V3; ground: V3; glow: V3;
  /** Photographic sky share (0 procedural only) and its tint. */
  photo: number; photoTint: V3; photoScale: number;
  /** Cloud layer: coverage 0…1, how dark the undersides are, how much the city lights them at night. */
  clouds: number; cloudDark: number; cloudLit: V3; cloudShade: V3;
  /** Height fog: colour (the haze), density at the base (per metre), falloff (per metre), the base height, the
   *  distance before it starts, the most it can hide, and the colour it takes toward the sun. */
  fog: V3; fogDensity: number; fogFalloff: number; fogBase: number; fogStart: number; fogMax: number; fogSun: V3;
  /** Base exposure, IBL strength, the hemisphere fill (bounce light the IBL does not carry). */
  exposure: number; env: number; fill: number; fillSky: V3; fillGround: V3;
  /** How brightly the city's own lights burn (0 day … 1 night); rain and wet streets. */
  glowLevel: number; rain: boolean; wet: number;
  /** Grade: saturation, contrast, warm highlight / cool shadow tint. */
  saturation: number; contrast: number; lift: V3; gain: V3;
}

const D = (s: string): V3 => { const c = new THREE.Color(s); return [c.r, c.g, c.b]; };
const MUL = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];

export const ATMOSPHERE: Record<string, Atmosphere> = {
  // Harmattan Noon: high sun through a dry, dusty haze. The sky is pale; far towers fade to warm grey.
  day: {
    sunDir: [.5543, .7418, .3775], sunColor: [1, .93, .82], sun: 3.4, shadowSoft: 1,
    zenith: [.14, .25, .44], horizon: [.62, .6, .55], ground: [.17, .155, .135], glow: [0, 0, 0],
    photo: .7, photoTint: [.92, .95, 1], photoScale: 3.2,
    clouds: 0, cloudDark: .2, cloudLit: [1, .97, .92], cloudShade: [.55, .57, .6],
    fog: [.56, .54, .5], fogDensity: .0042, fogFalloff: .045, fogBase: 5, fogStart: 14, fogMax: .9, fogSun: [.35, .3, .2],
    exposure: .74, env: 1, fill: .25, fillSky: D('#cfdcec'), fillGround: D('#8a7c62'),
    glowLevel: 0, rain: false, wet: 0,
    saturation: .93, contrast: 1.06, lift: [.995, 1, 1.01], gain: [1.02, 1, .97],
  },
  // Rainy Season: a low, heavy overcast. No hard shadows; the street is wet; rain hangs in the air as mist.
  overcast: {
    sunDir: [.38, .86, .34], sunColor: [.86, .9, .96], sun: .8, shadowSoft: 4,
    zenith: [.27, .29, .315], horizon: [.4, .42, .44], ground: [.075, .078, .082], glow: [0, 0, 0],
    photo: 0, photoTint: [1, 1, 1], photoScale: 1,
    clouds: 1, cloudDark: .55, cloudLit: [.46, .48, .52], cloudShade: [.2, .21, .235],
    fog: [.35, .37, .39], fogDensity: .0075, fogFalloff: .05, fogBase: 5, fogStart: 8, fogMax: .97, fogSun: [.02, .02, .02],
    exposure: 1.15, env: 1.15, fill: .3, fillSky: D('#c3ccd6'), fillGround: D('#5f6064'),
    glowLevel: .38, rain: true, wet: 1,
    saturation: .82, contrast: 1.08, lift: [.99, 1, 1.02], gain: [.99, 1, 1.02],
  },
  // Lagoon Sunset: a low sun over the bay, long warm light, cool shade, a bright band of haze toward the sun.
  sunset: {
    sunDir: [-.82, .27, .5], sunColor: [1, .6, .32], sun: 2.6, shadowSoft: 1.5,
    zenith: [.09, .15, .3], horizon: [.92, .52, .3], ground: [.1, .07, .055], glow: [0, 0, 0],
    photo: .45, photoTint: [1.1, .72, .55], photoScale: 2.4,
    clouds: .3, cloudDark: .3, cloudLit: [1.4, .7, .4], cloudShade: [.3, .22, .26],
    fog: [.55, .4, .32], fogDensity: .005, fogFalloff: .04, fogBase: 5, fogStart: 12, fogMax: .9, fogSun: [.9, .45, .15],
    exposure: .9, env: 1, fill: .22, fillSky: D('#e6c2b0'), fillGround: D('#6e5c58'),
    glowLevel: .55, rain: false, wet: 0,
    saturation: .98, contrast: 1.07, lift: [.98, .995, 1.03], gain: [1.04, 1, .95],
  },
  // Blue Hour: the last light in a deep blue sky, the city's sodium glow on the clouds, every window and lamp lit.
  night: {
    sunDir: [.35, .8, -.45], sunColor: [.62, .74, 1], sun: .32, shadowSoft: 2,
    zenith: [.008, .016, .045], horizon: [.05, .06, .09], ground: [.018, .016, .016], glow: [.16, .085, .04],
    photo: 0, photoTint: [1, 1, 1], photoScale: 1,
    clouds: .45, cloudDark: .5, cloudLit: [.1, .06, .035], cloudShade: [.012, .016, .03],
    fog: [.04, .047, .066], fogDensity: .005, fogFalloff: .05, fogBase: 5, fogStart: 12, fogMax: .95, fogSun: [.01, .012, .02],
    exposure: 1.5, env: 1, fill: .42, fillSky: D('#4a5c80'), fillGround: D('#3a3027'),
    glowLevel: 1, rain: false, wet: 0,
    saturation: .95, contrast: 1.08, lift: [.985, 1, 1.04], gain: [1.05, 1, .93],
  },
};
export const atmosphereOf = (variant: string) => ATMOSPHERE[variant] ?? ATMOSPHERE.day;

// ====================================================================================== aerial perspective
// Height fog is added to three.js' own fog chunks, so every built-in material (and every prop loaded from a model)
// gets it without a material of its own. Its parameters live in shared arrays that every material's uniforms point
// at (three copies uniform values by reference unless they are vectors, colours or plain arrays), so one write
// updates the whole scene. With `enable` at 0 the chunks behave exactly like three's linear fog (the campus).
export const heightFog = {
  /** density, falloff, base height, enable */ a: new Float32Array([0, 0, 0, 0]),
  /** start distance, max opacity, sun exponent, – */ b: new Float32Array([0, 1, 8, 0]),
  /** direction to the sun */ sunDir: new Float32Array([0, 1, 0]),
  /** in-scattered colour toward the sun (added to the fog colour) */ sunColor: new Float32Array([0, 0, 0]),
};
let fogPatched = false;
export function installHeightFog() {
  if (fogPatched) return; fogPatched = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorld;\n#endif\n';
  // World position from the view-space one: R and t of the view matrix give world = Rᵀ (p − t).
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorld = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );\n#endif\n';
  C.fog_pars_fragment = `#ifdef USE_FOG
	#define HFOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	uniform vec4 hfogA; uniform vec4 hfogB; uniform vec3 hfogSunDir; uniform vec3 hfogSunColor;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	vec3 heightFogApply( vec3 color ) {
		vec3 ray = vFogWorld - cameraPosition; float dist = length( ray ); vec3 rd = ray / max( dist, 1e-4 );
		float d = max( dist - hfogB.x, 0.0 ), k = clamp( hfogA.y * rd.y * d, - 60.0, 60.0 );
		// Density ρ(h) = ρ0 e^(−falloff (h − base)), integrated along the ray from the camera.
		float optical = hfogA.x * exp( - hfogA.y * ( cameraPosition.y - hfogA.z ) ) * d * ( abs( k ) > 1e-3 ? ( 1.0 - exp( - k ) ) / k : 1.0 - .5 * k );
		float f = min( 1.0 - exp( - min( optical, 60.0 ) ), hfogB.y );
		vec3 inscatter = fogColor + hfogSunColor * pow( max( dot( rd, hfogSunDir ), 0.0 ), hfogB.z );
		return mix( color, inscatter, f );
	}
#endif
`;
  // Applied before tone mapping (in linear light), on every material that has fog.
  C.tonemapping_fragment = `#if defined( USE_FOG ) && defined( HFOG )
	if ( hfogA.w > .5 ) gl_FragColor.rgb = heightFogApply( gl_FragColor.rgb );
#endif
` + C.tonemapping_fragment;
  C.fog_fragment = `#ifdef USE_FOG
	if ( hfogA.w < .5 ) {
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	}
#endif
`;
  // Every built-in shader that has fog gets the shared parameters (see above).
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, { value: unknown }> }[]) {
    if (!lib.uniforms?.fogColor) continue;
    Object.assign(lib.uniforms, { hfogA: { value: heightFog.a }, hfogB: { value: heightFog.b }, hfogSunDir: { value: heightFog.sunDir }, hfogSunColor: { value: heightFog.sunColor } });
  }
}
/** Turn height fog on for this atmosphere (or off: plain linear fog, as three.js draws it). */
export function setHeightFog(a: Atmosphere | null) {
  if (!a) { heightFog.a[3] = 0; return; }
  heightFog.a.set([a.fogDensity, a.fogFalloff, a.fogBase, 1]); heightFog.b.set([a.fogStart, a.fogMax, 7, 0]);
  const s = new THREE.Vector3(...a.sunDir).normalize(); heightFog.sunDir.set([s.x, s.y, s.z]); heightFog.sunColor.set(a.fogSun);
}
/** A ShaderMaterial of our own can use the same fog: add these to its uniforms and set `fog: true`. */
export const heightFogUniforms = () => ({ hfogA: { value: heightFog.a }, hfogB: { value: heightFog.b }, hfogSunDir: { value: heightFog.sunDir }, hfogSunColor: { value: heightFog.sunColor } });

// ====================================================================================== the sky
const SKY_FRAG = /* glsl */`
uniform sampler2D uPhoto; uniform float uPhotoMix, uPhotoScale, uCoverage, uTime, uClouds, uCloudDark, uOctaves;
uniform vec3 uPhotoTint, uZenith, uHorizon, uHaze, uGround, uGlow, uSunDir, uSun, uCloudLit, uCloudShade;
varying vec3 vDir;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 6; i++) { if (float(i) >= uOctaves) break; s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
vec3 skyRadiance(vec3 d) {
  float up = max(d.y, 0.), cs = dot(d, uSunDir);
  // Clear-sky gradient: deep at the zenith, bright and pale toward the horizon (more air along the ray).
  vec3 sky = mix(uHorizon, uZenith, pow(up, .42));
  // Mie forward scattering around the sun, broad and narrow lobes; then the disc itself (HDR: it blooms).
  float mie = pow(max(cs, 0.), 6.) * .35 + pow(max(cs, 0.), 64.) * 1.1;
  sky += uSun * mie * .16 * (1. - uClouds * .85);
  // The photographic sky (day, sunset), graded to the variant.
  if (uPhotoMix > 0.) {
    float u = atan(d.z, d.x) / 6.2831853 + .5, polar = acos(clamp(d.y, -1., 1.)) / 3.14159265;
    vec3 photo = texture2D(uPhoto, vec2(u, 1. - polar / uCoverage)).rgb * uPhotoScale * uPhotoTint;
    sky = mix(sky, photo + uSun * mie * .1, uPhotoMix * smoothstep(0., .08, d.y));
  }
  // A cloud layer: fbm on a plane overhead, self-shadowed toward the sun, lit from below by the city at night.
  if (uClouds > 0.) {
    vec2 p = d.xz / (up + .08) * 1.6 + uTime * vec2(.012, .004);
    float n = fbm(p), cover = mix(.62, .02, uClouds), dens = smoothstep(cover, cover + .35, n);
    float toward = fbm(p + uSunDir.xz * .35), lit = clamp(1. - (toward - n) * 3.5 - uCloudDark * .6, 0., 1.);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit) * (.75 + .5 * n);
    cloud += uGlow * (1. - up) * 1.4;                                        // city light on the undersides
    cloud += uSun * pow(max(cs, 0.), 12.) * (1. - dens) * .25;               // silver lining
    sky = mix(sky, cloud, dens * smoothstep(.0, .12, d.y));
  }
  // The city's glow on the haze near the horizon (night) and the haze itself, which is the fog's colour at the
  // horizon so distant buildings fade into exactly this.
  sky += uGlow * exp(-up * 9.) * .9;
  sky = mix(sky, uHaze, exp(-up * 14.) * .85);
  float sunDisc = smoothstep(.99985, .99994, cs) * (1. - uClouds);
  sky += uSun * sunDisc * 30.;
  // Below the horizon: the ground (for reflections and the image-based light), fading from the haze.
  return d.y >= 0. ? sky : mix(uHaze, uGround, smoothstep(0., -.18, d.y));
}
void main() {
  vec3 d = normalize(vDir);
  gl_FragColor = vec4(skyRadiance(d), 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The sky dome for an atmosphere (also what the image-based light is baked from). */
export function createSky(a: Atmosphere, lib: Library, octaves = 5) {
  const v = (x: V3) => new THREE.Vector3(...x);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPhoto: { value: lib.sky }, uPhotoMix: { value: a.photo }, uPhotoScale: { value: a.photoScale }, uPhotoTint: { value: v(a.photoTint) }, uCoverage: { value: lib.skyCoverage },
      uZenith: { value: v(a.zenith) }, uHorizon: { value: v(a.horizon) }, uHaze: { value: v(a.fog) }, uGround: { value: v(a.ground) }, uGlow: { value: v(a.glow) },
      uSunDir: { value: v(a.sunDir).normalize() }, uSun: { value: v(MUL(a.sunColor, a.sun)) },
      uClouds: { value: a.clouds }, uCloudDark: { value: a.cloudDark }, uCloudLit: { value: v(a.cloudLit) }, uCloudShade: { value: v(a.cloudShade) },
      uTime: { value: 0 }, uOctaves: { value: octaves },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
    fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.scale.setScalar(900); mesh.renderOrder = -1000; mesh.frustumCulled = false; mesh.name = 'sky';
  return mesh;
}

/**
 * The image-based light: the sky (and ground) rendered into a cube map once and prefiltered for every roughness.
 * Returns the PMREM texture (dispose it with the match).
 */
export function bakeEnvironment(gl: THREE.WebGLRenderer, sky: THREE.Mesh, size = 128) {
  const scene = new THREE.Scene(), dome = sky.clone(); dome.scale.setScalar(50); scene.add(dome);
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(.1, 100, target);
  const before = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
  cam.update(gl, scene);
  gl.toneMapping = before;
  const pmrem = new THREE.PMREMGenerator(gl); const rt = pmrem.fromCubemap(target.texture); pmrem.dispose();
  target.dispose();
  return rt.texture;
}

/**
 * Exposure adaptation: the eye opens up indoors and under the street and closes again outside, over about a second
 * and a half (faster closing than opening, as the eye does).
 */
export function createAdaptation(base: number) {
  let current = base;
  return (dt: number, indoor: number, underground: boolean) => {
    const target = base * (underground ? 1.35 : 1 + indoor * .45);
    const rate = target < current ? 2.2 : 1.1;
    current += (target - current) * Math.min(1, dt * rate);
    return current;
  };
}
