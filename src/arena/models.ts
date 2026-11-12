// Which soldier model a player's character uses (scene/soldiers.ts draws it; the sound gives it a matching voice).
export const SOLDIER_MODELS = ['soldier-m1', 'soldier-m2', 'soldier-f1'] as const;
export const soldierModelFor = (num: number) => SOLDIER_MODELS[num % SOLDIER_MODELS.length];
