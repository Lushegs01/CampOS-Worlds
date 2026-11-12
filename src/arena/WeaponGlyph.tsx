// Weapon silhouettes for the interface (lobby, loadouts, kill feed, HUD, results): original side-view outlines drawn
// for this game, one per weapon type, muzzle to the right, on a 120 × 40 grid. They inherit the text colour.
import { memo, type ReactElement } from 'react';
import { WEAPON_BY_ID } from '../../shared/arena/weapons.mjs';

type Shape = 'ar' | 'burst' | 'smg' | 'heavySmg' | 'pump' | 'autoShotgun' | 'bolt' | 'dmr' | 'lmg' | 'pistol' | 'revolver' | 'knife' | 'axe';
const BY_ID: Record<string, Shape> = { vanguard: 'ar', halcyon: 'burst', wasp: 'smg', kestrel: 'heavySmg', bastion: 'pump', rampart: 'autoShotgun', longbow: 'bolt', talon: 'dmr', anvil: 'lmg', sparrow: 'pistol', thorn: 'revolver', knife: 'knife', hammer: 'axe' };
const P = (...pts: number[]) => pts.reduce((s, v, i) => s + (i % 2 ? `,${v} ` : v), '');
const SHAPES: Record<Shape, ReactElement> = {
  ar: <><polygon points={P(3, 15, 24, 13, 24, 23, 5, 27)} /><rect x="24" y="12" width="40" height="10" rx="1" /><rect x="64" y="13.5" width="30" height="7" rx="1.5" /><rect x="94" y="15.5" width="18" height="3" /><rect x="111" y="14.5" width="6" height="5" rx="1" />
    <polygon points={P(47, 22, 56, 22, 60, 35, 51, 36)} /><polygon points={P(34, 22, 41, 22, 38, 32, 31, 32)} /><rect x="40" y="7.5" width="14" height="4.5" rx="1" /><rect x="88" y="10" width="2.5" height="3.5" /></>,
  burst: <><polygon points={P(3, 16, 20, 14, 20, 24, 5, 27)} /><rect x="20" y="12" width="48" height="11" rx="2" /><rect x="68" y="14" width="26" height="7" rx="1.5" /><rect x="94" y="15.5" width="20" height="3" /><rect x="113" y="14.5" width="5" height="5" rx="1" />
    <polygon points={P(30, 23, 39, 23, 41, 35, 32, 35)} /><polygon points={P(52, 23, 58, 23, 56, 32, 50, 32)} /><rect x="36" y="6" width="22" height="6" rx="2" /></>,
  smg: <><rect x="4" y="14" width="18" height="3" /><rect x="4" y="14" width="3" height="10" /><rect x="22" y="12" width="36" height="10" rx="1.5" /><rect x="58" y="14.5" width="18" height="5" rx="1" /><rect x="76" y="15.5" width="14" height="3" /><rect x="88" y="14.5" width="6" height="5" rx="1" />
    <rect x="44" y="22" width="7" height="16" rx="1" /><polygon points={P(28, 22, 35, 22, 33, 32, 26, 32)} /><rect x="32" y="8" width="12" height="4" rx="1" /></>,
  heavySmg: <><polygon points={P(3, 14, 20, 13, 20, 23, 4, 26)} /><rect x="20" y="11" width="40" height="12" rx="2" /><rect x="60" y="14" width="16" height="6" rx="1" /><rect x="76" y="15.5" width="12" height="3.5" /><rect x="87" y="14" width="7" height="6.5" rx="1.5" />
    <polygon points={P(44, 23, 52, 23, 50, 36, 42, 36)} /><polygon points={P(28, 23, 35, 23, 33, 32, 26, 32)} /><rect x="30" y="6.5" width="16" height="4.5" rx="1.5" /></>,
  pump: <><polygon points={P(2, 15, 26, 13, 26, 22, 4, 27)} /><rect x="26" y="12" width="26" height="9" rx="1.5" /><rect x="52" y="13.5" width="64" height="3.5" /><rect x="52" y="18" width="50" height="3.5" rx="1" /><rect x="62" y="17" width="20" height="6" rx="2" />
    <polygon points={P(32, 21, 38, 21, 36, 30, 30, 30)} /><rect x="113" y="12.5" width="3" height="5" /></>,
  autoShotgun: <><polygon points={P(2, 15, 24, 13, 24, 22, 4, 27)} /><rect x="24" y="12" width="34" height="10" rx="1.5" /><rect x="58" y="13.5" width="54" height="3.5" /><rect x="58" y="18" width="40" height="3.5" rx="1" />
    <polygon points={P(44, 22, 54, 22, 55, 32, 45, 32)} /><polygon points={P(30, 22, 36, 22, 34, 31, 28, 31)} /><rect x="36" y="8" width="12" height="4" rx="1" /></>,
  bolt: <><polygon points={P(2, 16, 22, 13, 30, 13, 30, 22, 4, 28)} /><rect x="30" y="13" width="28" height="8" rx="1.5" /><rect x="58" y="15" width="60" height="3" /><rect x="114" y="14" width="5" height="5" rx="1" />
    <rect x="32" y="5.5" width="28" height="5" rx="2.5" /><rect x="28" y="4.5" width="6" height="7" rx="1.5" /><rect x="58" y="4.5" width="6" height="7" rx="1.5" /><rect x="40" y="10.5" width="3" height="3" /><rect x="50" y="10.5" width="3" height="3" />
    <polygon points={P(52, 21, 56, 21, 58, 25, 54, 25)} /><polygon points={P(30, 21, 37, 21, 35, 30, 28, 30)} /></>,
  dmr: <><polygon points={P(2, 15, 22, 13, 26, 13, 26, 23, 4, 27)} /><rect x="26" y="12.5" width="36" height="9.5" rx="1.5" /><rect x="62" y="14" width="30" height="6" rx="1.5" /><rect x="92" y="15.5" width="22" height="3" /><rect x="112" y="14.5" width="6" height="5" rx="1" />
    <rect x="34" y="5" width="24" height="5" rx="2.5" /><rect x="42" y="10" width="3" height="3" /><polygon points={P(46, 22, 54, 22, 55, 31, 47, 31)} /><polygon points={P(32, 22, 38, 22, 36, 31, 30, 31)} /></>,
  lmg: <><polygon points={P(2, 14, 22, 12, 22, 24, 4, 27)} /><rect x="22" y="10" width="44" height="13" rx="2" /><rect x="66" y="13.5" width="28" height="7" rx="1.5" /><rect x="94" y="15" width="20" height="4" /><rect x="112" y="13.5" width="6" height="7" rx="1.5" />
    <rect x="42" y="23" width="16" height="12" rx="2" /><polygon points={P(30, 23, 37, 23, 35, 32, 28, 32)} /><rect x="36" y="5" width="18" height="5" rx="2" /><polygon points={P(88, 20, 91, 20, 98, 36, 95, 37)} /><polygon points={P(88, 20, 91, 20, 85, 37, 82, 36)} /></>,
  pistol: <><rect x="34" y="12" width="52" height="9" rx="2" /><rect x="84" y="13.5" width="4" height="6" rx="1" /><polygon points={P(40, 21, 54, 21, 50, 37, 36, 37)} /><polygon points={P(54, 21, 60, 21, 60, 26, 54, 27)} /><rect x="80" y="9.5" width="3" height="2.5" /></>,
  revolver: <><rect x="54" y="13" width="44" height="6" rx="1.5" /><rect x="96" y="12.5" width="4" height="7" rx="1" /><rect x="38" y="11" width="18" height="12" rx="3" /><circle cx="47" cy="17" r="3" fill="var(--glyph-cut, rgba(0,0,0,.35))" />
    <polygon points={P(32, 18, 42, 18, 40, 37, 28, 37)} /><polygon points={P(42, 23, 50, 23, 50, 27, 43, 28)} /><polygon points={P(34, 11, 40, 11, 38, 8, 33, 9)} /></>,
  knife: <><rect x="20" y="16" width="30" height="8" rx="3" /><rect x="50" y="13" width="4" height="14" rx="1" /><polygon points={P(54, 16, 104, 16, 112, 20, 104, 23, 54, 24)} /></>,
  axe: <><rect x="8" y="17" width="92" height="5" rx="2.5" /><polygon points={P(84, 8, 100, 8, 106, 4, 110, 18, 106, 32, 100, 28, 92, 28, 92, 17, 84, 17)} /></>,
};
/** The silhouette of a weapon (by id), sized by `width` (height follows the 3:1 grid). */
export const WeaponGlyph = memo(function WeaponGlyph({ id, width = 72, className = '', title }: { id: string; width?: number; className?: string; title?: string }) {
  const shape = BY_ID[id] ?? (WEAPON_BY_ID.get(id)?.category === 'pistol' ? 'pistol' : 'ar');
  return <svg className={`ar-glyph ${className}`} viewBox="0 0 120 40" width={width} height={width / 3} fill="currentColor" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>{SHAPES[shape]}</svg>;
});
