import { useEffect, useState } from 'react';
import { CloudFog, CloudLightning, CloudRain, Cloud, Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import { useGame } from '../state';
import { resolveEnvironment, sunDirection } from '../../shared/environment.mjs';

const WEATHER_NAME: Record<string, string> = { clear: 'Clear', overcast: 'Overcast', lightRain: 'Light rain', heavyRain: 'Heavy rain', storm: 'Storm', fog: 'Fog' };

/** The open world's hour and weather for the location card (./App.tsx), refreshed every few seconds. */
export default function EnvironmentLabel() {
  const time = useGame(s => s.timeOfDay), weather = useGame(s => s.weather);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const e = resolveEnvironment(now, time, weather), h = Math.floor(e.hour), m = Math.floor((e.hour - h) * 60);
  const elevation = sunDirection(e.hour).elevation * 180 / Math.PI;
  const Icon = e.weather === 'storm' ? CloudLightning : e.weather === 'lightRain' || e.weather === 'heavyRain' ? CloudRain : e.weather === 'fog' ? CloudFog : e.weather === 'overcast' ? Cloud
    : elevation < -4 ? Moon : elevation < 12 ? (e.hour < 12 ? Sunrise : Sunset) : Sun;
  return <><Icon size={13} /> {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')} · {WEATHER_NAME[e.weather] ?? e.weather}</>;
}
