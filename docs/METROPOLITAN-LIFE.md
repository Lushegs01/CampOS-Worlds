# Metropolitan City: living population, autonomous traffic and cinematics

This pass adds a living population to Metropolitan City: NPC-driven traffic, pedestrians, signals and street furniture. It also adds a reusable cinematic director, eight state-triggered sequences and an art-direction pass on the city. Everything was checked in the running game. The **Evidence** section separates what is verified from what is only implemented.

## 1. Audit: the baseline before this work

These findings come from in-game screenshots (`docs/screenshots/city-life/before-*`) and reading the code.

- **Outside the Getaway mission, nothing in the city moved.** The only moving entities were the room's handful of scripted Harbour Exchange cars. Everything else was static parked cars (`METRO_PARKED`).
- **During the mission, `server/mission/streets.mjs` kept up to 7 cars and 12 pedestrians in a ring around the player.** Cars took a random road at every node. There were no traffic lights, no turning lanes, no parking and no districts. All pedestrians used the same full skinned avatars.
- **The road graph (`shared/expansion.mjs`) had no lane, signal or crosswalk data.** Zebra crossings existed only at the campus districts. Downtown had no street trees. Downtown planters sat on the sidewalk walking line as render-only boxes.
- **Facades were mostly grey and cream, and the distant LOD was plain boxes.** The detail geometry streams in at about 4 ms per frame, so in this container's software renderer (about 1 FPS) distant buildings stayed as plain boxes for a long time.
- **No cinematic system existed.** Sade's briefing and delivery were modal text panels, and only the briefing had a recorded voice.

## 2. Architecture

| Layer | File | What it does |
|---|---|---|
| Lane network | `shared/city/network.mjs` | Built from the shared road graph. It holds 216 directed lanes, 445 junction connectors (Bézier turns with conflict sets), 76 junctions and 24 signals. Signals run two phases with amber and all-red, with green-wave offsets. Unsignalled junctions use give-way priority. There are 62 off-street bays, 14 garage or car-park entrances and the expressway portal. For pedestrians it holds 1,110 sidewalk nodes, 161 crosswalks, 258 destinations (doors, benches, bus stops) and 94 pieces of street furniture. District speed and density profiles and the hourly activity curve live here too. |
| Traffic | `shared/city/traffic.mjs`, `vehicles.mjs` | 11 vehicle classes with district mixes and weighted factory paints. **Choosing and following routes:** each driver picks a goal (a bay, a garage, leaving by the expressway, or cruising; police patrol their districts) and runs A* over the lanes, avoiding congested lanes. **Car following:** Intelligent Driver Model, slowing for curves. **Junctions:** signal compliance with amber dilemma logic and a stop-line guard; reservations and conflict checks; turns give way; no entry when the exit is full. **Parking:** cars park nose-in and reverse out; they use garages; buses dwell at stops. **Obstructions:** drivers overtake a stationary obstruction when the opposite lane is clear, otherwise they turn round and blacklist the lane. **Reactions:** sirens (pull over), people and players in the lane (stop and sound the horn), player cars (collision response, crashed or disabled states), gunfire and explosions (flee, U-turn, drivers bail out). Clean-up runs out of sight only. |
| Pedestrians | `shared/city/pedestrians.mjs` | People walk to destinations along the validated sidewalk graph. They wait for walk signals, or for gaps at uncontrolled crossings. They keep right and pass each other. They chat, sit, wait and board buses, enter and leave buildings, dodge oncoming cars, flee or cower at gunfire and explosions, and watch crashes and sirens. Each person gets an individual look: 4 body types, skin, clothing (including printed dresses and wraps), hair, bags and headwear, height and build. |
| Tiers and budgets | both simulations | The whole city is simulated, not just a ring around the player. Update rate depends on distance: vehicles update every frame within 150 m, every 3rd frame within 340 m, otherwise every 8th. Pedestrians update every frame within 90 m, every 4th within 220 m, otherwise every 10th. Population is sized by district density × hourly activity, capped by a per-profile budget: 70/130/190/240 vehicles and 90/170/260/340 people for low/medium/high/ultra. New arrivals appear out of sight: from garages, doors, bays or the expressway, or mid-block far from every player. |
| Rendering | `src/city/*` | **Vehicles:** one instanced body mesh and one instanced glass mesh per class, all from a single shader. Each car gets its own paint, and its headlights, brake lights, indicators, hazards, police beacons and reverse lamps are driven live. Drivers are visible through the glass. Wheels are instanced and turn with steering. **People:** four instanced meshes with walk, run, idle, sit, talk and cower poses animated in the vertex shader. **Other:** contact shadows; signal and pedestrian lamps on the shared clock; zebra crossings, stop lines and give-way markings; bus shelters, benches and bins. Draw distance and frustum culling follow the graphics profile. |
| Audio | `src/city/sound.ts` | Positioned engine loops for the six nearest vehicles, pitched by class and speed. Two-tone horns, varied per vehicle, and crash impacts. Traffic-hum and crowd-murmur beds that follow what is around you. |
| Cinematics | `src/cinema/*` | **Shot grammar:** crane/aerial, tracking, over-the-shoulder, close-up, orbit, low-angle inserts. Shots are computed every frame from live positions, and a framing is kept only if the camera has a clear line of sight. **Playback:** blends in and out of the gameplay camera, cuts between shots, adjusts FOV, adds letterbox, title cards and subtitles, ducks other audio for voice, and hides the HUD. **Control:** a scene starts only when the game reaches the matching state, and only then, and never changes game state. Skip with Enter, Escape, Space or the Skip button. Blocking scenes hold the controls; non-blocking ones, such as the reveal while driving, leave them alone. |

