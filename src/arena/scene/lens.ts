// Camera lens effects for the arena's post stack (Medium and up): velocity motion blur and a focus-pull depth of field.
//
// Both need the WORLD's depth, but the first-person weapon is drawn over a cleared depth buffer (Scene.tsx), so by the
// time the effects run the composer's depth holds only the weapon. WorldDepthPass therefore runs straight after the
// world's render pass and saves the world's linear depth (metres from the eye) to a half-float target; the effects then
// read the world from it and use the composer's depth as a mask of where the weapon and hands are, which they never
// blur (and never sample from, so nothing smears off the weapon onto the world behind it).
//
//  · MotionBlurEffect: per-pixel camera motion, reconstructed from the saved depth and last frame's view-projection
//    (so it follows turning, strafing and sprinting alike), scaled to a fixed shutter time whatever the frame rate,
//    capped in length, and weighted by how fast the player is going (Scene.tsx drives `amount`).
//  · FocusBlurEffect: the world behind the weapon softens during reloads and inspection; the circle of confusion grows
//    with distance past a near focus, gathered over a golden-angle disc with a scatter test so sharp edges do not bleed.
import * as THREE from 'three';
import { Pass, Effect, BlendFunction, EffectAttribute } from 'postprocessing';

const triangle = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

/** Saves the world's depth as linear distance along the view axis (metres), before the weapon pass replaces it. */
export class WorldDepthPass extends Pass {
  // (RGBA: half-float RGBA is renderable wherever the composer's own buffers are; a red-only target is not everywhere.)
  readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 1., 1.); }',
    fragmentShader: `uniform sampler2D tDepth; uniform float uNear, uFar; varying vec2 vUv;
      void main() { float d = texture2D(tDepth, vUv).r * 2. - 1.; gl_FragColor = vec4(2. * uNear * uFar / (uFar + uNear - d * (uFar - uNear)), 0., 0., 1.); }`,
    uniforms: { tDepth: { value: null }, uNear: { value: .1 }, uFar: { value: 1000 } }, depthTest: false, depthWrite: false,
  });
  private quad = new THREE.Mesh(triangle, this.mat); private quadScene = new THREE.Scene(); private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Whether anything reads the saved depth this frame (the pass is skipped otherwise). */
  wanted = false;
  constructor(private view: THREE.PerspectiveCamera) {
    super('WorldDepthPass'); this.needsSwap = false; this.needsDepthTexture = true;
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.NearestFilter; this.target.texture.generateMipmaps = false;
    this.quad.frustumCulled = false; this.quadScene.add(this.quad);
  }
  override setDepthTexture(depth: THREE.Texture) { this.mat.uniforms.tDepth.value = depth; }
  override setSize(width: number, height: number) { this.target.setSize(Math.max(1, width), Math.max(1, height)); }
  override render(renderer: THREE.WebGLRenderer) {
    if (!this.wanted) return;
    this.mat.uniforms.uNear.value = this.view.near; this.mat.uniforms.uFar.value = this.view.far;
    const before = renderer.getRenderTarget(); renderer.setRenderTarget(this.target); renderer.render(this.quadScene, this.quadCam); renderer.setRenderTarget(before);
  }
  override dispose() { this.target.dispose(); this.mat.dispose(); super.dispose(); }
}

/** GLSL shared by both effects: world distance at a UV, and whether the weapon covers a UV (composer depth < far). */
const COMMON = /* glsl */`
uniform sampler2D tWorld; uniform float uGun;
float worldZ(vec2 uv) { return texture2D(tWorld, uv).r; }
float gunAt(vec2 uv) { return uGun * (1. - step(.99999, readDepth(uv))); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
`;

