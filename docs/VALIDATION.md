# Validation

Four rounds are recorded here, newest first. The `*-results.json` files in this folder are rewritten
by every run, so each holds that suite's **latest** run, with its date inside.

## 15 October 2026: your room in Palm House

Same machine and method as the round below: a Linux container with 4 CPU cores and **no GPU**, and
Chromium rendering WebGL in software (SwiftShader) at about 2–3 FPS, against `npm run dev`. **No
physical phone**: the phone checks use a 390 × 844 touch viewport. The feature is described in
[DORM-ROOMS.md](DORM-ROOMS.md).

| Command | Result |
|---|---|
| `npm test` | **135 / 135**. New: `dorm` (4), `dorm-room` (3), `dorm-accounts` (3, PostgreSQL through the local Supabase stand-in); `fuzz` now also sends malformed room messages and layouts |
| `npx tsc -b`, `npm run build` | Pass. `index` chunk 613.5 kB (203.3 kB gzip), up 13 kB (4.8 kB gzip) for the editor and room client; the 3D parts are in the scene chunk |
| `node tests/browser-dorm.mjs` (new) | **7 / 7**: walk from the gate to the door, enter, privacy between two players, arrange and save, furniture collision agreeing with the room, leave, resume on a phone |
| `node tests/browser-reliability.mjs` | **8 / 8** |
| `node tests/browser-mobile.mjs` | **12 / 12** |
| `node tests/browser-verify.mjs` | **17 / 17** after the test fix below (the first run failed on that race) |
| `node tests/browser-interactions.mjs` | **27 / 27** at about 2 FPS after the test fix below (the first run failed on that timing) |

Found while building it, and fixed:

- **A peer kept a stale `space` after leaving their room.** The client merges each update into the
  stored player with `Object.assign`, which never removes a field the room leaves out, so other players
  went on treating them as being in their room. The client now clears it (`browser-dorm` step 6).
- **The first window wasn't told it had left its room.** When the same account opened in a second
  window, the first was moved out of its room without being told (`dorm-accounts`).
- **Two existing browser steps were timing-dependent at 2 FPS.** These are test changes; no assertion
  changed:
  - `browser-verify` looked up a resting ball twice, so the ball could respawn between the two reads.
    It now uses one read.
  - `browser-interactions` timed its weak shot with a key-up sent from the test process, which can
    land half a second late. It now releases in the page, like its free throws.

## 14–15 October 2026: reliability, multiplayer consistency and performance

Measured in a Linux cloud container (4 CPU cores, **no GPU**) with Node 22.22 and Playwright 1.58.2's
Chromium 1194, which renders WebGL with SwiftShader (on the CPU) at about 2–5 FPS with the QA render
scale. Browser suites ran against a frozen snapshot of the working tree (Vite on 5174, room on 3101)
so edits could not hot-reload a running test; the account-backed suites start their own stack.
**No physical phone was available**: every phone figure is emulation. Performance comparisons are in
[MOBILE-PERFORMANCE.md](MOBILE-PERFORMANCE.md).

| Command | Before this round (this container) | After |
|---|---|---|
| `npm test` | 98 / 98 | **125 / 125** (adds `fuzz`, `reconnect`, `movement`, `interpolation`, `resolution` and new `world` / `ball` cases) |
| `npm run build` | Passes | Passes; `index` chunk 600.6 kB (198.5 kB gzip), was 593.1 kB (195.6 kB). Secret scan of the bundle: clean |
| `node tests/browser-smoke.mjs` | Fails (clicked a `bun` accessory that does not exist; asserted nothing) | **Passes** (real controls, appearance, walking, settings, phone layout) |
| `node tests/browser-verify.mjs` | Fails at the jump step, then walks overshoot (fixed sleeps at 4–5 FPS) | **17 / 17** (dev stack, and again on the final QA production build) |
| `node tests/browser-reliability.mjs` (new) | — | **8 / 8** (the 8th, texture preloading, added after this round merged) |
| `node tests/browser-mobile.mjs` | Could not start (hard-coded Windows Chrome) | **12 / 12** |
| `node tests/browser-interactions.mjs` | Could not start; then walk drift and slow-motion sit-down | **27 / 27** at about 2 FPS (5 / 5 free throws) |
| `node tests/browser-social.mjs` | Timed out entering under load | **4 / 4** |
| `node tests/browser-open-world.mjs` | Could not start (`/usr/bin/chromium`); then walk drift | **11 / 11** |
| `node tests/browser-accounts.mjs` | — | **9 / 9** |
| `node tests/browser-community.mjs` | — | **11 / 11** |
| `node tests/browser-social-accounts.mjs` | — | **13 / 13** |
| `node tests/browser-duel.mjs` | — | **6 / 6** |
| `node tests/browser-activities.mjs` | — | **7 / 7** |
| `node tests/browser-mobile-performance.mjs` (solo, `PERF_BOTS=8`) | Measured | Measured: see [MOBILE-PERFORMANCE.md](MOBILE-PERFORMANCE.md) |
| `node tests/browser-soak.mjs` (new, 5 min, 42 visitors) | +69 GPU textures over the last 3 minutes | **+3** |

