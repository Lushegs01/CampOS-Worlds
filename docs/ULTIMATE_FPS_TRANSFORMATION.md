# Ultimate FPS transformation: pass report (November 2026)

This pass started from branch `lushegs/admiring-meitner-7pr9uq` at `b5436c3` (PR #43 merged) with a clean tree. The
baseline was `npm test`: **361 passed, 0 failed**.

The brief asks for everything at once. Earlier passes had already delivered a large part of it:

* a Blender pipeline;
* enterable Metropolis towers to the roof, with server-authoritative doors;
* the first-person animator with IK hands;
* reload choreography;
* the photoreal renderer.

See [AAA_TRANSFORMATION_REPORT.md](AAA_TRANSFORMATION_REPORT.md) and [METROPOLIS.md](METROPOLIS.md). This pass
audited the code against the brief's non-negotiables and fixed the ones that were verifiably missing or broken.

## Audit findings that drove this pass

| Requirement | Found in the code | Now |
|---|---|---|
| Both hands visible with the knife | Support-hand target 30 cm below the bore: **off screen** (knife and axe) | Guard pose in view, follows stride, sprint and swing |
| Per-weapon grips, no generic fallback | `specOf` **silently used the Vanguard's grip** for any uncalibrated weapon | No fallback; validator over all 14 catalogue weapons |
| Anchors match the models | Unchecked | Checked against GLB bounds: found and fixed the **Bastion sight 3 cm above the gun** |
| Moving parts animate | Bastion pump and Thorn cylinder fused (animator code existed but had nothing to move) | Split out; both cycle per shot |
| Legs and feet visible when looking down | **No first-person body at all** | Own soldier, head and arms collapsed, driven by stance and speed |
| Arena assets cached between visits | No runtime caching; arena code excluded | Versioned cache-first for hashed code and revisioned assets; private paths never cached |
| Asset manager | None | Settings → Downloaded assets |
| Network quality measured | Ping only | RTT, jitter, loss, snapshot gaps, corrections, reconnects → grade and HUD indicator |
| Adapt to jitter | Fixed 100 ms interpolation | 100–200 ms from measured jitter (hit registration stays exact) |
| Old state never overwrites newer | Not guarded across reconnects | Older-ack states ignored |
| Graphics independent of network | True, but untested | Tested |

## Tooling available in this session

* **No Blender MCP server was connected**, and no Blender binary is installed. Blender 5.3's `bpy` module installs and
  imports, as in the previous pass, but **no new Blender asset was produced in this pass**. Every change here is code,
  calibration, or a split of existing licensed models.
* No physical devices and no audio output.

## Verification

| Check | Result |
|---|---|
| `npm test` | **375 passed, 0 failed** (baseline 361; 14 new in `arena-weapon-anchors`, `asset-cache`, `net-quality`) |
| `npx tsc --noEmit` | clean |
| `npm run build`, `npm run verify:release` | pass; precache 2.49 MB (unchanged) |
| Service worker in a browser (production build) | cached on use, replaced on a new revision, no private path cached |
| Melee and weapon stills and sequences | `docs/screenshots/arena/melee/`, `…/visual/bastion-pump-cycle.png`, `…/visual/thorn-cylinder.png` (QA renderer, same animator and arm solver as the game) |
| First-person body in a live match | `scripts/qa/arena-body.mjs`; see [REMAINING_LIMITATIONS.md](REMAINING_LIMITATIONS.md) for the status of its run |

## Details

* [WEAPON_ASSET_AND_GRIP_VALIDATION.md](WEAPON_ASSET_AND_GRIP_VALIDATION.md): calibration, validator, asset table,
  melee guard.
* [FIRST_PERSON_BODY_AND_ANIMATION.md](FIRST_PERSON_BODY_AND_ANIMATION.md)
* [LOW_BANDWIDTH_NETWORKING.md](LOW_BANDWIDTH_NETWORKING.md)
* [OFFLINE_ASSET_CACHING.md](OFFLINE_ASSET_CACHING.md)

The other documents the brief names already exist and were not duplicated:

* building accessibility: [METROPOLIS.md](METROPOLIS.md) § Enterable towers and § Doors;
* Blender pipeline: [BLENDER_ASSET_PIPELINE.md](BLENDER_ASSET_PIPELINE.md);
* graphics profiles and device validation: [PHOTOREALISM.md](PHOTOREALISM.md) and
  [MOBILE-PERFORMANCE.md](MOBILE-PERFORMANCE.md).

None of those systems changed in this pass.
