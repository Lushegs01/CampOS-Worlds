import { useEffect, useRef } from 'react';
import { ArrowUp, Check, Circle, ClipboardList, Crosshair, MapPin, Shield, X } from 'lucide-react';
import { INDUSTRIAL_LOCATION, OBJECTIVES, O, distance } from '../../shared/getaway.mjs';
import { WEAPON_BY_ID } from '../../shared/arena/weapons.mjs';
import { input, player, useGame } from '../state';
import { currentVehicle, useVehicle } from '../vehicles/client';
import { activeCombat, command, equip, heldFire, openMissionJournal, setAim, useGetaway, type Point, type Report } from './client';
import { SpokenLine } from '../audio/SpokenLine';
import { SADE } from './dialogue';
import './mission.css';

export function MissionButton() {
  return <button onClick={() => openMissionJournal()}><ClipboardList size={19}/><span>Campaign</span></button>;
}
function Guide({ target }: { target: Point }) {
  const arrow = useRef<SVGSVGElement>(null), label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      const yaw = input.yaw + Math.PI - Math.atan2(target.x - player.x, target.z - player.z);
      if (arrow.current) arrow.current.style.transform = `rotate(${yaw}rad)`;
      if (label.current) label.current.textContent = `${Math.round(distance(target, player))} m`;
    };
    update(); const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [target.x, target.z]);
  return <div className="getaway-guide"><ArrowUp size={17} ref={arrow}/><span ref={label}/></div>;
}
export function TouchCombat() {
  const live = useGetaway(s => activeCombat(s.mission)), aim = useGetaway(s => s.aim);
  if (!live) return null;
  return <>
    <button type="button" aria-label="Switch weapon" onClick={() => equip()}>Swap</button>
    <button type="button" onClick={() => command('reload')}>Reload</button>
    <button type="button" aria-pressed={aim} onClick={() => setAim(!aim)}>Aim</button>
    <button type="button" className="getaway-touch-fire" aria-label="Fire" onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); heldFire(true); }}
      onPointerUp={() => heldFire(false)} onPointerCancel={() => heldFire(false)} onLostPointerCapture={() => heldFire(false)}><Crosshair size={24}/><span>Fire</span></button>
  </>;
}
function Statistics({ report }: { report: Report }) {
  const minutes = Math.floor(report.duration / 60);
  const seconds = Math.floor(report.duration % 60).toString().padStart(2, '0');
  return <>
    <dl className="getaway-stats">
      <div><dt>Duration</dt><dd>{minutes}:{seconds}</dd></div>
      <div><dt>Enemies defeated</dt><dd>{report.defeated}</dd></div>
      <div><dt>Distance driven</dt><dd>{report.distance} m</dd></div>
      <div><dt>Top speed</dt><dd>{report.topSpeed} km/h</dd></div>
      <div><dt>Collisions</dt><dd>{report.crashes}</dd></div>
    </dl>
    <p className="getaway-bonus">{report.blastKills ? 'Optional objective complete · Defeat a reinforcement with the fuel drum' : 'Optional objective missed · Defeat a reinforcement with the fuel drum'}</p>
  </>;
}
function SadeLine({ line }: { line: keyof typeof SADE }) {
  return <div className="getaway-dialogue">
    <b>Sade</b>
    {SADE[line].map(text => <p key={text}>{text}</p>)}
    <SpokenLine key={line} id={`voice/sade/${line}`} speaker="Sade" />
  </div>;
}
export default function GetawayHud() {
  const { mission, history, resume, brief, journal, aim } = useGetaway();
  const phase = useGame(s => s.phase), panel = useGame(s => s.panel), status = useGame(s => s.status);
  const vehicleId = useVehicle(s => s.id);
  const car = mission?.vehicles.find(v => v.id === vehicleId), vehicle = currentVehicle();
  if (phase !== 'playing' || panel) return null;
  const stage = mission?.stage ?? 0;
  const dialogue = brief || journal || mission?.paused || mission?.failed || stage >= O.commit;
  const recentlyHurt = mission?.events.some(e => e.kind === 'hurt');
  const close = () => {
    if (brief) command('closeBrief');
    if (journal || mission?.paused) openMissionJournal(false);
  };
  const activate = (action: string) => { useGetaway.setState({ journal: false }); command(action); };
  return <>
    {mission && !dialogue && <aside className="getaway-hud" aria-label="The Getaway objectives">
      <div className="getaway-hud-header"><span>SHADOW PROTOCOL</span><button aria-label="Open mission journal" onClick={() => openMissionJournal()}><ClipboardList size={17}/></button></div>
      <h2>{OBJECTIVES[stage][0]}</h2><p>{OBJECTIVES[stage][1]}</p>
      {mission.mark && <Guide target={mission.mark}/>}
      {mission.wanted > 0 && <div className="getaway-wanted">
        <span aria-label={`Wanted level ${mission.wanted}`}>{[1,2,3].map(i => <Shield key={i} size={17} fill={mission.wanted >= i ? 'currentColor' : 'none'} opacity={mission.wanted >= i ? 1 : .28}/>)}</span>
        <b>{mission.wanted === 1 ? 'Alarm reported' : mission.spotted ? 'Police have visual' : mission.escape > 0 ? 'Evading police' : 'Police searching'}</b>
        {mission.closest !== null && <small>Nearest unit · {mission.closest} m</small>}
        {mission.escape > 0 && <progress aria-label="Evasion progress" value={mission.escape} max={1}/>}
      </div>}
      {mission.carried && <small className="getaway-case-status"><Check size={12}/> Case secured</small>}
    </aside>}
    {mission && !dialogue && (activeCombat(mission) || !!vehicle) && <div className="getaway-vitals">
      <span><b>{mission.health}</b> HP</span><progress aria-label="Health" value={mission.health} max={100}/>
      {activeCombat(mission) && !vehicle && <><b>{WEAPON_BY_ID.get(mission.gun.id)?.name}</b><span><b>{mission.gun.mag}</b> / {mission.gun.reserve}{mission.reloading > 0 && ' · Reloading'}</span></>}
      {vehicle && <span><b>{Math.round(Math.abs(vehicle.speed)*3.6)}</b> km/h {car && <>· {Math.round(car.condition)}% condition</>}</span>}
    </div>}
    {activeCombat(mission) && !dialogue && !vehicle && <div aria-hidden className={`getaway-reticle${aim ? ' aimed' : ''}`}><i/><i/><i/><i/></div>}
    {recentlyHurt && <div className="getaway-hurt" aria-hidden/>}
    {dialogue && <div className="getaway-scrim"><section className="getaway-dialog" role="dialog" aria-modal="true" aria-label="The Getaway">
      <header><span>SHADOW PROTOCOL · CHAPTER I</span>{stage < O.commit && !mission?.failed && <button aria-label="Close mission journal" onClick={close}><X size={20}/></button>}</header>
      <h2>The Getaway</h2>
      {brief ? <>
        <SadeLine line="briefing" />
        <footer><button className="primary" onClick={() => activate('accept')}>Accept assignment</button><button onClick={close}>Walk away</button></footer>
      </> : stage >= O.commit ? <>
        <SadeLine line="delivery" />
        {mission?.report && <Statistics report={mission.report}/>}
        {stage === O.commit ? <p role="status">{mission?.saveError ? 'Delivery verified. The account service could not save your reward.' : 'Delivery verified. Saving your campaign progress…'}</p>
          : <p role="status">{mission?.reward?.saved ? mission.reward.first ? '+500 campaign XP · +250 credits · Loose ends · Next contact unlocked' : 'Replay complete. Your first completion reward is already saved.' : 'Guest run complete. Sign in before starting a run to earn account rewards.'}</p>}
        <footer>{mission?.saveError && <button className="primary" onClick={() => command('save')}>Retry reward save</button>}{stage === O.complete && <button className="primary" onClick={() => activate('leave')}>Return to free roam</button>}</footer>
      </> : <>
        {mission?.failed ? <p className="getaway-error" role="alert">{mission.failed}</p>
          : mission?.paused ? <p>Paused at {OBJECTIVES[stage][0].toLowerCase()}.</p>
          : history ? <p>Completed · {history.xp} campaign XP · {history.credits} credits · {history.milestone}</p>
          : <p>A freight pickup turns into an escape through the Industrial District.</p>}
        <ol className="getaway-objectives">{OBJECTIVES.map(([title], index) => <li key={title} aria-current={index === stage ? 'step' : undefined}>
          {(index < stage || !mission && !!history) ? <Check size={15}/> : <Circle size={12}/>} {title}</li>)}</ol>
        {!mission && history && <Statistics report={history.report}/>}
        {mission && <p>{OBJECTIVES[stage][1]} Optional objective · Defeat a reinforcement with the fuel drum.</p>}
        {mission && <p className="getaway-keys"><kbd>1–3</kbd> Equip <kbd>R</kbd> Reload <kbd>Left click</kbd> Fire <kbd>Right click</kbd> Aim <kbd>Space</kbd> Brake</p>}
        <footer>{mission ? <>
          {!mission.failed && <button className="primary" onClick={close}>Resume</button>}
          <button className={mission.failed ? 'primary' : undefined} onClick={() => activate('retry')}>Retry checkpoint</button>
          <button onClick={() => activate('abandon')}>Abandon run</button>
        </> : <>
          {resume !== null && <button className="primary" onClick={() => activate('resume')}>Resume checkpoint</button>}
          <button className={resume === null ? 'primary' : undefined} onClick={() => { useGame.getState().set({ destination: INDUSTRIAL_LOCATION.id }); close(); }}><MapPin size={15}/> {history ? 'Find Sade to replay' : 'Mark the freight gate'}</button>
        </>}</footer>
        {!mission && status !== 'connected' && <small>Connect to the campus room to play.</small>}
      </>}
    </section></div>}
  </>;
}
