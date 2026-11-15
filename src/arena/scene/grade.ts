// A restrained film grade for the arena's post stack, applied after tone mapping (display-referred):
// saturation (luma-preserving), contrast as an S-curve about mid-grey (black and white stay put), a lift on the shadows and a gain on the highlights tinted
// per lighting variant (cool shade, warm light), and a very fine animated grain so smooth gradients (fog, sky,
// wet asphalt) do not band. Nothing here sharpens, distorts or separates colour channels.
import * as THREE from 'three';
import { Effect, BlendFunction, EffectAttribute } from 'postprocessing';

const FRAG = /* glsl */`
uniform float saturation, contrast, grain, time; uniform vec3 lift, gain;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0., 1.);
  float l = dot(c, vec3(.2126, .7152, .0722));
  // Lift the shadows and tint them, tint the highlights (weighted by luminance), keep mid-grey where it is.
  c = mix(c * lift, c * gain, smoothstep(.05, .85, l));
  c = mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, saturation);
  // Contrast as a power curve about mid-grey: black stays black and the shade keeps its detail (a straight line
  // about mid-grey sent everything below ~0.1 to black: at 1.1, 0.05 became 0.005).
  vec3 lo = .5 * pow(c * 2., vec3(contrast)), hi = 1. - .5 * pow(max(2. - c * 2., 0.), vec3(contrast));
  c = mix(lo, hi, step(.5, c));
  float n = fract(sin(dot(uv * 1024. + time, vec2(12.9898, 78.233))) * 43758.5453) - .5;
  c += n * grain * (1. - l * .6);
  outputColor = vec4(clamp(c, 0., 1.), inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor(o: { saturation?: number; contrast?: number; lift?: [number, number, number]; gain?: [number, number, number]; grain?: number } = {}) {
    super('GradeEffect', FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['saturation', new THREE.Uniform(o.saturation ?? 1)], ['contrast', new THREE.Uniform(o.contrast ?? 1)], ['grain', new THREE.Uniform(o.grain ?? .012)], ['time', new THREE.Uniform(0)],
        ['lift', new THREE.Uniform(new THREE.Vector3(...(o.lift ?? [1, 1, 1])))], ['gain', new THREE.Uniform(new THREE.Vector3(...(o.gain ?? [1, 1, 1])))],
      ]),
    });
  }
  update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt?: number) { (this.uniforms.get('time')!.value as number) += (dt ?? .016) * 60; if ((this.uniforms.get('time')!.value as number) > 1000) this.uniforms.get('time')!.value = 0; }
}

// Contrast-adaptive sharpening, after antialiasing (the cinematic finish on Operation: Metropolis): each pixel is pushed
// away from the average of its four neighbours, less where the local contrast is already high, so fine texture
// (brick, fabric, print on signs) reads crisply without haloes around edges that are already sharp.
const SHARPEN = /* glsl */`
uniform float amount;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec3 n = texture2D(inputBuffer, uv + vec2(0., texelSize.y)).rgb, s = texture2D(inputBuffer, uv - vec2(0., texelSize.y)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.)).rgb, w = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(mn, 1. - mx) / max(mx, vec3(1e-4)), 0., 1.));
  vec3 lobe = -amp * mix(.08, .2, amount);
  outputColor = vec4(clamp((c + (n + s + e + w) * lobe) / (1. + 4. * lobe), 0., 1.), inputColor.a);
}`;
export class SharpenEffect extends Effect {
  constructor(amount = .5) {
    super('SharpenEffect', SHARPEN, { blendFunction: BlendFunction.SRC, attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([['amount', new THREE.Uniform(amount)]]) });
  }
}
