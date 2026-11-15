// Which matches use the cinematic presentation: the filmic grade and lens finish, the reference HUD styling (round
// tactical map, lighter panels), and the combat feedback (elimination card, experience popups with medals, the count
// this life, lead calls, mid-match unlocks and the after-action unlock report). Operation: Metropolis only; the other
// maps keep their own look and the plain banners.
export const CINEMATIC_MAPS = new Set(['metropolis']);
export const cinematic = (mapId: string | null | undefined) => !!mapId && CINEMATIC_MAPS.has(mapId);
