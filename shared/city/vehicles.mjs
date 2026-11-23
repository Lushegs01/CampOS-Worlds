// Ambient vehicle classes of Metropolitan City: dimensions, performance and the mix each district sees.
// Shared by the traffic simulation and the renderer (src/city/vehicleKit.ts draws each class).
export const CITY_CLASSES = {
  sedan: { length: 4.65, width: 1.82, height: 1.45, wheelbase: 2.75, accel: 2.4, max: 17, wheel: .33 },
  hatch: { length: 4.05, width: 1.76, height: 1.5, wheelbase: 2.55, accel: 2.2, max: 15, wheel: .31 },
  suv: { length: 4.75, width: 1.92, height: 1.78, wheelbase: 2.85, accel: 2.0, max: 16, wheel: .37 },
  sports: { length: 4.45, width: 1.88, height: 1.22, wheelbase: 2.6, accel: 3.6, max: 22, wheel: .33 },
  pickup: { length: 5.25, width: 1.9, height: 1.8, wheelbase: 3.2, accel: 1.9, max: 16, wheel: .38 },
  van: { length: 5.05, width: 1.98, height: 2.25, wheelbase: 3.3, accel: 1.6, max: 14, wheel: .35 },
  truck: { length: 7.6, width: 2.4, height: 3.3, wheelbase: 4.4, accel: 1.1, max: 12, wheel: .48 },
  bus: { length: 11.2, width: 2.5, height: 3.1, wheelbase: 6.2, accel: 1.0, max: 12, wheel: .5 },
  taxi: { length: 4.65, width: 1.82, height: 1.45, wheelbase: 2.75, accel: 2.4, max: 17, wheel: .33 },
  moto: { length: 2.1, width: .8, height: 1.35, wheelbase: 1.4, accel: 3.2, max: 19, wheel: .32 },
  police: { length: 4.8, width: 1.88, height: 1.5, wheelbase: 2.85, accel: 2.8, max: 20, wheel: .34 },
};
export const CLASS_NAMES = Object.keys(CITY_CLASSES);
/** Relative weights of each class by district. */
export const CLASS_MIX = {
  downtown: { sedan: 30, hatch: 14, suv: 14, sports: 5, taxi: 16, van: 6, bus: 3, moto: 7, police: 3, pickup: 2 },
  commercial: { sedan: 24, hatch: 18, suv: 10, sports: 3, taxi: 12, van: 12, truck: 3, bus: 3, moto: 10, pickup: 5 },
  residential: { sedan: 26, hatch: 26, suv: 16, sports: 3, taxi: 4, van: 4, moto: 15, pickup: 6 },
  industrial: { sedan: 8, hatch: 6, pickup: 22, van: 22, truck: 30, moto: 8, suv: 4 },
  outskirts: { sedan: 22, hatch: 10, suv: 14, sports: 6, pickup: 12, van: 8, truck: 18, moto: 8, bus: 2 },
  security: { sedan: 18, hatch: 10, suv: 18, police: 34, van: 8, moto: 6, taxi: 6 },
  entrance: { sedan: 26, hatch: 14, suv: 16, sports: 6, taxi: 10, van: 8, truck: 10, moto: 8, bus: 2 },
};
/** Believable factory paints (sRGB hex), weighted toward the whites, silvers and greys that dominate real roads. */
export const PAINTS = ['#f2f2ee', '#eceae4', '#c9ccd0', '#a9adb2', '#7b8087', '#4a4f55', '#25282c', '#121416', '#8a1f23', '#b3332d', '#1f3d6b', '#2f5f8f', '#2f5240', '#6a7a4d', '#7a6248', '#c9a978', '#d9b24a', '#5b3a63', '#e2dcc8', '#9aa3a8'];
export const PAINT_WEIGHTS = [10, 7, 9, 7, 6, 5, 5, 6, 3, 2, 3, 2, 2, 1, 2, 2, 1, 1, 2, 3];
/** Fixed liveries. */
export const LIVERY = { taxi: '#e9b824', police: '#f4f5f2', bus: '#1f6b52', truck: '#e6e4dc' };
