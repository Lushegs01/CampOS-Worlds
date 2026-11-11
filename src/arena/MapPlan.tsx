// A map's tactical plan, drawn from its real collision boxes (shared/arena/maps.mjs): structures by height, cover,
// both teams' spawn sides and the Domination zones. Used by the lobby's map cards and the deployment screen, so what
// the player sees is the actual layout they are about to fight on.
import { memo } from 'react';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';

type Box = { min: number[]; max: number[]; mat: string };
type Spawn = { x: number; z: number; team: number; forward?: boolean };
type Obj = { id: string; x: number; z: number; r: number };

export const MapPlan = memo(function MapPlan({ mapId, zones = false, className = '' }: { mapId: string; zones?: boolean; className?: string }) {
  const map = MAP_BY_ID.get(mapId) as { bounds: number[]; boxes: Box[]; spawns: Spawn[]; objectives: Obj[] } | undefined;
  if (!map) return null;
  const [x0, z0, x1, z1] = map.bounds, pad = 2;
  // Tallest last so roofs and walls sit over low cover.
  const boxes = [...map.boxes].filter(b => b.max[1] - b.min[1] > .2 && b.mat !== 'perimeter').sort((a, b) => a.max[1] - b.max[1]);
  const tone = (b: Box) => { const h = b.max[1]; return b.mat === 'roof' ? 'roof' : h > 4 ? 'tall' : h > 1.6 ? 'mid' : 'low'; };
  return <svg className={`ar-plan ${className}`} viewBox={`${x0 - pad} ${z0 - pad} ${x1 - x0 + pad * 2} ${z1 - z0 + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <rect className="ar-plan-ground" x={x0} y={z0} width={x1 - x0} height={z1 - z0} rx=".6" />
    <g className="ar-plan-grid">{Array.from({ length: Math.floor((x1 - x0) / 8) + 1 }, (_, i) => <line key={'x' + i} x1={x0 + i * 8} x2={x0 + i * 8} y1={z0} y2={z1} />)}
      {Array.from({ length: Math.floor((z1 - z0) / 8) + 1 }, (_, i) => <line key={'z' + i} y1={z0 + i * 8} y2={z0 + i * 8} x1={x0} x2={x1} />)}</g>
    {boxes.map((b, i) => <rect key={i} className={`ar-plan-${tone(b)}`} x={b.min[0]} y={b.min[2]} width={b.max[0] - b.min[0]} height={b.max[2] - b.min[2]} />)}
    {map.spawns.filter(s => !s.forward).map((s, i) => <circle key={'s' + i} className={s.team === 0 ? 'ar-plan-a' : 'ar-plan-b'} cx={s.x} cy={s.z} r=".9" />)}
    {zones && map.objectives.map(o => <g key={o.id} className="ar-plan-zone"><circle cx={o.x} cy={o.z} r={o.r} /><text x={o.x} y={o.z + 1.2} textAnchor="middle">{o.id}</text></g>)}
  </svg>;
});
