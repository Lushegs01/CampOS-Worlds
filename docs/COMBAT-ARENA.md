# Combat Arena

An optional, competitive first-person multiplayer mode inside CampOS Worlds. Players open it from the
campus dock (**Arena**), play team matches in a fictional training simulation, and return to the same
spot on campus with the same account, profile and connection. Campus exploration, chat, parties,
vehicles, characters, classes and every other campus system are untouched: combat state never
reaches the campus room, and the campus scene stops rendering while the arena is open.

All names, maps, weapons, sounds, models and interface are original. Nothing is taken from any
existing shooter.

## Playing

1. **Open** — dock → **Arena**. The arena's code (≈53 KB gzipped with its styles, in `arena-*` chunks the offline cache leaves out) downloads only now.
2. **Lobby** — your name, level and experience; Quick Play per mode, Private match, Training, Rankings,
   and your loadout.
3. **Quick Play** — joins the fullest open match of that mode (and map, or *Any map*), or opens a new
   one. Teams are balanced as people join. You warm up on the map (no damage) until at least two
   players are present, then a countdown starts the match. Matches accept players in progress until
   three quarters of the time or score is used.
4. **Private match** — the host chooses mode, map and team size (1 v 1 to 6 v 6) and shares a
   six-character code; the host starts the match. Not recorded.
5. **Training** — 1–9 bots on Easy, Normal or Hard. Bots are named `SIM-Unit nn`, tagged **SIM**
   everywhere (roster, scoreboard, kill feed, name tags) and exist only in Training. Not recorded.
6. **Results** — victory/defeat, final scores, everyone's eliminations/deaths/assists/captures,
   your experience breakdown, level progress, unlocks, and whether the result was saved.
7. **Return to campus**, back to the lobby, or play again.

### Modes

| Mode | Rules |
|---|---|
| Team Deathmatch | Each elimination scores 1 for the team. Target 10 × team size (20–75), 10 minutes; most points wins, equal is a draw. Respawn after 4 s. |
| Domination | Zones A, B, C. Standing in a zone captures it (9 s alone, faster with up to three teammates); an enemy-held zone is neutralised half way. Contested zones freeze. Every zone held scores 1 every 2 s; first to 150 or most after 10 minutes. Respawn after 5 s, near zones your team holds. |

A team with nobody connected for 45 s forfeits. Free-for-all, Search and Destroy and Hardpoint are new
entries in `MODES` (`shared/arena/rules.mjs`) plus their scoring in `server/arena/match.mjs`.

### Maps

Both maps are mirror images across their centre line (tested), so neither team has an advantage.

* **Foundry Yard** (80 × 56 m) — a two-level brick warehouse in the middle (catwalk at 3.5 m reached by
  stairs from both ends, windows, a press machine), a container lane and stacked-container gantry to
  the north, a pump house interior and sandbag lines to the south, spawn shelters that block the long
  sightlines into each spawn.
* **Sim Quad** (72 × 68 m) — a stylised simulation of a campus quadrangle: two-storey teaching blocks
  with interior stairwells, classrooms and balconies over a fountain court, hedged lawns, and shaded
  arcades at each end, behind gate walls with three openings.

Spawns pick the safest point for your team: far from living enemies, out of their line of sight, away
from occupied points; Domination adds forward points near zones your team holds.

### Weapons

Seven classes, thirteen weapons, each with its own damage steps by range, fire mode, rate, magazine,
reserve, reload (shotguns shell by shell, interruptible), spread (hip, aimed, moving, airborne, bloom),
learnable recoil pattern, aim-down-sights time, movement speed, headshot and leg multipliers, and
penetration through thin cover (rails, sandbag lines).

| Weapon | Class | Access | Fire | RPM | Magazine | Damage (near → far) | Head | Reload (s) | Move |
|---|---|---|---|---|---|---|---|---|---|
| Vanguard AR-7 | Assault rifle | **Free** | auto | 740 | 30 | 28 @0m → 23 @24m → 19 @45m | ×1.45 | 2.1 | 0.97 |
| Wasp SMG-9 | SMG | **Free** | auto | 930 | 32 | 26 @0m → 19 @11m → 14 @22m | ×1.3 | 1.8 | 1.04 |
| Halcyon BR-3 | Advanced assault rifle | Armory | burst (3) | 340 | 24 | 30 @0m → 27 @30m → 23 @55m | ×1.4 | 2.2 | 0.96 |
| Kestrel K-45 | Heavy SMG | Armory | auto | 690 | 25 | 34 @0m → 24 @12m → 17 @24m | ×1.3 | 1.9 | 1.03 |
| Bastion 12G | Pump shotgun | Armory | semi | 72 | 6 | 22×8 @0m → 13×8 @7m → 6×8 @13m | ×1.2 | 0.6 per shell | 0.97 |
| Rampart Auto | Semi-automatic shotgun | Armory | semi | 210 | 8 | 16×7 @0m → 10×7 @6m → 5×7 @11m | ×1.2 | 2.4 | 0.96 |
| Longbow SR | Sniper rifle | Armory | bolt | 46 | 5 | 110 @0m → 98 @60m | ×2 | 2.9 | 0.9 |
| Talon DMR | Precision rifle | Armory | semi | 270 | 12 | 49 @0m → 44 @40m → 40 @70m | ×1.8 | 2.4 | 0.93 |
| Anvil LMG | Light machine gun | Armory | auto | 640 | 75 | 30 @0m → 26 @30m → 22 @55m | ×1.35 | 4.6 | 0.86 |
| Sparrow P9 | Sidearm | Armory | semi | 420 | 12 | 28 @0m → 21 @12m → 16 @25m | ×1.4 | 1.4 | 1.05 |
| Thorn .44 | Heavy sidearm | Armory | semi | 150 | 6 | 58 @0m → 46 @15m → 36 @30m | ×1.5 | 2.3 | 1.03 |
| Combat Knife | Melee | Free | melee | — | — | one hit within 2.3 m | — | — | 1.08 |
| Breach Axe | Melee | Level 7 | melee | — | — | one hit within 2.9 m | — | — | 1.02 |

