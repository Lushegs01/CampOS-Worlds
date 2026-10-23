import { createRoom } from './room.mjs';
import { createAccounts } from './accounts.mjs';
import { createAnalytics } from './analytics.mjs';
import { roomConfig } from './config.mjs';
try {process.loadEnvFile();} catch {}
const config=roomConfig();
const room=createRoom({...config,accounts:createAccounts({url:process.env.SUPABASE_URL||'',serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY||'',anonKey:process.env.SUPABASE_ANON_KEY||''}),
 // The campus store: Bachs checkout and its webhook (server/shop.mjs, docs/STORE.md). Prices in whole naira.
 shop:{secretKey:process.env.BACHS_SECRET_KEY||'',webhookSecret:process.env.BACHS_WEBHOOK_SECRET||'',appUrl:process.env.PUBLIC_APP_URL||'',apiUrl:process.env.BACHS_API_URL||'',prices:{character:process.env.SHOP_PRICE_CHARACTER,item:process.env.SHOP_PRICE_ITEM}},
 analytics:createAnalytics({enabled:process.env.ANALYTICS_ENABLED==='1',salt:process.env.ANALYTICS_SALT||'',dir:config.analyticsDir,retentionDays:config.retentionDays})});
await room.start();console.log('CampOS room listening on http://'+config.host+':'+config.port);
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;
 console.log('CampOS room draining.');
 const deadline=setTimeout(()=>{console.error('CampOS shutdown exceeded 15 seconds. Check persistent storage.');process.exit(1);},15000);
 room.close().then(()=>{clearTimeout(deadline);process.exit(0);},()=>{clearTimeout(deadline);console.error('CampOS shutdown could not flush pending work.');process.exit(1);});
});
