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

| Weapon | Class | Unlock | Fire | RPM | Magazine | Damage (near → far) | Head | Reload (s) | Move |
|---|---|---|---|---|---|---|---|---|---|
| Vanguard AR-7 | Assault rifle | 1 | auto | 740 | 30 | 28 @0m → 23 @24m → 19 @45m | ×1.45 | 2.1 | 0.97 |
| Halcyon BR-3 | Assault rifle | 6 | burst (3) | 340 | 24 | 34 @0m → 29 @30m → 24 @55m | ×1.4 | 2.2 | 0.96 |
| Wasp SMG-9 | SMG | 1 | auto | 930 | 32 | 26 @0m → 19 @11m → 14 @22m | ×1.3 | 1.8 | 1.04 |
| Kestrel K-45 | SMG | 4 | auto | 690 | 25 | 34 @0m → 24 @12m → 17 @24m | ×1.3 | 1.9 | 1.03 |
| Bastion 12G | Shotgun | 1 | semi | 72 | 6 | 22×8 @0m → 13×8 @7m → 6×8 @13m | ×1.2 | 0.6 per shell | 0.97 |
| Rampart Auto | Shotgun | 8 | semi | 210 | 8 | 16×7 @0m → 10×7 @6m → 5×7 @11m | ×1.2 | 2.4 | 0.96 |
| Longbow SR | Sniper rifle | 1 | bolt | 46 | 5 | 110 @0m → 98 @60m | ×2 | 2.9 | 0.9 |
| Talon DMR | Sniper rifle | 10 | semi | 270 | 12 | 49 @0m → 44 @40m → 40 @70m | ×1.8 | 2.4 | 0.93 |
| Anvil LMG | LMG | 1 | auto | 640 | 75 | 30 @0m → 26 @30m → 22 @55m | ×1.35 | 4.6 | 0.86 |
| Sparrow P9 | Pistol | 1 | semi | 420 | 12 | 28 @0m → 21 @12m → 16 @25m | ×1.4 | 1.4 | 1.05 |
| Thorn .44 | Pistol | 5 | semi | 150 | 6 | 58 @0m → 46 @15m → 36 @30m | ×1.5 | 2.3 | 1.03 |
| Combat Knife | Melee | 1 | melee | — | — | one hit within 2.3 m | — | — | 1.08 |
| Breach Hammer | Melee | 7 | melee | — | — | one hit within 2.9 m | — | — | 1.02 |

Every gun also has a quick melee (two hits). Adding a weapon is a catalogue entry in
`shared/arena/weapons.mjs` plus its row in the migration's catalogue insert; nothing else changes.

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

Settings: mouse, aiming, touch and gamepad sensitivity, invert vertical look, field of view, sprint by
stick, graphics quality, frame rate readout, volume and mute (the game's master volume).

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
Everything is earned; nothing is sold.

## Performance

* The arena is a separate chunk and loads nothing for campus-only players. While it is open the campus
  stops rendering.
* A map is about a dozen draw calls (boxes merged per material, world-space UVs, 128 px procedural
  textures). Players are a fixed pool of 12 low-poly mannequins; tracers, impacts, flashes,
  explosions, smoke and grenades come from preallocated pools (nothing allocated per shot). The
  first-person weapon is drawn in a second pass over a cleared depth buffer.
* Graphics **Low / Medium / High** (Settings), defaulting from the device like the campus (touch or
  ≤ 4 GB / ≤ 4 cores → Low): Low uses 1× resolution, no antialiasing, no textures, simple lighting and
  half the effects; High adds real-time shadows and up to 2× resolution.

Measured (`docs/performance/arena-load.json`, `node scripts/qa/arena-load.mjs`): one room process with
4 full 6 v 6 Quick Play matches (48 WebSocket clients each sending 60 commands/s while moving and
firing) plus 4 Training matches (36 bots) for 20 s — **31% of the server's main thread**, event-loop
delay p99 9.4 ms, every client received 20.0 snapshots/s (minimum 20.1), ~17 KB/s download per client,
3,908 shots resolved with lag compensation.

Client frame rate was measured only with software rendering (SwiftShader, no GPU) in this
environment: **44 fps** on Low at a 844 × 390 phone viewport during Training
(`docs/arena-results.json`). Physical low-end Android phones were **not** available to test; the 30 fps
mobile target is not yet verified on real hardware.

## Testing

| Suite | What it covers | Result |
|---|---|---|
| `tests/arena-sim.test.mjs` | Weapon classes differ; damage steps and multipliers; exact fire rate; semi/burst triggers; ammunition and reloads; shell reloads; switching; walk/sprint/crouch/ADS speeds, sliding and cooldown, jumping, walls, stairs; determinism and reconciliation equality; command quantisation and rejection; spread and recoil; ray casts; map symmetry and clear spawns; rules | 15 / 15 pass |
| `tests/arena-match.test.mjs` | Real WebSockets against the real room: two players matched on opposite teams and synchronised; server-decided hits, damage, kill feed, score and respawn; cheating attempts (damage/kill/score claims, a 600-command flood, replays, malformed commands); simultaneous eliminations; disconnect and reconnect (and a different account refused); score-limit end with one recorded result; independent matches; Domination capture, contest and scoring; scorestreak validation; interest management through walls; Training bots; forfeits; high latency, jitter and lost batches with reconciliation converging; a full 12-player match at the snapshot rate; fuzzing | 15 / 15 pass |
| `tests/arena-accounts.test.mjs` | Real PostgreSQL 17: catalogue mirrors the game; formulas equal; only the server records; concurrent duplicates count once; implausible statistics refused; loadouts validated, private, saved; emblems | 7 / 7 pass |
| `tests/browser-arena.mjs` | Two signed-in Chromium players open the arena from the campus, equip and save a loadout, are matched together, see each other, one eliminates the other twice through the server, Victory/Defeat, results and experience saved to the database, rankings, back to campus and walking; a phone (landscape, touch) plays Training: fire button fires, stick moves, controls on screen, no page scroll | 11 / 11 checks pass |
| `npm test` (everything) | All campus suites plus the arena suites | 268 / 268 pass |

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
* Recorded (rather than synthesised) sound and skinned, animated character models in matches; the
  simulation mannequins are deliberate (exact hitboxes, cheap on phones) but plain.
* Physical-device performance verification on low-end Android phones.
