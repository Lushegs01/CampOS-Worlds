# Operating CampOS Worlds

The supported topology is one persistent Node room, at most 48 concurrent connections,
and a static HTTPS frontend. A worldwide audience does not imply unlimited simultaneous
players. Replicas do not share live state; do not put independent rooms behind random
load balancing. Regional room discovery, placement and matchmaking need separate work.

## Start and configuration

Use Node 24 and a supervisor/container with automatic restart on failure. Set
`NODE_ENV=production`, exact HTTPS `ALLOWED_ORIGINS` and a random server-only
`ADMIN_TOKEN` of at least 32 characters. Generate the token in your secret manager.
Run `npm run verify:production-config` in the room's environment before rollout. It
reports consistency without printing secrets. It cannot prove that credentials work.
Optional accounts and payments must be configured together as described in
[ACCOUNTS.md](ACCOUNTS.md) and [STORE.md](STORE.md). Keep store checkout disabled until
the provider's signed webhook and entitlement flow have been verified in that environment.

Mount persistent storage at `server/data` (`/app/server/data` in the container), writable
by UID 1000. Keep it private. The default paths are `reports.jsonl`, `moderation.json`,
`economic-lab.json`, the lab experiment directory and optional `analytics/`. Custom paths
must be outside frontend directories. Use one writer per moderation/lab file. Confirm the
volume remains attached across replacement deployments, not only process restarts.

The image runs as a non-root user, supports a read-only root filesystem and includes a
readiness health check. The CI container exercise starts it with dropped capabilities,
a writable data volume and a read-only root, joins real players, tests moderation, sends
SIGTERM and verifies the ban after restarting the container.

## Health and monitoring

`GET /health` and `GET /ready` return uncached JSON with readiness, player count and
capacity. They verify room initialization, including the moderation file; they do not
claim Supabase, Bachs, persistent-volume durability or all game features are healthy.
Route these paths directly to the room, outside SPA rewrites/service-worker recovery.

Use a private connection/SSH tunnel for `GET /admin/status`. It reports connection and
player counts, pending account/report work, report failures, slow-connection removals,
rejected upgrades, maximum tick gap, memory and CPU counters. No access token or chat is
returned. Protect all `/admin/*` routes at the network layer as well as with the token.
Never expose the token in a frontend bundle, URL, screenshot, shell history or CI log.

Configure external monitoring on the actual hosts: probe readiness every 30 seconds,
alert after three failures, and track restarts, HTTP 5xx, resource usage, volume free
space, report-write failures and slow-connection removals. Sustained connection usage
above 80% needs an admission/capacity decision before the room fills. Investigate tick
gaps above 250ms and any report failure. Cumulative counters reset on process restart.
Set volume alerts (for example, 20% free warning / 10% urgent) and an operator response.
This repository does not provision an external monitor or send alerts to anyone.

`npm run test:capacity` runs a 60-second local 48-player exercise. Set
`CAPACITY_SECONDS=1800` for a 30-minute soak on a representative isolated host. The
server and synthetic clients run in separate processes. Evidence records hardware,
input rate, per-client state counts, RTT, stalls, CPU, memory, overflow and six reconnects.
Acceptance requires no disconnects, at least 8 state updates/sec for every client,
p95 local RTT/state gaps below 250ms, no state stall above 1.5 seconds and room RSS
growth below 256MiB. These are
local transport limits, not physical-device FPS, global latency or database capacity.
Do not run a production load test against a shared/public host without a planned window.

## Reports and moderator actions

Room reports go to the private `reports.jsonl` with up to five recent public messages
from the reported player. They include account IDs where available. Account-service
reports also need review in Supabase; the room log does not replace that queue. Assign
people and a response schedule before public launch. A file being saved does not mean
that someone has reviewed it. Restrict and encrypt backups, document retention and a
deletion process, and rotate report logs while the room is stopped. The room bounds its
in-flight report queue at 100; disk usage/retention still require operator management.

