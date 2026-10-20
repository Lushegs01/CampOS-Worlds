// Capture server for the trailer (port 5180): the game's own dev configuration, without hot reload, and
// without the Economic Simulation Lab. The creative brief treats the lab as an unreleased feature, so the
// trailer shows the campus as it stood before it (commit be61cb7): its hall, door and path are left out.
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite';
import game from '../vite.config';

function withoutLab(): Plugin {
  const edits: [RegExp, string, string][] = [
    [/\/src\/world\/architecture\/economicLab\.ts$/, '', 'export function buildEconomicLab() {}\n'],
    [/\/src\/world\/layout\.ts$/, "  { mat: 'pavers', ...LAB_PATH },\n", ''],
    [/\/shared\/interactions\.mjs$/, '\n LAB_DOOR,', ''],
  ];
  return {
    name: 'trailer-without-lab', enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0];
      for (const [match, find, replace] of edits) {
        if (!match.test(path)) continue;
        if (!find) return replace;
        if (!code.includes(find)) throw new Error(`trailer capture: expected lab code not found in ${path}`);
        return code.replace(find, replace);
      }
    },
  };
}

export default defineConfig(env => mergeConfig((game as (e: typeof env) => UserConfig)(env), {
  plugins: [withoutLab()],
  server: { port: 5180, strictPort: true, hmr: false },
}));
