import * as THREE from 'three';

// ORC FREE-POSE. No authored joint limits, bend-axis projection or quaternion
// clamping. The ONLY geometric limit is the real length of the source bones.
// Shared Zelda v13 whole-model controller code is untouched.
const V=()=>new THREE.Vector3();
const Q=()=>new THREE.Quaternion();
const world=bone=>bone.getWorldPosition(V());

export const keyOf=bone=>bone.name.replace(/^mixamorig[:_]?/i,'').replace(/[^A-Za-z0-9]/g,'');

// Three independent full-range Euler axes on EVERY existing source bone.
// These are slider extents, not joint restrictions: every 3D orientation is
// representable using angles in this range.
const FULL=[[-180,180],[-180,180],[-180,180]];
const ALL_NAMES=[
  'Hips','Spine','Spine1','Spine2','Neck','Head',
  'LeftShoulder','RightShoulder','LeftArm','RightArm',
  'LeftForeArm','RightForeArm','LeftHand','RightHand',
  'LeftHandIndex1','LeftHandIndex2','LeftHandIndex3',
  'RightHandIndex1','RightHandIndex2','RightHandIndex3',
  'LeftUpLeg','RightUpLeg','LeftLeg','RightLeg',
  'LeftFoot','RightFoot','LeftToeBase','RightToeBase'
];
export const JOINT_LIMITS=Object.fromEntries(ALL_NAMES.map(name=>[name,FULL]));

// Kept under the previous name so no calling code is broken. No limits.
export function boundedLocal(bone,desired){
  return desired.clone().normalize();
}

function aimBone(bone,from,to){
  if(from.lengthSq()<1e-14||to.lengthSq()<1e-14)return;
  bone.updateWorldMatrix(true,true);
  const current=bone.getWorldQuaternion(Q());
  const correction=Q().setFromUnitVectors(from.normalize(),to.normalize());
  const desiredWorld=correction.multiply(current);
  const parentWorld=bone.parent?bone.parent.getWorldQuaternion(Q()):Q();
  bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld).normalize());
  bone.updateWorldMatrix(true,true);
}
export function solveOneBone({upper,end},goal){
  const a=world(upper),b=world(end);
  aimBone(upper,b.sub(a),goal.clone().sub(a));
}

export function solveTwoBone({upper,lower,end, fallbackPole},goal){
  upper.updateWorldMatrix(true,true);
  const a=world(upper),b=world(lower),c=world(end);
  const upperLength=a.distanceTo(b),lowerLength=b.distanceTo(c);
  if(upperLength<1e-8||lowerLength<1e-8)return;

  const toward=goal.clone().sub(a);
  const requestedDistance=toward.length();
  if(requestedDistance<1e-8)return;
  toward.divideScalar(requestedDistance);

  // A two-segment arm/leg cannot extend beyond its actual bone length.
  // Clamp the unreachable WORLD-SPACE endpoint, not the user's drag travel.
  // No arbitrary FBX-local distance cap or degree limit is applied.
  const minimum=Math.abs(upperLength-lowerLength)+1e-7;
  const maximum=upperLength+lowerLength-1e-7;
  const reach=THREE.MathUtils.clamp(requestedDistance,
    Math.min(minimum,maximum),Math.max(minimum,maximum));
  const reachable=a.clone().addScaledVector(toward,reach);
  const projection=(upperLength*upperLength-lowerLength*lowerLength+reach*reach)/(2*reach);
  const bendHeight=Math.sqrt(Math.max(0,upperLength*upperLength-projection*projection));

  // Preserve the current animated elbow/knee bend plane if possible.
  let pole=b.clone().sub(a);
  pole.addScaledVector(toward,-pole.dot(toward));
  if(pole.lengthSq()<1e-10 && fallbackPole){
    pole.copy(fallbackPole);
    pole.addScaledVector(toward,-pole.dot(toward));
  }
  if(pole.lengthSq()<1e-10){
    pole=new THREE.Vector3(0,1,0).cross(toward);
    if(pole.lengthSq()<1e-10)pole=new THREE.Vector3(1,0,0).cross(toward);
  }
  pole.normalize();
  const midpoint=a.clone().addScaledVector(toward,projection).addScaledVector(pole,bendHeight);

  aimBone(upper,b.clone().sub(a),midpoint.sub(a));
  upper.updateWorldMatrix(true,true);
  const knee=world(lower);
  const tip=world(end);
  aimBone(lower,tip.sub(knee),reachable.sub(knee));
}
