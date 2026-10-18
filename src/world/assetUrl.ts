// Asset addresses without the loaders (and three.js) behind them, so the interface can show character
// portraits without pulling the 3D engine into the first download.
export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
export const assetUrl = (path: string) => `${ASSET_BASE}${path}?v=${__CAMPUS_ASSET_VERSION__}`;
