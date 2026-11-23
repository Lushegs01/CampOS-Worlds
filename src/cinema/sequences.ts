// The Getaway's and Metropolitan City's cinematics. Each sequence starts only from a real change in game state
// (the room's mission state or the player's own position) and frames the live world: Sade where she stands, the
// officers where the room has put them, the blast where the drum really went up. Nothing here moves a character or
// changes the mission; skipping a sequence only ends the camera work, so the game state is the same either way.
import { CONTACT, SAFEHOUSE, WAREHOUSE, BARREL, O } from '../../shared/getaway.mjs';
import { SADE } from '../mission/dialogue';
import { regionAt } from '../../shared/metro.mjs';
import { player } from '../state';
import { surfaceHeight } from '../world/layout';
import { currentVehicle } from '../vehicles/client';
import type { Mission } from '../mission/client';
import { crane, track, overShoulder, closeUp, orbit, locked, pickClear, type Shot, type P } from './shots';

export type Ctx = { mission: Mission | null; prev: { stage: number | null; exploded: boolean; contained: boolean; region: string; dismounts: number }; brief: boolean; prevBrief: boolean };
export type Built = { shots: Shot[]; lines?: { at: number; speaker: string; text: string; until: number }[]; voice?: string; title?: { text: string; at: number; until: number }; act?: (t: number) => void };
export type Sequence = { id: string; once: boolean; blocking: boolean; skippable: boolean; trigger: (c: Ctx) => boolean; build: (c: Ctx) => Built };

/** What characters do during a scene (read by the contact's avatar in src/mission/scene.tsx). */
export const acting = { sade: { emote: '', until: 0, look: null as P | null } };
const ground = (p: P) => ({ ...p, y: surfaceHeight(p.x, p.z) });
const me = () => { const v = currentVehicle(); return v ? { x: v.x, y: 0, z: v.z, yaw: v.yaw } : { x: player.x, y: player.y, z: player.z, yaw: player.yaw }; };
const sadeAt = (delivery: boolean) => ground(delivery ? SAFEHOUSE : CONTACT);
/** Splits a speech into subtitle cards timed at a natural speaking rate. */
function cards(speaker: string, texts: string[], start: number, wps = 2.75) {
  const out: { at: number; speaker: string; text: string; until: number }[] = []; let t = start;
  for (const text of texts) for (const s of text.match(/[^.!?]+[.!?]+/g) ?? [text]) { const d = Math.max(1.6, s.trim().split(/\s+/).length / wps); out.push({ at: t, speaker, text: s.trim(), until: t + d }); t += d + .15; }
  return out;
}
const words = (texts: string[]) => texts.join(' ').split(/\s+/).length;