### Multiplayer

Each browser simulates its own city around its player. The city is cosmetic and is not replicated, so it adds no network traffic. Every client sees the same signal phases, and players, their cars, the room fleet and the mission police are all obstacles every client's drivers respect. Two players standing side by side see the same kinds of traffic and signals, but not the same individual cars or people. A shared, room-authoritative ambient population would need interest-managed replication and is listed under outstanding work.

## 3. Cinematic sequences

| # (brief) | Sequence | Trigger (real state) | Blocking |
|---|---|---|---|
| 1–2 | `city-reveal`: aerial reveal, tracking shot of the player's vehicle, low chase | Player crosses from campus onto the Gateway Expressway | No (you keep driving) |
| 3–4 | `meet-contact`: establishing two-shot, over-the-shoulder, close-ups, reverse shot; Sade's voiced briefing with subtitles; Sade waves and turns to face you | Room sets `brief` after you talk to Sade | Yes |
| 5 | `warehouse-arrival`: crane down onto Bay 04 with a title card | Mission stage *Reach the warehouse* and you are within 34 m | Yes |
| 8 | `explosion`: low-angle shot of the blast, then a reaction shot | Room reports `exploded` | Yes, 2.5 s |
| 9–11 | `police-arrival`: an officer steps out of their car | Room reports an officer in `dismount` mode, and you are stopped | No |
| 12–13 | `containment`: overhead orbit of the ring of units, then over the shoulder of the officer nearest you at cover | Room reports `police.contained` | Yes |
| 16 | `safehouse-arrival`: lock-up establishing shot with a title card | Room advances *Reach the safehouse* to *Deliver* | Yes |
| 17–18 | `delivery`: handover, Sade reading the documents in close-up, reverse shot, the reveal; voiced, with subtitles | Room accepts the delivery | Yes |

Sequences 6–7 (discovering the hostile operation, the first confrontation), 14 (the getaway) and 15 (the pursuit) were deliberately not made into cutscenes. Combat and pursuit stay in the player's hands, and taking the camera away mid-fight would break the rule about player control. `police-arrival` and `containment` are implemented, but they were **not** triggered in a verified run (see Evidence).

