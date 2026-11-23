// Letterbox bars, the title card, subtitles and the skip hint for a playing cinematic.
import { useCinema } from './store';
import './cinema.css';

export default function CinemaOverlay() {
  const { active, title, subtitle, skippable, blocking } = useCinema();
  return <div className={`cinema${active ? ' on' : ''}`} aria-hidden={!active}>
    <i className="cinema-bar top"/><i className="cinema-bar bottom"/>
    {title && <div className="cinema-title" role="status">{title}</div>}
    {subtitle && <p className="cinema-subtitle" role="status"><b>{subtitle.speaker}</b> {subtitle.text}</p>}
    {active && skippable && <button className="cinema-skip" onClick={() => window.dispatchEvent(new Event('cinemaskip'))}>{blocking ? 'Skip' : 'Skip'} <kbd>Enter</kbd></button>}
  </div>;
}
