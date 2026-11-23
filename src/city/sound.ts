// Metropolitan City's sound: the nearest ambient vehicles each run a positioned engine (pitch and level follow
// their speed, lower for trucks and buses, higher for motorcycles), horns are synthesized two-tone and differ per
// vehicle, crashes thump, and two beds follow what is around you: the hum of traffic (by moving vehicles within
// 120 m) and the murmur of a crowd (by people within 40 m). Everything is positioned and attenuated by distance.
import { audio, loop, noise, output, spot, play, type Loop, type Spot } from '../audio/mixer';

type Car = { id: string; x: number; z: number; v: number; cls: string; accel?: number };
const RATE: Record<string, number> = { truck: .55, bus: .5, van: .78, pickup: .8, suv: .85, moto: 1.55, sports: 1.2 };
export function cityAudio() {
  const engines = new Map<string, Loop>();
  let bed: { spot: Spot; gain: GainNode; stop(): void } | null = null, crowd: { spot: Spot; gain: GainNode; stop(): void } | null = null;
  function noiseBed(freq: number, q: number, kind: BiquadFilterType): { spot: Spot; gain: GainNode; stop(): void } | null {
    const m = audio(); if (!m) return null;
    const c = m.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), s = spot(m, { x: 0, z: 0 }, 30);
    src.buffer = noise(c); src.loop = true; f.type = kind; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
    src.connect(f).connect(g).connect(s.input); src.start();
    return { spot: s, gain: g, stop: () => { g.gain.setTargetAtTime(0, c.currentTime, .3); src.stop(c.currentTime + 1.2); setTimeout(() => s.release(), 1500); } };
  }
  return {
    update(near: Car[], people: { x: number; z: number; state: string }[], me: { x: number; z: number }, active: boolean) {
      const m = audio(); if (!m || !active) { this.quiet(); return; }
      // Engines: the six nearest moving or idling vehicles.
      const list = near.map(v => ({ v, d: Math.hypot(v.x - me.x, v.z - me.z) })).filter(o => o.d < 55).sort((a, b) => a.d - b.d).slice(0, 6);
      const keep = new Set(list.map(o => o.v.id));
      for (const [id, l] of engines) if (!keep.has(id)) { l.stop(.4); engines.delete(id); }
      for (const { v } of list) {
        let l = engines.get(v.id);
        if (!l) { const e = loop('engine', { at: { x: v.x, y: .7, z: v.z }, gain: 0, rate: RATE[v.cls] ?? 1, ref: 4 }); if (!e) continue; engines.set(v.id, l = e); }
        l.move({ x: v.x, y: .7, z: v.z });
        const base = RATE[v.cls] ?? 1, t = m.ctx.currentTime;
        l.rate.setTargetAtTime(base * (.78 + Math.min(1.1, v.v / 14) * .55 + Math.max(0, v.accel ?? 0) * .03), t, .2);
        l.gain.setTargetAtTime((v.cls === 'truck' || v.cls === 'bus' ? .34 : v.cls === 'moto' ? .3 : .2) * (.45 + Math.min(1, v.v / 12)), t, .25);
      }
      // Beds.
      const moving = near.filter(v => v.v > 2).length, crowdN = people.filter(c => Math.abs(c.x - me.x) + Math.abs(c.z - me.z) < 40 && c.state !== 'inside').length;
      bed ??= noiseBed(380, .6, 'lowpass'); crowd ??= noiseBed(900, 1.4, 'bandpass');
      const t = m.ctx.currentTime;
      if (bed) { bed.spot.move({ x: me.x + 6, z: me.z + 6 }); bed.gain.gain.setTargetAtTime(Math.min(.5, .06 + moving * .045), t, .8); }
      if (crowd) { crowd.spot.move({ x: me.x - 4, z: me.z + 3 }); crowd.gain.gain.setTargetAtTime(Math.min(.32, crowdN * .018) * (.75 + .25 * Math.sin(t * .7)), t, .6); }
    },
    horn(at: { x: number; z: number; id?: string }) {
      const m = audio(); if (!m) return;
      const c = m.ctx, out = output(m, { x: at.x, y: .9, z: at.z }, 5), seed = [...(at.id ?? 'x')].reduce((h, ch) => h * 31 + ch.charCodeAt(0) >>> 0, 7);
      const f0 = 360 + (seed % 7) * 24, len = .18 + (seed % 3) * .14, t = c.currentTime + .02, g = c.createGain(), lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2200; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .02); g.gain.setValueAtTime(.16, t + len); g.gain.linearRampToValueAtTime(0, t + len + .06);
      for (const f of [f0, f0 * 1.26]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + len + .1); }
      lp.connect(g).connect(out);
      if (seed % 4 === 0) setTimeout(() => this.horn({ ...at, id: (at.id ?? '') + '.' }), (len + .12) * 1000); // a double toot
    },
    crash(at: { x: number; z: number; strength?: number }) {
      if (!play('glass', { at: { x: at.x, y: .8, z: at.z }, gain: .5 + (at.strength ?? .5) * .5, range: 60 })) {
        const m = audio(); if (!m) return;
        const c = m.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = 'triangle'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + .3);
        g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .4); o.connect(g).connect(output(m, { x: at.x, y: .5, z: at.z }, 5)); o.start(t); o.stop(t + .45);
      }
    },
    quiet() { for (const l of engines.values()) l.stop(.5); engines.clear(); bed?.stop(); crowd?.stop(); bed = crowd = null; },
    stop() { this.quiet(); },
  };
}
