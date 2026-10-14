# Friends, private messages, parties and safety

How players find each other and keep in touch. Everything here is implemented and tested; the
limits of the current design are listed at the end.

## Where each piece lives

| Feature | Persistent? | Authority | Code |
|---|---|---|---|
| Friends, friend requests, blocks, privacy settings | Yes (accounts) | PostgreSQL functions | `supabase/migrations/20261014090000_social.sql` |
| Private (direct) messages | Yes (accounts) | PostgreSQL functions + RLS | same migration |
| Player reports (with one quoted message) | Yes | PostgreSQL | same migration |
| Presence (who is on campus, where) | No | Room server roster | `server/room.mjs` |
| Parties, party chat, meet-up travel | No (room memory) | Room server | `server/parties.mjs`, `server/room.mjs` |
| Room chat, mute, room reports | No (reports to a file) | Room server | `server/room.mjs` |
| Interface | — | — | `src/social/store.ts`, `src/ui/Social.tsx` (drawer: **F** or the dock's **Friends** button) |

Guests can join parties, use room and party chat, mute and report. Friends, private messages,
blocking and privacy settings need an account: a guest identity is a browser session and cannot
carry a relationship.

## Friends

* Search by public handle (prefix, up to 20 results). Players who blocked you are left out.
* Send, cancel, accept, decline, remove. Friendship is **one row per pair** (`user_a < user_b`), so
  it is symmetric by construction and can never be half-made.
* Two players adding each other at the same moment: every change to a pair takes a
  transaction-scoped advisory lock, so the second request simply completes the friendship. Tested
  with simultaneous requests.
* Retried accepts are harmless (accepted requests are kept with status `accepted`).
* A declined request cannot be re-sent for 24 hours. 20 requests an hour, 50 pending, 300 friends.
* The first friendship awards the **Good Company** badge to both players.

## Presence and finding each other

The room's roster carries each signed-in player's handle, so the friends list shows who is on
campus now, the place they are at (nearest landmark or district) and how far away. **Find** puts the
gold marker on a friend or party member and keeps it on them as they move; the map shows party
members (amber) and friends (teal).

Presence is per room instance (`ROOM_ID`, default `courtyard`): with one room, "on campus" means
connected to this room. A future multi-room deployment needs a shared presence service; nothing in
the interface assumes there is only one room.

**Appear offline** withholds your handle from the room roster and from chat, so friends see you as
not on campus. Your display name and avatar stay visible to people nearby, as in any shared space.

## Private messages

* Between friends only, and only when neither has blocked the other and neither has turned private
  messages off. The reason is shown in the conversation when sending is not possible; earlier
  messages stay readable.
* Each message carries a client UUID. A retry of a send that did reach the server returns the stored
  message instead of a duplicate (tested with six simultaneous retries).
* 1–1,000 characters; control, zero-width and bidirectional-override characters are removed or
  refused. 5 messages per 5 seconds and 30 per minute.
* Paged history (30 per page, oldest first, "load earlier"), read markers and unread counts.
* Access: every function answers "that conversation isn't available" both for a conversation that
  does not exist and one you are not in, so ids cannot be probed. Row Level Security also limits
  direct table reads to members. Nobody can write to the tables directly.
* Delivery: after a send, the sender's client asks the room to **nudge** the recipient. The nudge
  carries no content; the recipient's client re-reads its own inbox through the access-controlled
  service. Unread counts are also polled every 20 seconds, so nothing depends on a nudge arriving.
* Notifications say who wrote ("New private message from Ada"), never what. They can be turned off
  (Friends → Privacy).

Private messages are a separate channel from room chat: they never appear in the chat panel, and room
or party chat is never stored.

## Parties

* Invite anyone in the room you may invite (see privacy below). Invitations expire after 60
  seconds; a player can have at most 5 waiting. Up to 6 members. Blocks are checked again when an
  invitation is accepted, so nobody joins a party with someone either of them has blocked.
* Leaving, removing (leader only) and handing over leadership. If the leader leaves or loses
  connection, the longest-standing connected member leads.
* A member who loses connection keeps their place for 45 seconds; reconnecting with the same session
  (a reload) restores it.
* **Party chat**: a channel only members receive (labelled in the chat panel, gold background).
* **Meet up**: travel to a party member. Only within your own party, not while seated, driving,
  holding a ball, in a Court Duel or in a challenge, with a 20-second cooldown. The room chooses a
  clear spot that is reachable from the member in a straight line (never through a wall).
* The **Party** HUD lists members with where they are; tap one to follow them with the marker.
* Ten minutes in a party of three or more earns **Better Together** (measured by the room).

Parties live in the room server's memory. They do not span room instances and do not survive a
server restart. This is deliberate for a single bounded room and is not presented otherwise.

## Privacy settings (accounts)

| Setting | Options | Default |
|---|---|---|
| Who can send you friend requests | Everyone · Nobody | Everyone |
| Private messages | Friends · Turned off | Friends |
| Who can invite you to a party | Anyone in the room · Friends · Nobody | Friends |
| Appear offline | On · Off | Off |
| Who sees your bio and interests | Everyone · Friends only | Everyone |

Guests choose who may invite them to parties for the current visit (default: anyone in the room).

## Mute, block and report

* **Mute** (anyone): hides a player's room and party chat on this device. By handle for signed-in
  players, so it survives their reconnects.
* **Block** (accounts): ends any friendship and pending requests, and stops friend requests,
  private messages, party invitations, Court Duel challenges and room/party chat **in both
  directions**. The room enforces it for chat and invitations; the database for everything else.
  Blocked players are not told, and nobody can see who blocked them.
* **Report**: from the People list, a profile, the friends list or a single private message. Account
  reports are stored in `player_reports` (readable only with the service key), with the reason,
  optional details and, for a message, a copy of that one message. The room also appends its own
  record, with the reported player's last five public chat lines, to `server/data/reports.jsonl`.
  Reports are a moderation input, not a staffed moderation service.

Text players write for others has control, zero-width and bidirectional-override characters
removed. Guests cannot use staff-like names (admin, moderator, support, CampOS, …) or put a ✓ or @
in their name; signed-in players carry a ✓ that guests cannot fake. The third identical chat line
within 30 seconds is refused.

## Tests

* `tests/social.test.mjs` (database): friendship consistency, the simultaneous-request race,
  decline/cancel/remove, privacy, rate limits, blocks, search, message access by every route
  (functions, direct reads, direct writes), validation, paging without gaps, concurrent retries,
  reports.
* `tests/social-room.test.mjs` (real WebSockets): parties end to end (expiry, size, leadership,
  reconnect grace), party chat isolation, meet-up rules, privacy and blocks enforced by the room,
  appear offline, nudges.
* `tests/browser-social-accounts.mjs` (two real browsers on the full local stack): search, request,
  live notification, accept, presence, messages both ways, a third account denied, party invite,
  party chat, meet-up into the library, block, phone layout.

## Not built (yet)

* **Voice chat.** Proximity voice would need: a WebRTC mesh or SFU sized for the room; STUN and a
  TURN server with short-lived credentials issued by the room to authenticated members only;
  signalling through the room with the same block/mute rules; explicit microphone permission and a
  push-to-talk or mute default; distance attenuation in the audio graph; cleanup on disconnect; and
  testing on mobile browsers (iOS Safari audio session limits). None of this infrastructure exists in
  this repository, so voice is not offered.
* Multi-room presence and cross-room parties (needs a shared presence/party service).
* Real-time delivery without the room (for example Supabase Realtime subscriptions); the RLS policies
  on conversations and messages already allow members to subscribe.
* A moderator dashboard for `player_reports`.
