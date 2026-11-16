# First-person body

Looking down now shows the player's own body: vest, torso, legs and boots under the camera.

## How it works

* **Same soldier as everyone else sees.** `updateBody()` in `src/arena/Scene.tsx` builds a `Soldier` from the loaded kit
  for `soldierModelFor(player number)` in the player's team camouflage. That is the model other players see.
* **No duplicate arms, no face in the lens.** `Soldier.firstPerson()` (`src/arena/scene/soldiers.ts`) collapses only
  the head (with the helmet) and the two upper arms, each to its own joint, after each animation update. The viewmodel's
  rigged arms remain the only arms drawn. The shoulders and the top of the vest keep their real shape.
  * Two earlier attempts failed when seen in the game. Collapsing the neck and collarbones dragged the collar and
    shoulders into a smear that filled the view. Cutting the body off at the lower chest showed the vest as a hollow
    ring.
  * A clipping plane 12 cm under the eye (`BODY_CUT`, moved with the camera) remains only as a guard, so the neck
    never reaches the lens.
  * It carries no rifle, takes no aim pitch, and casts no shadow (a headless shadow would read wrong).
* **Driven by the simulation.** Its feet are at the predicted player position (`eye − EYE[stance]`), facing the camera
  yaw. The locomotion clips (idle, walk, jog, run, crouch) are chosen from the measured speed and the stance and sprint
  flags, exactly as for remote players.
* **Placed behind the eye**: 17 cm standing, 26 cm crouched and 42 cm sliding (the hips move back), so the chest and
  legs come into view as the view pitches down and the neck stump stays outside the frustum.
* **Drawn only when useful**: when alive and looking more than about 12° down. Looking ahead it would be out of view,
  so it costs nothing then.

## Validation

`node scripts/qa/arena-body.mjs` runs a live Training match on Operation: Metropolis, over the real room server and
WebSocket protocol, in Chromium software WebGL. It measures the posed skeleton, not the mesh's bounds (a skinned
mesh's bounds are its unposed, arms-out geometry), and asserts:

* the body is hidden looking ahead, and drawn looking down and steeply down;
* its lowest joint is on the ground;
* the guard plane stays at least 10 cm below the eye, standing and crouched;
* the body keeps up with the player while walking.

**Result: PASS** (16 November 2026). Stills in `docs/screenshots/arena/body/`:

| Still | What it shows |
|---|---|
| `1-ahead` | No body drawn |
| `2-look-down` (49°) | A sliver at the bottom edge, behind the rifle |
| `3-look-steeply-down` (77°) | The chest rig: vest, shoulder strap and pouch |
| `4-walking-look-down` (57°) | The vest, and a trouser leg stepping forward beside the rifle |
| `5-crouched-look-down` | The bent knees and thighs |

The software renderer's frame rate is not a device measurement.

## Not done

* No jump, fall, landing or slide clip exists: in the air the body holds its last locomotion pose; a slide uses the
  crouch clip.
* No foot locking or IK to stairs.
* No first-person-specific body mesh: it is the third-person soldier with the head and upper arms collapsed.
* Standing still and looking straight down, the feet are hidden behind the chest (the body stands 17 cm behind the
  eye). They show when walking. Standing the body further back would show them, at the cost of a less natural
  chest view; not yet tuned.
* The vest texture is soft at this distance (it is sized for third-person viewing).
* Third-person soldiers still do not play the first-person reloads.
