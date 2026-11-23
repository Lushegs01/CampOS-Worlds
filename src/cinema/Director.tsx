// The cinematic director: watches the game for the moments a sequence is written for, then takes the camera for
// that sequence's shots, blending in from the gameplay camera and back out to it, cutting or easing between shots,
// with letterboxing, subtitles, an optional voice line and a title card. Blocking sequences hold the player's
// controls (Enter, Escape or Space skips); non-blocking ones (the city reveal while driving) leave them alone.
// The director never changes game state: a skipped sequence leaves the world exactly as a watched one.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { regionAt } from '../../shared/metro.mjs';
import { player, useGame } from '../state';
import { useGetaway } from '../mission/client';
import { audio } from '../audio/mixer';
import { loadElevenLabsVoice } from '../audio/elevenlabs';
import { QA_HOOKS } from '../qa';
import { SEQUENCES, type Built, type Ctx, type Sequence } from './sequences';
import { smooth } from './shots';
import { useCinema, cinemaLog } from './store';

const SEEN = 'campos-cinema-seen';
const loadSeen = (): string[] => { try { return JSON.parse(sessionStorage.getItem(SEEN) ?? '[]'); } catch { return []; } };
const saveSeen = (ids: string[]) => { try { sessionStorage.setItem(SEEN, JSON.stringify(ids)); } catch { /* private mode */ } };
const BLEND_IN = .55, BLEND_OUT = .7;

