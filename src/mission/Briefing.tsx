// Act 1 on campus: an incoming message briefs the player and sets the route to Sade in Metropolitan City. Also the
// location banner that marks the journey (leaving the university, the Gateway Expressway, each city district).
import { useEffect, useRef, useState } from 'react';
import { MapPin, MessageSquare, X } from 'lucide-react';
import { CONTACT, INDUSTRIAL_LOCATION } from '../../shared/getaway.mjs';
import { metroDistrictAt, regionAt } from '../../shared/metro.mjs';
import { roadRoute } from '../../shared/expansion.mjs';
import { player, useGame } from '../state';
import { useGetaway } from './client';

const SEEN = 'campos-getaway-brief-seen';
function seen() { try { return sessionStorage.getItem(SEEN) === '1'; } catch { return false; } }
function remember() { try { sessionStorage.setItem(SEEN, '1'); } catch { /* private mode: shown again next session */ } }

export function IncomingBrief() {
  const mission = useGetaway(s => s.mission), history = useGetaway(s => s.history), resume = useGetaway(s => s.resume);
  const status = useGame(s => s.status), destination = useGame(s => s.destination);
  const [open, setOpen] = useState(false), [km, setKm] = useState<number | null>(null);
  useEffect(() => {
    if (mission || history || resume !== null || status !== 'connected' || seen()) return;
    // A moment after arriving on campus, not over the loading screen.
    const t = setTimeout(() => { if (regionAt(player.x, player.z) === 'campus') { setOpen(true); setKm(Math.round(roadRoute(player, CONTACT).distance / 100) / 10); } }, 6000);
    return () => clearTimeout(t);
  }, [mission, history, resume, status]);
  if (!open) return null;
  const close = () => { remember(); setOpen(false); };
  return <section className="getaway-incoming" role="dialog" aria-label="Incoming message">
    <header><MessageSquare size={16}/><span>Unknown number · Shadow Protocol</span><button aria-label="Dismiss" onClick={close}><X size={16}/></button></header>
    <p>“They tell me you can drive and keep your mouth shut. There’s work off campus tonight. Come to Metropolitan City, Saltworks Café on Harbour Exchange. Ask for Sade.”</p>
    <ol className="getaway-route">
      <li>Òrìṣun University</li><li>South Gate</li><li>Gateway Expressway</li><li>Metropolitan City · Commercial District</li>
    </ol>
    <small>{km !== null ? `${km} km by road · take a car from any campus car park` : 'Take a car from any campus car park'}</small>
    <footer>
      <button className="primary" onClick={() => { useGame.getState().set({ destination: INDUSTRIAL_LOCATION.id }); close(); }}>
        <MapPin size={15}/> {destination === INDUSTRIAL_LOCATION.id ? 'Route set' : 'Set route to Sade'}</button>
      <button onClick={close}>Later</button>
    </footer>
  </section>;
}

const label = (x: number, z: number) => {
  const r = regionAt(x, z);
  if (r === 'campus') return { key: 'campus', title: 'Òrìṣun University', sub: 'Campus' };
  const d = metroDistrictAt(x, z);
  if (r === 'expressway') return { key: 'expressway', title: 'Gateway Expressway', sub: 'Leaving Òrìṣun University' };
  return { key: 'metro:' + (d?.id ?? ''), title: d?.name ?? 'Metropolitan City', sub: 'Metropolitan City' };
};
export function RegionBanner() {
  const [shown, setShown] = useState<{ title: string; sub: string; at: number } | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      if (useGame.getState().phase !== 'playing') return;
      const l = label(player.x, player.z);
      if (last.current === null) { last.current = l.key; return; }
      if (l.key !== last.current) { last.current = l.key; setShown({ title: l.title, sub: l.sub, at: performance.now() }); }
    }, 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (!shown) return; const t = setTimeout(() => setShown(null), 4200); return () => clearTimeout(t); }, [shown]);
  if (!shown) return null;
  return <div className="getaway-region" role="status" key={shown.at}><small>{shown.sub}</small><b>{shown.title}</b></div>;
}
