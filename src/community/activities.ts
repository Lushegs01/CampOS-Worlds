import { create } from 'zustand';
import { onRoomMessage, send } from '../network/client';
import { useGame } from '../state';
import { useAccount } from '../account/store';
import { getCommunityService, communityConfigured } from '../services/community';
import type { CampusEvent, EventCategory, EventTemplateId } from '../services/types';

// Templates turn a calendar entry into something to do on campus: each names its place, its usual
// length and the in-world activity people should find when they arrive.
export interface EventTemplate { id: EventTemplateId; name: string; category: EventCategory; location: string; hours: number; title: string; description: string; activity: string }
export const EVENT_TEMPLATES: EventTemplate[] = [
  { id: 'basketball-tournament', name: 'Basketball tournament night', category: 'sports', location: 'sports', hours: 2, title: 'Court Duel night',
    description: 'Court Duels at The Courts: 60 seconds, one ball each. Rated results count towards the rankings.',
    activity: 'At The Courts, challenge another player from the basketball panel. Rated duels between signed-in players update the rankings. (Pairings are arranged by the players and organiser; there is no automatic bracket yet.)' },
  { id: 'scavenger-hunt', name: 'Campus scavenger hunt', category: 'social', location: 'orientation', hours: 1, title: 'Keepsake hunt',
    description: 'Meet at the Welcome Pavilion, then find the six golden keepsakes around the courtyard.', activity: 'Six golden keepsakes are hidden around the courtyard. Find them together; each one counts for every player who reaches it.' },
  { id: 'club-meetup', name: 'Club social meet-up', category: 'club', location: 'student', hours: 1, title: 'Club meet-up',
    description: 'Come and say hello. Grab a seat on the café terrace.', activity: 'Gather at the location. Form a party (F) to keep together and use party chat.' },
  { id: 'discovery-challenge', name: 'Cooperative discovery challenge', category: 'social', location: 'landmark', hours: 1, title: 'Discovery challenge',
    description: 'Run the Courtyard Circuit together, then take the shuttle out on the Campus Loop.', activity: 'Start the Courtyard Circuit or the Campus Loop from Events → Challenges. Times are kept on your profile.' },
  { id: 'campus-festival', name: 'Campus festival or gathering', category: 'social', location: 'landmark', hours: 3, title: 'Campus gathering',
    description: 'A get-together at The Confluence. Everyone welcome.', activity: 'Meet at The Confluence. Wave (1), dance (2) or cheer (3) together.' },
  { id: 'study-group', name: 'Study-group session', category: 'academic', location: 'library', hours: 2, title: 'Study group',
    description: 'Quiet study at the Learning Commons tables.', activity: 'Sit together at the library tables, or host a class session in Studio D1 or a lecture hall.' },
];
export const templateById = (id?: string | null) => EVENT_TEMPLATES.find(t => t.id === id) ?? null;

/** Is an event open for in-game check-in now (15 minutes before the start until the end)? */
export const checkInOpen = (e: Pick<CampusEvent, 'status' | 'starts_at' | 'ends_at'>, now = Date.now()) => e.status === 'published' && now >= new Date(e.starts_at).getTime() - 15 * 60000 && now < new Date(e.ends_at).getTime();

let waiting: ((r: { ok: boolean; reason?: string; fresh?: boolean }) => void) | null = null;
/** Ask the room to record in-game attendance; it checks you are at the event's place. */
export function checkIn(event: CampusEvent): Promise<{ ok: boolean; reason?: string; fresh?: boolean }> {
  if (useGame.getState().status !== 'connected') return Promise.resolve({ ok: false, reason: 'Check-in needs the shared room. Reconnect from Settings.' });
  return new Promise(resolve => {
    waiting?.({ ok: false, reason: 'Replaced by a newer request.' }); waiting = resolve;
    send({ type: 'checkin', event: event.id, location: event.location.id });
    setTimeout(() => { if (waiting === resolve) { waiting = null; resolve({ ok: false, reason: 'The room did not respond. Try again.' }); } }, 8000);
  });
}

// ---------------------------------------------------------------- reminders
const PREF = 'campos-event-reminders';
export const useReminders = create<{ on: boolean }>(() => ({ on: (() => { try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; } })() }));
export function setReminders(on: boolean) { useReminders.setState({ on }); try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* storage unavailable */ } }
const reminded = new Set<string>();

/** Remind signed-in players once, 15 minutes before an event they RSVPed to (while they're on campus). */
async function remind() {
  const a = useAccount.getState();
  if (!communityConfigured || !useReminders.getState().on || a.status !== 'signed-in' || !a.profile || useGame.getState().phase !== 'playing' || document.hidden) return;
  try {
    const soon = await (await getCommunityService()).listEvents({ when: 'upcoming', going: true, to: new Date(Date.now() + 15 * 60000).toISOString(), limit: 5 });
    for (const e of soon) if (!reminded.has(e.id) && e.status === 'published') {
      reminded.add(e.id);
      const live = new Date(e.starts_at).getTime() <= Date.now();
      useGame.getState().notify(`${live ? 'Happening now' : 'Starting soon'}: ${e.title} at ${e.location.name}. Open Events (V) to find it and check in.`);
    }
  } catch { /* try again next time */ }
}
let started = false;
export function initActivities() {
  if (started) return; started = true;
  onRoomMessage(m => { if (m.type === 'checkinResult' && waiting) { const w = waiting; waiting = null; w({ ok: !!m.ok, reason: m.reason, fresh: m.fresh }); } });
  setInterval(() => void remind(), 2 * 60000);
  setTimeout(() => void remind(), 20000);
}
