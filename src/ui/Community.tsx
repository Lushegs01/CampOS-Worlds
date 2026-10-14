import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Ban, BookOpen, CalendarDays, CalendarPlus, Camera, ChevronLeft, CircleCheck, Clock, CodeXml, Crown, Globe, Heart, Leaf, MapPin, Megaphone, Music, Navigation, Palette, PencilLine, Plus, Search, Sparkles, Trash2, Users, Volleyball, X, type LucideIcon } from 'lucide-react';
import { LOCATIONS } from '../../shared/campus.mjs';
import { useGame } from '../state';
import { useAccount } from '../account/store';
import { getCommunityService, communityConfigured, toServiceError, NOT_CONFIGURED } from '../services/community';
import { CLUB_CATEGORIES, CLUB_COLORS, CLUB_EMBLEMS, EVENT_CATEGORIES, type CampusEvent, type Club, type ClubCategory, type ClubEmblem, type ClubInput, type EventCategory, type EventInput } from '../services/types';
import { useCommunity, type CommunityView } from '../community/store';
import { Failure, Loading, useAction, useLoad } from './async';
import { EVENT_TEMPLATES, checkIn, checkInOpen, templateById } from '../community/activities';
import { Challenges } from './Challenges';
import { Portrait } from './Account';

// ---------------------------------------------------------------- shared bits
const EMBLEMS: Record<ClubEmblem, LucideIcon> = { spark: Sparkles, book: BookOpen, music: Music, code: CodeXml, ball: Volleyball, leaf: Leaf, camera: Camera, globe: Globe, heart: Heart, palette: Palette };
export function Emblem({ club, size = 36 }: { club: { color: string; emblem: ClubEmblem }; size?: number }) {
  const Icon = EMBLEMS[club.emblem] ?? Sparkles;
  return <span className="emblem" style={{ background: club.color, width: size, height: size }} aria-hidden="true"><Icon size={Math.round(size * .5)} /></span>;
}
const svc = getCommunityService;
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function dayLabel(iso: string) {
  const d = new Date(iso), diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const pad = (n: number) => String(n).padStart(2, '0');
/** ISO timestamp ↔ the local "YYYY-MM-DDTHH:mm" a datetime-local input uses. */
const toLocalInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : '');

function useMember() { return useAccount(s => (s.status === 'signed-in' && s.profile ? 'member' : s.status === 'signed-in' ? 'no-profile' : 'guest')); }
/** Explains what a guest (or profile-less account) needs before joining in. */
function JoinPrompt({ what }: { what: string }) {
  const member = useMember(), set = useGame(s => s.set);
  if (member === 'member') return null;
  return <button className="secondary wide" onClick={() => set({ panel: 'account' })}>{member === 'guest' ? `Sign in to ${what}` : `Finish your profile to ${what}`}<ArrowRight size={15} /></button>;
}

/** Paged list: keeps what is shown while refreshing, appends on “load more”. */
function usePaged<T>(load: (offset: number) => Promise<T[]>, deps: unknown[], size = 20) {
  const [state, setState] = useState<{ items: T[]; loading: boolean; error: string; more: boolean }>({ items: [], loading: true, error: '', more: false });
  const run = useRef(0);
  const fetchPage = useCallback((offset: number) => {
    const id = ++run.current;
    setState(s => ({ ...s, loading: true, error: '' }));
    load(offset).then(rows => { if (id === run.current) setState(s => ({ items: offset ? [...s.items, ...rows] : rows, loading: false, error: '', more: rows.length === size })); },
      e => { if (id === run.current) setState(s => ({ ...s, loading: false, error: toServiceError(e).message })); });
  }, deps);
  useEffect(() => { fetchPage(0); }, [fetchPage]);
  return { ...state, reload: () => fetchPage(0), loadMore: () => fetchPage(state.items.length) };
}

function guideTo(location: { id: string; name: string }) {
  useGame.getState().set({ destination: location.id });
  useGame.getState().notify(`Follow the gold marker to ${location.name}.`);
}
function Confirm({ text, action, onConfirm, onCancel, pending }: { text: string; action: string; onConfirm: () => void; onCancel: () => void; pending: boolean }) {
  return <div className="confirm" role="alertdialog" aria-label={action}><p>{text}</p><div className="form-actions"><button className="secondary" onClick={onCancel}>Keep it</button><button className="danger" disabled={pending} onClick={onConfirm}>{pending ? 'One moment…' : action}</button></div></div>;
}

