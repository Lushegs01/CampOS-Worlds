# Campus characters (NPCs)

Òrìṣun Campus has ten scripted campus characters: eight staff roles in the buildings players already use, and two ambient roles outdoors. Each has a stable identity, a role-specific appearance, a working routine in its own building, and a conversation that connects to the feature it belongs to (the café's demo ordering, the library catalogue, the events board, map markers, Court Duel, rooms, the Economic Simulation Lab). A character appears only once its building is complete enough, by an explicit configured percentage.

Characters are **not players**. They hold no connection or account and never appear in the People list, the online count, friends, parties, private messages, rankings or progression. Their name tags show a name and a role, never a handle or the signed-in ✓. All dialogue is deterministic and local: no AI service is used, and no character conducts real university business or touches any record.

## What is implemented

| Character | Role | Where | Building (default completion) | On duty from | Conversation |
|---|---|---|---|---|---|
| `teacher` · Ms Ifeoma Okafor | Teacher | Studio D1, at the whiteboard and teacher's desk | `studio-d1` (85 %) | **80 %** | What the studio is for, today's design brief (the whiteboard's own content), running a shared class session, where to learn more (map markers) |
| `vendor` · Tolu | Café vendor | Behind the Courtyard Café counter | `courtyard-cafe` (60 %) | **40 %** | Order (the café's existing demo order form, served by her), the menu, where to sit |
| `librarian` · Mrs Hauwa Musa | Librarian | Behind the issue desk, Adunni Learning Commons | `adunni-library` (75 %) | 60 % | Find a book or subject (the existing catalogue search, labelled fictional), how the catalogue computers work, New Arrivals, finding your way, facilities |
| `services-officer` · Mr Chinedu Eze | Student services officer | Beside the CampOS Connect kiosk | `campos-connect` (100 %) | 50 % | What CampOS Connect does (the existing service panels), directions to every campus place, who is on duty today (from the configuration), what he is not |
| `event-host` · Kemi | Campus event host | Horizon Auditorium forecourt | `horizon-auditorium` (90 %) | 70 % | What's on (real events from the community service, or a truthful empty / not-set-up state), how to find events and check in, the auditorium's mini lecture |
| `coach` · Coach Dayo | Basketball coach | Courtside by the ball rack, The Courts | `the-courts` (100 %) | 50 % | Shooting, the round of five, Court Duel (the existing challenge panel), court rules. Cheers every basket |
| `residence-assistant` · Amaka | Residence assistant | Palm House common room, near the residents' door | `palm-house` (80 %) | 60 % | How personal rooms work, who can come in, visiting a friend; a marker to the residents' door |
| `research-assistant` · Tobi | Economic research assistant | Economic Simulation Lab | `economic-lab` (100 %) | 80 % | What the lab is, the six stations (markers to each), how an experiment runs, what he cannot change |
| `orientation-guide` · Zara | Orientation guide (ambient) | Welcome Pavilion | `welcome-pavilion` (100 %) | 30 % | Start the five-stop tour, the keepsake trail, controls, directions |
| `groundskeeper` · Mr Femi | Groundskeeper (ambient) | Flower beds by the Welcome Pavilion | `campus-grounds` (100 %) | 20 % | The trees on campus (counted from the campus data), shady spots, the flower beds |

Genuinely working: the prompts, conversations, every link into an existing feature listed above, the vendor serving demo orders numbered by the room, routines, greetings, gaze, the coach's cheer, availability by building completion, and server authority for all of it. Informational only: the teachers', librarians', officers', hosts', assistants', guides' and groundskeeper's answers are fixed text. The catalogue and its holds are fictional, the services panels explain modules that are not connected, and café orders are demonstrations with nothing charged.

Not every place had a role worth adding. A campus security guide, a shuttle attendant and student characters were considered and left out: the shuttle and cars already explain themselves through their prompts, and seated "students" would take seats players use.

## Architecture

| Layer | File | Role |
|---|---|---|
| Building availability | `shared/buildings.mjs` | Versioned configuration (`BUILDING_CONFIG_VERSION`): each staffed building's id, name, place, completion (0–100 %), availability and floor region. Validation, operator overrides, the live state. |
| Characters | `shared/npcs.mjs` | The cast as data, validation (including a flood-fill proof that each home is reachable on foot), eligibility, the deterministic pose function, line-of-sight talk checks, and the **director**: the one authority for who is on duty, conversations, greetings, reactions and demo orders. |
| Café | `shared/cafe.mjs` | The menu and order validation, shared by the counter, the vendor and the room. |
| Room | `server/npcs.mjs`, `server/room.mjs` | One director for everyone. Handles `npc` and `cafeOrder` messages, sends changes as small deltas, calls an order's number, releases conversations on disconnect, and exposes `/admin/buildings`. |
| Client state | `src/npc/client.ts` | Mirrors the room (or runs the director itself offline), registers prompts with the interaction controller, starts and ends conversations, places orders, QA hooks. |
| Scene | `src/npc/Npcs.tsx`, `src/npc/props.ts` | Draws each character with the players' own avatar component, rigs and clips; name tags; gaze; gestures; hand props. |
| Dialogue | `src/npc/Dialogue.tsx` | Topics as data, and the widgets that reuse existing features. Loaded on first use. |

Nothing here added a second movement system, building, prompt framework or order system: characters use the shared collision data, the existing contextual prompt (`registerCandidates`), the existing panels, and the existing café order form, which now numbers orders in the room.

## Building completion and the lifecycle

A character is on duty only when **all** of these hold (`eligibility()` in `shared/npcs.mjs`):

1. its building exists in the configuration and is available;
2. the building's completion is **at least** the character's threshold (the teacher is on duty at exactly 80 %, not at 79.99 %);
3. its definition is valid;
4. its home and routine pass validation: inside the building, clear of walls, fixtures and doorways, keeping clear of seats, door swings, the ball rack and the residents' doorway, and reachable on foot from the building's entrance;
5. its working hours, if it has any, include the current campus time (West Africa Time). None of the ten has hours today; the field exists and is tested.

The director keeps **one instance per id**. Crossing a threshold back and forth arrives and leaves the same character; it never creates a second one (`spawns` counts arrivals). When a character leaves duty its conversations end, the dialogue closes with the reason ("Studio D1 is 60% complete. The teacher starts work at 80%."), its prompt disappears and its model is unmounted and released.

### Default completion and how to change it

The defaults in `shared/buildings.mjs` put every character on duty, so the teacher (Studio D1 at 85 % ≥ 80 %) and the vendor (café at 60 % ≥ 40 %) can be seen immediately. There is no construction gameplay: a percentage changes only by configuration or an operator.

- **Permanently:** edit `completion` in `shared/buildings.mjs` (and bump `BUILDING_CONFIG_VERSION` if a building's meaning changes).
- **Per room, at start-up:** `BUILDING_COMPLETION=studio-d1=70,courtyard-cafe=35` in the room's environment. Unknown buildings and values outside 0–100 stop the room from starting, with a message naming the problem.
- **On a live room:** `ADMIN_TOKEN=… node scripts/ops/admin.mjs https://room.example buildings` lists completion and who is on duty; `… building studio-d1 80` sets a percentage; `… building courtyard-cafe closed` / `open` changes availability. These call `GET`/`POST /admin/buildings` with the admin token. A live change applies to everyone at once and lasts until the room restarts.

Offline (no room), the same defaults apply; QA builds can change them with `window.__campusNpcs.setBuilding(id, percent)`.

## Behaviour

Each character follows a **routine**: a loop of waits at its home and at a few waypoints in its building, with an activity at each (`idle`, `hold` a prop, `reach` towards the board or a shelf, `tend` a flower bed, `look` around). Every walk starts or ends at home, so the way home from anywhere on a routine is a straight line that validation has already checked. Walks ease in and out to at most 1.1 m/s.

Where a character is, is a pure function of its definition, the room's clock and its shared state (`npcPose()`): every browser computes the same position from the same inputs, and the room only has to tell clients when the state changes. Nothing is random: the start of each routine is offset by a hash of the character's id, not a random number.

States: `inactive` (off duty), `idle`, `working`, `walking`, `greeting` (a wave), `interacting` and `returning`.

- **Greeting.** When a player comes within 4.2 m in plain sight, the room has the character wave at them: at most once per character every 20 s, and once per player every 90 s. Never through a wall.
- **Conversation.** The character stops where it is and turns to the first player talking to it. Up to four players can be talking to one character; the others are told it is helping someone first, and can still ask. A conversation ends when its dialogue closes, its player walks more than 6 m away, disconnects or enters their room, or after five minutes. The character then walks straight back to its home and resumes its routine there.
- **Gaze.** A character standing still turns its head (neck and head twist, up to about 63°) towards the nearest person within 3.5 m in front of it and in sight. While walking it looks where it is going.
- **Reactions.** The coach cheers every basket the room scores. The vendor presents each order she serves (holding it) and waves when its number is called.

Characters are not obstacles for players (players are not obstacles for each other either), and they never pursue anyone.

## Appearance and animation

Characters reuse the players' Rocketbox characters, skin-tone shader, accessories and clip library (`src/avatar`): no new models or downloads. Roles are told apart by outfit (a tailored suit for the services officer, a football kit for the coach, hijab and abaya for the librarian), accent colour, accessory (caps for the vendor, coach and groundskeeper, glasses for the teacher, librarian and research assistant, headphones for the event host) and a hand prop.

| Behaviour | Clip or technique |
|---|---|
| Standing, looking around | `idle`, `look` (captured) |
| Walking | `walk`, blended by speed on the shared gait cycle |
| Greeting | `wave` (captured) |
| Cheering | `cheer` (captured) |
| Holding a tablet, clipboard, book or an order | `holdFront` arm layer (a captured documents-holding pose); the prop is a few shared boxes placed between the hands |
| Reaching to the board, a shelf, the till | `doorPush` (a captured forward reach), as a gesture |
| Tending a flower bed | `crouch` (captured), as a gesture |
| Looking at someone | procedural neck and head twist (`gaze` in `AvatarMotion`) |

No character performs an action its rig cannot: there is no writing, pouring or handing over a real object, so these are suggested with holding and reaching poses. Gestures, gaze and props stop while walking.

## Interactions and authority

- **Prompts.** Within its talk range (2.6 m; 2.8–3.4 m across desks and the café counter) and in plain sight, a character offers its role prompt (**Talk to teacher**, **Ask librarian**, **Ask about services**, **Ask about campus events**, **Talk to coach**, **Ask about student rooms**, **Ask about the Economic Simulation Lab**, …) through the same single contextual prompt as seats and doors, ranked the same way. On touch screens it is the same Interact button. Prompts are not offered while holding a ball, seated, airborne or inside your room.
- **The café counter.** Its familiar **Order at the counter** prompt is unchanged. While the vendor is on duty she answers it: her conversation opens at the order form. Below 40 %, or if she cannot talk, the counter's own form opens as before. Both place orders through the same room request.
- **Dialogue.** A panel like every other: movement pauses while it is open and resumes when it closes (by **Close**, **Escape**, or another panel); closing it ends the conversation. Topics that guide you somewhere set the gold map marker and close the panel.
- **Room authority.** Online, `{ type: 'npc', action: 'talk' | 'leave', id }` and `{ type: 'cafeOrder', items, req, via }` are decided by the room. It refuses unknown ids and actions, characters off duty (with the reason), players out of range (talk range + 0.6 m) or out of sight, and players who are seated, holding a ball, driving or in their room. Requests are rate-limited (8 per 2 s for conversations, 4 orders per 10 s).
- **Idempotency.** Asking again in a conversation you are already in changes nothing. Each order attempt carries the client's own id; the same attempt sent again (after a timeout, or after reconnecting with the same session) returns the same order instead of a second one. A failed order is shown as failed; "is being prepared" appears only for an order the room (or, offline, the local rules) actually numbered.
- **Replication.** The room sends the whole cast in `welcome`, a full `npcs` snapshot when a building changes, and otherwise `npcState` deltas for the characters that changed (a conversation, a gesture). There is no per-frame or position traffic. Cosmetic timing (gaze, easing the turn, the props) is computed by each client.
- **Restarts.** A restarted room starts every routine again at home; reconnecting clients take the room's snapshot. Characters never depend on any one player's browser.

## Performance

- **Lazy loading.** A character's model is loaded and its rig built only once you come within 45 m (Low), 70 m (Medium) or 100 m (High), and released beyond 1.4 times that. Nothing is drawn or loaded on the welcome screen.
- **Reuse.** Characters use the same cached character files, clip libraries and materials as players. Of the ten characters, the groundskeeper uses the default player model, the orientation guide and the officer are male so the spawn area needs no second clip library for the default player, and the props share ten geometries and eight materials across all characters.
- **Per frame.** Pose arithmetic and, four times a second, a nearest-person check for gaze. No React state changes per frame; the cast list re-renders only when a character comes or goes. The avatar's own level of detail applies: off screen a character is neither posed nor drawn, beyond 30 m it is posed every 2nd frame and beyond 60 m every 4th.
- **Network.** About 1.8 KB per player when joining; afterwards small deltas only when something changes (a greeting at most every 20 s per character).

Measurements: see [Measured effect](#measured-effect) under Validation.

## Adding a character

1. Add a building to `CAMPUS_BUILDINGS` in `shared/buildings.mjs` if it needs a new one (id, name, a real place id, completion, availability, floor region), and an entry point in `ENTRIES` in `shared/npcs.mjs` for the reachability check.
2. Add a definition to `NPCS` in `shared/npcs.mjs`: `id`, `name`, `role`, `title`, `building`, `threshold`, `description`, `greeting`, `appearance` (any model, skin, accent and accessory from `shared/campus.mjs`), optional `prop`, `home` and `waypoints` (with facing), a `routine` that starts at home and only walks to or from home, and `talk` (`label`, optional `range` and `priority`). Optional: `hours`, `reacts`, `serves` (a fixture whose prompt it answers).
3. Run `node --test tests/npcs.test.mjs`. Validation explains anything wrong ("the walk home → desk crosses a wall, fixture, doorway or the building edge", "stop board is too close to seat class-0-l", …); an invalid character simply stays off duty.
4. Optionally add topics for it in `TOPICS` in `src/npc/Dialogue.tsx`. Without topics it still greets you, and the scene, prompts, room and tests need no changes.

## Tests

| Command | Covers |
|---|---|
| `node --test tests/npcs.test.mjs` | Unique ids, real buildings and places, valid percentages and thresholds, override parsing, deep validation (reachability), invalid definitions kept off duty, determinism; the teacher at exactly 80 % and the vendor at exactly 40 % (and not below), one instance across repeated crossings, every character's own threshold and closed buildings, working hours; routines inside their buildings, clear of colliders, at walking pace, without jumps, clear of seats, door swings and the ball rack, safe walks home from anywhere; talk range and line of sight (across a counter, not through walls or closed doors), busy players, repeated requests, idempotent and validated orders, the counter without the vendor, conversations ending, greetings, the coach's cheer |
| `node --test tests/npcs-room.test.mjs` | Two real clients: the same cast and routines for both, characters absent from the roster, the online count and connections; authoritative conversations seen by the other client; unknown, malformed, distant, out-of-sight and busy requests refused; rate limits; orders numbered once across retries and a reconnect, called when ready, refused out of reach; start-up overrides, admin changes (auth, validation), five crossings of 80 % with one teacher; reconnecting and a room restart without duplicates |
| `node tests/browser-npcs.mjs` (needs `npm run dev`, or `TEST_URL` for a QA pair; `ONLY=offline,roles,phone,online`) | Real browsers, desktop and a 390 × 844 touch phone, offline and online: every character's conversation; the teacher at 79 % and 80 % six times over with GPU memory read after each; the vendor at 39 % and 40 % and the counter without her; café, classroom, library and lab fixtures beside the characters; no prompt while holding a ball; graphics quality switched mid-session; no sideways scrolling on a phone; two browsers seeing the same cast and conversations, and only each other in the People list. Results and screenshots: `docs/screenshots/npcs/`. |

## Validation

Measured in a Linux cloud container (4 CPU cores, no GPU; Chromium renders WebGL with SwiftShader), 25 October 2026.

- **Baseline before this change:** `npm run build` passed; `npm test` 206 / 206 passed.
- **After:** `npm run typecheck` clean; `npm run build` passed; `npm test` **231 / 231 passed** (the 206 existing tests, 20 in `tests/npcs.test.mjs`, 5 in `tests/npcs-room.test.mjs`; the fuzz test now also sends malformed `npc` and `cafeOrder` messages). One earlier full run had three dorm-account tests fail because the embedded PostgreSQL did not start; the file passed alone and the whole suite passed on the next run.
- **Real browsers** (`tests/browser-npcs.mjs` against the production QA bundle, `VITE_QA=1 vite build` served by `vite preview`, with its own room): **19 / 19 checks passed**, no page errors or unhandled rejections (`docs/screenshots/npcs/results.json`). GPU resources read after each of six teacher arrivals were identical every time (227 geometries, 122 textures, 42 shader programs): nothing accumulates. An earlier run against the development server passed the 14 checks it had then. Two intermediate failures were races in the test itself (a key press after a character had walked on, so it reached the next prompt, correctly) and were fixed in the test.

Regression runs of the existing browser suites and the performance comparison follow below once complete.

### Measured effect

Pending: the same benchmark with the characters left out (`?qa-npcs=0`) and in.

## Limitations

- Characters are not physical obstacles and do not avoid players while walking; players can walk through them, as through each other.
- Hands are not IK-placed. Props sit between the hands of a captured documents-holding pose; reaching and tending are captured door-push and crouch motions standing in for the real actions.
- Remote players' gaze targets are approximate: each browser picks the nearest person it sees.
- Routines are fixed loops, not schedules over a day; working hours are supported but unused.
- An admin change to completion lasts until the room restarts; configuration makes it permanent.
- Dialogue is fixed English text.
- Vehicles are not stopped by characters. Outdoor characters stand off the roads, but a car driven across a lawn or a plaza (which the open world allows) passes through them.
- No physical phone has been tested; see the measurement caveats.
