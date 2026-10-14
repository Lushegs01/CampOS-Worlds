# CampOS Worlds

Mobile rendering improvements, benchmark results, and the itel S24 test checklist: [Mobile performance](docs/MOBILE-PERFORMANCE.md).

A playable, standalone 3D campus for exploring, meeting people and making small discoveries. The fictional **Òrìṣun Campus** is modelled locally with procedural architecture, vegetation, a walk-in library and a bronze courtyard landmark. No production institutional account is needed.

Players can find their friends and travel together, message privately, form parties, play rated one-versus-one **Court Duels**, run timed exploration and driving challenges, check in at club events inside the game, and build a profile with earned badges, titles and colours. These systems are server-validated and tested end to end; see [Social](docs/SOCIAL.md), [Competition](docs/COMPETITION.md), [Progression](docs/PROGRESSION.md), [Activities](docs/ACTIVITIES.md), [Analytics](docs/ANALYTICS.md) and the honest [implementation status](docs/IMPLEMENTATION-STATUS.md).

## Run locally

Requirements: Node.js **22.12+** (tested on 24.20.0), npm, and a browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173/**. This starts Vite on 5173 and the real-time room on 3001. Open the same URL in two independent browser windows/contexts to see live presence and chat. Each tab has a session-scoped identity. Use a new independent tab, not a browser's cloned session, if the room reports “session in use.”

```sh
npm run build       # TypeScript check and production bundle
npm test            # Shared collision and real WebSocket integration tests
npm run server      # Room server only
npm run dev:web     # Frontend only; works in local exploration mode
npm run dev:local   # Full stack WITH accounts, clubs and events, no Supabase project needed (http://127.0.0.1:5175)
npm run preview    # Preview the compiled frontend
```

`npm run preview` serves the static build; run the room server alongside it and configure its allowed origin for the preview URL. For production, follow [deployment](docs/DEPLOYMENT.md).

The lockfile is included. Rollup uses its official WASM distribution so the build also runs on Windows configurations that disallow its native `.node` binary. No machine security settings need changing.

## Play

Enter immediately, or select **Make it you** to choose a name, skin tone, outfit, hair and accessory. These change the rendered avatar and are saved on the device.

| Control | Action |
|---|---|
| WASD / arrow keys | Move relative to the camera |
| Drag the world with the mouse | Rotate camera |
| Shift | Sprint |
| Space | Jump; while holding a basketball, hold and release to shoot |
| E | The action on the prompt: sit / stand, open / close a door, pick up a ball, use a fixture, explore a landmark |
| V | Events, clubs and challenges (also the dock's **Events** button) |
| F | Friends, private messages, party and privacy (also the dock's **Friends** button) |
| Q | Drop the ball |
| M / C | Map / room chat |
| 1 / 2 / 3 | Wave / dance / cheer |
| Escape | Close an overlay or pause local movement |
| Touch | Left joystick, right drag area, Jump, the contextual action button, and Shoot / Drop while holding a ball |

At The Courts, the basketball panel offers free shooting and **Court Duel**: challenge a player on the court to a 60-second shootout, scored by the room's physics and rated for signed-in players ([rules](docs/COMPETITION.md)). Events → **Challenges** has the on-foot Courtyard Circuit and the Campus Loop drive. The People list lets you add friends, invite to a party, mute, block and report.

The Welcome Pavilion starts the five-stop tour. Visit The Confluence, Adunni Learning Commons, The Student House and Horizon Auditorium to earn the Campus Compass badge. Walk through the library entrance to explore the shelves. Six golden keepsakes form a second, independent scavenger hunt. Sit on any bench or chair, open the library, café and Studio D1 doors and use what is inside, and play basketball with real ball physics at The Courts. See [interactions](docs/INTERACTIONS.md). Collectibles and badges are **gameplay only**.

The campus also has a football field, cafeteria terrace, campus road, shuttle shelter, academic buildings, noticeboard and CampOS Connect service kiosk. The football field is scenery; basketball is the implemented sports activity. Library readings, club interest, events and service information are clearly labelled demonstrations.

## Configuration

Copy `.env.example` to `.env` if changing defaults. Keep server secrets out of `VITE_` variables.

| Variable | Used by | Default / purpose |
|---|---|---|
| `PORT` | Room | `3001` |
| `HOST` | Room | `127.0.0.1`; use `0.0.0.0` in a container |
| `ALLOWED_ORIGINS` | Room | Comma-separated exact frontend origins; defaults to localhost and 127.0.0.1 on 5173 |
| `ROOM_CAPACITY` | Room | `24`; configurable 2–48; a limit, **not a tested capacity claim** |
| `ROOM_INVITE` | Room | Optional private demo invitation; enter it in Settings and reconnect |
| `ADMIN_TOKEN` | Room | Optional long random token enabling moderator removal |
| `ROOM_ID` | Room | `courtyard`; names this room instance (parties and presence are scoped to it) |
| `ANALYTICS_ENABLED`, `ANALYTICS_SALT` | Room | Off by default. `1` plus a secret salt (16+ characters) records opt-in gameplay statistics ([analytics](docs/ANALYTICS.md)) |
| `ANALYTICS_DIR`, `ANALYTICS_RETENTION_DAYS` | Room | `server/data/analytics`, `90` |
| `VITE_WS_URL` | Frontend build | Optional full `wss://host/ws`; otherwise same-origin `/ws` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Frontend build | Optional; public values that enable accounts, clubs and events ([setup](docs/ACCOUNTS.md)) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Room | Optional; the room verifies signed-in players and records verified badges. The service key is a **server secret** |
| `SUPABASE_ANON_KEY` | Room | Optional; public key used for token checks |

Brand, campus name, locations, collectibles and collision geometry are in `shared/campus.mjs`. Visual colours and interface typography are in `src/styles.css`. The original logo and avatar are procedural. Fonts are bundled with Fontsource, with system fallbacks.

## Architecture

```text
shared/             Campus configuration and client/server collision functions; achievements,
                    challenges, profile choices and text cleaning shared by client and server
supabase/           PostgreSQL migrations: profiles, verified progress, clubs, events, RLS
src/services/       Typed account/community service boundary (Supabase behind it)
src/account/        Session, profile and multiplayer identity state (outside the 3D scene)
src/community/      Events and clubs drawer state, event templates, check-in and reminders
src/social/         Friends, private messages, parties, presence and places
src/duel/           Court Duel client state (the room runs the match)
src/challenges/     Challenge runs mirrored from the room
src/analytics/      Opt-in statistics consent
src/world/          Architecture, materials, vegetation, batching and lighting
src/game/           Movement, camera, interactions and basketball
src/avatar/         Replaceable animated procedural avatar
src/network/        WebSocket connection lifecycle and typed UI state bridge
src/ui/             HUD, overlays, map, profile, settings, social and touch controls
src/config/         Service adapter boundary
src/state.ts        Persisted demo preferences/progress; transient play state
server/             Authoritative bounded room server and moderation endpoints;
                    parties.mjs, duels.mjs, challenges.mjs and analytics.mjs are its subsystems
tests/              Collision, protocol and browser workflows
docs/               Core integration, deployment, validation and screenshots
```

Vite + React + TypeScript + React Three Fiber + Three.js + Zustand. No server rendering is needed for the game; the interface is separate from the WebGL scene. Static meshes merge by material, repeated vegetation uses instancing, and avatars interpolate remote updates. Characters (Microsoft Rocketbox, MIT) and textures and props (Poly Haven, CC0) are converted and served locally; see [asset provenance](docs/ASSETS.md). The full campus is compact, rather than streamed in chunks. The scene module loads asynchronously with a loading state.

The server simulates movement at 30 Hz and broadcasts at 15 Hz. Clients send direction/jump inputs, never accepted absolute positions. Shared AABB collision sweeps stop tunnelling; the camera shortens its follow arm against building bounds. Important location/collectible requests require server-side proximity. Both sides integrate real elapsed time in short substeps. A standing client that drifts 0.9–2 m from the room glides back to it; beyond two metres it snaps. There is no rewind/replay reconciliation.

## Multiplayer and moderation

This is one in-memory campus room. It contains actual connected clients, not NPCs masquerading as players. The server limits payloads, normalizes input, validates cosmetics, enforces chat/emote/report budgets, checks origin/invitation, disconnects stale peers, and supports reconnects.

Room chat and party chat are separate, labelled channels; private messages are a third, persistent channel in the Friends drawer and never appear in the chat panel. Account-level blocks are enforced by the room for chat and invitations in both directions. Guests cannot take staff-like names or fake the ✓ that marks signed-in players, and hidden direction-override characters are stripped from names and messages. Parties (up to 6, invite-only, 45-second reconnect grace) and meet-up travel live in the room's memory ([details](docs/SOCIAL.md)).

Use the People panel to mute chat or report a player. Reports append to `server/data/reports.jsonl`; they are never sent to other players. Operators should restrict access and choose a retention policy. The server doesn't retain chat history or receive official student records. Reports are a moderation hook, not a staffed moderation service.

With `ADMIN_TOKEN` set, an operator can POST a JSON `{"id":"<current-player-id>"}` to `/admin/kick` with `Authorization: Bearer <ADMIN_TOKEN>`. The current room session token is denied until server restart. Guest identities are not institutional identities: a determined guest can create a fresh browser session. Production removal needs authenticated accounts, durable bans, institution-scoped rooms, and operational moderation.

Optional accounts ([docs/ACCOUNTS.md](docs/ACCOUNTS.md)) give players a persistent handle, profile and badges. The room verifies each signed-in player's Supabase token itself, takes names and appearance from the saved profile, and records badges only for actions it has validated. Guest gameplay progress is localStorage data. It is intentionally editable by the player and never establishes academic credit, attendance, finance status or clearance. In guest mode the Student Centre club interests are session-only; with accounts configured, clubs, events and RSVPs are stored in Supabase. No passwords, SSO secrets, or student records are placed into the scene.

## Validation and remaining work

See [validation](docs/VALIDATION.md) for measured results and [actual screenshots](docs/screenshots). Browser automation scripts use Playwright and a development-only read-only inspection hook; they walk using real keyboard events.

```sh
npx playwright install chromium
node tests/browser-verify.mjs
node tests/browser-accounts.mjs          # accounts and profiles, against a local stack
node tests/browser-community.mjs         # clubs and events, against a local stack
node tests/browser-social-accounts.mjs   # friends, private messages, parties, blocking (two browsers)
node tests/browser-duel.mjs              # Court Duel, rated result and rankings (two browsers)
node tests/browser-activities.mjs        # check-in, challenges, titles, friends-only profiles, phone
```

The last three run on machines without a GPU (software WebGL) by rendering the 3D view at low resolution through a QA-only `?qa-scale=` option; the interface is unchanged.

`npm test` also runs the account and community database tests against an embedded PostgreSQL 17 (initialised in your temp folder on first run, about 40 seconds). You can use an already installed Chromium browser with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. On PowerShell:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/browser-verify.mjs
```

Voice chat, tournament brackets, team basketball, personal rooms, multi-room presence and parties, and a moderator dashboard are designed but not built ([status](docs/IMPLEMENTATION-STATUS.md)). Production Core (institutional) authentication, tenant feature settings, migrating guest progress into an account, account-backed moderation and durable bans, multi-room scaling, licensed realistic character assets, full accessible building interiors, advanced terrain physics, audio ambience, and physical mid-range phone profiling are follow-up work. The current art is bespoke procedural game art, not a photorealistic scan of a real university. The library, café and Studio D1 are enterable; other blocks are not. High quality adds screen-space AO and SMAA; there is no WebGPU dependency.
