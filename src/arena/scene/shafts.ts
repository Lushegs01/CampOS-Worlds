// Light shafts (crepuscular rays) and glare around a low sun, for the post stack (Medium and up).
//
// The sky itself is the light source: right after the world is drawn, the pixels where nothing stands in front of
// the sky (depth at the far plane) are taken with their own brightness, so a bright break in the cloud streams light
// and a dark storm deck does not. That mask (a quarter of the screen's resolution) is blurred radially toward the
// sun's position on screen, and the result is added to the image before tone mapping, so cranes, towers and the
// spire throw visible beams of shadow through the haze in front of the sun.
//
// Why not postprocessing's GodRaysEffect: it reads the composer's depth when the effect pass runs, and by then the
// first-person weapon pass has replaced that depth with the weapon's own (the weapon is drawn over a cleared depth
// buffer). This pass runs straight after the world, while the depth is the world's, and never touches the frame
// buffers itself (no feedback with the depth texture it reads).
import * as THREE from 'three';
import { Pass, Effect, BlendFunction, EffectAttribute } from 'postprocessing';

const VERT = 'varying vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 1., 1.); }';

// Sky only, by its brightness above a floor, fading with distance from the sun on screen (a lens-shaped falloff
// so the shafts stay around the sun and the open sky elsewhere does not wash the frame).
const MASK = /* glsl */`
uniform sampler2D tColor, tDepth; uniform vec2 uSun, uTexel; uniform float uAspect, uFloor;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.); float sky = 0.;
  // Four taps per quarter-resolution texel: the mask stays stable as thin cables and lattice cross it.
  for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i - (i / 2) * 2), float(i / 2)) - .5) * uTexel * 1.5;
    float s = step(.999999, texture2D(tDepth, vUv + o).r);
    c += min(texture2D(tColor, vUv + o).rgb, vec3(8.)) * s; sky += s;
  }
  c *= .25; sky *= .25;
  float l = dot(c, vec3(.2126, .7152, .0722));
  vec2 dv = (vUv - uSun) * vec2(uAspect, 1.);
  float fall = exp(-dot(dv, dv) * 4.);
  gl_FragColor = vec4(c * (max(l - uFloor, 0.) / max(l, 1e-4)) * fall, 1.);
}`;

// GPU Gems 3, ch. 13: march toward the sun, each step a little weaker; jittered per pixel (interleaved gradient
// noise) so the fixed number of steps does not show as bands.
const BLUR = /* glsl */`
uniform sampler2D tMask; uniform vec2 uSun; uniform float uDensity, uDecay, uWeight;
varying vec2 vUv;
#define STEPS 40
void main() {
  vec2 delta = (vUv - uSun) * uDensity / float(STEPS);
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
  vec2 uv = vUv - delta * j; float k = 1.; vec3 acc = vec3(0.);
  for (int i = 0; i < STEPS; i++) {
    uv -= delta;
    float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
    acc += texture2D(tMask, uv).rgb * k * inside; k *= uDecay;
  }
  gl_FragColor = vec4(acc * uWeight, 1.);
}`;

const v = new THREE.Vector3(), fwd = new THREE.Vector3();
/** One triangle covering the screen (clip space). */
const triangle = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

/**
 * Adds the shafts to the image (HDR, before tone mapping). Put it in the effect pass ahead of the tone mapping. By then
 * the composer's depth is the first-person weapon's own (its pass draws over a cleared depth buffer), so where that
 * depth is nearer than the far plane the weapon is in front and the shafts are kept off it.
 */
export class ShaftsEffect extends Effect {
  constructor(texture: THREE.Texture) {
    super('ShaftsEffect', /* glsl */`
      uniform sampler2D tShafts; uniform float uStrength, uGun;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        float gun = uGun * (1. - step(.99999, depth));
        outputColor = vec4(inputColor.rgb + texture2D(tShafts, uv).rgb * uStrength * (1. - gun * .9), inputColor.a);
      }`, {
      blendFunction: BlendFunction.SRC, attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([['tShafts', new THREE.Uniform(texture)], ['uStrength', new THREE.Uniform(0)], ['uGun', new THREE.Uniform(0)]]),
    });
  }
  set strength(s: number) { this.uniforms.get('uStrength')!.value = s; }
  /** Whether the weapon pass drew this frame (otherwise the depth is the world's, and the shafts cross everything). */
  set gun(on: boolean) { this.uniforms.get('uGun')!.value = on ? 1 : 0; }
}

/**
 * The mask and blur, run as a pass of its own straight after the world's render pass. `strength` is the
 * atmosphere's shaft strength; it fades out as the view turns away from the sun.
 */
export class ShaftsPass extends Pass {
  readonly effect: ShaftsEffect;
  private mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private blur = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private maskMat: THREE.ShaderMaterial; private blurMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh; private quadScene = new THREE.Scene(); private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor(private view: THREE.PerspectiveCamera, private sunDir: THREE.Vector3, private strength: number) {
    super('ShaftsPass');
    this.needsSwap = false; this.needsDepthTexture = true;
    for (const t of [this.mask, this.blur]) { t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter; t.texture.generateMipmaps = false; }
    const common = { vertexShader: VERT, depthTest: false, depthWrite: false, toneMapped: false };
    this.maskMat = new THREE.ShaderMaterial({ ...common, fragmentShader: MASK, uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uFloor: { value: 1 } } });
    this.blurMat = new THREE.ShaderMaterial({ ...common, fragmentShader: BLUR, uniforms: { tMask: { value: this.mask.texture }, uSun: { value: new THREE.Vector2() }, uDensity: { value: .8 }, uDecay: { value: .935 }, uWeight: { value: .03 } } });
    this.quad = new THREE.Mesh(triangle, this.maskMat); this.quad.frustumCulled = false; this.quadScene.add(this.quad);
    this.effect = new ShaftsEffect(this.blur.texture);
  }
  override setDepthTexture(depth: THREE.Texture) { this.maskMat.uniforms.tDepth.value = depth; }
  override setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / 4)), h = Math.max(1, Math.round(height / 4));
    this.mask.setSize(w, h); this.blur.setSize(w, h);
    this.maskMat.uniforms.uTexel.value.set(1 / width, 1 / height); this.maskMat.uniforms.uAspect.value = width / Math.max(1, height);
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    // How squarely the view faces the sun: full within ~50° of it, gone past ~80° (the beams converge on a point
    // off screen, which reads as rays across the frame while the sun is still near the edge of view).
    this.view.getWorldDirection(fwd);
    const facing = fwd.dot(this.sunDir), k = this.strength * THREE.MathUtils.smoothstep(facing, .17, .64);
    this.effect.strength = k;
    if (k <= .001) return;
    v.copy(this.view.position).addScaledVector(this.sunDir, 1000).project(this.view);
    const sun = this.maskMat.uniforms.uSun.value as THREE.Vector2; sun.set(v.x * .5 + .5, v.y * .5 + .5);
    (this.blurMat.uniforms.uSun.value as THREE.Vector2).copy(sun);
    this.maskMat.uniforms.tColor.value = inputBuffer.texture;
    const before = renderer.getRenderTarget();
    this.quad.material = this.maskMat; renderer.setRenderTarget(this.mask); renderer.render(this.quadScene, this.quadCam);
    this.quad.material = this.blurMat; renderer.setRenderTarget(this.blur); renderer.render(this.quadScene, this.quadCam);
    renderer.setRenderTarget(before);
  }
  override dispose() { this.mask.dispose(); this.blur.dispose(); this.maskMat.dispose(); this.blurMat.dispose(); this.effect.dispose(); super.dispose(); }
}
