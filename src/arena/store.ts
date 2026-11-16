// Combat Arena interface state. High-frequency values (positions, view angles, ammunition as it
// changes every shot) live outside React in src/arena/net.ts; this store holds what the interface
// shows and is updated only when those values change, at most ~15 times a second.
import { create } from 'zustand';
import { type Quality } from '../world/quality';
import { PRESETS, validateLoadout } from '../../shared/arena/rules.mjs';
import { parseArenaSettings } from '../../shared/arena/settings.mjs';
import { recommendQuality } from './device';

export type Loadout = { name: string; primary: string; secondary: string; lethal: string; tactical: string; perks: string[]; skins?: Record<string, string> };
export type RosterEntry = { num: number; name: string; team: number; verified: boolean; handle: string | null; bot: boolean; connected: boolean; level: number; emblem: string };
export type MatchView = { variant?: string; broken?: number[]; closed?: number[]; elapsed?: number; id: string; mode: string; map: string; kind: 'quick' | 'private' | 'training'; code: string | null; state: string; autoFire?: boolean; maxPerTeam: number; scoreLimit: number; timeMs: number; seed: number; scores: number[]; players: RosterEntry[]; objectives: { id: string; x: number; z: number; r: number }[] };
export type FeedEntry = { id: number; killer: number | null; victim: number; weapon: string | null; head: boolean; at: number };
export type ResultRow = { num: number; name: string; team: number; bot: boolean; account: string | null; result: 'win' | 'loss' | 'draw'; completed: boolean; kills: number; deaths: number; assists: number; headshots: number; captures: number; neutralizes: number; defends: number; score: number; damage: number; bestStreak: number; xp: number };
export type MatchResult = { id: string; mode: string; map: string; kind: string; winner: number | null; outcome: string; scores: number[]; startedAt: number; endedAt: number; players: ResultRow[] };
export type Progress = { xp: number; total_xp: number; level_before: number; level: number; unlocked: string[]; weapon_levels: { weapon: string; before: number; level: number }[] };
export type Phase = 'lobby' | 'match' | 'results';

export interface ArenaSettings {
  mouse: number; ads: number; touch: number; pad: number; invertY: boolean; fov: number; quality: Quality | 'ultra'; showFps: boolean; autoSprint: boolean;
  /** Auto-fire (off by default): the trigger is pressed while the player's own aim is on a visible enemy. */
  autoFire: boolean;
  /** Lower the resolution (then the graphics profile) automatically when the frame rate cannot be held. */
  adaptive: boolean; renderScale: number; qualityChosen: boolean;
  /** Touch: the movement stick stays where the layout puts it instead of following the thumb. */
  fixedStick: boolean;
  /** Sound levels per category, 0–1 (the master level is the campus Volume). */
  volWeapons: number; volExplosions: number; volEnvironment: number; volFootsteps: number; volCharacter: number; volUi: number; volVoice: number;
}
const SETTINGS_KEY = 'campos-arena-settings', LOADOUT_KEY = 'campos-arena-loadouts';
function readSettings(): ArenaSettings {
  const recommended = recommendQuality().quality;
  try { const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'); const s = parseArenaSettings(raw, recommended) as ArenaSettings; if (!s.qualityChosen) s.quality = recommended; return s; }
  catch { return parseArenaSettings(null, recommended) as ArenaSettings; }
}
function writeJson(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage denied */ } }
/**
 * Guests keep their loadouts on this device; signed-in players' are saved to their account. A loadout that
 * uses a weapon this device's player cannot use (an Armory weapon, a damaged entry) is replaced by a preset.
 */
export function deviceLoadouts(): Loadout[] {
  let list: Loadout[] = PRESETS.map(p => ({ ...p }));
  try { const v = JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? 'null'); if (Array.isArray(v)) list = v.slice(0, 5); } catch { /* use the presets */ }
  return list.map((l, i) => (validateLoadout(l, 30, {}, []).ok ? l : { ...(PRESETS[i] ?? PRESETS[0]) }));
}
export function saveDeviceLoadouts(list: Loadout[]) { writeJson(LOADOUT_KEY, list.slice(0, 5)); }