// ---------------------------------------------------------------- events
function StatusTag({ event }: { event: CampusEvent }) {
  const full = event.capacity !== null && event.attendee_count >= event.capacity, ended = new Date(event.ends_at) <= new Date();
  if (event.status === 'canceled') return <span className="status-tag canceled"><Ban size={11} />Canceled</span>;
  if (event.status === 'draft') return <span className="status-tag draft">Draft</span>;
  if (event.going) return <span className="status-tag going"><CircleCheck size={11} />Going</span>;
  if (ended) return <span className="status-tag">Ended</span>;
  if (full) return <span className="status-tag full">Full</span>;
  return null;
}
function EventCard({ event }: { event: CampusEvent }) {
  const show = useCommunity(s => s.show);
  return <button className={`event-card${event.status === 'canceled' ? ' is-canceled' : ''}`} onClick={() => show({ kind: 'event', id: event.id })}>
    <span className="event-time"><b>{time(event.starts_at)}</b><small>{time(event.ends_at)}</small></span>
    <span className="event-main"><b>{event.title}</b><small><MapPin size={11} />{event.location.name}</small><small className="event-club"><i style={{ background: event.club.color }} />{event.club.name}</small></span>
    <span className="event-meta"><StatusTag event={event} /><small><Users size={11} />{event.attendee_count}{event.capacity !== null ? ` / ${event.capacity}` : ''}</small></span>
  </button>;
}
function EventList({ events }: { events: CampusEvent[] }) {
  const groups: { day: string; items: CampusEvent[] }[] = [];
  for (const e of events) { const day = dayLabel(e.starts_at); const g = groups[groups.length - 1]; if (g?.day === day) g.items.push(e); else groups.push({ day, items: [e] }); }
  return <>{groups.map(g => <section key={g.day} className="event-day"><h4>{g.day}</h4>{g.items.map(e => <EventCard key={e.id} event={e} />)}</section>)}</>;
}

