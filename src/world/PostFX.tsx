import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { QualityProfile } from './quality';
import { QA_HOOKS } from '../qa';

// Deliberately restrained: ambient occlusion for contact shading, filmic tone mapping and
// anti-aliasing. No bloom, chromatic aberration or colour grading.
export default function PostFX({ quality }: { quality: QualityProfile }) {
  const { gl, scene, camera, size } = useThree();
  const composer = useRef<EffectComposer | null>(null);
  // Created in the effect (not useMemo) so StrictMode's mount/unmount/mount never renders a
  // disposed composer.
  useEffect(() => {
    const c = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType });
    c.addPass(new RenderPass(scene, camera));
    const ao = new N8AOPostPass(scene, camera, size.width, size.height);
    Object.assign(ao.configuration, { aoRadius: 1.6, distanceFalloff: .6, intensity: 2.2, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, color: new THREE.Color('#0b0a08') });
    ao.setQualityMode('Medium');
    c.addPass(ao);
    c.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
    c.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    const previous = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
    composer.current = c;
    if (QA_HOOKS) Object.assign(window, { __campusComposer: c });
    return () => { composer.current = null; c.dispose(); gl.toneMapping = previous; };
  }, [gl, scene, camera, quality]);
  useEffect(() => { composer.current?.setSize(size.width, size.height); }, [size, quality]);
  useFrame((state, dt) => { if (composer.current) composer.current.render(dt); else state.gl.render(state.scene, state.camera); }, 1);
  return null;
}
