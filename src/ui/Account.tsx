import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Award, Check, Footprints, Gem, LogOut, Mail, PencilLine, ShieldCheck, UserRound } from 'lucide-react';
import { sanitizeAvatar } from '../../shared/campus.mjs';
import { useGame, type AvatarConfig } from '../state';
import { useAccount, signIn, signUp, signOut, saveProfile, checkHandle, reloadProfile } from '../account/store';
import { getCommunityService, NOT_CONFIGURED } from '../services/community';
import { ACHIEVEMENTS, type AchievementId, type ProfileBrief, type ProfileCard } from '../services/types';
import { assetUrl } from '../world/assets';
import AvatarEditor from './AvatarEditor';
import { Failure, Loading, useAction, useLoad } from './async';

const HANDLE = /^[a-z0-9_]{3,20}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BADGE_ICONS: Record<AchievementId, typeof Award> = { 'campus-compass': Footprints, 'curious-mind': Gem, courtside: Award };
const joined = (iso: string) => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(iso));

/** Character portrait framed in the player's accent colour (reuses the avatar editor's art). */
export function Portrait({ person, size = 56 }: { person: Pick<ProfileBrief, 'display_name' | 'avatar'>; size?: number }) {
  const avatar = sanitizeAvatar(person.avatar);
  return <span className="portrait" style={{ width: size, height: size, borderColor: avatar.accent }}><img src={assetUrl(`characters/${avatar.model}.webp`)} alt="" /><span className="sr-only">{person.display_name}</span></span>;
}

function Badges({ list }: { list: ProfileCard['achievements'] }) {
  return <div className="badges">{(Object.keys(ACHIEVEMENTS) as AchievementId[]).map(id => {
    const earned = list.find(a => a.id === id), Icon = BADGE_ICONS[id];
    return <div key={id} className={earned ? 'badge earned' : 'badge'}><Icon size={28} /><b>{ACHIEVEMENTS[id].name}</b><span>{earned ? <><ShieldCheck size={12} /> Verified {new Date(earned.awarded_at).toLocaleDateString()}</> : ACHIEVEMENTS[id].text}</span></div>;
  })}</div>;
}

/** A player's public profile: what anyone may see. */
export function ProfileView({ profile, own = false }: { profile: ProfileCard; own?: boolean }) {
  return <div className="profile-card">
    <div className="profile-heading"><Portrait person={profile} size={64} /><div><span className="eyebrow">{own ? 'YOUR PROFILE' : 'CAMPUS PROFILE'}</span><h3>{profile.display_name}</h3><p>@{profile.handle} · Joined {joined(profile.created_at)}</p></div></div>
    {profile.bio ? <p className="profile-bio">{profile.bio}</p> : own && <p className="muted small-text">Add a short bio so people know what you’re into.</p>}
    <div className="detail-grid"><div><strong>{profile.achievements.length}<small> / 3</small></strong><span>Verified badges</span></div><div><strong>{profile.stats.best_hoops_round}</strong><span>Best basketball round</span></div><div><strong>{profile.clubs?.length ?? 0}</strong><span>Clubs</span></div></div>
    <h3>Badges</h3><Badges list={profile.achievements} />
    {!!profile.clubs?.length && <><h3>Clubs</h3><div className="chip-row">{profile.clubs.map(c => <span key={c.id} className="chip" style={{ borderColor: c.color }}><i style={{ background: c.color }} />{c.name}{c.role !== 'member' && <small>{c.role}</small>}</span>)}</div></>}
  </div>;
}

/** Another player's card, by handle (People panel, attendee lists, club members). */
export function PlayerCard({ handle }: { handle: string }) {
  const { data, error, loading, reload } = useLoad(async () => (await getCommunityService()).profile(handle), [handle]);
  if (loading && !data) return <Loading label="Loading profile…" />;
  if (error) return <Failure message={error} retry={reload} />;
  if (!data) return <div className="empty-state"><UserRound size={28} /><p>No campus profile with the handle @{handle}.</p></div>;
  return <ProfileView profile={data} />;
}

function AuthForm() {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in'), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false), [confirm, setConfirm] = useState('');
  const { pending, error, setError, act } = useAction();
  const emailError = !EMAIL.test(email.trim()) ? 'Enter a valid email address.' : '';
  const passwordError = mode === 'register' && password.length < 8 ? 'Use at least 8 characters.' : !password ? 'Enter your password.' : '';
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (emailError || passwordError) return;
    if (mode === 'sign-in') await act(() => signIn(email, password));
    else { const needsConfirmation = await act(() => signUp(email, password)); if (needsConfirmation) setConfirm(email.trim()); }
  };
  if (confirm) return <div className="auth-done"><Mail size={30} /><h3>Check your inbox.</h3><p>We sent a confirmation link to <b>{confirm}</b>. Open it, then sign in here to create your profile.</p><button className="secondary" onClick={() => { setConfirm(''); setMode('sign-in'); setPassword(''); }}>Back to sign in</button></div>;
  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="segments" role="tablist" aria-label="Account">{(['sign-in', 'register'] as const).map(m => <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'selected' : ''} onClick={() => { setMode(m); setError(''); setTouched(false); }}>{m === 'sign-in' ? 'Sign in' : 'Create account'}</button>)}</div>
    <label className="field">Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={touched && !!emailError} />{touched && emailError && <small className="field-error">{emailError}</small>}</label>
    <label className="field">Password<input type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} aria-invalid={touched && !!passwordError} />{touched && passwordError ? <small className="field-error">{passwordError}</small> : mode === 'register' && <small className="muted">At least 8 characters.</small>}</label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary wide" disabled={pending}>{pending ? 'One moment…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}<ArrowRight size={16} /></button>
    <p className="muted small-text">An account keeps your name, look, badges, clubs and RSVPs with you on any device. You can always keep exploring as a guest instead.</p>
  </form>;
}

