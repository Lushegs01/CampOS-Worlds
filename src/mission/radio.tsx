// Police radio and officer commands: captions for every line, with voiced takes where the ElevenLabs build has
// produced them (public/assets/elevenlabs, ids voice/dispatch/<code> and voice/officer/<code>-<take>). Radio is
// heard through a band-limited "speaker"; officers are positioned in the world.
import { useEffect, useState } from 'react';
import { onMissionEvent, type MissionEvent } from './client';
import { audio } from '../audio/mixer';
import { loadElevenLabsVoice, hasElevenLabsClip } from '../audio/elevenlabs';
import { useGame } from '../state';

export const DISPATCH: Record<string, string> = {
  suspectVehicle: 'All units, shots fired and an explosion at Orisun Freight. Suspect left in a stolen vehicle. Respond code three.',
  shotsFired: 'Control to all units, reports of gunfire. Proceed with caution.',
  explosion: 'Control, multiple callers reporting an explosion. Fire service notified.',
  alarm: 'Control, intruder alarm at Orisun Freight, Bay oh four. Nearest unit please attend.',
  collision: 'Control, a collision reported. Vehicle failed to stop.',
  report: 'Control, a witness report coming in. Units in the area, keep your eyes open.',
  responding: 'Unit responding. On my way.',
  onScene: 'Unit on scene. Getting out to take a look.',
  visual: 'I have visual on the suspect. Following.',
  pursuit: 'Suspect is fleeing. In pursuit, lights and sirens.',
  backup: 'Requesting backup. Suspect driving dangerously.',
  roadblock: 'Setting up a roadblock ahead of the suspect.',
  tactical: 'Suspect is boxed in. All units, tactical containment.',
  contained: 'Suspect is contained. Officers deploying.',
  deploy: 'Out of the vehicle. Taking cover.',
  breakout: 'Suspect broke containment! Back in the cars, go, go!',
  tacticalRolling: 'Tactical team rolling from Central.',
  maximum: 'All available units. Maximum response authorised.',
  officerDown: 'Officer down! Officer down!',
  searchOver: 'No sign of the suspect. Calling off the search. All units resume patrol.',
  dispatch: 'All units, be advised.',
};
export const COMMANDS: Record<string, string> = {
  police: 'Police! Stop right there!',
  stepOut: 'Driver! Step out of the vehicle, now!',
  engineOff: 'Turn the engine off! Do it now!',
  handsOnWheel: 'Hands where I can see them! On the wheel!',
  freeze: 'Police! Don’t move!',
  handsUp: 'Hands up! Show me your hands!',
  getDown: 'Get down on the ground! Down!',
  dropWeapon: 'Drop the weapon! Drop it!',
  shotsFired: 'Shots fired! Take cover!',
  finalWarning: 'This is your final warning!',
  stayDown: 'Stay down! Keep your hands out!',
  arrested: 'You’re under arrest. Don’t resist.',
};
type Line = { id: number; who: 'Control' | 'Officer'; text: string; at: number };
let lines: Line[] = [];
const listeners = new Set<() => void>();
let nextId = 0;
function speak(e: MissionEvent & { code?: string }) {
  const radio = e.kind === 'radio', table = radio ? DISPATCH : COMMANDS, text = table[e.code ?? ''];
  if (!text) return;
  const now = performance.now();
  // Never a wall of captions: newest two, and the same line not twice in quick succession.
  if (lines.some(l => l.text === text && now - l.at < 2500)) return;
  lines = [...lines.filter(l => now - l.at < 5200).slice(-1), { id: ++nextId, who: radio ? 'Control' : 'Officer', text, at: now }];
  listeners.forEach(f => f());
  void voice(radio ? `voice/dispatch/${e.code}` : `voice/officer/${e.code}-${nextId % 2}`, radio);
}
async function voice(id: string, radio: boolean) {
  const m = audio();
  if (!m || !useGame.getState().dialogueVolume) return;
  let clip = id;
  if (!(await hasElevenLabsClip(clip))) { clip = id.replace(/-1$/, '-0'); if (!(await hasElevenLabsClip(clip))) { squelch(radio); return; } }
  const buffer = await loadElevenLabsVoice(m, clip);
  if (!buffer) return;
  const source = m.ctx.createBufferSource(), level = m.ctx.createGain();
  source.buffer = buffer; level.gain.value = radio ? .7 : .95;
  let head: AudioNode = level;
  if (radio) {
    // Through a car radio: band-limited and a little driven.
    const hp = m.ctx.createBiquadFilter(), lp = m.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 420; lp.type = 'lowpass'; lp.frequency.value = 3200;
    source.connect(hp).connect(lp).connect(level); squelch(true);
  } else source.connect(level);
  head.connect(m.dialogue);
  source.onended = () => { source.disconnect(); level.disconnect(); };
  source.start(m.ctx.currentTime + (radio ? .12 : 0));
}
function squelch(radio: boolean) {
  const m = audio(); if (!m || !radio) return;
  const t = m.ctx.currentTime, o = m.ctx.createOscillator(), g = m.ctx.createGain();
  o.type = 'square'; o.frequency.value = 1800; g.gain.setValueAtTime(.025, t); g.gain.exponentialRampToValueAtTime(.0001, t + .09);
  o.connect(g).connect(m.dialogue); o.start(t); o.stop(t + .1);
}
export function initRadio() {
  return onMissionEvent(e => { if (e.kind === 'radio' || e.kind === 'command') speak(e as MissionEvent & { code?: string }); });
}
export function RadioCaptions() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); listeners.add(f); const t = setInterval(f, 800); return () => { listeners.delete(f); clearInterval(t); }; }, []);
  const now = performance.now(), live = lines.filter(l => now - l.at < 5200);
  if (!live.length) return null;
  return <div className="getaway-radio" role="log" aria-live="polite">
    {live.map(l => <p key={l.id} className={l.who === 'Control' ? 'radio' : 'command'}><b>{l.who === 'Control' ? 'Police radio' : 'Officer'}</b> {l.text}</p>)}
  </div>;
}
