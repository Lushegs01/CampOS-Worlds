import { useEffect, useRef, useState } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { useGame } from '../state';
import { audio, recordSound, type Mixer } from './mixer';
import { hasElevenLabsClip, loadElevenLabsVoice } from './elevenlabs';

type Playback = { id: string; mixer: Mixer; source: AudioBufferSourceNode; level: GainNode };
let foreground: Playback | undefined;
function stop(clip: Playback) {
  const now = clip.mixer.ctx.currentTime;
  clip.level.gain.setTargetAtTime(0, now, .015);
  clip.source.stop(now + .06);
  if (foreground !== clip) return;
  foreground = undefined;
  clip.mixer.duck.gain.setTargetAtTime(1, now, .18);
}

export function SpokenLine({ id, speaker }: { id: string; speaker: string }) {
  const enabled = useGame(s => s.volume > 0 && s.dialogueVolume > 0);
  const [available, setAvailable] = useState('');
  const [playing, setPlaying] = useState(false);
  const active = useRef<Playback | undefined>(undefined);
  const request = useRef(0);

  function cancel() {
    request.current++;
    const clip = active.current;
    active.current = undefined;
    if (clip) stop(clip);
    setPlaying(false);
  }
  async function play() {
    const m = audio();
    if (!m || document.hidden || !useGame.getState().dialogueVolume) return;
    const current = ++request.current;
    const buffer = await loadElevenLabsVoice(m, id);
    if (!buffer || current !== request.current || document.hidden || m.ctx.state !== 'running') return;
    if (foreground) stop(foreground);
    const source = m.ctx.createBufferSource(), level = m.ctx.createGain();
    const clip = { id, mixer: m, source, level };
    active.current = foreground = clip;
    source.buffer = buffer;
    source.connect(level).connect(m.dialogue);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
      if (foreground === clip) {
        foreground = undefined;
        m.duck.gain.setTargetAtTime(1, m.ctx.currentTime, .18);
      }
      if (active.current === clip) {
        active.current = undefined;
        setPlaying(false);
      }
    };
    m.duck.gain.setTargetAtTime(.42, m.ctx.currentTime, .055);
    source.start();
    setPlaying(true);
    recordSound(id);
  }
  useEffect(() => {
    let shown = true;
    void hasElevenLabsClip(id).then(found => { if (shown && found) setAvailable(id); });
    void play();
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', visibility);
    const unsub = useGame.subscribe(s => { if (!s.volume || !s.dialogueVolume) cancel(); });
    return () => {
      shown = false;
      document.removeEventListener('visibilitychange', visibility);
      unsub();
      cancel();
    };
  // IDs are tied to authored lines. Changing volume should never restart a line.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!enabled || available !== id) return null;
  return <button type="button" className="text-button spoken-line" onClick={playing ? cancel : () => void play()}
    aria-label={playing ? `Stop ${speaker}’s voice` : `Play ${speaker}’s voice`}>
    {playing ? <Square size={14} aria-hidden /> : <Volume2 size={16} aria-hidden />}
    {playing ? 'Stop voice' : 'Play voice'}
  </button>;
}
