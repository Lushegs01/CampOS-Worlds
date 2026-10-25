import { resolve, sep } from 'node:path';
import { parseCompletionOverrides } from '../shared/buildings.mjs';

// Validate operator configuration before binding a port. Never include values in errors.
export function roomConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const number = (key, fallback, min, max) => {
    if (!env[key]) return fallback;
    const value = Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    return value;
  };
  const origins = (env.ALLOWED_ORIGINS || (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173')).split(',').map(v => v.trim()).filter(Boolean);
  if (!origins.length) throw new Error('ALLOWED_ORIGINS is required in production.');
  for (const origin of origins) {
    let url; try { url = new URL(origin); } catch { throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins.'); }
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (production && (url.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(url.hostname)))) throw new Error('ALLOWED_ORIGINS must contain exact HTTPS production origins.');
  }
  const adminToken = env.ADMIN_TOKEN || '';
  if (production && adminToken.length < 32) throw new Error('ADMIN_TOKEN must contain at least 32 characters in production.');
  const accountValues = [env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY];
  if (accountValues.some(Boolean) && !accountValues.every(Boolean)) throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for accounts.');
  for (const key of ['SUPABASE_URL', 'PUBLIC_APP_URL', 'BACHS_API_URL']) {
    if (!env[key]) continue;
    let url; try { url = new URL(env[key]); } catch { throw new Error(`${key} must be an HTTP(S) URL.`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (production && url.protocol !== 'https:')) throw new Error(`${key} must use HTTPS in production.`);
  }
  const store = [env.BACHS_SECRET_KEY, env.BACHS_WEBHOOK_SECRET, env.PUBLIC_APP_URL];
  if (store.some(Boolean) && (!store.every(Boolean) || !accountValues.every(Boolean))) throw new Error('The store requires accounts, BACHS_SECRET_KEY, BACHS_WEBHOOK_SECRET and PUBLIC_APP_URL.');
  if (env.ANALYTICS_ENABLED === '1' && (env.ANALYTICS_SALT || '').length < 16) throw new Error('Enabled analytics requires an ANALYTICS_SALT of at least 16 characters.');
  const privatePath = (key, fallback) => {
    const file = env[key] || fallback, absolute = resolve(file);
    if (['public', 'dist', 'dist-qa'].some(dir => absolute === resolve(dir) || absolute.startsWith(resolve(dir) + sep))) throw new Error(`${key} must be outside frontend directories.`);
    return file;
  };
  return { production, port: number('PORT', 3001, 1, 65535), host: env.HOST || '127.0.0.1', origins,
    capacity: number('ROOM_CAPACITY', 48, 2, 48), adminToken, invite: env.ROOM_INVITE || '', id: env.ROOM_ID || 'courtyard',
    reportDir: privatePath('REPORT_DIR', 'server/data'), moderationFile: privatePath('MODERATION_FILE', 'server/data/moderation.json'),
    labFile: privatePath('LAB_DATA_FILE', 'server/data/economic-lab.json'),
    analyticsDir: privatePath('ANALYTICS_DIR', 'server/data/analytics'), retentionDays: number('ANALYTICS_RETENTION_DAYS', 90, 1, 90),
    // Building completion overrides ("studio-d1=70,courtyard-cafe=35"; shared/buildings.mjs). Invalid values stop start-up.
    buildings: parseCompletionOverrides(env.BUILDING_COMPLETION || '') };
}
