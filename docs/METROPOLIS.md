# Operation: Metropolis

## Starting point and audit

Continued from `main` at `5643303` (merged PR #34), whose implementation commit is
`0c66b03`. The initial workspace was at PR #29; it was clean and was fast-forwarded
without replacing any local work. PRs #30–33 contain the deployment/audio and M7
changes already incorporated by #34.

PR #34 implemented the 120 × 88 m, west/east-symmetric shared collision map,
five districts, three elevated Domination objectives, street and forward spawns,
station timetable and server-side train damage/shot obstruction, breakable glass,
validated weather variants, A* navigation improvements, 13 city surface sets and
18 props with desktop/mobile manifests and source attribution. It also introduced
regional geometry batching and deferred texture-detail helpers.

The merged implementation was explicitly WIP. Its client still loaded the yard
library and renderer, so most city surfaces became generic concrete; city prop
assets and deferred detail were unused. It discarded spawn elevation, ignored
glass/train messages, had no weather controls or renderer, and drew street slabs
as buildings on tactical maps. The map requested an absent `amb.metropolis` bank.
There were no Metropolis-specific gameplay or browser tests, or operating notes.

Baseline `npm run build` passed. Baseline `npm test`: **325 passed, 3 failed**
(328 total). Those three failures exposed the earlier audio/M7 merge mismatch:
the current audio engine had neither an M7 reload plan nor an M7 bank. The existing
M7 PCM authoring module was orphaned. This continuation restores its timeline and
packages that original design for the current bank engine, without changing the
weapon's combat rules or replacing its sound with another rifle.

## Playing

Choose **Operation: Metropolis** in Quick Play, Private match or Training. The
firing range also uses the selected Training map. Quick Play always uses
**Harmattan Noon**; a private host or Training player can also select **Rainy
Season**, **Lagoon Sunset** or **Blue Hour**. Weather changes presentation only.

- Downtown: Marina Avenue, shops, offices and Balogun Arcade.
- Rooftops: north-block roofs and external fire escapes.
- Underground Transit: Plaza Station, corridors and car park.
- Industrial Zone: warehouses, mezzanines, containers and the quay.
- Central Plaza: the Okun Spire and fountain.

Street level is y=5, station platforms y=1, track bed y=0. Objectives A/B/C are
on the street; standing below them in the station does not capture them. The
minimap labels the current district and switches to the underground geometry.

Glass is visual, non-colliding cover: validated shots and blasts break it for
all clients. Rejoins receive the broken-pane set and a new round resets it. The
train first arrives 45 seconds into play, warns 7 seconds beforehand, and repeats
every 80 seconds in alternating directions. Stay on the platforms: it kills
players in the track bed and blocks gunfire. Its renderer derives position from
the shared timetable and the server's match clock, including on rejoin.

## Rendering and assets

`src/arena/scene/metropolis.ts` renders the existing shared geometry, regional
material batches, facade/window frames, signs, traffic, palms, railway, lagoon, skyline,
instanced glass and the train. City textures replace the yard theme. Color maps
load before deployment; normal and AO/roughness maps follow after play begins.
Props stream afterward, with visible geometry retained when a model cannot load.
Low uses the committed 512px tier, fewer rain particles and the existing adaptive
quality controls. Higher profiles retain their normal shadows and postprocessing.

The city reuses the licensed industrial ambience bank deliberately (declared on
the map), plus material-specific footsteps, glass impacts and the existing UI
warning sound. It does not ship new train field recordings. Asset authors,
licenses and source URLs are in `public/assets/arena/metropolis.json`.

Rebuild the city pack only when changing assets:

```sh
node scripts/assets/build-metropolis.mjs
node scripts/assets/build-arena-mobile.mjs
```

Rebuild the M7 bank from its existing original PCM source (requires ffmpeg):

```sh
node scripts/assets/build-m7-audio.mjs
```

Run that adapter after a full recorded-audio bank rebuild. No external audio
source is downloaded by the adapter.

## Verification

```sh
node --test tests/arena-metropolis.test.mjs tests/arena-audio.test.mjs
node tests/browser-metropolis.mjs
npm test
npm run build
npm run verify:release
```

The focused suite covers symmetry, actual simulated spawn heights, both teams'
routes to objectives and elevated/underground spaces, district classification,
weather validation, timetable directions, authoritative glass, train casualties,
vertical objective separation and both asset tiers. The browser suite uses the
real local room server and WebSocket protocol with the repository's local
PostgreSQL/account harness; it exercises map/weather selection, loading, elevated
spawns, district views, live shooting, rejoin and phone layout. Results and
screenshots are in `docs/metropolis-browser-results.json` and
`docs/screenshots/metropolis/`.

Browser rendering here uses Chromium software WebGL with a reduced QA render
scale. It verifies behavior and rendering, not physical-phone frame rate or
production network latency. Production deployment is not performed by these
checks.

### Validation results (12 November 2026)

- Full Node suite: **338 passed, 0 failed, 0 skipped** (baseline: 325/328).
- Focused Metropolis suite: **10 passed**, including train shot obstruction and
  warm-up glass reset.
- Production build and `verify:release`: passed; production QA hooks absent and
  the offline precache remains bounded at approximately 2.4 MiB.
- Nine-bot Domination simulation: 120 simulated seconds completed in 2.1 seconds
  of wall time on this environment; both teams scored (84–49), every bot moved
  away from deployment and all nine captured objectives. This is a simulation
  smoke check, not a concurrent-server capacity benchmark.
- M7 sprite decoded with ffmpeg: peak −4.10 dBFS, no NaNs or infinities.

- Browser suite: **7 checks passed**, desktop and phone; no JavaScript errors or
  failed asset requests. Includes a visible train driven by the server clock.
- Asset integrity: all **36 GLB models** decoded successfully; all **78 KTX2
  textures** have the expected full/mobile dimensions.

The browser evidence file records the latest completed run separately from these
server checks. Screenshots use 0.75 render scale for district captures; the train
capture uses the lower software-rendering test scale.
