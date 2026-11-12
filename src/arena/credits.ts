// Attribution for the Combat Arena's licensed art and sound (CC BY and CC BY-SA require title, author, source,
// licence and a note of changes; CC0 and MIT works are credited as a courtesy). Mirrors docs/ASSETS.md and, for
// sound, docs/audio/LICENSES.md (which lists every recording and the bank that uses it).
export type Licence = 'CC BY 4.0' | 'CC BY 3.0' | 'CC BY-SA 4.0' | 'CC BY-SA 3.0' | 'CC0 1.0' | 'MIT';
export interface Credit { what: string; title: string; author: string; url: string; licence: Licence }
/** Licence deeds, linked from the credits. */
export const LICENCE_URLS: Partial<Record<Licence, string>> = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};
const sf = (uid: string) => `https://sketchfab.com/3d-models/${uid}`;
export const ARENA_CREDITS: Credit[] = [
  { what: 'Vanguard AR-7', title: 'SLR AR-15', author: 'AlexFinsher', url: sf('429b6ef8516b46dca8992e78c4bf7a55'), licence: 'CC BY 4.0' },
  { what: 'Halcyon BR', title: 'AK-74M Assault Rifle', author: 'FJH', url: sf('9084c3bae8224d338103997bc3101480'), licence: 'CC BY 4.0' },
  { what: 'Wasp SMG', title: 'HK MP5 (9mm submachine gun)', author: 'quick_loop', url: sf('c503d96157614fb78b5953d49e643b78'), licence: 'CC BY 4.0' },
  { what: 'Kestrel SMG', title: 'Saiga-9mm', author: 'rwroclav', url: sf('3d031dfeb2ad45beb19e89977225a631'), licence: 'CC BY 4.0' },
  { what: 'Bastion shotgun', title: 'Remington 870 Police Magnum 12 Gauge Shotgun', author: '8sianDude', url: sf('eea11de7e9d24b6683962b8388c319eb'), licence: 'CC BY 4.0' },
  { what: 'Rampart shotgun', title: 'M4 Super 90 (JW2) Brand-Friendly version', author: '8sianDude', url: sf('7e472e24152246708cac8b6f1613c7a8'), licence: 'CC BY 4.0' },
  { what: 'Longbow SR', title: 'Sniper rifle GameReady Free', author: 'pashtetuser', url: sf('e520b234140049e7890db0b6c29d3925'), licence: 'CC BY 4.0' },
  { what: 'Talon DMR', title: 'HK G28 Sniper Rifle', author: 'trolosqlfod', url: sf('997840668e1e4c1384c7220563323085'), licence: 'CC BY 4.0' },
  { what: 'Anvil LMG', title: 'LMG', author: 'DJMaesen', url: sf('8c24d7374ea64bdab1c30f49c69d5ed8'), licence: 'CC BY 4.0' },
  { what: 'Thorn revolver', title: 'Revolver .357 Magnum', author: 'Artem Goyko', url: sf('360c6276282e48109fcca66f31004d81'), licence: 'CC BY 4.0' },
  { what: 'Combat knife', title: 'Combat Knife', author: 'Aver1', url: sf('5969d3423b6d42428d2f396441d99243'), licence: 'CC BY 4.0' },
  { what: 'First-person arms', title: 'First Person arms', author: 'DJMaesen', url: sf('e3c42c05b22944e5839deb8e003f0987'), licence: 'CC BY 4.0' },
  { what: 'Sparrow pistol', title: 'Service Pistol', author: 'Poly Haven', url: 'https://polyhaven.com/a/service_pistol', licence: 'CC0 1.0' },
  { what: 'Breach Axe', title: 'Hatchet', author: 'Poly Haven', url: 'https://polyhaven.com/a/hatchet', licence: 'CC0 1.0' },
  { what: 'Soldiers', title: 'Military avatars', author: 'Microsoft Rocketbox', url: 'https://github.com/microsoft/Microsoft-Rocketbox', licence: 'MIT' },
  { what: 'Surfaces, props and sky', title: 'Textures, models and HDRIs', author: 'Poly Haven contributors', url: 'https://polyhaven.com', licence: 'CC0 1.0' },
];
export const CREDIT_CHANGES = 'Models were re-oriented, scaled, trimmed of loose items, merged and recompressed; first-person arms are re-posed at run time.';

