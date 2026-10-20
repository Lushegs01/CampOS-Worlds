// Compositor for the CampOS Worlds reveal. Driven frame by frame by tools/compose.mjs:
//   plates (rendered from the game) -> edit (cuts and transitions from edit/edit.json) -> grade ->
//   dimensional logo mark (three.js) -> kinetic type and world-tracked graphics -> grain.
// Type uses the game's own brand fonts (Manrope, DM Sans) and colours (src/styles.css); the logo is
// the game's own lockup (src/App.tsx .brand): three gold bars, "CampOS", a divider, "WORLDS".
import { createLogo } from './logo3d.js';

const BRAND = { gold: '#efc57b', cream: '#fff5dd', paper: '#f4f0e6', ink: '#243d33', deep: '#19382f' };
const clamp01 = x => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const mix = (a, b, k) => a + (b - a) * k;
const ease = {
  out: x => 1 - Math.pow(1 - x, 3), in: x => x * x * x, inOut: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  outExpo: x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x), inExpo: x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10), sine: x => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
const bell = x => Math.sin(Math.PI * clamp01(x));

let C, W, H, U, portrait, gl, prog, quad, tex = {}, overlay, octx, logo, cache = new Map();

// ------------------------------------------------------------------ WebGL grade and composite
const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * .5 + .5; uv.y = 1. - uv.y; gl_Position = vec4(p, 0, 1); }`;
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D A, B, OV, LG;
uniform float mixAB, time, grainAmt, vign, aspect;
// Per layer: transform (scale, rotation, offset), blur (kind, amount, direction), grade.
uniform vec4 xfA, xfB;      // scale, rot, dx, dy
uniform vec4 blA, blB;      // kind (0 none, 1 directional, 2 zoom, 3 spin), amount, dirx, diry
uniform vec4 grA, grB;      // exposure (stops), contrast, saturation, warmth
uniform vec4 fxA, fxB;      // silhouette, background blur (mip), darken, glow
uniform vec4 slit;          // hook reveal: height, softness, line glow, on
uniform float flash;

vec2 xform(vec2 q, vec4 xf) {
  vec2 c = q - .5; c.x *= aspect;
  float s = sin(xf.y), co = cos(xf.y);
  c = mat2(co, -s, s, co) * c / xf.x;
  c.x /= aspect; return c + .5 + xf.zw;
}
vec3 tap(sampler2D t, vec2 q, float lod) { return textureLod(t, clamp(q, vec2(.0005), vec2(.9995)), lod).rgb; }
vec3 plate(sampler2D t, vec2 q, vec4 xf, vec4 bl, float lod) {
  vec2 p = xform(q, xf);
  if (bl.x < .5 || bl.y < 1e-4) return tap(t, p, lod);
  vec3 acc = vec3(0); float wsum = 0.;
  for (int i = 0; i < 24; i++) {
    float k = (float(i) / 23. - .5), w = 1. - abs(k) * 1.2;
    vec2 s = p;
    if (bl.x < 1.5) s = p + bl.zw * bl.y * k;
    else if (bl.x < 2.5) s = .5 + (p - .5) * (1. + bl.y * k);
    else { vec2 c = p - .5; c.x *= aspect; float a = bl.y * k; c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c; c.x /= aspect; s = c + .5; }
    acc += tap(t, s, lod) * w; wsum += w;
  }
  return acc / wsum;
}
float luma(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
vec3 grade(vec3 c, vec4 g, vec4 fx, vec3 glowSrc) {
  // Restrained halation from the highlights (no bloom haze).
  c += max(glowSrc - .62, 0.) * vec3(1., .86, .66) * fx.w;
  c *= exp2(g.x);
  // Filmic contrast around mid grey, in display space.
  c = clamp(c, 0., 4.); c = mix(c, smoothstep(0., 1., c), g.y); c = (c - .5) * (1. + g.y * .35) + .5;
  float l = luma(c);
  c = mix(vec3(l), c, g.z);
  // Split tone: brand green in the shadows, gold in the highlights.
  vec3 shadowTint = vec3(.86, 1.02, .98), hiTint = vec3(1.05, 1.0, .9);
  c *= mix(shadowTint, hiTint, smoothstep(.15, .85, l)) * vec3(1. + g.w * .06, 1., 1. - g.w * .07);
  // Silhouette (the hook): the land and the campus go to black against a sky that keeps its glow.
  float skyMask = smoothstep(.5, .78, l);
  vec3 sil = mix(c * .035, c * vec3(1.12, .98, .82) * .95, skyMask);
  c = mix(c, sil, fx.x);
  // Under the logo: darkened towards the brand's deep green.
  c = c * (1. - fx.z) + fx.z * vec3(.018, .05, .038);
  return c;
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + time); return fract(p.x * p.y); }
void main() {
  vec3 a = plate(A, uv, xfA, blA, fxA.y), col = a;
  vec3 ga = grade(a, grA, fxA, tap(A, xform(uv, xfA), 4.5));
  col = ga;
  if (mixAB > 0.) {
    vec3 b = plate(B, uv, xfB, blB, fxB.y);
    vec3 gb = grade(b, grB, fxB, tap(B, xform(uv, xfB), 4.5));
    col = mix(ga, gb, mixAB);
  }
  if (slit.w > .5) {
    float d = abs(uv.y - .5), h = slit.x * .5;
    float m = 1. - smoothstep(h, h + slit.y, d);
    col *= m;
    float line = exp(-pow((d - h) / max(.002, slit.y * .6), 2.)) * slit.z;
    col += vec3(1., .9, .72) * line * (1. - smoothstep(.0, .9, abs(uv.x - .5) * 1.6) * .6);
  }
  col += flash * vec3(1., .93, .8);
  vec4 lg = texture(LG, uv); col = col * (1. - lg.a) + lg.rgb;
  vec4 ov = texture(OV, uv); col = col * (1. - ov.a) + ov.rgb;
  vec2 v = (uv - .5) * vec2(aspect, 1.); col *= 1. - vign * smoothstep(.35, 1.1, length(v) * 1.15);
  col += (hash(uv * vec2(1920., 1080.)) - .5) * grainAmt;
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

function setupGL() {
  const canvas = document.getElementById('out'); canvas.width = W; canvas.height = H;
  gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  for (const k of ['A', 'B', 'OV', 'LG']) { tex[k] = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex[k]); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, k === 'A' || k === 'B' ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); }
}
function upload(k, source, mip) {
  gl.bindTexture(gl.TEXTURE_2D, tex[k]);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !mip);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
}

// ------------------------------------------------------------------ edit: which frames, which transition
const TRANSITION = { cut: 0, black: 0, flash: 4 / 30, whip: 6 / 30, push: 8 / 30, spin: 10 / 30, dissolve: 14 / 30 };
/** A take's frame for film time T in a cut, as a layer description. */
function layer(cut, T) {
  const shot = C.shots[cut.shot] ?? { meta: { frames: 1, pre: 0, fps: 30 }, camera: [], files: new Set(), base: null };
  const t = T - cut.at + (cut.from ?? 0), m = shot.meta;
  const f = Math.max(0, Math.min(m.frames - 1, Math.round((t + m.pre) * m.fps)));
  return { cut, shot, t, f, xf: [1, 0, 0, 0], bl: [0, 0, 0, 0], gr: [0, .18, 1.06, .5], fx: [0, 0, 0, .28] };
}
function plan(T) {
  const cuts = C.edit.cuts;
  let i = cuts.findIndex(c => T >= c.at && T < c.to); if (i < 0) i = cuts.length - 1;
  const cur = cuts[i], next = cuts[i + 1];
  let a = layer(cur, T), b = null, mixAB = 0, flash = 0;
  // Transition into the next cut (second half of its window) or out of this one (first half).
  const into = (c, prev) => { const d = TRANSITION[c.in] ?? 0; return { d, p: d ? (T - (c.at - d / 2)) / d : 1, prev }; };
  let tr = null;
  if (next && TRANSITION[next.in] && T >= next.at - TRANSITION[next.in] / 2) tr = { out: cur, in: next, ...into(next) };
  else if (i > 0 && TRANSITION[cur.in] && T < cur.at + TRANSITION[cur.in] / 2) tr = { out: cuts[i - 1], in: cur, ...into(cur) };
  if (tr) {
    const p = clamp01(tr.p), A = layer(tr.out, T), Bl = layer(tr.in, T);
    switch (tr.in.in) {
      case 'dissolve': a = A; b = Bl; mixAB = ease.sine(p); break;
      case 'flash': a = p < .5 ? A : Bl; flash = Math.pow(bell(p), 2) * .28; a.fx[3] += bell(p) * .6; a.gr[0] += bell(p) * .3; break;
      case 'whip': {
        a = p < .5 ? A : Bl; const k = p < .5 ? ease.in(p * 2) : 1 - ease.out((p - .5) * 2);
        a.bl = [1, .22 * k, 1, 0]; a.xf[2] = (p < .5 ? -1 : 1) * .05 * k; a.gr[0] += .25 * k; break;
      }
      case 'push': {
        a = p < .5 ? A : Bl; const k = p < .5 ? ease.in(p * 2) : 1 - ease.out((p - .5) * 2);
        a.xf[0] = p < .5 ? 1 + .35 * k : 1 + .18 * k; a.bl = [2, .12 * k, 0, 0]; a.gr[0] += .2 * k; break;
      }
      case 'spin': {
        a = p < .5 ? A : Bl; const k = p < .5 ? ease.in(p * 2) : 1 - ease.out((p - .5) * 2);
        a.xf[1] = (p < .5 ? 1 : -1) * .35 * k; a.bl = [3, .5 * k, 0, 0]; a.xf[0] = 1 + .12 * k; break;
      }
    }
  }
  // Per-scene looks.
  for (const L of [a, b].filter(Boolean)) {
    const id = L.cut.shot;
    if (id === '01-hook') { const s = 1 - ease.inOut(seg(T, .55, 1.65)); L.fx[0] = s; L.gr[0] -= s * .35; }
    if (id.startsWith('05-')) { L.gr[3] = .8; L.gr[2] = 1.02; }
    if (id === '06-rise') {
      L.gr[3] = .85;
      // Under the logo: the aerial darkens, softens and drifts.
      const k = ease.inOut(seg(T, C.edit.brand.logo - .35, C.edit.brand.logo + .9));
      L.fx[1] = k * 4.6; L.fx[2] = k * .66; L.gr[2] = mix(1.02, .75, k);
    }
  }
  return { a, b, mixAB, flash };
}

async function plateImage(L) {
  if (!L.shot.base) return blank;
  const avail = L.shot.files; let f = L.f;
  if (!avail.has(f)) { let best = -1; for (const g of avail) if (Math.abs(g - f) < Math.abs(best - f)) best = g; f = best; }
  const url = `${L.shot.base}/${String(f).padStart(5, '0')}.png`;
  if (!cache.has(url)) {
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    cache.set(url, fetch(url).then(r => r.blob()).then(b => createImageBitmap(b)));
  }
  return cache.get(url);
}

// ------------------------------------------------------------------ typography
const font = (weight, size, family = 'Manrope') => `${weight} ${Math.round(size)}px "${family}"`;
function spaced(ctx, text, x, y, tracking, align = 'center') {
  // Letter-spaced text, measured glyph by glyph (canvas letterSpacing is applied after the last glyph too).
  const widths = [...text].map(ch => ctx.measureText(ch).width), total = widths.reduce((s, w) => s + w, 0) + tracking * (widths.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  [...text].forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + tracking; });
  return total;
}
/** A word revealed letter by letter, each rising out of its own mask. */
function risingWord(ctx, text, x, y, size, t, opts = {}) {
  const { stagger = .028, dur = .5, tracking = -.01 * size, color = BRAND.cream, accent = null, exit = 0, weight = 800 } = opts;
  ctx.font = font(weight, size);
  const glyphs = [...text], widths = glyphs.map(ch => ctx.measureText(ch).width), total = widths.reduce((s, w) => s + w, 0) + tracking * (glyphs.length - 1);
  let cx = x - total / 2;
  glyphs.forEach((ch, i) => {
    const k = ease.outExpo(seg(t, i * stagger, i * stagger + dur)), e = ease.inExpo(seg(exit, i * stagger * .5, i * stagger * .5 + .6));
    const dy = (1 - k) * size * .9 - e * size * .9;
    ctx.save(); ctx.beginPath(); ctx.rect(cx - size * .1, y - size * .95, widths[i] + size * .2, size * 1.2); ctx.clip();
    ctx.fillStyle = accent && (ch === '.' || ch === '?') ? accent : color;
    ctx.globalAlpha = k * (1 - e * .3); ctx.fillText(ch, cx, y + dy); ctx.restore();
    cx += widths[i] + tracking;
  });
  return total;
}
function lightSweep(ctx, x0, y0, w, h, k) {
  if (k <= 0 || k >= 1) return;
  ctx.save(); ctx.globalCompositeOperation = 'source-atop';
  const cx = mix(x0 - w * .3, x0 + w * 1.3, k), g = ctx.createLinearGradient(cx - w * .18, y0, cx + w * .18, y0 + h * .4);
  g.addColorStop(0, 'rgba(255,240,205,0)'); g.addColorStop(.5, 'rgba(255,240,205,.75)'); g.addColorStop(1, 'rgba(255,240,205,0)');
  ctx.fillStyle = g; ctx.fillRect(x0 - w, y0 - h, w * 3, h * 3); ctx.restore();
}
function scrim(ctx, x, y, rx, ry, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(8,18,14,${alpha})`); g.addColorStop(.55, `rgba(8,18,14,${alpha * .55})`); g.addColorStop(1, 'rgba(8,18,14,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
/** A short gold rule drawn out from the centre. */
function rule(ctx, x, y, width, k, alpha = 1) {
  if (k <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = BRAND.gold;
  const w = width * ease.outExpo(k); ctx.fillRect(x - w / 2, y, w, Math.max(2, 4 * U)); ctx.restore();
}

const EYEBROW = { 5.0: 'ÒRÌṢUN CAMPUS', 16.0: 'CAMPUS ROAD', 19.0: 'THE COURTS', 22.0: 'ADUNNI LEARNING COMMONS' };
function drawTitles(ctx, T) {
  for (const ti of C.edit.titles) {
    if (T < ti.at - .05 || T > ti.to + .05) continue;
    // Exit progress 0..1 (unclamped, a negative opacity would be ignored by the canvas and the title linger).
    const t = T - ti.at, exit = clamp01((T - (ti.to - .32)) / .32);
    const cx = W / 2;
    // A soft, wide darkening behind the type, so it reads over any background without a visible box.
    const sy = ti.y ? (ti.y - .03) * H : { word: portrait ? H * .4 : H * .52, question: portrait ? H * .37 : H * .43, build: portrait ? H * .44 : H * .48, statement: portrait ? H * .22 : H * .27 }[ti.style];
    scrim(ctx, cx, sy, W * (portrait ? .75 : .42), H * (portrait ? .2 : .3), .42 * ease.out(seg(t, 0, .35)) * (1 - ease.in(exit)));
    ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(10,20,15,.35)'; ctx.shadowBlur = 28 * U;
    if (ti.style === 'word') {
      const size = (portrait ? 132 : 128) * U, y = (ti.y ?? (portrait ? .43 : .56)) * H;
      const w = risingWord(ctx, ti.text, cx, y, size, t, { accent: BRAND.gold, exit });
      ctx.shadowBlur = 0;
      lightSweep(ctx, cx - w / 2, y - size, w, size * 1.2, seg(t, .25, .95));
      rule(ctx, cx, y + 34 * U, 120 * U, seg(t, .12, .7) * (1 - ease.inExpo(exit)));
      const eb = EYEBROW[ti.at];
      if (eb) { ctx.font = font(600, 24 * U, 'DM Sans'); ctx.fillStyle = BRAND.gold; ctx.globalAlpha = ease.out(seg(t, .15, .6)) * (1 - ease.in(exit)); spaced(ctx, eb, cx, y - size - 30 * U, 7.5 * U); }
    } else if (ti.style === 'question') {
      const lines = ['WHAT IF', 'CAMPUS WAS', 'A WORLD?'], size = (portrait ? 104 : 96) * U, lh = size * 1.04;
      const y0 = portrait ? H * .34 : H * .37;
      lines.forEach((line, li) => risingWord(ctx, line, cx, y0 + li * lh, size, t - li * .1, { stagger: .02, dur: .55, color: li === 2 ? BRAND.gold : BRAND.cream, exit: Math.max(0, exit - li * .05) }));
    } else if (ti.style === 'build') {
      const words = ti.text.split(' '), size = (portrait ? 150 : 130) * U, lh = size * 1.0, y0 = portrait ? H * .36 : H * .36;
      words.forEach((wd, k) => {
        const tb = T - ti.beats[k]; if (tb < 0) return;
        const pop = ease.outBack(seg(tb, 0, .22)), fade = k < words.length - 1 && T > ti.beats[k + 1] ? .55 : 1;
        ctx.save(); ctx.translate(cx, y0 + k * lh); const s = mix(1.22, 1, pop); ctx.scale(s, s);
        ctx.globalAlpha = seg(tb, 0, .06) * fade * (1 - ease.inExpo(exit));
        ctx.font = font(800, size); ctx.fillStyle = k === words.length - 1 ? BRAND.gold : BRAND.cream;
        spaced(ctx, wd, 0, 0, -.01 * size); ctx.restore();
      });
    } else if (ti.style === 'statement') {
      const [lead, main] = [ti.text.split(' ')[0], ti.text.split(' ').slice(1).join(' ')];
      const y = portrait ? H * .25 : H * .3, small = 46 * U, big = (portrait ? 126 : 118) * U;
      ctx.font = font(300, small); ctx.fillStyle = BRAND.cream; ctx.globalAlpha = ease.out(seg(t, 0, .5)) * (1 - ease.in(exit));
      spaced(ctx, lead, cx, y - big * .95, 18 * U);
      const k = ease.inOut(seg(t, .12, .75));
      ctx.font = font(800, big); ctx.globalAlpha = 1 - ease.in(exit);
      const w = ctx.measureText(main).width;
      ctx.save(); ctx.beginPath(); ctx.rect(cx - w / 2 - 20 * U, y - big, (w + 40 * U) * k, big * 1.3); ctx.clip();
      ctx.fillStyle = BRAND.cream; ctx.textAlign = 'center'; ctx.fillText(main.slice(0, -1), cx - ctx.measureText('.').width / 2, y);
      ctx.fillStyle = BRAND.gold; ctx.textAlign = 'left'; ctx.fillText('.', cx - w / 2 + ctx.measureText(main.slice(0, -1)).width, y); ctx.restore();
      // The leading edge of the wipe: a thin gold line.
      if (k > 0 && k < 1) { ctx.fillStyle = BRAND.gold; ctx.globalAlpha = bell(k); ctx.fillRect(cx - w / 2 - 20 * U + (w + 40 * U) * k, y - big * .9, 3 * U, big * 1.05); }
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------ graphics tracked to the world
function project(pose, p) {
  const [px, py, pz] = pose.pos, [lx, ly, lz] = pose.look;
  // The camera basis as three.js builds it: lookAt with world up, then the roll about the view axis.
  let f = [lx - px, ly - py, lz - pz]; const fl = Math.hypot(...f); f = f.map(v => v / fl);
  let r = [-f[2], 0, f[0]]; const rl = Math.hypot(...r); r = r.map(v => v / rl); // forward × up
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const c = Math.cos(pose.roll ?? 0), s = Math.sin(pose.roll ?? 0);
  const R = r.map((v, i) => v * c + u[i] * s), Uv = u.map((v, i) => -r[i] * s + v * c);
  const d = [p[0] - px, p[1] - py, p[2] - pz], z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (z < .2) return null;
  const tn = Math.tan((pose.fov * Math.PI / 180) / 2), aspect = pose.aspect ?? W / H;
  const x = (d[0] * R[0] + d[1] * R[1] + d[2] * R[2]) / (z * tn * aspect), y = (d[0] * Uv[0] + d[1] * Uv[1] + d[2] * Uv[2]) / (z * tn);
  return [(x * .5 + .5) * W, (.5 - y * .5) * H, z];
}
const MARKERS = [
  // The game's own location names (shared/campus.mjs), pinned to the real places.
  // They pin themselves to the campus first, then clear for the title (YOUR CAMPUS. at 25.0).
  { shot: '05-landmark', at: 24.15, to: 25.3, name: 'THE CONFLUENCE', kind: 'LANDMARK', p: [0, 7.4, 0] },
  { shot: '05-landmark', at: 24.3, to: 25.3, name: 'HORIZON AUDITORIUM', kind: 'TALKS & EVENTS', p: [0, 13.6, -40] },
  { shot: '05-landmark', at: 24.45, to: 25.3, name: 'ADUNNI LEARNING COMMONS', kind: 'LIBRARY', p: [-30, 10.2, -10] },
  { shot: '05-landmark', at: 24.6, to: 25.3, name: 'THE STUDENT HOUSE', kind: 'COMMUNITY & CAFÉ', p: [30, 9.4, -9] },
];
function drawMarker(ctx, m, T, pose) {
  const q = project(pose, m.p); if (!q) return;
  const [x, y] = q, k = ease.outExpo(seg(T, m.at, m.at + .5)), e = ease.in(seg(T, m.to - .3, m.to));
  const margin = 70 * U; if (x < margin || x > W - margin * 2.6 || y < H * .12 || y > H * .7) return;
  ctx.save(); ctx.globalAlpha = k * (1 - e);
  ctx.strokeStyle = BRAND.gold; ctx.lineWidth = 2.5 * U;
  ctx.beginPath(); ctx.arc(x, y, 9 * U * k, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = BRAND.gold; ctx.beginPath(); ctx.arc(x, y, 3.2 * U, 0, Math.PI * 2); ctx.fill();
  const len = 64 * U * k; ctx.beginPath(); ctx.moveTo(x, y - 12 * U); ctx.lineTo(x, y - 12 * U - len); ctx.stroke();
  ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(10,20,15,.45)'; ctx.shadowBlur = 14 * U;
  ctx.font = font(600, 17 * U, 'DM Sans'); ctx.fillStyle = BRAND.gold; spaced(ctx, m.kind, x + 12 * U, y - 12 * U - len + 4 * U, 3.4 * U, 'left');
  ctx.font = font(700, 27 * U); ctx.fillStyle = BRAND.cream; spaced(ctx, m.name, x + 12 * U, y - 12 * U - len + 36 * U, 1.2 * U, 'left');
  ctx.restore();
}
// The five-stop campus tour (shared/campus.mjs TOUR), along the real walks: Welcome Pavilion, The
// Confluence, Adunni Learning Commons, The Student House, Horizon Auditorium.
const TOUR_ROUTE = [[-12, 26], [-3.4, 26], [-2.4, 14], [-8.6, 7.6], [-12.4, 1.2], [-24.5, -.4], [-12.4, -1.6], [-9.2, -7.4], [0, -11.2], [9.2, -7.4], [12.4, -1.2], [29, 1], [12.6, 1.6], [9.6, -7.2], [2.2, -12], [2.2, -26], [0, -31.5]];
const TOUR_STOPS = [0, 2, 5, 11, 16];
function drawRoute(ctx, T, pose) {
  const k = ease.inOut(seg(T, 30.85, 31.75)), e = ease.in(seg(T, 31.8, 32.05)); if (k <= 0) return;
  // Subdivide the route on the ground and project it.
  const pts = [], cum = [0];
  for (let i = 0; i < TOUR_ROUTE.length - 1; i++) for (let s = 0; s < 8; s++) { const [a, b] = [TOUR_ROUTE[i], TOUR_ROUTE[i + 1]]; pts.push([mix(a[0], b[0], s / 8), .08, mix(a[1], b[1], s / 8)]); }
  pts.push([...TOUR_ROUTE.at(-1).slice(0, 1), .08, TOUR_ROUTE.at(-1)[1]]);
  const scr = pts.map(p => project(pose, p));
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const upto = cum.at(-1) * k;
  ctx.save(); ctx.globalAlpha = 1 - e; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [w, c] of [[10 * U, 'rgba(239,197,123,.22)'], [3.2 * U, BRAND.gold]]) {
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); let started = false;
    for (let i = 0; i < pts.length; i++) { if (cum[i] > upto || !scr[i]) break; if (!started) { ctx.moveTo(scr[i][0], scr[i][1]); started = true; } else ctx.lineTo(scr[i][0], scr[i][1]); }
    ctx.stroke();
  }
  TOUR_STOPS.forEach((si, n) => {
    const i = si * 8, q = scr[Math.min(i, scr.length - 1)]; if (!q || cum[Math.min(i, cum.length - 1)] > upto + .01) return;
    ctx.fillStyle = BRAND.deep; ctx.strokeStyle = BRAND.gold; ctx.lineWidth = 2.5 * U;
    ctx.beginPath(); ctx.arc(q[0], q[1], 11 * U, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = BRAND.gold; ctx.font = font(800, 12 * U); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n + 1), q[0], q[1] + .5 * U);
  });
  ctx.restore();
}
/** Understated frame: four corner brackets, a campus label, through scene 05. */
function drawFrame(ctx, T) {
  const k = ease.out(seg(T, 24.0, 24.6)) * (1 - ease.in(seg(T, 31.6, 32.0))); if (k <= 0) return;
  const m = (portrait ? 64 : 56) * U, top = portrait ? H * .11 : m, bottom = portrait ? H * .74 : H - m, l = 34 * U * k;
  ctx.save(); ctx.globalAlpha = .55 * k; ctx.strokeStyle = BRAND.cream; ctx.lineWidth = 1.6 * U;
  for (const [x, y, sx, sy] of [[m, top, 1, 1], [W - m, top, -1, 1], [m, bottom, 1, -1], [W - m, bottom, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * l); ctx.lineTo(x, y); ctx.lineTo(x + sx * l, y); ctx.stroke(); }
  ctx.font = font(600, 15 * U, 'DM Sans'); ctx.fillStyle = BRAND.cream; ctx.textBaseline = 'top';
  spaced(ctx, 'ÒRÌṢUN CAMPUS', m + 2 * U, top + 16 * U, 4 * U, 'left');
  ctx.restore();
}

// ------------------------------------------------------------------ the end card
function drawEndCard(ctx, T) {
  const B = C.edit.brand; if (T < B.name - .1) return;
  const k = ease.inOut(seg(T, B.name, B.name + .7)), sym = logo.symbolRect(T);
  // Wordmark beside the symbol, as in the game's header: "CampOS", a divider, "WORLDS".
  // Items are centred on the symbol's middle (the header is a centred flex row).
  const s = sym.scale, x0 = sym.x + sym.w + 12 * s, mid = sym.y + sym.h / 2;
  ctx.save(); ctx.textBaseline = 'middle';
  ctx.beginPath(); ctx.rect(x0 - 4 * s, sym.y - 40 * s, (W - x0) * k + 8 * s, sym.h + 80 * s); ctx.clip();
  ctx.font = font(750, 23 * s); ctx.fillStyle = BRAND.cream;
  const word = spaced(ctx, 'CampOS', x0, mid, -1 * s, 'left');
  const dx = x0 + word + 13 * s;
  ctx.fillStyle = 'rgba(228,234,212,.26)'; ctx.fillRect(dx, mid - 7.5 * s, Math.max(1, s), 15 * s);
  ctx.font = font(500, 11 * s); ctx.fillStyle = BRAND.cream; spaced(ctx, 'WORLDS', dx + 15 * s, mid, 3 * s, 'left');
  ctx.restore();
  // Tagline.
  const tk = ease.out(seg(T, B.tagline, B.tagline + .8));
  if (tk > 0) {
    const ty = sym.y + sym.h + (portrait ? 165 : 120) * U, size = (portrait ? 36 : 32) * U, tr = (portrait ? 4.4 : 5) * U;
    ctx.save(); ctx.globalAlpha = tk; ctx.textBaseline = 'alphabetic';
    ctx.font = font(600, size, 'DM Sans'); ctx.fillStyle = BRAND.cream;
    if (portrait) {
      spaced(ctx, 'A CAMPUS YOU DON’T JUST VISIT.', W / 2, ty + (1 - tk) * 14 * U, tr);
      ctx.fillStyle = BRAND.gold; ctx.globalAlpha = ease.out(seg(T, B.tagline + .45, B.tagline + 1.2));
      spaced(ctx, 'YOU EXPERIENCE.', W / 2, ty + size * 1.7, tr);
    } else {
      const a = 'A CAMPUS YOU DON’T JUST VISIT.  ', b = 'YOU EXPERIENCE.';
      ctx.font = font(600, size, 'DM Sans');
      const wa = [...a].reduce((s2, ch) => s2 + ctx.measureText(ch).width + tr, 0), wb = [...b].reduce((s2, ch) => s2 + ctx.measureText(ch).width + tr, 0);
      spaced(ctx, a, W / 2 - (wa + wb) / 2, ty + (1 - tk) * 14 * U, tr, 'left');
      ctx.fillStyle = BRAND.gold; ctx.globalAlpha = ease.out(seg(T, B.tagline + .45, B.tagline + 1.2));
      spaced(ctx, b, W / 2 - (wa + wb) / 2 + wa, ty, tr, 'left');
    }
    rule(ctx, W / 2, ty - size * 2.1, 80 * U, seg(T, B.tagline - .1, B.tagline + .5), .9);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ frame
async function frame(i) {
  const T = i / C.fps, P = plan(T);
  const imgA = await plateImage(P.a), imgB = P.b ? await plateImage(P.b) : null;
  upload('A', imgA, true); if (imgB) upload('B', imgB, true);
  // Overlay: graphics, titles, end card.
  octx.clearRect(0, 0, W, H);
  const pose = P.a.shot.camera[Math.min(P.a.f, P.a.shot.camera.length - 1)];
  drawFrame(octx, T);
  if (pose) { for (const m of MARKERS) if (m.shot === P.a.cut.shot && T >= m.at && T <= m.to) drawMarker(octx, m, T, pose); if (P.a.cut.shot === '05-pullback') drawRoute(octx, T, pose); }
  drawTitles(octx, T);
  const logoOn = T >= C.edit.brand.logo - .05;
  if (logoOn) logo.render(T);
  drawEndCard(octx, T);
  upload('OV', overlay, false);
  upload('LG', logoOn ? logo.canvas : blank, false);
  // Composite.
  gl.viewport(0, 0, W, H); gl.useProgram(prog);
  const loc = n => gl.getUniformLocation(prog, n);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); const pl = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
  ['A', 'B', 'OV', 'LG'].forEach((k, n) => { gl.activeTexture(gl.TEXTURE0 + n); gl.bindTexture(gl.TEXTURE_2D, tex[k]); gl.uniform1i(loc(k), n); });
  const set = (n, L) => { gl.uniform4fv(loc('xf' + n), L.xf); gl.uniform4fv(loc('bl' + n), L.bl); gl.uniform4fv(loc('gr' + n), L.gr); gl.uniform4fv(loc('fx' + n), L.fx); };
  set('A', P.a); set('B', P.b ?? P.a);
  gl.uniform1f(loc('mixAB'), P.b ? P.mixAB : 0); gl.uniform1f(loc('time'), (i * 7.13) % 100); gl.uniform1f(loc('grainAmt'), .035);
  gl.uniform1f(loc('vign'), .32); gl.uniform1f(loc('aspect'), W / H); gl.uniform1f(loc('flash'), P.flash);
  // The hook: a thin line of light opens into the picture.
  const hook = P.a.cut.shot === '01-hook' && T < 1.3;
  const h = .012 * ease.out(seg(T, .06, .4)) + ease.inOut(seg(T, .42, 1.25)), line = seg(T, .04, .16) * (1 - seg(T, .5, 1.0));
  gl.uniform4fv(loc('slit'), hook ? [Math.max(.0015, h * 1.05), .003 + h * .06, line * 1.4, 1] : [1, 0, 0, 0]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return { shot: P.a.cut.shot, f: P.a.f };
}

let blank;
async function init(config) {
  C = config; W = C.width; H = C.height; portrait = H > W; U = Math.min(W, H) / 1080;
  for (const s of Object.values(C.shots)) if (s) s.files = new Set(s.files);
  overlay = document.getElementById('overlay'); overlay.width = W; overlay.height = H; octx = overlay.getContext('2d');
  blank = document.createElement('canvas'); blank.width = blank.height = 2;
  const faces = [
    ['Manrope', '/node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'],
    ['Manrope', '/node_modules/@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2'],
    ['Manrope', '/node_modules/@fontsource-variable/manrope/files/manrope-vietnamese-wght-normal.woff2'],
    ['DM Sans', '/node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2'],
    ['DM Sans', '/node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2'],
  ];
  for (const [family, url] of faces) { const f = new FontFace(family, `url(${url})`, { weight: '200 800' }); await f.load(); document.fonts.add(f); }
  setupGL();
  logo = await createLogo({ width: W, height: H, brand: C.edit.brand, lockup: layoutLockup() });
  return true;
}
/**
 * The header lockup at base size (src/styles.css .brand): symbol 29 px, 12 px gap, "CampOS" (Manrope 750,
 * 23 px, -1 px tracking), 13 px gap, a 1 px divider, 15 px, "WORLDS" (Manrope 500, 11 px, 3 px tracking).
 * Scaled to the frame and centred.
 */
function layoutLockup() {
  const m = (text, f, tr) => { octx.font = f; return [...text].reduce((s, ch) => s + octx.measureText(ch).width, 0) + tr * ([...text].length - 1); };
  const base = 29 + 12 + m('CampOS', font(750, 23), -1) + 13 + 1 + 15 + m('WORLDS', font(500, 11), 3);
  const s = (portrait ? .76 : .42) * W / base, cy = portrait ? H * .41 : H * .44;
  return { s, x: W / 2 - base * s / 2, y: cy - 15 * s, base };
}
window.compose = { init, frame };
