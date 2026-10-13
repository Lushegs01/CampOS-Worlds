// Run CampOS Worlds locally WITH accounts, clubs and events, without a Supabase project:
//   npm run dev:local        → http://127.0.0.1:5175
// Data persists in a local PostgreSQL cluster under your temp folder. This stand-in implements only
// what Worlds uses (email/password auth and the RPC functions); deploy against a real Supabase
// project (docs/ACCOUNTS.md). The plain `npm run dev` guest experience is unchanged.
import { startStack } from '../../tests/support/stack.mjs';

const stack = await startStack({ name: 'local', database: 'campos_local', keep: true, webPort: Number(process.env.WEB_PORT) || 5175, roomPort: Number(process.env.ROOM_PORT) || 3201, supabasePort: Number(process.env.SUPABASE_PORT) || 54321 });
console.log(`\nCampOS Worlds (local accounts) → ${stack.url}\nLocal Supabase stand-in → ${stack.supa.url}\nPress Ctrl+C to stop.\n`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await stack.stop().catch(() => {}); process.exit(0); });
