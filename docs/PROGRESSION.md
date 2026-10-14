# Identity and progression

What carries over between sessions for a signed-in player, and how it is protected.

## Profiles

A profile has a public handle and display name, an appearance, an optional bio (280 characters),
up to five interests from a fixed list (`shared/profile.mjs`), an optional **title**, badges, game
records (round-of-five best, Court Duel record and rating, challenge best times, events attended in
the game) and club memberships.

* **Visibility.** Everyone or friends only (Friends → Privacy). Friends-only hides the bio and
  interests from everyone but friends. Those two columns are not readable through the API at all
  (column privileges): only `get_profile()`, which applies the setting, returns them. The name,
  appearance, title, badges, game records and club memberships stay public because rankings, event
  attendee lists and club pages show them. The setting says so.
* Profile cards can be opened from the People list, friends list, club members, event attendees and
  conversations, with contextual actions (add friend, message, block, report).
* Private account information (email) never leaves Supabase Auth.

## Achievements

One catalogue, `shared/achievements.mjs`, is used by the interface and the room server and mirrored
in the database table `achievement_catalog` (a test keeps them identical). Every badge is awarded by
the room server or by a database function from validated facts, never by a client.

| Badge | Exactly what earns it | Validated by | Reward |
|---|---|---|---|
| Campus Compass | Visit the five tour stops | Room checks distance on each visit | Title |
| Curious Mind | Find all six keepsakes | Room checks distance | Title |
| Campus Explorer | Discover 12 different destinations | Room checks distance | Title, teal accent |
| Courtside | 6+ points in one round of five | Room physics scores each shot | Title |
| Good Game | Finish a Court Duel against a signed-in player | Room runs the duel | Title |
| Court Champion | 3 rated duel wins against ≥ 2 different opponents | Database, from recorded duels | Title, gold accent |
| Good Company | First accepted friendship | Database, on the friendship | Title |
| Better Together | 10 minutes in a party of 3+ | Room measures the time | Title |
| Regular | Check in at 3 different events in the game | Room checks the place; database the time window | Title |
| Community Builder | Organise an event where 3 other players check in | Database, from check-ins | Title, violet accent |
| Road Tripper | Drive the Campus Loop as the driver in under 12 minutes | Room times the run from its own positions | Title, copper accent |

Every award is `insert … on conflict do nothing`, so retries, reconnects and duplicate messages can
never award a badge twice. Recording paths that the room retries (duels, challenges) carry ids that
make the whole operation idempotent.

The definitions avoid a single repeated action as the efficient route: they ask for variety
(different opponents, different destinations, different events), cooperation or skill.

## Titles and earned accent colours

* A **title** is the badge's title, chosen from badges you have earned. It shows on your profile and
  under your name tag for everyone in the room.
* Four **accent colours** unlock with badges. Locked ones appear in the appearance editor with a
  lock and the rule that unlocks them.
* Enforcement: a table trigger on `profiles` refuses an unearned title or accent on every write
  path (the profile function and direct updates alike). The room takes titles and accents only from
  the verified profile and strips earned accents from guests. Earning a badge cannot be faked, so
  neither can the cosmetics.

## No currency, levels or paid rewards

There is deliberately no in-game currency, XP or level, no randomised reward boxes and nothing for
sale. Rewards are cosmetic and descriptive (titles, colours), every rule is visible, and nothing is
lost by missing a day. If a currency or levels are ever added, their purpose, earning rules and
progression curve should be written down here first.

## Gameplay records are not academic records

Badges, check-ins and duel results describe what happened in CampOS Worlds. They never imply
attendance, grades, credit, enrolment or finance status, and every screen that could be confused
with official attendance says so ("attendance in the game only").

Guest progress (local keepsakes, tour, best score) stays in that browser, is labelled as such and is
never converted into account badges, because it cannot be verified.

## Tests

`tests/competition.test.mjs` (catalogue mirror, Campus Explorer, Good Company, duel badges),
`tests/activities.test.mjs` (titles, earned accents via every write path, interests, visibility),
`tests/community.test.mjs` (original progression rules), `tests/activities-room.test.mjs`
(Better Together measured by the room), `tests/browser-activities.mjs` (title and accent unlocked and
saved in the interface; friends-only profile seen by a non-friend).