Every gun also has a quick melee (two hits). Adding a weapon is a catalogue entry in
`shared/arena/weapons.mjs` (with its `access`, Armory class, role and trade-off) plus its row in a migration's
catalogue insert, and for a premium weapon its store item (`shared/shop.mjs`, `shop_items`); tests keep all
of them in step.

### Armory

Exactly **two firearms are free**: the **Vanguard AR-7** (assault rifle: balanced damage, moderate recoil,
reliable at medium range) and the **Wasp SMG-9** (submachine gun: very high fire rate, fast handling, falls off
past 11 m). The working names in the brief (“Kestrel AR-01”, “Viper SMG-09”) were not used because the arena
already had original weapons that match those roles exactly, and a *Kestrel* already exists (the K-45 SMG).
The Combat Knife (melee) is also free; the Breach Axe is earned at level 7.

Every other firearm is a **premium Armory weapon**, sold once through the campus store (₦1,500 by default,
`SHOP_PRICE_WEAPON`) and owned by the account on every device. Each is its own licensed model with its own
third-person LOD, sound profile, recoil pattern, handling and statistics:

| Armory class | Weapon | Strength | Trade-off |
|---|---|---|---|
| Advanced assault rifle | Halcyon BR-3 | 3-round bursts, tight aimed spread | Burst-only, slower aiming, 24 rounds |
| Heavy SMG | Kestrel K-45 | Hard-hitting up close, steadier recoil | Slower fire rate, 25 rounds |
| Pump shotgun | Bastion 12G | One-shot close fights | Useless past 13 m, shell reloads |
| Semi-automatic shotgun | Rampart Auto | Quick follow-ups indoors | Weaker pellets, ~11 m reach |
| Sniper rifle | Longbow SR | One body shot at any range | Bolt action, slow aim and movement |
| Precision rifle | Talon DMR | Accurate semi-auto at range | 2–3 hits, heavy recoil per shot |
| Light machine gun | Anvil LMG | 75-round belt | Slowest movement and aiming, 4.6 s reload |
| Sidearm | Sparrow P9 | Fast draw | Weak past 12 m |
| Heavy sidearm | Thorn .44 | Heavy single hits | Recoil, 6 rounds, slow reload |

**Fairness.** Paid weapons unlock playstyles, not victories. `dominates()` in `shared/arena/rules.mjs` compares
time-to-eliminate at every distance plus movement, aiming, swap, magazine and reload; the test suite fails if
any premium weapon is at least as good as a free one in every respect. That check found one real problem,
fixed in this update: the Halcyon BR-3 eliminated a full-health player with one 3-round burst out to 30 m
(3 × 34 = 102), beating both free weapons at every range; its damage is now 30 / 27 / 23 (a burst with one
headshot still eliminates). The Wasp out-trades every premium automatic at 5 m and the Vanguard is within 20 %
of the premium automatics at 30 m. Nothing is random: no loot boxes, no paid rerolls.

**Not built:** the brief also lists *tactical carbines* and *bullpup rifles*. Their licensed models could not
be fetched from this build environment (the Hugging Face / Objaverse and Poly Haven hosts the asset build uses
were blocked), so those classes have no weapon yet rather than a duplicated or placeholder model. Adding one is
an entry in `scripts/assets/build-arena.mjs` (`WEAPONS`) plus a catalogue entry.

**Buying and ownership.** The Armory (lobby, pause menu, or any locked weapon in the loadout editor) shows
each weapon's role, trade-off and statistics, and a 3D inspection of the real game model, downloaded only when
inspected. **Buy** opens the Bachs checkout through the campus connection ([STORE.md](STORE.md)); only the
signed webhook grants it. The arena server, the database (`save_arena_loadout`) and the client all check
ownership; a client claiming ownership changes nothing. A purchase or refund never interrupts a match: a new or
removed weapon applies from the next deployment. Purchase history: Armory → Purchase history. Accounts that
were already using a weapon when it joined the Armory keep it (`source = 'legacy'`).