const suggestHandle = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20).padEnd(3, '_');

/** Create or edit the signed-in player's profile, with a live preview of their appearance. */
export function ProfileEditor({ onDone }: { onDone?: () => void }) {
  const existing = useAccount(s => s.profile), game = useGame.getState();
  const [handle, setHandle] = useState(existing?.handle ?? suggestHandle(game.name)), [name, setName] = useState(existing?.display_name ?? game.name.slice(0, 32));
  const [bio, setBio] = useState(existing?.bio ?? ''), [avatar, setAvatar] = useState<AvatarConfig>(sanitizeAvatar(existing?.avatar ?? game.avatar));
  const [availability, setAvailability] = useState<{ checking: boolean; available?: boolean; reason?: string }>({ checking: false });
  const { pending, error, act } = useAction(), [touched, setTouched] = useState(false);
  const handleError = !HANDLE.test(handle) ? 'Use 3–20 lower-case letters, numbers or underscores.' : availability.available === false ? availability.reason ?? 'That handle is taken.' : '';
  const nameError = !name.trim() ? 'Choose a display name.' : name.trim().length > 32 ? 'Display names are up to 32 characters.' : '';
  useEffect(() => {
    if (!HANDLE.test(handle) || handle === existing?.handle) { setAvailability({ checking: false }); return; }
    setAvailability({ checking: true });
    const t = setTimeout(() => { checkHandle(handle).then(r => setAvailability({ checking: false, ...r }), () => setAvailability({ checking: false })); }, 350);
    return () => clearTimeout(t);
  }, [handle, existing?.handle]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (handleError || nameError) return;
    const saved = await act(() => saveProfile({ handle, display_name: name.trim(), bio: bio.trim(), avatar }));
    if (saved) { useGame.getState().notify(existing ? 'Profile saved.' : `Welcome to campus, ${saved.display_name}.`); onDone?.(); }
  };
  return <form className="profile-editor" onSubmit={submit} noValidate>
    {!existing && <p className="muted">Choose how other explorers will know you. Your handle is unique and appears on your profile card.</p>}
    <div className="form-grid">
      <label className="field">Handle<span className="input-prefix"><b>@</b><input value={handle} maxLength={20} autoCapitalize="off" spellCheck={false} onChange={e => setHandle(e.target.value.toLowerCase().replace(/\s/g, '_'))} aria-invalid={touched && !!handleError} /></span>
        {(touched || availability.available === false) && handleError ? <small className="field-error">{handleError}</small> : availability.checking ? <small className="muted">Checking…</small> : availability.available ? <small className="field-ok"><Check size={12} /> Available</small> : <small className="muted">Lower-case letters, numbers and underscores.</small>}</label>
      <label className="field">Display name<input value={name} maxLength={32} onChange={e => setName(e.target.value)} aria-invalid={touched && !!nameError} />{touched && nameError && <small className="field-error">{nameError}</small>}</label>
    </div>
    <label className="field">Bio <small className="muted">{bio.length} / 280</small><textarea value={bio} maxLength={280} rows={3} onChange={e => setBio(e.target.value)} placeholder="Studying architecture. Always up for a game of hoops." /></label>
    <AvatarEditor value={avatar} onChange={setAvatar} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions">{existing && <button type="button" className="secondary" onClick={onDone}>Cancel</button>}<button className="primary" disabled={pending}>{pending ? 'Saving…' : existing ? 'Save profile' : 'Create profile'}<ArrowRight size={16} /></button></div>
  </form>;
}

/** The account panel: sign in / register, profile creation, and the signed-in summary. */
export function AccountPanel({ initial = 'view' }: { initial?: 'view' | 'edit' }) {
  const status = useAccount(s => s.status), profile = useAccount(s => s.profile), profileState = useAccount(s => s.profileState), accountError = useAccount(s => s.error), room = useAccount(s => s.room), email = useAccount(s => s.email);
  const [editing, setEditing] = useState(initial === 'edit');
  const { pending, act } = useAction();
  if (status === 'unconfigured') return <div className="empty-state"><ShieldCheck size={30} /><h3>Accounts aren’t available here yet.</h3><p>{NOT_CONFIGURED}</p><small>Operators: see docs/ACCOUNTS.md to connect a Supabase project.</small></div>;
  if (status === 'loading') return <Loading label="Checking your account…" />;
  if (status === 'guest') return <><AuthForm />{accountError && <p className="form-error">{accountError}</p>}</>;
  if (profileState === 'loading' && !profile) return <Loading label="Loading your profile…" />;
  if (profileState === 'error' && !profile) return <Failure message={accountError} retry={() => void reloadProfile()} />;
  if (!profile || editing) return <ProfileEditor onDone={() => setEditing(false)} />;
  return <div>
    <ProfileView profile={profile} own />
    {room.message && <p className="note small-text">{room.message}</p>}
    <div className="form-actions"><button className="secondary" onClick={() => setEditing(true)}><PencilLine size={16} />Edit profile</button><button className="text-button" disabled={pending} onClick={() => void act(signOut)}><LogOut size={15} />Sign out{email ? ` (${email})` : ''}</button></div>
  </div>;
}
