# Operation Photorealism — Metropolis rendering upgrade

Continued from `main` at `3c9fd39` (merged PR #37). Scope: the Combat Arena's Operation: Metropolis map (the
"Downtown" screenshot is its Marina Avenue district), its sky, lighting, materials, weather, effects and first-person
presentation. Gameplay, collision, networking, hit registration and the other maps are unchanged.

## 1. Audit (Stage A)

| Area | What the repository has |
|---|---|
| Engine | three.js r183 through React Three Fiber 9, WebGL 2 only (no WebGPU path). `src/arena/Scene.tsx` owns the renderer, frame loop, post stack and first-person pass. |
| Post stack | `postprocessing` 6.39 (half-float buffer): N8AO, bloom, ACES tone mapping, grade, vignette, SMAA; the weapon renders in its own scene over a cleared depth buffer. Low has no post stack (renderer ACES). |
| City | Procedural: `src/arena/scene/city/*` turns the shared collision map (`shared/arena/metropolis.mjs`, axis-aligned boxes) into merged geometry per material and region (3 × 3 street grid, station, far skyline). Facades are built around window reveals; props are photoscanned GLB instances. |
| Materials | Poly Haven CC0 PBR sets (albedo, normal, packed AO/roughness/metal) as Basis KTX2, 1K and 512² tiers, world-space UVs. Normal/ARM maps stream in after deployment. |
| Lighting | One shadow-casting sun (PCF, 1024–4096²), a hemisphere fill, the campus HDR (Kloofendal, CC0) as image-based light for every weather, a small pool of point lights following the player. Two disagreeing variant tables (`CITY_LIGHT`, `cityLighting`). |
| Weather | Rain was ~2,600 white line segments around the camera; wet streets were a global darken/roughness change. The rainy variant used the sunny photographic sky, scaled darker. |
| Weapons | Licensed GLB models with PBR textures, procedural IK arms, recoil springs, reload timelines from `sound/reloads.mjs`; an additive soft-disc muzzle flash. |
| Profiles | Low / Medium / High / Ultra (`src/arena/scene/world.ts`) with resolution scale and adaptive step-down. |

Visible limitations in the baseline captures (`docs/screenshots/metropolis-photoreal/before/`): every window a flat
black or flat beige rectangle; plaster and brick visibly repeating at 2–3 m; white palm trunks (the bark material had
no texture); rain under a blue sunny sky; no aerial perspective (far towers as saturated as near walls); the skyline's
window texture drew 0.75 m "storeys"; balconies as solid boxes; effects debris and blast marks landing at y = 0 while
Metropolis' street is at y = 5.

Baseline renderer statistics (software WebGL, 1280 × 720, Low): 377–636 draw calls and 0.35–0.60 M triangles per
frame depending on the view; High rain street view 1,255 calls and 0.97 M triangles (shadow map redrawn every frame).

## 2. What changed

All new rendering code is in `src/arena/scene/city/` (Metropolis only) plus two shared pieces (`scene/grade.ts`,
`scene/fx.ts`). Collision, movement, shots, glass breaking and the train are untouched: every new object is
presentation geometry and none of it is placed where a player can stand.

### Atmosphere, sky and image-based light — `city/atmosphere.ts`

* One model per weather (`ATMOSPHERE`): sun direction/colour/irradiance and shadow softness, sky (zenith, horizon,
  ground, cloud layer, city glow), height fog, exposure, IBL strength, a small bounce fill, and the grade. The two
  previous, disagreeing tables (`CITY_LIGHT` in `metropolis.ts`, `cityLighting` in `city/index.ts`) are now derived
  from it.
* **Sky**: a radiance model — zenith/horizon gradient, Mie glow around the sun, an HDR sun disc (it blooms), an fbm
  cloud layer self-shadowed toward the sun and lit from below by the city at night, horizon haze that equals the fog
  colour. Harmattan Noon and Lagoon Sunset still blend in the CC0 photographic sky (graded); Rainy Season is a low
  overcast; Blue Hour has the sodium glow of the city on its clouds. Cloud noise octaves follow the profile.
* **Image-based light**: that sky (and a ground hemisphere) is rendered into a cube map once per match and
  prefiltered (PMREM), replacing the sunny campus HDR for every variant. Shade, window and puddle reflections, and
  the first-person weapon's reflections now show the sky the player sees. 64² (Low) to 256² (High/Ultra) faces.
* **Aerial perspective**: exponential height fog integrated along each view ray, added to three.js' own fog chunks
  so every material (including streamed props) gets it; colour brightens toward the sun. It is denser at street
  level than over the roofs; distant towers fade into the haze they stand in. Densities were reduced for the rain and
  night variants after review so that the 100 m avenue keeps enemies readable (rain: ~50 % contrast loss at 100 m).
* **Exposure adaptation**: the exposure opens up indoors and in the station and closes outside (faster closing,
  as the eye does), driven by the existing roof probe — no GPU read-back.
* **Grade** (`scene/grade.ts`, Medium and up): after ACES, a luminance-weighted lift/gain tint (cool shade, warm
  light), luma-preserving saturation, contrast about mid-grey and a very fine grain against banding. Vignette was
  reduced. No sharpening, chromatic aberration, lens distortion or motion blur (deliberately: they hide detail and
  hurt readability in a competitive shooter).

### Surfaces — `city/surfaces.ts`, `city/materials.ts`

City materials carry named shader layers (kept by clones), applied in one compile hook. Noise is one filtered,
mip-mapped texture fetch per octave (cheaper than ALU hashing on phones, and it averages out at distance instead of
sparkling).

