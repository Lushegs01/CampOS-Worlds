import { create } from 'zustand';

// Which community screen is showing. The board is a side drawer, not a modal, so players can keep
// walking while they browse; only forms take keyboard focus away from movement.
export type CommunityView =
  | { kind: 'events' } | { kind: 'clubs' }
  | { kind: 'event'; id: string } | { kind: 'club'; id: string }
  | { kind: 'event-form'; club?: string; id?: string } | { kind: 'club-form'; id?: string };
interface CommunityState {
  open: boolean;
  view: CommunityView;
  history: CommunityView[];
  /** Bumped after any change so lists refetch (RSVPs, joins, edits). */
  revision: number;
  show: (view: CommunityView) => void;
  back: () => void;
  toggle: (open?: boolean) => void;
  changed: () => void;
}
export const useCommunity = create<CommunityState>((set, get) => ({
  open: false, view: { kind: 'events' }, history: [], revision: 0,
  show: view => { const { view: current, open } = get(); const top = view.kind === 'events' || view.kind === 'clubs'; set({ open: true, view, history: !open || top ? [] : [...get().history, current] }); },
  back: () => { const h = get().history; if (!h.length) { set({ view: get().view.kind.startsWith('club') ? { kind: 'clubs' } : { kind: 'events' } }); return; } set({ view: h[h.length - 1], history: h.slice(0, -1) }); },
  toggle: open => set({ open: open ?? !get().open }),
  changed: () => set({ revision: get().revision + 1 }),
}));