"Before" for the account-backed suites was not re-run on the original commit here; they passed in the
previous round (below). Every failure listed above was reproduced on this machine before it was fixed.

### Defects found and fixed

| # | Severity | Defect (observed) | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| 1 | Critical | One message such as `{"type":"sit","seat":{"toString":1}}` crashed the room process for every player | The room called `String()`/`Number()` on client values; an object with a non-callable `toString` throws, and a throw inside the WebSocket handler is uncaught | Client values are read with type-checked helpers (`str`, `num`); result `ref`s are integers only | `tests/fuzz.test.mjs` (fails on the previous room) |
| 2 | High | A phone that changed networks reconnected into "session in use" and never retried | The room refused a join whose session token was still held by its old (dead, not yet detected) socket; the client does not retry 4004 | The newest connection of a session takes over; the old one is closed with 4004, cleaned up synchronously, and its late messages ignored | `tests/reconnect.test.mjs`, `tests/browser-reliability.mjs` |
| 3 | High | Every reconnect (reload, network drop) sent the player back to the gate | `welcome` always carried `SPAWN` | The room remembers where a departing session stood for 45 s and resumes there if the spot is clear | `tests/reconnect.test.mjs`, `tests/browser-reliability.mjs` |
| 4 | High | On slow frames the room ran ahead of the player (3.8 m over a 22 m walk at 3–5 FPS); the walk then ended with a snap | The client integrated at most 250 ms per frame while the room applied each input for 350 ms | One shared integrator (`shared/movement.mjs`) with the same 350 ms limit on both sides | `tests/movement.test.mjs` (also proves the old limit drifts) |
| 4b | High | At very low frame rates a walk ended 0.8–2.3 m from where the room had the player (browser trace at 2 FPS) | The client applied each new input to time that had already passed and did not coast within long frames; the room switched inputs at the start of the tick they arrived in | The client walks each frame with the input it last sent and coasts like the room (`stepFrame`); the room walks a player on to each input's arrival (`advanceWalker`); exact eased displacement | `tests/movement.test.mjs` (0.000 m vs 0.4–5 m for the original client) |
| 5 | High | Starting to walk on a slow device, or sprinting on a slow network, snapped the player backwards | Drift compared the room's lagging snapshot with the current position | Drift is measured against the path walked in the last 1.5 s | `tests/movement.test.mjs` (trail), browser drift trace |
| 6 | High | A single character model failing to download replaced the whole campus with "The campus couldn't open" | The only error boundary wrapped the entire 3D world; failed downloads were cached forever | Per-avatar error boundary with a stand-in figure and back-off retry; failed downloads forgotten after 5 s | `tests/browser-reliability.mjs` |
| 7 | Medium | Disconnected while seated: the player stayed seated locally and "Stand up" failed until a reload | The room released the seat; the client kept its local sit state and seat | The client stands up and lets go of the ball when the connection drops or a new session starts; the room stands a leaving player up at the seat's exit | `tests/world.test.mjs`, `tests/browser-reliability.mjs` |
| 8 | Medium | A settle request could move a player through a closed door, the court fence or a thin wall | Only distance (≤ 0.9 m) and the destination were checked | The correction goes only as far as the player could walk | `tests/reconnect.test.mjs` |
| 9 | Medium | A Studio D1 seat could be taken from the gallery through the closed classroom wall; a ball picked up through the fence | Range checks only | Seats' stand points and balls must be reachable on foot | `tests/world.test.mjs` |
| 10 | Medium | A ball dropped away from the court stayed there for good | A sleeping ball returned before its idle timer advanced | Sleeping balls far from the court still count idle time and respawn after 20 s | `tests/ball.test.mjs` |
| 11 | Medium | The gold band was effectively impossible on slow devices; a cancelled touch fired a shot | The release used the last drawn frame's meter value (a fifth of the sweep per frame at 5 FPS); `pointercancel` called release | The meter is read at the input event's timestamp; cancel cancels | Browser suites (`verify`, `interactions`) |
| 12 | Medium | Returning to a backgrounded tab lowered the render resolution | The first frame's delta (the whole hidden time) counted as a 0 FPS second | Pauses over 3 s start a new measurement window; steps that do not help are undone | `tests/resolution.test.mjs` |
| 13 | Medium | Low-end phones capped at 30 FPS or limited by their CPU were blurred to 60 % resolution for no gain | The controller lowered resolution whenever FPS < 50, with no check that it helped | A step down that does not raise FPS by 8 % is reverted, with 20 s → 5 min back-off | `tests/resolution.test.mjs` |
| 14 | Medium | On Low, a car's shadow stayed in its bay after it drove away (and doors, people) | The render-once shadow map included moving objects | Moving objects are registered and left out of the static shadow render | Manual (shadow map) |
| 15 | Medium | GPU memory grew as players came and went (name tags, skeleton bone textures, cloned materials) | Name-tag canvas textures and rigs were never disposed | Disposed on unmount; name-tag canvases sized to the tag | `tests/browser-soak.mjs` |
| 15b | Medium | Below 20 FPS every animation, the sit-down/stand-up that gate actions, doors and ball prediction ran in slow motion (10× at 2 FPS) | Frame time capped at 50 ms | Up to 250 ms of real time per frame | `browser-interactions` at 2 FPS (sit-down 14 s → completes) |
| 15c | Low | Remote walkers were animated as running on slow devices | Gait speed divided by the capped 50 ms step | Real frame time | Visual |
| 16 | Low | Remote players' speed pulsed with every 15 Hz update | Exponential easing towards the newest snapshot | Snapshot interpolation 110 ms in the past on the room's clock | `tests/interpolation.test.mjs` |
| 17 | Perf | The whole interface and the 3D scene's React tree re-rendered every 2 s (FPS readout) and on every store change | `App` subscribed to the entire store; `World` was not memoised | Narrow selectors; `memo(World)`; a self-contained location label | Benchmark (main-thread script time) |
| 18 | Perf | 15 Hz state messages of 2.7 KB (1 player) to 10.4 KB (24 players) per client | Full-precision numbers and every vehicle every time | Centimetre/milliradian precision, changed vehicles only, serialised once | Payload probe |
| 19 | Perf | Off-screen and distant avatars were posed and drawn every frame | No culling for skinned meshes (`frustumCulled = false`) | Per-avatar frustum test; pose every 2nd/4th frame beyond 30/60 m; no shadow beyond 60 m | Benchmark with bots |
| 20 | Perf | Camera collision scanned 1,214 colliders five times a frame and allocated ~18 vectors | No spatial query | Grid query once per frame; reused vectors | `tests/world.test.mjs` (grid query) |
| 20b | Dev | The dev server reloaded the page during a first visit | three.js example modules discovered only when the lazy 3D scene was crawled | `optimizeDeps.include` | Account and interactions suites |
| 12b | Medium | Introduced earlier in this round and caught by the benchmark before release: under 2 FPS the FPS readout and telemetry never updated and the resolution never adapted | The first version of fix 12 treated any frame over 0.5 s as a pause | Only gaps over 3 s are pauses | `tests/resolution.test.mjs` (0.8 s frames) |
| 21 | Test | Six browser suites could not start on Linux; several waits raced slow frames; the smoke test clicked controls that do not exist and asserted nothing | Hard-coded Windows Chrome/D3D11; fixed sleeps; stale labels | Shared launcher; condition waits; real controls and assertions | The suites themselves |


