# CampOS Worlds — release assessment

Assessment date: 23 October 2026. Repository: `Lushegs01/CampOS-Worlds`.
Base commit: `4516f8802829f64907354d0f836aee291131eb36`.
Candidate branch: `codex/production-launch-readiness`.

CampOS Worlds is a playable browser-based 3D social campus game. Its fictional Òrìṣun
Campus combines exploration, avatars, multiplayer presence, social activities, vehicles,
basketball, personal rooms and an optional economic simulation lab. React and Three.js
render the client; a persistent Node/WebSocket room validates consequential shared actions.
Optional Supabase accounts store profiles and community records, and optional Bachs checkout
supports the campus store. Some campus services and classroom content are labelled demos.
Institutional Core authentication and large-scale multi-room operation remain future work.

## 1. Work completed

The initial checkout was clean. The repository and remote main commit were checked before
editing. The baseline build and all 196 existing Node tests passed with local networking
enabled. The existing scene, assets, mechanics and architecture were preserved.

| Area | Changes and purpose |
| --- | --- |
| PWA | `vite.config.ts`, `src/sw.ts`, `src/pwa/`, `src/main.tsx`: manifest, install UI, explicit update handshake, bounded shell caching and truthful offline recovery. |
| Branding | `index.html`, `public/icons/`, `public/brand/`, `scripts/assets/build-brand.mjs`: logo-derived application icons and a dedicated social image with initial-HTML sharing tags. |
| Loading failures | `src/App.tsx`: scene and optional-panel error boundaries, slow/offline loading feedback and low-quality reload. Failed downloads no longer leave only an indefinite loading screen. |
| Account identity | `src/account/store.ts`, `server/room.mjs`: reject stale profile/token results after sign-out or account changes; clear the old identity while loading a replacement; restore a valid guest across tabs, expired sessions, reloads and denied/corrupt storage. Room sign-out revokes identity even after the token-verification budget is exhausted. |
| Initialization | `src/network/messages.ts` and feature subscribers: move the message bus into an independent module, fixing an actual circular-import initialization exception. |
| Service recovery | `src/services/fetch.mjs`, `community.ts`, `network/client.ts`: bounded cancellable private requests, no-store API fetches, retryable SDK initialization and usable feedback for an invalid socket configuration. |
| Security | `public/_headers`, external `shop-return.js`, production telemetry guard, `server/shop.mjs`: browser headers, no inline checkout script, no production QA scene exposure, strict paid-status and finite nonnegative amount validation. |
| Release checks | `.github/workflows/quality.yml`, new browser/artifact/account tests and scripts: reproducible checks, CI and retained evidence. Several existing socket tests now wait for acknowledgements or observed state instead of timing assumptions. |

No new credentials were added. Public build configuration remains separate from server-only
service-role, webhook and administration secrets. Existing database role checks, RLS,
server-side movement/interaction validation, origin gates and message budgets were retained
and exercised by the test suite. This assessment covers the repository and local stack;
hosted service policies and production secret configuration were unavailable for inspection.

The shipped CSP deliberately permits `unsafe-eval` and `wasm-unsafe-eval` for the current
Basis/Embind decoder's generated bindings. A production browser run demonstrated that a
stricter policy breaks texture loading. Blob texture fetches and data fonts also need their
explicit source allowances. Inline JavaScript remains forbidden. See [PWA.md](PWA.md).

## 2. Gameplay verification

| System | Evidence from this assessment | Status and limits |
| --- | --- | --- |
| Entry, world/assets, map | Unmodified production bundle in Chromium; enter, connect, open/close map; normal-flow console/request audit. | Browser verified in this environment. |
| Keyboard/touch movement | Actual input dispatched to the production page; displacement checked against the authoritative room. Portrait and landscape layouts checked for overflow. | Desktop and emulated phone viewport verified; physical phone handling unverified. |
| Collision, buildings, doors, seats | Shared physics and real WebSocket tests: accessible entrances, wall/door sweeps, reachable seats, contention and safe standing. | Automated rules/network verification; a full visual walk-through of every building was not completed. |
| Vehicles | Fleet, driving, prediction, passengers, collisions, safe exits, disconnect braking and real multi-client WebSocket tests. | Automated rules/network verification; full driving UI journey was not repeated in this environment. |
| Basketball and Court Duels | Ball physics, scoring, ownership, disconnect cleanup, match and database progression tests. | Automated rules/network verification. |
| Classes and challenges | Shared demo host/vote permissions, ordered checkpoints, timing rules, driving challenges and saved results. | Automated rules/network verification. Classroom content remains a demo. |
| Profiles and sessions | Browser SDK + PostgreSQL + room: seven account recovery cases, including delayed responses after sign-out and a genuine cross-tab account switch. | Recovery verified. The separate full two-campus account UI suite timed out under software rendering and did not pass here. |
| Friends, parties, messages, clubs/events | Real database/RLS and room tests for friendship, privacy, blocking, messages, invitations, RSVP/check-in and badges. | Automated rules/network verification; all multi-campus browser UI scripts were not rerun. |
| Personal rooms | Account/session layout persistence, furniture validation/collision, invitations, visitors, privacy and reconnect tests. | Automated rules/network verification. One intermittent persistence-test timeout is disclosed below. |
| Economic lab | Existing scenario, worker, persistence, authority, privacy, reproducibility and hosting tests. | Automated rules/network verification; WorkStream remains unconnected. |
| Network and rendering recovery | Reconnect/session tests; production offline navigation/reconnect, essential-texture failure, optional-panel failure and WebGL context-loss checks. | See current production browser evidence in `release/browser.json`. |

