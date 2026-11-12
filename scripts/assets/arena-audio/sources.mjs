// Every recording the Combat Arena audio is made from: where it comes from, who recorded it and its licence.
// The build (scripts/assets/build-arena-audio.mjs) downloads these into .asset-cache/arena-audio/ (git-ignored),
// so the runtime assets in public/assets/arena/audio/ can be rebuilt exactly. docs/audio/LICENSES.md is written
// from this table, listing only what is actually used.
//
// A recipe names a recording as '<pack>/<path inside the pack>', e.g. 'ffsl/AR-15/D_32P.wav' or 'bsb/1318'.

const OGA = 'https://opengameart.org/sites/default/files/';

/** Packs: a downloadable archive (zip or 7z) or a set of single files. */
export const PACKS = {
  ffsl: {
    title: 'The Free Firearm Sound Library — Prepared SFX Library', author: 'The Free Firearm Sound Library team (Kickstarter-funded, 2013); published on OpenGameArt by bart',
    licence: 'CC0-1.0', page: 'https://opengameart.org/content/the-free-firearm-sound-library', archive: OGA + 'Prepared%20SFX%20Library.7z', root: 'Prepared SFX Library',
    notes: 'Field recordings of 22 real firearms at an outdoor range, 96 kHz / 24-bit stereo, near and mid-distance microphones. The muzzle-blast peaks of some takes are flat-topped (≤ 0.05 ms); the build repairs them with adeclip before editing.',
  },
  bsb: {
    title: 'BigSoundBank', author: 'Joseph Sardin (BigSoundBank.com)', licence: 'CC0-1.0', page: 'https://bigsoundbank.com/licenses.html',
    file: id => `https://bigsoundbank.com/UPLOAD/ogg/${id}.ogg`, itemPage: id => `https://bigsoundbank.com/s${id}.html`,
    notes: 'Professional field and Foley recordings. The distributed Ogg Vorbis files (≈ 240 kb/s, 44.1/48 kHz) are used as masters; the WAV masters are available from the site with a free account.',
  },
  gary: {
    title: 'Handling Guns (made for PARPG)', author: 'Gary (OpenGameArt)', licence: 'CC-BY-SA-3.0', page: 'https://opengameart.org/content/handling-guns',
    archive: OGA + 'Gary%20Guns.zip', root: 'Gary Guns',
    notes: 'Dry handling of a Colt M1911A1 (.45 ACP), a Browning Belgian 12-gauge semi-automatic shotgun, a Marlin .22 WMR bolt rifle and a Remington 700 (.30-06), with timecoded notes.',
  },
  lfa: { title: 'Equipment Clicks II / III', author: 'LFA (www.lfa.com)', licence: 'CC0-1.0', page: 'https://opengameart.org/content/equipment-clicks-iii', files: { 'equipmentclicks.wav': OGA + 'equipmentclicks.wav', 'equipment_clicks3.wav': OGA + 'equipment_clicks3.wav' },
    notes: 'Recorded by cocking a real bolt-action rifle, a stapler and a tape measure.' },
  zer0sol: { title: 'Handgun Reload Sound Effect', author: 'zer0_sol', licence: 'CC0-1.0', page: 'https://opengameart.org/content/handgun-reload-sound-effect', files: { 'reload.wav': OGA + 'reload.wav' } },
  bmac: { title: 'Gun Reload Sound Effects', author: 'BMacZero', licence: 'CC0-1.0', page: 'https://opengameart.org/content/gun-reload-sound-effects', files: { 'clipload1.wav': OGA + 'clipload1.wav', 'clipload2.wav': OGA + 'clipload2.wav', 'singlebullet1.wav': OGA + 'singlebullet1.wav' } },
  vbdmg: { title: 'DAMAGE GRUNTS (Male) — SoundBiter SFX library', author: 'VoiceBosch', licence: 'CC-BY-SA-4.0', page: 'https://opengameart.org/content/damage-sounds-male-audio-pack',
    files: Object.fromEntries(Array.from({ length: 22 }, (_, i) => { const n = `${String(i + 1).padStart(2, '0')}._damage_grunt_male.wav`; return [n, OGA + n]; })) },
  vbeff: { title: 'EFFORT GRUNTS (Male) — SoundBiter SFX library', author: 'VoiceBosch', licence: 'CC-BY-SA-4.0', page: 'https://opengameart.org/content/effort-sounds-male-audio-pack',
    files: Object.fromEntries(Array.from({ length: 41 }, (_, i) => { const n = `${String(i + 1).padStart(2, '0')}._effort_grunt_male.wav`; return [n, OGA + n]; })) },
  vbradio: { title: 'RADIO SOLDIER — Video Game Announcer (SoundBiter SFX library)', author: 'VoiceBosch', licence: 'CC-BY-SA-4.0', page: 'https://opengameart.org/content/radio-soldier-video-game-announcer',
    files: Object.fromEntries(['09._enemy_uav_overhead', '10._artillery_strike_inbound', '15._were_losing_ground', '17._objective_secured', '18._objective_lost', '19._care_package_inbound', '20._mission_accomplished', '21._air_support_inbound', '25._were_under_attack', '13._good_work_soldier'].map(n => [n + '.wav', OGA + n + '.wav'])) },
  haeldb: { title: 'Male Grunt/Yelling sounds', author: 'HaelDB', licence: 'CC0-1.0', page: 'https://opengameart.org/content/male-gruntyelling-sounds', archive: OGA + 'yelling%20sounds.zip', root: 'yelling sounds',
    notes: 'Four male vocalists, Neumann microphone and Avalon preamplifier. Only short, restrained grunts are used (no screams).' },
  haeldbsteps: { title: 'Footsteps Leather, Cloth, Armor', author: 'HaelDB', licence: 'CC0-1.0', page: 'https://opengameart.org/content/footsteps-leather-cloth-armor', archive: OGA + 'footsteps.zip', root: 'footsteps' },
  aura: { title: 'Female Hurt Grunts & Groans', author: 'Nocturnal_Vanguard (AuraVoice, voice actor)', licence: 'CC0-1.0', page: 'https://opengameart.org/content/female-hurt-grunts-groans', files: { 'female_hurt_grunts_groans_1.ogg': OGA + 'female_hurt_grunts_groans_1.ogg' } },
  baradari: { title: '11 male human pain/death sounds', author: 'Michel Baradari (apollo-music.de)', licence: 'CC-BY-3.0', page: 'https://opengameart.org/content/11-male-human-paindeath-sounds', archive: OGA + 'michelbaradari-human.7z', root: 'player' },
  congus: { title: 'Footsteps on different surfaces', author: 'congusbongus, mastered from freesound.org recordings by swuing (CC BY 3.0), Ali_6868 (CC0) and Eelke (CC BY 3.0)', licence: 'CC-BY-3.0', page: 'https://opengameart.org/content/footsteps-on-different-surfaces', archive: OGA + 'footsteps_0.zip', root: 'footsteps',
    notes: 'boots/: "footstep-concrete.wav" by swuing (freesound 38873); gravel/: Gravel Footsteps pack by Ali_6868 (freesound pack 21608, CC0); grass/: "footstep-grass.wav" by swuing (38874); metal/: "boots on aluminum ladder 01" by Eelke (462598); wood/: "footstep-wood.wav" by swuing (38876); tile/: swuing (38873) and "Squeaky footstep" by ceberation (235524).' },
  fantozzi: { title: "Fantozzi's Footsteps (Grass/Sand & Stone)", author: 'Fantozzi', licence: 'CC0-1.0', page: 'https://opengameart.org/content/fantozzis-footsteps-grasssand-stone', archive: OGA + 'Fantozzi-footsteps.7z', root: 'Fantozzi-footsteps/flac' },
  kenneyif: { title: 'Interface Sounds', author: 'Kenney (kenney.nl)', licence: 'CC0-1.0', page: 'https://opengameart.org/content/interface-sounds', archive: OGA + 'kenney_interfaceSounds.zip', root: 'Audio' },
  kenneyui: { title: '51 UI sound effects (buttons, switches and clicks)', author: 'Kenney (kenney.nl)', licence: 'CC0-1.0', page: 'https://opengameart.org/content/51-ui-sound-effects-buttons-switches-and-clicks', archive: OGA + 'UI_SFX_Set.zip', root: '' },
  kenneyvo: { title: 'Voiceover Pack (40+ lines)', author: 'Kenney (kenney.nl), male and female voice actors', licence: 'CC0-1.0', page: 'https://opengameart.org/content/voiceover-pack-40-lines', archive: OGA + 'Voiceover%20Pack.zip', root: '' },
  rdbang: { title: '25 CC0 bang / firework SFX', author: 'rubberduck', licence: 'CC0-1.0', page: 'https://opengameart.org/content/25-cc0-bang-firework-sfx', archive: OGA + '25-CC0-bang-sfx.zip', root: '' },
  rdbreak: { title: '75 CC0 breaking / falling / hit sfx', author: 'rubberduck', licence: 'CC0-1.0', page: 'https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx', archive: OGA + 'sfx_breaking_and_falling.zip', root: '' },
  dklon: { title: 'Super Foley Pack', author: 'dklon', licence: 'CC-BY-3.0', page: 'https://opengameart.org/content/super-foley-pack', archive: OGA + 'foley_pack.zip', root: '' },
};

