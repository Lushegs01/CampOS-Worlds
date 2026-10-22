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

The fleet is modelled procedurally (`src/world/vehicleModels.ts`): a lofted
hatchback, a Coaster-style minibus and a utility cart, with glazing occupants show
through, wheel arches, steering front wheels, body pitch and roll, and brake and
reverse lamps driven by the vehicle's motion.

Roadside, district and woodland trees are shared data (`ROADSIDE_TREES`,
`BELT_TREES`), so they collide on clients and the room alike and never stand on a
road; they render as instanced cells culled by distance. Outside the courtyard the
sun's shadow frustum follows the player, so the open world is shadowed too.

