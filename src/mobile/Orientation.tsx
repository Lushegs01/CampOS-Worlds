import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useGame } from '../state';
import { enterLandscape, portraitBlocked } from './orientation';

export default function Orientation() {
  const playing = useGame(s => s.phase === 'playing');
  const [portrait, setPortrait] = useState(portraitBlocked);
  useEffect(() => {
    const media = matchMedia('(pointer: coarse) and (orientation: portrait)');
    const update = () => {
      setPortrait(media.matches);
      // A held stick/key must not resume itself after rotating back.
      window.dispatchEvent(new Event('gameinputreset'));
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  if (!playing || !portrait) return null;
  return <div className="orientation-overlay" role="dialog" aria-modal="true" aria-labelledby="orientation-title">
    <span className="eyebrow">CAMPOS WORLDS</span><RotateCw size={54} aria-hidden="true" />
    <h2 id="orientation-title">Turn your phone to explore.</h2>
    <p>Hold your device sideways for room to move and look around. Controls resume in landscape.</p>
    <button className="primary" onClick={() => { void enterLandscape(); }}>Try landscape fullscreen</button>
    <small>If your browser cannot rotate automatically, rotate your device with screen rotation enabled.</small>
  </div>;
}
