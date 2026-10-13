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
  server:{port:5173,strictPort:true,proxy},
  // The preview server proxies the room too, so the production bundle can be tested end to end.
  preview:{port:4173,strictPort:true,proxy},
  build:{chunkSizeWarningLimit:1000,rollupOptions:{output:{manualChunks:{three:['three','@react-three/fiber']}}}}
 };
});