### Test changes made in this round (disclosed)

No assertion was weakened. Changes are to how suites start and wait:

- **Launcher.** Six suites hard-coded a Windows Chrome with Direct3D flags; all use `tests/support/browser.mjs`.
- **Condition waits instead of sleeps.** Jumps record the peak height in the page (a jump can last two
  frames, shorter than one key round trip); held keys and the joystick wait until the distance is
  covered; second browsers wait until "Enter campus" is enabled; messages are awaited. Same thresholds.
- **Walks** in `browser-verify` steer in the page (the QA hook, through the normal input path) instead
  of polling keys from the test process, which overshot by metres; the 1.9 m tolerance is unchanged.
- **Shots** are released in the page at a known meter value: the game now reads the meter at the
  release's own time, and a key-up from the test process can arrive a second late. Scoring is still
  asserted by the room's physics.
- **Smoke** uses the editor's real controls and now asserts the saved appearance, walking, settings and the phone layout.
- **Reliability** filters one expected page error: the renderer reports the caught "Failed to fetch" of the deliberately blocked character model.
- Timeouts without a GPU are 45 s, as the community suite already used.

### Not verified in this round

- **Physical phones** (the itel S24 or any other): emulation only.
- **Real GPU frame rates**: SwiftShader measures a CPU rasterizer; see the performance report for what this does and does not show.
- **A hosted Supabase project**, **more than one room instance**, and **load beyond 24 simulated players** (payload measured; no load test of the room under many real browsers).
- **Mobile networks**: latency and loss were not emulated, except the reconnect paths in `browser-reliability`.
- **The Low static-shadow fix** is checked mechanically (moving objects are left out of the render); it was not compared visually.