export interface Hud {
  hp: number; alive: boolean; respawnMs: number; weapon: string; slot: number; mag: number; reserve: number; magSize: number; phase: string; reloadProgress: number; fireMode: string;
  ads: number; lethal: number; tactical: number; spread: number; earned: string[]; streakPts: number; streak: number; sprint: boolean; stance: number;
  timeLeft: number; scores: number[]; matchState: string; /** A door in reach: −1 none, 0 closed, 1 open. */ door: number; objectives: [number, number, number, number][]; ping: number; fps: number;
}
interface Arena {
  open: boolean; phase: Phase; status: 'idle' | 'connecting' | 'ready' | 'offline' | 'replaced'; error: string;
  /** Something the player should know about this session (accounts unavailable: playing as a guest). */
  notice: string;
  me: { name: string; verified: boolean; handle: string | null; level: number; xp: number; emblem: string; weaponLevels: Record<string, number>; weaponXp: Record<string, number> } | null;
  /** Store items the account owns, as the arena server knows them (premium weapons: 'weapon-<id>'). */
  owned: string[];
  loadout: Loadout; loadouts: Loadout[]; online: number;
  match: MatchView | null; you: { num: number; team: number; key: string } | null; feed: FeedEntry[];
  /** Live scoreboard: num → [kills, deaths, assists, score, objective]. */
  board: Record<number, number[]>;
  result: MatchResult | null; progress: Progress | null; record: { state: string; reason: string | null } | null;
  /** The 3D scene has its assets and is drawing. */
  sceneReady: boolean;
  hud: Hud; menu: boolean; scoreboard: boolean; editor: boolean; settingsOpen: boolean;
  /** The HUD Customization Studio and the Armory are open. */
  hudEditor: boolean; armory: string | null;
  killedBy: { num: number | null; weapon: string | null } | null;
  settings: ArenaSettings;
  set: (v: Partial<Arena>) => void;
  setSettings: (v: Partial<ArenaSettings>) => void;
}
export const emptyHud = (): Hud => ({ hp: 100, alive: false, respawnMs: 0, weapon: 'vanguard', slot: 0, mag: 0, reserve: 0, magSize: 0, phase: 'ready', fireMode: 'auto', reloadProgress: 0, ads: 0, lethal: 0, tactical: 0, spread: 0,
  earned: [], streakPts: 0, streak: 0, sprint: false, stance: 0, timeLeft: 0, scores: [0, 0], matchState: 'waiting', objectives: [], ping: 0, fps: 0, door: -1 });
export const useArena = create<Arena>()((set, get) => ({
  open: false, phase: 'lobby', status: 'idle', error: '', notice: '', me: null, owned: [], loadout: { ...PRESETS[0] }, loadouts: deviceLoadouts(), online: 0,
  match: null, you: null, feed: [], board: {}, result: null, progress: null, record: null,
  sceneReady: false, hud: emptyHud(), menu: false, scoreboard: false, editor: false, settingsOpen: false, hudEditor: false, armory: null, killedBy: null,
  settings: readSettings(),
  set: v => set(v),
  setSettings: v => {
    const settings = parseArenaSettings({ ...get().settings, ...v, ...(v.quality ? { qualityChosen: v.qualityChosen ?? true } : {}) }, get().settings.quality) as ArenaSettings;
    writeJson(SETTINGS_KEY, settings); set({ settings });
    settingsListeners.forEach(l => l(settings));
  },
}));
const settingsListeners = new Set<(s: ArenaSettings) => void>();
/** Called after every settings change (account synchronisation listens). */
export function onSettingsChange(fn: (s: ArenaSettings) => void) { settingsListeners.add(fn); return () => { settingsListeners.delete(fn); }; }
/** Paused for input: menus, the loadout editor, settings, the HUD editor or the Armory are open. */
export const inputPaused = (a: { menu: boolean; editor: boolean; settingsOpen: boolean; hudEditor: boolean; armory: string | null }) => a.menu || a.editor || a.settingsOpen || a.hudEditor || a.armory !== null;

