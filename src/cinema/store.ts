import { create } from 'zustand';

export type Line = { speaker: string; text: string };
export type CinemaState = {
  /** The sequence playing (null when none). */
  active: string | null;
  blocking: boolean; skippable: boolean;
  title: string | null; subtitle: Line | null;
  /** Lines whose voice a cinematic already played (the dialogue panel then does not replay them). */
  voiced: string[];
  /** Sequences already seen this session. */
  seen: string[];
  log: { id: string; at: number; event: 'start' | 'shot' | 'end' | 'skip'; detail?: string }[];
};
export const useCinema = create<CinemaState>(() => ({ active: null, blocking: false, skippable: true, title: null, subtitle: null, voiced: [], seen: [], log: [] }));
export const cinemaLog = (id: string, event: CinemaState['log'][number]['event'], detail?: string) =>
  useCinema.setState(s => ({ log: [...s.log.slice(-80), { id, at: Math.round(performance.now()), event, detail }] }));
