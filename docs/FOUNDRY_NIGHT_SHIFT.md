# Foundry Yard — night-shift visual upgrade

Presentation-only upgrade of Combat Arena's Foundry Yard to a wet, high-contrast industrial night look, plus
lens effects for every arena map. **Nothing in physics, collision, movement, the simulation, networking, rules or UI
changed.** The map's boxes (`shared/arena/maps.mjs`) are untouched; every change is in how they are drawn.

Sim Quad and Operation: Metropolis keep their own lighting. In QA builds, `?foundry-look=day` turns the Foundry look
off (for before/after captures of the same views).

## What changed

| Area | Where | What |
| --- | --- | --- |
| Look definition | `src/arena/scene/foundry/look.ts` | Palette and tuning: emerald `#1aff8c` / amber `#ff6a1a` practicals, slate hemisphere `#131c21` / `#07090b`, `FogExp2`, ACES exposure 1.12, bloom (threshold 0.85, strength 0.35, radius 0.6). The two tones are normalised to equal luminance (emerald is ~2.3× as luminous as amber and otherwise swamps it). |
| IBL | `foundry/environment.ts` | A procedural industrial interior (slate shell, emerald/amber strip lights, cool skylight band, sodium horizon) baked with `PMREMGenerator.fromScene`, replacing the daylight HDR on Foundry. Also a night sky dome that fades into the fog colour. |
| Lighting rig | `foundry/lighting.ts` | Four corner floodlights (SpotLights, diagonal emerald/amber; 1–2 shadow-casting on Medium+ with staggered refresh). A pool of practical point lights (the profile's `lights` count) that follows the camera across the roof fittings and wall lamps with cross-fades. Instanced additive Fresnel light cones (2 draw calls) and drifting dust motes inside the light (1 draw call). |
| Wet floor | `foundry/wet.ts`, `environment.ts` `ground()` | Multi-octave noise puddle mask: damp concrete (roughness 0.72–0.85, darkened) vs standing water (roughness 0.06–0.12, flattened normal, fine animated rain ripples). On High/Ultra the existing planar reflection (`city/reflection.ts`, generalised to take its uniforms) mirrors the yard in the puddles. Every fitting also bakes a soft light pool in its tone into the floor (so the yard reads lit on every profile, Low included). |
| Materials | `environment.ts` `industrialMaterials()`, `foundry/textures.ts` | Canvas-baked PBR sets (albedo, normal, AO/roughness/metal): brushed steel (metalness 0.85, roughness ~0.28) for trusses, columns, frames and machines; worn yellow/black hazard paint on stair nosings, catwalk edges, railing kickplates, machine plinths and new column guards; metal catwalk plate; toned fittings. A weathering layer adds grime, damp wicking from the floor and rain streaks to brick, concrete and cover. |
| Lens (all maps, Medium+) | `src/arena/scene/lens.ts`, `Scene.tsx` | `WorldDepthPass` saves the world's linear depth before the weapon pass clears it. `MotionBlurEffect`: per-pixel camera-velocity blur (turning, strafing, sprinting) at a fixed 1/60 s shutter, stronger when sprinting, none when aiming; respects the campus *reduced motion* preference; off under adaptive load-shedding. `FocusBlurEffect`: a spring-damped focus pull during reload and inspect. Both use the weapon's depth as a mask: weapon and hands stay sharp, and nothing smears from them. Each pass is disabled at rest. |
| Viewmodel | `Scene.tsx` | A dedicated rim light on the weapon and hands (faint and neutral on other maps; tinted with the complementary tone on Foundry). On Foundry the key light takes its colour and direction from whichever practical/floodlight dominates where the player stands. |

The existing muzzle flash light, smoke, brass ejection, impact sparks, decals and spring-damped sway/bob/recoil
(`fx.ts`, `muzzle.ts`, `viewmodel.ts`) were already in place and are reused as they are.

## Fixes found along the way

- **Film grain streaks** (`scene/grade.ts`, also Metropolis): the grain used a `sin()` hash of large arguments,
  which aliased into diagonal streaks across the frame. It now uses an arithmetic hash.
- **Mirrored shelter map** (`environment.ts`): the "under a roof" ambient-darkening map was a `CanvasTexture`
  (flipped on upload) sampled as if unflipped, so it was mirrored in z (the pump-house shade landed on the wrong side
  of the yard). It is now a data texture in canvas row order, like the splat map.
- **QA captures silently ran Low**: `scripts/qa/arena-shots.mjs` set a quality without `qualityChosen`, so the
  arena replaced it with the recommended profile (Low under software rendering). Fixed there and in the new script.

## Budgets

- Texture units: the ground shader is the tightest material (16 samplers on common GPUs). Its roughness is read from
  the AO/roughness/metal map already bound as `aoMap`, and the light pools share the shelter texture (RGB glow, A
  shelter), leaving room for two shadow-casting floodlights.
- Draw calls added: cones 1, beams 1, dust 1; the procedural materials merge with the existing builder chunks.

## Capturing

```bash
LABEL=after QUALITIES=high,medium,low node scripts/qa/foundry-shots.mjs
```

```bash
LABEL=before LOOK=day QUALITIES=high node scripts/qa/foundry-shots.mjs
```

Screenshots go to `docs/screenshots/arena/foundry/`, stats and console errors to `docs/performance/foundry-<label>.json`.
Views: yard, interior, hall, lane, floor, squad, plus reload (depth of field), focus (focus pull held open) and
sprint (motion blur). QA-only hooks: `__arenaLens({ motion, focus, raw })` forces the lens amounts, and
`__arenaLensProbe()` reads the saved world depth.

Software rendering (SwiftShader, no GPU) is the only renderer in CI and in this container, so frame rates in those
JSON files are not representative; frame time on real hardware still needs to be measured.
