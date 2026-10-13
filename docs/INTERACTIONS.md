# Interactions and physics

Players can sit on benches and chairs, open and close doors, enter the library, café and a classroom, use fixtures inside them, and play basketball with real ball physics. Every one of these actions is validated by the room server; the same rules run locally when exploring offline.

## How it is built

| Layer | File | Role |
|---|---|---|
| Fixture data | `shared/interactions.mjs` | Every seat, door, ball, hoop and usable fixture, with a stable id. Seats carry an anchor (position, height, facing) and, at tables, a chair pull-out distance. Doors carry hinges, leaf lengths, swing rules, a doorway collider and an optional lock. |
| Rules | `shared/world.mjs` | `createWorld()`: sit, stand, door, pickup, drop, shoot, reset and release, each returning `{ ok }` or `{ ok: false, reason }`. One instance runs in the room server for everyone; the client runs its own instance offline. |
| Ball physics | `shared/ball.mjs` | Deterministic sphere physics at 240 Hz substeps: gravity, drag, court floor, campus walls, backboards, posts and torus rims with restitution, rolling and sleep. Shot planning and scoring live here too. |
| Movement | `shared/campus.mjs` | Shared collision for client and server: 0.3 m body radius, wall sliding, a small corner-slip so door frames don't snag, and closed doors that block their doorway. |
| Client state machine | `src/interaction/controller.ts` | The local player's single activity (`free`, `approach`, `sitting`, `seated`, `standing`, `holding`, `charging`, `busy`), focus selection, and the actions. |
| Network bridge | `src/interaction/world.ts` | `request()` sends an action with a reference and awaits the server's result (4 s timeout); applies world snapshots and ball state; predicts free balls between snapshots. |
| Presentation | `src/avatar/Avatar.tsx`, `src/world/Interactive.tsx`, `src/ui/Interaction.tsx` | Animation, doors, chairs, balls, computer screens, prompt, HUD and fixture panels. |

### One prompt at a time

Every 100 ms the controller lists what is in reach (seats, doors, balls, fixtures and landmarks) and scores each one as *priority − 2.5 × distance + 1.2 × facing*. Distance and facing dominate, so the thing you are standing at and looking at wins; priority breaks near-ties (a ball beside a bench). Exactly one prompt is shown, such as **E — Sit**, **E — Open door**, **E — Pick up basketball**, **Locked · Staff only** or **E — Explore Adunni Learning Commons**. While seated it becomes **E — Stand up** (or **E — Use computer** at a library terminal). On touch screens the same action appears as a button; while holding a ball, **Shoot** (press and hold) and **Drop** replace it.

### State machine

Each action checks the activity first, so conflicting actions are refused before they reach the server, and the server checks again:

- You can't sit while holding a ball ("Put the ball down first."), while airborne ("Land first, then sit.") or from too far away.
- You can't pick up a ball while seated, or a ball someone else holds.
- You can't shoot without holding a ball. Jumping, emotes and walking are disabled while sitting down, seated, standing up and charging a shot.
- Seated, any movement key (or the joystick) stands you up through the stand-up motion.

## Sitting

Seats: 21 timber benches (two independent seats each), library reading tables, library catalogue computers, café terrace and interior tables, and Studio D1 desks, 112 in all.

1. **E — Sit** starts an approach. The player walks to the seat's approach point (0.45 m in front, matching the captured sit-down), routing round the chair's side when coming from behind, then turns to face away from the seat.
2. The server checks occupancy, distance and state. If someone took the seat in the meantime, it refuses with "That seat is taken."
3. The Rocketbox **sit-down** capture plays. Its horizontal root travel is removed from the clip and replayed on the rig, so the body steps back onto the seat instead of being teleported, and the pelvis is matched to the seat's measured height.
4. At a table the chair (pulled out 25 cm) scoots in with the sitter, then the seated idle plays: hands resting on the table at tables, an occasional glance around on benches.
5. **Stand up** reverses it: the chair scoots back and the stand-up capture carries the body forward. The server picks the exit spot, preferring forward, then the sides, then behind, and never a spot inside a collider. Every seat's approach and exit point is checked walkable by `tests/world.test.mjs`.

Seat occupancy is replicated. Remote players' avatars play the same sit and stand motions locally, and a seat is released when its occupant disconnects.

## Doors

Three hinged doors open: the double glass doors of the library and the café, and the classroom door of Studio D1. Two more are locked and explain why: the library staff room ("Staff only") and the café kitchen ("Kitchen staff only").

