# The Getaway visual audit

Baseline at `1449529`. Playwright opened the account-backed campus in Chromium and accepted The Getaway through its mission UI. The six documented views use the in-game renderer, including the campus spring-arm camera for the third-person view and the development inspection camera for close-ups and the wide view.

## Priority findings

1. **The freight yard renders as grass.** The legacy slab has a maximum height of −0.005 m while terrain is at −0.002 m. The yard, road shoulders and motor pool have no visible material separation, and the painted bays appear on top of grass.
2. **Bay 04 has no construction detail.** Its walls and roof are flat-color boxes. The loading doors, drainage, clerestories, trim and fixtures have no modeled counterparts. The surrounding depots have the same blank walls and single dark strips for windows.
3. **The interior reads as an empty bunker.** The crate scans and steel trusses hold up at gameplay distance. The plain floor, uninterrupted walls, sparse equipment and lack of visible practical lighting flatten the space.
4. **The art has few local cues.** The containers use one blue-green palette, the freight gate is a label over an open lawn, and the loading area lacks bay markings, a drainage run and signs of day-to-day freight handling.
5. **The vehicles already have working silhouettes, interiors, glass, body lean and rotating wheels.** The lenses and blank fascia inserts read as simplified plastic, and the wet/dry reflection response is uniform. The existing steering, passenger seats and chase camera are valuable production assets.
6. **The people already use authored Rocketbox rigs and captured locomotion.** Civilian wear fits the campus and needs more context for this district. The small hostile prop is attached to a fixed body offset while the arms animate independently. First-person firing uses a solid geometric flash and a box for the supporting hand. The combat camera snaps to first person at encounter boundaries.

## Rendering architecture

| Area | Baseline |
| --- | --- |
| Renderer | React Three Fiber 9, Three.js r183, exclusive WebGL2 canvas, sRGB output and AgX tone mapping. WebGL context compatibility and ownership are shared with Arena. |
| Materials and formats | MeshStandard/Physical PBR, shared Poly Haven scans in mipmapped Basis KTX2 (campus and Arena), combined AO/roughness/metalness channels, 1024² asphalt, concrete, roof and wood maps, weathering and anti-tiling shaders. The main Getaway shell bypasses the shared library and uses flat material colors. |
| Geometry and delivery | Campus material batches, instanced vegetation and distance-gated district detail. Meshopt GLBs use the shared loader, fetch/decode queues and versioned cache. Getaway props already include container high/low (2,488/176 triangles), a 572-triangle intelligence case, and a 532-triangle truss. Campus vehicles use lofted geometry and merged detail, with animated parts retained separately. |
| Light and sky | A sun-removed photographic HDR drives PMREM reflections and diffuse IBL. Its directional sun casts PCF shadows over a regional frustum. The campus has distance fog and a photographic sky dome. The baseline warehouse has no local light sources. |
| Effects and profiles | High/Ultra use half-resolution N8AO, AgX and SMAA. Medium and Low use native antialiasing. Low switches to a static 1K sun shadow, omits most surface detail maps and grass blades, and uses lower detail distance. The adaptive pixel-ratio controller was already in use. No SSR, baked room probes or volumetric fog in Getaway. |
| Characters | Existing skinned glTF avatars and shared male/female animation libraries, gait phase and blend weights, procedural jump/turn support and distance throttling. Tunde and Sade have 6,722 and 6,992 triangles with 80 skin joints each. Chidi and Ibrahim have 6,434 and 7,084 triangles. The current enemies use Chidi and Ibrahim. The mission has a collision-aware third-person exploration camera and a separate first-person combat path. |
| Performance constraints | Chromium's unmasked renderer on the supplied machine is ANGLE SwiftShader. CPU-rendered measurements are useful for matched regression checks. Device thermal, VRAM and hardware-GPU measurements need actual devices. |

The initial screenshots demonstrated the terrain overlap and missing shell detail before the production changes began. The final comparisons repeat all six positions from the same baseline commit in a connected room.

## Art direction

Orisun Freight serves a subtropical university beside a working logistics corridor. The warehouse uses oxide-red cladding and zinc trim over pale concrete, restrained safety paint in the loading lanes, and warm industrial task lighting against cooler exterior daylight. Architectural details show how the building works: canopy and drain align with the loading opening, extraction rises above each service depot, and conduit follows the columns to the warehouse fixtures. Shipping containers, a forklift, hand trucks and pallets explain the traffic through the yard. Existing drivable models and the user's selected avatar remain the visual basis for gameplay.
