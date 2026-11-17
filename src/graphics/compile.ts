import type * as THREE from 'three';

/** Three r183's compileAsync polls currentProgram after a material/context is disposed, throwing
 * outside its promise. Bound the polling to this renderer and remove retired materials explicitly. */
export function installCompilation(renderer: THREE.WebGLRenderer, event: (name: string, detail?: string) => void) {
  const pending = new Set<() => void>();
  renderer.compileAsync = (scene, camera, targetScene) => {
    event('compile-start');
    return new Promise((resolve, reject) => {
      let materials: Set<THREE.Material>;
      try { materials = renderer.compile(scene, camera, targetScene); }
      catch (error) { event('compile-error', String(error)); reject(error); return; }
      let timer: ReturnType<typeof setTimeout>;
      const listeners = new Map<THREE.Material, () => void>();
      const clean = () => {
        clearTimeout(timer); pending.delete(cancel);
        for (const [material, listener] of listeners) material.removeEventListener('dispose', listener);
        listeners.clear(); event('compile-end');
      };
      const cancel = () => { clean(); reject(new DOMException('Renderer retired', 'AbortError')); };
      pending.add(cancel);
      for (const material of materials) {
        const listener = () => { materials.delete(material); };
        listeners.set(material, listener); material.addEventListener('dispose', listener);
      }
      const check = () => {
        if (renderer.getContext().isContextLost()) { cancel(); return; }
        try {
          for (const material of materials) {
            const program = (renderer.properties.get(material) as { currentProgram?: { isReady: () => boolean; program?: WebGLProgram; name?: string } }).currentProgram;
            // Another scene or quality update can have retired the material between polls.
            if (!program || program.isReady()) {
              // Completion means the compiler finished, not that the program linked successfully.
              const context = renderer.getContext();
              if (program?.program && !context.getProgramParameter(program.program, context.LINK_STATUS)) {
                throw new Error(`A graphics shader could not be linked (${program.name || material.name || material.type}): ${context.getProgramInfoLog(program.program) || 'No driver details'}`);
              }
              materials.delete(material);
            }
          }
          if (!materials.size) { clean(); resolve(scene); }
          else timer = setTimeout(check, 10);
        } catch (error) { clean(); event('compile-error', String(error)); reject(error); }
      };
      timer = setTimeout(check, 10);
    });
  };
  return Object.assign(() => { for (const cancel of [...pending]) cancel(); }, { pending: () => pending.size });
}
