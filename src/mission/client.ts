import { create } from 'zustand';
import { CONTACT, PACKAGE, SAFEHOUSE, O, distance } from '../../shared/getaway.mjs';
import { WEAPON_BY_ID } from '../../shared/arena/weapons.mjs';
import { input, player, useGame } from '../state';
import { onRoomMessage } from '../network/messages';
import { send } from '../network/client';
import { registerCandidates } from '../interaction/controller';
import { receiveMissionVehicles, useVehicle, type Vehicle } from '../vehicles/client';
import { portraitBlocked } from '../mobile/orientation';

export type Point = { x: number; z: number };
export type MissionCar = Vehicle & { condition: number; police?: boolean; mode?: string; siren?: boolean; traffic?: boolean; livery?: string };
export type Officer = Point & { id: string; side: number; yaw: number; mode: 'dismount' | 'deploy' | 'cover' | 'aim' | 'fire' | 'board' | 'seated' | 'search' | 'arrest' | 'down'; seat: Point; age: number; hp: number; weapon?: string };
export type Civilian = Point & { id: string; model: string; yaw: number; mode: string; speed: number };
export type PoliceState = { level: string; contained: boolean; surrender: boolean; searching: boolean; lastKnown: (Point & { r: number }) | null };
export type Actor = Point & { id: string; kind: 'guard' | 'operative'; yaw: number; hp: number; maxHp: number; mode: string };
export type MissionEvent = Point & { id: number; y: number; kind: string; end?: [number, number, number]; weapon?: string; impact?: boolean; normal?: [number, number, number]; surface?: 'metal' | 'wood' | 'concrete' | 'actor'; stage?: number };
export type Report = { duration: number; defeated: number; distance: number; topSpeed: number; crashes: number; blastKills: number };
type Receipt = { report: Report; xp: number; credits: number; chapter: number; milestone: string; unlock: string; completedAt: string };
export type Mission = {
  stage: number; checkpoint: number; paused: boolean; failed: string | null; health: number;
  carried: boolean; ambushed: boolean; exploded: boolean; wanted: number; spotted: boolean;
  closest: number | null; escape: number; gun: { id: string; mag: number; reserve: number };
  slot: number; reloading: number; mark: Point | null; actors: Actor[]; officers?: Officer[]; civilians?: Civilian[]; police?: PoliceState; vehicles: MissionCar[];
  events: MissionEvent[]; report: Report | null; reward: { saved: boolean; first?: boolean; completion?: Receipt } | null; saveError: boolean;
};
type State = { mission: Mission | null; history: Receipt | null; resume: number | null; brief: boolean; journal: boolean; aim: boolean };
export const useGetaway = create<State>(() => ({ mission: null, history: null, resume: null, brief: false, journal: false, aim: false }));
export const command = (action: string, data = {}) => send({ type: 'getaway', action, ...data });
/** Weapons out: in the freight yard during the operation, and on foot in the city while the police are after you. */
export const activeCombat = (m = useGetaway.getState().mission) => !!m && (m.stage === O.combat || m.stage === O.package || m.stage === O.ambush || m.stage >= O.vehicle && m.stage <= O.deliver && m.wanted > 0);
const getWeapon = () => WEAPON_BY_ID.get(useGetaway.getState().mission?.gun.id ?? '');
export const combatView = { blend: 0 };
export const shotInput = { held: false, next: 0, started: 0, kick: 0, recoilAt: -Infinity };
const events = new Set<(event: MissionEvent) => void>();
export function onMissionEvent(fn: (event: MissionEvent) => void) { events.add(fn); return () => { events.delete(fn); }; }
export function resetMissionControls() {
  shotInput.held = false; useGetaway.setState({ aim: false });
}
const canFire = () => activeCombat() && !useVehicle.getState().id && !isMissionOverlay() && !useGame.getState().panel && !document.hidden && !portraitBlocked();
export function setAim(aim: boolean) {
  if (aim && !canFire()) return;
  if (aim !== useGetaway.getState().aim && (useGetaway.getState().mission?.wanted ?? 0) > 0) command('aim', { on: aim });
  useGetaway.setState({ aim });
}
/** Give up to the police (on foot, or in a stopped car). */
export function surrender() { if ((useGetaway.getState().mission?.wanted ?? 0) > 0) command('surrender'); }
export function fire(fromPress = false) {
  const w = getWeapon();
  if (!w || !canFire()) return;
  const m = useGetaway.getState().mission!;
  const now = performance.now();
  if ((w.fire !== 'auto' && !fromPress) || (m.reloading && (w.reloadMode !== 'shell' || !m.gun.mag)) || now < shotInput.next) return;
  if (!m.gun.mag) { command('reload'); shotInput.next = now + 400; return; }
  const aim = useGetaway.getState().aim;
  if (command('fire', { yaw: input.yaw + Math.PI, pitch: -input.pitch, aim })) {
    shotInput.next = now + 60000 / (w.rpm ?? 300) - 6;
    shotInput.started = now;
  }
}
export function heldFire(held: boolean) { shotInput.held = held; if (held) fire(true); }
export function equip(slot?: number) {
  const m = useGetaway.getState().mission;
  if (m && canFire()) command('equip', { slot: slot ?? (m.slot + 1) % 3 });
}
export function isMissionOverlay() {
  const s = useGetaway.getState(), m = s.mission;
  return s.brief || s.journal || !!(m?.paused || m?.failed || m && m.stage >= O.commit);
}
export function openMissionJournal(open = true) {
  document.exitPointerLock?.();
  resetMissionControls();
  useGetaway.setState({ journal: open });
  if (open) {
    const m = useGetaway.getState().mission;
    if (!m) command('status');
    else if (!m.paused && !m.failed && m.stage < O.commit) command('pause');
  } else if (useGetaway.getState().mission?.paused) command('pause');
}
export function initMission() {
  const unregister = registerCandidates(rank => {
    const s = useGetaway.getState(), m = s.mission;
    if (useGame.getState().status !== 'connected' || isMissionOverlay()) return [];
    const offer = !m ? { action: 'brief', label: 'Talk to Sade', at: CONTACT, range: 3 }
      : m.stage === O.package ? { action: 'pickup', label: 'Secure the case', at: PACKAGE, range: 2.4 }
      : m.stage === O.deliver ? { action: 'deliver', label: 'Hand the case to Sade', at: SAFEHOUSE, range: 2.4 } : null;
    if (offer && distance(player, offer.at) < offer.range) return [{
      id: 'getaway-' + offer.action, kind: 'point', label: offer.label, key: 'E', hint: 'The Getaway',
      score: rank(20, offer.at.x, offer.at.z), run: () => { document.exitPointerLock?.(); command(offer.action); },
    }];
    return [];
  });
  const unsubscribe = onRoomMessage(msg => {
    if (msg.type === 'welcome') command('status');
    if (msg.type === 'disconnected') {
      receiveMissionVehicles([]); resetMissionControls();
      useGetaway.setState({ mission: null, history: null, resume: null, journal: false, brief: false });
    }
    if (msg.type !== 'getaway') return;
    if (msg.reason) useGame.getState().notify(msg.reason);
    const prev = useGetaway.getState().mission;
    const update: Partial<State> = {};
    if ('mission' in msg) {
      const m = msg.mission as Mission | null;
      update.mission = m;
      receiveMissionVehicles(m?.vehicles ?? [], msg.at);
      if (!activeCombat(m)) resetMissionControls();
      if (m?.paused || m?.failed || m && m.stage >= O.commit) document.exitPointerLock?.();
      if (!m) update.journal = false;
      for (const e of m?.events ?? []) {
        if (e.kind === 'shot') {
          shotInput.recoilAt = performance.now();
          shotInput.kick = (WEAPON_BY_ID.get(e.weapon ?? '')?.recoil?.kick ?? .01) * 1.8;
        }
        for (const listener of events) listener(e);
      }
      if (m && prev?.checkpoint !== m.checkpoint && !m.failed) useGame.getState().notify('Checkpoint saved');
    }
    if ('history' in msg) update.history = msg.history;
    if ('resume' in msg) update.resume = msg.resume;
    if ('brief' in msg) update.brief = msg.brief;
    useGetaway.setState(update);
  });
  const key = (e: KeyboardEvent) => {
    if (e.repeat || useGame.getState().phase !== 'playing' || useGame.getState().panel || (e.target as HTMLElement).matches('input,textarea,select')) return;
    if (e.code === 'KeyJ') { e.preventDefault(); openMissionJournal(!useGetaway.getState().journal); }
    if (e.code === 'KeyH' && useGetaway.getState().mission?.police?.contained) { e.preventDefault(); surrender(); }
  };
  window.addEventListener('keydown', key);
  const reset = () => resetMissionControls();
  window.addEventListener('blur', reset); document.addEventListener('visibilitychange', reset);
  return () => { unregister(); unsubscribe(); window.removeEventListener('keydown', key); window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', reset); };
}
