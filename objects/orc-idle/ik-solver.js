import * as THREE from 'three';

// FABRIK-style target geometry plus a two-bone analytic elbow solution.
// Solve POSITION via parent bone rotations; never translate a skinned bone,
// break skin weights or distort bone lengths. Works with animated FBX bones.
const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
const D = Math.PI / 180;
const get = bone => bone.getWorldPosition(V());

export const JOINT_LIMITS = {
  Hips:[[-25,25],[-30,30],[-20,20]],
  Spine:[[-15,15],[-18,18],[-15,15]],
  Spine1:[[-18,18],[-20,20],[-18,18]],
  Spine2:[[-22,22],[-25,25],[-20,20]],
  Neck:[[-32,32],[-40,40],[-28,28]],
  Head:[[-30,30],[-42,42],[-25,25]],
  LeftShoulder:[[-30,30],[-35,35],[-30,30]],
  RightShoulder:[[-30,30],[-35,35],[-30,30]],
  LeftArm:[[-105,105],[-95,95],[-95,95]],
  RightArm:[[-105,105],[-95,95],[-95,95]],
  LeftForeArm:[[-135,135],null,null],
  RightForeArm:[[-135,135],null,null],
  LeftHand:[[-45,45],[-30,30],[-45,45]],
  RightHand:[[-45,45],[-30,30],[-45,45]],
  LeftHandIndex1:[[-80,80],null,null],
  LeftHandIndex2:[[-85,85],null,null],
  LeftHandIndex3:[[-75,75],null,null],
  RightHandIndex1:[[-80,80],null,null],
  RightHandIndex2:[[-85,85],null,null],
  RightHandIndex3:[[-75,75],null,null],
  LeftUpLeg:[[-105,105],[-50,50],[-65,65]],
  RightUpLeg:[[-105,105],[-50,50],[-65,65]],
  LeftLeg:[[-135,135],null,null],
  RightLeg:[[-135,135],null,null],
  LeftFoot:[[-35,35],[-22,22],[-30,30]],
  RightFoot:[[-35,35],[-22,22],[-30,30]],
  LeftToeBase:[[-35,35],null,null],RightToeBase:[[-35,35],null,null]
};

export const keyOf = bone => bone.name.replace(/^mixamorig[:_]?/i,'').replace(/[^A-Za-z0-9]/g,'');

const capQ = (q,bind,max) => {
  q.normalize();
  if(!bind || !Number.isFinite(max))return q;
  const angle=bind.angleTo(q);
  if(angle<=max*D)return q;
  return bind.clone().slerp(q,max*D/Math.max(0.0001,angle));
};
export function hingeAxis(upper,lower,tip,fallback) {
  // Calibrate from the *actual* imported rig, not assumed Blender axes.
  upper.updateWorldMatrix(true,true);
  const first=get(lower).sub(get(upper));
  const second=get(tip).sub(get(lower));
  const normal=first.clone().cross(second);
  if(normal.lengthSq()<1e-7) {
    normal.copy(fallback);
    normal.addScaledVector(first,-normal.dot(first)/Math.max(first.lengthSq(),1e-10));
  }
  if(normal.lengthSq()<1e-8)normal.set(1,0,0);
  normal.normalize();
  return normal.applyQuaternion(lower.getWorldQuaternion(Q()).invert()).normalize();
}
function signedTwist(q,axis) {
  const along=q.x*axis.x+q.y*axis.y+q.z*axis.z;
  const radians=2*Math.atan2(along,q.w);
  return Math.atan2(Math.sin(radians),Math.cos(radians));
}
export function boundedLocal(bone,desired,opts={}) {
  const {bind,limit=125,axis=null}=opts;
  let output=desired.clone().normalize();
  if(axis && bind) {
    // A knee/elbow is a hinge. Project into its calibrated local axis;
    // the solver keeps the bend pole on its natural side.
    const relative=bind.clone().invert().multiply(output);
    const theta=THREE.MathUtils.clamp(signedTwist(relative,axis),-135*D,135*D);
    output=bind.clone().multiply(Q().setFromAxisAngle(axis,theta)).normalize();
  }
  return capQ(output,bind,limit);
}
function rotateTo(bone,from,to,opts) {
  if(from.lengthSq()<1e-10||to.lengthSq()<1e-10)return;
  bone.updateWorldMatrix(true,false);
  const current=bone.getWorldQuaternion(Q());
  const delta=Q().setFromUnitVectors(from.normalize(),to.normalize());
  const world=delta.multiply(current);
  const parent=bone.parent?bone.parent.getWorldQuaternion(Q()):Q();
  const desired=parent.invert().multiply(world);
  bone.quaternion.copy(boundedLocal(bone,desired,opts));
  bone.updateWorldMatrix(true,true);
}
export function solveOneBone(chain,goal) {
  const {upper,end,opts={}}=chain;
  const p=get(upper),t=get(end);
  rotateTo(upper,t.sub(p),goal.clone().sub(p),opts);
}
export function solveTwoBone(chain,goal) {
  const {upper,lower,end,upperOpts={},lowerOpts={},fallbackPole}=chain;
  upper.updateWorldMatrix(true,true);
  const p0=get(upper),p1=get(lower),p2=get(end);
  const l1=p0.distanceTo(p1),l2=p1.distanceTo(p2);
  if(l1<1e-7||l2<1e-7)return;
  const targetDirection=goal.clone().sub(p0);
  const actual=targetDirection.length();
  if(actual<1e-8)return;
  targetDirection.normalize();
  // Reachable radius: clamp without stretching a single bone.
  const radius=THREE.MathUtils.clamp(actual,Math.abs(l1-l2)+0.00001,l1+l2-0.00001);
  const reachable=p0.clone().addScaledVector(targetDirection,radius);
  const along=(l1*l1-l2*l2+radius*radius)/(2*radius);
  const height=Math.sqrt(Math.max(0,l1*l1-along*along));
  let pole=p1.clone().sub(p0);
  pole.addScaledVector(targetDirection,-pole.dot(targetDirection));
  if(pole.lengthSq()<1e-7) {
    pole=fallbackPole?.clone()||V().set(0,0,1);
    pole.addScaledVector(targetDirection,-pole.dot(targetDirection));
  }
  if(pole.lengthSq()<1e-9) {
    pole.set(0,1,0).cross(targetDirection);
    if(pole.lengthSq()<1e-9)pole.set(1,0,0).cross(targetDirection);
  }
  pole.normalize();
  const elbow=p0.clone().addScaledVector(targetDirection,along).addScaledVector(pole,height);
  rotateTo(upper,p1.clone().sub(p0),elbow.clone().sub(p0),upperOpts);
  upper.updateWorldMatrix(true,true);
  const afterLower=get(lower),afterEnd=get(end);
  rotateTo(lower,afterEnd.sub(afterLower),reachable.sub(afterLower),lowerOpts);
}
