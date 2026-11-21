import data from './primitive-calibrations.json' with { type: 'json' };

export const CALIBRATION_LIMITS = { x:.18, y:.18, z:.18, yaw:15, approach:.12 };
export const BASE_CALIBRATION = Object.freeze({x:0,y:0,z:0,yaw:0,approach:0});

/** Authoring input is versioned and bounded before it can reach the runtime. Fixture ids are checked by the caller. */
export function parseCalibration(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const keys=Object.keys(value);
  if(keys.length!==5||!keys.every(k=>Object.hasOwn(CALIBRATION_LIMITS,k)))return null;
  const {x,y,z,yaw,approach}=value;
  if(!Object.entries({x,y,z,yaw,approach}).every(([key,n])=>Number.isFinite(n)&&Math.abs(n)<=CALIBRATION_LIMITS[key]))return null;
  return {x,y,z,yaw,approach};
}

const fixtures=new Map(Object.entries(data.fixtures).map(([id,value])=>[id,parseCalibration(value)]));
export const fixtureCalibration = id => fixtures.get(id)??BASE_CALIBRATION;
