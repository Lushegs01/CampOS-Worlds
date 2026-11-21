import { useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Compass, ExternalLink, MapPin, MessageCircle } from 'lucide-react';
import { LOCATIONS, TOUR, TREES } from '../../shared/campus.mjs';
import { LAB_STATIONS } from '../../shared/economic-lab.mjs';
import { BUILDING_BY_ID } from '../../shared/buildings.mjs';
import { NPCS } from '../../shared/npcs.mjs';
import { useGame } from '../state';
import { SpokenLine } from '../audio/SpokenLine';
import { BOOKS, Catalogue, Counter, FixturePanel, MenuBoard } from '../ui/Interaction';
import { DuelModes } from '../ui/Duel';
import { openEvents } from '../ui/Community';
import { Failure, Loading, useLoad } from '../ui/async';
import { communityConfigured, getCommunityService } from '../services/community';
import { services, serviceAdapter } from '../config/services';
import { useAccount } from '../account/store';
import { selfConnection } from '../network/client';
import { TOPICS, pt, topicLines, type Widget } from './topics';
import { buildingStatus, npcDef, npcEligibility, npcState, useNpcs } from './client';

/** What each character is not, said plainly under every conversation. */
const LIMITS: Record<string, string> = {
  teacher: 'She doesn’t mark work, take attendance or keep records.', vendor: 'Demo orders only: nothing is charged, no payment details are requested and no transaction is recorded.',
  librarian: 'The catalogue is fictional; there is no library account behind it.', 'services-officer': 'Not an administrator: no institutional records are connected.',
  'event-host': 'Only events that clubs have really posted are shown.', coach: 'Scores come from the room’s physics, never from a conversation.',
  'residence-assistant': 'Can’t open rooms or override anyone’s privacy settings.', 'research-assistant': 'Can’t change the simulation, its state or its results.',
};

function guide(to: string, label: string) {
  const g = useGame.getState(), name = to.startsWith('pt:') ? to.split(':').slice(3).join(':') : LOCATIONS.find(l => l.id === to)?.name ?? label;
  g.set({ destination: to, panel: null }); g.notify(`Follow the gold marker to ${name}.`);
}