The Node suite contains 198 passing tests. This is coverage of implemented systems, not a
claim that every visual interaction or every hardware/browser combination was exercised.
Guest progress remains device-local; account progress is server-backed where configured.
No gameplay features were removed or disabled by this candidate.

## 3. PWA implementation

- Manifest: CampOS Worlds, standalone display, origin-relative `/` id/start/scope,
  green theme/background and valid PNG icon declarations.
- Icons: 192 and 512 pixels, opaque padded 512 maskable icon, 180 Apple touch icon and
  favicon variants, derived from the repository's existing gold three-bar CampOS mark.
- Worker: maintained Workbox injectManifest implementation. This build has 30 precache
  entries totalling 2,405,411 bytes (about 2.3 MiB). The roughly 34 MB world asset library,
  API responses, accounts, payments and multiplayer state are excluded. No runtime data
  caching routes were added.
- Updates: a waiting worker is offered in Settings. It activates and reloads only after
  the user selects **Reload and update**; a controller-change handshake prevents a silent
  failed update. Other tabs receive an update notice. Worker/manifest responses revalidate.
- Offline: a branded cached recovery page explains the connection requirement. Refresh
  and reconnect are tested. Already-loaded local areas may remain usable, but offline
  startup does not claim an available multiplayer world or account service.
- Installation: a real persistent Chromium profile reports a valid manifest and zero
  installability errors. The local Chromium 154 build disables native installation
  (`kWebAppDisabled`). On the GitHub Actions Ubuntu runner, Chrome for Testing 145
  successfully installed the app through CDP and launched its native window with
  `(display-mode: standalone)` verified. Manual install prompts, launch from a physical
  home-screen icon and Safari/iOS installation remain unverified. Safari instructions are
  implemented, and browser install UI is offered only when supported.

## 4. Link preview branding

Configured expected production site: <https://camposworlds.click/>.

Configured Open Graph and Twitter image:
<https://camposworlds.click/brand/campos-worlds-social.png>.

The dedicated 1200 × 630 PNG combines the existing CampOS mark with its wordmark, brand
colours and current tagline. It was visually inspected. The local production host serves
the image with HTTP 200 and `image/png`; dimensions, icons, canonical URL and one consistent
set of sharing tags are checked in the built initial HTML. Asset generation is reproducible.

The domain is the owner's supplied expected origin, configurable through build-only
`SITE_URL`. Its live ownership, current deployment and public responses could not be
verified: this environment's outbound proxy rejects access with CONNECT 403. That is an
environment access limit, not evidence that the site itself is down. No external social
platform rendering or cache refresh was confirmed. After deployment, inspect the public
HTML/image and use Meta Sharing Debugger or LinkedIn Post Inspector as described in [PWA.md](PWA.md).

## 5. Build and test results

Environment: Linux container, Node 24.19.0, npm 11.9.0, Chromium 154.0.8037.57,
PostgreSQL 17. Browser checks use SwiftShader without a physical GPU. Production world
checks use Low quality and DPR 0.25 to keep software rendering responsive; source QA
hooks are absent from the compiled game. These settings establish behaviour, not phone FPS.

