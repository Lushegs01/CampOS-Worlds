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

## Not done in this pass

* No server-side adaptation: snapshot rate and content per client are unchanged.
* No binary or delta snapshot protocol.
* No end-to-end test under shaped network conditions (tc/netem latency, loss and bandwidth) with real clients.
* No bandwidth measurement in bytes per second.
