# CampOS Worlds visual pass

## Play it in the browser

Open the campus map and mark **Harbour Exchange**, east of the Industrial District along the freight road. You can walk or drive there on the same shared map. The city has nine commercial blocks, eighteen building shells, a connected street grid, sidewalks, pedestrians and two room-controlled traffic vehicles. The two parked vehicles are available to players. The traffic vehicles run separate loops and yield through the existing vehicle collision system.

For Bay 04, enter **Campaign → The Getaway** and meet Sade at the west gate. The loading yard now has a crane with shared collision footings. The warehouse adds a maintenance catwalk, visible braces and independent work lights with different temperatures. During The Getaway, impacts leave surface marks and the exploded drum leaves soot and debris. Slow pursuits can transition into a containment encounter. Officers step out, take positions beside their cruiser, signal the player and return to the cruiser as the chase resumes. Their state comes from the mission simulation.

Press **P** while driving to switch between the chase and cockpit cameras. Touch users can tap **View**. The compact cabin has a steering wheel, gauge cluster, centre controls and door trim. The mobile combat layout uses the supplied reference’s thumb separation, with the movement control on the left and a prominent fire button near the aim and reload controls on the right.

The browser loads city meshes by distance and uses a shorter range and fewer pedestrians on Performance. The existing environment materials and character rigs are reused. Player skin and clothing receive separate roughness treatment, and police have a fitted vest and cap built around the mounted rigs. The Combat Arena maps and their weapons still use their existing asset pipeline. See [Blender asset pipeline](BLENDER_ASSET_PIPELINE.md) and [asset licenses](ASSETS.md).

## Before and after in the running game

The images pair the baseline at commit `c044799` with the working revision at comparable camera positions. A test-only browser harness positions a player in an isolated room and captures the live renderer. Characters and effect particles can move between frames. The blast pair is a direct canvas capture of the normal renderer so the transient effect is recorded at the selected frame.

| View | Before and after |
| --- | --- |
| Metropolitan street | [Harbour Exchange](screenshots/visual-reference/metropolitan-street.jpg) |
| Warehouse exterior | [Bay 04 approach](screenshots/visual-reference/warehouse-exterior.jpg) |
| Warehouse interior | [Maintenance walkway and work lights](screenshots/visual-reference/warehouse-interior.jpg) |
| Player character | [Player portrait in the freight yard](screenshots/visual-reference/player-character.jpg) |
| Enemy character | [Warehouse guard](screenshots/visual-reference/enemy-character.jpg) |
| Police officers | [Officer by the cruiser](screenshots/visual-reference/officers.jpg) |
| Vehicle exterior | [Getaway compact](screenshots/visual-reference/vehicle-exterior.jpg) |
| Vehicle interior | [Driver’s view](screenshots/visual-reference/vehicle-interior.jpg) |
| Combat encounter | [Bay 04 first-person view](screenshots/visual-reference/combat.jpg) |
| Explosion | [Fuel-drum blast](screenshots/visual-reference/explosion.jpg) |
| Police containment | [Two cruisers and officers](screenshots/visual-reference/police-containment.jpg) |
| Industrial crane | [Freight gantry](screenshots/visual-reference/industrial-gantry.jpg) |

## Reference and remaining scope

The inline image shows the HUD and thumb placement, with the scene blurred behind the interface. The uploaded MOV exceeded the executor’s 32 MiB transfer limit. The environment and asset choices in this revision follow the written visual direction and the project’s coastal campus style. Commercial buildings are playable around their exteriors. The cast still uses the existing licensed human meshes, with added surface work and police equipment.

## Verification

The [camera and draw-count data](screenshots/visual-reference/cameras.json) records the paired browser frames. The nine city parcels total about 2.6 MB on disk and share the existing textures. The city composition increased from about 0.79 million to 0.98 million rendered triangles at the fixed High camera. These counts describe the captured scene. They do not measure frame rate on a phone.

Browser runs covered the finished city, the warehouse encounter, the cockpit toggle, police deployment, and the real mission blast. The landscape touch run exercised the revised controls while fighting and driving. [Mobile combat](screenshots/visual-reference/mobile-combat.jpg) · [Mobile driving](screenshots/visual-reference/mobile-driving.jpg)