* `macro` — large-scale tone, warmth and roughness variation in world space: breaks the 2–5 m texture repeat.
* `grime` — walls: a darker, browner splash zone at the foot, rain-washed runs in patches; also vehicles' lower bodies.
* `road` — asphalt: rectangular patch repairs with sealed seams, oil stains, faint polished wheel tracks.
* `wet` — rain: porous surfaces darken, everything gets smoother; walls darken in uneven runs.
* `puddles` — rain on the ground: standing water where the noise is low (flat, mirror-smooth, dark), a damp rim,
  and rings spreading from raindrops (two animated cell layers) only in the water.
* `reflect` — the planar street reflection (below), read through the rippled normal.
* `interior` — the previous per-place lighting (shops warm, station cool), now on the same system.

All layered materials share **one program**: each layer's code sits behind a test of the material's `uLayers`
bitmask (a uniform branch). A program per layer combination raised the Low profile from 48 to 61 shader programs;
with the shared program it is 54. This matters beyond load time: where a driver lacks `KHR_parallel_shader_compile`
(SwiftShader here, and some Android drivers), `compileAsync` compiles on the main thread, the page stops reading its
sockets and the server's 10 s heartbeat can drop the player during deployment.

Palm trunks use the campus' CC0 palm bark (they were untextured white). Vehicle and shop glass is now dielectric
(Fresnel reflection) instead of a dark metal.

### Windows — `city/windows.ts`

Every pane on every solid building, shop front and curtain wall is one quad whose shader traces the view ray into
a room behind the glass (interior mapping): walls, floor, ceiling and light fitting, a low piece of furniture and a
cabinet (both ray-box tested, with parallax), a picture, blinds or curtains just behind the glass, contact darkening in
the corners. Paint, flooring, depth, furniture and whether the light is on come from a per-window seed; daylight
falls off with depth; lit rooms follow the variant (a quarter of offices by day, most at night). Shops are deep and
bright with stock on the walls; curtain-wall offices have ceiling panels and full-height glass. The glass is ordinary
PBR glass, so the façade reflects the sky at grazing angles and shows the room face-on. One material, one draw call
per region.

### Architecture — `city/kit.ts`, `city/structure.ts`, `city/props.ts`, `city/world.ts`

* Balconies: slab with drip edge, upstand, handrail and real balusters (Low keeps a solid panel).
* Unreachable roofs (residential towers, the street walls behind the site) get a working roofscape: parapet with
  coping, lift overrun with door, louvred plant, a black water tank on a steel stand, antenna masts, satellite
  dishes, vent stacks.
* Curtain walls become interior-mapped office floors behind the spandrels and mullions.
* Skyline towers: the 64 × 128 canvas texture (which drew 0.75 m "storeys") is replaced by a façade shader in world
  space — 3.4 m storeys, bays, anti-aliased frames, reflective glass, random lit offices at dusk and night, three
  styles (punched windows, ribbon glazing, curtain wall).
* The bus gains window pillars, wheel arches, bumpers, a rear grille and a rounded roof pod; bus shelters show lit
  poster art (original fictional brands) instead of a flat emissive panel.

### Weather — `city/weather.ts`, `city/reflection.ts`

* **Heightfield** of the map (highest surface per 0.5 m cell): rain stops at roofs, awnings and canopies; splashes
  land on whatever is there; the arcade stays dry; under cover the rain outside is still seen.
* **Streaks**: instanced quads along the wind, shutter-length, never thinner than a pixel, faded near the eye; lit by
  the sky and glinting near the eight nearest street lamps.
* **Curtains**: one to three cylinders of falling streaks at 16–52 m, depth-tested against buildings and fogged —
  the distance is veiled by rain, not only by fog.
* **Splashes**: rings and droplet crowns re-seeded each cycle around the player, on the surface beneath.
* **Lamp halos and light cones** in rain and at night (scattering in wet or dark air).
* **Planar street reflection** (High, Ultra; rain only): the scene drawn once more from the camera mirrored in the
  street plane at 40 % / 60 % resolution with an oblique near plane 4 cm above the street. Only façades, glass, the
  city's lights, vehicle bodies and the skyline are drawn into it (ground-level geometry is excluded: the pavement
  slabs straddle the plane and their undersides blocked the view); lights are enabled on its layer. High refreshes it
  every second frame, Ultra every frame. Puddles and wet asphalt show the buildings, signs and lamps above them
  instead of reflecting open sky inside a street canyon. Reflection samples are guarded against NaN/Inf (one
  invalid texel otherwise spreads through the bloom blur).

### Effects and first-person — `scene/fx.ts`, `Scene.tsx`

* Debris and sparks landed at y = 0; Metropolis' street is at y = 5. They now land on the surface beneath
  (heightfield, platform or track), and explosion dust rings and scorch marks sit on it too (they were invisible,
  under the street).
* Smoke and dust use an irregular procedural puff instead of a perfect disc, and take the scene's light level (they
  no longer glow at night).
* The muzzle flash is a procedural petal flash with a hot core instead of a soft disc.
* The first-person weapon reflects the baked sky of the variant and dims its reflections in the station.
* Weapon models, firing, recoil, reload and inspection animations, hit registration and input are unchanged.

### Fixes found along the way

* **Signs overdrawn on Low** (pre-existing): signs were 512 px wide plus a 4 px gutter, so Low's 1024² atlas held one
  per row and most later signs were drawn over earlier ones. Signs are now drawn at the atlas' scale (sizes are given
  for 2048²) and identical signs share one slot; a warning is logged if the atlas ever fills.
* **Remount safety**: React's development double-mount disposed the reflection and reset the wet-street uniforms
  right after creation (wet streets were silently dry in development). Shared city state is now attached on mount.
* **Server heartbeat** is an option (`heartbeatMs`, default 10 s, unchanged in production) so software-rendered
  QA runs are not dropped while shaders compile.

## 3. Validation and measurements

(Filled in from the capture runs.)