## 4. Art direction

- **Palette.** Downtown uses sandstone, laterite terracotta, ochre, limestone, sage and slate facades. Curtain walls are blue-green, bronze, silver-blue and deep teal instead of one grey-black. Residential stucco is pastel, the Security District is in civic whites, and shop signs carry richer accent colours.
- **Distant skyline.** Towers now have stone podiums, floor spandrel bands and crowns. Other buildings have parapets.
- **Street trees.** 42 shared, collidable street trees now stand in planters between Downtown and Security District buildings. The planters were moved off the sidewalk walking line.
- **Street infrastructure.** New signal gantries, pedestrian signals, zebra crossings and stop lines at every controlled junction, plus give-way markings, bus shelters with lit advertising panels, benches and bins.

## 5. Blender and ElevenLabs

- **ElevenLabs.** Sade's delivery line (`voice/sade/delivery`, 11.8 s, 199 credits, voice `22N9cF8z0o7y23njdyaY` from `scripts/audio/dialogue-lines.mjs`, model eleven_v4) was generated and saved into `public/assets/elevenlabs/` with a manifest entry, so no remote URLs are used at runtime. The delivery scene plays it in sync with the subtitles, and the dialogue panel does not replay a line a scene has already voiced. Ambient pedestrian barks and new dispatch variations were **not** generated: there is no bark system to play them yet.
- **Blender.** Blender MCP was **not** used. The city's vehicles, people and street furniture are procedural geometry in the engine, built for instancing. Professionally modelled vehicle and character LODs from Blender remain outstanding.

## 6. Evidence

Run these:

```sh
node --test tests/city-life.test.mjs     # headless simulation suite (6 tests)
node tests/browser-city-life.mjs         # in-game city checks (QUALITY=low|medium|high)
node tests/browser-cinema.mjs            # in-game cinematics on the full local stack
```

The results are in `docs/city-life-results*.json` and `docs/cinema-results.json`. Screenshots are in `docs/screenshots/city-life/` and `docs/screenshots/cinema/`.

### Headless (`tests/city-life.test.mjs`, 6/6 pass)

- The network is connected, and lane and junction curves never enter a building.
- Crossing signal approaches never both show non-red, and pedestrians walk only while traffic on the arm they cross is held.
- Over six simulated minutes with the player hopping between districts: zero vehicle overlaps and zero red-light entries; more than 1,200 junction movements; at least 30% of vehicles moving at the end; parking and departures cycling; 9+ vehicle classes.
- A car stops short of a person standing in its lane.
- No pedestrian ever stands inside a building collider. Pedestrians cross streets, use doors and react to gunfire. Downtown holds more than twice the pedestrians of the Industrial District.
- The ten-minute investigations behind these tests used four random seeds × 400 s plus a 10-minute flow run at high density.

### In-game (`tests/browser-city-life.mjs`, medium profile, 14/14 checks pass)

The suite visits all seven districts and fast-forwards the live in-game simulation for two minutes. It records:

- 742 junction entries with **0** on red, and 192 stops at red lights.
- Worst lateral deviation from the lane 3.8 m, which happens while overtaking.
- 0 overlaps (one earlier run showed a single transient overlap before the manoeuvre fixes below).
- A car stopping 6.6 m short of the player standing in its lane.
- Pedestrians fleeing gunfire, 0 pedestrians inside buildings, and 225 street crossings.

### Cinematics in-game (`tests/browser-cinema.mjs`, full stack with room and accounts)

