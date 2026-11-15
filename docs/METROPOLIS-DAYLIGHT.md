# Operation: Metropolis — daylight fidelity pass

Direction: a short clip of a modern military shooter in daylight, supplied by the product owner as the visual
benchmark (a rooftop over a weathered low-rise district: hazy dry daylight, soft sun, lifted shade, rendered walls with
brick dressings and shutters, poles and sagging cables everywhere, a big optic on a detailed rifle). It defines the
target for *quality*, not content: Operation: Metropolis keeps its layout, streets, districts, buildings and Okun Bay
identity. No asset, texture, model, sound or frame of the referenced game is used or committed; everything added here is
procedural geometry and shader code written for this game.

Gameplay, collision, shots, glass, the train, networking and hit registration are unchanged: every addition is
presentation geometry, out of reach or flat against a wall, and none of it is in the shared collision map.

## 1. Audit — where the gap to the reference was

The rendering pipeline was already mature (PBR materials, image-based light baked from the sky, height fog, AO, light
shafts, bloom, a film grade, a per-weather atmosphere; see [PHOTOREALISM.md](PHOTOREALISM.md)). Measured against the
reference and inspected in captures from fixed viewpoints, the remaining gaps were in content and light balance, not in
the shader stack:

| Area | Before | Reference |
|---|---|---|
| Light balance | Shade crushed to near black (5th-percentile luminance 0.02–0.04; avenue mean 0.25) | Lifted shade (p5 ≈ 0.11), mean ≈ 0.44 |
| Sky | A saturated photographic blue sky with cartoon cumulus | Pale blue-grey haze |
| Quick Play weather | Storm Break: storm deck and rain | Dry hazy daylight |
| Facades | Flat rendered walls with plain punched openings | Quoins, lintels and surrounds, sills, shutters, cornices, downpipes |
| Street infrastructure | Lamp columns only | Poles, crossarms, transformers, cables in every view |
| Roofs | Dark gravel | Pale cement |
| Vehicles | The box van a plain white block | — |
| Trees | Large leaf cards visible up close | Fine foliage |
| First person | No self-shadowing: hands and optic never shade the rifle; kick slid home exponentially | Contact shadows on the weapon, weighty settle |
| Phones (Low) | No grade at all (no post stack) | — |

## 2. What changed

### Daylight — `city/atmosphere.ts`, `shared/arena/metropolis.mjs`

* **Harmattan Noon** was retuned from measurements of the reference frames (central region, HUD excluded): pale
  blue-grey sky with thin high cloud and less of the photographic sky, a softer sun (2.9 instead of 3.4, softer shadow
  edge), a much brighter sky and ground bounce (image-based light 1.0 → 1.75, hemisphere fill 0.25 → 0.62, ground
  radiance doubled), blue-grey aerial haze, exposure, saturation and contrast set by comparing captures with the
  reference.
* It is now **Quick Play's weather** (first in `METROPOLIS_VARIANTS`). Its sun stands due south at about 53°, on the
  map's axis of symmetry, like Storm Break's, so neither team looks into it, and it is never in the eye line. Storm
  Break, Rainy Season, Lagoon Sunset and Blue Hour remain for private matches and Training.

### The grade on phones — `scene/grade.ts`

Low has no post-processing stack, so it showed every weather ungraded. The weather's grade (lift/gain tint,
saturation, power-curve contrast) is now folded into three.js' tone-mapping step as a custom tone mapper on Low: ACES,
then the grade, per fragment in the shader every lit material already runs. No extra pass or render target.

### Architecture — `city/kit.ts` (`facade`), `city/structure.ts`

* Solid building fronts (towers, the street walls behind the site): corner **quoins** (alternating long and short
  blocks), a **lintel** over every opening and **jamb surrounds** (brick on most rendered walls, cast stone on brick),
  **projecting sills with a drip**, **louvred timber shutters** (open against the wall, or closed in the reveal),
  **burglar-proof bars** on the lowest windows, **string courses** at each floor, a three-step **cornice** with dentils,
  and a **downpipe** with brackets, hopper head and shoe. Shop fronts gain stall risers and shutter boxes.
