import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, BloomEffect, Effect, BlendFunction } from 'postprocessing';
import { env } from './environment';
import { N8AOPostPass } from 'n8ao';
import type { QualityProfile } from './quality';
import { QA_HOOKS } from '../qa';
import { postStack, campusBudget } from './rendering';

// Deliberately restrained: ambient occlusion for contact shading, exposure that adapts to the time of day and
// weather (./environment.ts), a low bloom that only catches HDR highlights (the sun, lamps at night, wet
// reflections), filmic tone mapping and anti-aliasing. No chromatic aberration, lens dirt or sharpening.

/** Scene-referred exposure and a gentle saturation/contrast grade, before tone mapping. */
class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', /* glsl */`
      uniform float exposure, saturation;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb * exposure;
        float l = dot(c, vec3(.2126, .7152, .0722));
        outputColor = vec4(max(mix(vec3(l), c, saturation), 0.), inputColor.a);
      }`, { blendFunction: BlendFunction.SRC, uniforms: new Map([['exposure', new THREE.Uniform(1)], ['saturation', new THREE.Uniform(1)]]) });
  }
}
export default function PostFX({ quality }: { quality: QualityProfile }) {
  const { gl, scene, camera, size } = useThree();
  const dpr = useThree(s => s.viewport.dpr);
  const composer = useRef<EffectComposer | null>(null), aoPass = useRef<N8AOPostPass | null>(null);
  const grade = useRef<{ exposure: ExposureEffect; bloom: BloomEffect } | null>(null);
  useFrame(() => {
    if (aoPass.current) aoPass.current.enabled = campusBudget.level === 0;
    const g = grade.current; if (!g) return;
    g.exposure.uniforms.get('exposure')!.value = env.exposure;
    // Rain and overcast mute colour a little; night keeps its colour (the lamps carry it).
    g.exposure.uniforms.get('saturation')!.value = 1.04 - .14 * env.params.overcast * (1 - env.night);
    g.bloom.intensity = campusBudget.level >= 2 ? 0 : env.bloom;
  });
  // Created in the effect (not useMemo) so StrictMode's mount/unmount/mount never renders a
  // disposed composer.
  useEffect(() => {
    const c = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType });
    c.addPass(new RenderPass(scene, camera));
    const ao = new N8AOPostPass(scene, camera, size.width, size.height);
    Object.assign(ao.configuration, { aoRadius: 1.6, distanceFalloff: .6, intensity: 2.2, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, color: new THREE.Color('#0b0a08') });
    ao.setQualityMode('Medium');
    c.addPass(ao); aoPass.current = ao;
    const exposure = new ExposureEffect();
    const bloom = new BloomEffect({ luminanceThreshold: 1.1, luminanceSmoothing: .35, intensity: .12, mipmapBlur: true, radius: .6 });
    c.addPass(new EffectPass(camera, exposure));
    c.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
    grade.current = { exposure, bloom };
    c.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    const previous = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
    // World's renderer draws each frame through it (World.tsx, Render).
    composer.current = c; postStack.composer = c;
    if (QA_HOOKS) Object.assign(window, { __campusComposer: c });
    return () => { composer.current = null; aoPass.current = null; grade.current = null; if (QA_HOOKS) delete (window as unknown as Record<string, unknown>).__campusComposer; if (postStack.composer === c) postStack.composer = null; c.dispose(); gl.toneMapping = previous; };
  }, [gl, scene, camera, quality]);
  useEffect(() => { composer.current?.setSize(size.width, size.height); }, [size, quality, dpr]);
  return null;
}
