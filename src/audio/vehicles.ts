import { VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { audio, ear, loop, noise, play, spot, type Loop, type Spot } from './mixer';

// Each vehicle as it sounds on a real campus road. The car and the shuttle (a lower, heavier engine) start
// when someone takes the driver's seat, idle, rev with speed and acceleration and shut off when the driver
// gets out; their doors open and shut as people get in and out. The garden cart is electric: a click when
// switched on and a low motor hum that rises with speed, silent at rest. Every vehicle rolls on the asphalt.
// Only vehicles within earshot keep sound running.

type Type = keyof typeof VEHICLE_TYPES;
interface Rolling { spot: Spot; road: GainNode; filter: BiquadFilterNode; whine: GainNode; motor: OscillatorNode; stop(): void }
interface State { seats: (string | null)[] | null; running: boolean; startAt: number; engine: Loop | null; rolling: Rolling | null }
const states = new Map<string, State>();
const EARSHOT = 70;
const ENGINE = { car: { rate: 1, gain: .55 }, shuttle: { rate: .62, gain: .8 } } as const;

/** Tyres on the asphalt (filtered noise) and, for the cart, its electric motor; both silent until moving. */
function rolling(at: { x: number; y: number; z: number }): Rolling | null {
  const m = audio(); if (!m) return null;
  const c = m.ctx, out = spot(m, at), src = c.createBufferSource(), filter = c.createBiquadFilter(), road = c.createGain();
  src.buffer = noise(c); src.loop = true; filter.type = 'lowpass'; filter.frequency.value = 500; road.gain.value = 0;
  src.connect(filter).connect(road).connect(out.input); src.start();
  const motor = c.createOscillator(), tone = c.createBiquadFilter(), whine = c.createGain();
  // A low electric hum: a triangle wave kept under 450 Hz (a sawtooth through 900 Hz whined at 1-1.5 kHz).
  motor.type = 'triangle'; motor.frequency.value = 55; tone.type = 'lowpass'; tone.frequency.value = 450; whine.gain.value = 0;
  motor.connect(tone).connect(whine).connect(out.input); motor.start();
  return {
    spot: out, road, filter, whine, motor,
    stop: () => { const t = c.currentTime; road.gain.setTargetAtTime(0, t, .08); whine.gain.setTargetAtTime(0, t, .08); src.stop(t + .4); motor.stop(t + .4); setTimeout(() => out.release(), 600); },
  };
}

/** Called every frame for each vehicle. `accel` is its smoothed acceleration (m/s²); `seats` who sits where. */
export function vehicleSound(id: string, type: Type, v: { x: number; z: number; speed: number }, accel: number, seats: (string | null)[]) {
  let s = states.get(id);
  if (!s) states.set(id, s = { seats: null, running: false, startAt: 0, engine: null, rolling: null });
  const m = audio(), now = m?.ctx.currentTime ?? 0, at = { x: v.x, y: .8, z: v.z };
  // Who got in or out (not on first sight: a vehicle already being driven is simply running).
  if (s.seats) for (let i = 0; i < seats.length; i++) if (!!seats[i] !== !!s.seats[i]) {
    const gotIn = !!seats[i];
    if (type === 'cart') play('cloth', { at, gain: .5, range: 25 });
    else { play('car-door-open', { at, gain: .8, range: 35 }); play('car-door-close', { at, gain: .9, delay: gotIn ? .9 : .7, range: 35 }); }
    if (i !== 0) continue;
    if (gotIn) {
      s.running = true; s.startAt = now + (type === 'cart' ? .3 : 1.9);
      if (type === 'cart') play('door-latch', { at, gain: .5, delay: .3, range: 25 }); else play('engine-start', { at, gain: .9, delay: 1.1, range: 45, ref: 3 });
    } else { s.running = false; if (s.engine) play('engine-stop', { at, gain: .8, range: 45, ref: 3 }); s.engine?.stop(.15); s.engine = null; }
  } else if (!s.seats && seats[0]) { s.running = true; s.startAt = 0; }
  s.seats = seats.slice();

  if (!m || Math.hypot(v.x - ear.x, v.z - ear.z) > EARSHOT) { s.engine?.stop(); s.engine = null; s.rolling?.stop(); s.rolling = null; return; }
  const speed = Math.abs(v.speed), pace = Math.min(1, speed / VEHICLE_TYPES[type].maxSpeed), load = Math.max(0, Math.min(1, accel / 4));
  // Engine: idle once started, then pitch and level follow speed, pressing harder under acceleration.
  if (type !== 'cart') {
    const spec = ENGINE[type];
    if (s.running && now >= s.startAt && !s.engine) s.engine = loop('engine', { at, gain: spec.gain * .6, rate: spec.rate * .85, ref: 4 });
    if (s.engine) {
      s.engine.move(at);
      s.engine.rate.setTargetAtTime(spec.rate * (.85 + pace * 1.15 + load * .12), now, .12);
      s.engine.gain.setTargetAtTime(spec.gain * (.6 + pace * .35 + load * .25), now, .12);
    }
  }
  if (speed > .3 && !s.rolling) s.rolling = rolling(at);
  else if (speed <= .05 && s.rolling) { s.rolling.stop(); s.rolling = null; }
  if (s.rolling) {
    const r = s.rolling; r.spot.move({ ...at, y: .3 });
    r.road.gain.setTargetAtTime(Math.min(.6, pace * .9), now, .08); r.filter.frequency.setTargetAtTime(350 + pace * 900, now, .08);
    const motor = type === 'cart' && s.running;
    r.motor.frequency.setTargetAtTime(55 + speed * 15, now, .08); r.whine.gain.setTargetAtTime(motor ? Math.min(.12, speed * .016) : 0, now, .08);
  }
}

/** Stop a vehicle's sound when its model leaves the scene. */
export function silenceVehicle(id: string) {
  const s = states.get(id); if (!s) return;
  s.engine?.stop(); s.rolling?.stop(); states.delete(id);
}