- The leaves rotate about their real hinges, driven by a door-closer spring, with open and latch sounds.
- The doors are double-acting: they swing **away** from whoever opens them, so a door never sweeps through its opener. Opening is refused if someone stands in the swing arc on the far side, and closing is refused while anyone (or a ball) is in the doorway or the leaves' path.
- A closed door blocks movement for everyone, enforced by the server. The doorway collider is removed only while the door is open.
- The avatar reaches for the handle (Rocketbox door-push and door-pull captures), and the leaf starts moving when the hand arrives.

## Interiors

| Place | What you can do |
|---|---|
| **Adunni Learning Commons** | Open the doors and walk in. Sit at any of the four reading tables (24 chairs). Sit at a catalogue computer, which opens a working search of a fictional catalogue where you can place a demo hold. Browse the New Arrivals display. The staff room is locked. |
| **Courtyard Café** | Open the doors and walk in. Read the menu board. Order at the counter: choose items and place a **demo order**, with no payment and no payment details ever requested; your number is called a few seconds later. Sit at the interior or terrace tables. The kitchen door is locked. |
| **Studio D1** (School of Design, ground-floor gallery) | Open the classroom door. Sit at any of the four paired desks. Read the design brief on the whiteboard. |

Decorative objects (shelves, plants, signs, lamps) offer no actions.

## Basketball

1. **E — Pick up basketball** near a ball (two balls rest by the court entrance). The server grants possession to one player at a time.
2. Moving with the ball, the avatar dribbles: the ball bounces between the right hand and the floor on a cycle paced to the stride. Standing, it is held at the waist.
3. **Hold Space** (or the **Shoot** button) and release. A meter sweeps up and down; the gold band shows the release timings that would actually score from where you stand and the way you face. It is computed by running the same physics the server runs, so it is not a decoration. Shots go where the camera looks, with gentle aim assist towards a hoop within ±28° and 13 m.
4. On release the server launches the ball from the release point and simulates it at 240 Hz substeps. It bounces off the rim (a torus), backboard, posts and floor with restitution, and rolls to rest.
5. A basket counts only when the ball's centre crosses the rim plane **downwards** inside the ring, and only once per shot. Beyond 6.75 m it is worth 3 points.
6. The HUD keeps a round of five shots, with made and missed dots, total, best and today's percentage. Feedback distinguishes a swish, a shot off the glass, one in off the rim, rimmed out short or long, an air ball, and no hoop in front of you. **Q** or **Drop** puts the ball down; **Retrieve ball** returns a ball that left the court; idle balls far from the court respawn on their own.

Possession is validated by the server and visible to everyone. A disconnecting player's ball is dropped where they stood.

## Multiplayer consistency

- Movement stays server-simulated from inputs. The client integrates in real time even when frames are slow, so both sides cover the same distance.
- A standing player's client may ask the room to settle its position. The room accepts only small, walkable corrections (at most 0.9 m) while the player is stationary and not seated, so range checks for seats, doors and balls agree with what the player sees.
- Every action result carries the player's resulting seat and ball. World changes (doors and seats) are broadcast when they change; ball state rides on the 15 Hz state broadcast, with local prediction in between.

## Testing

- `npm test`: shot physics (ideal free throw, three-pointer, under- and over-charged misses, no upward scoring, no backboard tunnelling, ball rest), seat exclusivity and stand-up exits, every seat reachable on foot, door swing and obstruction rules, locked doors, doorway fit, ball possession and disconnect release, position-settle limits, and network seat contention with disconnect cleanup.
- `node tests/browser-interactions.mjs` (with `npm run dev`, or the isolated `campos-qa-room` + `campos-qa-web` pair and `TEST_URL=http://localhost:5174`): two real browser players and a touch-emulated phone. It covers bench sitting and contention, standing by key and by movement, library doors (open, walk through, refused close, solid when closed, locked), table and computer seats, the new-arrivals display, café door, counter order, menu and table, classroom door, desk and whiteboard, a five-shot basketball round with real timing, a weak shot, dropping, disconnect release, and mobile sit, stand, pick-up and drop through the touch buttons. Screenshots go to `docs/screenshots/interactions/`.

## Known limitations

- Animations are motion captures blended procedurally. Hands are not IK-placed: the ball sits between the hands rather than in a fitted grip, and the dribbling arm's pump is procedural. Hands may hover a few centimetres from door handles and tables.
- Chairs and tables are not obstacles for walking (only tabletops' central footprint is), so you can brush through a chair's edge. Doors swing through other furniture freely.
- Remote players' door and pick-up gestures aren't replicated (the door itself is). Their sit and stand motions are.
- Locked doors never unlock; there are no keys or roles.
- There is no upper-floor access (no stairs), and the other academic blocks are not enterable.
- Shot aim assist corrects 85% of the aiming error towards the targeted hoop: generous, deliberately.
- Tested on desktop Chrome (Iris Xe) and a 390 × 844 touch-emulated viewport. No physical phone has been tested.
