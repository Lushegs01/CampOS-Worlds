# Events, clubs and challenges: things to do on campus

## Events become activities

Events already had clubs, organisers, schedules, capacity, RSVPs, cancellation and paging
(`docs/ACCOUNTS.md`). This round connects them to the world.

* **Templates** (`src/community/activities.ts`): *Basketball tournament night*, *Campus scavenger
  hunt*, *Club social meet-up*, *Cooperative discovery challenge*, *Campus festival or gathering*,
  *Study-group session*. A template sets the category, campus location and length, suggests a title
  and description, and tells attendees what to do when they arrive (for example: "challenge another
  player from the basketball panel"). Organisers choose one when creating an event; the database
  checks the template id.
* **Finding it**: "Show me the way" puts the gold marker on the event's location; the map routes
  along roads for distant districts.
* **In-game check-in**: from 15 minutes before the start until the end, a signed-in player standing
  within 15 m of the event's location can check in. The room checks the position; the database checks
  the event, its location, its status and the time window (`record_event_checkin`). Check-in is
  idempotent. Event pages show who checked in, and ended events show the count. It is labelled
  everywhere as **attendance in the game only, never academic attendance**.
* **Badges**: Regular (3 events) and Community Builder (the organiser, when 3 others check in).
* **Reminders**: a single notice 15 minutes before an event you RSVPed to, while you're on campus.
  Opt out in Settings. No email or push is sent.
* **Times**: stored in UTC, shown in each player's local time zone with the zone named.

Empty states invite real participation ("No upcoming events. Clubs host events here…"). There are
no seeded events, fake attendance counts or automated announcements.

## Clubs

Clubs can be **open** (join at once) or **request** (players ask, optionally with a short note; the
owner or organisers approve or decline). Requests are visible only to the asker and the club's
managers; every decision is made by a database function that checks the caller's role, and a lock
makes two organisers answering at once resolve to one outcome. Players can withdraw a request.
Limits: 20 pending requests and 10 new requests an hour per player, 30 clubs per player.

Roles (owner, organiser, member), leaving, removing members, organiser permissions for events and
reporting a member (from their profile) work as before.

## Challenges (exploration and driving)

`shared/challenges.mjs` defines challenges as data: ordered checkpoints, a mode, a radius, a time
limit and a minimum plausible time. The room's engine (`server/challenges.mjs`) does the rest.

| Challenge | Mode | What | Limit |
|---|---|---|---|
| Courtyard Circuit | On foot | Six courtyard landmarks in order | 3 minutes |
| Campus Loop | Driver only | Every district's shuttle stop in order (~6 km of road) | 12 minutes; earns Road Tripper |

* Start from Events → **Challenges** (guests too). The HUD shows the next checkpoint, its distance
  and direction, and the clock; the gold marker moves to each checkpoint.
* The room checks every few ticks, from its own record of where the player is, that checkpoints
  are reached in order, the mode holds (getting into a vehicle ends an on-foot run; leaving the
  driver's seat ends a driving run) and the time limit. Runs faster than the minimum plausible time
  are rejected. Meet-up travel is disabled during a run.
* Signed-in players' times are recorded by the room with a run id (`record_challenge`), so a retry
  never counts twice. Best times appear on the challenge board and on profiles.

**Adding a challenge**: add an entry to `CHALLENGES` and its id and time limits to
`record_challenge()` / the `challenge_results` check in a new migration. No game logic changes.

## Activity structure, without pressure

Short visits: a Court Duel (60 s), the Courtyard Circuit (≤ 3 min), a keepsake or two. Longer
sessions: the Campus Loop, an event, a party exploring the districts. Nothing expires, there are no
streaks or daily-login rewards, and cooldowns exist only for fairness or stability (meet-up travel,
rate limits). Reminders are opt-out and only while you are already playing.

## Personal spaces

Built as **your room in Palm House**: see [DORM-ROOMS.md](DORM-ROOMS.md). Every player has a private
room behind Palm House's common room, furnished from a fixed catalogue on a floor plan. The room
server validates every layout and keeps signed-in players' rooms in their accounts. Not built yet:
visits by invitation, the badge shelf and wall items.

## Tests

`tests/activities.test.mjs` (check-in rules and badges, templates, challenge recording, club
requests), `tests/activities-room.test.mjs` (runs over WebSockets: order, mode, deadline, too-fast,
meet-up refusal, driving, saved times, check-in at the right place), `tests/browser-activities.mjs`
(check-in, a run with its HUD, phone layout).
