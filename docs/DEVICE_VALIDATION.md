# Device validation

**No physical device has been tested in any pass so far.** Every capture in this repository comes from Chromium's
software WebGL (SwiftShader) in a build container. Frame rates from it are not measurements of any phone or GPU and
are not reported as such.

| Claim | Status |
|---|---|
| Stable 30 fps on low-end Android (itel S24 class) | **Not measured** |
| Stable 60 fps on desktop | **Not measured** |
| Low profile clarity floor holds under load | Logic tested (`tests/graphics-clarity.test.mjs`); appearance on a phone **not seen** |
| Memory and texture budgets | Counted in software captures ([MOBILE-PERFORMANCE.md](MOBILE-PERFORMANCE.md)) |
| Long-session stability | Browser soak test exists (`tests/browser-soak.mjs`); not run on a phone |
| Battery and thermals | **Not measured** |
| Audio on headphones and phone speakers | **Not listened to** |

## How to measure on a phone

1. Open the arena on the phone, with Settings → Show frame rate on.
2. Pick Low, play a Metropolis training match for 10 minutes, and note the frame rate.
3. Note whether the "Graphics lowered" banner appears.
4. Repeat on Medium.

Chrome's remote debugging (`chrome://inspect`) gives the frame-time distribution in the Performance panel. Record the
phone model, browser version, profile, median and 95th-percentile frame time, and any thermal throttling here.

## Found in this container that also applies to slow phones

Model and texture decoding had no priority order: every downloaded file went straight into the shared decoder worker
pool. A fixed 45 s limit, counted from the download rather than from the start of decoding, then decided what
survived. On a slow device:

* background soldiers and props timed out repeatedly, and soldiers were abandoned after four retries (other players
  stayed stand-in figures, and the first-person body never appeared);
* raising that limit alone made it worse: background decodes then held the pool and the deployment stalled.

Now decodes are queued by priority like downloads (`src/world/decodeQueue.ts`, `tests/decode-queue.test.mjs`):

* files the player is waiting for go first;
* at most two decode at once;
* the time limit (45 s for what the player waits for, 120 s for background files) counts only from when a decode
  starts;
* soldiers retry for the whole match.
