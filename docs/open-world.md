# Òrìṣun open-world expansion

The original courtyard uses metres: player radius 0.3 m, walking 4.5 m/s,
sprinting 8 m/s, doors 1–4 m wide and basketball rims 3.05 m high. Its
movement boundary was 138 × 128 m. None of its furniture is rescaled.

The authored expansion uses a 2,800 × 2,800 m playable boundary, a connected
8,145 m transport network, six additional districts and 18 usable ground-floor
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
