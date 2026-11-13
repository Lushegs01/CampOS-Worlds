// A restrained film grade for the arena's post stack, applied after tone mapping (display-referred):
// saturation (luma-preserving), contrast about mid-grey, a lift on the shadows and a gain on the highlights tinted
// per lighting variant (cool shade, warm light), and a very fine animated grain so smooth gradients (fog, sky,
// wet asphalt) do not band. Nothing here sharpens, distorts or separates colour channels.
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

const FRAG = /* glsl */`
uniform float saturation, contrast, grain, time; uniform vec3 lift, gain;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0., 1.);
  float l = dot(c, vec3(.2126, .7152, .0722));
  // Lift the shadows and tint them, tint the highlights (weighted by luminance), keep mid-grey where it is.
  c = mix(c * lift, c * gain, smoothstep(.05, .85, l));
  c = mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, saturation);
  c = (c - .5) * contrast + .5;
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