The operator helper reads `ADMIN_TOKEN` from its environment:

```sh
node scripts/ops/admin.mjs http://127.0.0.1:3001 status
node scripts/ops/admin.mjs http://127.0.0.1:3001 bans
node scripts/ops/admin.mjs http://127.0.0.1:3001 kick '<current-player-id>' 'Reason' 24
node scripts/ops/admin.mjs http://127.0.0.1:3001 ban '<current-player-id>' 'Reason' 24
node scripts/ops/admin.mjs http://127.0.0.1:3001 ban 'account:<verified-account-uuid>' 'Reason' 24
node scripts/ops/admin.mjs http://127.0.0.1:3001 unban 'account:<verified-account-uuid>'
```

`kick` denies that guest session. `ban` also denies a verified account, or can target an
offline account by UUID. Durations default to 24 hours, with a 30-day maximum. The store
caps active keys at 5,000 and retains the latest 1,000 audit actions. Guest tokens are
stored as SHA-256 hashes. Ban changes commit atomically and sync the file before success
is returned; a storage failure returns 503 and leaves the player connected. Invalid
moderation storage prevents startup. Restore a verified backup; never silently clear it.

An account ban is checked after token verification, including after a delayed profile
read. The room never trusts an account UUID supplied by a player. New guest sessions
remain possible: this is an open guest campus. Stronger admission control needs verified
identity/invitations and abuse protection at the hosting edge. No IP/fingerprint tracking
has been added. Both the session and account keys must be removed if restoring access
to the same previously banned browser. Rotate the admin token if it is exposed.

## Shutdown, backups and recovery

Use SIGTERM and allow at least 20 seconds before forced termination. The process stops
admission and simulation, closes players with a reconnectable reason, cancels retry
timers, flushes accepted reports/account work, lab changes, analytics and moderation,
and exits zero on success. It exits nonzero if its 15-second shutdown deadline is missed.
Browsers reconnect with backoff and restore their session from the authoritative room.
Live balls, seats, vehicles and guest session positions are not durable across a restart.

Before each release and at the chosen backup interval, stop/drain the room, copy the
entire data volume and any custom data paths into access-controlled encrypted storage,
record a SHA-256 checksum, then restart. Include the immutable lab experiment files,
not just the lab index. Use Supabase's separate database backup/PITR capability for
account/community/store records; local room backups do not include that database.
Keep secrets in the platform secret manager. Record the recovery point and recovery
time objectives and test a restore on a private host before relying on the backup.

To restore: stop the room, preserve the damaged data for investigation, restore a
checksum-verified complete volume with UID 1000 ownership, start exactly one room,
verify readiness, ban enforcement and lab exports, and then reopen admission. Avoid
restoring an older account/store database over newer provider payments without
reconciling the payment events. Schema rollback needs a compatible database snapshot.

## Rollout and rollback

Record the frontend artifact hash, room image digest, source commit and database
migration version. Keep the previous artifact/image and a verified backup. Publish all
of `dist/` with the actual public build settings; the retained guest-only test artifact
must not overwrite a configured account-enabled deployment. Drain and replace the room
using the same data volume. Run the live smoke check from an authorized network:

```sh
node scripts/ops/smoke.mjs https://camposworlds.click wss://your-existing-room-host/ws
```

This verifies public headers/assets/worker, two guest connections/chat and reconnect.
Also verify real signup/email redirects, profile persistence, store webhook entitlements
where enabled, PWA update/install, and iOS/Android/touch gameplay on actual devices.
Measure latency from the intended regions and choose a measured admission limit.

If readiness or core smoke checks fail, stop new admission, retain logs, drain the room
and redeploy the previous compatible image/static artifact with its matching public
settings. Verify the smoke checks again before reopening. A source rollback alone does
not restore data or guarantee database compatibility.

Production publication, real region/device measurements, operational staffing, provider
configuration, restore drills and operator-specific privacy/terms/contact details need
evidence from the real deployment. They cannot be certified by this local repository.
