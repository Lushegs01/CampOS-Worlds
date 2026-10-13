import { createRoom } from './room.mjs';
import { createAccounts } from './accounts.mjs';
try {process.loadEnvFile();} catch {}
const room=createRoom({port:Number(process.env.PORT)||3001,host:process.env.HOST||'127.0.0.1',origins:(process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173').split(','),capacity:Math.min(48,Math.max(2,Number(process.env.ROOM_CAPACITY)||24)),adminToken:process.env.ADMIN_TOKEN||'',invite:process.env.ROOM_INVITE||'',accounts:createAccounts({url:process.env.SUPABASE_URL||'',serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY||'',anonKey:process.env.SUPABASE_ANON_KEY||''})});
await room.start();console.log('CampOS room listening on http://'+(process.env.HOST||'127.0.0.1')+':'+(process.env.PORT||3001));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await room.close();process.exit(0);});