* The playable street buildings (built from thin wall boxes and the map's openings): the same lintels, surrounds and
  drips on every window of a rendered or brick wall, open shutters flat against the wall on upper floors (never over
  the server's breakable glass), and quoins on every exposed corner without an opening near it.
* Shutters, poles and timber are new weathered PBR materials (macro variation, grime, wetness like the walls).

### Overhead services — `city/utility.ts` (new)

* Every lamp column carries a timber **crossarm** with braces and three **pin insulators**; every third one a
  **pole-mounted transformer** (drum, fins, bushings, jumpers).
* **Conductors** hang from column to column along each street in catenaries (three phases with slightly different
  sags, plus a lower telephone/data bundle), checked to never pass through a building.
* **Service drops** run from the columns to wall brackets on the nearest building.
* **Bundles across the street**: two to four cables strung wall to wall at 5.5–7 m, with brackets and junction boxes.
  Spans are found by casting against building footprints (their walls are broken by window bands at cable height).
* Nothing is collidable or reachable: cables hang from existing solid lamp columns and building walls.
* **Never thinner than a pixel**: a cable a few millimetres thick is far below a pixel beyond ~15 m and rasterised as a
  dashed line. The cable shader widens each vertex along its normal with distance from the angle of one drawn pixel.

### Props and surfaces — `city/props.ts`, `city/materials.ts`, `vegetation/trees.ts`

* The box van: top and bottom rails, posts every half metre, a rear portal with two doors, hinges, locking bars with
  keepers, bumper and marker lights.
* Flat roofs: pale cement screed instead of dark gravel.
* Street trees (Medium and up): the same crowns grown from smaller, more numerous leaf cards (`cardScale` 0.55: about
  3.3 × the cards at 0.3 × the area each), so card edges no longer read up close. The campus is unchanged.

### First person — `Scene.tsx`

* **Self-shadowing** (Medium and up): the viewmodel's key light casts a 1024² shadow map fitted to a box under a metre
  across around the weapon, so the hands, optic and furniture shade the rest of the rifle as the light falls across it.
* **Kick**: the viewmodel's recoil kick is an under-damped spring (damping ratio ≈ 0.55–0.6, ~12 % overshoot, ~0.4 s to
  settle) instead of an exponential slide: it punches back and settles. Camera recoil, spread, aim and hit
  registration are untouched.
* Weapon and arm **models** are unchanged (see §5).

## 3. Validation

Captures: Chromium with SwiftShader (software WebGL, no GPU) at 1280 × 720, High at 50 % render scale, sun shadow drawn
once (`?qa-static-shadows`), the same five viewpoints before and after (`scripts/qa/metropolis-shots.mjs`, views
`street, avenue, rooftop, plaza, industrial`). The baseline was captured from a separate clean worktree of the commit
before this pass (so no edit could leak into it); the "after" set from a frozen worktree of the final commit.

* Before: `docs/screenshots/metropolis-photoreal/cod-before/`, after: `cod-after/`.
* Side-by-side sheets: `compare-reference/` (`node scripts/qa/metropolis-reference-sheets.mjs`), with
  `tonal-summary.json`.
* Reference frames were used only on this machine, for measurement and side-by-side review; they are never committed
  (the script refuses to write sheets that include them inside the repository).

### Tone against the reference (central region, HUD excluded)

TONE_TABLE

### Renderer statistics (same viewpoints, High at 50 %)

STATS_TABLE

All additions merge into the existing per-material, per-region batches (one draw call per material per region), so
draw calls grow far less than geometry. No new downloads: everything is procedural. Arena 3D chunk
(`arena-Scene-*.js`, minified): 213.4 KB → 226.5 KB (85.6 KB gzipped). Offline precache unchanged (2.49 MB).

### Tests and builds

* `npm test`: **344 passed, 0 failed** (the Quick Play weather test now expects Harmattan Noon; Storm Break is covered as
  a private-match choice).
* `npm run build` and `npm run verify:release`: pass (no QA hooks in production; precache 2.49 MB).

## 4. Performance — what was and was not measured

* Measured (exact): draw calls, triangles and resident geometries per view, above; bundle size; shader programs added
  (one for cables; the viewmodel shadow uses three.js' built-in shadow programs).
* Added per-frame work: the viewmodel shadow pass (Medium and up), about 50 k triangles into a 1024² map, every frame.
  Low pays nothing for it; it also pays nothing for the grade (no extra pass).
* **Not measured: frame rate on any real device.** This container has only software WebGL, whose frame rates mean
  nothing for GPUs or phones. Before release, measure each profile on a mid-range Android phone (Low), integrated
  graphics (Medium) and a discrete GPU (High/Ultra): 60 s on Marina Avenue and the plaza, median and 1 % low frame
  times. If Low phones regress, the first levers are `sides`/`segs` of the cable tubes and quoin courses on Low.

## 5. What remains, honestly

* **Weapon and character models.** The reference's rifle, optic and gloves are authored, high-detail production
  assets. Ours are the licensed models (the M7's textures are 256²); this pass changed how they are lit and how they
  move, not their meshes or textures. Closing that gap needs new licensed or commissioned assets.
* **Vegetation species.** Metropolis is a tropical port city; the reference's conifers and birches would not belong.
  Leaf cards are finer, but trees are still procedural cards rather than authored foliage.
* **Street-level detail beyond what was added**: graffiti, posters and hand-painted signage, litter, potholes with
  depth, authored modular facade kits and interiors. Vehicles other than the van are still simplified bodies.
* **Lighting**: still one sun shadow map over the site (no cascades) and no real-time global illumination; the shade is
  lifted by the image-based light and the fill, which is why it matches the reference in tone but not in subtle
  bounce colour.
* Captures here are software-rendered at reduced resolution; fine geometry (cables, balusters, grilles) reads better at
  native resolution on a GPU.
