// Writes docs/audio/INVENTORY.md from what was actually built: public/assets/arena/audio/manifest.json (every bank,
// file and clip) and docs/audio/qc.json (each clip's measurements and its source recording), plus the previous arena
// sounds and what replaced them. Run after `node scripts/assets/build-arena-audio.mjs`:
//   node scripts/assets/arena-audio/inventory.mjs
import { readFile, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('public/assets/arena/audio/manifest.json', 'utf8'));
const qc = JSON.parse(await readFile('docs/audio/qc.json', 'utf8'));

// Where each sound is used (src/arena/audio.ts and src/arena/sound/events.ts) and what it replaced.
const USE = {
  'w:shot': ['Gunshot, close (≤ 25 m): own shots and other players’ (stereo body, near layer)', 'designs.ts `gun:*:near` (synthesised report/body/crack)'],
  'w:tail': ['Outdoor/indoor tail after the shot, own and others’ within 60 m', 'designs.ts `gun:*:tail` (synthesised noise tail)'],
  'w:mid': ['Gunshot at 25–75 m (crossfaded with the close layer)', 'designs.ts `gun:*:near` with distance filtering'],
  'w:far': ['Gunshot beyond ~40 m (distant report, carries furthest)', 'designs.ts `gun:*:far`'],
  'w:magRelease': ['Reload: magazine catch pressed (animation cue)', 'designs.ts `mech:*:magout` (synthesised clicks)'],
  'w:magOut': ['Reload: magazine pulled out of the well', 'designs.ts `mech:*:magout`'],
  'w:magIn': ['Reload: new magazine entering the well', 'designs.ts `mech:*:magin`'],
  'w:magSeat': ['Reload: magazine seated (latch)', 'designs.ts `mech:*:magin`'],
  'w:boltRelease': ['Empty reload: bolt release slapped, bolt runs home', 'designs.ts `mech:*:charge`'],
  'w:chargeBack': ['Empty reload: charging handle pulled back', 'designs.ts `mech:*:charge`'],
  'w:chargeFwd': ['Empty reload: charging handle released forward', 'designs.ts `mech:*:charge`'],
  'w:dry': ['Trigger pulled on an empty chamber', 'designs.ts `mech:*:dry`'],
  'w:raise': ['Weapon drawn / switched to', 'designs.ts `mech:*:draw`'],
  'w:coverOpen': ['LMG reload: feed cover opened', 'designs.ts `mech:lmg:*` (generic magazine sounds)'],
  'w:coverClose': ['LMG reload: feed cover closed', 'designs.ts `mech:lmg:*`'],
  'w:belt': ['LMG reload: belt laid on the feed tray', '— (new)'],
  'w:shellIn': ['Shotgun: one shell pushed into the tube (per shell, interruptible)', 'designs.ts `mech:pump:shell`'],
  'w:pumpBack': ['Pump shotgun: fore-end back after each shot and after loading', 'designs.ts `mech:pump:pump`'],
  'w:pumpFwd': ['Pump shotgun: fore-end forward', 'designs.ts `mech:pump:pump`'],
  'w:rack': ['Semi-auto shotgun: bolt handle racked after an empty reload', 'designs.ts `mech:shotgun:charge`'],
  'w:boltLift': ['Bolt action: handle lifted', 'designs.ts `mech:bolt:boltaction`'],
  'w:boltBack': ['Bolt action: bolt drawn back (case extracted)', 'designs.ts `mech:bolt:boltaction`'],
  'w:boltFwd': ['Bolt action: bolt pushed forward', 'designs.ts `mech:bolt:boltaction`'],
  'w:boltDown': ['Bolt action: handle locked down', 'designs.ts `mech:bolt:boltaction`'],
  'w:slideDrop': ['Pistol empty reload: slide stop released, slide slams forward', 'designs.ts `mech:pistol:charge`'],
  'w:slideRack': ['Pistol: slide racked', 'designs.ts `mech:pistol:charge`'],
  'w:cylOpen': ['Revolver reload: cylinder swung out', 'designs.ts `mech:revolver:cylinder`'],
  'w:eject': ['Revolver reload: ejector rod, cases out', 'designs.ts `mech:revolver:cylinder`'],
  'w:speedload': ['Revolver reload: speed loader into the cylinder', 'designs.ts `mech:revolver:magin`'],
  'w:cylClose': ['Revolver reload: cylinder closed', 'designs.ts `mech:revolver:cylinder`'],
  'steps:walk': ['Footfall while walking (own and others’, by surface)', 'campus `step-hard/grass/wood` (3 surfaces) + designs.ts `metalstep`'],
  'steps:run': ['Footfall while sprinting', 'campus `step-*` at a higher gain'],
  'steps:soft': ['Footfall while crouched or walking slowly', 'campus `step-*` at a lower gain'],
  'steps:scuff': ['Stop or sharp turn (shoe scuff)', '— (new)'],
  'steps:land': ['Landing after a jump or fall (surface layer)', 'designs.ts `land`'],
  'steps:stairs': ['Footfall on stairs and steps', '— (new)'],
  'movement:cloth': ['Clothing Foley with each footfall, jump and stance change', 'designs.ts `gear` / campus `cloth-*`'],
  'movement:leather': ['Webbing and boot leather with footfalls', '— (new)'],
  'movement:gearLight': ['Carried gear rattle (light loadouts)', 'designs.ts `gear`'],
  'movement:gearHeavy': ['Carried gear rattle (LMG, sniper, heavy loadouts)', 'designs.ts `gear`'],
  'movement:whoosh': ['Jump take-off', 'designs.ts `jump`'],
  'movement:slideHard': ['Slide on hard ground', 'designs.ts `slide`'],
  'movement:slideSoft': ['Slide on soft ground', 'designs.ts `slide`'],
  'movement:bodyfall': ['A soldier’s body falling after elimination', 'designs.ts `body`'],
  'movement:spawn': ['Respawn: kit settling as the soldier appears', '— (new)'],
  'impacts:concrete': ['Bullet impact on concrete at the hit position', 'designs.ts `impact:concrete`'],
  'impacts:brick': ['Bullet impact on brick', 'designs.ts `impact:brick`'],
  'impacts:metal': ['Bullet impact on solid steel', 'designs.ts `impact:metal`'],
  'impacts:sheet': ['Bullet impact on sheet metal (containers, roofs)', 'designs.ts `impact:metal`'],
  'impacts:wood': ['Bullet impact on wood', 'designs.ts `impact:wood`'],
  'impacts:dirt': ['Bullet impact on dirt and gravel', 'designs.ts `impact:dirt`'],
  'impacts:sand': ['Bullet impact on sand and sandbags', 'designs.ts `impact:sand`'],
  'impacts:foliage': ['Bullet through foliage', 'designs.ts `impact:foliage`'],
  'impacts:glass': ['Bullet through glass and lamps', '— (new)'],
  'impacts:flesh': ['Validated hit on a soldier: cloth and flesh (limbs, lower body)', 'designs.ts `impact:flesh`'],
  'impacts:armour': ['Validated hit on the plate carrier (chest)', '— (new)'],
  'impacts:helmet': ['Validated hit on the helmet (head)', '— (new)'],
  'impacts:ricochet': ['Ricochet off hard surfaces at a glancing angle', '— (new)'],
  'impacts:snap': ['Supersonic round passing close (rifle crack)', 'designs.ts flyby snap'],
  'impacts:whiz': ['Subsonic round passing close (pistol, SMG)', 'designs.ts flyby whiz'],
  'impacts:casePistol': ['Spent pistol/SMG case landing', 'designs.ts `casing`'],
  'impacts:caseRifle': ['Spent rifle case landing', 'designs.ts `casing`'],
  'impacts:caseLarge': ['Spent full-power rifle / LMG case landing', 'designs.ts `casing`'],
  'impacts:caseShell': ['Spent shotgun hull landing', 'designs.ts `casing`'],
  'impacts:caseSoft': ['Spent case landing on soft ground', '— (new)'],
  'impacts:magDrop': ['Empty magazine dropped on hard ground', '— (new)'],
  'impacts:magDropSoft': ['Empty magazine dropped on soft ground', '— (new)'],
  'handling:pouch': ['Reload: hand to the magazine pouch', '— (new)'],
  'handling:grab': ['Reload: hand grips the weapon / magazine', '— (new)'],
  'handling:settle': ['Reload end / weapon settles in the hands', '— (new)'],
  'handling:ads': ['Aim down sights (cloth and weapon movement)', 'designs.ts `mech:*:ads`'],
  'handling:swap': ['Weapon switch (weapon lowered)', 'designs.ts `mech:*:draw`'],
  'handling:drawBlade': ['Knife or axe drawn', 'designs.ts `whoosh`'],
  'handling:swingKnife': ['Knife swing', 'designs.ts `whoosh`'],
  'handling:swingHeavy': ['Axe swing', 'designs.ts `whoosh`'],
  'handling:swingRifle': ['Rifle-butt melee swing', 'designs.ts `whoosh`'],
  'handling:stab': ['Knife strike landing', 'designs.ts `impact:flesh`'],
  'handling:chop': ['Axe strike landing', 'designs.ts `impact:flesh`'],
  'handling:butt': ['Rifle-butt strike landing', 'designs.ts `impact:flesh`'],
  'handling:pin': ['Grenade pin pulled', 'designs.ts `pin`'],
  'handling:spoon': ['Grenade spoon released', 'designs.ts `pin`'],
  'handling:throwArm': ['Grenade / equipment thrown', 'designs.ts `whoosh`'],
  'handling:resupply': ['Ammunition resupply picked up', '— (new)'],
  'explosives:blastNear': ['Explosion within ~20 m', 'designs.ts blast'],
  'explosives:blastMid': ['Explosion at 20–60 m', 'designs.ts blast (filtered)'],
  'explosives:blastFar': ['Explosion beyond 60 m', 'designs.ts blast (filtered)'],
  'explosives:debris': ['Debris settling after a near explosion', '— (new)'],
  'explosives:flashBang': ['Flash grenade detonation', 'designs.ts `flashbang`'],
  'explosives:smokePop': ['Smoke grenade igniting', 'designs.ts `hiss`'],
  'explosives:smokeHiss': ['Smoke grenade emitting (loop)', 'designs.ts `hiss`'],
  'explosives:bounce': ['Grenade bouncing on hard ground', 'designs.ts tone'],
  'explosives:bounceSoft': ['Grenade bouncing on soft ground', '— (new)'],
  'explosives:stick': ['Sticky equipment attaching', '— (new)'],
  'explosives:beep': ['Equipment arming / proximity beep', 'engine tone'],
  'explosives:crate': ['Supply crate landing', '— (new)'],
  'explosives:alarm': ['Air-strike warning siren', 'engine tone'],
  'ui:click': ['Button press (menus, lobby, loadout)', 'engine tone (sine click)'],
  'ui:hover': ['Pointer moves onto a button', '— (new)'],
  'ui:confirm': ['Confirm / ready', 'engine tone'],
  'ui:select': ['Tab, mode or item selected', 'engine tone'],
  'ui:back': ['Back / close', 'engine tone'],
  'ui:toggle': ['Switch toggled in settings', 'engine tone'],
  'ui:tick': ['Slider moved in settings', 'engine tone'],
  'ui:error': ['Error (join failed, not enough credits)', 'engine tone'],
  'ui:purchase': ['Armory purchase granted', 'engine tone'],
  'ui:equip': ['Loadout item equipped', 'engine tone'],
  'ui:hit': ['Hit marker (validated hit)', 'engine tone (square blip)'],
  'ui:headshot': ['Headshot marker', 'engine tone'],
  'ui:kill': ['Elimination marker', 'engine tone'],
  'ui:medal': ['Medal earned', 'engine tone'],
  'ui:streak': ['Scorestreak ready', 'engine tone'],
  'ui:countdown': ['Pre-match countdown tick', 'engine tone'],
  'ui:notify': ['Notification (objective, match message)', 'engine tone'],
  'ui:ping': ['Map ping', 'engine tone'],
  'voice:hurt': ['Light validated hit: short restrained grunt', '— (new; no hit reactions before)'],
  'voice:heavy': ['Heavy validated hit (big round, close shotgun)', '— (new)'],
  'voice:severe': ['Hit leaving little health: strained reaction', '— (new)'],
  'voice:death': ['Elimination, once per life', '— (new)'],
  'voice:effort': ['Jump, vault and throw effort', '— (new)'],
  'breath:loop': ['Breathing after sprinting and at low health (own soldier only)', '— (new)'],
  'amb:wind': ['Map bed: wind (loop, crossfaded outdoors/indoors)', 'campus `wind.mp3` loop'],
  'amb:district': ['Map bed: distant industry or suburb (loop)', '— (new)'],
  'amb:interior': ['Indoor room tone (loop, by indoor amount)', '— (new)'],
  'amb:machine': ['Machinery emitters placed on the map (loop, 3D)', '— (new)'],
  'amb:hum': ['Electrical hum emitters at lamps and generators (loop, 3D)', '— (new)'],
  'amb:creak': ['Occasional structure creak (one-shot, positioned)', '— (new)'],
  'amb:clank': ['Occasional distant clank (one-shot, positioned)', '— (new)'],
  'amb:chain': ['Occasional chain rattle (one-shot, positioned)', '— (new)'],
  'amb:flag': ['Occasional flag / tarpaulin flap (one-shot, positioned)', '— (new)'],
};
const VO = 'Announcer / radio line (match events, objectives, countdown)';
const fam = bank => bank.split('.')[0];
const CATEGORY = { w: 'Weapons', steps: 'Movement (footsteps)', movement: 'Movement / character', impacts: 'Impacts', handling: 'Weapons (handling)', explosives: 'Explosions / equipment', ui: 'Interface', vo: 'Announcer', voice: 'Character (voice)', breath: 'Character (breathing)', amb: 'Environment' };
const KB = b => (b / 1024).toFixed(1) + ' KB';
const range = (xs, d = 2) => { const a = Math.min(...xs), b = Math.max(...xs); return a.toFixed(d) === b.toFixed(d) ? a.toFixed(d) : `${a.toFixed(d)}–${b.toFixed(d)}`; };
const byBank = new Map();
for (const c of qc.clips) { const k = c.bank + '/' + c.sound; if (!byBank.has(k)) byBank.set(k, []); byBank.get(k).push(c); }

