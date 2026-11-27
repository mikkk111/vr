// Native Jolt rigid bodies: skin-fitted hulls, anatomical hinge/swing-twist
// constraints. No cloth, XPBD, deforming mesh, or per-frame triangle work.
import * as THREE from 'three';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),Q=()=>new THREE.Quaternion(),rad=d=>d*Math.PI/180;
const Y=V(0,1,0),X=V(1,0,0),Z=V(0,0,1);
export function rayHull(origin,dir,planes,pad=0){
  let lo=0,hi=Infinity;
  for(const [x,y,z,d] of planes){const n=x*origin.x+y*origin.y+z*origin.z+d-pad,v=x*dir.x+y*dir.y+z*dir.z;
    if(Math.abs(v)<1e-10){if(n>0)return null;continue;}
    const t=-n/v;if(v<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
  }return hi<0?null:lo;
}
export function createRagdoll(J,fit){
  const settings=new J.JoltSettings();settings.mMaxBodies=128;settings.mMaxBodyPairs=2048;settings.mMaxContactConstraints=2048;settings.mMaxWorkerThreads=0;
  const pair=new J.ObjectLayerPairFilterTable(2);pair.EnableCollision(0,1);pair.EnableCollision(1,1);
  const broad=new J.BroadPhaseLayerInterfaceTable(2,2),l0=new J.BroadPhaseLayer(0),l1=new J.BroadPhaseLayer(1);
  broad.MapObjectToBroadPhaseLayer(0,l0);broad.MapObjectToBroadPhaseLayer(1,l1);
  settings.mObjectLayerPairFilter=pair;settings.mBroadPhaseLayerInterface=broad;settings.mObjectVsBroadPhaseLayerFilter=new J.ObjectVsBroadPhaseLayerFilterTable(broad,2,pair,2);
  const jolt=new J.JoltInterface(settings);J.destroy(settings);J.destroy(l0);J.destroy(l1);
  const world=jolt.GetPhysicsSystem(),bi=world.GetBodyInterface(),ps=world.GetPhysicsSettings();
  ps.mNumVelocitySteps=12;ps.mNumPositionSteps=4;ps.mPenetrationSlop=.001;ps.mSpeculativeContactDistance=.012;ps.mLinearCastThreshold=.25;ps.mLinearCastMaxPenetration=.10;
  world.SetPhysicsSettings(ps);J.destroy(ps);
  const v=vec=>new J.Vec3(vec.x,vec.y,vec.z),rv=vec=>new J.RVec3(vec.x,vec.y,vec.z),jq=q=>new J.Quat(q.x,q.y,q.z,q.w);
  const posTmp=new J.RVec3(0,0,0),rotTmp=new J.Quat(0,0,0,1),forceTmp=new J.Vec3(0,0,0),pointTmp=new J.RVec3(0,0,0),zero=new J.Vec3(0,0,0);
  const rest=fit.rest.map(a=>V(...a)),N=fit.shapes.length,filter=new J.GroupFilterTable(N);filter.AddRef();
  for(let i=0;i<N;i++)if(fit.shapes[i].parent>=0)filter.DisableCollision(i,fit.shapes[i].parent);
  const bodies=[],constraints=[],positions=Array.from({length:N},()=>V()),rotations=Array.from({length:N},()=>Q()),owned=[];
  const owner=Array(22).fill(-1);fit.shapes.forEach((s,i)=>s.bones.forEach(k=>owner[k]=i));
  function newBody(shape,pos,mass,index){
    const p=rv(pos),q=jq(Q()),s=new J.BodyCreationSettings(shape,p,q,mass?J.EMotionType_Dynamic:J.EMotionType_Static,mass?1:0);J.destroy(p);J.destroy(q);
    s.mFriction=mass ? .72 : .82;s.mRestitution=0;
    if(mass){s.mMotionQuality=J.EMotionQuality_LinearCast;s.mLinearDamping=.10;s.mAngularDamping=.65;s.mMaxLinearVelocity=7;s.mMaxAngularVelocity=12;s.mAllowSleeping=true;s.mOverrideMassProperties=J.EOverrideMassProperties_CalculateInertia;
      const mp=s.mMassPropertiesOverride;mp.mMass=mass;s.mMassPropertiesOverride=mp;
      s.mCollisionGroup.SetGroupFilter(filter);s.mCollisionGroup.SetGroupID(1);s.mCollisionGroup.SetSubGroupID(index);}
    const b=bi.CreateBody(s);if(!b)throw Error('Jolt body creation failed '+index);J.destroy(s);bi.AddBody(b.GetID(),mass?J.EActivation_Activate:J.EActivation_DontActivate);return b;
  }
  const floorHalf=new J.Vec3(40,.05,40),floorShape=new J.BoxShape(floorHalf,.005,null);J.destroy(floorHalf);floorShape.AddRef();owned.push(floorShape);
  const floor=newBody(floorShape,V(0,-1.27,0),0,-1);
  for(let i=0;i<N;i++){
    const s=fit.shapes[i],h=new J.ConvexHullShapeSettings();h.mMaxConvexRadius=.001;h.mHullTolerance=.0001;
    const point=new J.Vec3(0,0,0);
    for(const a of s.vertices){point.Set(a[0],a[1],a[2]);h.mPoints.push_back(point);}J.destroy(point);
    const result=h.Create();if(!result.IsValid())throw Error('Invalid convex hull '+s.name);
    const shape=result.Get();shape.AddRef();owned.push(shape);
    bodies.push(newBody(shape,rest[s.root],s.mass,i));J.destroy(result);J.destroy(h);
  }
  // Constraints are built in world coordinates in the exact bind pose.
  // Positive X flexes the knee backward; negative X flexes the elbow forward.
  for(let i=1;i<N;i++){
    const s=fit.shapes[i],name=s.name,parent=s.parent,pivot=rest[s.root],point=rv(pivot),child=fit.parents.findIndex(k=>k===s.root);
    const dir=child>=0?rest[child].clone().sub(pivot).normalize():Y.clone();
    let cs;
    if(name.includes('LowerArm')||name.includes('LowerLeg')){
      cs=new J.HingeConstraintSettings();cs.mSpace=J.EConstraintSpace_WorldSpace;cs.mPoint1=cs.mPoint2=point;
      const axis=Z.clone().cross(dir).normalize();if(axis.x<0)axis.negate();const a=v(axis),normal=v(dir);
      cs.mHingeAxis1=cs.mHingeAxis2=a;cs.mNormalAxis1=cs.mNormalAxis2=normal;
      cs.mLimitsMin=rad(name.includes('LowerArm')?-145:-3);cs.mLimitsMax=rad(name.includes('LowerArm')?3:140);cs.mMaxFrictionTorque=name.includes('LowerArm')?1.4:4.0;J.destroy(a);J.destroy(normal);
    }else{
      cs=new J.SwingTwistConstraintSettings();cs.mSpace=J.EConstraintSpace_WorldSpace;cs.mPosition1=cs.mPosition2=point;
      let twist=dir.clone(),plane=Z.clone(),normalLimit=25,planeLimit=25,twistLimit=20,friction=2;
      if(name==='Spine'){twist.copy(Y);normalLimit=18;planeLimit=24;twistLimit=18;friction=12;}
      else if(name==='Neck'){twist.copy(Y);normalLimit=35;planeLimit=40;twistLimit=55;friction=1.5;}
      else if(name.includes('UpperArm')){normalLimit=100;planeLimit=85;twistLimit=65;friction=2.0;}
      else if(name.includes('UpperLeg')){normalLimit=50;planeLimit=85;twistLimit=35;friction=4;}
      else if(name.includes('Hand')){twist=rest[s.root].clone().sub(rest[fit.shapes[parent].root]).normalize();normalLimit=55;planeLimit=65;twistLimit=25;friction=.7;}
      else if(name.includes('Foot')){twist.copy(Y).negate();normalLimit=18;planeLimit=40;twistLimit=15;friction=1.6;}
      plane.addScaledVector(twist,-plane.dot(twist)).normalize();if(plane.lengthSq()<.5)plane.copy(X).addScaledVector(twist,-X.dot(twist)).normalize();
      const ax=v(twist),pl=v(plane);cs.mTwistAxis1=cs.mTwistAxis2=ax;cs.mPlaneAxis1=cs.mPlaneAxis2=pl;
      cs.mNormalHalfConeAngle=rad(normalLimit);cs.mPlaneHalfConeAngle=rad(planeLimit);cs.mTwistMinAngle=rad(-twistLimit);cs.mTwistMaxAngle=rad(twistLimit);cs.mMaxFrictionTorque=friction;J.destroy(ax);J.destroy(pl);
    }
    cs.mNumVelocityStepsOverride=12;cs.mNumPositionStepsOverride=4;
    const constraint=cs.Create(bodies[parent],bodies[i]);if(!constraint)throw Error('Constraint creation failed '+name);
    world.AddConstraint(constraint);constraints.push(constraint);J.destroy(cs);J.destroy(point);
  }
  world.OptimizeBroadPhase();
  function sync(){
    for(let i=0;i<N;i++){bi.GetPositionAndRotation(bodies[i].GetID(),posTmp,rotTmp);positions[i].set(posTmp.GetX(),posTmp.GetY(),posTmp.GetZ());rotations[i].set(rotTmp.GetX(),rotTmp.GetY(),rotTmp.GetZ(),rotTmp.GetW());}
  }
  function setFloor(center,q,gravity){
    pointTmp.Set(center.x,center.y,center.z);rotTmp.Set(q.x,q.y,q.z,q.w);bi.SetPositionAndRotationWhenChanged(floor.GetID(),pointTmp,rotTmp,J.EActivation_DontActivate);
    forceTmp.Set(gravity.x,gravity.y,gravity.z);world.SetGravity(forceTmp);
  }
  function wake(){for(const b of bodies)bi.ActivateBody(b.GetID());}
  function reset(){for(let i=0;i<N;i++){const p=rest[fit.shapes[i].root];pointTmp.Set(p.x,p.y,p.z);rotTmp.Set(0,0,0,1);const id=bodies[i].GetID();bi.SetPositionAndRotation(id,pointTmp,rotTmp,J.EActivation_Activate);bi.SetLinearAndAngularVelocity(id,zero,zero);}sync();}
  function grab(index,offset,target,gravity,dt){
    const point=offset.clone().applyQuaternion(rotations[index]).add(positions[index]),id=bodies[index].GetID();
    pointTmp.Set(point.x,point.y,point.z);const vel=bi.GetPointVelocity(id,pointTmp);const velocity=V(vel.GetX(),vel.GetY(),vel.GetZ());J.destroy(vel);
    const acc=target.clone().sub(point).multiplyScalar(180).addScaledVector(velocity,-25).sub(gravity).clampLength(0,55);
    acc.multiplyScalar(fit.shapes[index].mass*dt);forceTmp.Set(acc.x,acc.y,acc.z);bi.AddImpulse(id,forceTmp,pointTmp);
  }
  function pick(ray,pad=.022){
    let best=null;
    for(let i=0;i<N;i++){const q=rotations[i].clone().invert(),o=ray.origin.clone().sub(positions[i]).applyQuaternion(q),d=ray.direction.clone().applyQuaternion(q),t=rayHull(o,d,fit.shapes[i].planes,pad);
      if(t===null||best&&t>=best.t)continue;const exact=rayHull(o,d,fit.shapes[i].planes,0),offset=o.clone().addScaledVector(d,exact??t);best={index:i,t,offset};}
    return best;
  }
  function step(dt){jolt.Step(dt,1);sync();}
  function dispose(){for(const c of constraints)world.RemoveConstraint(c);for(const b of [...bodies,floor]){const id=b.GetID();bi.RemoveBody(id);bi.DestroyBody(id);}for(const shape of owned)shape.Release();filter.Release();for(const x of [posTmp,rotTmp,forceTmp,pointTmp,zero])J.destroy(x);J.destroy(jolt);}
  sync();return {bodies,positions,rotations,rest,owner,fit,step,pick,grab,setFloor,wake,reset,dispose,world,bi};
}