function EventsBoard() {
  const [when, setWhen] = useState<'upcoming' | 'week' | 'past'>('upcoming'), [category, setCategory] = useState<EventCategory | ''>(''), [going, setGoing] = useState(false);
  const revision = useCommunity(s => s.revision), show = useCommunity(s => s.show), member = useMember();
  const list = usePaged(async offset => (await svc()).listEvents({ when: when === 'past' ? 'past' : 'upcoming', category: category || null, to: when === 'week' ? new Date(Date.now() + 7 * 864e5).toISOString() : null, going, limit: 20, offset }), [when, category, going, revision]);
  return <div className="board">
    <div className="board-filters">
      <div className="segments" role="group" aria-label="When">{(['upcoming', 'week', 'past'] as const).map(w => <button key={w} aria-pressed={when === w} className={when === w ? 'selected' : ''} onClick={() => setWhen(w)}>{w === 'week' ? 'Next 7 days' : label(w)}</button>)}</div>
      <div className="filter-row">
        <label className="select"><span className="sr-only">Category</span><select value={category} onChange={e => setCategory(e.target.value as EventCategory | '')}><option value="">All categories</option>{EVENT_CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
        {member === 'member' && <label className="toggle"><input type="checkbox" checked={going} onChange={e => setGoing(e.target.checked)} />Going</label>}
        {member === 'member' && <button className="text-button" onClick={() => show({ kind: 'event-form' })}><CalendarPlus size={15} />New event</button>}
      </div>
    </div>
    {list.error && <Failure message={list.error} retry={list.reload} />}
    {!list.error && list.loading && !list.items.length && <Loading label="Finding events…" />}
    {!list.error && !list.loading && !list.items.length && <div className="empty-state"><CalendarDays size={28} /><p>{when === 'past' ? 'No past events yet.' : going ? 'You haven’t RSVPed to anything coming up.' : 'No upcoming events.'}</p><small>{member === 'member' ? 'Clubs host events here. Start one, or join a club and ask its owner to make you an organizer.' : 'Clubs post their gatherings here.'}</small></div>}
    <EventList events={list.items} />
    {list.more && <button className="secondary wide" disabled={list.loading} onClick={list.loadMore}>{list.loading ? 'Loading…' : 'Show more events'}</button>}
  </div>;
}

function EventView({ id }: { id: string }) {
  const revision = useCommunity(s => s.revision), changed = useCommunity(s => s.changed), show = useCommunity(s => s.show), back = useCommunity(s => s.back), member = useMember(), setGame = useGame(s => s.set);
  const { data: ev, error, loading, reload } = useLoad(async () => (await svc()).event(id), [id, revision]);
  const { pending, error: actionError, act } = useAction(), [confirm, setConfirm] = useState<'' | 'cancel' | 'delete'>('');
  if (loading && !ev) return <Loading label="Loading event…" />;
  if (error && !ev) return <Failure message={error} retry={reload} />;
  if (!ev) return <div className="empty-state"><CalendarDays size={28} /><p>This event is no longer available.</p></div>;
  const ended = new Date(ev.ends_at) <= new Date(), full = ev.capacity !== null && ev.attendee_count >= ev.capacity;
  const run = (fn: () => Promise<unknown>) => void act(async () => { await fn(); changed(); });
  return <article className="event-detail">
    {ev.status === 'canceled' && <p className="banner canceled"><Ban size={15} />This event was canceled{ev.canceled_at ? ` on ${new Date(ev.canceled_at).toLocaleDateString()}` : ''}. RSVPs are closed.</p>}
    {ev.status === 'draft' && <p className="banner draft"><PencilLine size={15} />Draft: only the club’s owner and organizers can see this until it is published.</p>}
    <span className="eyebrow">{ev.category.toUpperCase()} · {ev.club.name.toUpperCase()}</span>
    <h3>{ev.title}</h3>
    <dl className="event-facts">
      <div><dt><Clock size={14} /></dt><dd>{dayLabel(ev.starts_at)}, {time(ev.starts_at)} – {time(ev.ends_at)}<small>{ZONE.replace(/_/g, ' ')} time</small></dd></div>
      <div><dt><MapPin size={14} /></dt><dd>{ev.location.name}<button className="text-button inline" onClick={() => guideTo(ev.location)}><Navigation size={13} />Show me the way</button></dd></div>
      <div><dt><Users size={14} /></dt><dd>{ev.attendee_count} going{ev.capacity !== null ? ` · ${Math.max(0, ev.capacity - ev.attendee_count)} of ${ev.capacity} places left` : ''}{(ev.checked_in_count ?? 0) > 0 && <small>{ev.checked_in_count} checked in on campus</small>}</dd></div>
    </dl>
    {ev.description && <p className="event-description">{ev.description}</p>}
    {templateById(ev.template) && <p className="note small-text activity-hint"><b>{templateById(ev.template)!.name}</b>{templateById(ev.template)!.activity}</p>}
    {checkInOpen(ev) && <div className="checkin">{ev.checked_in ? <p className="banner going"><CircleCheck size={15} />You’re checked in. This is attendance in the game only, not official attendance.</p>
      : member === 'member' ? <><button className="primary wide" disabled={pending} onClick={() => void act(async () => { const r = await checkIn(ev); if (!r.ok) throw new Error(r.reason ?? 'Check-in failed.'); useGame.getState().notify(`Checked in at ${ev.title}.`); changed(); })}><MapPin size={16} />Check in at {ev.location.name}</button><small className="muted">Happening now. Be at {ev.location.name} on campus to check in. In-game attendance only; never academic attendance.</small></>
      : <JoinPrompt what="check in" />}</div>}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {ev.status === 'published' && !ended && (member === 'member'
      ? <button className={ev.going ? 'secondary wide' : 'primary wide'} disabled={pending || (!ev.going && full)} onClick={() => run(async () => { const s = await svc(); return ev.going ? s.cancelRsvp(ev.id) : s.rsvp(ev.id); })}>
          {pending ? 'One moment…' : ev.going ? <><CircleCheck size={16} />You’re going · cancel RSVP</> : full ? 'This event is full' : <>RSVP<ArrowRight size={16} /></>}</button>
      : <JoinPrompt what="RSVP" />)}
    {ended && ev.status !== 'canceled' && <p className="muted small-text">This event has ended{ev.checked_in_count ? `: ${ev.checked_in_count} player${ev.checked_in_count === 1 ? '' : 's'} checked in on campus` : ''}.</p>}
    {!!ev.checked_in_players?.length && <><h4>Checked in on campus</h4><div className="people">{ev.checked_in_players.map(p => <button key={p.id} className="person" onClick={() => setGame({ panel: `player:${p.handle}` })}><Portrait person={p} size={30} /><span>{p.display_name}<small>@{p.handle}</small></span></button>)}</div></>}
    <h4>Going</h4>
    {ev.attendees.length ? <div className="people">{ev.attendees.map(p => <button key={p.id} className="person" onClick={() => setGame({ panel: `player:${p.handle}` })}><Portrait person={p} size={30} /><span>{p.display_name}<small>@{p.handle}</small></span></button>)}{ev.attendee_count > ev.attendees.length && <small className="muted">and {ev.attendee_count - ev.attendees.length} more</small>}</div> : <p className="muted small-text">No one yet. Be the first.</p>}
    <h4>Hosted by</h4>
    <button className="club-line" onClick={() => show({ kind: 'club', id: ev.club.id })}><Emblem club={ev.club} size={30} /><span>{ev.club.name}{ev.organizer && <small>Organized by {ev.organizer.display_name}</small>}</span><ArrowRight size={15} /></button>
    {ev.can_manage && ev.status !== 'canceled' && <div className="manage">
      <h4>Manage</h4>
      {confirm ? <Confirm pending={pending} text={confirm === 'cancel' ? 'Cancel this event? It stays visible as canceled and RSVPs close. This can’t be undone.' : 'Delete this draft permanently?'} action={confirm === 'cancel' ? 'Cancel event' : 'Delete draft'} onCancel={() => setConfirm('')}
        onConfirm={() => void act(async () => { const s = await svc(); if (confirm === 'cancel') await s.setEventStatus(ev.id, 'canceled'); else { await s.deleteEvent(ev.id); back(); } setConfirm(''); changed(); })} />
        : <div className="form-actions start">
          <button className="secondary" onClick={() => show({ kind: 'event-form', id: ev.id })}><PencilLine size={15} />Edit</button>
          {ev.status === 'draft' && <button className="primary" disabled={pending} onClick={() => run(async () => (await svc()).setEventStatus(ev.id, 'published'))}><Megaphone size={15} />Publish</button>}
          {ev.status === 'draft' ? <button className="text-button" onClick={() => setConfirm('delete')}><Trash2 size={14} />Delete draft</button> : <button className="text-button" onClick={() => setConfirm('cancel')}><Ban size={14} />Cancel event</button>}
        </div>}
    </div>}
  </article>;
}

function defaultTimes() { const s = new Date(); s.setDate(s.getDate() + 1); s.setHours(17, 0, 0, 0); const e = new Date(s.getTime() + 2 * 36e5); return { starts: s.toISOString(), ends: e.toISOString() }; }
function EventForm({ id, club: preset }: { id?: string; club?: string }) {
  const changed = useCommunity(s => s.changed), show = useCommunity(s => s.show), back = useCommunity(s => s.back);
  const existing = useLoad(async () => (id ? (await svc()).event(id) : null), [id]);
  const managed = useLoad(async () => (await (await svc()).listClubs({ mine: true, limit: 50 })).filter(c => c.my_role === 'owner' || c.my_role === 'organizer'), []);
  const [form, setForm] = useState<(EventInput & { club: string }) | null>(null), [touched, setTouched] = useState(false);
  const { pending, error, act } = useAction();
  useEffect(() => {
    if (form || existing.loading || managed.loading) return;
    const ev = existing.data, t = defaultTimes();
    setForm(ev ? { club: ev.club.id, title: ev.title, description: ev.description, category: ev.category, location: ev.location.id, starts_at: ev.starts_at, ends_at: ev.ends_at, capacity: ev.capacity, template: ev.template ?? null }
      : { club: preset ?? managed.data?.[0]?.id ?? '', title: '', description: '', category: 'social', location: 'student', starts_at: t.starts, ends_at: t.ends, capacity: null, template: null });
  }, [existing.loading, managed.loading, existing.data, managed.data, preset, form]);
  if (existing.error) return <Failure message={existing.error} retry={existing.reload} />;
  if (managed.error) return <Failure message={managed.error} retry={managed.reload} />;
  if (!form) return <Loading />;
  if (!id && !managed.data?.length) return <div className="empty-state"><Crown size={28} /><p>Events are hosted by clubs.</p><small>Start a club, or ask a club owner to make you an organizer.</small><button className="primary" onClick={() => show({ kind: 'club-form' })}><Plus size={15} />Start a club</button></div>;
  const start = new Date(form.starts_at), end = new Date(form.ends_at), hours = (end.getTime() - start.getTime()) / 36e5;
  const errors = {
    title: form.title.trim().length < 3 ? 'Give the event a title (3–80 characters).' : '',
    time: !form.starts_at || !form.ends_at ? 'Choose a start and end.' : hours <= 0 ? 'The event must end after it starts.' : hours > 12 ? 'Events can last up to 12 hours.' : !id && start.getTime() < Date.now() ? 'Choose a start time in the future.' : '',
    capacity: form.capacity !== null && (!Number.isInteger(form.capacity) || form.capacity < 1 || form.capacity > 500) ? 'Use a limit from 1 to 500, or leave it empty.' : '',
  };
  const valid = !errors.title && !errors.time && !errors.capacity && !!form.club;
  const save = (publish: boolean) => async (e?: FormEvent) => {
    e?.preventDefault(); setTouched(true); if (!valid) return;
    const input: EventInput = { title: form.title.trim(), description: form.description.trim(), category: form.category, location: form.location, starts_at: form.starts_at, ends_at: form.ends_at, capacity: form.capacity, template: form.template ?? null };
    const saved = await act(async () => { const s = await svc(); return id ? s.updateEvent(id, input) : s.createEvent(form.club, input, publish); });
    if (saved) { changed(); if (id) back(); else show({ kind: 'event', id: saved.id }); useGame.getState().notify(id ? 'Event updated.' : publish ? 'Event published.' : 'Draft saved. Publish it when you’re ready.'); }
  };
  const patch = (p: Partial<typeof form>) => setForm({ ...form, ...p });
  return <form className="community-form" onSubmit={save(true)} noValidate>
    <h3>{id ? 'Edit event' : 'New event'}</h3>
    <label className="field">Activity<select value={form.template ?? ''} onChange={e => { const t = templateById(e.target.value); if (!t) { patch({ template: null }); return; }
      // A new event takes the template's place, length and suggested wording; an edit keeps its own.
      if (id) { patch({ template: t.id }); return; }
      patch({ template: t.id, category: t.category, location: t.location, title: form.title || t.title, description: form.description || t.description, ends_at: new Date(new Date(form.starts_at).getTime() + t.hours * 36e5).toISOString() }); }}>
      <option value="">Something else</option>{EVENT_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <small className="muted">{templateById(form.template)?.activity ?? 'Templates set a place and length, and tell players what to do when they arrive.'}</small></label>
    {!id && <label className="field">Club<select value={form.club} onChange={e => patch({ club: e.target.value })}>{managed.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <label className="field">Title<input value={form.title} maxLength={80} onChange={e => patch({ title: e.target.value })} aria-invalid={touched && !!errors.title} />{touched && errors.title && <small className="field-error">{errors.title}</small>}</label>
    <div className="form-grid">
      <label className="field">Category<select value={form.category} onChange={e => patch({ category: e.target.value as EventCategory })}>{EVENT_CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
      <label className="field">Campus location<select value={form.location} onChange={e => patch({ location: e.target.value })}>{LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="field">Starts<input type="datetime-local" value={toLocalInput(form.starts_at)} onChange={e => patch({ starts_at: fromLocalInput(e.target.value) })} aria-invalid={touched && !!errors.time} /></label>
      <label className="field">Ends<input type="datetime-local" value={toLocalInput(form.ends_at)} onChange={e => patch({ ends_at: fromLocalInput(e.target.value) })} aria-invalid={touched && !!errors.time} /></label>
    </div>
    {touched && errors.time ? <small className="field-error">{errors.time}</small> : <small className="muted">Times are in your time zone ({ZONE.replace(/_/g, ' ')}).</small>}
    <label className="field">Attendance limit <small className="muted">optional</small><input type="number" min={1} max={500} inputMode="numeric" value={form.capacity ?? ''} onChange={e => patch({ capacity: e.target.value === '' ? null : Number(e.target.value) })} aria-invalid={touched && !!errors.capacity} />{touched && errors.capacity && <small className="field-error">{errors.capacity}</small>}</label>
    <label className="field">Description <small className="muted">{form.description.length} / 1000</small><textarea rows={4} maxLength={1000} value={form.description} onChange={e => patch({ description: e.target.value })} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="secondary" onClick={back}>Cancel</button>
      {!id && <button type="button" className="secondary" disabled={pending} onClick={() => void save(false)()}>Save draft</button>}
      <button className="primary" disabled={pending}>{pending ? 'Saving…' : id ? 'Save changes' : 'Publish'}<ArrowRight size={15} /></button></div>
  </form>;
}

// ---------------------------------------------------------------- clubs
function ClubCard({ club }: { club: Club }) {
  const show = useCommunity(s => s.show);
  return <button className="club-card" onClick={() => show({ kind: 'club', id: club.id })}>
    <Emblem club={club} size={40} />
    <span className="club-main"><b>{club.name}</b><small>{label(club.category)} · {club.member_count} member{club.member_count === 1 ? '' : 's'}{club.upcoming_count ? ` · ${club.upcoming_count} upcoming` : ''}</small></span>
    {club.my_role && <span className={`status-tag ${club.my_role}`}>{club.my_role === 'member' ? 'Joined' : label(club.my_role)}</span>}
  </button>;
}

function ClubsDirectory() {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [category, setCategory] = useState<ClubCategory | ''>(''), [mine, setMine] = useState(false);
  const revision = useCommunity(s => s.revision), show = useCommunity(s => s.show), member = useMember();
  useEffect(() => { const t = setTimeout(() => setQuery(search), 300); return () => clearTimeout(t); }, [search]);
  const list = usePaged(async offset => (await svc()).listClubs({ search: query, category: category || null, mine, limit: 20, offset }), [query, category, mine, revision]);
  return <div className="board">
    <div className="board-filters">
      <label className="search"><Search size={15} /><span className="sr-only">Search clubs</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clubs" maxLength={48} /></label>
      <div className="filter-row">
        <label className="select"><span className="sr-only">Interest</span><select value={category} onChange={e => setCategory(e.target.value as ClubCategory | '')}><option value="">All interests</option>{CLUB_CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
        {member === 'member' && <label className="toggle"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />My clubs</label>}
        {member === 'member' && <button className="text-button" onClick={() => show({ kind: 'club-form' })}><Plus size={15} />Start a club</button>}
      </div>
    </div>
    {list.error && <Failure message={list.error} retry={list.reload} />}
    {!list.error && list.loading && !list.items.length && <Loading label="Finding clubs…" />}
    {!list.error && !list.loading && !list.items.length && <div className="empty-state"><Users size={28} /><p>{query || category || mine ? 'No clubs match that.' : 'No clubs yet.'}</p><small>{member === 'member' ? 'Start the first one: it takes a minute.' : 'Sign in to start one.'}</small></div>}
    {list.items.map(c => <ClubCard key={c.id} club={c} />)}
    {list.more && <button className="secondary wide" disabled={list.loading} onClick={list.loadMore}>{list.loading ? 'Loading…' : 'Show more clubs'}</button>}
    <JoinPrompt what="join or start clubs" />
  </div>;
}

function ClubView({ id }: { id: string }) {
  const revision = useCommunity(s => s.revision), changed = useCommunity(s => s.changed), show = useCommunity(s => s.show), back = useCommunity(s => s.back), member = useMember(), setGame = useGame(s => s.set);
  const me = useAccount(s => s.profile?.id);
  const { data: club, error, loading, reload } = useLoad(async () => (await svc()).club(id), [id, revision]);
  const { pending, error: actionError, act } = useAction(), [confirm, setConfirm] = useState(false);
  if (loading && !club) return <Loading label="Loading club…" />;
  if (error && !club) return <Failure message={error} retry={reload} />;
  if (!club) return <div className="empty-state"><Users size={28} /><p>This club no longer exists.</p></div>;
  const owner = club.my_role === 'owner', manager = owner || club.my_role === 'organizer';
  const run = (fn: () => Promise<unknown>) => void act(async () => { await fn(); changed(); });
  return <article className="club-detail">
    <div className="club-hero"><Emblem club={club} size={56} /><div><span className="eyebrow">{club.category.toUpperCase()}</span><h3>{club.name}</h3><p className="muted small-text">{club.member_count} member{club.member_count === 1 ? '' : 's'}{club.owner ? ` · Run by ${club.owner.display_name}` : ''}</p></div></div>
    {club.description && <p className="event-description">{club.description}</p>}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {member === 'member' ? (owner ? <p className="note small-text"><Crown size={14} /> You own this club.</p>
      : <button className={club.my_role ? 'secondary wide' : 'primary wide'} disabled={pending} onClick={() => run(async () => { const s = await svc(); return club.my_role ? s.leaveClub(club.id) : s.joinClub(club.id); })}>{pending ? 'One moment…' : club.my_role ? 'Leave club' : <>Join club<ArrowRight size={15} /></>}</button>)
      : <JoinPrompt what="join" />}
    <h4>Upcoming events</h4>
    {club.events.length ? club.events.map(e => <EventCard key={e.id} event={e} />) : <p className="muted small-text">Nothing scheduled yet.</p>}
    {manager && <button className="text-button" onClick={() => show({ kind: 'event-form', club: club.id })}><CalendarPlus size={15} />New event for {club.name}</button>}
    <h4>Members</h4>
    <div className="people">{club.members.map(m => <div key={m.id} className="person-row">
      <button className="person" onClick={() => setGame({ panel: `player:${m.handle}` })}><Portrait person={m} size={30} /><span>{m.display_name}<small>@{m.handle}{m.role !== 'member' ? ` · ${m.role}` : ''}</small></span></button>
      {owner && m.id !== me && m.role !== 'owner' && <span className="member-actions">
        <button className="text-button inline" disabled={pending} onClick={() => run(async () => (await svc()).setMemberRole(club.id, m.id, m.role === 'organizer' ? 'member' : 'organizer'))}>{m.role === 'organizer' ? 'Remove organizer' : 'Make organizer'}</button>
        <button className="icon-button" aria-label={`Remove ${m.display_name} from the club`} disabled={pending} onClick={() => run(async () => (await svc()).removeMember(club.id, m.id))}><X size={14} /></button>
      </span>}
    </div>)}{club.member_count > club.members.length && <small className="muted">and {club.member_count - club.members.length} more</small>}</div>
    {owner && <div className="manage"><h4>Manage</h4>
      {confirm ? <Confirm pending={pending} text={`Delete ${club.name}? Its members, events and RSVPs are removed. This can’t be undone.`} action="Delete club" onCancel={() => setConfirm(false)} onConfirm={() => void act(async () => { await (await svc()).deleteClub(club.id); changed(); back(); })} />
        : <div className="form-actions start"><button className="secondary" onClick={() => show({ kind: 'club-form', id: club.id })}><PencilLine size={15} />Edit club</button><button className="text-button" onClick={() => setConfirm(true)}><Trash2 size={14} />Delete club</button></div>}
    </div>}
  </article>;
}

function ClubForm({ id }: { id?: string }) {
  const changed = useCommunity(s => s.changed), show = useCommunity(s => s.show), back = useCommunity(s => s.back);
  const existing = useLoad(async () => (id ? (await svc()).club(id) : null), [id]);
  const [form, setForm] = useState<ClubInput | null>(null), [touched, setTouched] = useState(false);
  const { pending, error, act } = useAction();
  useEffect(() => { if (!form && !existing.loading) { const c = existing.data; setForm(c ? { name: c.name, description: c.description, category: c.category, emblem: c.emblem, color: c.color } : { name: '', description: '', category: 'community', emblem: 'spark', color: CLUB_COLORS[0] }); } }, [existing.loading, existing.data, form]);
  if (existing.error) return <Failure message={existing.error} retry={existing.reload} />;
  if (!form) return <Loading />;
  const nameError = form.name.trim().length < 3 ? 'Club names are 3–48 characters.' : '';
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setTouched(true); if (nameError) return;
    const input = { ...form, name: form.name.trim(), description: form.description.trim() };
    const saved = await act(async () => { const s = await svc(); return id ? s.updateClub(id, input) : s.createClub(input); });
    if (saved) { changed(); if (id) back(); else show({ kind: 'club', id: saved.id }); useGame.getState().notify(id ? 'Club updated.' : `${saved.name} is open. Invite people to join.`); }
  };
  const patch = (p: Partial<ClubInput>) => setForm({ ...form, ...p });
  return <form className="community-form" onSubmit={submit} noValidate>
    <h3>{id ? 'Edit club' : 'Start a club'}</h3>
    <div className="club-preview"><Emblem club={form} size={48} /><b>{form.name.trim() || 'Your club'}</b></div>
    <label className="field">Name<input value={form.name} maxLength={48} onChange={e => patch({ name: e.target.value })} aria-invalid={touched && !!nameError} />{touched && nameError && <small className="field-error">{nameError}</small>}</label>
    <label className="field">Interest<select value={form.category} onChange={e => patch({ category: e.target.value as ClubCategory })}>{CLUB_CATEGORIES.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
    <fieldset><legend>Emblem</legend><div className="swatches">{CLUB_EMBLEMS.map(em => { const Icon = EMBLEMS[em]; return <button type="button" key={em} aria-label={`${em} emblem`} aria-pressed={form.emblem === em} className={form.emblem === em ? 'selected icon-swatch' : 'icon-swatch'} onClick={() => patch({ emblem: em })}><Icon size={16} /></button>; })}</div></fieldset>
    <fieldset><legend>Colour</legend><div className="swatches">{CLUB_COLORS.map((c, i) => <button type="button" key={c} aria-label={`Club colour ${i + 1}`} aria-pressed={form.color === c} className={form.color === c ? 'selected' : ''} style={{ background: c }} onClick={() => patch({ color: c })} />)}</div></fieldset>
    <label className="field">Description <small className="muted">{form.description.length} / 600</small><textarea rows={4} maxLength={600} value={form.description} onChange={e => patch({ description: e.target.value })} placeholder="What do you do together, and who is it for?" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="secondary" onClick={back}>Cancel</button><button className="primary" disabled={pending}>{pending ? 'Saving…' : id ? 'Save changes' : 'Start club'}<ArrowRight size={15} /></button></div>
  </form>;
}

// ---------------------------------------------------------------- the drawer
function Body({ view }: { view: CommunityView }) {
  switch (view.kind) {
    case 'events': return <EventsBoard />;
    case 'clubs': return <ClubsDirectory />;
    case 'challenges': return <Challenges />;
    case 'event': return <EventView key={view.id} id={view.id} />;
    case 'club': return <ClubView key={view.id} id={view.id} />;
    case 'event-form': return <EventForm key={view.id ?? 'new'} id={view.id} club={view.club} />;
    case 'club-form': return <ClubForm key={view.id ?? 'new'} id={view.id} />;
  }
}
/**
 * Events and clubs in a side drawer (a bottom sheet on phones). It is not a modal: movement keys
 * keep working while you browse. Open with the dock's Events button or V; close with Esc or ×.
 */
export function CommunityDrawer() {
  const open = useCommunity(s => s.open), view = useCommunity(s => s.view), show = useCommunity(s => s.show), back = useCommunity(s => s.back), toggle = useCommunity(s => s.toggle), history = useCommunity(s => s.history);
  const phase = useGame(s => s.phase);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (useGame.getState().phase !== 'playing' || useGame.getState().panel) return;
      const typing = (e.target as HTMLElement).matches?.('input,textarea,select');
      if (e.code === 'Escape' && useCommunity.getState().open) { e.preventDefault(); e.stopImmediatePropagation(); toggle(false); return; }
      if (e.code === 'KeyV' && !typing && !e.repeat) { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, [toggle]);
  if (!open || phase !== 'playing') return null;
  const tab = view.kind === 'challenges' ? 'challenges' : view.kind.startsWith('club') ? 'clubs' : 'events', top = view.kind === 'events' || view.kind === 'clubs' || view.kind === 'challenges';
  return <aside className="community-drawer" aria-label="Campus events and clubs">
    <header className="drawer-header">
      {!top ? <button className="icon-button" aria-label="Back" onClick={back}><ChevronLeft size={18} /></button> : <span className="drawer-mark"><CalendarDays size={16} /></span>}
      <div className="segments" role="tablist" aria-label="Community">{(['events', 'clubs', 'challenges'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t && top} className={tab === t ? 'selected' : ''} onClick={() => show({ kind: t })}>{t === 'events' ? 'Events' : t === 'clubs' ? 'Clubs' : 'Challenges'}</button>)}</div>
      <button className="icon-button" aria-label="Close events and clubs" onClick={() => toggle(false)}><X size={18} /></button>
    </header>
    <div className="drawer-body" key={`${view.kind}-${history.length}`}>{communityConfigured || view.kind === 'challenges' ? <Body view={view} /> : <div className="empty-state"><CalendarDays size={28} /><p>{NOT_CONFIGURED}</p><button className="text-button" onClick={() => show({ kind: 'challenges' })}>Challenges work without accounts →</button></div>}</div>
  </aside>;
}

/** Upcoming events at a campus location, for that location's information panel. */
export function HappeningHere({ location }: { location: string }) {
  const show = useCommunity(s => s.show), setGame = useGame(s => s.set);
  const list = useLoad(async () => (communityConfigured ? (await svc()).listEvents({ location, limit: 3 }) : []), [location]);
  if (!communityConfigured || list.error || !list.data?.length) return null;
  return <section className="happening"><h3>Happening here</h3>{list.data.map(e => <button key={e.id} className="event-line" onClick={() => { setGame({ panel: null }); show({ kind: 'event', id: e.id }); }}><b>{dayLabel(e.starts_at)}, {time(e.starts_at)}</b><span>{e.title}</span>{e.status === 'canceled' && <span className="status-tag canceled">Canceled</span>}</button>)}</section>;
}
export function openEvents() { useCommunity.getState().show({ kind: 'events' }); }
