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

Second round of this pass, also done:

* open door leaves are solid;
* three door defects fixed (two opened onto stairs);
* accessibility audits over every map;
* Low clarity (1.5× density, 4× filtering, a clarity floor);
* server snapshot back-off for congested clients;
* background model decodes no longer abandoned on slow devices.

See [BUILDING_INTERIOR_ACCESSIBILITY.md](BUILDING_INTERIOR_ACCESSIBILITY.md),
[GRAPHICS_CLARITY_AND_PERFORMANCE.md](GRAPHICS_CLARITY_AND_PERFORMANCE.md) and
[DEVICE_VALIDATION.md](DEVICE_VALIDATION.md).

Still open from the brief:

* **Blender.** No Blender MCP connection, and no new Blender-authored asset in this pass. Remaining art: weapon
  remodels, vehicles, soldier rig and clips (jump, fall, land, slide, hit reactions), interior uniqueness and lifts,
  facades.
* **Maps.** Audited: Foundry Yard and Sim Quad had no sealed rooms. Bots cannot path inside Okun Tower's narrow stair
  core. Interiors still come from one generator, with no lifts.
* **Weapons.** Inspection has no sound except on the M7. The 14 licensed weapon models were not remodelled: Blender
  was used for the part they lacked (the Sparrow's magazine), not to replace production models.
* **Vehicles.** Five Blender vehicles replace the code-drawn cars, pickups, buses and vans. Still open:
  * the container lorry is code-drawn;
  * vehicles are static cover, with no wheel, door or suspension animation;
  * glass is baked opaque, so there are no visible interiors;
  * they add 2.70 MB (desktop) and 1.40 MB (phone) to the first deployment.
* **First-person body.** Verified in a live match (PASS, stills in `docs/screenshots/arena/body/`). Open: no air,
  landing or slide clips; feet hidden behind the chest when standing still; the vest texture is soft up close.
* **Networking.** No binary or delta protocol, and no kernel-shaped (netem) browser test.
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
