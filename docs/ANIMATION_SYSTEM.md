# First-person weapon animation

How the first-person weapon moves, reloads, aims and fires, and how that stays true to the game state. Third-person
soldiers are unchanged by this pass ([COMBAT-ARENA.md](COMBAT-ARENA.md) § Visuals).

## One animator, driven by the simulation

`src/arena/scene/viewmodel.ts` (`ViewmodelAnimator`) poses the weapon every frame from the shared 60 Hz simulation
state (`shared/arena/sim.mjs`): phase and its timer, fire cooldown, ADS amount, velocity, stance and grounded state.
It returns the hand targets that the rigged arms reach with two-bone IK (`FirstPersonArms`, `src/arena/scene/weapons.ts`).
The match (`src/arena/Scene.tsx`) and the QA renders (`scripts/qa/arena-weapons-page.ts`) use the same class, so
reviewed footage is the game's own motion.

The animator is presentation only. It never writes to the simulation state, and nothing it computes feeds aim,
recoil, spread, hits or timing (tested: `tests/arena-viewmodel.test.mjs`). If the server corrects the player, the
simulation's state changes and the animation follows it.

## Reloads keyed to the shared timeline

`src/arena/sound/reloads.mjs` holds, per weapon and per kind (tactical or from empty), the fractions of the reload at
which the magazine leaves the well, the new one goes in, it seats, and the action is worked. The sound bank plays each
part's cue at those fractions; the animator moves the parts at the same fractions of the same simulation timer. Sound
and motion therefore agree at any frame rate, and a cancelled reload stops reaching both.

| Key (plan) | Tactical reload | Reload from empty |
|---|---|---|
| `tilt` | Weapon raised into view, rolled to show the magazine well and turned about the firing hand (the stock stays in the shoulder) | Same |
| `hand[0–1]`, `out` | Support hand to the magazine; the magazine is stripped (curved AK/SMG magazines rock out about their lips) | Magazine released: it falls under gravity, tumbling, out of frame; the hand goes straight to a pouch |
| `out[1]` → `in[0]` | Hand and old magazine down to the pouch below the frame; back with a fresh one | Hand back from the pouch with a fresh magazine |
| `in` | Magazine driven up into the well, accelerating into the stop | Same |
| `seat` | Palm tap; the weapon jolts (spring impulse) | Same |
| `rack` | — | Bolt catch slapped (AR pattern, M7), charging handle pulled and let fly (AK, SMGs, DMR, LMG, semi-auto shotgun), bolt worked by the firing hand (bolt-action), slide released (pistol) |
| `hand[2–3]` | Hand back to the handguard; the weapon settles | After the rack, back to the handguard |

Shell-by-shell loading (pump shotgun) and the revolver's cylinder keep their own paths. The pistol's slide locks
open on the last round and is released by the empty reload. Moving parts hang from pivots at their top
(`weapons.ts`), so a magazine rocks about its feed lips and the revolver's cylinder turns about its centre.

The Wasp's and Kestrel's source models had their magazines fused to the receiver. `scripts/assets/split-weapon-part.mjs`
now splits them out by region (a side-view polygon measured on the `arena-weapons.mjs sheet` grid), so every
detachable-magazine weapon drops, carries and inserts a real magazine.

## Hip, sights and movement

* **Hip.** Low in the right of the frame, the muzzle turned in toward the centre and canted slightly, the stock
  tucked in: the composition of the supplied reference footage. Sidearms sit further out; blades low and turned.
* **To the sights.** A damped spring (slightly under-damped) follows the simulation's ADS amount. The weapon travels on
  a small arc (dips, the muzzle leads, then rises into the eye line) and settles with a little overshoot. On the
  sights the sight line is exactly the camera axis (tested). A slow breathing figure-of-eight moves the reticle.
* **Viewmodel field of view.** 50° at the hip; on the sights 30° for optics, 36° for irons and 34° for sidearms
  (42° at the hip), so an optic fills the eye as it does through a real sight. The world camera's zoom is unchanged.
* **Recoil.** Per class of weapon (`FEEL`): a snap back into the shoulder and up, random roll and yaw (smaller on the
  sights), short high-frequency shake on automatic fire, all on damped springs that settle within about half a
  second. This is the weapon's visual motion only; the aim recoil is the simulation's and is unchanged.
* **Sprint, air, slide, landing.** High-ready canted across the body with a heavier bob; lift and pitch with vertical
  speed; a roll when sliding; a dip on landing.

## Muzzle, light and smoke

`src/arena/scene/muzzle.ts` (`MuzzleFX`) draws, in the viewmodel's own space, a flash that differs every shot. Four
petals fan around the bore, with a face-on star (opaque, over-bright, so it reads against a bright sky) and an
additive white-hot core. A brief orange point light falls on the weapon and the hands. Barrel smoke puffs at each
shot, and a thin wisp rises from a hot barrel after sustained fire; its brightness follows the scene's ambient level.
The world-side flash light, tracers, casings and smoke are unchanged.

## Hands

The source arms wear fingerless gloves. `fullGloves()` derives a per-vertex weight from the rig's finger and thumb
bones and draws those areas as the glove's dark knit, so both hands read as gloved like the rest of a soldier's kit.
There is no texture edit and no new download.

## Reviewing

```sh
node scripts/qa/arena-weapons.mjs fp vanguard,wasp hip,ads,reload,reloadEmpty,sprint,fire   # stills
node scripts/qa/arena-weapons.mjs seq vanguard ads,fire,hipfire,reload,reloadEmpty,sprint   # 30 fps video
BG=dim node scripts/qa/arena-weapons.mjs seq vanguard fire                                  # under cover
node scripts/qa/arena-weapon-match.mjs                                                      # a live match
node --test tests/arena-viewmodel.test.mjs
```

The sequence renders step the same animator on a simulated 60 Hz clock, so their timing is exact. The match capture
records Chromium's software WebGL in real time: correct in time, low in frame rate, and not a device measurement.

## Not done

* Motion is authored as curves in code, keyed to the shared timeline. It is not motion capture, and there are no
  keyframed clips per weapon (finger poses on the magazine, a thumb on the release, a mag check).
* Third-person soldiers do not play reload or recoil animations to match.
* Pistols: with two hands at life size the compact pistols are small in frame. A stylised enlargement was not added.
* Inspect animations exist only for the M7; nothing was added for the other weapons.
