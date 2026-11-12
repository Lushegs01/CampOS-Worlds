// Combat Arena controls: keyboard and mouse (pointer lock), gamepads (standard mapping) and the touch
// controls (src/arena/Touch.tsx) all write into one `controls` object. Each 60 Hz simulation tick
// reads it to build an input command (src/arena/net.ts). Presses that are shorter than a tick
// (a tap on a phone, a quick key press) are latched until a tick has seen them.
import { B, PITCH_LIMIT } from '../../shared/arena/sim.mjs';
import { useArena, inputPaused } from './store';

export const controls = {
  /** Movement axes: mx right, mz forward, each −1…1. */
  mx: 0, mz: 0,
  /** Buttons held right now (bit flags from shared/arena/sim.mjs). */
  held: 0,
  /** Buttons pressed since the last tick (kept until a tick reads them). */
  latched: 0,
  yaw: 0, pitch: 0,
  /** Touch: the movement stick and its sprint lock; crouch is a toggle on touch. */
  touchMx: 0, touchMz: 0, touchSprint: false, touchCrouch: false, touchAds: false,
  /** Touch: the sprint button (held on until the stick is released). */
  touchSprintLock: false,
  gamepad: false, locked: false,
};
const keys = new Set<string>();
const KEYMAP: Record<string, number> = { Space: B.JUMP, ShiftLeft: B.SPRINT, ShiftRight: B.SPRINT, KeyC: B.CROUCH, ControlLeft: B.CROUCH, KeyR: B.RELOAD, KeyB: B.MODE, KeyI: B.INSPECT, Digit1: B.SLOT1, Digit2: B.SLOT2, KeyV: B.MELEE, KeyG: B.LETHAL, KeyQ: B.TACTICAL, KeyX: B.SWAP };
const STREAK_KEYS: Record<string, string> = { Digit3: 'recon', Digit4: 'supply', Digit5: 'strike' };
let mouseButtons = 0;
type Hooks = { streak: (id: string) => void; scoreboard: (open: boolean) => void; menu: () => void; autoFire?: () => void };
let hooks: Hooks | null = null;

/** Point the camera (radians; pitch clamped). */
export function look(dyaw: number, dpitch: number) {
  controls.yaw -= dyaw;
  controls.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, controls.pitch - dpitch));
}
/** Look sensitivity multiplier while aiming (slower when zoomed). */
export function aimScale(ads: number, zoom: number) {
  const s = useArena.getState().settings;
  return 1 + (s.ads / Math.max(1, zoom) - 1) * ads;
}
export const press = (bit: number) => { controls.latched |= bit; };
export const hold = (bit: number, on: boolean) => { if (on) { controls.held |= bit; controls.latched |= bit; } else controls.held &= ~bit; };

/** Buttons for this tick: held keys, mouse, touch and gamepad, plus anything latched since the last tick. */
export function buttons() {
  let b = controls.held | controls.latched | mouseButtons;
  for (const k of keys) b |= KEYMAP[k] ?? 0;
  if (controls.touchCrouch) b |= B.CROUCH;
  if (controls.touchAds) b |= B.ADS;
  if (controls.touchSprint || (controls.touchSprintLock && (controls.touchMx || controls.touchMz))) b |= B.SPRINT;
  controls.latched = 0;
  return b;
}
export function axes() {
  let mx = controls.touchMx, mz = controls.touchMz;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  mx += controls.mx; mz += controls.mz;
  const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  return { mx, mz };
}