**Equipment**: Frag Grenade (bounces, 2.4 s fuse) or Tack Charge (sticks, 1.5 s) as lethal; Flash Pulse
(blinds players who can see it, longer when facing it) or Smoke Canister (blocks bots' sight) as
tactical. **Perks** (two): Fleet Foot, Steady Hands, Deep Pockets, Quick Mend, Hardline, Ghost.

**Scorestreaks**: +1 point per elimination and per zone capture, kept until you die; rewards stay
available until used. Eliminations by a reward never earn points, so rewards cannot chain.

| Reward | Points | What it does |
|---|---|---|
| Recon Pulse | 3 | Reveals every enemy (except Ghost) on your team's map for 9 s; the enemy is warned |
| Supply Drop | 5 | A crate at your feet; you and teammates who touch it refill ammunition, equipment and health |
| Tactical Strike | 7 (level 4) | Marks the point you aim at; after a 2.8 s warning everyone sees, a 7.5 m blast (no friendly fire) |

The server checks each use: earned, alive, match running, and a per-team cooldown.

### Controls

| Desktop | Gamepad (standard mapping) | Touch |
|---|---|---|
| WASD move · mouse look (pointer lock) | left stick · right stick (curve, dead zones) | floating stick on the left half · drag the right half |
| Left click fire · right click aim | RT · LT | Fire button (drag on it to aim) · Aim toggle |
| Shift sprint · C/Ctrl crouch (slide while sprinting) · Space jump | L3 sprint toggle · B crouch/slide · A | push the stick to the top edge to sprint · crouch toggle (tap while sprinting to slide) · jump |
| R reload · 1/2/wheel/X switch · V melee · G lethal · Q tactical | X · Y · R3 · RB · LB | Reload · Switch · Melee · Lethal · Tactical |
| 3/4/5 rewards · Tab scoreboard · Esc menu | d-pad · Back · Start | reward buttons appear when earned · scoreboard · menu |

Settings: auto-fire, HUD customization, mouse, aiming, touch and gamepad sensitivity, invert vertical look,
field of view, sprint by stick, fixed or floating movement stick, graphics quality (with a recommendation for
the device), adaptive performance, frame rate readout, volume and mute (the game's master volume). Settings and
HUD layouts are kept on the device and, for signed-in players, in their account (`arena_preferences`).

### HUD customization

Settings (or the lobby, or the pause menu) → **HUD customization** opens a studio over a live preview drawn
with the match's own HUD components. Every element can be dragged anywhere in the safe area, resized with its
handle, a slider or + / −, faded, hidden, and (weapon, ammunition and kill feed) aligned left, centre or
right: crosshair, hit markers, kill notifications, health, player status, ammunition, current weapon, weapon
switching, minimap, compass, match timer, team score, objectives, kill feed and killstreak rewards; on touch
layouts also the movement joystick and the fire, ADS, reload, jump, crouch, sprint, switch, melee, lethal,
tactical, auto-fire and menu buttons. The crosshair has five styles, any colour, 1–4 px thickness and an
optional outline; it stays centred because it marks where shots go. HUD-wide: opacity, text size, icon size,
button transparency and a high-contrast mode. Presets (Classic FPS, Competitive, Minimal, Mobile Standard,
Mobile Claw) are starting points; any change makes the layout Custom.

Positions are fractions of the safe area (notches and rounded corners excluded), anchored so an element can
never leave the screen whatever its size or the aspect ratio. Desktop, touch landscape and touch portrait each
have their own layout and the right one is used automatically when the device rotates. Touch controls scale
with the screen but never below a 40 px target (fire 56 px, joystick 84 px), required controls (fire, joystick,
menu) cannot be hidden, and the studio warns about overlapping buttons; the default presets were checked not to
overlap on 640×360 to 1024×600 screens.

The studio has selection outlines, drag and resize handles, alignment guides (centre lines and other elements),
snap to grid, undo and redo, reset element, reset layout, restore the previous saved layout, and Save. Work in
progress is kept on the device until saved or discarded; nothing in the studio can fire, aim or move (gameplay
input is paused and the preview's controls are inert). **Try it in the firing range** opens Training with no
bots. Layouts are versioned (`HUD_VERSION`) and validated before use: an older, damaged or hostile layout is
repaired element by element and the player is told, never trusted (`validateLayout`, `shared/arena/hud.mjs`).

### Auto-fire

Settings → **Auto-fire: ON / OFF** (default **OFF**); also the F key, the AUTO touch button and the pause menu.
*“When enabled, your weapon automatically fires when your manually controlled aim is over a visible enemy.”*

Every 60 Hz input tick `autoFireDecision()` (`shared/arena/autofire.mjs`) casts the player's own line of fire
(their view plus the simulation's recoil) against the players the client is drawing. It presses the trigger
only if the first player on that line is an enemy that is alive and in the latest snapshot, within the
weapon's range, with no wall in between, and the weapon is ready with rounds in the magazine (not reloading,
switching or sprinting; semi-automatic weapons release the trigger between shots). A teammate in the line of
fire stops it. It never moves the view, never compensates recoil, never reloads for the player, and only adds
the same FIRE button a player presses, so the shared simulation enforces fire rate, magazine and reloads, the
server decides every hit with its own ray casts and lag compensation, and enemies behind walls are never even
sent to the client. Weapon accuracy and damage are identical whether it is on or off. Per-playlist policy is
public (`AUTO_FIRE_POLICY` in `rules.mjs`, sent in every match view): allowed in Quick Play, private matches and
Training today; a future ranked playlist would set it to `false` and the client switches it off there.

## Architecture

```text
shared/arena/           One deterministic implementation, used by server authority AND client prediction
  weapons.mjs           Catalogue: weapons, equipment, perks, rewards, finishes, emblems (DB mirrors it)
  sim.mjs               60 Hz player step: movement, stance, slide, jump, gravity, weapon state machine,
                        spread, recoil, shots; command encoding; state packing for reconciliation
  physics.mjs           Box world, uniform grid broad phase, swept movement with stepping, DDA ray casts
  maps.mjs              Foundry Yard and Sim Quad as boxes, spawns, zones, palettes
  rules.mjs             Modes, match timings, experience, levels, unlocks, loadout validation, balancing
server/arena/
  service.mjs           /arena WebSocket: identity (the room's Supabase verification), matchmaking,
                        private codes, training, reconnection, rate limits, recording results
  match.mjs             One isolated match: players, teams, tick loop, commands, hit registration with
                        lag compensation, damage, eliminations, assists, medals, respawn, zones,
                        grenades, rewards, interest-managed snapshots, lifecycle, combat log
  bots.mjs              Training bots: navigation grid + A*, line-of-sight targeting, human-like aim
src/arena/              Lazily loaded client (its own chunk)
  net.ts                Connection, prediction + rewind/replay reconciliation, interpolation, events
  input.ts              Keyboard/mouse, gamepad and touch into one control state
  Scene.tsx, scene/*    Merged-geometry maps, pooled effects, mannequins, first-person weapon pass
  Hud.tsx, Lobby.tsx, Loadout.tsx, Results.tsx, Touch.tsx, ArenaApp.tsx, audio.ts, arena.css
supabase/migrations/20261109120000_combat_arena.sql   Additive persistence
```

### What was there, and how the arena fits

The campus is a Vite + React + React Three Fiber client with one authoritative Node `ws` room
(`server/room.mjs`, one in-memory campus room on `/ws`) and Supabase for accounts. The campus room is
a single population by design; it is not a match system. So the arena is **additive**:

* It shares the room's HTTP listener and its account verification only. `server/room.mjs` routes the
  `/arena` upgrade to `createArena()` (with its own origin check and capacity) and closes it on
  shutdown; `/admin/arena` reports its matches. Nothing else in the room changed.
* Every match is its own `createMatch()` object with its own clock, tick interval, players,
  projectiles and objectives. No match state is global; many run side by side (tested with eight).
* The client keeps the campus connection (presence, chat, friends keep working) and pauses the
  campus scene (`frameloop="never"`) and campus keyboard handling while the arena is open.

### Networking

* **Commands, not outcomes.** Each 60 Hz tick the client sends `[seq, buttons, move x, move z, yaw,
  pitch]` (quantised identically on both sides), batched at ~30 Hz. The server simulates them with the
  same `step()`. It never accepts positions, hits, damage, ammunition, kills or scores from a client.
* **Prediction and reconciliation.** The client simulates its own commands immediately. Each snapshot
  carries the server's full state for that player and the last command it applied (`ack`); the client
  adopts that state, replays the unacknowledged commands, and smooths any visual difference over
  ~70 ms (snapping beyond 2 m). Camera position interpolates between 60 Hz ticks on faster screens.
* **Remote players** are drawn 100 ms in the past, interpolated between 20 Hz snapshots on the
  server's clock (`src/network/interpolation.mjs`, shared with the campus).
* **Lag compensation.** Every command batch says which server moment the client is drawing remote
  players at (`rt`). Shots are tested against other players' positions at that moment (recorded with
  every snapshot, so the server checks against exactly what the client drew), capped at 300 ms.
* **Trades.** A player eliminated in the last 140 ms can still land shots already fired; both
  eliminations count once each.
* **Interest management.** An enemy is sent to a player only if they are within 14 m, visible
  (line of sight to head, chest or a little either side), or were visible in the last 600 ms. A
  modified client therefore cannot draw enemies through walls; teammates are always sent. Revealed
  enemies (firing without Ghost, or Recon Pulse) appear only as map dots.
* **Priorities.** Snapshots are droppable: if a phone's connection backs up, newer snapshots replace
  older ones. Events (kills, hits, captures, results) are never dropped. Persistently slow connections
  are closed and reconnect. Messages over 512 bytes are compressed.
* **Bandwidth.** ~17 KB/s down per player in a full 6 v 6 at 20 snapshots/s (measured below).
* **Failure handling.** A dropped connection keeps its place for 60 s; the client reconnects with
  backoff and rejoins with its match key (also after a page reload, from session storage), keeping team,
  statistics and life. A key only works for the account that joined. Duplicate and replayed commands
  are ignored by sequence number; stale gaps are skipped. Abandoned teams forfeit; an empty match closes.

### Scaling

One room process hosts many matches (`ARENA_MAX_MATCHES`, default 60; `ARENA_CAPACITY` connections,
default 400). Matches share nothing, so more capacity is more processes: run more room processes and
route each arena client to one (sticky by connection; a reconnecting client must return to the
process that hosts its match, which the rejoin request identifies). Matchmaking is per process: Quick
Play groups players connected to the same process. A shared matchmaking queue across processes (for
example in Redis) is the next step and is **not built**.

### Anti-cheat

Validated on the server: every shot (the simulation decides if the weapon can fire — rate, magazine,
reload, switch and sprint-out are simulated, not reported), spread and recoil (applied by the server's
simulation, so removing recoil on the client does nothing), hits (server ray casts with capped
rewind), damage, eliminations (once per life), assists, score, captures, rewards (earned, alive,
cooldown), respawns (server timers only), loadouts (catalogue + unlock level + weapon level), team
membership and match access (key bound to account). Speed and fire-rate exploits are bounded by a
token bucket (60 commands per second plus a 24-command burst): extra commands are consumed and
ignored. Message size, rate and shape are checked; a fuzz test sends malformed messages of every type.
Interest management withholds hidden enemies. Every important event goes to a per-match combat log
(`ARENA_LOG_DIR`, one JSON-lines file per match) for disputes, never to the database.

Not prevented (no browser game can): aim assistance that moves the view like a person would, or
reading what the client legitimately receives (visible enemies' positions).

### Persistence

`supabase/migrations/20261109120000_combat_arena.sql` adds `arena_catalog` (mirrors the JS
catalogue; tested), `arena_stats`, `arena_weapon_stats`, `arena_loadouts` (private to the owner),
`arena_matches` and `arena_match_players`, with RLS (statistics public, loadouts private, no client
writes). Functions:

* `record_arena_match` — **arena server only**. Idempotent on the match id (concurrent duplicates
  queue on row locks and count once). Re-derives each player's result from the winner, recomputes
  experience with the same formula as the game (tested equal), refuses implausible statistics
  (> 40 eliminations a minute, headshots above eliminations, captures in Team Deathmatch, weapon
  eliminations above the total, unknown weapons) rather than clipping them, and returns level-ups,
  unlocks and weapon levels.
* `save_arena_loadout`, `set_arena_emblem` — the player's own, checked against unlocks.
* `my_arena`, `arena_profile`, `arena_history`, `arena_leaderboard`; `arena_snapshot` for the server.

Only Quick Play matches with at least two people that last a minute are recorded. Training and
private matches are not. Guests play fully; their loadouts stay on the device and they are told
progress needs an account. Movement and shots are never written to the database: one row per player
per match.

**Progression**: experience for eliminations (100), headshots (+25), assists (40), captures (150),
neutralising (60), defending a zone (50), and finishing the match (win 600, draw 400, loss 250);
30 levels (each costs 800 + 200 × the previous level). Levels unlock weapons, equipment, perks, the
Tactical Strike and emblems; weapon levels (from eliminations with that weapon) unlock finishes.
Everything except the premium Armory weapons is earned; the Armory sells weapons, never progression, statistics or experience.

## Visuals and rendering

The arena's look is a modern military shooter's, built from licensed production art (every source and
licence is in [ASSETS.md](ASSETS.md#combat-arena--loaded-only-when-a-match-opens); CC BY works are also
credited in the lobby under **Art credits**). Nothing is drawn with untextured primitives.

| Area | What it is | Where |
|---|---|---|
| Asset pack | 14 Poly Haven PBR surface sets (colour, normal, AO/roughness/metal), 14 photoscanned props, 3 Rocketbox soldiers in two camouflage colourways, 13 weapons with third-person LODs, rigged first-person arms. KTX2/Basis textures, meshopt glTF: 34 MB on disk, of which a match downloads about 22–25 MB (surfaces, props, soldiers, every third-person weapon LOD, the arms and the player's own two weapons), only when a match opens and never precached by the PWA | `scripts/assets/build-arena.mjs` → `public/assets/arena/` |
| Environment | Foundry Yard rebuilt from its collision boxes: corrugated shipping containers with real ribbed geometry, frames and door gear; precast perimeter panels with razor wire; brick sheds with trussed roofs, light fittings and framed windows and doors; sandbag walls; photoscanned barriers, crates, drums, generators, cans and lamps placed to read as a working depot; a splat-blended ground (slab, road, gravel, dirt and paint) under a real HDR sky; warehouses, silos and floodlight towers beyond the walls | `src/arena/scene/environment.ts` |
| Lighting | HDR image-based lighting from the campus sky (PMREM), shadowed sun matched to the HDRI, hemisphere fill, warm practical lights under roofs, a roof shelter mask that dims sky light on covered ground, indoor/outdoor probes for the weapon's light and the reverb | `library.ts`, `environment.ts`, `Scene.tsx` |
| Post-processing | Medium/High: ACES filmic tone mapping, bloom on hot highlights, grading (contrast, saturation), vignette, SMAA; High adds N8AO ambient occlusion. The first-person weapon is a second pass over a cleared depth buffer inside the same chain | `Scene.tsx` |
| First person | Licensed weapon models with measured grip, support-hand, sight and ejection anchors; optic glass removed on the sight line and an illuminated reticle on red-dot sights; gloved, rigged arms posed by two-bone IK with hand frames and finger wrap per hold (rifle, pistol, blade), forearm twist, a magazine-grab frame for reloads | `src/arena/scene/weapons.ts` |
| Weapon animation | Driven by the simulation's own timers, so it always matches gameplay: idle breathing, look sway, walk bob, sprint carry, jump and landing springs, slide cant, recoil kick and recovery, ADS blend, reload (tilt, magazine out and in, hand to magazine, charge), weapon switch, melee swing, grenade throw, pump/bolt/slide cycling | `Scene.tsx` (`updateViewmodel`) |
| Characters | Rocketbox military avatars with helmets, vests and team camouflage (woodland vs desert), motion-captured locomotion blended by speed (idle/walk/jog/run/crouch), spine and head follow aim pitch, both hands put on the third-person weapon by IK, a fall on elimination; teammates carry blue names, enemies a small red marker | `soldiers.ts` |
| Effects | Instanced particle pools (sparks, dust, debris, blood mist), impacts that differ by surface (concrete, metal, wood, sand, brick, dirt, foliage), decals, streak tracers, muzzle flashes with a flash light, ejected casings, explosion light and smoke, flashbang | `fx.ts` |
| Audio | Original layered designs per weapon (action, report, low punch, supersonic crack, reflection; outdoor tail; distant layer; four variants), reloads per mechanism, surface impacts, flybys, explosions, footsteps by surface; category buses with their own volumes, compressor and limiter, pooled voices with priorities, distance filtering, speed of sound, occlusion, indoor reverb | `audio.ts`, `sound/` |
| HUD | Compass strip with teammate and firing-enemy bearings, angled score panels, monospace timer and ammunition, magazine round bar, segmented health, minimap, kill feed, streak buttons; compact layout on phones | `Hud.tsx`, `arena.css` |

### Graphics profiles

All three use the same assets and art direction; Low scales cost, never the look. The first-visit profile is
recommended from what the device reports (`src/arena/device.ts`): the GPU's WebGL renderer string where the
browser shares it, the largest texture it accepts, memory, processor count, touch input and data saver — not
the user agent. The player can always choose another, and **adaptive performance** (on by default,
`shared/arena/adaptive.mjs`) holds 30 fps on touch devices and 55 fps elsewhere by lowering the render
resolution in 15 % steps (to a floor), and only then stepping the profile down one level, with a notice;
resolution comes back after ten comfortable seconds. Input, simulation and networking run at fixed rates
regardless.

| | Low | Medium | High |
|---|---|---|---|
| Resolution | 1× | up to 1.5× | up to 2× |
| Sun shadows | 1024², baked once | 2048², every 2nd frame | 4096², every frame |
| Post-processing | none (renderer ACES tone mapping) | tone mapping, bloom, grading, SMAA | + ambient occlusion (N8AO) |
| Practical lights | 0 | 2 | 4 |
| Detail | fewer sandbag segments, less dressing, low sky | full | full |
| Antialiasing | MSAA | SMAA | SMAA |
| Effects | half the particles, 24 decals, 10 casings | full, 64 decals | full, 120 decals |

Defaults come from the device as before (touch or ≤ 4 GB / ≤ 4 cores → Low).

### Loading and deployment

Deployment is an explicit lifecycle (`src/arena/deploy.ts`): **requesting → loading-code → preparing →
synchronizing → deployed**, plus **recovering** (connection lost while deploying) and **failed** (with the reason
and a Retry). Each stage has a time budget checked every second; preparing is judged by the time since the last
byte arrived, so a slow phone on a slow network is allowed as long as data flows. The deployment screen
(`src/arena/Deploy.tsx`) shows the real stages, the required files and megabytes received, slow-connection
guidance, Leave and Retry. Full diagnosis and measurements: [ARENA-DEPLOYMENT-AUDIO-UI-REPORT.md](ARENA-DEPLOYMENT-AUDIO-UI-REPORT.md).

Downloads go through `src/world/fetcher.ts`: a strict priority queue, stall and overall timeouts, retries with
backoff and jitter for transient failures (none for missing files), cancellation when leaving, byte progress.

| Priority | What | When |
|---|---|---|
| 1 — needed to play | every environment surface (colour maps essential; normal and AO/roughness maps fall back to flat ones), the props that are cover (crates, jersey barriers), the sky and its light, the player's own first-person weapon (queued first) and arms | before the match is shown |
| 2 — nearby detail | soldiers with their animation libraries and the free weapons' third-person models (other players are drawn as soldier-shaped stand-ins in team colours until they arrive), the second weapon, set dressing (drums, cans, lamps, generators; added once the match is on screen) | in parallel, after every priority-1 file has finished |
| 3 — optional | the other weapons' third-person models | idle time after 8 s, Medium and High only, never with data saver |

The **Low** profile loads the phone texture tier (`public/assets/arena/mobile/`, built by
`node scripts/assets/build-arena-mobile.mjs`): the same textures' 512² mip chain, made by dropping the top mip level
of each KTX2 (no re-encoding), 18.9 MB → 8.8 MB. First-person weapons and arms stay full resolution. The tier is
fixed for a match, so an adaptive drop from Medium to Low never re-downloads.

The scene compiles its shaders (`compileAsync`) before revealing the match, then tells the server it has loaded.
Clients that report this (`caps: ['loadgate']`) are held out of live combat until then (capped at
`rules.loadWaitMs`, 20 s): joining a match in progress, starting a match, or reconnecting after a page reload never
puts a player in front of enemies while their screen is still loading. **Training** also holds its countdown.

## Performance

* The arena is a separate chunk and loads nothing for campus-only players. While it is open the campus
  stops rendering.
* Static geometry is merged per material with world-space UVs (about 60–110 draw calls on Low);
  props, sandbags and particles are instanced; nothing is allocated per shot.
* Remote soldiers (skinned, so three.js cannot cull them) are culled per soldier against the view frustum, and
  posed at a lower rate far away (every 2nd frame beyond 25 m, every 3rd beyond 50 m on Low); posing and arm IK
  allocate nothing per frame.
* Sound: 20 voices on phones (stereo panning), 32 elsewhere (HRTF); band-limited layers rendered at half the sample
  rate; the loadout's sounds are rendered ahead of play, other weapons' when first seen.
* Leaving a match disposes its renderer; leaving the arena cancels its downloads and releases its parsed models,
  textures, materials and sounds (`releaseArena()`). Repeated matches: `tests/browser-arena-soak.mjs`.

### Rendering measurements

Fixed cameras on Foundry Yard in Training, 1280 × 720, captured by `LABEL=after node
scripts/qa/arena-shots.mjs` (`docs/performance/arena-visual-after.json`; Sim Quad with `MAP=quad`). Counts
are per frame including the first-person pass. On Medium and High they also include the shadow and
post-processing passes.

| View | Low: draw calls / triangles | Medium | High |
|---|---|---|---|
| Yard | 72 / 214k (world pass 165k) | 143 / 318k | 274 / 595k |
| Interior | 66 / 211k | 155 / 585k | 171 / 593k |
| Lane | 71 / 213k | 143 / 318k | 274 / 595k |
| Squad (three soldiers at 5 m) | 78 / 234k | 219 / 623k | 288 / 631k |
| Sim Quad court | 115 / 154k | — | 268 / 386k |

GPU textures resident: 145 (Low) to 198 (High). Before the overhaul the scene was a dozen flat-coloured
boxes; its recorded counters (`arena-visual-before.json`) cover only the weapon pass and are not
comparable. Before/after pictures from the same cameras: `docs/screenshots/arena/visual/compare-yard.jpg`,
`compare-interior.jpg`, `compare-lane.jpg` and `compare-ads.jpg`. All frame rates here were taken with
software rendering (SwiftShader, no GPU) and are **not** representative: 0–3 fps on every profile in this
environment. **No GPU or phone measurements were possible.** The Low profile's ~214k triangles and ~70
draw calls are within what mid-range phone GPUs handle at 30 fps, but that is an estimate, not a
measurement.

Measured (`docs/performance/arena-load.json`, `node scripts/qa/arena-load.mjs`): one room process with
4 full 6 v 6 Quick Play matches (48 WebSocket clients each sending 60 commands/s while moving and
firing) plus 4 Training matches (36 bots) for 20 s — **31% of the server's main thread**, event-loop
delay p99 9.4 ms, every client received 20.0 snapshots/s (minimum 20.1), ~17 KB/s download per client,
3,908 shots resolved with lag compensation.

Client frame rate before the visual overhaul was 44 fps on Low with software rendering at a 844 × 390
phone viewport; with the production art the browser suite now records about 3 fps in the same software
renderer even at a 0.3 render scale (`docs/arena-results.json`). That says little about GPUs, but it is
why the suite renders small and allows slow clients more time.
Physical phones were **not** available to test; the 30 fps mobile target is unverified on hardware.

## Testing

| Suite | What it covers | Result |
|---|---|---|
| `tests/arena-sim.test.mjs` | Weapon classes differ; damage steps and multipliers; exact fire rate; semi/burst triggers; ammunition and reloads; shell reloads; switching; walk/sprint/crouch/ADS speeds, sliding and cooldown, jumping, walls, stairs; determinism and reconciliation equality; command quantisation and rejection; spread and recoil; ray casts; map symmetry and clear spawns; rules | 15 / 15 pass |
| `tests/arena-match.test.mjs` | Real WebSockets against the real room: two players matched on opposite teams and synchronised; server-decided hits, damage, kill feed, score and respawn; cheating attempts (damage/kill/score claims, a 600-command flood, replays, malformed commands); simultaneous eliminations; disconnect and reconnect (and a different account refused); score-limit end with one recorded result; independent matches; Domination capture, contest and scoring; scorestreak validation; interest management through walls; Training bots; forfeits; high latency, jitter and lost batches with reconciliation converging; a full 12-player match at the snapshot rate; fuzzing | 15 / 15 pass |
| `tests/arena-accounts.test.mjs` | Real PostgreSQL 17: catalogue mirrors the game; formulas equal; only the server records; concurrent duplicates count once; implausible statistics refused; loadouts validated, private, saved; emblems | 7 / 7 pass |
| `tests/arena-armory.test.mjs` | Exactly two free firearms; every other firearm premium, described and fully configured with its own model; premium weapons refused in loadout validation unless owned; store items and prices mirror the catalogue and migration; no premium weapon dominates a free one | 4 / 4 pass |
| `tests/arena-armory-accounts.test.mjs` | Real PostgreSQL 17 + room + arena + stand-in Bachs: premium weapons refused by the arena server and the database until bought, forged claims ignored, underpayment ignored, a signed payment grants once and reaches the open arena connection, equip and save, persistence on a new connection, purchase history, refund webhook and admin reversal, late payment events after a refund grant nothing; legacy grants; arena preferences private and size-limited | 4 / 4 pass |
| `tests/arena-hud.test.mjs` | Every brief element customisable; touch controls separate; presets valid and non-overlapping on 640×360 to 1024×600 phones; drag (clamped, grid, guides, fixed crosshair); resize limits and 40 px touch targets; visibility, opacity, alignment, global and crosshair options; save/restore/reset/undo/redo; orientation profiles; damaged, hostile, older and newer layouts repaired; the acceptance scenario | 9 / 9 pass |
| `tests/arena-autofire.test.mjs` | Off by default and persisted; fires only at a visible enemy under the player's own aim; never at teammates, through walls or out of range; stops for reload, switch, empty magazine, sprint, melee; same fire rate and ammunition as manual fire, never reloads; does not compensate recoil; stops on target loss; manual fire unaffected | 6 / 6 pass |
| `tests/arena-performance.test.mjs` | Adaptive rendering (resolution first, then profile; recovery; no oscillation); a match preloads only the free weapons' third-person models; the Armory and studio are separate chunks | 2 / 2 pass |
| `tests/browser-arena-hud.mjs` | Chromium, desktop and phone: the studio drags, resizes, restyles and hides elements and saves them (device and account); kept after a reload and on another device; a damaged layout is repaired; on a phone the joystick is moved and the fire button enlarged by touch, and the firing range shows them exactly there and fires; auto-fire against a Training bot fires only while aimed at it and stops when the aim leaves | 9 / 9 checks pass |
| `tests/browser-arena.mjs` | Two signed-in Chromium players open the arena from the campus, a premium weapon opens the Armory until owned, equip and save a loadout, are matched together, see each other, one eliminates the other twice through the server, Victory/Defeat, results and experience saved to the database, rankings, back to campus and walking; a phone (landscape, touch) plays Training: fire button fires, stick moves, controls on screen, no page scroll | 12 / 12 checks pass |
| `tests/arena-deploy.test.mjs` | Real WebSockets: a hanging or failing account service still answers `ready` within the deadline (guest + notice); a player joining a match in progress is held out of combat until its scene loads, then spawned at once, or at the cap if it never reports; warm-up and older clients unchanged; a reconnecting player is held until loaded again; correlation-id traces; client timing percentiles | 8 / 8 pass |
| `tests/fetcher.test.mjs` | The downloader against a real HTTP server: byte progress counted once; transient failures retried with backoff; missing files not retried; stalled responses aborted and retried; a request that never answers gives up; strict priority order; cancellation; decode deadline | 8 / 8 pass |
| `tests/browser-arena-audio.mjs` | Chromium, phone profile: own gunfire, reload and footsteps through the game; a 3 s, 12-shooter firefight with explosions never clips and stays within 20 voices; distance layering; occlusion agrees with an independent line-of-sight check; category volume; recovery from a suspended context | 9 / 9 checks pass (`docs/arena-audio-results.json`) |
| `tests/browser-arena-soak.mjs` | Five Training matches in one page, then leaving and re-entering the arena: heap, DOM, listeners, voices and deployment time per match | pass (`docs/performance/arena-soak.json`) |
| `scripts/qa/arena-deploy.mjs` | Deployment benchmark (normal, 4G, 3G, failed and stalled downloads, dropped connection, repeats) | `docs/performance/arena-deploy-{before,after}.json` |
| `scripts/qa/arena-sounds.mjs` | Every sound design rendered offline: peaks, spectra, distinctness, variants | `docs/performance/arena-sounds.json` |
| `scripts/qa/arena-heap.mjs` | Heap snapshots across matches and arena visits: growth by type and retaining paths of live WebGL contexts | no per-match growth (see the report) |
| `scripts/qa/arena-ui-shots.mjs` | Lobby, training, settings, deployment, HUD and results at five screen sizes; no horizontal scroll | `docs/screenshots/arena/premium/` |
| `npm test` (everything) | All campus suites plus the arena suites | 309 / 309 pass |

The fuzz test found a real defect during development (an oversized message raised an unhandled
socket error that would have stopped the server); it is fixed and covered.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ARENA_CAPACITY` | 400 | Arena connections per process (2–5000) |
| `ARENA_MAX_MATCHES` | 60 | Simultaneous matches per process (1–1000) |
| `ARENA_LOG_DIR` | unset | Directory for per-match combat logs; unset keeps them in memory |
| `VITE_ARENA_URL` | derived | Frontend build: arena WebSocket URL when not next to `VITE_WS_URL` |

Proxy `/arena` like `/ws` ([deployment](DEPLOYMENT.md)). Apply the migration with the others.

## Not built / follow-up

* Cross-process matchmaking queue (each process matches its own players).
* Ranked play with skill ratings; Free-for-all, Search and Destroy, Hardpoint (architecture ready).
* Kill cams, voice, parties queuing together, spectating.
* Physical-device performance verification on low-end Android phones.
* Art still to raise: Sim Quad's planters, benches and interior blocks are textured boxes rather than
  modelled props; the Wasp, Kestrel and Bastion magazines are fused to the gun (reloads move the hand
  but nothing drops); the Talon's third-person LOD stays at ~20k triangles (its source mesh does not
  simplify); bespoke animation clips for the first-person arms (reloads are procedural poses driven by
  the simulation, not keyframed animation).
* Phones on metered data: the Low profile now needs about 7 MB before play and about 14 MB in all (phone texture
  tier); a smaller first-person weapon tier for phones was not made (weapons stay full resolution by choice).
* Keeping one renderer across matches (a new match currently creates a new WebGL context, re-uploads textures and
  recompiles shaders: about 6–8 s per re-deployment under software rendering; not measured on a GPU).
* Weapon sounds are original synthesised designs, not recordings: no licensed recordings were available to this
  build. Suppressed fire is not designed because no weapon has a suppressor.
