# Economic Simulation Lab

CampOS Worlds gains an optional, enterable research building. The original campus, spawn, tour, vehicles, multiplayer, accounts, social systems, dorm rooms, basketball and progression remain the main game. No economy runs until a player chooses to start one or runs a research comparison.

## Visit and demonstrate

```sh
npm install
npm run dev
```

Use the campus map to select **Economic Simulation Lab**. From the avenue walk west along the shuttle walk to **(-57, 36.5)**, then north along the new path to **(-57, 29)**. Press **E**, or touch **Interact**, to open the glass doors. Walk inside; this is the same scene and identity, with no entrance teleport. Close panels before walking. Exit through the same door.

The single-storey hall occupies **x -64 to -46, z 17 to 27**, south of the playing field and north of the shuttle walk. It avoids existing buildings, sports surfaces, roads, tree trunks and landmarks. Its bronze-framed entrance, stucco, terrazzo, timber desks, shaded canopy and lettering use the existing procedural material/geometry kit. Geometry is merged with campus material batches; no new asset downloads or paid services are required. Shared wall/desk/kiosk colliders and the existing authoritative door system serve both server and client. There is a clear interior aisle and orientation board, six individually reachable desks, ceiling lights, map footprint and a registered location.

| Station | Interaction point | Working functions |
| --- | --- | --- |
| A: Simulation Control | -61, 19.8 | Rules, starting conditions, policy/seed, seeded or empty start, pause/resume, finish, explicit reset |
| B: Market Operations | -55, 19.8 | Businesses, stock/reservations, balances, receiver/quantity order creation, transactions |
| C: Tasks and Logistics | -49, 19.8 | Inspect versioned requirements, claim/release, route destination, submission/revision and task state |
| D: AI Agent Operations | -61, 24 | Identity, responsible principal, allowed/denied capabilities, task-specific execution, route/decision trace and outcome |
| E: Verification and Evidence | -49, 24 | Per-attempt checks/failure reasons, evidence JSON and SHA-256, acceptance and contribution ledger |
| F: Research and Results | -49, 26.4 | Equivalent-seed comparisons, measured metrics, run archive, JSON/Markdown downloads, external adapter status |

Example human workflow:

1. At A, uncheck seeded orders and start a scenario.
2. At B, create a one-pack order for Welcome Pavilion. Stock is reserved; no payment occurs yet.
3. At C, expand requirements, claim the task and choose **Find pickup**.
4. Leave the building and visit **Lab Stores (-57, 31.5)**. Use the contextual **Collect reserved packs** prompt.
5. Walk along the shuttle walk and campus paths to **Welcome Pavilion (-12, 25)**. Use **Deliver reserved packs**. A delivery reminder appears only while you voluntarily hold lab work.
6. Return to C and submit. The server verifies its own recorded interactions, accepts valid work, consumes stock, settles balanced transfers and awards local recognition atomically.
7. Inspect E and F. An incomplete submission produces explicit failure reasons and can be revised within the rules.

For an agent demonstration, seed orders at A, then use D to authorize one feasible task. Each command executes at most one task. At F, **Run policy comparison** generates two actual, archived experimental runs and does not replace the active live run. Exports include live and archived work, including failed attempts.

## Model and trust boundary

Scenario `campus-logistics/1`, acceptance criteria `delivery/1`:

- Initial stock: 12 resource packs. Customer balance: 2,000 simulation units; business balance: 500; logistics balance: 0. Total: 2,500.
- Virtual businesses are Lab Stores (supplier, business account) and Campus Dispatch (delivery service provider, logistics account), based at the lab dispatch point. These are configured simulation entities, not real merchants.
- Four named simulation receivers are explicitly mapped to the Learning Commons forecourt, Student House exterior, Welcome Pavilion and Courts west gate. These do not convert unrelated game props into actual economic businesses.
- An order requests 1–3 packs and reserves unreserved inventory. At most 12 orders per run. Each order creates one versioned task, with origin, destination, quantity, eligible worker types, timestamps, assignment, inputs, outputs and criteria.
- Delivery price: 20 simulation units per pack. Operating expense: `1 + ceil(authored route metres / 20)`. It is a documented modeled route expense for human work too; it is not a measurement of a human's walked distance or fuel use.
- On acceptance, customer balance decreases by gross price; business increases by gross minus operating expense; logistics increases by operating expense. Double-entry transfers sum to zero. Stock is consumed once. Pending orders are reservations, not revenue.
- Deadline: 600 active scenario seconds from creation. Pause freezes work and the live clock; it is owner-controlled. The model clock also advances for modeled agent transit. Failed pickup/drop-off requests produce no delivery event. Late submissions fail; unsubmitted overdue work remains pending until submitted or the run is closed. Closing/resetting cancels remaining work and releases reservations.
- States: available → claimed → in_progress → submitted → verified → accepted. Failed verification returns revision (at most three submissions total), or rejection when late/exhausted. All transitions and settlement are server code. `verified` is a recorded transition immediately followed by the separate local acceptance policy inside the same atomic transaction.
- Checks cover assignment/principal, reservation and stock, pickup origin/quantity, delivery destination/quantity, authoritative event order, deadline, funds and prior settlement. The client cannot supply its own successful proof, alter rules, accept work or write the ledger.
- Every attempt preserves scenario/run/task/rule identity, principal, worker, initial/input conditions, submitted output, authoritative events, measurements, individual checks/reasons, timestamps, verifier identity and a SHA-256 digest. The digest detects accidental modification; it is not an externally signed attestation.
- Recognition rule `local-recognition/1`: 10 recognition units per accepted delivery, zero for rejected work. Each contribution links to the exact accepted evidence and digest. Recognition never changes business balances. No money, cryptocurrency, naira conversion, compensation obligation, redemption, official Flow Research points or funded reward is implemented.

Consequential requests are handled over the existing authenticated/guest room WebSocket. The room resolves identity from the verified account or session token. Workspaces are private to a principal; another player cannot operate or reset them. Guests retain records only while retaining their session token. No raw session token or profile name is written to the economic store; principal IDs are hashes. This milestone does not provide cooperative, cross-principal task assignment.

Every station action checks the named station, permitted action, authoritative on-foot position and collision-aware reachability inside the hall. Pickup/delivery instead check the task's actual configured campus site. Vehicle passengers, seated/airborne players and players in private dorm spaces cannot operate fixtures. Request types, strings, choices, amounts, note sizes, run identity and operation keys are validated. The existing room size/origin gates and message rate limits apply; lab traffic also has a 12-request/10-second limit per client. Unrelated players receive no economy snapshots or periodic lab polling.

## Deterministic worker and experiments

`dispatch-v1` is a rule-based worker owned by the workspace principal. It can read eligible tasks, select a feasible task, claim, model pickup/transit/drop-off and submit. Authorization is scoped to one selected task or the next feasible one per command, with a four-action execution budget. Its capabilities never include inventory creation, balance writes, permission changes, self-verification, acceptance or recognition awards.

It is **server-side logistics execution**, not a character navigating the 3D campus. A trace records candidate count, decision, route points/distance/time/cost, principal and task; its submission goes through the same verifier and acceptance policy as human work. There is no external AI API. Future workers can use the same bounded action/verification boundary.

Comparisons generate six seeded orders with the same starting inventory, balances, rules and ordered demand in both runs. A 32-bit LCG makes quantities repeatable. `fixed` uses creation-order dispatch and an authored main-avenue circuit. `demand-aware` selects the shortest feasible task and direct pedestrian route. Both use 5 modeled metres/second, two handling seconds and one sequential worker, with no traffic or stochastic travel delay. Metrics come from recorded orders, attempts, transactions, resource events and contributions; empty denominators display insufficient evidence.

Metrics include completed/created denominator, pending/rejected/cancelled counts, mean pickup-to-drop-off duration, cost per completion, revenue/expenses, consumed stock, stockouts, resource utilization, acceptance/failure/revision rates per submission, human/agent accepted participation, active duration, outcome and recognition distribution. Each experiment records its mode, seed, assumptions, scenario version and run IDs. Equivalent experiments reproduce the same metrics. Efficiency and recognition distribution are exposed without claiming real-world savings or a universally superior policy.

## Persistence and recovery

