# Movement and reliability audit — 20 October 2026

The reported backward jumps were reproducible. The former client compared each server position with a 1.5 second local position trail. Once a valid delayed update fell outside that trail, the client treated latency as drift and snapped backward. Integrating inputs from their arrival time on the server also made client and server disagree when delivery was uneven.

A deterministic replay of the old path produced 19 backward corrections (largest 15.47 m) with 1,000 ms one-way delay and 600 ms jitter. The replacement sends numbered, timed commands and receives the exact physics state and last accepted command. The client replays only commands the server has not acknowledged. Server collision rules and a server-clock time allowance remain authoritative. A generation change invalidates old commands after a teleport, seat transition, room change or vehicle transition. Movement is flushed before range-checked interactions.

## Confirmed defects addressed

| Defect | Change |
| --- | --- |
| Delayed snapshots pull walking players backward | Acknowledgements and replay replace the trail heuristic for the new protocol |
| Private velocity survives position corrections/reconnects | Physics velocity is part of the reconciled state and resets on disconnect |
| Buffered input bursts can strand a movement sequence | Bounded burst allowance; duplicates are harmless and sequence gaps resynchronize |
| Remote clock retains an old connection's offset | Reset clock mapping on welcome |
| Cars extrapolate forever when other/empty vehicle deltas refresh a shared timestamp | Immutable snapshots with a separate 250 ms horizon for each vehicle |
| Releasing another finger cancels joystick, look or accelerator | Pointer ownership and independent driving holds |
| Backgrounding can retain keyboard/jump input | Clear all latches on blur and visibility change |
| Invalid persisted settings crash rendering or overwrite store methods | Allowlist saved preferences and validate types, IDs and bounds |
| Null social preferences crash startup; denied session storage prevents joining | Tolerate invalid preferences and retain the reconnect token in memory when storage is denied |
| Late room replies can resolve a newer retry of the same action | Correlate room requests and replies by reference |
| Repeated identical notifications disappear too soon | Expiration belongs to a notification generation |
| Menu rendering counts the current frame's time twice | Accumulate each render interval once |

## Validation

- Baseline: 159 automated tests passed before changes.
- Final automated suite: **173 passed, 0 failed**.
- Automated regressions cover delayed/bursty delivery, turns, jump, key release, 2 FPS frames, command duplication, forged durations, collision corrections, stale generations, bounded history, packet size, real WebSocket acknowledgement, legacy-message bypass, vehicle extrapolation and corrupt preferences.
- Chrome movement: 1,000 ms one-way delay plus 600 ms jitter; no backward corrections, final authoritative position gap **0 m**. Median frame interval 394 ms, maximum 1355 ms under software WebGL. This deliberately exercises slow frames; it is not a hardware performance benchmark.
- Chrome touch: real multi-touch joystick, camera look and accelerator ownership; visibility resets; recovery from corrupt saved settings.
- Charging decelerates through shared physics; jump-shot impulses are sequenced even when released between frames, so acknowledgements preserve the jump. Transition generations preserve the server's time budget.
- Production TypeScript/Vite build passes. Vite retains its existing large Three.js chunk warning.

All **28 browser checks** passed: movement/shooting (4), controls/storage (6), campus recovery (8), and the economic lab (10). Machine-readable browser results are beside this document. The long campus and economic-lab workflows retain their own result files.

## Scope and operation

Deploy/restart both the room server and client bundle for the new movement protocol, then reload open game tabs. Older clients retain their existing protocol during a rolling deployment. No database migration is needed.

The checks cover reproduced defects and exercised workflows, not a proof that every possible bug is absent. Real authoritative collisions or teleports can still correct a prediction. Prolonged disconnection and unavailable GPU resources cannot be made into smooth real-time play by reconciliation alone. Voice chat, multi-room scaling and other roadmap features were not treated as defects.