const oga = (slug: string) => `https://opengameart.org/content/${slug}`;
export const ARENA_SOUND_CREDITS: Credit[] = [
  { what: 'Gunfire', title: 'The Free Firearm Sound Library', author: 'The Free Firearm Sound Library team', url: oga('the-free-firearm-sound-library'), licence: 'CC0 1.0' },
  { what: 'Weapon mechanics and reloads', title: 'Handling Guns (made for PARPG)', author: 'Gary', url: oga('handling-guns'), licence: 'CC BY-SA 3.0' },
  { what: 'Foley, footsteps, impacts, casings, explosions and ambience', title: 'BigSoundBank', author: 'Joseph Sardin', url: 'https://bigsoundbank.com', licence: 'CC0 1.0' },
  { what: 'Footsteps', title: 'Footsteps on different surfaces', author: 'congusbongus, from recordings by swuing, Ali_6868 and Eelke', url: oga('footsteps-on-different-surfaces'), licence: 'CC BY 3.0' },
  { what: 'Footsteps', title: 'Fantozzi’s Footsteps (Grass/Sand & Stone)', author: 'Fantozzi', url: oga('fantozzis-footsteps-grasssand-stone'), licence: 'CC0 1.0' },
  { what: 'Gear Foley', title: 'Footsteps Leather, Cloth, Armor', author: 'HaelDB', url: oga('footsteps-leather-cloth-armor'), licence: 'CC0 1.0' },
  { what: 'Foley', title: 'Super Foley Pack', author: 'dklon', url: oga('super-foley-pack'), licence: 'CC BY 3.0' },
  { what: 'Soldier voices', title: 'Damage Grunts and Effort Grunts (Male)', author: 'VoiceBosch', url: oga('damage-sounds-male-audio-pack'), licence: 'CC BY-SA 4.0' },
  { what: 'Soldier voices', title: '11 male human pain/death sounds', author: 'Michel Baradari', url: oga('11-male-human-paindeath-sounds'), licence: 'CC BY 3.0' },
  { what: 'Soldier voices', title: 'Male Grunt/Yelling sounds', author: 'HaelDB', url: oga('male-gruntyelling-sounds'), licence: 'CC0 1.0' },
  { what: 'Soldier voices', title: 'Female Hurt Grunts & Groans', author: 'Nocturnal_Vanguard (AuraVoice)', url: oga('female-hurt-grunts-groans'), licence: 'CC0 1.0' },
  { what: 'Announcer and radio', title: 'Radio Soldier: Video Game Announcer', author: 'VoiceBosch', url: oga('radio-soldier-video-game-announcer'), licence: 'CC BY-SA 4.0' },
  { what: 'Announcer', title: 'Voiceover Pack', author: 'Kenney', url: oga('voiceover-pack-40-lines'), licence: 'CC0 1.0' },
  { what: 'Interface', title: 'Interface Sounds and 51 UI sound effects', author: 'Kenney', url: oga('interface-sounds'), licence: 'CC0 1.0' },
  { what: 'Impacts and blasts', title: '25 CC0 bang and 75 CC0 breaking / falling / hit SFX', author: 'rubberduck', url: oga('75-cc0-breaking-falling-hit-sfx'), licence: 'CC0 1.0' },
];
export const SOUND_CREDIT_CHANGES = 'Recordings were cut, trimmed, filtered, level-matched, pitch-shifted for a part’s size, layered and encoded into sound banks; the banks made from CC BY-SA recordings (weapon mechanics, soldier voices, announcer) are shared under the same licence. Every recording and the bank that uses it: docs/audio/LICENSES.md.';