export default function Director() {
  const { camera } = useThree();
  const run = useRef<null | { seq: Sequence; built: Built; total: number; t: number; shot: number; fov: number; voice: AudioBufferSourceNode | null; skipped: boolean }>(null);
  const prev = useRef<Ctx['prev']>({ stage: null, exploded: false, contained: false, region: regionAt(player.x, player.z), dismounts: 0 });
  const prevBrief = useRef(false);
  const gp = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3(), dir: new THREE.Vector3() });
  const tmp = useRef({ look: new THREE.Vector3() });

  const finish = (skipped: boolean) => {
    const r = run.current; if (!r) return;
    try { r.voice?.stop(); } catch { /* already ended */ }
    (camera as THREE.PerspectiveCamera).fov = r.fov; camera.updateProjectionMatrix();
    cinemaLog(r.seq.id, skipped ? 'skip' : 'end', `t=${r.t.toFixed(2)}`);
    useCinema.setState({ active: null, blocking: false, title: null, subtitle: null });
    run.current = null;
  };
  const start = (seq: Sequence, ctx: Ctx) => {
    const built = seq.build(ctx), total = built.shots.reduce((n, s) => n + s.seconds, 0);
    run.current = { seq, built, total, t: 0, shot: -1, fov: (camera as THREE.PerspectiveCamera).fov, voice: null, skipped: false };
    const seen = [...new Set([...loadSeen(), seq.id])]; saveSeen(seen);
    useCinema.setState(s => ({ active: seq.id, blocking: seq.blocking, skippable: seq.skippable, seen, voiced: built.voice ? [...s.voiced, built.voice] : s.voiced }));
    cinemaLog(seq.id, 'start', `${built.shots.length} shots, ${total.toFixed(1)} s`);
    if (built.voice) {
      const m = audio(), id = built.voice;
      if (m) void loadElevenLabsVoice(m, id).then(buffer => {
        if (!buffer || run.current?.seq !== seq) return;
        const src = m.ctx.createBufferSource(), g = m.ctx.createGain(); src.buffer = buffer; src.connect(g).connect(m.dialogue);
        // Start in step with the subtitles (the first card's time), ducking the rest of the mix.
        const lead = Math.max(0, (built.lines?.[0]?.at ?? 0) - (run.current?.t ?? 0));
        src.start(m.ctx.currentTime + lead); m.duck.gain.setTargetAtTime(.42, m.ctx.currentTime, .06);
        src.onended = () => m.duck.gain.setTargetAtTime(1, m.ctx.currentTime, .18);
        if (run.current) run.current.voice = src;
      });
    }
  };
  const skip = () => { const r = run.current; if (!r || !r.seq.skippable || r.skipped) return; r.skipped = true; try { r.voice?.stop(); } catch { /* */ } r.t = Math.max(r.t, r.total - BLEND_OUT); useCinema.setState({ subtitle: null, title: null }); cinemaLog(r.seq.id, 'skip'); };

  useEffect(() => {
    // Skipping and holding the controls during a blocking sequence (captured before the game's own handlers).
    const key = (e: KeyboardEvent) => {
      const r = run.current; if (!r) return;
      if (['Enter', 'Escape', 'Space'].includes(e.code)) { if (r.seq.skippable) { skip(); e.preventDefault(); e.stopImmediatePropagation(); } return; }
      if (r.seq.blocking) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', key, { capture: true });
    const tap = () => { if (run.current?.seq.blocking) skip(); };
    window.addEventListener('cinemaskip', tap);
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__cinema = {
      state: () => ({ ...useCinema.getState(), running: run.current ? { id: run.current.seq.id, t: +run.current.t.toFixed(2), shot: run.current.shot, shotName: run.current.built.shots[run.current.shot]?.name, total: run.current.total } : null, camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: (camera as THREE.PerspectiveCamera).fov } }),
      play: (id: string) => { const s = SEQUENCES.find(q => q.id === id); if (!s) return false; finish(false); start(s, { mission: useGetaway.getState().mission, prev: prev.current, brief: useGetaway.getState().brief, prevBrief: prevBrief.current }); return true; },
      skip,
    };
    return () => { window.removeEventListener('keydown', key, { capture: true }); window.removeEventListener('cinemaskip', tap); if (QA_HOOKS) delete (window as unknown as Record<string, unknown>).__cinema; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useFrame((_, raw) => {
    // Scenes run on real time (a slow frame must not stretch a ten-second scene), but one stall never skips a shot.
    const dt = Math.min(raw, .5), g = useGetaway.getState(), mission = g.mission;
    const ctx: Ctx = { mission, prev: prev.current, brief: g.brief, prevBrief: prevBrief.current };
    if (!run.current && useGame.getState().phase === 'playing') {
      const seen = useCinema.getState().seen.length ? useCinema.getState().seen : loadSeen();
      const seq = SEQUENCES.find(s => !(s.once && seen.includes(s.id)) && s.trigger(ctx));
      if (seq) start(seq, ctx);
    }
    prev.current = { stage: mission?.stage ?? null, exploded: !!mission?.exploded, contained: !!mission?.police?.contained, region: regionAt(player.x, player.z), dismounts: mission?.officers?.filter(o => o.mode === 'dismount').length ?? 0 };
    prevBrief.current = g.brief;
    const r = run.current; if (!r) return;
    // The gameplay camera this frame (the player's camera system has already placed it).
    gp.current.pos.copy(camera.position); camera.getWorldDirection(gp.current.dir); gp.current.look.copy(camera.position).addScaledVector(gp.current.dir, 12);
    r.t += dt;
    if (r.t >= r.total) { finish(r.skipped); return; }
    // Which shot, and how far through it.
    let acc = 0, i = 0; while (i < r.built.shots.length - 1 && r.t > acc + r.built.shots[i].seconds) { acc += r.built.shots[i].seconds; i++; }
    const shot = r.built.shots[i], u = Math.min(1, (r.t - acc) / shot.seconds);
    if (i !== r.shot) { r.shot = i; cinemaLog(r.seq.id, 'shot', shot.name); }
    const pose = shot.at(r.t - acc, u);
    // Blend in from and back out to the gameplay camera.
    const w = smooth(Math.min(1, r.t / BLEND_IN, (r.total - r.t) / BLEND_OUT));
    camera.position.lerpVectors(gp.current.pos, pose.pos, w);
    tmp.current.look.lerpVectors(gp.current.look, pose.look, w);
    camera.lookAt(tmp.current.look);
    const cam = camera as THREE.PerspectiveCamera; cam.fov = r.fov + (pose.fov - r.fov) * w; cam.updateProjectionMatrix();
    r.built.act?.(r.t);
    // Subtitles and title card.
    const line = r.skipped ? null : r.built.lines?.find(l => r.t >= l.at && r.t < l.until) ?? null;
    const title = !r.skipped && r.built.title && r.t >= r.built.title.at && r.t < r.built.title.until ? r.built.title.text : null;
    const s = useCinema.getState();
    if (s.subtitle?.text !== line?.text || s.title !== title) useCinema.setState({ subtitle: line ? { speaker: line.speaker, text: line.text } : null, title });
    // Blocking sequences: the player's movement is held (the room brakes an undriven car on its own).
    if (r.seq.blocking) window.dispatchEvent(new Event('gameinputreset'));
  });
  return null;
}
