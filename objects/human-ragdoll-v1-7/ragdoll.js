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
// Project onto convex halfspaces for a forgiving, pose-aware near-grab.
export function projectHull(point,planes,iterations=6){
  const p=point.clone();for(let k=0;k<iterations;k++){let worst=0;for(const [x,y,z,d] of planes){const v=x*p.x+y*p.y+z*p.z+d;if(v>0){const f=v/(x*x+y*y+z*z);p.x-=f*x;p.y-=f*y;p.z-=f*z;worst=Math.max(worst,v);}}if(worst<1e-6)break;}return p;
}
// Local articulation remains mass-sensitive. When the controller pulls
// farther than the limb can follow, transmit the excess force to the torso
// and pelvis, instead of forcing the distal joint to bear the whole load.
export function pullForces(error,velocity,gravity,mass,heft=1,handCount=1){
  const weight=Math.max(.25,heft),s=Math.sqrt(weight),distance=error.length(),assist=THREE.MathUtils.smoothstep(distance,.085,.30);
  const effectiveMass=Math.max(2.4,mass); // A hand must also move its connected forearm.
  const f=error.clone().multiplyScalar(220/s).addScaledVector(velocity,-22).multiplyScalar(effectiveMass).addScaledVector(gravity,-mass);
  f.clampLength(0,Math.min(480,Math.max(115,mass*100))/s);
  const drag=error.clone().multiplyScalar(3500/s).addScaledVector(velocity,-65).clampLength(0,1100/s/Math.max(1,handCount));
  drag.multiplyScalar(assist);
  return {local:f,drag,assist};
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
  world.SetPhysicsSettings(ps); // Borrowed const reference; never destroy.
  const v=vec=>new J.Vec3(vec.x,vec.y,vec.z),rv=vec=>new J.RVec3(vec.x,vec.y,vec.z),jq=q=>new J.Quat(q.x,q.y,q.z,q.w);
  const posTmp=new J.RVec3(0,0,0),rotTmp=new J.Quat(0,0,0,1),forceTmp=new J.Vec3(0,0,0),pointTmp=new J.RVec3(0,0,0),zero=new J.Vec3(0,0,0);
  const rest=fit.rest.map(a=>V(...a)),N=fit.shapes.length,filter=new J.GroupFilterTable(N);filter.AddRef();
  for(let i=0;i<N;i++)if(fit.shapes[i].parent>=0)filter.DisableCollision(i,fit.shapes[i].parent);
  const bodies=[],constraints=[],positions=Array.from({length:N},()=>V()),rotations=Array.from({length:N},()=>Q()),owned=[];
  const owner=Array(22).fill(-1);fit.shapes.forEach((s,i)=>s.bones.forEach(k=>owner[k]=i));
  function newBody(shape,pos,mass,index){
    const p=rv(pos),q=jq(Q()),s=new J.BodyCreationSettings(shape,p,q,mass?J.EMotionType_Dynamic:J.EMotionType_Static,mass?1:0);J.destroy(p);J.destroy(q);
    s.mFriction=mass ? .72 : .82;s.mRestitution=mass?0:.12;
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
  function setBounce(value){bi.SetRestitution(floor.GetID(),Math.max(0,Math.min(.22,value)));}
  function wake(){for(const b of bodies)bi.ActivateBody(b.GetID());}
  function reset(){for(let i=0;i<N;i++){const p=rest[fit.shapes[i].root];pointTmp.Set(p.x,p.y,p.z);rotTmp.Set(0,0,0,1);const id=bodies[i].GetID();bi.SetPositionAndRotation(id,pointTmp,rotTmp,J.EActivation_Activate);bi.SetLinearAndAngularVelocity(id,zero,zero);}sync();}
  function grab(index,offset,target,gravity,dt,heft=1,handCount=1){
    const point=offset.clone().applyQuaternion(rotations[index]).add(positions[index]),id=bodies[index].GetID();
    pointTmp.Set(point.x,point.y,point.z);const vel=bi.GetPointVelocity(id,pointTmp),velocity=V(vel.GetX(),vel.GetY(),vel.GetZ());J.destroy(vel);
    const {local,drag}=pullForces(target.clone().sub(point),velocity,gravity,fit.shapes[index].mass,heft,handCount);
    local.multiplyScalar(dt);forceTmp.Set(local.x,local.y,local.z);bi.AddImpulse(id,forceTmp,pointTmp);
    // Distribute the whole-body pulling load at the two central COMs.
    // Native joints, floor contacts and self-collision still solve normally.
    if(drag.lengthSq()>1e-8)for(const [i,w] of [[0,.60],[1,.40]]){
      const f=drag.clone().multiplyScalar(w*dt);forceTmp.Set(f.x,f.y,f.z);bi.AddImpulse(bodies[i].GetID(),forceTmp);
    }
  }
  function pickNear(point,radius=.11){
    let best=null;
    for(let i=0;i<N;i++){const local=point.clone().sub(positions[i]).applyQuaternion(rotations[i].clone().invert()),offset=projectHull(local,fit.shapes[i].planes),d=local.distanceTo(offset);
      if(d>radius)continue;
      // Prefer the nearest centre among overlapping envelopes when inside.
      const score=d+Math.min(.03,local.length()*.025);
      if(!best||score<best.score)best={index:i,offset,score,d};
    }return best;
  }
  function poseBounds(){
    const box=new THREE.Box3();const p=V();
    for(let i=0;i<N;i++)for(const v of fit.shapes[i].vertices){p.set(...v).applyQuaternion(rotations[i]).add(positions[i]);box.expandByPoint(p);}
    return box;
  }
  function rebase(shift){
    // Shift coordinate origin, not the character's world pose. Whole-grip
    // freezes articulation, so clear residual rigid velocities at acquisition.
    for(let i=0;i<N;i++){const p=positions[i].clone().sub(shift),q=rotations[i],id=bodies[i].GetID();
      pointTmp.Set(p.x,p.y,p.z);rotTmp.Set(q.x,q.y,q.z,q.w);bi.SetPositionAndRotation(id,pointTmp,rotTmp,J.EActivation_Activate);bi.SetLinearAndAngularVelocity(id,zero,zero);}
    sync();
  }
  function pick(ray,pad=.022){
    let best=null;
    for(let i=0;i<N;i++){const q=rotations[i].clone().invert(),o=ray.origin.clone().sub(positions[i]).applyQuaternion(q),d=ray.direction.clone().applyQuaternion(q),t=rayHull(o,d,fit.shapes[i].planes,pad);
      if(t===null||best&&t>=best.t)continue;const exact=rayHull(o,d,fit.shapes[i].planes,0),offset=o.clone().addScaledVector(d,exact??t);best={index:i,t,offset};}
    return best;
  }
  // The furniture is a dynamic compound body in the same Jolt world.
  // The character's local physics frame may translate, rotate or resize;
  // preserve the furniture's independent world pose and world velocities.
  let table=null;
  function makeTableShape(parts){
    const cs=new J.StaticCompoundShapeSettings(),children=[],p=new J.Vec3(0,0,0),q=new J.Quat(0,0,0,1);
    for(const part of parts){const h=new J.Vec3(...part.half),shape=new J.BoxShape(h,Math.min(.002,...part.half.map(x=>x*.15)),null);J.destroy(h);shape.AddRef();children.push(shape);p.Set(...part.center);cs.AddShapeShape(p,q,shape,0);}
    const result=cs.Create();if(!result.IsValid())throw Error('Compound table collision shape failed');const shape=result.Get();shape.AddRef();
    J.destroy(result);J.destroy(cs);J.destroy(p);J.destroy(q);for(const child of children)child.Release();return shape;
  }
  function scaledTableShape(base,scale){if(Math.abs(scale-1)<1e-7){base.AddRef();return base;}const s=new J.Vec3(1/scale,1/scale,1/scale),shape=new J.ScaledShape(base,s);J.destroy(s);shape.AddRef();return shape;}
  function installTable(parts,anchor,position=V(.72,.012,-2.95)){
    if(table)throw Error('Table already installed');
    anchor.updateWorldMatrix(true,false);const scale=anchor.getWorldScale(V()).x,base=makeTableShape(parts),shape=scaledTableShape(base,scale);
    const p=rv(anchor.worldToLocal(position.clone())),q=jq(anchor.getWorldQuaternion(Q()).invert());
    const cs=new J.BodyCreationSettings(shape,p,q,J.EMotionType_Dynamic,1);J.destroy(p);J.destroy(q);
    cs.mFriction=.78;cs.mRestitution=.04;cs.mLinearDamping=.12;cs.mAngularDamping=.65;cs.mMotionQuality=J.EMotionQuality_LinearCast;cs.mAllowSleeping=true;cs.mOverrideMassProperties=J.EOverrideMassProperties_CalculateInertia;const mp=cs.mMassPropertiesOverride;mp.mMass=32;cs.mMassPropertiesOverride=mp;
    const body=bi.CreateBody(cs);J.destroy(cs);if(!body)throw Error('Table body creation failed');bi.AddBody(body.GetID(),J.EActivation_Activate);
    table={body,base,shape,parts,scale,position:position.clone(),rotation:Q(),velocity:V(),angular:V(),framePosition:anchor.getWorldPosition(V()),frameRotation:anchor.getWorldQuaternion(Q())};
    return table;
  }
  function syncTableFrame(anchor){
    if(!table)return;
    anchor.updateWorldMatrix(true,false);const s=anchor.getWorldScale(V()).x,p=anchor.getWorldPosition(V()),q=anchor.getWorldQuaternion(Q());
    if(p.distanceToSquared(table.framePosition)<1e-12&&1-Math.abs(q.dot(table.frameRotation))<1e-12&&Math.abs(s-table.scale)<1e-7)return;
    const id=table.body.GetID(),inv=q.clone().invert();
    if(Math.abs(s-table.scale)>=1e-7){const next=scaledTableShape(table.base,s);bi.SetShape(id,next,true,J.EActivation_Activate);table.shape.Release();table.shape=next;table.body.GetMotionProperties().ScaleToMass(32);}
    const pos=anchor.worldToLocal(table.position.clone()),rot=inv.clone().multiply(table.rotation),vel=table.velocity.clone().applyQuaternion(inv).divideScalar(s),ang=table.angular.clone().applyQuaternion(inv);
    pointTmp.Set(pos.x,pos.y,pos.z);rotTmp.Set(rot.x,rot.y,rot.z,rot.w);bi.SetPositionAndRotation(id,pointTmp,rotTmp,J.EActivation_Activate);
    const a=v(vel),b=v(ang);bi.SetLinearAndAngularVelocity(id,a,b);J.destroy(a);J.destroy(b);
    table.scale=s;table.framePosition.copy(p);table.frameRotation.copy(q);
  }
  function captureTable(anchor){
    if(!table)return;
    const id=table.body.GetID();bi.GetPositionAndRotation(id,posTmp,rotTmp);
    table.position.copy(anchor.localToWorld(V(posTmp.GetX(),posTmp.GetY(),posTmp.GetZ())));
    const aq=anchor.getWorldQuaternion(Q());table.rotation.copy(aq).multiply(Q().set(rotTmp.GetX(),rotTmp.GetY(),rotTmp.GetZ(),rotTmp.GetW()));
    const lv=bi.GetLinearVelocity(id),av=bi.GetAngularVelocity(id);
    table.velocity.set(lv.GetX(),lv.GetY(),lv.GetZ()).multiplyScalar(table.scale).applyQuaternion(aq);
    table.angular.set(av.GetX(),av.GetY(),av.GetZ()).applyQuaternion(aq);J.destroy(lv);J.destroy(av);
  }
  function tableDrop(anchor){
    if(!table)return;table.position.y+=.35;table.velocity.set(0,0,0);table.angular.set(0,0,0);table.framePosition.set(Infinity,0,0);syncTableFrame(anchor);
  }
  function removeTable(){if(!table)return;const id=table.body.GetID();bi.RemoveBody(id);bi.DestroyBody(id);table.shape.Release();table.base.Release();table=null;}
  function step(dt){jolt.Step(dt,1);sync();}
  function dispose(){removeTable();for(const c of constraints)world.RemoveConstraint(c);for(const b of [...bodies,floor]){const id=b.GetID();bi.RemoveBody(id);bi.DestroyBody(id);}for(const shape of owned)shape.Release();filter.Release();for(const x of [posTmp,rotTmp,forceTmp,pointTmp,zero])J.destroy(x);J.destroy(jolt);}
  sync();return {bodies,positions,rotations,rest,owner,fit,step,pick,pickNear,poseBounds,rebase,grab,installTable,syncTableFrame,captureTable,tableDrop,get table(){return table;},setFloor,setBounce,wake,reset,dispose,world,bi};
}