function Events() {
  const list = useLoad(async () => (communityConfigured ? (await getCommunityService()).listEvents({ when: 'upcoming', limit: 5 }) : null), []);
  if (!communityConfigured) return <p className="note">Events are posted by student clubs through accounts, and accounts aren’t set up on this deployment, so there are no events to list. The noticeboard shows the sample programme.</p>;
  if (list.loading) return <Loading label="Checking the events board…" />;
  if (list.error) return <Failure message={list.error} retry={list.reload} />;
  if (!list.data?.length) return <div className="empty-state"><CalendarDays size={24} /><p>No upcoming events are posted right now.</p><small>Clubs post events on the board; check back later, or start a club yourself.</small></div>;
  return <div className="list-cards">{list.data.map(e => <button key={e.id} onClick={() => { useGame.getState().set({ panel: null }); openEvents(); }}><CalendarDays size={20} /><span><b>{e.title}</b><small>{new Date(e.starts_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {e.location.name}{e.status === 'canceled' ? ' · Canceled' : ''}</small></span><ArrowRight size={16} /></button>)}</div>;
}
function Services() {
  const [message, setMessage] = useState('');
  return <><div className="list-cards">{services.map(s => <button key={s.id} onClick={async () => { const r = await serviceAdapter.launch(s.id); if (r.kind === 'demo') setMessage(r.message); }}><span className="service-mark">{s.name.slice(0, 1)}</span><span><b>{s.name}</b><small>{s.category}</small></span><ExternalLink size={16} /></button>)}</div>{message && <p className="note" role="status">{message}</p>}</>;
}
/** Who is working where, straight from the building configuration: never a guess. */
function Staff() {
  useNpcs(s => s.revision);
  return <div className="list-cards">{NPCS.map(d => { const e = npcEligibility(d.id), b = BUILDING_BY_ID.get(d.building)!, live = buildingStatus(d.building);
    return <div key={d.id} className="npc-staff"><span className={`status-dot${e.ok ? ' on' : ''}`} aria-hidden /><span><b>{d.name} · {d.role}</b><small>{e.ok ? `On duty at ${b.name}` : e.reason}{live ? ` · building ${Math.round(live.completion)}% complete` : ''}</small></span></div>; })}</div>;
}
const CAMPUS_PLACES = LOCATIONS.filter(l => Math.abs(l.x) < 75 && Math.abs(l.z) < 70);
function Directions() {
  return <div className="list-cards">{CAMPUS_PLACES.map(l => <button key={l.id} onClick={() => guide(l.id, l.name)}><MapPin size={18} /><span><b>{l.name}</b><small>{l.type}</small></span><ArrowRight size={16} /></button>)}</div>;
}
function Rooms() {
  const signedIn = useAccount(a => a.status === 'signed-in' && !!a.profile), connected = useGame(s => s.status === 'connected');
  return <p className="note small-text">{!connected ? 'Rooms open while you’re connected to the campus.' : signedIn ? 'You’re signed in: your room and its arrangement are kept on your account.' : 'You’re exploring as a guest: your room lasts for this visit. Sign in to keep it and to invite friends.'}</p>;
}
function Tour() {
  const s = useGame();
  return <><p>Five stops, about five minutes: this pavilion, The Confluence, the Learning Commons, The Student House and Horizon Auditorium. Follow the gold marker and press E when you arrive.</p>
    <button className="primary" onClick={() => { s.set({ tour: true, tourStep: 1, destination: TOUR[1], panel: null }); s.notify('Tour started. Find The Confluence in the central courtyard.'); }}><Compass size={18} />{s.tour ? 'Restart the campus tour' : 'Let’s go'}<ArrowRight size={18} /></button></>;
}
const SPECIES: Record<string, string> = { royal: 'Royal palms line the avenue from the gate', coconut: 'Coconut palms around the courts, the café and the gardens', terminalia: 'Terminalia, the tiered “umbrella” trees', flamboyant: 'Flamboyants, red with flowers in the dry season', mango: 'Mango trees on the lawns', neem: 'Neem, for shade near the library and the north walk' };
function Trees() {
  const counts = TREES.reduce<Record<string, number>>((n, t) => { n[t.species] = (n[t.species] ?? 0) + 1; return n; }, {});
  return <div className="list-cards">{Object.entries(SPECIES).map(([k, text]) => <div key={k} className="npc-staff"><span className="club-mark">{counts[k] ?? 0}</span><span><b>{text}</b></span></div>)}</div>;
}
const WIDGETS: Record<Widget, () => ReactNode> = {
  order: () => <Counter via="vendor" />, menu: () => <MenuBoard />, catalogue: () => <Catalogue />, brief: () => <FixturePanel id="classroom-board" />,
  arrivals: () => <div className="list-cards">{BOOKS.map(([t, a]) => <div key={t} className="book-card"><BookOpen size={18} /><span><b>{t}</b><small>{a}</small></span></div>)}</div>,
  events: () => <><Events /><button className="secondary" onClick={() => { useGame.getState().set({ panel: null }); openEvents(); }}><CalendarDays size={16} />Open the events board</button></>,
  staff: () => <Staff />, services: () => <Services />, directions: () => <Directions />, rooms: () => <Rooms />, tour: () => <Tour />, trees: () => <Trees />,
  stations: () => <div className="list-cards">{LAB_STATIONS.map(s => <button key={s.id} onClick={() => guide(pt(s.point.x, s.point.z, `Station ${s.letter}, ${s.name}`), s.name)}><span className="club-mark">{s.letter}</span><span><b>{s.name}</b><small>Show me where it is</small></span><MapPin size={16} /></button>)}</div>,
  duel: () => <><DuelModes /><button className="text-button" onClick={() => useGame.getState().set({ panel: 'leaderboard' })}>Rankings and rules →</button></>,
};

export default function NpcDialogue({ id }: { id: string }) {
  const d = npcDef(id), topics = TOPICS[id] ?? [], [open, setOpen] = useState<string | null>(() => { const t = useNpcs.getState().topic; return topics.some(x => x.id === t) ? t : topics.length === 1 ? topics[0].id : null; });
  const [spoken, setSpoken] = useState(() => topics.find(t => t.id === useNpcs.getState().topic && topicLines(id, t).length)?.id ?? 'hello');
  useNpcs(s => s.revision);
  if (!d) return null;
  const s = npcState(id), others = s?.mode === 'engaged' && !!s.by?.length && s.by[0].id !== (selfConnection() || 'local'), topic = topics.find(t => t.id === open);
  return <div className="npc-dialogue">
    <p className="npc-line"><MessageCircle size={16} aria-hidden /><span>“{d.greeting}”</span></p>
    {others && <p className="note small-text" role="status">{d.name} is helping someone else first, but you can still ask.</p>}
    {topics.length > 0 && <div className="npc-topics" role="group" aria-label={`Ask ${d.name}`}>{topics.map(t => <button key={t.id} className={open === t.id ? 'selected' : ''} aria-pressed={open === t.id} onClick={() => {
      const next = open === t.id ? null : t.id;
      setOpen(next);
      setSpoken(next && topicLines(id, t).length ? next : '');
    }}>{t.label}</button>)}</div>}
    {topic && <section className="npc-answer" aria-live="polite">
      {topicLines(id, topic).map((p, i) => <p key={i}>{p}</p>)}
      {topic.widget && WIDGETS[topic.widget]()}
      {topic.go && <div className="npc-actions">{topic.go.map(g => <button key={g.to} className="secondary" onClick={() => guide(g.to, g.label)}><MapPin size={16} />{g.label}</button>)}</div>}
    </section>}
    {spoken && <SpokenLine key={id + spoken} id={`voice/${id}/${spoken}`} speaker={d.name} />}
    <p className="muted small-text">{d.name} is a scripted campus character ({d.role.toLowerCase()}), not a player. {LIMITS[id] ?? ''}</p>
  </div>;
}