const out = [];
out.push(`# Combat Arena audio: asset inventory

Generated by \`node scripts/assets/arena-audio/inventory.mjs\` from what was built (\`public/assets/arena/audio/manifest.json\`, \`docs/audio/qc.json\`). Sources and licences: [LICENSES.md](LICENSES.md). Pipeline and how to change sounds: [README.md](README.md).

**Totals:** ${Object.keys(manifest.banks).length} banks, ${Object.values(manifest.banks).reduce((n, b) => n + b.files.length, 0)} MP3 files, ${qc.summary.clips} clips, ${KB(qc.summary.bytes)} on disk; ${qc.summary.flagged} clips flagged by QC. Built ${qc.summary.built.slice(0, 10)}.

Every clip is an edit of a real recording listed in LICENSES.md; none is synthesised. (The one synthesised sound in the arena is not in a bank: the tinnitus ring after a flashbang, a fading pure tone played by the engine.) A few are *designed* from recordings, and say so below (a part's size simulated by pitching a real mechanical recording; a ricochet or a subsonic round passing built from real whooshes and metal hits).

## Previous arena sounds and what replaced them

Before this overhaul the arena had **no recorded weapon, impact, voice or interface sounds**. Everything except footsteps and wind was synthesised in the browser at load time from filtered noise and resonators:

| Previous asset | Kind | Used for | Status | Replaced by |
|---|---|---|---|---|
| \`src/arena/sound/designs.ts\` (216 lines) | Procedural synthesis: 11 gun profiles (report/body/crack/mech/tail/far), mechanism clicks (magout, magin, charge, pump, boltaction, dry, draw, ads, shell, cylinder), gear, metalstep, slide, whoosh, body, jump, land, casing, hiss, pin, flashbang, impacts by surface | All weapon, reload, impact, flyby, explosion, movement and Foley sounds | **Removed** (verified unreferenced: \`git grep designs\` finds nothing in \`src/\`) | The weapon banks \`w.*\`, \`handling\`, \`impacts\`, \`explosives\`, \`movement\`, \`steps.*\` below |
| \`src/arena/sound/dsp.ts\` (87 lines) | Runtime DSP for the designs (noise bursts, biquads, modal resonators) | Rendering the designs above | **Removed** (only designs.ts imported it) | Offline DSP in \`scripts/assets/arena-audio/dsp.mjs\` (build time, not shipped) |
| \`engine.tones\` (sine/square blips) | Oscillator tones | Hit markers, UI clicks, countdown, notifications, beeps | **Removed from the arena** | \`ui\` bank (Kenney recordings), \`vo\` bank (recorded announcer) |
| \`public/assets/audio/step-hard-*.mp3\`, \`step-grass-*.mp3\`, \`step-wood-*.mp3\` (15 files, 44.1 kHz mono MP3, 0.13–0.18 s, ~1.5 KB each) | Campus CC0 recordings (Kenney Impact Sounds) | Arena footsteps on 3 surfaces (others pitched), plus the campus | **Kept** — still used by the campus (\`src/audio/foley.ts\`); no longer referenced by the arena | \`steps.*\` banks (10 surfaces × walk/run/soft/scuff/land/stairs) |
| \`public/assets/audio/wind.mp3\` (22.05 kHz mono, 20.4 s) | Campus CC0 loop | Arena wind bed, plus the campus | **Kept** — still used by the campus (\`src/audio/ambience.ts\`) | \`amb.foundry\`/\`amb.quad\` wind, district, interior and emitter loops |

No previous file was deleted while still referenced. The campus sound set (\`public/assets/audio/\`) is unchanged.

## Runtime banks

Each bank is one sprite file (mono MP3) and, for weapons, a second stereo file (\`.st.mp3\`) for the close-up shot and tail. A bank loads only when needed: weapon banks for the weapons in the match (the loadout first, others when a player is seen carrying them), footstep banks for surfaces near the listener, voice banks for the soldiers present. Rate is the encoded (and decoded) sample rate.

| Bank | Category | Files (channels, rate, size, length) | Sounds | Clips | Loaded |
|---|---|---|---|---|---|`);
const LOAD = { w: 'when the weapon is in a loadout or seen', steps: 'when that surface is within reach', voice: 'when a soldier with that voice is present', breath: 'with the player’s soldier', amb: 'with that map', ui: 'with the interface', vo: 'at deployment', impacts: 'at deployment', handling: 'at deployment', explosives: 'at deployment', movement: 'at deployment' };
for (const [name, b] of Object.entries(manifest.banks)) {
  const clips = Object.values(b.sounds).reduce((n, s) => n + s.length, 0);
  out.push(`| \`${name}\`${b.meta?.name ? ` — ${b.meta.name}` : ''} | ${CATEGORY[fam(name)] ?? fam(name)} | ${b.files.map(f => `\`${f.file}\` (${f.ch === 2 ? 'stereo' : 'mono'}, ${f.rate / 1000} kHz, ${KB(f.bytes)}, ${f.seconds.toFixed(1)} s)`).join('<br>')} | ${Object.keys(b.sounds).length} | ${clips} | ${LOAD[fam(name)] ?? ''} |`);
}

out.push(`
## Sounds