The full [GitHub Actions run](https://github.com/Lushegs01/CampOS-Worlds/actions/runs/39974303436)
also passed on hosted Ubuntu with Node 24.21.0, npm 11.19.0 and Chrome for Testing 145.0.7632.6.
It verified native PWA installation and a standalone app window, in addition to the local
coverage below. Its 11 production browser checks reported zero unexpected errors or failed
requests. The native install uses CDP; manual installation/home-screen-icon tests remain open.

| Exact command | Outcome |
| --- | --- |
| `npm --cache /tmp/campos-npm-cache --prefix /tmp/campos-release-install ci` | Passed using an isolated copy of the exact package.json and lockfile; 464 packages installed. |
| `npm run typecheck` | Passed. |
| `npm test` | Final run passed: 198 tests, zero failures/skips/cancellations. |
| `node --test --test-timeout=60000 tests/dorm-accounts.test.mjs` | Passed: 3/3 targeted persistence/permissions tests after an intermittent full-run timeout. |
| `npm run build` | Passed, including TypeScript and the injected service worker. |
| `npm run verify:release` | Passed: metadata, image/icon dimensions, opacity, cache budget and absence of production QA hooks. |
| `node tests/browser-account-recovery.mjs` | Passed: 7/7 real browser account recovery cases, zero page errors. |
| `npm run test:release` | Passed: 10 local production browser checks; 11 in CI including native installation and standalone launch. Zero unexpected normal-flow console/page errors or failed requests in both runs. |
| CI: `npm ci`, `npm audit --audit-level=high`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:release`, `npx playwright install chromium`, `node tests/browser-account-recovery.mjs`, `npm run test:release` | All passed in the linked full workflow run. |
| `npm --cache /tmp/campos-npm-cache audit --json` | Passed: zero known vulnerabilities at assessment time. |
| `node --check <each changed/new JS or MJS module>` | Passed for 18 modules. |
| `git diff --check` | Passed. |
| `node tests/browser-accounts.mjs` | Attempted; did not complete successfully. Two software-rendered campuses made browser actions time out. The focused recovery suite above provides account race coverage. |
| Lint | No lint script/configuration exists in the repository. A lint pass is not claimed. |

Evidence: [unit tests](release/unit-tests.txt), [build](release/build.txt),
[typecheck](release/typecheck.txt), [clean install](release/clean-install.txt),
[dependency audit](release/dependency-audit.json), [artifacts](release/artifacts.json),
[local production browser](release/browser.json), [account recovery](release/account-recovery.json),
[CI summary](release/ci.json) and [CI production browser](release/ci-browser.json).
Production desktop, phone-viewport, offline and [standalone app](release/ci-installed.png)
screenshots are in the same directory. A focused inline `node --input-type=module` browser
probe also passed five consecutive offline navigations during an actual host socket outage,
retained the controlling worker and logo, and restored HTTP 200 after reconnecting;
[its record](release/offline-focused.json) isolates the recovery shell from 3D rendering.

Earlier CI attempts exposed automation differences in native tab/page target identities and
page-level offline emulation. The final test matches the native app window and interrupts
the host to affect worker requests too. One CI system-package installation stalled; the
successful workflow uses a bounded browser-only install on the hosted Ubuntu runtime.

Warnings retained: the Three.js chunk is 1,041.42 kB minified / 290.69 kB gzip, slightly
above the existing 1,000 kB warning threshold. The renderer is already separately loaded;
the threshold was not raised to hide it. Some existing development/asset-tool dependencies
emit deprecation notices during installation. Audit reports zero known vulnerabilities;
those notices do not establish that all dependencies are actively maintained.

## 6. Deployment status

**Undeployed.** No production service, DNS, configuration or data was changed. No usable
existing hosting deployment credential/workflow was available here. The checked candidate
is prepared for the project's existing static frontend and persistent room architecture.

Remaining release steps, using the existing supported workflow:

1. Build the candidate with the existing production `VITE_WS_URL` and optional Supabase
   public settings. Set `SITE_URL` only to the confirmed HTTPS production origin.
2. Publish the entire `dist/`, preserving the headers, worker, manifest, icons, brand image
   and offline files. Apply equivalent headers if a custom Worker/server bypasses `_headers`.
   Missing assets must return a real 404, and `sw.js` must revalidate.
3. Deploy the changed room-side shop validation and sign-out handling through the current room workflow. Preserve
   its existing origins, secrets and persistent volumes; no migration is introduced here.
4. On the actual HTTPS site, verify entry, room connection, configured accounts, manifest,
   worker update, public image/metadata, payment return and native install/standalone launch.
5. Complete the physical-device, hosted-service and load/operations gates below before a
   worldwide release claim. Deployment instructions are in [DEPLOYMENT.md](DEPLOYMENT.md).

## 7. Remaining issues

**Release gates still open:** live HTTPS/domain and deployment verification; physical
installation/home-screen launch, Safari/iOS and ordinary-phone checks; hosted
Supabase policies/session delivery and live Bachs confirmation; measured capacity, latency
and operational monitoring for the intended public population. None can be established
from a local software-rendered browser or a configured 48-player ceiling.

The current backend remains one in-memory room. It has no worldwide matchmaking or
cross-process presence. Guest moderation removal can be bypassed with a fresh browser
session; durable account bans and staffed report handling remain operational/product work.
Institutional authentication is unavailable. Do not raise room limits or promise global
capacity on the basis of these functional tests.

**Lower-priority follow-up:** the large renderer chunk, deprecated build-tool transitives,
decoder CSP exception, full two-campus UI regression coverage on a GPU machine and device
thermal/memory/soak profiling. One full run returned 197/198 because a dorm account test
timed out; its isolated run and subsequent full run passed. Timeout diagnostics were
improved, but the intermittent failure was not conclusively reproduced or attributed to
a product defect. Track it rather than treating one green rerun as proof it cannot recur.

## 8. Final launch recommendation

**NOT READY for an unconditional worldwide production launch today.**

The local candidate substantially improves release readiness and passes the implemented
build, data/authority and recovery checks. No known critical runtime error remains in the
tested normal flows. However, mandatory live-site and representative-device
checks remain open, and global capacity/moderation readiness has not been established.
Those are release gates, so this report does not label worldwide launch as verified.
The candidate is ready for deployment review and completion of those specific checks.
