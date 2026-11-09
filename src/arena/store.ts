// Combat Arena interface state. High-frequency values (positions, view angles, ammunition as it
// changes every shot) live outside React in src/arena/net.ts; this store holds what the interface
// shows and is updated only when those values change, at most ~15 times a second.
import { create } from 'zustand';
import { suggestedQuality, type Quality } from '../world/quality';
import { PRESETS } from '../../shared/arena/rules.mjs';

export type Loadout = { name: string; primary: string; secondary: string; lethal: string; tactical: string; perks: string[]; skins?: Record<string, string> };
export type RosterEntry = { num: number; name: string; team: number; verified: boolean; handle: string | null; bot: boolean; connected: boolean; level: number; emblem: string };
export type MatchView = { id: string; mode: string; map: string; kind: 'quick' | 'private' | 'training'; code: string | null; state: string; maxPerTeam: number; scoreLimit: number; timeMs: number; seed: number; scores: number[]; players: RosterEntry[]; objectives: { id: string; x: number; z: number; r: number }[] };
export type FeedEntry = { id: number; killer: number | null; victim: number; weapon: string | null; head: boolean; at: number };
export type ResultRow = { num: number; name: string; team: number; bot: boolean; account: string | null; result: 'win' | 'loss' | 'draw'; completed: boolean; kills: number; deaths: number; assists: number; headshots: number; captures: number; neutralizes: number; defends: number; score: number; damage: number; bestStreak: number; xp: number };
export type MatchResult = { id: string; mode: string; map: string; kind: string; winner: number | null; outcome: string; scores: number[]; startedAt: number; endedAt: number; players: ResultRow[] };
export type Progress = { xp: number; total_xp: number; level_before: number; level: number; unlocked: string[]; weapon_levels: { weapon: string; before: number; level: number }[] };
export type Phase = 'lobby' | 'match' | 'results';

export interface ArenaSettings { mouse: number; ads: number; touch: number; pad: number; invertY: boolean; fov: number; quality: Quality; showFps: boolean; autoSprint: boolean }
const SETTINGS_KEY = 'campos-arena-settings', LOADOUT_KEY = 'campos-arena-loadouts';
const defaults = (): ArenaSettings => ({ mouse: 1, ads: .8, touch: 1, pad: 1, invertY: false, fov: 78, quality: suggestedQuality(), showFps: false, autoSprint: true });
function readJson<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; } }
function writeJson(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage denied */ } }
/** Guests keep their loadouts on this device; signed-in players' are saved to their account. */
export function deviceLoadouts(): Loadout[] { try { const v = JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? 'null'); return Array.isArray(v) ? v.slice(0, 5) : PRESETS.map(p => ({ ...p })); } catch { return PRESETS.map(p => ({ ...p })); } }
export function saveDeviceLoadouts(list: Loadout[]) { writeJson(LOADOUT_KEY, list.slice(0, 5)); }

export interface Hud {
  hp: number; alive: boolean; respawnMs: number; weapon: string; slot: number; mag: number; reserve: number; magSize: number; phase: string; reloadProgress: number;
  ads: number; lethal: number; tactical: number; spread: number; earned: string[]; streakPts: number; streak: number; sprint: boolean; stance: number;
  timeLeft: number; scores: number[]; matchState: string; objectives: [number, number, number, number][]; ping: number; fps: number;
}
interface Arena {
  open: boolean; phase: Phase; status: 'idle' | 'connecting' | 'ready' | 'offline' | 'replaced'; error: string;
  me: { name: string; verified: boolean; handle: string | null; level: number; xp: number; emblem: string; weaponLevels: Record<string, number> } | null;
  loadout: Loadout; loadouts: Loadout[]; online: number;
  match: MatchView | null; you: { num: number; team: number; key: string } | null; feed: FeedEntry[];
  /** Live scoreboard: num → [kills, deaths, assists, score, objective]. */
  board: Record<number, number[]>;
  result: MatchResult | null; progress: Progress | null; record: { state: string; reason: string | null } | null;
  hud: Hud; menu: boolean; scoreboard: boolean; editor: boolean; settingsOpen: boolean;
  killedBy: { num: number | null; weapon: string | null } | null;
  settings: ArenaSettings;
  set: (v: Partial<Arena>) => void;
  setSettings: (v: Partial<ArenaSettings>) => void;
}
export const emptyHud = (): Hud => ({ hp: 100, alive: false, respawnMs: 0, weapon: 'vanguard', slot: 0, mag: 0, reserve: 0, magSize: 0, phase: 'ready', reloadProgress: 0, ads: 0, lethal: 0, tactical: 0, spread: 0,
  earned: [], streakPts: 0, streak: 0, sprint: false, stance: 0, timeLeft: 0, scores: [0, 0], matchState: 'waiting', objectives: [], ping: 0, fps: 0 });
export const useArena = create<Arena>()((set, get) => ({
  open: false, phase: 'lobby', status: 'idle', error: '', me: null, loadout: { ...PRESETS[0] }, loadouts: deviceLoadouts(), online: 0,
  match: null, you: null, feed: [], board: {}, result: null, progress: null, record: null,
  hud: emptyHud(), menu: false, scoreboard: false, editor: false, settingsOpen: false, killedBy: null,
  settings: readJson(SETTINGS_KEY, defaults()),
  set: v => set(v),
  setSettings: v => { const settings = { ...get().settings, ...v }; writeJson(SETTINGS_KEY, settings); set({ settings }); },
}));

/** Transient centre-screen messages (announcements and medals), outside React state churn. */
export type Banner = { id: number; text: string; sub?: string; tone: 'info' | 'good' | 'bad' | 'medal' | 'big'; at: number; ms: number };
let bannerId = 0;
export const useBanners = create<{ list: Banner[]; push: (b: Omit<Banner, 'id' | 'at'>) => void }>()((set, get) => ({
  list: [],
  push: b => { const item = { ...b, id: ++bannerId, at: performance.now() }; set({ list: [...get().list.filter(x => performance.now() - x.at < x.ms).slice(-4), item] }); setTimeout(() => set({ list: get().list.filter(x => x.id !== item.id) }), b.ms); },
}));