/** BigSoundBank items used (id → title, as published). */
export const BSB = {
  // Operation: Metropolis ambience.
  '0608': 'Street and Roads', '0093': 'Metro corridor, Paris #1', '1289': 'Rain on concrete', '2573': 'Gulls on the Harbor', '0092': 'Metro, Paris #2', '2847': 'Train Horn #3', '2987': 'Car passing 50km/h #3', '0258': 'Recent Car Horn #2', '1233': 'Air/water heat pump, back', '3594': 'Bus horn',
  '0085': 'Step on gravels', '0510': 'Footsteps on gravels #1', '1117': 'Footsteps on gravels #2', '3202': 'Footsteps on Gravels #3', '3216': 'Footsteps on Gravels #4',
  '0514': 'Footsteps, Shoe on Concrete', '1318': 'Fast Steps on Concrete', '1319': 'Fast Steps on Concrete (running)', '0854': 'Steps in the short grass', '1253': 'Steps in the Grass, Slow',
  '1254': 'Steps in the grass, quick', '1024': 'Steps in the tall grass', '1515': 'Steps on a Wooden Floor #1', '1516': 'Steps on a wooden floor #2', '1517': 'Steps on a wooden floor #3',
  '1518': 'Steps on a wooden floor #4', '0165': 'Man Footsteps on the Wooden Floor', '0606': 'Step, Shoe on Stone Staircase', '3025': 'Going down wooden stairs #1', '3026': 'Going down wooden stairs #2',
  '3212': 'Step, Wooden Staircase #1', '0839': 'Feet on pebbles', '1845': 'Walk on Pontoon', '1835': 'Jumping on concrete #1', '1836': 'Jumping on Concrete #2', '1837': 'Jumping on dirt road #1',
  '1838': 'Jumping on dirt road #2', '1839': 'Jumping on Grass #1', '1840': 'Jumping on grass #2', '1841': 'Jumping on wooden pontoon #1', '1842': 'Jumping on wooden pontoon #2',
  '1104': 'Synthetic Coat Rubbed', '0399': 'Tent or curtain shower', '0576': 'Canvas bag on floor', '1787': 'Flag #1', '1788': 'Flag #2', '1789': 'Flag #3', '1790': 'Flag #4', '1791': 'Flag #5',
  '1792': 'Flag #6', '1793': 'Flag #7', '1794': 'Flag #8', '0629': 'Velcro tape', '0014': 'Zip #1', '0626': 'Zip #5', '0575': 'Belt buckle', '1237': 'Climbing carabiner #1', '1238': 'Climbing carabiner #2',
  '1239': 'Climbing carabiner #3', '1240': 'Climbing carabiner #4', '1241': 'Climbing carabiner #5', '0355': 'Small chain #1', '0356': 'Small chain #2', '0357': 'Small chain #3', '0358': 'Small metal chain #4',
  '0359': 'Heavy chain', '0360': 'Medium Chain #1', '0361': 'Medium chain #2', '2556': 'Metal handcuffs #1', '2557': 'Metal handcuffs #2', '2558': 'Metal handcuffs #3', '2559': 'Metal handcuffs #4', '2560': 'Metal handcuffs #5',
  '1103': 'Breathless Man', '1345': 'Breathless Woman', '2195': 'Man Breathing', '1404': 'Sigh by the nose', '1405': 'Sigh by the Mouth', '1602': 'Blow hard #1', '1603': 'Blow Hard #2', '2361': 'Cry of Pain',
  '2452': 'Body Fall #1', '2453': 'Body Fall #2', '2454': 'Body fall #3', '2455': 'Body fall #4', '2456': 'Body fall #5', '2459': 'Punch #4', '2460': 'Punch #5', '2461': 'Punch #6', '2462': 'Punch #7', '2463': 'Punch #8',
  '2464': 'Punch #9', '2465': 'Punch #10', '2466': 'Punch #11', '2467': 'Punch #12', '2468': 'Punch #13', '0444': 'Punch #2',
  '0397': 'Shot of Winchester Magnum XTR', '0437': 'Shot Beretta M12 9mm', '0438': 'Shot in .357 Magnum', '0532': 'Shotgun: Shots', '2853': 'Rifle: Shot #1', '2854': 'Rifle: Shot #2',
  '1984': 'Pistol, cocking #1', '1985': 'Pistol, cocking #2', '1986': 'Pistol, cocking #3', '1987': 'Pistol, Cocking #4', '1988': 'Gun, loading #1', '1989': 'Gun, loading #2', '1990': 'Gun, loading #3', '1991': 'Gun, loading #4',
  '1992': 'Pistol, cocking hammer #1', '1993': 'Pistol, cocking hammer #2', '1994': 'Pistol, disarming hammer #1', '1995': 'Pistol, disarming hammer #2',
  '1355': 'Cartridge case 9 mm on concrete #1', '1356': 'Cartridge case 9 mm on concrete #2', '1357': 'Cartridge case 9 mm on concrete #3', '1358': 'Cartridge case 9 mm on concrete #4', '1359': 'Cartridge case 9 mm on concrete #5', '1360': 'Cartridge case 9 mm on concrete #6',
  '1361': 'Cartridge case 5.56mm on concrete #1', '1362': 'Cartridge case 5.56mm on concrete #2', '1363': 'Cartridge case 5.56mm on concrete #3', '1364': 'Cartridge case 5.56mm on concrete #4', '1365': 'Cartridge case 5.56mm on concrete #5', '1366': 'Cartridge case 5.56mm on concrete #6',
  '1367': 'Cartridge case 7.62mm on concrete #1', '1368': 'Cartridge case 7.62mm on concrete #2', '1369': 'Cartridge case 7.62mm on concrete #3', '1370': 'Cartridge case 7.62mm on concrete #4', '1371': 'Cartridge Case 7.62mm on Concrete #5',
  '0127': 'Sword That Cuts', '0128': 'Sword Through the Air', '0572': 'Whoosh #1', '0573': 'Whoosh #2', '1795': 'Whoosh #3', '1796': 'Whoosh #4', '1797': 'Whoosh #5', '1798': 'Whoosh #10', '1799': 'Whoosh #6',
  '1800': 'Whoosh #7', '1801': 'Whoosh #8', '1802': 'Whoosh #9', '1023': 'Explosion far Away #1', '1806': 'Explosion far away #2', '1807': 'Explosion #1', '1808': 'Explosion #2',
  '0148': 'Glass Burst', '0387': 'A Mirror Explodes', '0771': 'Broken glass', '1121': 'Broken Christmas Ball #1', '1122': 'Broken christmas ball #2', '1123': 'Broken christmas ball #3',
  '2039': 'Bulb bursting #1', '2040': 'Bulb bursting #2', '2041': 'Bulb bursting #3', '2042': 'Bulb bursting #4', '2043': 'Bulb bursting #5', '2044': 'Bulb bursting #6', '2045': 'Bulb bursting #7', '1591': 'Broken Glass of Champagne',
  '0235': 'Iron bar falls #2', '0246': 'Tin can #1', '0247': 'Tin can #2', '0248': 'Tin can #3', '0249': 'Tin can #4', '0706': 'Ax on axe wedge', '1084': 'Shot of shovel',
  '1771': 'Falling sheet steel bar #1', '1772': 'Falling sheet steel bar #2', '1773': 'Falling sheet steel bar #3', '1774': 'Falling sheet steel bar #4', '1775': 'Falling sheet steel bar #5',
  '1776': 'Fall 2 sheet steel bars #1', '1777': 'Fall 2 sheet steel bars #2', '1778': 'Fall 2 sheet steel bars #3', '2242': 'Metal ball, bounce #1', '2243': 'Metal ball, bounce #2', '2244': 'Metal ball, bounce #3', '2245': 'Metal ball, bounce #4',
  '0461': 'Nail falling on tiled floor', '1234': 'Trap', '0543': 'Metal bucket', '0539': 'Creaking barn door', '0616': 'Creaking metallic door', '0683': 'Grinding metal gate',
  '0536': 'Ax on Wood', '0705': 'Ax on log', '1011': 'Clapperboard', '1588': 'Gavel, 1 blow', '1589': 'Gavel, 2 blows', '1590': 'Gavel, 3 Blows', '1389': 'Plant a wooden picket', '1299': 'Broken twigs #1', '1300': 'Broken twigs #2',
  '3051': 'Squeaking parquet #1', '3052': 'Squeaking parquet #2', '3053': 'Squeaking parquet #3', '3054': 'Squeaking parquet #4', '1305': 'Dig With a Shovel', '1022': 'Fall of Stone',
  '0154': 'Strong wind #4', '0625': 'Strong Wind in a Village', '0595': 'Wind', '0908': 'Wind in Tall Grass', '1714': 'Wind from inside #1', '1715': 'Wind from inside #2', '1716': 'Wind from Inside #3', '0147': 'Whistling of the Wind #1',
  '0503': 'Industry Workshop', '0504': 'Technical room of an industry', '0749': 'Metallurgical factory', '0502': 'Noisy office industry', '1232': 'Air/water heat pump, front', '1233': 'Air/water heat pump, back',
  '0032': 'Ventilation #1', '1032': 'Air extractor', '0957': 'VMC engine', '1471': 'Air-conditioner', '2118': 'Neon or transformer #1', '2119': 'Neon or transformer #2', '2120': 'Neon or transformer #3',
  '0064': 'Electric transformer #1', '0086': 'Electric Transformer #2', '0467': 'Electric transformer #3', '1091': 'Electric meter', '0911': 'Campaign afternoon', '0898': 'Countryside #2', '0716': 'Suburb of Toulouse',
  '1632': 'Flag in the wind #1', '1633': 'Flag in the Wind #2', '2143': 'Flashing light bulb #1', '2144': 'Flashing light bulb #2', '2145': 'Flashing light bulb #3', '2146': 'Flashing Light Bulb #4',
  '0025': 'Electronic switch', '0026': 'Electric switch', '2191': 'Thermostat #1', '2192': 'Thermostat #2', '3061': 'Industrial switch #1', '3062': 'Industrial switch #2', '3063': 'Industrial Switch #3',
  '0760': 'Electronic device beeps', '1627': 'Hourly bips #1', '1628': 'Hourly bips #2', '1629': 'Hourly Bips #3', '0268': 'Fire alarm: communities #1', '0269': 'Fire alarm: communities #2',
  '0138': 'Air', '1486': 'Air leak', '1491': 'Pneumatic cylinder, small #1', '1492': 'Pneumatic cylinder, small #2', '1493': 'Pneumatic cylinder, small #3', '1824': 'Ratchet tensioner', '1107': 'Brush on concrete', '1106': 'Brush on wood', '0129': 'Sword', '2574': 'Knife blade #1', '2578': 'Knife blade #5', '0901': 'Manual winch #1', '1144': 'Countdown, talkie, in english',
};
