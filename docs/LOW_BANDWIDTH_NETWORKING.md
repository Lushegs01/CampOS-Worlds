# Connection quality and poor networks

The arena's networking was already low-bandwidth-first, and none of it was replaced
([COMBAT-ARENA.md](COMBAT-ARENA.md)):

* 60 Hz authoritative server;
* client prediction with rewind and replay;
* lag-compensated hits;
* droppable snapshots and interest management;
* reconnection.

This pass adds **measurement**, uses it in one place where it is safe to, and closes one ordering gap.

## Measured, not assumed

`src/network/netQuality.mjs` (`netMonitor` in `src/arena/net.ts`) records:

| Signal | Source |
|---|---|
| Round-trip time (median of 16) and its jitter | the existing 2 s ping |
| Lost pings | no reply within 5 s |
| Snapshot spacing, median and 95th percentile | each arrival |
| Silence | time since the last snapshot |
| Server corrections of our predicted position | count per minute and the largest (metres) |
| Reconnections | each new socket after the first |

It grades the link **good / fair / poor / critical**:

* **fair**: over 120 ms, 25 ms jitter, 2 % loss, a 120 ms snapshot gap (95th percentile), or 6 corrections a minute;
* **poor**: over 250 ms, 60 ms jitter, 8 % loss, a 220 ms gap, or 20 corrections a minute;
* **critical**: 1.5 s without a snapshot, or 30 % loss.

The HUD status line shows a four-bar signal coloured only when the link degrades, with the ping. It has a screen-reader
label and a tooltip ("Connection poor: other players may lag").

## Adaptive interpolation (remote players)

Other players are drawn a little in the past, between snapshots. That buffer was a fixed 100 ms. It now follows the
measured snapshot jitter: `median spacing + 1.2 × (95th − median) + 20 ms`, between 100 and 200 ms. It eases to a new
value over about a second, so drawn players never jump. On a clean link it stays at 100 ms; on a jittery one, remote
players keep moving smoothly instead of freezing and snapping when a snapshot is late.

This is fair: each command batch already reports the room time the player was drawing (`rt`), and the server rewinds hit
registration to exactly that time (capped at `MATCH.maxRewindMs`). The 200 ms ceiling keeps it inside the cap.

## Stale state rejection

A server state that acknowledges fewer of our commands than one already applied is now ignored, so it can never pull
the player back. (WebSocket delivery is ordered, so this can only happen across a reconnection, where the counter
resets.) Reconciliation itself is unchanged and never disabled.

## Graphics are independent of the network

Nothing in graphics settings or adaptive rendering reads connection quality, and the monitor imports nothing.
`tests/net-quality.test.mjs` checks both. A poor link never lowers textures, shadows or resolution.

## Tests

`tests/net-quality.test.mjs` runs synthetic links:

* clean 40 ms → good, 100 ms delay;
* 150 ms with mild jitter → fair;
* 300 ms → poor;
* heavy jitter → poor, with a delay between 100 and 200 ms;
* 50 % lost pings → critical;
* 2 s of silence → critical;
* repeated corrections → degraded;
* the delay eases rather than jumps.

## Server-side back-off for a congested client

The server already dropped a stale snapshot when a client's socket had more than 64 KB queued; events are never
dropped. Now it also backs off (`server/arena/match.mjs`, `SNAP_DIV_MAX`):

* each dropped snapshot halves that client's snapshot rate, down to one in three (20 Hz → about 6.7 Hz);
* every three congestion-free seconds it steps back up;
* every other client keeps the full rate;
* the 60 Hz simulation, the positions hit registration rewinds against (recorded every snapshot, whoever it is sent
  to) and all events are unchanged.

On the client, the longer snapshot spacing raises the interpolation delay automatically (above). `sendRaw` in
`server/arena/service.mjs` now reports `sent`, `dropped` or `closed`.

`tests/net-backoff.test.mjs`: a two-player match where one client is congested. That client is sent about a third of
the snapshots while the other keeps all of them, and both are back to full rate after the congestion clears. The
existing end-to-end test over a real socket (`tests/arena-match.test.mjs`) covers 250 ms latency, up to 120 ms jitter
and one lost command batch in five, with exact reconciliation.

## Not done in this pass
* No binary or delta snapshot protocol.
* No kernel-level shaped network (tc/netem) test with browser clients: the container does not allow it.
* No bandwidth measurement in bytes per second.
