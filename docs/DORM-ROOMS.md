# Your room in Palm House

Every player has a room of their own in **Palm Residences**. Go to **Palm House** (the first building
in the district, about 650 m east of the courtyard along the hub road). Walk through its common room to
the **Residents’ rooms** door in the back wall, and press **E** (or tap the action button) for
**Go to your room**.

## What you can do

- **Enter and leave.** The door takes you into your room. Inside, the card at the top left has
  **Arrange room** and **Leave room**. You can also leave through the door (**Back to the common
  room**). Leaving works from anywhere in the room, so furniture can never trap you.
- **Arrange it.** **Arrange room** opens a floor plan, with north at the top and the door at the bottom.
  - **Add a piece:** choose it from the catalogue, then tap the floor.
  - **Change a piece:** tap it to move it in 25 cm steps, **Turn** it a quarter turn, change its
    **Colour** (bed, beanbag and rug), or **Remove** it.
  - **Mistakes show before saving:** a piece that overlaps another or blocks the doorway is reported
    straight away, and **Save room** stays disabled until it is fixed.
  - **Start over:** **Start from the default room** puts back the furnished layout every new resident
    starts with.
- **Furniture is solid.** You walk around beds, desks and wardrobes; rugs are walkable.
- **Your room is private.** Only people in your room see you there, and you see only them: nobody,
  unless friends are visiting. You still show as online, and chat, parties and friends work as usual.
  Party members can't travel to you while you are in your room. If you travel to a party member, you
  leave your room.

## Visits

Friends can visit while you are in your room. Visits are for **signed-in friends only**.

- **Invite.** In your room, **Invite** lists your friends who are on campus. Friends who appear offline
  aren't listed, and inviting one gives the same answer as for someone who isn't here.
  - The invited friend gets a card: **Go** takes them straight into your room from anywhere on campus.
  - An invitation lasts 2 minutes and works once.
- **Drop in.** Under **Who can come in** (in the Invite panel, or **Privacy** in the Friends drawer)
  you choose between two settings:
  - **Friends you invite** (the default).
  - **Any friend, while you're in.** Your friends then see "In their room · Palm House" and a
    **Visit room** button in their friends list.
- **While visiting:**
  - Visitors see your furniture and walk among it, but only you can arrange the room.
  - Their card says whose room it is, with **Leave room**.
  - You see who is visiting on your card.
- **Showing out.** The Invite panel lists your visitors with **Show out**.
- **When visits end.** A room holds up to 6 people. Visitors go back to the common room with a short
  message when:
  - you leave your room, disconnect or travel elsewhere;
  - you show them out;
  - either of you blocks the other.

  A blocked player can never visit.

The catalogue has a bed, a bedside table, a desk and desk chair, a wardrobe, a bookshelf, a beanbag, a
floor lamp, a plant and a rug. A room holds up to 16 pieces, and each type has its own limit (for
example, one bed).

## Saving (and the visit setting)

| Who | Where the layout is kept |
|---|---|
| Signed-in player | Saved to the account (`public.dorm_rooms`). It opens the same in any later session or device. |
| Visit setting | `player_settings.room_visits` (`invite` or `friends`), saved with the other privacy settings (`supabase/migrations/20261015120000_room_visits.sql`). |
| Guest | Kept by the room server for the browser session, so it survives a reload or reconnect. It is lost when the room server restarts. The room tells guests to sign in to keep their room. |

Signing in or out while in your room takes you back to the common room, because the room you were in
belonged to the previous identity.

## How it works

- **One room for everyone.** There is one physical room: a wing built against the back of Palm House
  (`shared/dorm.mjs`). Its walls are ordinary shared colliders, so nobody can walk in from the common
  room or from outside.
- **Each resident in their own space.** Going through the door is a request to the room server. The
  server checks that you are at the door, on foot, not holding a ball, not in a match or a challenge,
  and not in a vehicle. It then moves you inside and keeps you in your own space.
- **Who sees whom.** State messages carry a `space` field for players in their rooms. Clients draw only
  the players in their own space: everyone on campus, or nobody but yourself inside your room.
- **The layout is checked twice.** The editor and the room server use the same rules:
  `validateLayout` in `shared/dorm.mjs`. Only catalogue pieces are allowed, at 5 cm positions and
  quarter turns, inside the walls, with per-type limits and at most 16 pieces. Solid pieces may not
  overlap each other or the space inside the door, and rugs may not overlap rugs. Unknown fields are
  dropped.
- **Saved layouts.** A layout is written only by the room server, through the service-role functions
  `dorm_layout` and `save_dorm_layout` (`supabase/migrations/20261015090000_dorm_rooms.sql`). Players
  can't read or write the table directly. A database check rejects any layout with more than 16 items
  or larger than 4 KB.
- **Collision on both sides.** The room server and the client both veto walking into furniture with
  `furnitureAllows` from the shared module. Stepping into a piece is refused and stepping out is
  always allowed, so a piece placed where you stand cannot trap you, and the client and server agree.
- **Reconnecting.** If you reconnect while in your room, you come back outside the door, never shut
  inside the wing. Opening the room again reloads your layout.

## Not built yet

- **Visits for guests** (visits need friends, and friends need accounts), and visiting an empty room.
- **A badge shelf** showing the badges you choose.
- **Wall items:** posters and pictures.
- **More than one room design.**
- **Sitting on your own furniture.** Seats are shared interactive objects, and a piece of furniture
  that exists only in one player's space doesn't fit that model yet.

## Tests

Visits:
- `tests/dorm-visits.test.mjs`, on PostgreSQL with real friendships:
  - invitations, used once, friends only;
  - visitors can't rearrange, and see the resident's changes;
  - dropping in when allowed;
  - showing out;
  - blocks either way;
  - the resident leaving or disconnecting;
  - a hidden friend is never revealed.
- `tests/browser-dorm-visits.mjs`, two signed-in friends in real browsers:
  - an invitation taken from anywhere on campus;
  - seeing each other in the room;
  - no arranging for visitors;
  - showing out;
  - drop-in from the friends list;
  - the resident leaving.

Rooms:

- `tests/dorm.test.mjs`:
  - the wing is closed from every side;
  - layout validation and cleaning;
  - furniture collision, including walking out of a piece placed on you.
- `tests/dorm-room.test.mjs`, over real WebSockets:
  - entering only at the door;
  - two residents in two spaces;
  - refused layouts;
  - walking stopped by a wardrobe;
  - leaving and re-entering;
  - reconnecting from inside;
  - meet-up rules.
- `tests/dorm-accounts.test.mjs`, on PostgreSQL through the local Supabase stand-in:
  - a saved room opens in a new session;
  - signing out inside;
  - guests never written to the database;
  - players can't call the save or read functions;
  - the table's size check.
- `tests/browser-dorm.mjs`, in real browsers:
  - walking from the gate to the door;
  - entering;
  - the privacy between two players;
  - arranging and saving on the plan;
  - furniture collision agreeing with the server;
  - leaving;
  - resuming the session on a phone and using the room and editor by touch.