export const SEQUENCES: Sequence[] = [
  {
    // 1–2. First sight of Metropolitan City from the Gateway Expressway (the player keeps driving: non-blocking).
    id: 'city-reveal', once: true, blocking: false, skippable: true,
    trigger: c => c.prev.region === 'campus' && regionAt(player.x, player.z) === 'expressway' && player.z > 1290,
    build: () => ({
      title: { text: 'METROPOLITAN CITY', at: .8, until: 4.2 },
      shots: [
        crane('aerial reveal', 4.6, () => { const p = me(); return { x: p.x + 14, y: 7, z: p.z + 30 }; }, () => { const p = me(); return { x: p.x + 26, y: 36, z: p.z + 70 }; }, () => ({ x: 120, y: 30, z: 1720 }), 48),
        track('vehicle tracking', 3.4, me, [-4.2, .9, 3.2], 1, 40, [0, .2, -2.4]),
        track('low chase', 2.6, me, [1.6, .55, -6.5], .9, 50),
      ],
    }),
  },
  {
    // 3–4. Meeting Sade outside Saltworks Café: establishing two-shot, over the shoulder, close-ups, reverse.
    id: 'meet-contact', once: false, blocking: true, skippable: true,
    trigger: c => c.brief && !c.prevBrief && !c.mission,
    build: () => {
      const lines = cards('Sade', SADE.briefing, 2.4), end = lines.at(-1)!.until + .4;
      const s = () => sadeAt(false), p = () => ground(player);
      const third = (end - 2.4) / 3;
      return {
        voice: 'voice/sade/briefing', lines,
        shots: [
          pickClear(...[1.9, -1.9, 1.2, -1.2, Math.PI].flatMap(a => [7.5, 5].map(r => orbit('establishing two-shot', 2.4, () => ({ x: (s().x + p().x) / 2, y: s().y, z: (s().z + p().z) / 2 }), r, 2.6, () => Math.atan2(p().x - s().x, p().z - s().z) + a, .35 * Math.sign(a), 1.2, 44)))),
          pickClear(overShoulder('over the shoulder: player → Sade', third, p, s, 1, 36), overShoulder('over the shoulder: player → Sade', third, p, s, -1, 36)),
          pickClear(closeUp('close-up: Sade', third, s, p, 1, 24), closeUp('close-up: Sade', third, s, p, -1, 24)),
          pickClear(overShoulder('reverse: Sade → player', Math.min(third, 3.5), s, p, -1, 38), overShoulder('reverse: Sade → player', Math.min(third, 3.5), s, p, 1, 38)),
          pickClear(closeUp('close-up: Sade (instruction)', Math.max(.5, end - 2.4 - third * 2 - Math.min(third, 3.5)), s, p, -1, 26), closeUp('close-up: Sade (instruction)', Math.max(.5, end - 2.4 - third * 2 - Math.min(third, 3.5)), s, p, 1, 26)),
        ],
        act: t => { acting.sade.look = ground(player); if (t > .3 && t < .35) { acting.sade.emote = 'wave'; acting.sade.until = Date.now() + 2200; } },
      };
    },
  },
  {
    // 5. Arriving at the freight yard's Bay 04.
    id: 'warehouse-arrival', once: true, blocking: true, skippable: true,
    trigger: c => c.mission?.stage === O.warehouse && Math.hypot(player.x - WAREHOUSE.x, player.z - WAREHOUSE.z) < 34,
    build: () => ({
      title: { text: 'ORISUN FREIGHT · BAY 04', at: .4, until: 3.4 },
      shots: [
        crane('yard establishing', 3.6, () => ({ x: WAREHOUSE.x + 26, y: 15, z: WAREHOUSE.z + 30 }), () => ({ x: WAREHOUSE.x + 14, y: 4.2, z: WAREHOUSE.z + 22 }), () => ({ x: WAREHOUSE.x, y: 3, z: WAREHOUSE.z + 3 }), 46),
        track('approach', 1.8, () => ({ ...ground(player), yaw: Math.atan2(WAREHOUSE.x - player.x, WAREHOUSE.z - player.z) }), [.6, 1.65, -2.1], 1.6, 40),
      ],
    }),
  },
  {
    // 8. The fuel drum goes up (only when the room reports the blast).
    id: 'explosion', once: true, blocking: true, skippable: true,
    trigger: c => !!c.mission?.exploded && !c.prev.exploded,
    build: () => ({
      shots: [
        locked('low-angle blast', 1.4, () => ({ x: BARREL.x + 11, y: .6, z: BARREL.z + 9 }), () => ({ x: BARREL.x, y: 2.2, z: BARREL.z }), 52, 1.2),
        locked('reaction', 1.1, () => { const p = ground(player); const a = Math.atan2(BARREL.x - p.x, BARREL.z - p.z); return { x: p.x + Math.sin(a) * 1.6 + Math.cos(a) * .7, y: p.y + 1.55, z: p.z + Math.cos(a) * 1.6 - Math.sin(a) * .7 }; }, () => ({ ...ground(player), y: ground(player).y + 1.5 }), 34),
      ],
    }),
  },
  {
    // 9–11. The first unit arrives and its crew step out (only once the room has officers actually dismounting).
    id: 'police-arrival', once: true, blocking: false, skippable: true,
    trigger: c => (c.mission?.officers?.filter(o => o.mode === 'dismount').length ?? 0) > 0 && c.prev.dismounts === 0 && Math.abs(currentVehicle()?.speed ?? 0) < 3,
    build: c => {
      const off = () => { const o = c.mission?.officers?.find(o => o.mode === 'dismount') ?? c.mission?.officers?.[0]; return o ? ground(o) : ground(player); };
      return {
        lines: [{ at: .4, until: 2.6, speaker: 'Metro Police', text: 'Armed police! Stay where you are!' }],
        shots: [locked('officer exits', 2.8, () => { const o = off(), p = ground(player), a = Math.atan2(o.x - p.x, o.z - p.z); return { x: o.x - Math.sin(a) * 4.5 + Math.cos(a) * 2.2, y: o.y + .7, z: o.z - Math.cos(a) * 4.5 - Math.sin(a) * 2.2 }; }, () => { const o = off(); return { ...o, y: o.y + 1.2 }; }, 40, .8)],
      };
    },
  },
  {
    // 12–13. Surrounded: only when the room says the units are in position round the player.
    id: 'containment', once: true, blocking: true, skippable: true,
    trigger: c => !!c.mission?.police?.contained && !c.prev.contained,
    build: c => {
      const cover = () => { const list = (c.mission?.officers ?? []).filter(o => ['cover', 'aim', 'deploy'].includes(o.mode)); const p = ground(player); return list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? null; };
      return {
        lines: [{ at: 2.6, until: 5.4, speaker: 'Metro Police', text: 'Engine off! Hands where we can see them!' }],
        shots: [
          pickClear(...[0, Math.PI / 2, Math.PI, -Math.PI / 2].map(a => orbit('containment overhead', 3, () => ground(player), 17, 9, () => player.yaw + Math.PI + a, .9, .5, 50))),
          ...(cover() ? [pickClear(overShoulder('officer at cover → suspect', 2.6, () => ground(cover()!), () => ground(player), 1, 36), overShoulder('officer at cover → suspect', 2.6, () => ground(cover()!), () => ground(player), -1, 36))] : [orbit('ring', 2.6, () => ground(player), 9, 2, () => player.yaw, .5, 1, 42)]),
        ],
      };
    },
  },
  {
    // 16. Arriving at the lock-up on Baobab Close.
    id: 'safehouse-arrival', once: true, blocking: true, skippable: true,
    trigger: c => c.mission?.stage === O.deliver && c.prev.stage === O.safehouse,
    build: () => ({
      title: { text: '14 BAOBAB CLOSE', at: .3, until: 2.8 },
      shots: [
        crane('lock-up establishing', 3.2, () => ({ x: SAFEHOUSE.x - 18, y: 9, z: SAFEHOUSE.z + 22 }), () => ({ x: SAFEHOUSE.x - 9, y: 3, z: SAFEHOUSE.z + 15 }), () => ({ ...sadeAt(true), y: 1.6 }), 44),
      ],
      act: () => { acting.sade.look = ground(player); },
    }),
  },
  {
    // 17–18. The handover and the reveal.
    id: 'delivery', once: false, blocking: true, skippable: true,
    trigger: c => (c.mission?.stage ?? -1) >= O.commit && (c.prev.stage ?? -1) < O.commit,
    build: () => {
      const s = () => sadeAt(true), p = () => ground(player), lines = cards('Sade', SADE.delivery, 1.6), end = lines.at(-1)!.until + .5;
      return {
        voice: 'voice/sade/delivery', lines,
        shots: [
          pickClear(overShoulder('handover: player → Sade', 1.6, p, s, 1, 38), overShoulder('handover: player → Sade', 1.6, p, s, -1, 38)),
          pickClear(closeUp('close-up: Sade reads', Math.max(2, (end - 1.6) * .55), s, p, 1, 24), closeUp('close-up: Sade reads', Math.max(2, (end - 1.6) * .55), s, p, -1, 24)),
          pickClear(overShoulder('reverse: Sade → player', Math.max(1.2, (end - 1.6) * .2), s, p, -1, 38), overShoulder('reverse: Sade → player', Math.max(1.2, (end - 1.6) * .2), s, p, 1, 38)),
          pickClear(closeUp('close-up: the reveal', Math.max(1.5, (end - 1.6) * .25), s, p, -1, 22), closeUp('close-up: the reveal', Math.max(1.5, (end - 1.6) * .25), s, p, 1, 22)),
        ],
        act: () => { acting.sade.look = ground(player); },
      };
    },
  },
];
void words;
