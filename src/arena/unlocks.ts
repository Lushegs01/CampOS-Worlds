// Names and kinds of everything a level can unlock, for the mid-match unlock notices and the after-action report.
// Ids come from the catalogue (shared/arena/weapons.mjs); player-level unlocks may name an emblem as 'emblem:<id>'
// (the game's own list) or by its bare id (the database's list).
import { WEAPON_BY_ID, EQUIPMENT_BY_ID, PERK_BY_ID, STREAK_BY_ID, EMBLEM_BY_ID, SKIN_BY_ID, CATEGORIES } from '../../shared/arena/weapons.mjs';

export type UnlockInfo = { id: string; name: string; kind: string; detail: string; color?: string; colors?: string[]; glyph?: string; weapon?: string };

export function unlockInfo(raw: string): UnlockInfo {
  const id = raw.startsWith('emblem:') ? raw.slice(7) : raw;
  const w = WEAPON_BY_ID.get(id);
  if (w) return { id, name: w.name, kind: 'Weapon', detail: CATEGORIES[w.category as keyof typeof CATEGORIES] ?? '', weapon: w.id };
  const e = EQUIPMENT_BY_ID.get(id);
  if (e) return { id, name: e.name, kind: e.kind === 'lethal' ? 'Lethal' : 'Tactical', detail: 'Equipment' };
  const p = PERK_BY_ID.get(id);
  if (p) return { id, name: p.name, kind: 'Perk', detail: p.text };
  const s = STREAK_BY_ID.get(id);
  if (s) return { id, name: s.name, kind: 'Scorestreak', detail: `${s.cost} points` };
  const em = EMBLEM_BY_ID.get(id);
  if (em) return { id, name: em.name, kind: 'Emblem', detail: 'Player emblem', color: em.color, glyph: em.glyph };
  const k = SKIN_BY_ID.get(id);
  if (k) return { id, name: k.name, kind: 'Finish', detail: `Weapon level ${k.weaponLevel}`, colors: k.colors };
  return { id, name: id, kind: '', detail: '' };
}
export const unlockName = (raw: string) => { const u = unlockInfo(raw); return u.kind === 'Emblem' ? `${u.name} emblem` : u.kind === 'Finish' ? `${u.name} finish` : u.name; };
