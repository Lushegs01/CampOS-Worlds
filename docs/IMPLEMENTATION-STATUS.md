# Implementation status: social, progression and community systems

What was built in this round, what was verified and how, and what remains. "Done" means implemented,
connected to real gameplay, networking and persistence, and covered by automated tests that pass.
Physical-device testing was **not** possible in this environment (see Validation).

## Milestone 1 · Social connection (done)

| Requirement | Status |
|---|---|
| Search by handle; send, accept, reject, cancel; remove friends | Done (`docs/SOCIAL.md`) |
| Accurate presence and where a friend is | Done for this room instance; appear-offline respected |
| Way to join a friend's session | Same-room: Find (live marker) and party Meet up. Cross-instance joining needs more than one room to exist |
| Notifications for requests, messages, invitations | Done (in-game; no content in message notifications) |
| No duplicates, self-friendship or half-friendships | Done (one row per pair, advisory lock, race-tested) |
| Privacy controls; blocks respected everywhere | Done (requests, messages, party invites, appear offline, profile visibility; blocks in DB and room) |
| Private messages: delivery state, unread counts, paging, limits, validation, empty/loading/error states, mobile | Done; members-only by RLS and functions; idempotent sends |
| Parties: create, invite, accept/decline, leave, leadership, presence, expiry, unauthorised joins prevented | Done (in room memory, scoped to the room instance) |
| Channel labels; contextual mute/block/report; chat and invitation limits; impersonation and malformed input | Done |
| Proximity voice chat | **Not built.** Requirements documented in `docs/SOCIAL.md` |

## Milestone 2 · Identity and progression (done, no currency by design)

Profiles with title, interests, visibility, badges, duel record, challenge bests and events
attended; an 11-badge catalogue with precise rules, all awarded server-side and idempotently;
titles and four earned accent colours enforced by a table trigger and the room
(`docs/PROGRESSION.md`). No XP, levels or currency: a deliberate decision documented there.
Not built: outfits/hairstyles beyond the existing allowlists (needs new 3D assets), profile
decorations, vehicle paint (no per-player vehicles exist).

## Milestone 3 · Basketball as a game mode (one-versus-one done)

Court Duel on the existing physics, fully server-authoritative, with forfeits, cancellation, buzzer
settle, idempotent recording with retries, Elo ratings with anti-farming rules, rankings with ties,
history and rematch (`docs/COMPETITION.md`). **Not built:** team play and tournament brackets (design
written; the *Basketball tournament night* event template schedules rated duel sessions meanwhile).

## Milestone 4 · Clubs and events as a living community (done)

Templates linked to in-world activities, in-game check-in (place and time checked; labelled as
gameplay attendance only), completion counts, reminders (opt-out), request-to-join clubs with
manager approval (`docs/ACTIVITIES.md`). Existing RSVP, capacity, cancellation and organiser
permissions retained. Not built: recurring (repeating) event series; organisers schedule each one.

## Milestone 5 · Reasons to explore (partly done)

Done: a reusable challenge framework (data-defined checkpoints, foot/drive modes, limits, server
timing, idempotent results) with the Courtyard Circuit and the Campus Loop driving route, a run HUD
and checkpoint marker; the existing districts, destinations, tour, keepsakes and vehicle fleet are
used as they are. **Not built:** new districts or destinations, scenic/photo challenges, cooperative
(multi-player) challenge runs, personal spaces (design in `docs/ACTIVITIES.md`). The existing
vehicle system (one validated fleet with driver/passenger seats, server physics, mobile controls)
was not changed in this round.

## Milestone 6 · Activity without manipulation (done)

Short and long activities, no streaks, nothing expires, opt-out reminders only while playing, visible
rules, cooldowns only for fairness or stability.

## Milestone 7 · Measurement (foundation done)

Opt-in, allowlisted, pseudonymous lifecycle events stored locally with retention, and a report
computing activation, D1/D7/D30 retention, social sessions, participation, completion and repeat
rates, session length and connection failures (`docs/ANALYTICS.md`). There is no production data,
so no retention claim is made.

## Milestone 8 · Security, networking and persistence (done for this scope)

Every consequential mutation is validated by the room or by database functions (see the trust table
in `docs/ACCOUNTS.md`). Idempotency: messages (client UUID), duels (match id), challenges (run id),
badges (unique keys), check-ins (primary key), friend accepts. The room's `ROOM_ID` names its
instance so parties and presence can later be scoped across several rooms. Not done: multiple room
instances, load testing beyond the existing bounded room (`ROOM_CAPACITY` remains a limit, not a
tested capacity).

## Milestone 9 · Interface, mobile and performance

New interfaces follow the existing drawer, HUD and card styles; drawers stay non-modal; dialogs
trap focus as before; destructive actions confirm; buttons have labels. Phone-viewport checks in the
browser suites cover the friends drawer and the challenge HUD (no horizontal overflow, controls not
covered). The main JavaScript chunk grew from 485 kB to about 600 kB (164 → about 197 kB gzip); the
3D scene chunks are unchanged. **Not done:** physical-device testing and a fresh mobile frame-rate
benchmark.

## Known limitations

* Parties, presence and duels live in one room's memory: they reset on a room restart and do not
  span instances.
* Real-time delivery of messages relies on the room's content-free nudges plus 20-second polling; a
  player who is not in the room sees new messages at the next poll.
* Profile visibility hides bio and interests only; badges, records and club memberships are public
  by design.
* The local Supabase stand-in implements only what the game uses; the migrations have not been
  applied to a hosted Supabase project (checklist in `docs/ACCOUNTS.md`).

## Next milestone

**Deploy against a real Supabase project and run a small closed play test.** Apply the seven
migrations to a hosted project, run the account-backed browser suites against it, enable opt-in
analytics, and invite a real group to use friends, parties, Court Duel, one scheduled event and the
challenges for two weeks. The analytics report and player feedback will show which system people
return for, and that should decide whether tournaments, team play, voice or personal spaces comes
next.