One row per sound in a bank: the clips are its variations (played from a shuffle bag, never the same one twice running, with small pitch and level jitter). Duration and peak are measured on the decoded runtime file. Quality is the QC result (\`docs/audio/qc.json\`): **pass** means no flags (clipping, DC offset, abrupt start or end, noise floor, late onset, decoder overshoot); notes are expected traits of the recording, such as a long natural decay.
`);
let group = '';
for (const [name, b] of Object.entries(manifest.banks)) {
  const g = fam(name);
  if (g !== group) {
    group = g;
    out.push(`\n### ${CATEGORY[g] ?? g}${g === 'w' ? '' : ''}\n\n| Bank / sound | Weapon | File · format | Clips | Duration (s) | Peak (dBFS) | Source recordings | Usage | Quality | Replaces |\n|---|---|---|---|---|---|---|---|---|---|`);
  }
  for (const [s, list] of Object.entries(b.sounds)) {
    const cs = byBank.get(name + '/' + s) ?? [];
    const file = b.files[list[0][0]];
    const sources = [...new Set(cs.map(c => c.from).filter(Boolean))];
    const flags = [...new Set(cs.flatMap(c => c.flags))], notes = [...new Set(cs.flatMap(c => c.notes))];
    const [use, repl] = g === 'vo' ? [VO, 'engine tone / no line'] : USE[g + ':' + s] ?? ['', ''];
    const loop = list.some(c => c[4]) ? ' (loop)' : '';
    const src = sources.length > 4 ? sources.slice(0, 4).map(x => `\`${x}\``).join(', ') + ` +${sources.length - 4} more` : sources.map(x => `\`${x}\``).join(', ');
    out.push(`| \`${name}/${s}\`${loop} | ${g === 'w' ? b.meta?.name ?? name.slice(2) : '—'} | \`${file.file}\` · MP3 ${file.ch === 2 ? 'stereo' : 'mono'} ${file.rate / 1000} kHz | ${list.length} | ${range(list.map(c => c[2]))} | ${cs.length ? range(cs.map(c => c.peakDb), 1) : '—'} | ${src || '—'} | ${use} | ${flags.length ? '**' + flags.join(', ') + '**' : 'pass'}${notes.length ? ' · ' + notes.join(', ') : ''} | ${repl} |`);
  }
}
out.push(`
## Notes on quality

- Masters: the Free Firearm Sound Library (24-bit/96 kHz WAV, professional field recordings), Gary's *Handling Guns* (WAV), the OpenGameArt voice and footstep packs (WAV/OGG), Kenney (OGG/WAV) and BigSoundBank. BigSoundBank's free download is the site's Ogg Vorbis (~240 kb/s); its WAV masters need a (free) account and were not used. The Ogg masters are transparent for these short effects after the edits, but they are lossy masters, encoded once more to MP3 for the game.
- FFSL masters with flat-topped (clipped) peaks from the original recording were repaired with ffmpeg's \`adeclip\` before editing; airsoft and other clipped sources were not used.
- Runtime MP3s are encoded at the bank's rate (32 kHz mono for weapons' far layers and mechanics, 48 kHz stereo for close-up shots, 24 kHz for voices, 16 kHz for ambience beds), chosen per bank so decoded memory stays within the phone budget (32 MB).
- Designed (not single recordings): small-part pitch of real magazine and bolt recordings for weapons whose own mechanism was not recorded; the ricochet and the subsonic whiz (real whooshes and metal hits, filtered and pitched); the supersonic snap is the leading edge of real rifle reports, high-passed; the metal and container footstep ring (real metal steps layered with a falling steel bar, low-passed).
`);
await writeFile('docs/audio/INVENTORY.md', out.join('\n') + '\n');
console.log('docs/audio/INVENTORY.md:', out.length, 'lines');
