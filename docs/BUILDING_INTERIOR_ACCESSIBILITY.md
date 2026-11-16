# Building and room accessibility

What can be entered, and how it is checked. The Metropolis towers, upper floors and doors were made enterable in
earlier passes ([METROPOLIS.md](METROPOLIS.md) § Doors and § Enterable towers). This pass added automated audits over
every map and fixed what they found.

## Audit method

Reachability is measured on the bots' navigation graph:

* built from each map's real collision boxes, with every door open and open leaves as obstacles;
* 1 m cells, a 0.3 m body radius, and steps up to 0.55 m;
* from both teams' spawns.

Every walkable surface that cannot be reached is then classified:

* **Open sky above** (within 4 m): a roof or the top of a prop. These are not intended to be played: warehouse roofs,
  canopies, container and kiosk tops.
* **A ceiling above**: an enclosed space. The surface it stands on decides what it is:
  * anything 0.45–3.5 m tall with under 12 m² of footprint (desks, counters, racks, cars, tables) is furniture, not a
    floor;
  * anything else is a sealed floor: a defect.

## Results (all maps)

| Map | Walkable spots | Reachable | Sealed enclosed floor |
|---|---|---|---|
| Foundry Yard | 4,608 | 3,896 | none (warehouse with catwalk, and pump house, both enterable; the rest is roofs and cargo tops) |
| Sim Quad | 5,988 | 4,620 | none (both teaching blocks enterable to the upper floor and balcony; the rest is roofs, arcade roofs, rail and desk tops) |
| Operation: Metropolis | 17,825 | 13,736 | none after the fixes below |

Foundry Yard and Sim Quad have no hinged doorways: their warehouse bays and arcades are open structures. Their
interiors were already open; nothing on those maps was sealed.

## Defects found and fixed

* **The underground service corridor's north door opened onto the side of the plaza entrance stairs.** Outside it was
  a 0.45 m ledge, then steps 1.25–2 m above the sill. The corridor now runs 3.5 m further east under the plaza, and the
  door opens onto the concourse at the foot of the stairs. Mirrored east.
* **The corridor's crate** left 1.0 m beside it. A player fits, but the bots' grid did not, so bots could not route
  through the corridor. It is now slimmer and against the north wall: the same cover, with 1.4 m clear.
* **Marina House's alley door opened under the fire escape**: 0.75–1.75 m of headroom, so a player could only crouch
  out under part of it. It now opens under the fire escape's top landing (3.25 m headroom), and the bin that would
  stand in front of it moved down the alley. Mirrored east.
* **Open door leaves are now solid**, and an open leaf never closes off a space
  (see [METROPOLIS.md](METROPOLIS.md) § Doors).

The spawn sightline audit (`node scripts/qa/metropolis-sightlines.mjs`) still passes: 152 tower windows, none sees an
enemy spawn.

## Tests

`tests/arena-accessibility.test.mjs`:

* **Every door, every map, both sides:** floor within 0.36 m of the sill, and standing room for a player directly
  outside. This is what caught both door defects.
* **No enclosed floor is cut off** from the spawns.

Two areas are named exceptions. Both are reachable by players (checked with the player simulation) but too narrow for
the bots' 1 m grid:

* Okun Tower's 1.4 m stair core;
* the bus platform's 0.3 m step between its screen and the kerb.

Bots do not path into either.

`tests/arena-door-leaves.test.mjs` covers open-leaf collision, symmetry, and that no walkable area is lost.

## Not done

* No unique interior layouts or lifts: tower floors still come from one generator.
* Background skyline streets outside the playable bounds (`bld-back`) remain scenery.
* Bots cannot path inside Okun Tower's stair core.
* No browser-recorded walk through every building in this pass. Earlier passes recorded the towers and doors live
  (`docs/screenshots/arena/doors/`, METROPOLIS.md).
