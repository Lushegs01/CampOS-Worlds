# Capture checklist: what this trailer staged, and what a live session would add

Every frame in the film is rendered by the game itself (`src/`, High quality) from the real Òrìṣun
Campus. Nothing was painted, generated or composited into the world except the titles, location
labels, tour route and logo, which are motion graphics on top of the picture.

To get the cinematic camera, the takes were **staged**. That is how this was done, and what it means:

| What you see | How it was made | Faithful? |
|---|---|---|
| The player walking, sprinting, waving, cheering, dancing | The real local player, driven through the same input fields the keyboard writes (`trailer/rig/cinema.ts`) | Yes: real movement, collision and animation |
| Other players around campus, name tags | Entries in the client's own player list, exactly as the room server would send them, rendered by the game's `PeerAvatar` | The rendering is real; the people are staged (no live session) |
| Driving the Campus Compact with a friend aboard | The real vehicle physics in offline mode; the player boards through the driver's door | Yes |
| The jump shot that scores | The real ball physics and shot request; the release is timed to the scoring charge | Yes, and the slow motion is the game's own simulation run at a slower clock |
| Library doors open, the golden keepsake | The real door and keepsake | Yes |
| Name tags on other players | The game's own tags | Yes |

## Deliberately left out

- **Economic Simulation Lab.** The brief treats it as unreleased, so the capture server
  (`trailer/vite.capture.config.ts`) builds the campus without the hall, its door and its path,
  as it stood before commit `1f2b585`. Nothing else is changed.
- **Interface panels** (map, chat, friends, events, Court Duel scoring, challenge HUD). The film shows
  the world only, so no interface could be misread as fake. They are real features, so a cut that
  includes them is fine (see below).
- **Voice chat, tournaments, team basketball**: not built (`docs/IMPLEMENTATION-STATUS.md`), not shown.
- No player counts, testimonials, launch dates, platforms, awards, partnerships or website. None were
  supplied.

## Shots worth capturing live (for a future cut)

These would make the film more authentic or cover features the brief mentions that the world-only
cut cannot show:

1. **A real multiplayer session**: 6–10 people in one room meeting at The Confluence and walking in
   through the gate together (replaces the staged crowd in `03-connect`, `05-landmark`, `06-rise`).
2. **Your room in Palm House** (personal spaces): entering, arranging furniture, a friend visiting
   (`docs/DORM-ROOMS.md`). Lives far east in Palm Residences; needs the dorm system running.
3. **A Court Duel** between two signed-in players: the 60-second shootout with its real scoring panel.
4. **A club event check-in** and the **Campus Loop** driving challenge with its checkpoint marker and HUD.
5. **The avatar editor** ("Make it you") on a phone, for the personalisation beat in scene 03.
6. **A phone screen recording** of the touch controls, for platform ads that need "real gameplay on a phone".

Each can be re-staged with the same rig (add a take to `trailer/shots/index.ts`) or recorded from a
live session and dropped into the edit (`trailer/edit/edit.json`) as a plate folder of PNG frames.
