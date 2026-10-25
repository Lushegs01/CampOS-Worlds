import { useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Compass, ExternalLink, MapPin, MessageCircle } from 'lucide-react';
import { LOCATIONS, TOUR, TREES } from '../../shared/campus.mjs';
import { LIBRARY_COMPUTERS } from '../../shared/interactions.mjs';
import { LAB_STATIONS } from '../../shared/economic-lab.mjs';
import { DORM_CAPACITY, DORM_DOOR, DORM_INVITE_MS } from '../../shared/dorm.mjs';
import { BUILDING_BY_ID } from '../../shared/buildings.mjs';
import { NPCS } from '../../shared/npcs.mjs';
import { useGame } from '../state';
import { BOOKS, Catalogue, Counter, FixturePanel, MenuBoard } from '../ui/Interaction';
import { DuelModes } from '../ui/Duel';
import { openEvents } from '../ui/Community';
import { Failure, Loading, useLoad } from '../ui/async';
import { communityConfigured, getCommunityService } from '../services/community';
import { services, serviceAdapter } from '../config/services';
import { useAccount } from '../account/store';
import { selfConnection } from '../network/client';
import { buildingStatus, npcDef, npcEligibility, npcState, useNpcs } from './client';

// What you can ask each campus character. Deterministic, local dialogue: no AI service, no records. A topic
// is a short answer, optionally a working part of the game (`widget`) and places to go (`go`: a map location
// id or "pt:x:z:name", shown with the gold marker). A character without topics still greets you.
type Widget = 'order' | 'menu' | 'catalogue' | 'arrivals' | 'events' | 'staff' | 'services' | 'directions' | 'stations' | 'duel' | 'rooms' | 'tour' | 'trees' | 'brief';
interface Topic { id: string; label: string; text?: string[]; widget?: Widget; go?: { to: string; label: string }[] }
const pt = (x: number, z: number, name: string) => `pt:${x}:${z}:${name}`;
const pc = LIBRARY_COMPUTERS[0];
export const TOPICS: Record<string, Topic[]> = {
  teacher: [
    { id: 'studio', label: 'What is Studio D1 for?', text: ['Studio D1 is the School of Design’s open classroom. Students meet here to work through short design briefs together: four paired desks, a whiteboard and room to pin up sketches.', 'Anyone exploring the campus is welcome to take a seat and join in.'] },
    { id: 'brief', label: 'What’s today’s design challenge?', widget: 'brief', text: ['Spend ten minutes watching how people use one place, sketch one small change, then test it with a friend. The Confluence is a good place to watch: paths cross there all day.'], go: [{ to: 'landmark', label: 'Show me The Confluence' }] },
    { id: 'session', label: 'Can we run a session together?', text: ['Yes. Sit at a desk and use the class prompt: one person hosts a short demonstration lesson, seated classmates vote in the poll, and the host moves through three slides.', 'It is practice only. No attendance, grades or credit are recorded.'] },
    { id: 'learn', label: 'Where can I learn more?', text: ['The Adunni Learning Commons has a quiet reading room and two catalogue computers. Horizon Auditorium runs a self-guided mini lecture on designing shared spaces.'], go: [{ to: 'library', label: 'Show me the Learning Commons' }, { to: 'lecture', label: 'Show me Horizon Auditorium' }] },
  ],
  vendor: [
    { id: 'order', label: 'I’d like to order', widget: 'order' },
    { id: 'menu', label: 'What’s on the menu?', widget: 'menu' },
    { id: 'seat', label: 'Where can I sit?', text: ['Two tables by the window in here, and eight more on the terrace under the umbrellas. Seats are first come, first served: walk up to a chair and press E.'] },
  ],
  librarian: [
    { id: 'find', label: 'Find a book or subject', widget: 'catalogue', text: ['Search by title, author or subject. These titles are a small fictional collection made for this campus, not a real library’s holdings, and a hold is a demonstration: nothing is reserved or recorded.'] },
    { id: 'computers', label: 'How do the catalogue computers work?', text: ['There are two catalogue computers against the west wall, past the reading tables. Walk up to one and press E (or tap Interact) to sit down; the catalogue opens by itself. Move to stand up again.'], go: [{ to: pt(pc.x + 1.02, (pc.z + LIBRARY_COMPUTERS[1].z) / 2, 'Catalogue computers'), label: 'Show me the computers' }] },
    { id: 'arrivals', label: 'What’s on the New Arrivals display?', widget: 'arrivals', text: ['The sloped stand by the north wall holds this month’s new titles. Walk up to it and press E to browse the covers.'], go: [{ to: pt(-30, -22.2, 'New Arrivals'), label: 'Show me the display' }] },
    { id: 'around', label: 'Help me find my way around', text: ['The reading tables are in the middle of the room: four tables, twenty-four chairs. Shelving bays line both side walls. The New Arrivals stand is by the north wall, the catalogue computers on the west wall, and this issue desk by the entrance.', 'The staff room at the back is for staff only and stays locked.'], go: [{ to: pt(-30, -15, 'Reading tables'), label: 'Show me the reading tables' }] },
    { id: 'facilities', label: 'What facilities are here?', text: ['Quiet reading tables with lamps, two catalogue computers, the New Arrivals display and shelving bays. The sign by the entrance says 8:00–22:00; in this world the doors are open to explorers at any hour.', 'There is no borrowing account here: nothing is checked out and no records are kept.'] },
  ],
  'services-officer': [
    { id: 'services', label: 'What can CampOS Connect do?', widget: 'services', text: ['CampOS Connect is where a campus’s real services are reached. Here each one explains what it is for. No institutional account is connected and no records are shown.'] },
    { id: 'directions', label: 'Give me directions', widget: 'directions' },
    { id: 'staff', label: 'Who’s working on campus today?', widget: 'staff' },
    { id: 'who', label: 'Are you a university administrator?', text: ['No. I’m a scripted guide character in this demo world. I can’t see or change enrolments, fees, results or accounts, and nothing you ask me is recorded.'] },
  ],
  'event-host': [
    { id: 'whatson', label: 'What’s on?', widget: 'events' },
    { id: 'find', label: 'How do I find events?', text: ['Press V, or Events in the dock, for the events and clubs board. The noticeboard on the avenue shows this week’s posters.', 'Every event happens at a place on campus: go there while it’s on to check in. Check-in is gameplay attendance only, never academic.'], go: [{ to: 'notice', label: 'Show me the noticeboard' }] },
    { id: 'talks', label: 'What happens at the auditorium?', text: ['Horizon Auditorium hosts talks. Its self-guided mini lecture, “Small ideas. Better campuses.”, is open any time: press E at the auditorium marker on the forecourt.'] },
  ],
  coach: [
    { id: 'shoot', label: 'How do I shoot?', text: ['Grab a ball from the rack by the gate (E). Face a hoop, then hold Space, or the Shoot button, and let go when the needle crosses the gold band.', 'The gold band is worked out with the same physics the room uses, so it really is where your shot goes in from that spot. Beyond the arc, 6.75 m out, a basket is worth three.'], go: [{ to: pt(34.2, 24, 'Ball rack'), label: 'Show me the ball rack' }] },
    { id: 'round', label: 'What’s a round of five?', text: ['Five shots make a round. The scoreboard keeps your dots, the total and your best. Six points or more in a round earns the Courtside badge.'] },
    { id: 'duel', label: 'Tell me about Court Duel', widget: 'duel', text: ['Court Duel is one on one for 60 seconds on this court: challenge another player who is here. The room’s physics scores every shot; I can’t change a score, and neither can anyone else.'] },
    { id: 'rules', label: 'Court rules', text: ['One ball each, please. If a ball leaves the court, use Retrieve ball; balls left lying around roll back to the rack by themselves. And be kind to beginners.'] },
  ],
  'residence-assistant': [
    { id: 'rooms', label: 'How do personal rooms work?', widget: 'rooms', text: ['Every resident has their own room in the wing behind this common room. Go to the residents’ door at the back and press E to go in. Signed-in players keep their arrangement on their account; guests keep it for this visit.'], go: [{ to: pt(DORM_DOOR.x, DORM_DOOR.outsideFace + 1.2, 'Residents’ door'), label: 'Show me the residents’ door' }] },
    { id: 'privacy', label: 'Who can come into my room?', text: [`Only you, and the friends you invite. An invitation lasts ${Math.round(DORM_INVITE_MS / 60000)} minutes and a room holds up to ${DORM_CAPACITY} people. Friends can drop in without an invitation only if you allow it in your privacy settings, and anyone either of you has blocked can never visit.`, 'While you’re in your room, players outside it are hidden from you, and you from them.'] },
    { id: 'visit', label: 'How do I visit a friend?', text: ['Ask them to invite you from inside their room. The invitation appears on your screen; accept it to go straight there. You both need to be signed in and friends with each other.', 'I can’t open anyone’s room or let you in.'] },
  ],
  'research-assistant': [
    { id: 'lab', label: 'What is this lab?', text: ['A research space for economic policy experiments: campus logistics, affordable housing and procurement. Everything runs in simulation units with virtual resource packs. No real money, goods or people are involved.'] },
    { id: 'stations', label: 'Show me the stations', widget: 'stations' },
    { id: 'how', label: 'How does an experiment run?', text: ['Start at A, Simulation Control, to set the rules, the starting conditions and a policy. The room runs the model on the server and verifies every piece of work independently. D shows what the dispatch agent may and may not do, E the checks and evidence, F comparisons and results you can download.', 'Runs with the same seed and settings give the same answer.'] },
    { id: 'limits', label: 'Can you change the results?', text: ['No. I explain the lab, but I can’t run experiments, change the model or alter any result. Only the stations do that, and the room checks them.'] },
  ],
  'orientation-guide': [
    { id: 'tour', label: 'Start the campus tour', widget: 'tour' },
    { id: 'keepsakes', label: 'What are keepsakes?', text: ['Six golden shapes are tucked around campus. Look near the welcome path, inside the library, beside the café, in front of the auditorium, at the courts, and in the entrance garden. Walk through one to collect it.'] },
    { id: 'controls', label: 'How do I get around?', text: ['W A S D or the left stick to move, drag (or the right side of the screen) to look, Shift to run, Space to jump and E (Interact) for whatever is in front of you. M opens the map, C the chat, V events and F friends.'] },
    { id: 'directions', label: 'Where is everything?', widget: 'directions' },
  ],
  groundskeeper: [
    { id: 'trees', label: 'What trees grow here?', widget: 'trees' },
    { id: 'shade', label: 'Where’s a shady spot?', text: ['Try the benches around The Confluence: the flamboyants and umbrella trees there keep the afternoon sun off. The lawns south of the cross walk are shaded by mango and neem.'], go: [{ to: 'landmark', label: 'Show me The Confluence' }] },
    { id: 'beds', label: 'What are you planting?', text: ['Flower beds in hot, cool and gold colours ring The Confluence and these lawns. Ixora borders line the avenue, and a duranta hedge screens the bus bay. I keep them watered, that’s all; they’re not part of any game.'] },
  ],
};
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
  useNpcs(s => s.revision);
  if (!d) return null;
  const s = npcState(id), others = s?.mode === 'engaged' && !!s.by?.length && s.by[0].id !== (selfConnection() || 'local'), topic = topics.find(t => t.id === open);
  return <div className="npc-dialogue">
    <p className="npc-line"><MessageCircle size={16} aria-hidden /><span>“{d.greeting}”</span></p>
    {others && <p className="note small-text" role="status">{d.name} is helping someone else first, but you can still ask.</p>}
    {topics.length > 0 && <div className="npc-topics" role="group" aria-label={`Ask ${d.name}`}>{topics.map(t => <button key={t.id} className={open === t.id ? 'selected' : ''} aria-pressed={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>{t.label}</button>)}</div>}
    {topic && <section className="npc-answer" aria-live="polite">
      {topic.text?.map((p, i) => <p key={i}>{p}</p>)}
      {topic.widget && WIDGETS[topic.widget]()}
      {topic.go && <div className="npc-actions">{topic.go.map(g => <button key={g.to} className="secondary" onClick={() => guide(g.to, g.label)}><MapPin size={16} />{g.label}</button>)}</div>}
    </section>}
    <p className="muted small-text">{d.name} is a scripted campus character ({d.role.toLowerCase()}), not a player. {LIMITS[id] ?? ''}</p>
  </div>;
}
