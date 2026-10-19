# Economic Simulation Lab — implementation and validation record

Date: 19 October 2026. See [the technical report and demonstration guide](ECONOMIC-LAB.md).

## Results actually obtained

| Check | Result |
| --- | --- |
| Clean original repository, `npm test` | **141 passed, 0 failed**, 68.05 seconds |
| Original `npm run build` | Passed; existing Three.js chunk-size warning |
| Final implementation, `npm test` | **159 passed, 0 failed**, 66.17 seconds |
| Final `npm run build` (`tsc -b && vite build`) | Passed; Vite build 5.76 seconds; same Three.js size warning |
| Dedicated economy model/service tests | **14 passed**: accounting, verification, AI, clocks, experiments, authorization, persistence, retries, identity changes and adapter/export behavior |
| Building tests | **2 passed**: registration/placement, real door rules, collision flood-fill to all six stations, entrance and exit |
| Room protocol test | Passed: remote/malformed/privileged requests refused, real agent request settled, ordinary chat and health preserved |
| Hosting privacy test | Passed: default/custom records, temporary snapshots and secret-file fixtures denied through normal and `/@fs/` URLs; campus index served |
| Original `browser-smoke.mjs` | Passed: welcome, avatar editor, entry, walking, settings, 390px phone layout; no browser errors |
| `browser-economic-lab.mjs` | **10 checks passed**, no browser errors; actual in-world human and agent workflow, six stations, exports, exit and touch interaction |
| Production bundle in Chromium | Passed: campus renders, enters multiplayer, no runtime errors, development QA hooks absent |
| Running development server after restart | Passed: private-data HTTP probe returns 403, campus returns 200, room health succeeds |
| Downloaded browser evidence | Three runs satisfy accounting invariants; **all 15 submission evidence digests validate** |
| `git diff --check` | Passed |

The baseline was reproduced from an untouched `git archive HEAD` in `/tmp/campos-original`, using the existing installed dependencies. An initial execution with local networking restricted produced a Node runtime assertion/socket failures. With local networking enabled, the clean original suite passed all 141 tests. No pre-existing application test failure remains in the established baseline. Tests use the repository's embedded PostgreSQL and local Supabase stand-in where appropriate.

During implementation, verification caught and corrected a missing database location-catalogue entry, an import initialization-order error, an inaccessible select label, a repeated-agent clock edge case, queued identity changes, and development-server data-file exposure. Those are addressed in the delivered code and regression checks. Historical screenshots from unrelated features were preserved; newly captured smoke evidence is in the lab's `regression/` directory.

## Commands

```sh
npm test
npm run build
node tests/economy.test.mjs
node tests/economic-lab-world.test.mjs
node --test tests/economy-room.test.mjs
node --test tests/economy-hosting.test.mjs

# With npm run dev running; override the browser path for your machine.
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/browser-smoke.mjs

# Starts its own isolated room and Vite server on port 5181; no external account/API required.
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/browser-economic-lab.mjs
```

Browser tests use genuine Chromium/WebGL, the repository's development steering hook and the ordinary movement/input pipeline. The desktop lab tester walks from spawn, opens the authoritative door, visits all six stations, deliberately submits incomplete work, physically collects at Lab Stores and delivers at Welcome Pavilion, returns to submit, reviews evidence, authorizes the deterministic worker, compares policies and downloads both exports. No economic acceptance, inventory, balance or recognition result is injected by the browser test.

The phone test uses a 390 × 844 viewport with touch. Its player is placed server-side on the lab approach to avoid repeating the long campus walk, then walks through the entrance and uses the actual touch interaction at Research and Results. Its comparison controls work and the page/dialog have no horizontal overflow. The collision suite independently flood-fills the actual shared collision space to every station and verifies the closed/open door and exit path.

The standalone production check served the built `dist` bundle with Vite preview against its own room, entered through the real UI and verified both connection and absence of `__campusDebug`. It did not enable QA mode in the production build.

## Requirement coverage

