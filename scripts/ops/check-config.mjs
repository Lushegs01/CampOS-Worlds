import { roomConfig } from '../../server/config.mjs';
try{process.loadEnvFile();}catch{}
try{
 const config=roomConfig({...process.env,NODE_ENV:'production'});
 console.log(JSON.stringify({valid:true,origins:config.origins,capacity:config.capacity,accounts:!!process.env.SUPABASE_URL,store:!!process.env.BACHS_SECRET_KEY,analytics:process.env.ANALYTICS_ENABLED==='1',
  note:'Syntax and consistency only. Confirm persistent volumes, database migrations, Auth redirects, DNS/TLS and live connectivity separately.'},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
