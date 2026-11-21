import { fixtureCalibration } from './primitive-calibration.mjs';
// Presentation contracts. Timings are seconds, and contact delays are milliseconds for room requests.
export const PRIMITIVES = {
  sit: { category:'seating', objects:['chair','bench'], requires:'grounded', approach:'seat-front', target:'seat', exit:'stand-clear', clips:['sitDown','sitIdle','sitTable','standUp'], seconds:2.6, commitMs:0, interruptible:true },
  stand: { category:'seating', objects:['chair','bench'], requires:'seat-occupancy', approach:null, target:'stand-clear',exit:'idle',clips:['standUp'],seconds:2.6,commitMs:0,interruptible:false },
  'door-push': { category:'door', objects:['door'], requires:'grounded', approach:'handle-side', target:'handle', exit:'release', clips:['doorPush'], clip:'doorPush', from:.1, to:1.9, seconds:2.2, commitMs:420, interruptible:true },
  'door-pull': { category:'door', objects:['door'], requires:'grounded', approach:'handle-side', target:'handle', exit:'release', clips:['doorPull'], clip:'doorPull', from:.1, to:1.9, seconds:2.2, commitMs:300, interruptible:true },
  pickup: { category:'object', objects:['basketball'], requires:'grounded', approach:'reachable-side', target:'grip', exit:'carry', clips:['crouch','holdFront'], clip:'crouch', from:0, to:.8, seconds:1.2, commitMs:330, interruptible:true },
  shoot: { category:'sport', objects:['basketball'], requires:'possession', approach:null, target:'release', exit:'landing', clips:['armsUp'], seconds:.9, commitMs:0, interruptible:true },
  'vehicle-enter': { category:'vehicle', objects:['vehicle-door'], requires:'stationary-vehicle', approach:'door-side', target:'seat', exit:'ride', clips:['sitDown','sitTable'], seconds:.48, commitMs:0, interruptible:false },
  'vehicle-exit': { category:'vehicle', objects:['vehicle-door'], requires:'vehicle-occupancy', approach:null, target:'stand-clear', exit:'idle', clips:['standUp'], seconds:.48, commitMs:0, interruptible:false },
};
export const isGesture = kind => kind === 'door-push' || kind === 'door-pull' || kind === 'pickup';
export function doorHandle(door, leaf, calibration=fixtureCalibration(door.id)) {
  const along=(door.glass?leaf.len*.55:leaf.len-.16)+calibration.x;
  return {
    x:leaf.dir*Math.max(.12,Math.min(leaf.len-.12,along)),
    y:(door.glass?1.05:1.02)+calibration.y,
    z:Math.max(.02,(door.glass?.06:.0675)+calibration.z),
  };
}

/** The room creates this projection only after the gameplay operation succeeds. */
export function markCharacterAction(player, kind, target, at, point) {
  const definition = PRIMITIVES[kind];
  if(!definition||!target)return;
  const action = [((player.actionSequence??0)+1), kind, target, at];
  if(point)action.push(Math.round(point.x*100)/100, Math.round(point.y*100)/100, Math.round(point.z*100)/100);
  player.actionSequence=action[0];
  player.characterAction=action;
}
export function characterActionAt(action, time) {
  return action && time-action[3] < (PRIMITIVES[action[1]].seconds+.5)*1000 ? action : null;
}

/** Resolve compatible routes without applying movement. The controller follows them with ordinary inputs. */
export function seatRoute(seat, from, seats) {
  const fx=Math.sin(seat.yaw),fz=Math.cos(seat.yaw),rx=fz,rz=-fx;
  const dx=from.x-seat.x,dz=from.z-seat.z,front=fx*dx+fz*dz,lat=rx*dx+rz*dz;
  if(seat.kind!=='chair'||front>.05)return [];
  const side=lat>=0?1:-1;
  let room=.58;
  for(const o of seats)if(o!==seat&&Math.abs(o.x-seat.x)<1.2&&Math.abs(o.z-seat.z)<1.2){
    const ol=rx*(o.x-seat.x)+rz*(o.z-seat.z),of=fx*(o.x-seat.x)+fz*(o.z-seat.z);
    if(Math.sign(ol)===side&&Math.abs(of)<.5)room=Math.min(room,Math.abs(ol)/2);
  }
  const at=fw=>({x:seat.x+rx*side*room+fx*fw,z:seat.z+rz*side*room+fz*fw});
  return front<-.3?[at(-.3),at(.25)]:[at(.25)];
}

/** Common semantic action, independent of the skeletal rig or the camera presenting it. */
export function characterAction(context) {
  if(context.vehicle)return 'vehicle';
  if(context.seat)return 'seating';
  if(context.slide)return 'slide';
  if(context.phase==='reload'||context.phase==='switch'||context.phase==='melee')return context.phase;
  if(context.interaction)return 'interaction';
  if(!context.grounded)return context.vy>0?'jump':'fall';
  if(context.crouch)return 'crouch';
  if(context.sprint&&context.speed>.35)return 'sprint';
  if(context.sport)return 'sport';
  return context.speed>.08?'locomotion':'idle';
}
