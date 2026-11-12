// Original, weapon-specific sound design. Loaded on first M7 use, never during campus startup.
// Deterministic PCM layers: pressure pulse, body resonance, action and short outdoor decay.
// Deliberately distinct from the generic rifle's filtered noise envelope.
const buffers = new WeakMap<AudioContext, Map<string, AudioBuffer>>();
export function m7Buffer(ctx: AudioContext, name: string) {
  let bank = buffers.get(ctx); if (!bank) { bank = new Map(); buffers.set(ctx, bank); }
  const hit = bank.get(name); if (hit) return hit;
  const shot = name === 'm7-suppressed', duration = shot ? .48 : name === 'm7-insert' ? .19 : .12;
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate), data = b.getChannelData(0);
  let seed = 71139, low = 0, high = 0;
  const decay = (t: number, k: number) => t < 0 ? 0 : Math.exp(-t / k);
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2147483648 - 1; low += (white - low) * .11; high += (white - high) * .62;
    let sample: number;
    if (shot) {
      const pulse = Math.sin(2 * Math.PI * (155 * t + 35 * (1 - Math.exp(-t * 35)))) * decay(t, .048);
      const gas = low * decay(t - .002, .074) * .7;
      const crack = (white - high) * decay(t, .0036) * .65;
      const action = (white - low) * decay(t - .036, .007) * .18;
      const tail = low * decay(t - .055, .12) * .22;
      sample = pulse * .65 + gas + crack + action + tail;
    } else {
      const cfg: Record<string, [number, number, number]> = {
        'm7-release': [1700, .012, .6], 'm7-out': [460, .025, .55],
        'm7-insert': [230, .035, .8], 'm7-action': [2200, .018, .65],
        'm7-ready': [1300, .009, .35], 'm7-dry': [2800, .006, .45],
        'm7-switch': [620, .023, .45], 'm7-inspect': [940, .018, .28],
      };
      const [freq, d, gain] = cfg[name] ?? cfg['m7-ready'];
      sample = ((white - low) * .62 + Math.sin(t * freq * Math.PI * 2) * .24 + low * .4) * decay(t, d) * gain;
      if (name === 'm7-insert') sample += low * decay(t - .045, .017) * .7;
      if (name === 'm7-action') sample += (white - high) * decay(t - .045, .009) * .4;
    }
    data[i] = Math.tanh(sample * 1.25) * Math.min(1, t / .0004) * Math.min(1, (duration - t) / .012) * .82;
  }
  bank.set(name, b); return b;
}
