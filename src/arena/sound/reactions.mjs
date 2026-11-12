// How a soldier reacts, vocally, to being hit: chosen from validated damage only (the server's damage events for the
// player, the server's health in snapshots for everyone else), never from a predicted hit.
//
// Severity: a light hit draws a short grunt, a heavy one (a big round, a shotgun at close range) a fuller one, a hit
// that leaves little health a strained one; an elimination its own reaction, once per life. Hits arriving close
// together merge into one reaction of the combined severity, so a burst does not become a stammer of grunts, and the
// same damage reported twice (a duplicate message) is ignored.

export const VOICES_MALE = ['mA', 'mB', 'mC', 'mD'], VOICE_FEMALE = 'fA';
/** The voice a player's soldier uses all match: female soldiers the female voice, the others one of four men. */
export function voiceFor(num, model = '') {
  if (/-f\d/.test(model)) return VOICE_FEMALE;
  let h = 2166136261; for (const c of String(num * 7919 + 13)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return VOICES_MALE[(h >>> 0) % VOICES_MALE.length];
}

/** Severity of one hit (or merged hits): null below a few points (a scratch makes no sound). */
export function severity(damage, hpAfter) {
  if (damage < 4) return null;
  if (hpAfter <= 30 && damage >= 12) return 'severe';
  if (damage >= 34) return 'heavy';
  return 'hurt';
}
const RANK = { hurt: 1, heavy: 2, severe: 3, death: 4 };

/**
 * A reaction limiter for all actors. `hit(actor, damage, hpAfter, now)` — damage already merged over a short window by
 * the caller (src/arena/audio.ts: hits within 0.1 s of each other are one reaction, the way a person reacts once to a
 * burst) — returns the reaction to play now, or null. `death(actor, life, now)` returns 'death' once per actor and life.
 */
export function createReactions({ gap = .34 } = {}) {
  const actors = new Map(), deaths = new Set();
  return {
    hit(actor, damage, hpAfter, now) {
      const a = actors.get(actor) ?? { at: -1, rank: 0, seenHp: NaN, seenAt: -1 };
      actors.set(actor, a);
      // The same report twice (same health within 0.2 s): one hit.
      if (hpAfter === a.seenHp && now - a.seenAt < .2) return null;
      a.seenHp = hpAfter; a.seenAt = now;
      const kind = severity(damage, hpAfter);
      if (!kind || hpAfter <= 0) return null;
      // Within the gap after a reaction only a more severe one interrupts.
      if (now - a.at < gap && RANK[kind] <= a.rank) return null;
      a.at = now; a.rank = RANK[kind];
      return kind;
    },
    death(actor, life, now) {
      const key = actor + ':' + life; if (deaths.has(key)) return null;
      deaths.add(key); if (deaths.size > 512) deaths.clear();
      const a = actors.get(actor); if (a) { a.at = now; a.rank = RANK.death; }
      return 'death';
    },
    clear() { actors.clear(); deaths.clear(); },
  };
}

/**
 * Where a round struck a player, from the impact point's height above their feet (heights of the server's hitbox,
 * shared/arena/sim.mjs hitbox: head sphere centred 0.17 m below the top). The soldiers wear helmets and plate
 * carriers, so a head hit strikes the helmet and a chest hit the plate; legs and arms are cloth.
 */
export function bodyPart(heightAboveFeet, standingHeight = 1.8) {
  if (heightAboveFeet >= standingHeight - .36) return 'helmet';
  if (heightAboveFeet >= standingHeight * .5) return 'armour';
  return 'flesh';
}
