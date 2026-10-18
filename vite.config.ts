import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// Stable across code-only releases. New asset bytes get a new URL without disabling browser cache.
function assetRevision(dir = 'public/assets') {
 const hash = createHash('sha256');
 const visit = (base: string) => { for (const entry of readdirSync(base, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) { const path=join(base,entry.name); if(entry.isDirectory())visit(path);else { hash.update(path.replaceAll('\\','/')); hash.update(readFileSync(path)); } } };
 visit(dir); return hash.digest('hex').slice(0,12);
}
// The room server address can be overridden per mode (e.g. `--mode qa` reads ROOM_URL from .env.qa),
// so automated tests can run against their own room without touching anyone's live session.
export default defineConfig(({ mode }) => {
 const room=loadEnv(mode,'.','').ROOM_URL||'127.0.0.1:3001';
 const proxy={'/ws':{target:`ws://${room}`,ws:true},'/health':{target:`http://${room}`}};
 return {
  plugins:[react()],
  define:{__CAMPUS_ASSET_VERSION__:JSON.stringify(assetRevision())},
  // Pre-bundled up front: these are first imported by the lazily loaded 3D scene, and discovering them
  // then made the dev server re-optimise and reload the page during a developer's (or a test's) first visit.
  optimizeDeps:{include:['three','@react-three/fiber','postprocessing','n8ao','three/examples/jsm/geometries/RoundedBoxGeometry.js','three/examples/jsm/libs/meshopt_decoder.module.js','three/examples/jsm/loaders/GLTFLoader.js','three/examples/jsm/loaders/HDRLoader.js','three/examples/jsm/loaders/KTX2Loader.js','three/examples/jsm/utils/BufferGeometryUtils.js','three/examples/jsm/utils/SkeletonUtils.js']},
  server:{port:5173,strictPort:true,proxy},
  // The preview server proxies the room too, so the production bundle can be tested end to end.
  preview:{port:4173,strictPort:true,proxy},
  // three.js and the renderer get a chunk of their own (React stays with the interface), so the welcome
  // screen paints while the 3D engine is still downloading instead of waiting for it.
  build:{chunkSizeWarningLimit:1000,rollupOptions:{output:{manualChunks:id=>/node_modules[\\/](three|@react-three)[\\/]/.test(id)?'three':/node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/.test(id)?'react':undefined}}}
 };
});
