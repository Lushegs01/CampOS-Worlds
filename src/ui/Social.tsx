import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Ban, Check, ChevronDown, ChevronUp, Crown, Flag, LocateFixed, Mail, MessageCircle, MoreHorizontal, Navigation, RotateCcw, Search, Send, Shield, UserCheck, UserMinus, UserPlus, UserRound, Users, Volume2, VolumeX, X } from 'lucide-react';
import { isMuted, livePeers, muteKey, player, useGame, type Peer } from '../state';
import { useAccount } from '../account/store';
import { communityConfigured, getCommunityService, NOT_CONFIGURED, toServiceError } from '../services/community';
import { REPORT_REASONS, type PlayerResult, type ProfileBrief, type ReportContext, type ReportReason, type SocialSettings } from '../services/types';
import {
  answerInvite, blockPlayer, cancelFriendRequest, closeSocial, discardMessage, findPlayer, inviteToParty, kickFromParty, leaveParty, loadConversations, loadThread, markRead,
  meetUp, openSocial, presenceOf, promoteInParty, refreshOverview, removeFriend, reportPlayer, respondFriendRequest, saveSettings, sendFriendRequest, sendMessage,
  setGuestInvites, setNotifications, startConversation, toggleSocial, unblockPlayer, useSocial, withdrawInvite, bond, type PartyMember, type SocialTab, type ThreadMessage,
} from '../social/store';
import { bearing, distanceLabel, placeName } from '../social/places';
import { selfConnection, send } from '../network/client';
import { Portrait } from './Account';
import { Failure, Loading, useAction } from './async';

// ---------------------------------------------------------------- shared bits
type Membership = 'unconfigured' | 'loading' | 'guest' | 'no-profile' | 'member';
function useMembership(): Membership {
  return useAccount(s => (s.status === 'unconfigured' ? 'unconfigured' : s.status === 'loading' ? 'loading' : s.status === 'guest' ? 'guest' : s.profile ? 'member' : 'no-profile'));
}
function SignInPrompt({ what }: { what: string }) {
  const membership = useMembership(), set = useGame(s => s.set);
  if (membership === 'unconfigured') return <div className="empty-state"><Users size={28} /><p>{NOT_CONFIGURED}</p><small>Parties still work with anyone in this room.</small></div>;
  if (membership === 'loading') return <Loading label="Checking your account…" />;
  return <div className="empty-state"><Users size={28} /><p>{membership === 'guest' ? `Sign in to ${what}.` : `Finish your profile to ${what}.`}</p>
    <small>Friends and private messages belong to accounts, so they stay with you on any device. Parties work for guests too.</small>
    <button className="secondary" onClick={() => set({ panel: 'account' })}>{membership === 'guest' ? 'Sign in' : 'Finish your profile'}</button></div>;
}
function Confirm({ text, action, onConfirm, onCancel, pending }: { text: string; action: string; onConfirm: () => void; onCancel: () => void; pending?: boolean }) {
  return <div className="confirm" role="alertdialog" aria-label={action}><p>{text}</p><div className="form-actions"><button className="secondary" onClick={onCancel}>Keep it</button><button className="danger" disabled={pending} onClick={onConfirm}>{pending ? 'One moment…' : action}</button></div></div>;
}
const Badge = ({ n }: { n: number }) => (n > 0 ? <span className="count-badge" aria-label={`${n} new`}>{n > 99 ? '99+' : n}</span> : null);
const Name = ({ person }: { person: Pick<ProfileBrief, 'display_name' | 'handle'> }) => <span className="person-name"><b>{person.display_name}</b><small>@{person.handle}</small></span>;
const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }); };
/** Live position of someone in this room, refreshed once a second (positions live outside React). */
function useWhere(id: string | null) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const p = id ? livePeers.get(id) : null;
  if (!p) return null;
  const b = bearing(player.x, player.z, p.x, p.z);
  return { place: placeName(p.x, p.z), distance: distanceLabel(b.distance), direction: b.distance < 8 ? '' : b.direction, near: b.distance < 8 };
}