`server/index.mjs` sets `LAB_DATA_FILE`, default **server/data/economic-lab.json**. The server serializes economic requests, clones the affected workspace, applies the entire operation, checks accounting invariants, writes a mode-0600 temporary snapshot, syncs it and atomically renames it before publishing success. Failure rolls back all effects, including replay records. All accepted economic effects and recognition live in this one transaction. Store digests are checked on startup. Corruption disables only lab operations, leaving the campus playable; the operator restores a valid backup instead of silently erasing history.

Persisted operation keys return the prior outcome for identical retries and reject key reuse with a different payload. Terminal-state checks and unique settlement/contribution IDs prevent repeated payment even after the bounded replay cache evicts an old key. The UI offers the same-key retry after a timed-out or failed save. A stale run ID cannot mutate a reset scenario. On reconnect, reopen a workstation to refresh authoritative state before acting.

Running live scenarios resume **paused** after a server restart. Active wall time is checkpointed at each persisted mutation; time since that last checkpoint, downtime and offline movement are not reconstructed. Reopen A to resume. Reset preserves prior run records and creates a new ID; it does not reset the player's identity or unrelated game state.

This is a bounded, **single room-server writer** file store. Keep its data volume persistent, restrict operator access, and back it up. Do not share the same file among multiple processes. Budgets per principal: 100 archived runs, 20 comparisons, 12 orders per run, three attempts per task, 256 replay keys; the store admits at most 500 principals. Capacity errors preserve historical records and ask for operator action. Production multi-room scaling should replace this boundary with transactional database storage and an explicit retention/migration policy. Do not put this JSON file in frontend assets or expose it over HTTP. Vite development hosting explicitly denies the room data directory, configured lab file and temporary snapshots, while preserving its default secret-file denials. Production serves the built frontend only.

Direct `createRoom()` tests default to an explicitly labelled memory store, which resets with that room process. No localStorage value is authoritative for the economy. Supabase migration **20261019120000_economic_lab_location.sql** registers the lab through the existing location/RLS conventions so discovery, events and account progress remain compatible. No economy privilege is granted to client database roles.

## WorkStream / external evaluation

No authorized WorkStream documentation, endpoint or authentication contract was found in this repository. `server/economy/adapter.mjs` declares a typed adapter boundary and a local-only implementation. It sends nothing outside the game and returns `not-connected`, `externalRecord: null`. JSON evidence (`campos.economic-lab/1`) and the readable report carry runs, assumptions, policy comparisons, failures, verification references, metrics, contribution rules/allocation and limitations. An external evaluator can consume these artifacts; an authorized production integration must define its own authentication, delivery/idempotency, acceptance and receipt contract before implementation.

Simulation events, rule verification, local acceptance, independent external validation and funded payable rewards remain distinct fields/facts. Adapter success never creates official WorkStream acceptance or a contribution in an external system.

## Changed modules

- `shared/economic-lab.mjs`: shared building/fixtures, sites, scenario, policies and agent contract.
- `shared/campus.mjs`, `shared/interactions.mjs`: location, collision and door registration.
- `src/world/architecture/economicLab.ts`, `buildings.ts`, `layout.ts`: batched architecture, signage, props, lighting, footprint, path and floor height.
- `server/economy/model.mjs`: closed economy, lifecycle, trusted verification/acceptance, recognition, metrics and reproducible experiments.
- `server/economy/service.mjs`: private workspaces, proximity/action authorization, serial atomic storage, retries, exports and reporting.
- `server/economy/adapter.mjs`: honest local-only typed external integration boundary.
- `server/room.mjs`, `server/index.mjs`, `.env.example`, `vite.config.ts`: bounded room-message handler, configured persistence and private-data hosting denial.
- `src/economy/`: typed view models, room client, contextual prompt registration, six workstation panels and opt-in delivery reminder.
- `src/App.tsx`, `src/ui/Panels.tsx`, `Locations.tsx`, `CampusMap.tsx`, `src/styles.css`: existing UI integration, map and scoped responsive styling.
- `tests/economy*.test.mjs`, `tests/economic-lab-world.test.mjs`, `tests/browser-economic-lab.mjs`: economy, persistence, authorization, room protocol, physical reachability and browser workflows.

## Verification

See [ECONOMIC-LAB-VALIDATION.md](ECONOMIC-LAB-VALIDATION.md) for commands, measured results, screenshots and limitations. Existing systems are preserved in code and exercised by the original suite; that does not establish production institutional authentication or physical-device performance that the existing project itself does not provide.
