# Validation

Two rounds are recorded here, newest first. The `*-results.json` files in this folder are rewritten by
every run, so each holds that suite's **latest** run, with its date inside.

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
