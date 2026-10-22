# Òrìṣun open-world expansion

The original courtyard uses metres: player radius 0.3 m, walking 4.5 m/s,
sprinting 8 m/s, doors 1–4 m wide and basketball rims 3.05 m high. Its
movement boundary was 138 × 128 m. None of its furniture is rescaled.

The authored expansion uses a 2,800 × 2,800 m playable boundary, a connected
8.1 km transport network, six additional districts and 18 usable ground-floor
buildings. Upper floors are architectural silhouettes, not enterable rooms.
A 600 m journey takes about 133 s walking or 30–45 s by car including acceleration.
The original hub, library, café, doors, basketball and five-stop tour remain.

Data in shared/expansion.mjs defines roads, parking, stops, walls, destinations,
seats and navigation. Rendering distance never removes collision or interaction
state. Fine district geometry is built on approach and released on departure;
low-detail building shells and road geometry remain. Repeated trees are instanced.

Vehicles are a fixed communal fleet, not owned assets. Only driver inputs are
accepted; the room runs a substepped bicycle model and collision checks. Seat
claims are serialized by the room. Stale controls brake. Disconnects release
seats and stop the vehicle without transferring ownership. Recovery requires a
stopped vehicle, no passengers and a clear home bay. Empty abandoned vehicles
return after five minutes when their home bay is clear.

Performance target: >=30 FPS on Low on a Pixel 6a at native browser resolution.
Physical-device measurements must be reported separately from Chromium emulation.

## Roads, vehicles and grounds

Roads are 8 m two-lane carriageways (the courtyard's own road outside the gate is
part of the network, not overlaid by it), with kerbs, 2.4 m sidewalks, centre and
edge lines, curb returns at junctions, turning circles at dead ends, a zebra
crossing at each district and street lights every 40 m. Walking height follows the
raised sidewalks. Vehicles are left-hand drive, as on Nigerian roads, and park
nose-out in marked bays: the courtyard car park opens off the road outside the
gate, and each district has bays beside its driveway.

Vehicles are not limited to the roads: they can drive anywhere outdoors, through
the main gateway onto the courtyard lawns, paths and football pitch, and across the
open land between districts. Walls, trees, fences, closed doors and people block
them. `drivable()` in `shared/vehicles.mjs` keeps them out of every building
footprint (courtyard and district buildings, and your room), even through an open
doorway, and off the fenced basketball court, where a parked car would block a
Court Duel. The room applies the same rule. `tests/vehicles.test.mjs` drives the
courtyard car across the lawns to the pitch and over open land, and checks that it
stops at the lab's open door, the court and a district building entrance.

Steering sensitivity (Settings, 0.2–1, default 0.6) shapes only the steering this
player sends (`src/vehicles/steering.mjs`): lower values turn the wheel in gradually
(a tap is a small correction, holding still reaches full lock, centring is twice as
quick) and reduce steering progressively up to 12 m/s, so almost full lock remains at
parking speeds. At 1 input is applied directly, as before. The room's vehicle
physics is unchanged and identical for every player.

### Smooth driving over the network

Driving used to feel laggy and stutter: the driver's car moved only when the room's 15 Hz snapshots came
back (150–200 ms after pressing the throttle), and every car's speed pulsed with network jitter. Now:

- **The driver's own car responds at once** (`shared/driving.mjs`). Each frame's controls become a numbered
  command, applied immediately with the same physics the room runs (`advance()` in `shared/vehicles.mjs`) and
  sent in batches about 30 times a second. The room applies the same commands for the same time and
  acknowledges the last. When an acknowledgement arrives, the browser adopts the room's state and replays only
  the commands the room has not seen yet, so network delay is never mistaken for a position error. A real
  disagreement (a collision the room saw differently) fades out over about a tenth of a second, or snaps beyond
  4 m.
- **The room stays in charge.** It never accepts more driving time than has really passed (a one-second
  budget), and it refuses gaps, replays and commands from anyone but the driver. If commands stop arriving
  for 350 ms, it brakes the car itself. Each change of driver starts a new generation, so in-flight commands
  from before are refused.
- **Other players' cars glide.** Each car's state carries the room time it represents. Browsers draw every
  car 110 ms in the past, between those timestamped states, on a playback clock that eases towards the
  room's clock instead of jumping. When a driver's commands arrive late, the playback eases back by at most
  5% instead of jolting. Remote players on foot use the same playback clock, so passengers stay in their
  seats.
- **The chase camera moves rigidly with the car** and eases only its offset (swinging round behind,
  clearing walls). Easing its position made how far it trailed depend on each frame's length, which shook
  the car on screen.

`tests/vehicle-smoothness.test.mjs` measures this deterministically, with the real shared physics over
simulated 60–120 ms links with jitter, a ~30 Hz room and a 60 FPS browser:

| | Before | Now |
|---|---|---|
| From throttle to the car moving | 150–200 ms | one frame (17 ms) |
| Driver's car: frame-to-frame speed wobble | 17–20% | 0.24% |
| Another player's view of it | 17–20% | 1.7–2.0% |

`tests/driving.test.mjs` checks that prediction and the room agree to the nanometre after the same commands,
and that the room refuses extra time, gaps, replays and other players. Older rooms without the driving
protocol keep the previous input messages.

### No hitch when a district comes into view

A district's full detail (about 180,000 vertices for Palm Residences) used to be built all at once when you
came within range: a 0.1–0.5 s freeze, usually mid-drive. It is now prepared ahead of you, more than ten
seconds out at a car's top speed, in slices of a few milliseconds between frames. Facades are described one
at a time, and parts are shaped and copied straight into the merged buffers 24 at a time (`Kit.buildSteps`).
The longest slice measured in this container's software-rendered browser was 12 ms. Until the detail is
ready the simple shells stay up, so nothing ever waits for it. Built districts are kept. On low quality only
the three most recently seen stay in memory, and only what is coming up is prepared. The merged geometry is
identical to before.

The fleet is modelled procedurally (`src/world/vehicleModels.ts`): a lofted
hatchback, a Coaster-style minibus and a utility cart, with glazing occupants show
through, wheel arches, steering front wheels, body pitch and roll, and brake and
reverse lamps driven by the vehicle's motion.

Roadside, district and woodland trees are shared data (`ROADSIDE_TREES`,
`BELT_TREES`), so they collide on clients and the room alike and never stand on a
road; they render as instanced cells culled by distance. Outside the courtyard the
sun's shadow frustum follows the player, so the open world is shadowed too.

