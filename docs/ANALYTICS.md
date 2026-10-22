# Measuring whether players enjoy the game

The goal is to learn whether people enjoy CampOS Worlds and come back of their own accord, with as
little data as possible. Nothing here is a claim that retention has improved: there is no production
data yet.

## Privacy and consent

* **Off by default twice.** The operator must enable it (`ANALYTICS_ENABLED=1` with a secret
  `ANALYTICS_SALT` of 16+ characters), and each player must opt in (Settings → *Share anonymous
  gameplay statistics*). Without both, nothing about a player is written.
* **Allowlist only** (`server/analytics.mjs`): the events below with their listed properties.
  Anything else is dropped. Never names, handles, account ids, chat, private messages, positions,
  IP addresses or user agents.
* **Pseudonymous subjects**: an HMAC (SHA-256, keyed with `ANALYTICS_SALT`) of the account id, or of
  a random per-browser id for guests. Without the secret the files cannot be joined back to accounts.
* **Local storage, bounded**: one JSON Lines file per UTC day under `ANALYTICS_DIR`
  (`server/data/analytics`), deleted after `ANALYTICS_RETENTION_DAYS` (default 90). No third-party
  service receives anything.
* Operators should still check the rules where they operate (for example, whether consent must also
  be recorded) and restrict access to the files.

## Events

| Event | Properties | When |
|---|---|---|
| `session_start` | `guest` | Joined the room (after any sign-in check) |
| `session_end` | `seconds`, `reason` | Left the room |
| `account_linked` | — | Signed in during a session |
| `tutorial_completed` | — | Visited all five tour stops in one session |
| `friend_connected` | — | The room saw a new friendship |
| `party_created`, `party_joined` | `size` (joined) | |
| `duel_started`, `duel_completed` | `outcome` | |
| `event_checkin` | — | New in-game check-in |
| `achievement_earned` | `achievement` | |
| `challenge_completed` | `challenge` | |
| `connection_failures` | `count` | Failed attempts before this session connected |
| `shop_checkout` | `item` | A store checkout was opened (purchases themselves are recorded in the database, [store](STORE.md)) |

## Metrics (`node scripts/analytics/report.mjs [dir]`)

All dates are UTC calendar days. A player is a pseudonymous subject.

* **New players**: subjects whose first event is in the data.
* **Activation**: share of players whose *first session* includes an introductory activity: the
  campus tour, joining or creating a party, finishing a duel, or an event check-in.
* **First-session tutorial completion**: share whose first session completed the tour.
* **Day-N retention (N = 1, 7, 30)**: of players first seen on day D, the share with a session on day
  D + N exactly. A player counts towards Day N only once day D + N is inside the data, so
  incomplete windows never lower the rate. Reported with the eligible count.
* **Sessions with friends or parties**: sessions that include a party or a new friendship.
* **Event participation**: check-ins, and distinct players checking in.
* **Duel completion rate**: completed / started; forfeits counted separately.
* **Repeat participation**: of players who did an activity, the share who did it more than once.
* **Median session length**, read together with return rates, never as a goal on its own.
* **Connection failures per 100 sessions**.

The report is tested against synthetic data with known answers (`tests/analytics.test.mjs`), as is
the consent gate, the allowlist, the absence of identifying data in the files, pseudonym stability
and retention pruning.