These sequences played from real room state: `city-reveal` (3 shots), `meet-contact` (5 shots, 6 subtitle cards), `warehouse-arrival` (skipped mid-scene; mission stage unchanged), `explosion` (2 shots, after the room's own ambush blast), `safehouse-arrival` and `delivery` (4 shots, voiced). Each scene logged start, shot and end events, and the camera and controls came back afterwards.

To reach each beat in minutes, the harness moves the player and, where noted in the test, sets a mission stage or stands down the ambush. The scenes themselves are triggered by the room's own logic.

### Performance

All browser numbers here come from **software WebGL (SwiftShader) in a 4-core container at about 1 FPS**. They show draw calls, triangles and simulation cost, not real frame rate. Real-GPU and phone frame rates have not been measured.

- **Simulation cost** (headless Node): traffic plus pedestrians for the whole city costs about 0.2–0.5 ms per step with roughly 150–250 vehicles and 220 people. The worst single step measured was 4–7 ms, during a refill.
- **Rendering cost:** the per-district draw calls and triangles for both profiles are recorded in `docs/city-life-results-low.json` and `docs/city-life-results.json`. The city adds about 20 draw calls in total: 11 vehicle classes × 2, plus wheels, shadows, 4 people meshes, the street kit and lamps.

## 7. Bugs found and fixed during testing

| Bug | Cause | Fix |
|---|---|---|
| City-wide gridlock within 2 minutes | Cars entered junctions without exit room and blocked crossing movements | Exit-room rule that counts vehicles already in the junction; congestion-aware routing |
| Parked and garage cars never left | Pulling-out cars waited for the queue that was waiting for them | Pending manoeuvres are no longer lane occupants |
| Cars stopped short of bays and stop lines | IDM's minimum gap was applied to virtual stop points | Gap compensation |
| 3 junction entries on red in 733 | Long, low-tier update steps skipped the stop-line check | Stop-line guard; drivers cleared on amber are counted separately |
| Transient overlaps | Bays too tight for vans and trucks; cars reversing into the lane; sibling-turn followers; garage entry and exit at the same time | Car-only bays at 3 m; shorter reverse; proximity guard limited to same-direction traffic; garage-path bay exclusion; manoeuvre exclusivity |
| Mutual-yield deadlock at priority junctions | Drivers yielded to "committed" cars that were themselves stopped | Explicit junction reservations |
| Glasshouses a quarter of their length, pillars sticking out | Half-lengths passed to the tapered box; inverted pillar angles | Corrected geometry |
| Wheels hidden behind the arch discs | Arch discs sat outside the wheels | Wheels flush with the body sides |
| Briefing establishing shot inside a wall | No occlusion test | `pickClear` framings with line-of-sight tests |
| HUD, the Sade label and the first-person weapon visible in scenes | — | Hidden while a scene plays |
| Scenes ran 10× long on slow frames | Clamped frame time | Scenes run on real time |
| Planters on the sidewalk walking line | Pre-existing render-only planters | Moved to the building line, with collidable trees |

## 8. Outstanding work and blockers

- **Shared population.** The ambient population is per-client (see Multiplayer). It is not room-authoritative and not replicated.
- **Player car collisions.** A player's car is not physically blocked by ambient cars. Ambient cars brake and evade, and on contact they crash or are disabled. Making them collide would mean putting them into the room's authoritative physics.
- **Lanes.** Lane changing is limited to overtaking: the network has one lane each way.
- **Time of day.** World lighting is fixed at golden hour by design ("Golden hour, all day"), so the city runs on 17:36. Density by hour works and can be tested with `__cityControl({ hour })`, but day, night, overcast and rain lighting for the open world was not built.
- **Untriggered scenes.** `police-arrival` and `containment` have not yet been triggered in a verified run. They need a full pursuit; `tests/browser-getaway-city.mjs` exercises that path but was not re-run.
- **Character performance.** Performances use the existing rig's emotes, gaze and idle looks. The rig has no facial animation or lip sync.
- **Blender and ElevenLabs.** No Blender-made assets, and no ambient pedestrian barks (see section 5).
- **Real-device testing.** Frame rate on real GPUs and phones has not been measured.
