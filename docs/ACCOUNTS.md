# Accounts, profiles, clubs and events

CampOS Worlds supports optional player accounts. Signed-in players keep a handle, display name, bio, appearance and **server-verified** badges across sessions and devices. They can also join and run clubs, publish campus events and RSVP. Guests can still enter and play without registering, exactly as before.

The backend is **Supabase**: Supabase Auth for email and password accounts, and PostgreSQL for data. Nothing in CampOS Core is used or assumed (see [CORE-INTEGRATION.md](CORE-INTEGRATION.md)). All provider-specific code sits behind `src/services/community.ts` on the client and `server/accounts.mjs` on the room server, so the provider can be replaced later.

> **Status.** The schema, permissions, room integration and interface are implemented and tested against a real PostgreSQL 17 server and a local stand-in for Supabase's auth and RPC endpoints (see *Testing*). They have **not** yet been run against a hosted Supabase project, because none is configured for this repository. Complete the setup below and the checklist at the end before calling the feature production-ready.

## How it works

| Concern | Where it is enforced |
|---|---|
| Who you are | Supabase Auth issues the session. The room server re-checks every token with Supabase Auth (`GET /auth/v1/user`) before binding it to a multiplayer identity. Tokens travel in a WebSocket message, never in a URL, and are never logged. |
| Your name and look in the room | The room server loads them from your saved profile, never from the client. A signed-in client's `profile` message only asks the room to re-read the database. |
| Editing profiles | `save_profile()` runs with the caller's rights. Row Level Security (RLS) and column grants allow players to change only their own row, and only the handle, display name, bio and appearance. Handles are unique: a database index, checked case-insensitively. |
| Badges and progress | Written only by the room server through `record_progress()` and `record_hoops_round()`, which can be executed **only** by `service_role`. Keepsakes and landmarks are recorded after the room has checked the player's position; basketball rounds are scored by the room's own physics. Players can read but never write these tables. |
| Clubs | Created only through `create_club()` (limits: 3 per owner, 2 per hour). Owners edit and delete, and designate organizers. Memberships are unique per player and club (primary key). |
| Events | Created and changed only through `create_event()`, `update_event()`, `set_event_status()` and `delete_event()`, by the club's owner or organizers. A trigger enforces the status rules: draft → published → canceled, and canceled is final. Drafts are visible only to organizers. |
| RSVPs and capacity | `rsvp_event()` locks the event row (`SELECT … FOR UPDATE`) while it checks capacity and inserts, so simultaneous requests can never exceed the limit. Canceled, ended and draft events refuse RSVPs. |

Every table has RLS enabled. Direct table writes through the API are revoked, except the few that need no extra rules: an owner editing club details or roles, a player leaving a club or cancelling their own RSVP, and editing your own profile. Each of those is covered by a policy. Public reads are deliberate: profiles (handle, name, bio, appearance, badges), clubs and members, and published or canceled events with their attendees. Email addresses never leave Supabase Auth. Private progress detail is readable only by its owner.

**Local guest progress is not migrated.** Keepsakes, tour stops and basketball scores earned as a guest are stored in that browser and can be edited by anyone with developer tools. They stay on that device as local progress and are never converted into verified account badges. Badges on an account are earned while signed in, when the room can verify them. The profile panel tells guests this.

## Schema (supabase/migrations)

1. `20261013120000_profiles_and_progress.sql`: `campus_locations` (stable ids mirrored from `LOCATIONS` in `shared/campus.mjs`), `profiles`, `player_progress`, `achievements`, `player_stats`, plus RLS, grants and the profile and progression functions.
2. `20261013120100_clubs_and_events.sql`: `clubs`, `club_members`, `events`, `event_rsvps`, plus RLS, grants, the status guard trigger, the club and event functions, and `account_snapshot()` for the room server.

Later migrations add social features, duels and achievements, dorm rooms and the lab location. `20261022120000_campus_store.sql` adds the campus store: `shop_items`, `shop_orders`, `shop_ownership` and `shop_webhook_events`, and the room-only order and fulfilment functions. It also extends `profiles_guard` so premium characters and accessories must be bought first, and makes `my_profile()` and `account_snapshot()` list what the player owns ([store](STORE.md)).

Foreign keys cascade from `auth.users` → `profiles` → everything a player owns, except an event's `created_by`, which is set to null so a club's events survive an organizer deleting their account. Timestamps are `timestamptz`, stored in UTC and shown in each player's local time zone. Text lengths, categories, colours, event duration (at most 12 hours), schedule window (up to a year ahead), capacity (1–500) and page sizes (at most 50) are all bounded in the database.