## 14 October 2026: social, competition, activities and analytics

Measured in a Linux cloud container (4 CPU cores, **no GPU**) with Node 22.22. Playwright drove
Chromium with software WebGL (SwiftShader through ANGLE) and the QA render scale `?qa-scale=0.2`
(`tests/support/browser.mjs`; on Windows the suites still use the installed Chrome and the GPU).
Each browser suite started its own local stack (embedded PostgreSQL 17, the local Supabase stand-in,
the room and Vite) and ran from a frozen copy of the working tree, so edits made during a run could
not hot-reload it.

| Command | Result |
|---|---|
| `npm test` | **98 / 98 pass** (18 s). Adds `social`, `social-room`, `competition`, `duels`, `activities`, `activities-room` and `analytics` to the earlier files. |
| `npm run build` | Passes. Unconfigured `index` chunk 593 kB (196 kB gzip), up from 485 kB (164 kB) before this round; the 3D scene chunks are unchanged. |
| Secret scan of the unconfigured bundle | No `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `ANALYTICS_SALT`, `ADMIN_TOKEN`, `sb_secret_` or private-key text. |
| `node tests/browser-social-accounts.mjs` | **13 / 13 pass** (two signed-in browsers: friends, presence, private messages, parties, meet-up, block, profile from a name tag, phone layout) |
| `node tests/browser-duel.mjs` | **6 / 6 pass** (Court Duel challenge, play, concede, rated result, rankings) |
| `node tests/browser-activities.mjs` | **7 / 7 pass** (check-in, titles and accents, friends-only profile, a challenge run with its HUD, phone layout). Run before the party-removal confirmation was added; its steps do not touch that dialog. |
| `node tests/browser-accounts.mjs` | **9 / 9 pass** after the timing changes below |
| `node tests/browser-community.mjs` | **11 / 11 pass** after the timing changes below |
| `browser-interactions`, `browser-verify`, `browser-social`, `browser-mobile`, `browser-smoke` | **Not re-run in this round.** Their results files are from 13 October (below). |

### Test changes made in this round (disclosed)

`browser-accounts.mjs` and `browser-community.mjs` were written on a Windows machine with a GPU. In
this container the frame rate under software WebGL is a small fraction of that: walking 3 m took
3.7 s in one run and 13.2 s in another (about 0.7 s at full speed), and with three or four 3D pages
open a page could take up to 57 s to respond. Only waits changed; **every assertion is unchanged**:

- **Walking steps** (both suites) held W for a fixed 0.9–1.2 s. They now hold it until the distance
  is covered, up to 20 s, then assert the same minimum distance, so a player who cannot walk still
  fails.
- **Sign-in keeps the player in place** (`browser-accounts.mjs`): the reference position is now taken
  once the client and the room agree where the player is. On slow frames the room's position trails
  and the client glides back to it after stopping; before, that glide (1.21 m) was counted against
  sign-in. Sign-in itself moved the player less than the 0.6 m tolerance.
- **Timeouts** (`browser-community.mjs`): the Enter click may take as long as page loading (120 s),
  and actions default to 45 s without a GPU, as in `tests/support/browser.mjs` (20 s with a GPU).
- **Pages closed when finished** (`browser-community.mjs`): Ada's and Tobi's pages are closed before
  the phone step, which does not use them; with four software-rendered pages the phone page stopped
  responding.

### Not verified in this round

- **Physical phones.** Phone layouts were checked in touch-emulated 390 × 844 viewports only.
- **A hosted Supabase project.** The seven migrations ran against embedded PostgreSQL 17 with the
  local stand-in, not a hosted project (checklist in [ACCOUNTS.md](ACCOUNTS.md)).
- **More than one room instance, and load.** Parties, presence and duels were tested in one room.
- **The `Workers Builds: campos-worlds` check** (Cloudflare) fails on every pull request in this
  repository within a second and without a build log, before any project code is built. It points to
  the Cloudflare project's setup; the repository has no `wrangler` configuration.

## 13 October 2026: accounts, clubs and events

Measured on Windows 11 (Intel Iris Xe, ANGLE Direct3D 11) with Node 24.20 and the installed Google Chrome driven by Playwright. Results are from the final code in that working tree.

### Summary

| Command | Result |
|---|---|
| `npm run build` (`tsc -b && vite build`) | Passes. Unconfigured bundle: `index` 459 kB (154 kB gzip), `three` 914 kB, `PostFX` 286 kB, `World` 108 kB. With `VITE_SUPABASE_*` set, supabase-js is split into its own lazily loaded chunk (224 kB) and `index` is 493 kB. |
| Secret scan of both bundles | No service-role key or secret in either. The only `sb_secret_` text is supabase-js's own key-format check. |
| `npm test` | **42 / 42 pass** (16 s): accounts 7, ball physics 7, community database 15, room protocol 4, world rules 9. |
| `node tests/browser-accounts.mjs` | **9 / 9 pass** (own local stack) |
| `node tests/browser-community.mjs` | **11 / 11 pass** (own local stack) |
| `node tests/browser-interactions.mjs` | **27 / 27 pass** (QA room and web pair). This suite was failing at the last commit; see below. |
| `node tests/browser-verify.mjs` | **17 / 17 pass**, but intermittent: some runs fail on a timing-sensitive step (see *Known flaky steps* below). |
| `node tests/browser-social.mjs` | **4 / 4 pass** |
| `node tests/browser-mobile.mjs` | **12 / 12 pass** |
| `node tests/browser-smoke.mjs` | **Fails (pre-existing, unchanged).** It forces software WebGL (SwiftShader, about 2 FPS here), so the avatar swatches never stop animating long enough to click. It also clicks a `bun` accessory that has never existed (`ACCESSORIES` is `none / backpack / headphones / glasses` at HEAD too). Left as is. |

The browser suites ran against an isolated QA pair (`campos-qa-room` on :3101 and `campos-qa-web` on :5174, `TEST_URL=http://localhost:5174`), not the default dev ports. The account and community suites each start their own stack.