export class MotionBlurEffect extends Effect {
  /** 0 off … 1: the share of a 1/60 s shutter the camera's motion is blurred over. */
  amount = 0;
  private prev = new THREE.Matrix4(); private cur = new THREE.Matrix4(); private hasPrev = false; private lastPos = new THREE.Vector3(); private lastQ = new THREE.Quaternion();
  constructor(worldDepth: THREE.Texture) {
    super('MotionBlurEffect', COMMON + /* glsl */`
      uniform mat4 uInvProj, uCamWorld, uPrevViewProj; uniform float uStrength, uMax;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        outputColor = inputColor;
        if (uStrength <= 0. || gunAt(uv) > .5) return;
        // Where this pixel's world point was on screen last frame.
        vec4 far = uInvProj * vec4(uv * 2. - 1., 1., 1.); vec3 ray = far.xyz / far.w;
        vec3 viewPos = ray * (worldZ(uv) / max(-ray.z, 1e-4));
        vec4 prev = uPrevViewProj * (uCamWorld * vec4(viewPos, 1.));
        if (prev.w <= 0.) return;
        vec2 vel = (uv - (prev.xy / prev.w * .5 + .5)) * uStrength;
        float len = length(vel); if (len > uMax) vel *= uMax / len;
        if (length(vel / texelSize) < .75) return;
        float j = ign(gl_FragCoord.xy); vec3 acc = inputColor.rgb; float wsum = 1.;
        for (int i = 0; i < 10; i++) {
          vec2 suv = clamp(uv + vel * ((float(i) + j) / 10. - .5), vec2(.001), vec2(.999));
          float w = 1. - gunAt(suv);
          acc += texture2D(inputBuffer, suv).rgb * w; wsum += w;
        }
        outputColor = vec4(acc / wsum, inputColor.a);
      }`, {
      blendFunction: BlendFunction.SRC, attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['tWorld', new THREE.Uniform(worldDepth)], ['uGun', new THREE.Uniform(0)], ['uStrength', new THREE.Uniform(0)], ['uMax', new THREE.Uniform(.03)],
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())], ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())], ['uPrevViewProj', new THREE.Uniform(new THREE.Matrix4())],
      ]),
    });
  }
  set gun(on: boolean) { this.uniforms.get('uGun')!.value = on ? 1 : 0; }
  /**
   * Call once per drawn frame, after the camera is placed and before the composer renders (whether or not the blur is
   * on, so turning it on never blurs against a stale frame). Returns the strength used this frame.
   */
  frame(camera: THREE.PerspectiveCamera, dt: number, raw = false) {
    camera.updateMatrixWorld();
    this.cur.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const moved = this.lastPos.distanceTo(camera.position), turned = this.lastQ.angleTo(camera.quaternion);
    const jumped = !this.hasPrev || moved > 2; // respawn, teleport
    // (`raw`, QA only: blur over the whole frame-to-frame motion, so software-rendered captures at 1 fps show it.)
    let s = jumped ? 0 : this.amount * (raw ? 1 : Math.min(2, (1 / 60) / Math.max(dt, 1 / 240)));
    // A still camera blurs nothing: report 0 so the pass (and the depth copy) are skipped entirely.
    if (turned * s < 2e-4 && moved * s < 1e-3) s = 0;
    this.uniforms.get('uStrength')!.value = s;
    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.uniforms.get('uCamWorld')!.value as THREE.Matrix4).copy(camera.matrixWorld);
    (this.uniforms.get('uPrevViewProj')!.value as THREE.Matrix4).copy(this.prev);
    this.prev.copy(this.cur); this.lastPos.copy(camera.position); this.lastQ.copy(camera.quaternion); this.hasPrev = true;
    return s;
  }
}

export class FocusBlurEffect extends Effect {
  constructor(worldDepth: THREE.Texture) {
    super('FocusBlurEffect', COMMON + /* glsl */`
      uniform float uAmount, uFocus, uRange, uMaxR;
      float coc(float z) { return uAmount * uMaxR * smoothstep(uFocus, uFocus + uRange, z); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        outputColor = inputColor;
        if (uAmount <= 0. || gunAt(uv) > .5) return;
        float c = coc(worldZ(uv)); if (c < .6) return;
        float j = ign(gl_FragCoord.xy) * 6.2831853; vec3 acc = inputColor.rgb; float wsum = 1.;
        for (int i = 0; i < 28; i++) {
          float r = sqrt((float(i) + .5) / 28.), a = float(i) * 2.3999632 + j;
          vec2 suv = clamp(uv + vec2(cos(a), sin(a)) * r * c * texelSize, vec2(.001), vec2(.999));
          // Scatter test: a tap counts if its own blur reaches this pixel (in-focus edges do not bleed outward).
          float w = clamp(coc(worldZ(suv)) - r * c + 1., 0., 1.) * (1. - gunAt(suv));
          vec3 s = texture2D(inputBuffer, suv).rgb;
          w *= 1. + min(dot(s, vec3(.2126, .7152, .0722)), 4.) * .35; // highlights bloom into bokeh
          acc += s * w; wsum += w;
        }
        outputColor = vec4(acc / wsum, inputColor.a);
      }`, {
      blendFunction: BlendFunction.SRC, attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([['tWorld', new THREE.Uniform(worldDepth)], ['uGun', new THREE.Uniform(0)], ['uAmount', new THREE.Uniform(0)], ['uFocus', new THREE.Uniform(.9)], ['uRange', new THREE.Uniform(5)], ['uMaxR', new THREE.Uniform(9)]]),
    });
  }
  set gun(on: boolean) { this.uniforms.get('uGun')!.value = on ? 1 : 0; }
  set amount(a: number) { this.uniforms.get('uAmount')!.value = a; }
  /** Largest blur radius in pixels of the drawing buffer (scaled with its height so it looks the same at any size). */
  setHeight(h: number) { this.uniforms.get('uMaxR')!.value = 9 * Math.max(.5, h / 1080); }
}

/** A critically damped spring (for the focus pull): `step` moves `x` toward `target` with no overshoot. */
export function spring(stiffness: number) {
  const k = stiffness, c = 2 * Math.sqrt(k);
  const s = { x: 0, v: 0, step(target: number, dt: number) {
    // Sub-stepped (stable at any frame rate: a slow frame still advances the pull by its real duration).
    for (let left = Math.min(dt, .5); left > 1e-6; left -= .016) { const h = Math.min(.016, left); s.v += (k * (target - s.x) - c * s.v) * h; s.x += s.v * h; }
    if (s.x < 1e-3 && target === 0) { s.x = 0; s.v = 0; }
    return s.x;
  } };
  return s;
}
