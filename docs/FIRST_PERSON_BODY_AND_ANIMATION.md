# First-person body

Looking down now shows the player's own body: vest, torso, legs and boots under the camera.

## How it works

* **Same soldier as everyone else sees.** `updateBody()` in `src/arena/Scene.tsx` builds a `Soldier` from the loaded kit
  for `soldierModelFor(player number)` in the player's team camouflage. That is the model other players see.
* **No duplicate arms, no face in the lens.** `Soldier.firstPerson()` (`src/arena/scene/soldiers.ts`) collapses the neck
  (so the head and helmet go too) and both clavicle chains to their joints after each animation update. The viewmodel's
  rigged arms remain the only arms drawn. It carries no rifle, takes no aim pitch, and casts no shadow (a headless,
  armless shadow would read wrong).
* **Driven by the simulation.** Its feet are at the predicted player position (`eye − EYE[stance]`), facing the camera
  yaw. The locomotion clips (idle, walk, jog, run, crouch) are chosen from the measured speed and the stance and sprint
  flags, exactly as for remote players.
* **Placed behind the eye**: 17 cm standing, 26 cm crouched and 42 cm sliding (the hips move back), so the chest and
  legs come into view as the view pitches down and the neck stump stays outside the frustum.
* **Drawn only when useful**: when alive and looking more than about 12° down. Looking ahead it would be out of view,
  so it costs nothing then.

## Validation

`node scripts/qa/arena-body.mjs` runs a live Training match on Operation: Metropolis over the real room server. It
asserts that the body:

* exists and is hidden looking ahead;
* is visible looking down and steeply down;
* stands on the ground, never reaching the eye;
* keeps up with the player while walking;
* stays below the eye when crouched.

It writes stills to `docs/screenshots/arena/body/`. See `REMAINING_LIMITATIONS.md` for this run's status in the
build container.

## Not done

* No jump, fall, landing or slide clip exists: in the air the body holds its last locomotion pose; a slide uses the
  crouch clip.
* No foot locking or IK to stairs.
* No first-person-specific body mesh: it is the third-person soldier with bones collapsed. Up close, the collar edge of
  the vest is the mesh's own geometry.
* Third-person soldiers still do not play the first-person reloads.