// ---------------------------------------------------------------- gamepad (standard mapping)
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
let padPrev: boolean[] = [], padSprint = false, padCrouch = false;
const dead = (v: number, d = .16) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
/** Poll the first connected gamepad (called every frame). Returns true when one is in use. */
export function pollGamepad(dt: number, ads: number, zoom: number) {
  const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p && p.connected);
  controls.mx = 0; controls.mz = 0;
  if (!pad) { controls.gamepad = false; return false; }
  const s = useArena.getState().settings, btn = (i: number) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > .4;
  const was = (i: number) => !!padPrev[i], tap = (i: number) => btn(i) && !was(i);
  const lx = dead(pad.axes[0] ?? 0), ly = dead(pad.axes[1] ?? 0), rx = dead(pad.axes[2] ?? 0, .12), ry = dead(pad.axes[3] ?? 0, .12);
  if (lx || ly || rx || ry || pad.buttons.some(b => b.pressed)) controls.gamepad = true;
  controls.mx = lx; controls.mz = -ly;
  // Response curve: fine aim near the centre, fast turns at full tilt.
  const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
  const rate = 3.4 * s.pad * aimScale(ads, zoom) * dt;
  look(curve(rx) * rate, curve(ry) * rate * .75 * (s.invertY ? -1 : 1));
  if (tap(PAD.L3)) padSprint = !padSprint;
  if (ly > -.5) padSprint = false;
  if (tap(PAD.B)) padCrouch = !padCrouch;
  let held = 0;
  if (btn(PAD.RT)) held |= B.FIRE; if (btn(PAD.LT)) held |= B.ADS; if (btn(PAD.A)) held |= B.JUMP;
  if (padSprint) held |= B.SPRINT; if (padCrouch) held |= B.CROUCH;
  if (tap(PAD.X)) press(B.RELOAD); if (tap(PAD.Y)) press(B.SWAP); if (tap(PAD.R3)) press(B.MELEE);
  if (tap(PAD.RB)) press(B.LETHAL); if (tap(PAD.LB)) press(B.TACTICAL);
  if (tap(PAD.LEFT)) hooks?.streak('recon'); if (tap(PAD.UP)) hooks?.streak('supply'); if (tap(PAD.RIGHT)) hooks?.streak('strike');
  if (tap(PAD.DOWN)) press(B.MODE);
  if (tap(PAD.START)) hooks?.menu();
  if (btn(PAD.BACK) !== was(PAD.BACK)) hooks?.scoreboard(btn(PAD.BACK));
  controls.held = (controls.held & ~(B.FIRE | B.ADS | B.JUMP | B.SPRINT | B.CROUCH)) | held | (controls.touchAds ? B.ADS : 0);
  padPrev = pad.buttons.map(b => b.pressed);
  return true;
}

// ---------------------------------------------------------------- keyboard and mouse
/** Attach desktop input to the canvas. Returns a detach function. */
export function attachDesktop(canvas: HTMLCanvasElement, h: Hooks, zoomOf: () => { ads: number; zoom: number }) {
  hooks = h;
  const playing = () => { const a = useArena.getState(); return a.open && a.phase === 'match' && !inputPaused(a); };
  const down = (e: KeyboardEvent) => {
    if (!playing() || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Tab') { e.preventDefault(); h.scoreboard(true); return; }
    if (e.code === 'Escape') return; // pointer lock release opens the menu
    if (STREAK_KEYS[e.code]) { h.streak(STREAK_KEYS[e.code]); return; }
    if (e.code === 'KeyF' && !e.repeat) { h.autoFire?.(); return; }
    if (KEYMAP[e.code] !== undefined) { e.preventDefault(); controls.latched |= KEYMAP[e.code]; }
    keys.add(e.code);
  };
  const up = (e: KeyboardEvent) => { keys.delete(e.code); if (e.code === 'Tab') h.scoreboard(false); };
  const mouse = (e: MouseEvent) => {
    if (!controls.locked || !playing()) return;
    const s = useArena.getState().settings, z = zoomOf(), k = .0022 * s.mouse * aimScale(z.ads, z.zoom);
    look(e.movementX * k, e.movementY * k * (s.invertY ? -1 : 1));
  };
  const md = (e: MouseEvent) => {
    if (!playing()) return;
    if (!controls.locked) { void canvas.requestPointerLock?.(); return; }
    if (e.button === 0) { mouseButtons |= B.FIRE; controls.latched |= B.FIRE; }
    if (e.button === 2) mouseButtons |= B.ADS;
  };
  const mu = (e: MouseEvent) => { if (e.button === 0) mouseButtons &= ~B.FIRE; if (e.button === 2) mouseButtons &= ~B.ADS; };
  const wheel = (e: WheelEvent) => { if (playing() && controls.locked && Math.abs(e.deltaY) > 2) controls.latched |= B.SWAP; };
  const lock = () => {
    controls.locked = document.pointerLockElement === canvas;
    // Leaving pointer lock (Escape) pauses input and opens the menu, like any desktop shooter.
    if (!controls.locked && playing() && !controls.gamepad) { clear(); h.menu(); }
  };
  const clear = () => { keys.clear(); mouseButtons = 0; controls.held = 0; controls.latched = 0; };
  const menu = (e: Event) => e.preventDefault();
  window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
  window.addEventListener('mousemove', mouse); canvas.addEventListener('mousedown', md); window.addEventListener('mouseup', mu);
  canvas.addEventListener('wheel', wheel, { passive: true }); canvas.addEventListener('contextmenu', menu);
  document.addEventListener('pointerlockchange', lock);
  return () => {
    window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
    window.removeEventListener('mousemove', mouse); canvas.removeEventListener('mousedown', md); window.removeEventListener('mouseup', mu);
    canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', menu);
    document.removeEventListener('pointerlockchange', lock);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    clear(); hooks = null;
  };
}
export function releaseAll() { keys.clear(); mouseButtons = 0; Object.assign(controls, { held: 0, latched: 0, touchMx: 0, touchMz: 0, touchSprint: false, touchSprintLock: false, touchCrouch: false, touchAds: false, mx: 0, mz: 0 }); }