/** Transient centre-screen messages (announcements and medals), outside React state churn. */
export type Banner = { id: number; text: string; sub?: string; tone: 'info' | 'good' | 'bad' | 'medal' | 'big'; at: number; ms: number };
let bannerId = 0;
export const useBanners = create<{ list: Banner[]; push: (b: Omit<Banner, 'id' | 'at'>) => void }>()((set, get) => ({
  list: [],
  push: b => { const item = { ...b, id: ++bannerId, at: performance.now() }; set({ list: [...get().list.filter(x => performance.now() - x.at < x.ms).slice(-4), item] }); setTimeout(() => set({ list: get().list.filter(x => x.id !== item.id) }), b.ms); },
}));

/**
 * Moment-to-moment combat feedback, outside the main store so a burst of eliminations re-renders only these
 * views: the card for the player you just eliminated, the experience popup beside the crosshair (with the
 * medals that came with it), the count of eliminations this life, lead changes, and unlocks reached mid-match.
 */
export type ElimCard = { id: number; num: number; name: string; level: number; emblem: string; bot: boolean; head: boolean; at: number };
export type ScorePop = { id: number; xp: number; tags: string[]; kill: boolean; at: number };
export type LeadCall = { id: number; kind: 'taken' | 'back' | 'lost'; at: number };
export type UnlockToast = { id: number; title: string; sub: string; colors?: string[]; glyph?: string; at: number };
let feedbackId = 0;
const POP_MERGE_MS = 1800, POP_MS = 2300, CARD_MS = 2600, COUNT_MS = 2400, LEAD_MS = 3200, UNLOCK_MS = 3600;
/** How long feedback stays, as a multiple (QA captures under software rendering hold it; see net.ts hooks). */
export const feedbackTiming = { scale: 1 };
export const useFeedback = create<{
  card: ElimCard | null; pop: ScorePop | null; count: { id: number; n: number } | null; lead: LeadCall | null; unlocks: UnlockToast[];
  eliminated: (c: Omit<ElimCard, 'id' | 'at'>) => void; score: (xp: number, tags: string[], kill?: boolean) => void; counted: (n: number) => void;
  leadChanged: (kind: LeadCall['kind']) => void; unlocked: (u: Omit<UnlockToast, 'id' | 'at'>) => void; clear: () => void;
}>()((set, get) => {
  const expire = <K extends 'card' | 'pop' | 'count' | 'lead'>(key: K, id: number, ms: number) => setTimeout(() => { if ((get()[key] as { id: number } | null)?.id === id) set({ [key]: null } as never); }, ms * feedbackTiming.scale);
  return {
    card: null, pop: null, count: null, lead: null, unlocks: [],
    eliminated: c => { const card = { ...c, id: ++feedbackId, at: performance.now() }; set({ card }); expire('card', card.id, CARD_MS); },
    // Experience arriving close together adds up in one popup (an elimination, then its assist, then a capture).
    score: (xp, tags, kill = false) => {
      const now = performance.now(), cur = get().pop;
      const pop = cur && now - cur.at < POP_MERGE_MS ? { ...cur, xp: cur.xp + xp, tags: [...cur.tags, ...tags.filter(t => !cur.tags.includes(t))].slice(-4), kill: cur.kill || kill, at: now } : { id: ++feedbackId, xp, tags: tags.slice(0, 4), kill, at: now };
      set({ pop }); setTimeout(() => { const p = get().pop; if (p && p.id === pop.id && performance.now() - p.at >= POP_MS * feedbackTiming.scale - 20) set({ pop: null }); }, POP_MS * feedbackTiming.scale);
    },
    counted: n => { const count = { id: ++feedbackId, n }; set({ count }); expire('count', count.id, COUNT_MS); },
    leadChanged: kind => { const lead = { id: ++feedbackId, kind, at: performance.now() }; set({ lead }); expire('lead', lead.id, LEAD_MS); },
    unlocked: u => {
      const item = { ...u, id: ++feedbackId, at: performance.now() };
      set({ unlocks: [...get().unlocks.slice(-2), item] });
      setTimeout(() => set({ unlocks: get().unlocks.filter(x => x.id !== item.id) }), UNLOCK_MS * feedbackTiming.scale);
    },
    clear: () => set({ card: null, pop: null, count: null, lead: null, unlocks: [] }),
  };
});