### How accounts, clubs and events are tested

No hosted Supabase project was used. The tests run the real migrations against real PostgreSQL:

- `tests/support/postgres.mjs` starts **embedded PostgreSQL 17.10** with a UTF-8 database and applies `supabase/migrations/` on top of `tests/support/supabase-shim.sql`. The shim provides Supabase's `anon`, `authenticated` and `service_role` roles, `auth.users`, `auth.uid()` and default privileges. Every query runs as the right role with request JWT claims set, so **RLS policies, column grants and security-definer functions are exercised as written**.
- `tests/support/local-supabase.mjs` is a small local stand-in for Supabase Auth (sign-up, password and refresh-token grants, `/user`, logout) and PostgREST RPC, with HS256 JWTs and PostgREST-style error codes. The browser uses the **real supabase-js 2.117.2 client** against it, and the room server verifies tokens through it as it would through Supabase.
- `npm run dev:local` starts the same stack (database, stand-in, room with account verification, and Vite) for trying the features by hand.

The database tests cover:
- **Profiles:** handle validation, uniqueness and reserved handles; the avatar allowlist matches the game's; nobody can edit another player's profile.
- **Progress:** players cannot award themselves progress or badges.
- **Clubs:** owner and organizer authorisation; idempotent memberships with database-unique rows; creation limits.
- **Events:** draft, published and canceled states; validation of times, lengths, capacity and locations; paging and filters.
- **Capacity:** 25 concurrent RSVPs against a capacity of 10 yield exactly 10.

The room tests cover:
- **Identity:** a verified identity replaces the name the client claims; forged, invalid and expired tokens are rejected; one account appears once.
- **Progress:** only server-validated progress is recorded.
- **Tokens:** no token appears in URLs or logs.

The browser tests cover:
- **Accounts:** registration and sign-in errors; profile creation with a live handle check and preview; persistence across reloads; live propagation to other players. Sign-in keeps the player where they stand without remounting the 3D scene. An expired session falls back to guest mode.
- **Events and clubs:** the board opens and closes with V and Esc while the player keeps walking. Guests can browse events and are asked to sign in to RSVP. RSVP and cancel, capacity, organizer roles, canceled events, a phone bottom sheet, and recovery from a backend outage are all tested.