## Set up a Supabase project

1. Create a project at supabase.com, choosing a region near your players.
2. Under **Authentication → Providers → Email**, keep email and password enabled. Decide whether to require email confirmation. The app supports both: with confirmation on, sign-up shows "Check your inbox" and sign-in works once the link is followed. Set the **Site URL** and **Redirect URLs** to your deployed frontend origin.
3. Apply the migrations, in filename order, by either:
   - the Supabase CLI: `supabase link --project-ref <ref>`, then `supabase db push`, or
   - the dashboard **SQL editor**: paste and run each file in `supabase/migrations/` in order.
4. Leave the default Supabase roles (`anon`, `authenticated`, `service_role`) untouched. The migrations set exactly the grants they need.
5. Copy these values from **Project Settings → API**:
   - Project URL → `VITE_SUPABASE_URL` (frontend) and `SUPABASE_URL` (room server)
   - anon / publishable key → `VITE_SUPABASE_ANON_KEY` (frontend) and, optionally, `SUPABASE_ANON_KEY` (room server)
   - service_role / secret key → `SUPABASE_SERVICE_ROLE_KEY` (**room server only**)

| Variable | Where | Secret? | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Frontend build | No (public) | Enables accounts, clubs and events in the interface |
| `VITE_SUPABASE_ANON_KEY` | Frontend build | No (public; RLS protects data) | Supabase client key |
| `SUPABASE_URL` | Room server | No | Token checks and progression |
| `SUPABASE_SERVICE_ROLE_KEY` | Room server | **Yes** | Records verified progress; reads profiles for the room |
| `SUPABASE_ANON_KEY` | Room server | No | Optional; used as the `apikey` header for token checks |

Never put the service-role or secret key in a `VITE_` variable, in `index.html`, or in a committed file. `VITE_` values are compiled into the public bundle.

Without the `VITE_` variables, the interface hides account and community features behind a clear "not set up for this deployment" message, and guest mode works as before. Without the server variables, the room keeps everyone as a guest and tells signed-in players that accounts aren't available in that room. Accounts never appear to work when they don't.

## Run locally without a Supabase project

```bash
npm run dev:local
```

Then open http://127.0.0.1:5175. This starts an embedded PostgreSQL 17, applies the migrations, and serves a small local stand-in for the Supabase endpoints Worlds uses: email and password auth, plus RPC. It also starts the room with account verification and Vite. Data persists in your temp folder. The stand-in exists for development and tests only (`tests/support/local-supabase.mjs`). It is not a production backend.

## Testing

- `npm test` includes:
  - `tests/community.test.mjs`: 15 database tests against a real PostgreSQL 17, run as the `anon`, `authenticated` and `service_role` roles exactly as PostgREST would. They cover RLS, grants, every function, ownership checks, limits, state transitions, and a 25-way concurrent RSVP race against a capacity of 10.
  - `tests/accounts.test.mjs`: 7 end-to-end tests using the real `@supabase/supabase-js` client and real WebSocket clients. They cover registration and sign-in errors, identity binding and spoof resistance, live profile propagation, invalid, forged and expired tokens, duplicate windows, server-verified progress and badges (including a physics-scored basketball round), and that no token appears in URLs or logs.
- `node tests/browser-accounts.mjs` and `node tests/browser-community.mjs`: real-browser flows (Chrome via Playwright) against the full local stack.

The first test run on a machine initialises a PostgreSQL cluster in the temp folder (about 40 seconds); later runs reuse it.

## Before production: remaining checks with a real project

These could not be run in this repository because no Supabase project or credentials exist here:

- [ ] Apply both migrations to a fresh Supabase project and confirm they run without errors (Supabase's managed roles and default privileges differ slightly from the local shim).
- [ ] Run the browser flows against the hosted project: sign up (with your confirmation setting), sign in, profile create and edit, a club, an event, RSVP.
- [ ] Confirm the room server, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, binds a signed-in player and records a keepsake.
- [ ] If you use the new `sb_publishable_` / `sb_secret_` keys rather than the legacy JWT keys, confirm the room's calls succeed. `server/accounts.mjs` sends new-style keys only in the `apikey` header.
- [ ] Review Supabase Auth rate limits, password policy and email templates for your audience.
- [ ] Decide on data retention and account deletion requests. Deleting a user in Supabase Auth cascades to their profile, progress, memberships, owned clubs and RSVPs.
