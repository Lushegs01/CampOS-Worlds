import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// The room server address can be overridden per mode (e.g. `--mode qa` reads ROOM_URL from .env.qa),
// so automated tests can run against their own room without touching anyone's live session.
export default defineConfig(({ mode }) => {
 const room=loadEnv(mode,'.','').ROOM_URL||'127.0.0.1:3001';
 const proxy={'/ws':{target:`ws://${room}`,ws:true},'/health':{target:`http://${room}`}};
 return {
  plugins:[react()],
  server:{port:5173,strictPort:true,proxy},
  // The preview server proxies the room too, so the production bundle can be tested end to end.
  preview:{port:4173,strictPort:true,proxy},
  build:{chunkSizeWarningLimit:1000,rollupOptions:{output:{manualChunks:{three:['three','@react-three/fiber']}}}}
 };
});