// ---------------------------------------------------------------- report dialog (inline)
function ReportForm({ user, name, context, message, onDone, onSent }: { user: string; name: string; context: ReportContext; message?: number | null; onDone: () => void; onSent?: () => void }) {
  const [reason, setReason] = useState<ReportReason>('harassment'), [details, setDetails] = useState(''), [sent, setSent] = useState(false);
  const { pending, error, act } = useAction();
  if (sent) return <div className="note small-text"><b>Report sent.</b><p>Moderators will review it. You can also block {name} so they can’t contact you.</p><button className="text-button" onClick={onDone}>Close</button></div>;
  return <form className="report-form" onSubmit={async e => { e.preventDefault(); if (await act(() => reportPlayer(user, reason, context, details, message ?? null)) !== undefined) { setSent(true); onSent?.(); } }}>
    <b>Report {name}</b>
    {message ? <small className="muted">The message you chose is included so a moderator can read it. Nothing else from your conversation is shared.</small> : null}
    <label className="select"><span className="sr-only">Reason</span><select value={reason} onChange={e => setReason(e.target.value as ReportReason)}>{(Object.keys(REPORT_REASONS) as ReportReason[]).map(r => <option key={r} value={r}>{REPORT_REASONS[r]}</option>)}</select></label>
    <label className="field">Details (optional)<textarea rows={2} maxLength={500} value={details} onChange={e => setDetails(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="secondary" onClick={onDone}>Cancel</button><button className="danger" disabled={pending}>{pending ? 'Sending…' : 'Send report'}</button></div>
  </form>;
}

// ---------------------------------------------------------------- friends
function AddFriend() {
  const [query, setQuery] = useState(''), [results, setResults] = useState<PlayerResult[] | null>(null), [searching, setSearching] = useState(false);
  const { pending, error, setError, act } = useAction();
  const q = query.trim().replace(/^@/, '').toLowerCase();
  useEffect(() => {
    if (!/^[a-z0-9_]{2,20}$/.test(q)) { setResults(null); return; }
    let live = true; setSearching(true);
    const t = setTimeout(() => { getCommunityService().then(s => s.searchPlayers(q)).then(r => { if (live) setResults(r); }, e => { if (live) setError(toServiceError(e).message); }).finally(() => { if (live) setSearching(false); }); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, setError]);
  const add = async (handle: string) => { const r = await act(() => sendFriendRequest(handle)); if (r) { useGame.getState().notify(r.relationship === 'friends' ? `You and @${handle} are now friends.` : `Friend request sent to @${handle}.`); setResults(rs => rs?.map(p => (p.handle === handle ? { ...p, relationship: r.relationship } : p)) ?? null); } };
  return <form className="add-friend" onSubmit={e => { e.preventDefault(); if (/^[a-z0-9_]{3,20}$/.test(q)) void add(q); }}>
    <label className="search-field"><Search size={15} /><span className="sr-only">Find a player by handle</span><input value={query} onChange={e => { setQuery(e.target.value); setError(''); }} placeholder="Add a friend by @handle" autoCapitalize="off" spellCheck={false} maxLength={21} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {searching && !results && <Loading label="Searching…" />}
    {results && <div className="result-list">{results.length ? results.map(p => <div key={p.id} className="person-row"><Portrait person={p} size={32} /><Name person={p} />
      {p.relationship === 'none' ? <button type="button" className="secondary small" disabled={pending} onClick={() => void add(p.handle)}><UserPlus size={14} />Add</button>
        : p.relationship === 'incoming' ? <button type="button" className="secondary small" disabled={pending} onClick={() => void add(p.handle)}><Check size={14} />Accept</button>
        : <span className="status-tag">{p.relationship === 'friends' ? 'Friends' : p.relationship === 'outgoing' ? 'Requested' : 'Blocked'}</span>}</div>)
      : <p className="muted small-text">No player handle starts with “{q}”.</p>}</div>}
  </form>;
}

function FriendRow({ friend, peer }: { friend: ProfileBrief & { since: string }; peer: Peer | null }) {
  const where = useWhere(peer?.id ?? null), inParty = useSocial(s => !!peer && !!s.party?.members.some(m => m.id === peer.id));
  const [more, setMore] = useState<'' | 'menu' | 'remove' | 'block' | 'report'>('');
  const { pending, error, act } = useAction(), setGame = useGame(s => s.set);
  return <div className={`friend-row${peer ? ' online' : ''}`}>
    <div className="person-row"><span className="presence-wrap"><Portrait person={friend} size={36} /><i className={peer ? 'presence on' : 'presence'} aria-hidden="true" /></span>
      <span className="person-name"><b>{friend.display_name}</b><small>{peer ? (where ? `${where.place} · ${where.near ? 'right here' : `${where.distance} ${where.direction}`}` : 'On campus') : `@${friend.handle} · not on campus`}</small></span>
      <span className="row-actions">
        <button className="icon-button" aria-label={`Message ${friend.display_name}`} title="Message" disabled={pending} onClick={() => void act(() => startConversation(friend.id))}><MessageCircle size={16} /></button>
        {peer && !inParty && <button className="icon-button" aria-label={`Invite ${friend.display_name} to your party`} title="Invite to party" onClick={() => void inviteToParty(peer.id)}><UserPlus size={16} /></button>}
        {peer && <button className="icon-button" aria-label={`Show ${friend.display_name} on the map`} title="Find" onClick={() => findPlayer(peer.id, friend.display_name)}><LocateFixed size={16} /></button>}
        {peer && inParty && <button className="icon-button" aria-label={`Travel to ${friend.display_name}`} title="Meet up" onClick={() => meetUp(peer.id)}><Navigation size={16} /></button>}
        <button className="icon-button" aria-label={`More for ${friend.display_name}`} aria-expanded={!!more} onClick={() => setMore(more ? '' : 'menu')}><MoreHorizontal size={16} /></button>
      </span></div>
    {more === 'menu' && <div className="row-menu"><button className="text-button" onClick={() => setGame({ panel: 'player:' + friend.handle })}><UserRound size={14} />Profile</button><button className="text-button" onClick={() => setMore('remove')}><UserMinus size={14} />Remove friend</button><button className="text-button" onClick={() => setMore('block')}><Ban size={14} />Block</button><button className="text-button" onClick={() => setMore('report')}><Flag size={14} />Report</button></div>}
    {more === 'remove' && <Confirm text={`Remove ${friend.display_name} from your friends? You can still read your messages, but you won’t be able to send new ones.`} action="Remove friend" pending={pending} onCancel={() => setMore('')} onConfirm={() => void act(() => removeFriend(friend.id)).then(() => setMore(''))} />}
    {more === 'block' && <Confirm text={`Block ${friend.display_name}? This ends your friendship, and neither of you will see the other’s chat, messages or invitations. They aren’t told.`} action="Block" pending={pending} onCancel={() => setMore('')} onConfirm={() => void act(() => blockPlayer(friend.id)).then(() => setMore(''))} />}
    {more === 'report' && <ReportForm user={friend.id} name={friend.display_name} context="profile" onDone={() => setMore('')} />}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

function FriendsTab() {
  const membership = useMembership(), overview = useSocial(s => s.overview), state = useSocial(s => s.overviewState), error = useSocial(s => s.overviewError), peers = useGame(s => s.peers), status = useGame(s => s.status);
  if (membership !== 'member') return <SignInPrompt what="add friends and send private messages" />;
  if (!overview) return state === 'error' ? <Failure message={error} retry={() => void refreshOverview()} /> : <Loading label="Loading your friends…" />;
  const rows = overview.friends.map(f => ({ friend: f, peer: presenceOf(f.handle, peers) })), online = rows.filter(r => r.peer), offline = rows.filter(r => !r.peer);
  return <div className="social-tab">
    <AddFriend />
    {state === 'error' && <Failure message={error} retry={() => void refreshOverview()} />}
    {!overview.friends.length ? <div className="empty-state"><UserPlus size={28} /><p>No friends yet.</p><small>Add someone by their @handle, or open the People list to add players you meet on campus.</small></div> : <>
      <h4>On campus now · {online.length}</h4>
      {online.length ? online.map(r => <FriendRow key={r.friend.id} friend={r.friend} peer={r.peer} />) : <p className="muted small-text">{status === 'connected' ? 'None of your friends are on campus right now.' : 'Connect to the shared room to see who is on campus.'}</p>}
      {offline.length > 0 && <><h4>Not on campus · {offline.length}</h4>{offline.map(r => <FriendRow key={r.friend.id} friend={r.friend} peer={null} />)}</>}
      <p className="muted small-text">Friends who chose to appear offline are shown as not on campus.</p>
    </>}
  </div>;
}

// ---------------------------------------------------------------- requests
function RequestsTab() {
  const membership = useMembership(), overview = useSocial(s => s.overview), error = useSocial(s => s.overviewError);
  const { pending, error: actError, act } = useAction();
  if (membership !== 'member') return <SignInPrompt what="receive friend requests" />;
  if (!overview) return error ? <Failure message={error} retry={() => void refreshOverview()} /> : <Loading label="Loading requests…" />;
  return <div className="social-tab">
    {actError && <p className="form-error" role="alert">{actError}</p>}
    <h4>Received · {overview.incoming.length}</h4>
    {overview.incoming.length ? overview.incoming.map(r => <div key={r.id} className="person-row"><Portrait person={r.player} size={34} /><span className="person-name"><b>{r.player.display_name}</b><small>@{r.player.handle} · {ago(r.created_at)}</small></span>
      <span className="row-actions"><button className="secondary small" disabled={pending} onClick={() => void act(() => respondFriendRequest(r.id, true)).then(x => { if (x) useGame.getState().notify(`You and ${r.player.display_name} are now friends.`); })}><Check size={14} />Accept</button>
        <button className="icon-button" aria-label={`Decline ${r.player.display_name}’s request`} title="Decline" disabled={pending} onClick={() => void act(() => respondFriendRequest(r.id, false))}><X size={16} /></button></span></div>)
      : <p className="muted small-text">No requests waiting.</p>}
    <h4>Sent · {overview.outgoing.length}</h4>
    {overview.outgoing.length ? overview.outgoing.map(r => <div key={r.id} className="person-row"><Portrait person={r.player} size={34} /><span className="person-name"><b>{r.player.display_name}</b><small>@{r.player.handle} · waiting · {ago(r.created_at)}</small></span>
      <button className="text-button" disabled={pending} onClick={() => void act(() => cancelFriendRequest(r.player.id))}>Cancel</button></div>)
      : <p className="muted small-text">Requests you send appear here until they’re answered.</p>}
  </div>;
}

// ---------------------------------------------------------------- messages
function ConversationList() {
  const conversations = useSocial(s => s.conversations), error = useSocial(s => s.conversationsError), friends = useSocial(s => s.overview?.friends ?? []);
  const [choosing, setChoosing] = useState(false), { pending, error: actError, act } = useAction();
  useEffect(() => { void loadConversations(); }, []);
  if (error && !conversations) return <Failure message={error} retry={() => void loadConversations()} />;
  if (!conversations) return <Loading label="Loading conversations…" />;
  return <div className="social-tab">
    <div className="tab-toolbar"><span className="muted small-text">Private between you and one friend.</span><button className="text-button" onClick={() => setChoosing(!choosing)}><Mail size={14} />New message</button></div>
    {choosing && <div className="result-list">{friends.length ? friends.map(f => <button key={f.id} className="person-row as-button" disabled={pending} onClick={() => void act(() => startConversation(f.id))}><Portrait person={f} size={30} /><Name person={f} /></button>) : <p className="muted small-text">Add friends first: private messages are between friends.</p>}</div>}
    {actError && <p className="form-error" role="alert">{actError}</p>}
    {conversations.length ? conversations.map(c => <button key={c.id} className={`conversation-row${c.unread ? ' unread' : ''}`} onClick={() => { openSocial('messages', c.id); void loadThread(c.id); }}>
      <Portrait person={c.other} size={38} />
      <span className="person-name"><b>{c.other.display_name}</b><small>{c.last_message ? `${c.last_message.mine ? 'You: ' : ''}${c.last_message.preview}` : 'No messages yet'}</small></span>
      <span className="conversation-meta">{c.last_message && <small>{ago(c.last_message.created_at)}</small>}<Badge n={c.unread} /></span>
    </button>) : <div className="empty-state"><MessageCircle size={28} /><p>No conversations yet.</p><small>Message a friend from your friends list. Public room chat is separate and lives in Chat.</small></div>}
  </div>;
}

function MessageBubble({ m, conversation, onReport }: { m: ThreadMessage; conversation: string; onReport: (m: ThreadMessage) => void }) {
  return <div className={`bubble${m.mine ? ' mine' : ''}${m.status === 'failed' ? ' failed' : ''}`}>
    <p>{m.body}</p>
    <small>{m.status === 'sending' ? 'Sending…' : m.status === 'failed' ? <>{m.error ?? 'Not sent.'} <button className="text-button" onClick={() => void sendMessage(conversation, m.body, m)}><RotateCcw size={11} />Retry</button><button className="text-button" onClick={() => discardMessage(conversation, m.client_id)}>Discard</button></> : <>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{!m.mine && <button className="text-button report-link" aria-label="Report this message" onClick={() => onReport(m)}><Flag size={10} /></button>}</>}</small>
  </div>;
}

function ThreadView({ id }: { id: string }) {
  const thread = useSocial(s => s.threads[id]), open = useSocial(s => s.open && s.tab === 'messages' && s.conversation === id);
  const [draft, setDraft] = useState(''), [reporting, setReporting] = useState<ThreadMessage | null | 'person'>(null), [blocking, setBlocking] = useState(false);
  const list = useRef<HTMLDivElement>(null), stick = useRef(true), { pending, act } = useAction(), setGame = useGame(s => s.set);
  useEffect(() => { void loadThread(id); }, [id]);
  const count = thread?.messages.length ?? 0, last = thread?.messages[count - 1]?.client_id;
  useEffect(() => { if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [count, last]);
  useEffect(() => { if (open && thread?.conversation?.unread) void markRead(id); }, [open, id, thread?.conversation?.unread, count]);
  const c = thread?.conversation, blockReason = c?.block_reason ?? null;
  const submit = (e?: FormEvent) => { e?.preventDefault(); const body = draft.trim(); if (!body || blockReason || body.length > 1000) return; setDraft(''); stick.current = true; void sendMessage(id, body); };
  return <div className="thread">
    <div className="thread-head">
      <button className="icon-button" aria-label="Back to conversations" onClick={() => useSocial.setState({ conversation: null })}><ArrowLeft size={17} /></button>
      {c ? <><Portrait person={c.other} size={30} /><Name person={c.other} />
        <span className="row-actions"><button className="icon-button" aria-label={`View ${c.other.display_name}’s profile`} title="Profile" onClick={() => setGame({ panel: 'player:' + c.other.handle })}><UserRound size={16} /></button>
          <button className="icon-button" aria-label={`Report ${c.other.display_name}`} title="Report" onClick={() => setReporting('person')}><Flag size={16} /></button>
          <button className="icon-button" aria-label={`Block ${c.other.display_name}`} title="Block" onClick={() => setBlocking(true)}><Ban size={16} /></button></span></> : <span className="muted">Conversation</span>}
    </div>
    {blocking && c && <Confirm text={`Block ${c.other.display_name}? Neither of you will be able to message or invite the other, and you won’t see each other’s room chat. They aren’t told.`} action="Block" pending={pending} onCancel={() => setBlocking(false)} onConfirm={() => void act(() => blockPlayer(c.other.id)).then(() => { setBlocking(false); void loadThread(id); })} />}
    {reporting && c && <ReportForm user={c.other.id} name={c.other.display_name} context="direct-message" message={reporting === 'person' ? null : reporting.id} onDone={() => setReporting(null)} />}
    <div className="thread-messages" ref={list} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }} aria-live="polite">
      {thread?.hasMore && <button className="text-button load-earlier" disabled={thread.loading} onClick={() => { stick.current = false; void loadThread(id, true); }}><ChevronUp size={13} />{thread.loading ? 'Loading…' : 'Load earlier messages'}</button>}
      {!thread || (thread.loading && !count) ? <Loading label="Loading messages…" /> : null}
      {thread?.error && <Failure message={thread.error} retry={() => void loadThread(id)} />}
      {thread && !thread.loading && !count && !thread.error && <p className="muted small-text thread-empty">Say hello. Messages here are private to the two of you.</p>}
      {thread?.messages.map(m => <MessageBubble key={m.client_id + m.mine} m={m} conversation={id} onReport={setReporting} />)}
    </div>
    {blockReason ? <p className="note small-text thread-blocked">{blockReason}</p> :
      <form className="composer" onSubmit={submit}>
        <textarea aria-label="Private message" rows={2} maxLength={1000} value={draft} placeholder="Write a private message…" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button className="primary" aria-label="Send private message" disabled={!draft.trim() || !c}><Send size={16} /></button>
        <small className="muted">{draft.length > 800 ? `${draft.length} / 1000 · ` : ''}Enter to send · Shift+Enter for a new line</small>
      </form>}
  </div>;
}

function MessagesTab() {
  const membership = useMembership(), conversation = useSocial(s => s.conversation);
  if (membership !== 'member') return <SignInPrompt what="send private messages" />;
  return conversation ? <ThreadView key={conversation} id={conversation} /> : <ConversationList />;
}

// ---------------------------------------------------------------- party
function PartyMemberRow({ m, leading }: { m: PartyMember; leading: boolean }) {
  const me = m.id === selfConnection(), where = useWhere(me ? null : m.id);
  return <div className="person-row party-row">
    <span className={`party-dot${m.away ? ' away' : ''}`} aria-hidden="true" />
    <span className="person-name"><b>{m.name}{m.verified && <Shield size={11} aria-label="signed-in player" />}{m.leader && <Crown size={12} aria-label="party leader" />}</b>
      <small>{me ? 'You' : m.away ? 'Reconnecting…' : where ? `${where.place} · ${where.near ? 'right here' : `${where.distance} ${where.direction}`}` : 'In this room'}</small></span>
    {!me && m.id && <span className="row-actions">
      <button className="icon-button" aria-label={`Show ${m.name} on the map`} title="Find" onClick={() => findPlayer(m.id!, m.name)}><LocateFixed size={16} /></button>
      <button className="icon-button" aria-label={`Travel to ${m.name}`} title="Meet up" onClick={() => meetUp(m.id!)}><Navigation size={16} /></button>
      {leading && <><button className="icon-button" aria-label={`Make ${m.name} party leader`} title="Make leader" onClick={() => void promoteInParty(m.id!)}><Crown size={15} /></button>
        <button className="icon-button" aria-label={`Remove ${m.name} from the party`} title="Remove" onClick={() => void kickFromParty(m.id!)}><UserMinus size={15} /></button></>}
    </span>}
  </div>;
}

function PartyTab() {
  const party = useSocial(s => s.party), status = useGame(s => s.status), peers = useGame(s => s.peers), overview = useSocial(s => s.overview), setGame = useGame(s => s.set);
  const [leaving, setLeaving] = useState(false);
  if (status !== 'connected') return <div className="empty-state"><Users size={28} /><p>Parties need the shared room.</p><small>You’re exploring locally. Reconnect from Settings to play with others.</small></div>;
  const leading = !!party && party.leader === selfConnection();
  const invitable = peers.filter(p => !party?.members.some(m => m.id === p.id)).sort((a, b) => Number(bond({ party, overview }, b.id, b.handle) === 'friend') - Number(bond({ party, overview }, a.id, a.handle) === 'friend'));
  return <div className="social-tab">
    {party ? <>
      <div className="tab-toolbar"><span className="eyebrow">YOUR PARTY · {party.members.length} / {party.max}</span>
        <button className="text-button" onClick={() => { useSocial.setState({ chatChannel: 'party' }); setGame({ panel: 'chat' }); }}><MessageCircle size={14} />Party chat</button></div>
      {party.members.map(m => <PartyMemberRow key={(m.id ?? '') + m.name} m={m} leading={leading} />)}
      {party.invites.length > 0 && <><h4>Invited</h4>{party.invites.map(i => <div key={i.id} className="person-row"><span className="person-name"><b>{i.name}</b><small>Waiting · {Math.max(0, Math.ceil((i.expires - Date.now()) / 1000))} s left</small></span><button className="text-button" onClick={() => void withdrawInvite(i.id)}>Withdraw</button></div>)}</>}
      {leaving ? <Confirm text="Leave the party? You can be invited back." action="Leave party" onCancel={() => setLeaving(false)} onConfirm={() => { setLeaving(false); void leaveParty(); }} /> : <button className="secondary wide" onClick={() => setLeaving(true)}>Leave party</button>}
    </> : <div className="note small-text"><b>Explore together.</b><p>Invite people in this room to a party: you’ll see where they are, share a party chat, and can travel to each other. Parties last while you’re in the room.</p></div>}
    <h4>Invite from the room</h4>
    {invitable.length ? invitable.map(p => { const b = bond({ party, overview }, p.id, p.handle), invited = party?.invites.some(i => i.id === p.id); return <div key={p.id} className="person-row">
      <span className="person-name"><b>{p.name}{p.verified && <Shield size={11} aria-label="signed-in player" />}</b><small>{b === 'friend' ? 'Friend · ' : ''}{p.handle ? `@${p.handle}` : p.verified ? 'Signed in' : 'Guest'}</small></span>
      <button className="secondary small" disabled={invited || (!!party && party.members.length + party.invites.length >= party.max)} onClick={() => void inviteToParty(p.id)}>{invited ? 'Invited' : <><UserPlus size={14} />Invite</>}</button></div>; })
      : <p className="muted small-text">Nobody else is in this room right now.</p>}
  </div>;
}

// ---------------------------------------------------------------- privacy
function PrivacyTab() {
  const membership = useMembership(), overview = useSocial(s => s.overview), notifications = useSocial(s => s.notifications), guestInvites = useSocial(s => s.guestInvites);
  const [draft, setDraft] = useState<SocialSettings | null>(null), [unblocking, setUnblocking] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const { pending, error, act } = useAction();
  const settings = draft ?? overview?.settings ?? null;
  const radio = <K extends keyof SocialSettings>(key: K, options: [SocialSettings[K], string][]) => <div className="radio-row" role="radiogroup">{options.map(([value, text]) => <label key={String(value)} className={settings?.[key] === value ? 'selected' : ''}><input type="radio" name={key} checked={settings?.[key] === value} onChange={() => { setSaved(false); setDraft({ ...settings!, [key]: value }); }} />{text}</label>)}</div>;
  return <div className="social-tab privacy">
    {membership === 'member' && settings ? <form onSubmit={async e => { e.preventDefault(); if (draft && await act(() => saveSettings(draft))) { setDraft(null); setSaved(true); } }}>
      <fieldset><legend>Who can send you friend requests</legend>{radio('friend_requests', [['everyone', 'Everyone'], ['nobody', 'Nobody']])}</fieldset>
      <fieldset><legend>Private messages</legend>{radio('direct_messages', [['friends', 'Friends'], ['nobody', 'Turned off']])}<small className="muted">Only friends can ever message you. Turning messages off also stops you sending them.</small></fieldset>
      <fieldset><legend>Who can invite you to a party</legend>{radio('party_invites', [['everyone', 'Anyone in the room'], ['friends', 'Friends'], ['nobody', 'Nobody']])}</fieldset>
      <fieldset><legend>Who sees your bio and interests</legend>{radio('profile_visibility', [['public', 'Everyone'], ['friends', 'Friends only']])}<small className="muted">Your name, look, title, badges and game records stay public: they appear in rankings and on club pages.</small></fieldset>
      <label className="setting-row"><span><b>Appear offline</b><small>Friends see you as not on campus and your @handle is hidden in the room. Your name and avatar stay visible to people nearby, as in any shared space.</small></span><input type="checkbox" checked={settings.appear_offline} onChange={e => { setSaved(false); setDraft({ ...settings, appear_offline: e.target.checked }); }} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{saved && <span className="field-ok"><Check size={13} /> Saved</span>}<button className="primary" disabled={!draft || pending}>{pending ? 'Saving…' : 'Save privacy settings'}</button></div>
    </form> : membership === 'member' ? <Loading label="Loading your settings…" /> : <>
      <fieldset><legend>Who can invite you to a party (this visit)</legend><div className="radio-row">{([['everyone', 'Anyone in the room'], ['nobody', 'Nobody']] as const).map(([v, t]) => <label key={v} className={guestInvites === v ? 'selected' : ''}><input type="radio" name="guest-invites" checked={guestInvites === v} onChange={() => setGuestInvites(v)} />{t}</label>)}</div></fieldset>
      <p className="muted small-text">Sign in to keep privacy settings, friends and blocks across visits. Guests can mute players in the People list.</p>
    </>}
    <label className="setting-row"><span><b>Social notifications</b><small>Friend requests and new private messages on this device. Notifications never show message text.</small></span><input type="checkbox" checked={notifications} onChange={e => setNotifications(e.target.checked)} /></label>
    {membership === 'member' && overview && <><h4>Blocked players · {overview.blocked.length}</h4>
      {overview.blocked.length ? overview.blocked.map(b => <div key={b.id}>{unblocking === b.id ? <Confirm text={`Unblock ${b.display_name}? They’ll be able to send you friend requests and see your room chat again.`} action="Unblock" pending={pending} onCancel={() => setUnblocking(null)} onConfirm={() => void act(() => unblockPlayer(b.id)).then(() => setUnblocking(null))} />
        : <div className="person-row"><Portrait person={b} size={30} /><Name person={b} /><button className="text-button" onClick={() => setUnblocking(b.id)}>Unblock</button></div>}</div>)
        : <p className="muted small-text">You haven’t blocked anyone. Blocking stops friend requests, private messages, party invitations and room chat both ways.</p>}</>}
  </div>;
}

// ---------------------------------------------------------------- drawer
const TABS: { id: SocialTab; label: string }[] = [{ id: 'friends', label: 'Friends' }, { id: 'requests', label: 'Requests' }, { id: 'messages', label: 'Messages' }, { id: 'party', label: 'Party' }, { id: 'privacy', label: 'Privacy' }];
/**
 * Friends, requests, private messages, the party and privacy in a side drawer (a bottom sheet on
 * phones). Like the events board it is not modal: you can keep walking. F toggles it; Esc closes.
 */
export function SocialDrawer() {
  const open = useSocial(s => s.open), tab = useSocial(s => s.tab), unread = useSocial(s => s.unread), partySize = useSocial(s => s.party?.members.length ?? 0), phase = useGame(s => s.phase);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (useGame.getState().phase !== 'playing' || useGame.getState().panel) return;
      const typing = (e.target as HTMLElement).matches?.('input,textarea,select');
      if (e.code === 'Escape' && useSocial.getState().open) { e.preventDefault(); e.stopImmediatePropagation(); closeSocial(); return; }
      if (e.code === 'KeyF' && !typing && !e.repeat) { e.preventDefault(); toggleSocial(); }
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, []);
  if (!open || phase !== 'playing') return null;
  const badge: Partial<Record<SocialTab, number>> = { requests: unread.requests, messages: unread.messages };
  return <aside className="community-drawer social-drawer" aria-label="Friends, messages and party">
    <header className="drawer-header">
      <span className="drawer-mark"><Users size={16} /></span>
      <div className="segments" role="tablist" aria-label="Social">{TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'selected' : ''} onClick={() => openSocial(t.id, t.id === 'messages' ? null : undefined)}>{t.label}{t.id === 'party' && partySize > 0 ? ` ${partySize}` : ''}<Badge n={badge[t.id] ?? 0} /></button>)}</div>
      <button className="icon-button" aria-label="Close friends and messages" onClick={closeSocial}><X size={18} /></button>
    </header>
    <div className="drawer-body" role="tabpanel">{tab === 'friends' ? <FriendsTab /> : tab === 'requests' ? <RequestsTab /> : tab === 'messages' ? <MessagesTab /> : tab === 'party' ? <PartyTab /> : <PrivacyTab />}</div>
  </aside>;
}

// ---------------------------------------------------------------- in-world widgets
/** Party members at a glance, with where they are. Tap a name to follow them with the marker. */
export function PartyHud() {
  const party = useSocial(s => s.party), panel = useGame(s => s.panel), phase = useGame(s => s.phase), [collapsed, setCollapsed] = useState(false);
  if (!party || phase !== 'playing' || panel) return null;
  return <aside className={`party-hud${collapsed ? ' collapsed' : ''}`} aria-label="Your party">
    <button className="party-hud-head" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><Users size={14} /><span className="eyebrow">PARTY · {party.members.length}/{party.max}</span>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
    {!collapsed && <>{party.members.filter(m => m.id !== selfConnection()).map(m => <PartyHudRow key={(m.id ?? '') + m.name} m={m} />)}
      {party.members.length === 1 && <small className="muted">Invite people from the People list or with F.</small>}
      <button className="text-button" onClick={() => openSocial('party')}>Manage party</button></>}
  </aside>;
}
function PartyHudRow({ m }: { m: PartyMember }) {
  const where = useWhere(m.id);
  return <button className="party-hud-row" disabled={!m.id} onClick={() => m.id && findPlayer(m.id, m.name)} aria-label={`Show ${m.name} on the map`}>
    <i className={m.away ? 'away' : ''} aria-hidden="true" />{m.leader && <Crown size={11} aria-label="leader" />}<b>{m.name}</b><small>{m.away ? 'reconnecting…' : where ? (where.near ? 'here' : `${where.distance} ${where.direction}`) : ''}</small></button>;
}

/** Party invitations, answered in place. They expire on the room server after a minute. */
export function PartyInvites() {
  const invites = useSocial(s => s.invites), phase = useGame(s => s.phase), [, tick] = useState(0);
  useEffect(() => { if (!invites.length) return; const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, [invites.length]);
  if (!invites.length || phase !== 'playing') return null;
  return <div className="party-invites" role="region" aria-label="Party invitations">{invites.map(i => <div key={i.party} className="party-invite" role="alertdialog" aria-label={`Party invitation from ${i.from.name}`}>
    <Users size={18} /><span><b>{i.from.name}{i.from.handle ? ` (@${i.from.handle})` : ''}</b> invited you to their party<small>{i.size} member{i.size === 1 ? '' : 's'} · {Math.max(0, Math.ceil((i.expires - Date.now()) / 1000))} s</small></span>
    <button className="primary small" onClick={() => void answerInvite(i, true)}>Join</button><button className="secondary small" onClick={() => void answerInvite(i, false)}>Decline</button>
  </div>)}</div>;
}

// ---------------------------------------------------------------- People list actions
/** Contextual actions for a player in the room: friend, party, mute, block and report. */
export function PeerActions({ peer }: { peer: Peer }) {
  const membership = useMembership(), overview = useSocial(s => s.overview), party = useSocial(s => s.party), muted = useGame(s => s.muted), set = useGame(s => s.set);
  const [mode, setMode] = useState<'' | 'block' | 'report'>(''), { pending, error, act } = useAction();
  const friend = !!peer.handle && !!overview?.friends.some(f => f.handle === peer.handle), outgoing = !!peer.handle && !!overview?.outgoing.some(r => r.player.handle === peer.handle);
  const inParty = !!party?.members.some(m => m.id === peer.id), mutedNow = isMuted(muted, peer), member = membership === 'member' && !!peer.handle;
  const toggleMute = () => { const key = muteKey(peer); set({ muted: mutedNow ? muted.filter(k => k !== key && k !== peer.id) : [...muted, key] }); };
  // The room's own report log gets the player's recent public chat as context.
  const roomReport = () => { send({ type: 'report', id: peer.id, context: 'player-list', reason: 'Inappropriate behaviour reported through the People list' }); };
  return <>
    <span className="row-actions">
      {member && (friend ? <span className="status-tag" title="Friends"><UserCheck size={11} />Friend</span> : outgoing ? <span className="status-tag">Requested</span>
        : <button className="icon-button" aria-label={`Add ${peer.name} as a friend`} title="Add friend" disabled={pending} onClick={() => void act(() => sendFriendRequest(peer.handle!)).then(r => { if (r) useGame.getState().notify(r.relationship === 'friends' ? `You and ${peer.name} are now friends.` : `Friend request sent to ${peer.name}.`); })}><UserPlus size={16} /></button>)}
      {!inParty && <button className="icon-button" aria-label={`Invite ${peer.name} to your party`} title="Invite to party" onClick={() => void inviteToParty(peer.id)}><Users size={16} /></button>}
      {peer.handle && <button className="icon-button" aria-label={`View ${peer.name}'s profile`} title="View profile" onClick={() => set({ panel: 'player:' + peer.handle })}><UserRound size={16} /></button>}
      <button className="icon-button" aria-label={mutedNow ? `Unmute ${peer.name}` : `Mute ${peer.name}`} title={mutedNow ? 'Unmute chat (this device)' : 'Mute chat (this device)'} onClick={toggleMute}>{mutedNow ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
      {member && <button className="icon-button" aria-label={`Block ${peer.name}`} title="Block" onClick={() => setMode(mode === 'block' ? '' : 'block')}><Ban size={16} /></button>}
      <button className="icon-button" aria-label={`Report ${peer.name}`} title="Report player" onClick={() => setMode(mode === 'report' ? '' : 'report')}><Flag size={16} /></button>
    </span>
    {mode === 'block' && peer.handle && <div className="row-detail"><Confirm text={`Block ${peer.name}? Neither of you will see the other’s room chat, messages or invitations, and any friendship ends. They aren’t told.`} action="Block" pending={pending}
      onCancel={() => setMode('')} onConfirm={() => void act(async () => { const s = await getCommunityService(); const p = await s.profile(peer.handle!); if (!p) throw new Error('That player no longer has a profile.'); await blockPlayer(p.id); }).then(() => setMode(''))} /></div>}
    {mode === 'report' && <div className="row-detail">{member ? <ReportByHandle handle={peer.handle!} name={peer.name} onRoomReport={roomReport} onDone={() => setMode('')} />
      : <Confirm text={`Report ${peer.name} to the room operator? Their last few room chat messages are included.`} action="Send report" onCancel={() => setMode('')} onConfirm={() => { roomReport(); setMode(''); }} />}</div>}
    {error && <p className="form-error row-detail" role="alert">{error}</p>}
  </>;
}
function ReportByHandle({ handle, name, onDone, onRoomReport }: { handle: string; name: string; onDone: () => void; onRoomReport: () => void }) {
  const [user, setUser] = useState<string | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { getCommunityService().then(s => s.profile(handle)).then(p => (p ? setUser(p.id) : setFailed(true)), () => setFailed(true)); }, [handle]);
  // Without the account service, fall back to the room's own report log.
  if (failed) return <Confirm text={`Report ${name} to the room operator?`} action="Send report" onCancel={onDone} onConfirm={() => { onRoomReport(); onDone(); }} />;
  if (!user) return <Loading label="One moment…" />;
  return <ReportForm user={user} name={name} context="room-chat" onSent={onRoomReport} onDone={onDone} />;
}

/** Friend, message, block and report actions on a player's profile card. */
export function RelationshipActions({ profile }: { profile: ProfileBrief & { relationship?: string | null } }) {
  const membership = useMembership(), [relationship, setRelationship] = useState(profile.relationship ?? 'none'), [mode, setMode] = useState<'' | 'block' | 'report'>('');
  const { pending, error, act } = useAction();
  useEffect(() => setRelationship(profile.relationship ?? 'none'), [profile.relationship]);
  if (membership !== 'member' || relationship === 'self' || !communityConfigured) return null;
  const run = (fn: () => Promise<{ relationship: string }>) => void act(fn).then(r => { if (r) { setRelationship(r.relationship); setMode(''); } });
  const incoming = useSocial.getState().overview?.incoming.find(r => r.player.id === profile.id);
  return <div className="relationship-actions">
    {relationship === 'none' && <button className="secondary" disabled={pending} onClick={() => run(() => sendFriendRequest(profile.handle))}><UserPlus size={15} />Add friend</button>}
    {relationship === 'incoming' && incoming && <button className="secondary" disabled={pending} onClick={() => run(() => respondFriendRequest(incoming.id, true))}><Check size={15} />Accept friend request</button>}
    {relationship === 'outgoing' && <button className="secondary" disabled={pending} onClick={() => run(() => cancelFriendRequest(profile.id))}>Cancel request</button>}
    {relationship === 'friends' && <button className="secondary" disabled={pending} onClick={() => { useGame.getState().set({ panel: null }); void act(() => startConversation(profile.id)); }}><MessageCircle size={15} />Message</button>}
    {relationship === 'blocked' ? <button className="text-button" disabled={pending} onClick={() => run(() => unblockPlayer(profile.id))}>Unblock</button>
      : <button className="text-button" onClick={() => setMode(mode === 'block' ? '' : 'block')}><Ban size={14} />Block</button>}
    <button className="text-button" onClick={() => setMode(mode === 'report' ? '' : 'report')}><Flag size={14} />Report</button>
    {mode === 'block' && <Confirm text={`Block ${profile.display_name}? Neither of you will see the other’s room chat, messages or invitations, and any friendship ends.`} action="Block" pending={pending} onCancel={() => setMode('')} onConfirm={() => run(() => blockPlayer(profile.id))} />}
    {mode === 'report' && <ReportForm user={profile.id} name={profile.display_name} context="profile" onDone={() => setMode('')} />}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

/** Room / Party channel switch for the chat panel. */
export function ChannelTabs({ children }: { children?: ReactNode }) {
  const channel = useSocial(s => s.chatChannel), party = useSocial(s => s.party);
  return <div className="segments channel-tabs" role="tablist" aria-label="Chat channel">
    <button role="tab" aria-selected={channel === 'room'} className={channel === 'room' ? 'selected' : ''} onClick={() => useSocial.setState({ chatChannel: 'room' })}>Room chat</button>
    <button role="tab" aria-selected={channel === 'party'} className={channel === 'party' ? 'selected' : ''} disabled={!party} title={party ? undefined : 'Join a party to use party chat'} onClick={() => useSocial.setState({ chatChannel: 'party' })}>Party chat</button>
    {children}
  </div>;
}
