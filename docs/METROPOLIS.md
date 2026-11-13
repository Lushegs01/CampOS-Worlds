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

### Environment fidelity pass

The follow-up on merged PR #35 replaces traffic blockouts with rounded vehicle
bodies, window seals, door hardware, grilles, bumpers, mirrors, lights and wheel
assemblies. Buildings gain foundation/coping courses and facade joints; streets
have smaller-scale asphalt, pavement joints, drains, wear and contact decals.
Rain adds reflective patches. Shop and station names are printed on lit material
signboards. The existing licensed photographic sky replaces the flat background,
and weapon sunlight, shadow probes and environmental brightness follow weather.
Decorative decals do not cast opaque rectangular shadows. Movement and shot
collision still use the existing authoritative map.

Run `METROPOLIS_REALISM=1 node tests/browser-metropolis.mjs` for desktop medium
(postprocessing enabled) and phone low. Evidence is stored separately in
`docs/metropolis-realism-results.json` and `docs/screenshots/metropolis-realism/`.
The QA render-scale helper resizes the postprocessing buffers along with the
canvas; district captures use 0.75 scale. It is excluded from production builds.

This is a procedural environment-detail pass, not Call of Duty production
fidelity. Remaining art work includes authored high-detail modular facades,
vehicle meshes with collision-matched silhouettes, richer interiors and local
reflection/lighting treatment. The current photographic sky is exposure-adjusted
for weather rather than a physically simulated time-of-day atmosphere. Validate
final quality and frame rate on actual target GPUs and phones; software WebGL
captures are functional evidence, not a performance benchmark.

Validation for this pass: all 338 Node tests pass when run without the software
browser workload. An earlier concurrent run passed 337/338: the short-duration
Domination match had already ended before its timed score assertion. That test
passed on the full isolated rerun; no server or collision code was changed.

## Visual transformation pass (13 November 2026)

The city renderer from the unmerged `0927a40` commit (`src/arena/scene/city/`) now draws Metropolis behind the
existing `buildMetropolis` interface; `cityDetail` wear (dirt, cracks, contact shading, drains, rain puddles) is
layered on top. Gameplay, collision, glass, train and weather selection are unchanged, apart from the slim lamp
post and palm trunks being solid again (12 lamp posts and 6 palms per side), so nobody can stand inside one.

- **Buildings**: facades are built around real window reveals (pane, frame, mullion, sill, balconies and wall
  condensers), shop fronts carry fascia signs or awnings, door leaves stand open, roller shutters roll into
  housings, interiors have plaster linings and skirting. Curtain-wall towers have mullion grids; Okun Tower has a
  stepped crown, mast and aviation light. The street walls are rows of varied buildings rather than one block.
- **Lighting by place**: every surface knows whether it is outdoors, in a shop, in a hall or under the street;
  sky light is cut to what reaches it and an interior fill is added (warm shops, cool station). A pool of real
  point lights follows the player between fittings. `setPower()` dims interiors (not yet triggered).
- **Station**: tiled walls with a line-colour band, stone platform floor, tactile and safety lines, rails, sleepers
  and ballast, a lit plaster soffit, tube fittings, ticket office, station control room, Plaza Station roundels.
- **Street and props**: lane, edge and crossing markings, granite kerbs, ironwork, traffic signals on a cycle,
  street name plates, lamp columns with lanterns, a city bus with a lit destination board, delivery truck,
  container lorries, pickups, cars from the campus fleet, kiosks with lettered fascias, shelters, planters,
  BRT median station, water tanks, condensers, vents, plant rooms, racking with stock, forklifts.
- **Plaza**: twisted bronze Okun Spire with ring and tip light, stone ring fountain with animated jets and pool,
  a tiled mural, palms and shade trees with wind.
- **Beyond the site**: three rings of towers whose windows light up at night, ship-to-shore cranes, a container
  ship alongside, a bay with a moving swell normal, a cable-stayed bridge with moving traffic.
- **Weather**: rain streaks and wet (smoother, darker, more reflective) streets in Rainy Season; emissive signs,
  lamps and windows scale with the variant; day ambient raised so shadowed faces are no longer crushed.
- **Streaming and culling**: geometry is merged per material and per region (station, 3 × 3 street grid, far);
  the station is only drawn from inside it or near a stair, the street and skyline only from above ground.
  Relief/roughness maps and set dressing still stream in after deployment.

### Graphics settings

Settings → Graphics now has **Low, Medium, High and Ultra** (arena only). Ultra adds full-resolution, high-sample
ambient occlusion, 16× anisotropic filtering, six real light fittings, more decals and casings, and a longer view
distance. **Resolution scale** (50–100 %) multiplies the profile's pixel density; adaptive performance works below
it and steps Ultra → High → Medium → Low. Both stay on the device (not synced to the account). Tests:
`tests/arena-graphics.test.mjs`.

### Verification

- `npm test`: **340 passed, 0 failed** (338 before, plus the two graphics-settings tests).
- `npm run build` and `npm run verify:release`: passed (precache 2.49 MB, no production debug hooks).
- `METROPOLIS_REALISM=1 node tests/browser-metropolis.mjs`: 7/7 checks, desktop Medium and phone Low. The phone
  night viewpoint moved from (−18, 5, −25) to (−18, 5, −23): the old point is inside the median palm's trunk.
- Before/after captures from the same camera positions: `docs/screenshots/metropolis-visual/{before,after}/`.
  These are Chromium software-WebGL captures: they show rendering, not real-device frame rates.

### Not done yet (next steps)

1. Measure FPS and memory on real phones and desktop GPUs per profile; tune Low (light pool, rain count, far
   chunk) from the numbers.
2. Restore the Metropolis audio from `0927a40` (its `amb.metropolis` bank, underground convolution reverb, train
   loop and horn); the map currently uses the Foundry ambience.
3. Weapons and characters: no model or animation changes were made in this pass. The container end faces in the
   yard still read flat close up; station columns are plain tiled boxes.

## Operation Photorealism (November 2026)

The city's sky, image-based light, fog, exposure and grade now come from one atmosphere per weather; surfaces carry
weathering, wetness and puddle layers; every window shows an interior-mapped room; rain is occluded by roofs and
awnings, lit by lamps, with curtains and splashes; High and Ultra reflect the city in wet streets. Graphics profiles,
measurements, before/after captures and what remains are in [PHOTOREALISM.md](PHOTOREALISM.md).
