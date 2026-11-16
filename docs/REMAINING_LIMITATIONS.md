# Remaining limitations

## After the November 2026 "ultimate FPS" pass ([ULTIMATE_FPS_TRANSFORMATION.md](ULTIMATE_FPS_TRANSFORMATION.md))

Done in this pass, so no longer open:

* both hands visible with melee weapons;
* per-weapon anchor validation with no fallback;
* the Bastion sight fix;
* Bastion pump and Thorn cylinder moving;
* a first-person body;
* a persistent asset cache and asset manager;
* connection-quality measurement, with a HUD indicator and jitter-adaptive interpolation.

Still open from the brief:

* **Blender.** No Blender MCP connection, and no new Blender-authored asset in this pass. Remaining art: weapon
  remodels, vehicles, soldier rig and clips (jump, fall, land, slide, hit reactions), interior uniqueness and lifts,
  facades.
* **Maps.** Foundry Yard and Sim Quad buildings are not made enterable. Their warehouse bays and arcades are open
  structures, and their interiors were not audited room by room in this pass. Open door leaves still have no
  collision.
* **Weapons.** Longbow bolt and Sparrow magazine are still fused to their models. No inspection animation.
* **First-person body.** No air, landing or slide clips. It is the third-person mesh with bones collapsed.
* **First-person body validation.** The live-match capture (`scripts/qa/arena-body.mjs`) waits for the soldier models
  to stream in (priority 2). In this container's software WebGL they had not arrived within 5 minutes on the first
  run, so the in-game body assertions and stills were **not obtained in this pass**. The script is committed for
  rerunning on a machine with a GPU. The body code is type-checked and builds, but its in-game appearance is
  unverified here.
* **Networking.** No server-side per-client snapshot adaptation, no binary or delta protocol, and no shaped-network
  (netem) end-to-end test.
* **Offline.** No offline practice mode, and no "download everything" pack.
* **Devices and audio.** Still no physical-device frame times and no listening tests. Nothing in this pass is a device
  measurement.

## Earlier pass

Status after the November 2026 Warzone-fidelity pass ([AAA_TRANSFORMATION_REPORT.md](AAA_TRANSFORMATION_REPORT.md)).
This pass delivered one vertical slice: a headless Blender production pipeline and six original props integrated into
Operation: Metropolis. Everything below is **not done**. Earlier passes' open items still stand where they are not
repeated here ([COMBAT-ARENA.md](COMBAT-ARENA.md) § Not built, [METROPOLIS.md](METROPOLIS.md) § Not done yet,
[PHOTOREALISM.md](PHOTOREALISM.md)).

## Tooling

* **No Blender MCP connection.** The session had no Blender MCP server. Assets were built with Blender 5.3's Python
  API (`bpy` module) headlessly. No interactive scene was inspected, and no artist pass in the Blender UI was made.
* **No physical devices.** Every capture comes from Chromium's software WebGL. No frame rate, thermal or battery
  figure from this pass describes real hardware, and none is claimed.
* **No listening tests.** No audio output exists in the build environment.

## Requested by the owner, not started

* **Every building enterable to the top floor.** Done for every building in Metropolis
  ([METROPOLIS.md](METROPOLIS.md) § Enterable towers). Remaining: Okun Tower's crown, mast and sign are not drawn on
  the enterable tower; tower interiors are office floors from one generator (no unique layouts, no lifts); the
  street walls behind the site (`bld-back`) are scenery, outside the playable bounds.
* Doors: an open leaf is not collision (players pass through where it stands open); hinged doors only (no sliding,
  roller or revolving doors); bays and arcades have no doors.

## Art still to produce

* Modular authored facades, building interiors above street level, roof access structures.
* Vehicles: the cars, bus, van, pickups and lorries are still code-built (`src/world/vehicleModels.ts`,
  `city/props.ts`). No wheel, suspension or door animation exists in the arena.
* Soldiers: no new models, rig changes or animation clips. Third-person soldiers do not mirror the new first-person
  reloads or recoil.
* First-person weapons (second pass, [ANIMATION_SYSTEM.md](ANIMATION_SYSTEM.md)): reloads, aiming, recoil and the
  muzzle were rebuilt, but as authored curves rather than motion capture. Weapon meshes are the existing licensed
  models; only the Wasp's and Kestrel's magazines were split out. Compact pistols remain small in frame.
* Other Metropolis box types still drawn by code: kiosks, shelters, vending machines, ATMs, bollards, benches,
  planters, racking, switchgear, the plant rooms (`plant`).
* The Blender props have no LODs (justified at ≤ 8 copies each, but required before wider use) and no destroyed states.

## Systems not changed

Movement, camera, VFX other than the first-person muzzle, explosions, destruction, weather, shadows, reflections, networking, HUD and audio were
audited from their reports and code but not modified in this pass.