### Test changes made in this round (disclosed)

The brief asked not to edit failing tests just to get a green result. These are every change to a pre-existing browser test, and why:

- **`browser-interactions.mjs`** was already failing at the last commit (`docs/interaction-results.json` at HEAD records a timeout in the basketball section). The run exposed real product bugs, which are fixed in the code:
  - **A ball wedged between rim and backboard (or on the arm) stayed out of reach forever.** It now returns to the rack after 3 s at rest off the ground, or after 8 s above reach.
  - **The new respawn could loop at high frame rates**, because the counter survived the reset. It's now cleared.
  - **The room lost time under load.** It now integrates real elapsed time in substeps.
  - **Standing drift of 0.9–2 m between client and room went uncorrected.** The client now glides to the room's position, but only once the room has also stopped the player, so it never chases a snapshot sent mid-stride.

  Harness fixes:
  - Wait for a loose ball to stop rolling before walking to it.
  - Release the shot in the early part of the gold band while the needle rises, allowing for key-event latency.
  - Scope the mobile buttons to the touch controls; the on-screen prompt carries the same label, so the old selector matched two elements.
  - Route the mobile walk around the mango tree at (−32, 15).
  - Retry screenshot and results writes, because Windows briefly locked files in `docs/` during runs.
- **`browser-verify.mjs`:**
  - Four waits used `async` predicates, which Playwright does not await (a Promise is truthy), so they passed immediately without checking anything: opening a location panel, a peer appearing, remote movement, and disconnect cleanup. They now really wait, which makes the test stricter.
  - The basketball steps got the same settle and release-timing fixes as above.
  - Screenshot writes retry.
- **`browser-accounts.mjs`** gained an assertion: signing in neither moves the player nor remounts the scene.
- **`browser-community.mjs`** gained the board and movement check.
- **`browser-smoke.mjs` and `browser-social.mjs`:** the only change is that the base URL now reads `TEST_URL` (default `http://localhost:5173`), so they can run against the QA pair. Their steps and assertions are unchanged.

### Known flaky steps

`browser-verify.mjs` (unchanged in these respects) has steps that depend on timing and fail intermittently on this machine when two 3D browsers share the integrated GPU:

- Its keyboard `walk()` stops pressing keys 0.8 m from the target and polls every 110 ms. Momentum regularly carries the player 1.5–2.5 m, against a 1.9 m tolerance, and an axis-aligned route to (29, 2) can catch the bollard at (25.5, 1.4).
- The keepsake count is asserted 300 ms after the last walk, before the room's confirmation can arrive. The client retries the collect every 0.8 s.

In two consecutive final runs, one passed 17 / 17 and one failed on the keepsake count (5 of 6). Making these steps wait on conditions is a sensible follow-up.

### Not verified

- **A hosted Supabase project.** No credentials were available. The stand-in follows Supabase's documented endpoints, but email confirmation, rate limits, the new `sb_publishable_` / `sb_secret_` keys (sent only in `apikey`), and Supabase's own PostgREST behaviour were not exercised against the real service. See the checklist in [ACCOUNTS.md](ACCOUNTS.md).
- **Deployment.** Cloudflare Pages and Render deployments with the new variables were not performed.
- **Load.** Concurrency was tested for RSVPs (25 simultaneous) only, not for many signed-in players in one room.
- **Physical devices.** Touch layouts were tested in a 390 × 844 touch-emulated viewport, not on a physical phone.
- **Progress migration.** Guest progress is never migrated into an account. This is deliberate, so badges stay verifiable, but it means a guest's keepsakes do not carry over.

## Screenshots

- `docs/screenshots/accounts/`: registration validation, profile creation, own profile, another player's card, sign-in error.
- `docs/screenshots/community/`: the empty board, club form and owner view, event form, owner, attendee and guest views, a canceled event, an organizer, the phone bottom sheet, and the service error.
- `docs/screenshots/interactions/`: seating, doors, library, café, classroom, basketball and mobile.
- `docs/screenshots/`: welcome, avatar, gameplay, library interior, basketball, map, multiplayer and mobile.
- `docs/screenshots/social/`: friend search, friends online, private messages, party chat, meet-up, a profile opened from a name tag, and the phone drawer.
- `docs/screenshots/duel/`: game modes on the court, a duel in play, the result and rankings.
- `docs/screenshots/activities/`: an event check-in, a profile title, a friends-only profile seen by a non-friend, a challenge run and the phone layout.
