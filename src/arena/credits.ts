// Attribution for the Combat Arena's licensed art (CC BY 4.0 requires title, author, source, licence and
// a note of changes; CC0 and MIT works are credited as a courtesy). Mirrors docs/ASSETS.md.
export interface Credit { what: string; title: string; author: string; url: string; licence: 'CC BY 4.0' | 'CC0 1.0' | 'MIT' }
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
