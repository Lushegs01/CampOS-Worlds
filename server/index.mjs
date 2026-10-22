import { createRoom } from './room.mjs';
import { createAccounts } from './accounts.mjs';
import { createAnalytics } from './analytics.mjs';
try {process.loadEnvFile();} catch {}
const room=createRoom({labFile:process.env.LAB_DATA_FILE||'server/data/economic-lab.json',port:Number(process.env.PORT)||3001,host:process.env.HOST||'127.0.0.1',origins:(process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173').split(','),capacity:Math.min(48,Math.max(2,Number(process.env.ROOM_CAPACITY)||48)),adminToken:process.env.ADMIN_TOKEN||'',invite:process.env.ROOM_INVITE||'',accounts:createAccounts({url:process.env.SUPABASE_URL||'',serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY||'',anonKey:process.env.SUPABASE_ANON_KEY||''}),id:process.env.ROOM_ID||'courtyard',
 // The campus store: Bachs checkout and its webhook (server/shop.mjs, docs/STORE.md). Prices in whole naira.
 shop:{secretKey:process.env.BACHS_SECRET_KEY||'',webhookSecret:process.env.BACHS_WEBHOOK_SECRET||'',appUrl:process.env.PUBLIC_APP_URL||'',apiUrl:process.env.BACHS_API_URL||'',prices:{character:process.env.SHOP_PRICE_CHARACTER,item:process.env.SHOP_PRICE_ITEM}},
 analytics:createAnalytics({enabled:process.env.ANALYTICS_ENABLED==='1',salt:process.env.ANALYTICS_SALT||'',dir:process.env.ANALYTICS_DIR||'server/data/analytics',retentionDays:Math.min(400,Math.max(1,Number(process.env.ANALYTICS_RETENTION_DAYS)||90))})});
await room.start();console.log('CampOS room listening on http://'+(process.env.HOST||'127.0.0.1')+':'+(process.env.PORT||3001));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await room.close();process.exit(0);});
