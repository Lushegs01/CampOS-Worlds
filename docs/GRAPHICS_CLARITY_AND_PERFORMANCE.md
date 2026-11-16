# Graphics clarity on Low

The brief: Low must not mean blurry. Profiles are defined in `src/arena/scene/world.ts` (`ARENA_QUALITY`); the
adaptive scaler is in `shared/arena/adaptive.mjs`, driven from `src/arena/Scene.tsx`.

## What was wrong

* **Low drew at a pixel density of 1.** A typical budget phone has a 720 px-wide panel at a browser pixel ratio of
  about 2, so Low rendered at half the panel's resolution and stretched it.
* **The adaptive scaler could fall to 0.6 of that** under load: about 216 px across a 360 px-wide screen.
* **Low filtered textures at 2× anisotropy**, which smears roads and pavements at grazing angles.

## Now

* **Low starts at 1.5× density**, capped by the screen's own pixel ratio.
* **4× anisotropic filtering** on Low (cheap on mobile GPUs).
* **A clarity floor.** The scaler never goes below 0.85 drawn pixels per CSS pixel on touch devices (0.75 elsewhere).
  A phone that cannot hold 30 fps at 1.5× steps down to about the old Low resolution and stops there.
* Unchanged on Low:
  * multisample anti-aliasing;
  * first-person weapons and arms load the full-detail files on every profile (no phone tier);
  * the cheap profile choices: static sun shadow, no post stack, fewer particles.
* **Graphics are independent of the network:** nothing in the profiles or the scaler reads connection quality
  (`tests/net-quality.test.mjs`).

`tests/graphics-clarity.test.mjs` asserts each of these. It simulates two minutes at 12 fps and checks that the drawn
density stays at the floor.

## Cost, and what is not measured

Starting Low at 1.5× is up to 2.25× the pixels of the old Low on a phone with a pixel ratio of 1.5 or more. Whether a
given phone holds 30 fps there is **not measured**: no physical device was available. The scaler is the safety net, and
the floor bounds how far it can trade sharpness. Real-device frame times (itel S24 and similar) remain the open item in
[DEVICE_VALIDATION.md](DEVICE_VALIDATION.md).
