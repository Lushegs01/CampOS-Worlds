# CampOS Worlds: cinematic reveal

A 42-second vertical reveal film (1080 × 1920, 30 fps) and a 16:9 cut (1920 × 1080), made entirely
from the real game. Every shot is rendered by the CampOS Worlds client itself, at its High quality
setting, in the real Òrìṣun Campus. A frame-accurate capture rig drives the game and places a
cinematic camera, so the camera moves do not come from gameplay recordings. The music and sound
design are original, synthesised in this folder; the only recordings used are the game's own CC0
ambience and engine sounds.

| | |
|---|---|
| Films | `deliverables/campos-worlds-reveal-9x16.mp4`, `deliverables/campos-worlds-reveal-16x9.mp4` |
| Captions | `deliverables/captions/on-screen-text.srt` (every word shown), `voiceover.srt` (script on the cut) |
| Audio | `deliverables/audio/mix.wav` (48 kHz / 24-bit, −14 LUFS), stems: music, bass, drums, fx, ambience |
| What was staged, what to capture live | [`CAPTURE-CHECKLIST.md`](CAPTURE-CHECKLIST.md) |

## The film

120 BPM, so a beat is 15 frames and a bar 2 s; every cut and title lands on the grid.

| Time | Scene | Takes (`shots/index.ts`) | On screen |
|---|---|---|---|
| 0–4 s | 01 The hook | From darkness, a line of light opens on the campus in silhouette; the camera rushes down the south avenue, under the ÒRÌṢUN UNIVERSITY gate, over the palm avenue, and rises into the aerial | WHAT IF CAMPUS WAS A WORLD? |
| 4–10 s | 02 Enter the world | High orbit and crane down into a low tracking shot behind the player; a lateral sprint past lamp posts and a flamboyant trunk; over the shoulder to Adunni Learning Commons, whip pan | EXPLORE. |
| 10–16 s | 03 Make it yours | A friend walks up and waves (the game's name tag); a 180° orbit; four looks on four beats (the game's characters and accessories); through the library doors; three friends sprinting for The Courts | CONNECT. / MAKE IT YOURS. |
| 16–24 s | 04 Live the moment | Wheel-height drive; the car passing the gate; a slide along the court fence; the jump shot in slow motion (the game's physics at a slower clock) through the net; the cheer; a golden keepsake in the library; an overhead whirl | EXPLORE. / COMPETE. / DISCOVER. |
| 24–32 s | 05 Your campus, your stories | Orbit of The Confluence with location labels pinned to real places; a crane down to friends on the auditorium forecourt; a dolly between the palms; the pull-back while the five-stop campus tour draws itself on the real walks | YOUR CAMPUS. / YOUR STORIES. |
| 32–42 s | 06 The reveal | Players walk in through the gate; the camera rises past the lettered beam into the symmetrical aerial; the CampOS mark rises in gold, settles into the header lockup | CampOS Worlds · A CAMPUS YOU DON’T JUST VISIT. YOU EXPERIENCE. |

The logo is the game's own lockup (`src/App.tsx`, `src/styles.css`): three gold bars skewed −12°,
"CampOS" in Manrope 750, a divider, "WORLDS". The symbol is extruded in three dimensions and lit by
the campus sky; the wordmark and all type are set in the game's bundled fonts (Manrope, DM Sans) and
colours.

**No voiceover** is in the film. No recorded or licensed voice was available, and a synthetic voice
would not meet the brief, so typography, music and gameplay carry the story as the brief allows. The
exact script is placed on the cut in `edit/voiceover.json` (with pronunciation notes) and
`deliverables/captions/voiceover.srt`, ready for a recording session. The mix leaves room under it.

**No website or call to action**: none was supplied.

## How it is made

```
shots/index.ts          the takes: staging (player, friends, car, ball, doors) and camera, in campus metres
rig/clock.js            virtual time: the game advances exactly 1/30 s per frame however long a frame takes
rig/cinema.ts           drives the real game (inputs, peers, vehicle, ball) and places the camera each frame
rig/camera.ts           camera language: splines, speed ramps, orbits, operator shake, damped follow
vite.capture.config.ts  the game's dev server on port 5180, without hot reload and without the Economic Lab
tools/render.mjs        renders takes to PNG plates (headless Chromium), with multi-sample motion blur
edit/edit.json          the edit: cuts, transitions, titles, brand timing (picture and sound both read it)
edit/cues.json          moments measured from the takes (gate pass, the ball through the net) for sound sync
compose/                compositor: grade, transitions, kinetic type, tracked labels, tour route, 3D logo
tools/compose.mjs       composites every frame of the film
audio/score.py          the score and sound design (numpy/scipy), stems and the mastered mix
audio/analyze.py        loudness per section, stem balance and a spectrogram: a mix check without ears
tools/encode.sh         H.264 / AAC delivery encode (BT.709, fast start)
tools/captions.mjs      caption files from the edit
tools/survey.mjs, trace.mjs, profile.mjs, check-capture.mjs, sheet.sh   scouting, timing and diagnostics
```

### Rebuild

Requirements: the repository's own (`npm ci`), Chromium (Playwright's, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`),
ffmpeg, ImageMagick (contact sheets only), Python 3 with numpy and scipy.

```sh
npx vite --config trailer/vite.capture.config.ts --host 127.0.0.1     # capture server, port 5180

node trailer/tools/render.mjs --aspect 9x16 --workers 2                 # plates (hours in software WebGL)
node trailer/tools/render.mjs --aspect 16x9 --workers 2
node trailer/tools/render.mjs --aspect 9x16 --scale .3 --every 2 --quality low   # fast blocking preview

python3 trailer/audio/score.py trailer/out/audio                        # music and sound, about 30 s
node trailer/tools/compose.mjs --aspect 9x16                            # frames
trailer/tools/encode.sh trailer/out/frames/9x16-1080x1920 trailer/out/audio/mix.wav trailer/deliverables/campos-worlds-reveal-9x16.mp4
node trailer/tools/captions.mjs
```

Renders are deterministic: time is virtual, random numbers are seeded and the room socket is held
offline, so a take renders the same frames every time. To change a move, edit its take in
`shots/index.ts`, re-render only that take (`--shots 04-swish`), and re-composite.

On a machine with a GPU, drop the SwiftShader flags in `tools/render.mjs` for much faster renders.
