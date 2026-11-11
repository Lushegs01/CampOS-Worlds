// The deployment screen: shown from the moment the server assigns a match until the player is spawned and in
// control. Every line on it is a real stage of src/arena/deploy.ts; the bar moves only with files that have
// actually arrived. When a stage takes longer than it should, it says so and offers a way out; when it fails,
// it shows the reason and, where it can help, Retry.
import { useEffect, useState } from 'react';
import { Check, LoaderCircle, RotateCw, LogOut, AlertTriangle, Copy, Wifi } from 'lucide-react';
import { useDeploy, recentDeployments, type Stage } from './deploy';
import { useArena } from './store';
import { retryDeploy, leaveMatch } from './net';
import { MapPlan } from './MapPlan';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { MODE_BY_ID } from '../../shared/arena/rules.mjs';

const ORDER: Stage[] = ['requesting', 'loading-code', 'preparing', 'synchronizing', 'deployed'];
const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'requesting', label: 'Secure session and match' },
  { stage: 'loading-code', label: 'Connecting to the arena' },
  { stage: 'preparing', label: 'Preparing the environment' },
  { stage: 'synchronizing', label: 'Synchronizing with the match' },
];
const mb = (b: number) => (b / 1e6).toFixed(b < 1e7 ? 1 : 0);

export default function DeployScreen() {
  const d = useDeploy(), match = useArena(s => s.match), sceneReady = useArena(s => s.sceneReady), status = useArena(s => s.status);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 500); return () => clearInterval(t); }, []);
  const [copied, setCopied] = useState(false);
  // After deploying, a graphics change rebuilds the 3D view: a quiet notice, not the deployment screen.
  if (d.stage === 'deployed' || d.stage === 'idle') return sceneReady ? null : <div className="ar-rebuild" role="status"><LoaderCircle className="ar-spin" size={16} />Applying graphics settings…</div>;
  const map = match ? MAP_BY_ID.get(match.map) : null, mode = match ? MODE_BY_ID.get(match.mode) : null;
  const at = d.stage === 'recovering' ? ORDER.indexOf(d.resumeStage ?? 'preparing') : d.stage === 'failed' ? ORDER.indexOf(failedAt(d.marks)) : ORDER.indexOf(d.stage);
  const elapsed = Math.max(0, (performance.now() - d.startedAt) / 1000);
  const filePct = d.files.total ? Math.min(100, Math.round(d.files.done / d.files.total * 100)) : 0;
  const kind = match?.kind === 'training' ? 'Training' : match?.kind === 'private' ? `Private match · ${match.code}` : 'Quick Play';
  const copy = async () => { try { await navigator.clipboard.writeText(JSON.stringify(recentDeployments().slice(-3), null, 1)); setCopied(true); } catch { setCopied(false); } };
  return <div className="ar-deploy ar-scene-loading" data-deploy-overlay data-stage={d.stage} role="dialog" aria-modal="true" aria-labelledby="ar-deploy-title" aria-describedby="ar-deploy-status">
    {match && <MapPlan mapId={match.map} zones={match.mode === 'dom'} className="ar-deploy-plan" />}
    <div className="ar-deploy-card">
      <header>
        <span className="ar-eyebrow">COMBAT ARENA · {d.stage === 'failed' ? 'DEPLOYMENT STOPPED' : d.stage === 'recovering' ? 'RECONNECTING' : 'DEPLOYING'}</span>
        <h2 id="ar-deploy-title">{map?.name ?? 'Combat Arena'}</h2>
        <p className="ar-deploy-meta">{mode?.name ?? ''}{mode ? ' · ' : ''}{kind}{match ? ` · ${match.players.length} in match` : ''}</p>
      </header>
      <ol className="ar-deploy-steps">
        {STEPS.map((s, i) => {
          const state = i < at ? 'done' : i === at ? (d.stage === 'failed' ? 'failed' : 'active') : 'todo';
          return <li key={s.stage} className={state}>
            <span className="ar-step-icon" aria-hidden="true">{state === 'done' ? <Check size={14} /> : state === 'failed' ? <AlertTriangle size={14} /> : state === 'active' ? <LoaderCircle className="ar-spin" size={14} /> : null}</span>
            <span className="ar-step-label">{s.label}{state === 'done' && d.marks[ORDER[i + 1]] != null && <small>{(d.marks[ORDER[i + 1]] / 1000).toFixed(1)} s</small>}</span>
            {s.stage === 'preparing' && state === 'active' && <div className="ar-step-detail">
              <div className="ar-bar" role="progressbar" aria-label="Required files downloaded" aria-valuemin={0} aria-valuemax={d.files.total} aria-valuenow={d.files.done}><i style={{ width: `${filePct}%` }} /></div>
              <small>{d.files.total ? `${d.files.done} of ${d.files.total} files` : 'Using files already on this device'} · {mb(d.bytes)} MB{d.tier === 'mobile' ? ' · phone textures' : ''}{d.retries ? ` · ${d.retries} retried` : ''}{d.pending.filter(p => p !== 'soldiers').length ? ` · ${d.pending.filter(p => p !== 'soldiers').join(', ')}` : ''}</small>
            </div>}
          </li>;
        })}
      </ol>
      <p id="ar-deploy-status" className="ar-deploy-status" role="status">
        {d.stage === 'failed' ? null : d.stage === 'recovering' ? <><Wifi size={14} />Connection lost. Reconnecting — your place in the match is kept for a minute.</>
          : d.slow ? <><AlertTriangle size={14} />{d.stage === 'preparing' ? 'This is taking longer than usual: your connection looks slow. Downloads continue, and anything you have already received is kept.' : d.stage === 'synchronizing' ? 'Waiting for the match to confirm your arrival…' : d.stage === 'requesting' ? 'The arena is slow to answer…' : 'Still working on it…'}</>
          : <>{elapsed.toFixed(0)} s{status !== 'ready' ? ' · reconnecting' : ''}</>}
      </p>
      {d.stage === 'failed' && d.failure && <div className="ar-deploy-error" role="alert">
        <b>{d.failure.message}</b>
        {d.failure.detail && <small>{d.failure.detail}</small>}
      </div>}
      <div className="ar-deploy-actions">
        {d.stage === 'failed' && d.failure?.retry && <button className="ar-primary" onClick={retryDeploy}><RotateCw size={16} />Retry</button>}
        {(d.stage === 'failed' || d.slow || elapsed > 8) && <button className="ar-secondary" onClick={() => void leaveMatch()}><LogOut size={16} />{d.stage === 'failed' ? 'Back to the lobby' : 'Leave'}</button>}
        {d.stage === 'failed' && <button className="ar-ghost" onClick={copy}><Copy size={14} />{copied ? 'Copied' : 'Copy diagnostics'}</button>}
      </div>
    </div>
  </div>;
}
/** The stage a failed deployment had reached (the last one with a mark). */
function failedAt(marks: Record<string, number>): Stage {
  let last: Stage = 'requesting';
  for (const s of ORDER) if (marks[s] != null) last = s;
  return last;
}
