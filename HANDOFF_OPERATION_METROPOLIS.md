# Handoff — Operation: Metropolis (Combat Arena flagship map)

Branch: `lushegs/optimistic-lovelace-cjallt` · PR: https://github.com/Lushegs01/CampOS-Worlds/pull/34
Last commit pushed: `0c66b03` (map, server rules, asset pack). Everything after it (city renderer, audio, UI
wiring) was saved in a second commit together with this file.

## Implemented
- **Map** `shared/arena/metropolis.mjs` (registered in `shared/arena/maps.mjs`): fictional Okun Bay, 120 × 88 m,
  mirror-symmetric across x = 0, street raised to y = 5 over an underground station (floor y = 1, track y = 0).
  Five districts: Downtown (Marina Avenue, Marina House, Atlantic Grill, Balogun Arcade), Rooftops (+12 m, fire
  escapes, walkways, tower podium), Underground (Plaza Station platforms, corridors, service corridor, car park),
  Industrial (Harbour Road, Warehouse 4 with mezzanine, container yard, quay, substation), Central Plaza (Okun Spire,
  ring fountain, kiosks, station entrances). Exports districts, lighting variants, building list, station spaces,
  glass panes, and a deterministic train timetable (`trainAt`).
  Validated with a scratch script: 0 unmirrored boxes, all spawns/zones clear, all districts reachable by nav mesh,
  base spawns not visible from the enemy half (one spawn at x=-56.5, z=31 is seen from 14 roof cells).
- **Server** `server/arena/match.mjs`: map variants (Quick Play forced to `day`), server-authoritative breakable glass
  (shots and blasts; `glass` events; reset on match start), the station train (blocks shots, kills players on the
  track bed, `train` warning event), y-aware spawns. `service.mjs` passes host `variant` for private/training.
  `bots.mjs`: binary-heap A*, `walkable` node set.
- **Assets** `scripts/assets/build-metropolis.mjs` → 13 Poly Haven CC0 PBR texture sets + 18 CC0 props in
  `public/assets/arena/{textures,props}` (manifest `public/assets/arena/metropolis.json`), phone tier rebuilt.
  Ambience bank `amb.metropolis` (BigSoundBank CC0) via `scripts/assets/arena-audio/{recipes,sources}.mjs`.
- **Renderer** `src/arena/scene/city/` (`index.ts`, `kit.ts`, `materials.ts`, `structure.ts`, `props.ts`, `world.ts`):
  merged per material and per region chunk (station / 3×3 street grid / far), interior lighting by place, facades
  with real window reveals, sign atlas, vehicles, kiosks, furniture, palms/trees with wind, skyline, port cranes,
  ship, bay shader, bridge traffic, fountain, rain, train mesh, pane/shard instancing, lighting variants
  (day/overcast/sunset/night), point-light pool, power-failure hook (`setPower`).
- **Integration**: `Scene.tsx` (theme loading, city build, lighting, deferred normal/ARM maps via
  `loadSurfaceDetail`, glass FX, train audio, underground audio), `library.ts` (themes), `environment.ts` (exported
  Builder with chunks), `net.ts` (glass/train events, match clock, QA `__arena.start`), `store.ts`, `Hud.tsx`
  (station minimap layer, `train` cause), `MapPlan.tsx` (raised-street plan), `audio.ts` + `sound/engine.ts`
  (station/rain/harbour beds, long tunnel reverb, train loop and horn), `sound/surfaces.mjs` (city materials).
- Verified in Chromium (software GL): Training on Metropolis deploys in ~15–18 s, 29 files / 11.3 MB on Low.
  `npx tsc -b` passed after the last edits.

## Incomplete / known issues
- Station interior still reads dark and flat (ceiling was just brightened; not re-screenshotted).
- `bld-block` material split (`block` vs `blockwork`) just changed; not visually checked.
- Lobby has **no UI to pick a lighting variant** (server accepts `variant`; only QA hook sends it).
- No dedicated Metropolis intro / post-match screen; existing Deploy/Results screens are used.
- Power-failure dynamic event: `setPower` exists but nothing triggers it.
- No new automated tests for Metropolis (glass, train, variants, symmetry is covered by the generic map test).
- Docs not written: `docs/COMBAT-ARENA.md`, `docs/ASSETS.md` licence rows for the new textures/props/sounds.
- Not done: full `npm test` / `npm run build` after the renderer work; mobile FPS measurement; multi-device test.
- Pre-existing failing tests (before this work): arena-audio tests 41, 42, 49 (M7 has no reload plan / missing
  bank meta).
- Bus mesh appears as plain white box with flat colours at distance; tree crowns can fill the view near the plaza.

## Last failed command / error
- `node shots.mjs` (scratch screenshot harness) once failed with `listen EADDRINUSE 127.0.0.1:54391`
  (stale test stack); fixed by killing leftover postgres/chromium processes. Earlier run showed the lobby with
  "That match is no longer running" — the training match was closed by the server mid-capture (reconnect/abandon
  timers); harness now raises those timers.
- Audio build errors (fixed): loop source too short for `0032`; `bsb/3594 has no onset #0`.

## Important files
New: `shared/arena/metropolis.mjs`, `src/arena/scene/city/*`, `scripts/assets/build-metropolis.mjs`,
`public/assets/arena/metropolis.json`, `public/assets/arena/textures/{cityAsphalt,sidewalk,pavers,plazaStone,
floorTile,marble,subwayTile,facadePanel,cladding,blockWall,shutter,woodFloor,ceiling}/`, 18 props in
`public/assets/arena/props/`, `public/assets/arena/audio/amb.metropolis.mp3`, this file.
Modified: `shared/arena/maps.mjs`, `server/arena/{match,service,bots}.mjs`, `src/arena/Scene.tsx`,
`src/arena/scene/{library,environment}.ts`, `src/arena/{net,store,audio}.ts`, `src/arena/{Hud,MapPlan}.tsx`,
`src/arena/sound/{engine.ts,surfaces.mjs}`, `scripts/assets/arena-audio/{recipes,sources}.mjs`,
`public/assets/arena/audio/manifest.json`, `public/assets/arena/mobile/*`, `docs/audio/qc.json`,
`tests/arena-sim.test.mjs`.

## Next three tasks
1. Run `npx tsc -b`, `npm run build`, `npm test`; fix any regressions caused by Metropolis (expect only the 3
   pre-existing audio failures). Add tests: glass breaks once and resets, train kills only on the track, Quick Play
   forces `day`, `trainAt` timetable.
2. Visual pass with the screenshot approach (Training, `window.__arena.start('training', {t:'training', mode:'tdm',
   map:'metropolis', bots:0, difficulty:'easy', variant})`): fix station darkness, check all four variants and Low
   quality; measure FPS on Low/Medium and record real numbers.
3. Lobby/UX + docs: variant picker for private/training, Metropolis intro card, trigger `setPower` as a
   deterministic casual-only event, and document the map, assets and licences in `docs/COMBAT-ARENA.md` and
   `docs/ASSETS.md`.