| Required area | Evidence |
| --- | --- |
| 1–3: Building registration, placement, navigation, entrance/exit, interior collision, station reachability and handlers | Shared world tests plus desktop browser walk through all stations and back to campus |
| 4, 19: Existing gameplay and isolation | All 141 original tests retained and passing, original browser smoke passing; room chat/health work after lab operations; no mandatory lab start or global economy polling |
| 5–8: Scenario/reset, orders, assignment/completion, human and AI | Model/service tests plus the real human pickup/delivery and bounded AI browser workflow |
| 9–12: Verification, invalid/fabricated/duplicate work, inventory/balances, recognition | Per-attempt checks, revision and exhausted/late rejection, persisted operation keys, concurrent orders, accounting invariants and browser evidence/ledger inspection |
| 13–14: Accurate, repeatable metrics | Equal seeded initial conditions and demand; independently repeated comparisons produce identical metrics; all metrics calculated from recorded work and settlement |
| 15: Valid evidence/report export | JSON schema/contents tested, browser downloads saved, downloaded run invariants and all evidence hashes rechecked |
| 16–17: Persistence, authorization, recovery/retries | Atomic file/restart/corruption/write-failure tests, principal/station/proximity/stale-run checks, queued identity-change rejection and same-key retry/replay tests; private data denied by hosting |
| 18: Mobile usability | Original phone smoke and lab touch interaction/comparison at 390px, without horizontal page or dialog overflow |
| 20: Honest WorkStream adapter | Typed adapter validates the local evidence format, sends nothing externally and returns `not-connected`/null external record; browser displays that distinction |

## Recorded experiment, seed 42

The downloaded evidence contains a live run with **one accepted human delivery, one accepted agent delivery and one failed/revised submission**. It records 40 simulation units in gross revenue, 12 in expenses, two consumed packs and 20 separate recognition units, split 10/10 between the human principal and agent. These are simulation records, not real customer revenue or payable compensation.

The same export includes two completed model experiments with equivalent initial inventory/balances and the same six seeded orders:

| Metric | Fixed campus circuit | Demand-aware dispatch |
| --- | --- | --- |
| Completed / created | 6 / 6 | 6 / 6 |
| Resource packs consumed | 9 | 9 |
| Simulated revenue | 180 | 180 |
| Simulated operating expenses | 53 | 42 |
| Cost per completed order | 8.83 | 7.00 |
| Mean modeled pickup-to-delivery time | 30.32 seconds | 22.80 seconds |
| Active modeled duration | 181.92 seconds | 136.77 seconds |
| Local recognition units | 60 | 60 |

The policy differences follow the authored route and dispatch assumptions in the technical report. These results are reproducible simulation outputs; they do not establish real-world savings, independent validation or official research findings. Live run duration can differ between separately timed JSON and Markdown exports; each is a snapshot at its own export time.

## Artifacts

- [Browser check results](screenshots/economic-lab/results.json)
- [Downloaded versioned JSON evidence](screenshots/economic-lab/evidence.json)
- [Downloaded readable experiment report](screenshots/economic-lab/report.md)
- [Exterior and entrance](screenshots/economic-lab/exterior.png)
- [Task requirements and revision](screenshots/economic-lab/tasks.png)
- [Agent operations](screenshots/economic-lab/agent.png)
- [Evidence and checks](screenshots/economic-lab/evidence.png)
- [Research and exports](screenshots/economic-lab/research.png)
- [Phone workstation](screenshots/economic-lab/mobile.png)
- [Fresh original-game smoke results](screenshots/economic-lab/regression/smoke-results.json)
- [Command transcripts](screenshots/economic-lab/validation/)

## Limits and remaining external dependencies

- Persistence is a bounded, single-writer server file store. Deployments must preserve its volume and backups. Multi-process/multi-room shared storage and a production retention/archive service are not implemented. Private workspaces do not provide cross-principal cooperative task assignment.
- The deterministic worker models logistics on the server. It does not physically navigate as an autonomous avatar. Human work validates actual pickup/drop-off locations and event sequence; human operating expense is a documented modeled route charge, not measured travel/fuel cost.
- Restart recovery pauses running scenarios and restores the last persisted active-time checkpoint. Offline travel and unpersisted wall time are not reconstructed. Unsubmitted overdue tasks remain pending until submission or run closure.
- WorkStream authentication, official acceptance/contribution writes, independent partner validation and funded rewards are **not connected**; no verified external contract was available. The typed local adapter and structured evidence are the implemented extension boundary.
- Mobile verification is browser emulation, not physical-phone profiling. Software WebGL was slow in this execution environment; its FPS is not a physical-device performance claim. New geometry uses the existing material batches and a small fixed fixture set, and the workstation UI is loaded as an 18.14 kB JavaScript chunk (5.58 kB gzip). No autonomous navigation/refactor, recurring lab network polling or new large model assets were added.
- Existing repository follow-ups such as production institutional authentication, multi-room scaling, voice chat and full interiors for unrelated buildings remain outside this feature. Passing the original suite and smoke workflow establishes the tested non-regression scope; it does not claim every external production service or device was exercised.
