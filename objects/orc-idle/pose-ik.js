import * as THREE from 'three';
import {JOINT_LIMITS,keyOf,boundedLocal,solveTwoBone,solveOneBone} from './ik-solver.js?v=orc-unrestricted-1';

// The authored FBX clip remains live. Each frame: restore the base rig,
// evaluate AnimationMixer, then solve local-space IK target OFFSETS.
// Controller triggers are independent of the unmodified Zelda v13 side grips.
const D=Math.PI/180, V=()=>new THREE.Vector3(), Q=()=>new THREE.Quaternion();
const at=bone=>bone.getWorldPosition(V());
// Free-bone posing: the solver and UI do not cap rotation angles.
const IK_DEFS=[
  {name:'LeftHand',kind:'two',upper:'LeftArm',lower:'LeftForeArm'},
  {name:'RightHand',kind:'two',upper:'RightArm',lower:'RightForeArm'},
  {name:'LeftFoot',kind:'two',upper:'LeftUpLeg',lower:'LeftLeg'},
  {name:'RightFoot',kind:'two',upper:'RightUpLeg',lower:'RightLeg'},
  {name:'Head',kind:'two',upper:'Spine2',lower:'Neck'},
  {name:'LeftForeArm',kind:'one',upper:'LeftArm'},
  {name:'RightForeArm',kind:'one',upper:'RightArm'},
  {name:'LeftLeg',kind:'one',upper:'LeftUpLeg'},
  {name:'RightLeg',kind:'one',upper:'RightUpLeg'}
];
function angleAxis(delta,axis) {
  const x=delta.x*axis.x+delta.y*axis.y+delta.z*axis.z;
  let rad=2*Math.atan2(x,delta.w);
  rad=Math.atan2(Math.sin(rad),Math.cos(rad));
  return rad/D;
}
function worldAim(controller) {
  controller.updateWorldMatrix(true,false);
  const position=controller.getWorldPosition(V());
  const quat=controller.getWorldQuaternion(Q());
  return {position,quat,direction:V().set(0,0,-1).applyQuaternion(quat).normalize()};
}
export function createOrcIKPose({renderer,scene,root,camera,onStatus,onSelection}) {
  const bones=new Map(), allBones=[],rest=new Map(),meshes=[];
  root.traverse(node=>{
    if(node.isBone){
      allBones.push(node);rest.set(node,node.quaternion.clone());
      const k=keyOf(node);if(!bones.has(k))bones.set(k,node);
    }
    if(node.isSkinnedMesh && node.skeleton?.bones?.length)meshes.push(node);
  });
  if(!meshes.length)throw Error('A skinned humanoid FBX/GLB is required for IK posing.');
  root.updateWorldMatrix(true,true);
  const rootWorldQ=root.getWorldQuaternion(Q());
  const hips=bones.get('Hips'),neck=bones.get('Neck');
  const leftHip=bones.get('LeftUpLeg'),rightHip=bones.get('RightUpLeg');
  const bodyRight=leftHip&&rightHip
    ?at(rightHip).sub(at(leftHip)).normalize()
    :V().set(1,0,0).applyQuaternion(rootWorldQ);
  if(bodyRight.lengthSq()<.1)bodyRight.set(1,0,0);
  const bodyUp=hips&&neck
    ?at(neck).sub(at(hips)).normalize()
    :V().set(0,1,0).applyQuaternion(rootWorldQ);
  if(bodyUp.lengthSq()<.1)bodyUp.set(0,1,0);
  const bodyFront=V().crossVectors(bodyRight,bodyUp).normalize();
  if(bodyFront.lengthSq()<.1)bodyFront.set(0,0,1);
  const joints=[];
  for(const [name,bone] of bones){
    const limits=JOINT_LIMITS[name];if(!limits)continue;
    const hinge=false,axis=null; // All joints are free on three axes.
    const isIK=IK_DEFS.some(d=>d.name===name);
    // NO visual spheres, markers or other overlay geometry is created.
    // Real skinned mesh surface is picked with a raycast instead.
    joints.push({name,bone,limits,axis,hinge,isIK,
      offsets:[0,0,0],manual:false,bind:rest.get(bone)});
  }
  if(!joints.length)throw Error('No recognised bone names for this rig.');
  const jointMap=new Map(joints.map(j=>[j.name,j]));
  const targetList=IK_DEFS.filter(d=>bones.has(d.name)&&bones.has(d.upper)&&
       (d.kind==='one'||bones.has(d.lower))).map(d=>{
    const parent=bones.get(d.upper),mid=d.lower?bones.get(d.lower):null,end=bones.get(d.name);
    // The POLE is an elbow/knee displacement direction, NOT the normal to
    // the bend plane. Derive it from the source rig whenever possible.
    const p0=at(parent),p1=mid?at(mid):at(end),p2=at(end);
    const line=p2.clone().sub(p0).normalize();
    let fallback=p1.clone().sub(p0);
    fallback.addScaledVector(line,-fallback.dot(line));
    if(fallback.lengthSq()<1e-8)fallback=bodyFront.clone();
    fallback.addScaledVector(line,-fallback.dot(line));
    if(fallback.lengthSq()<1e-8)fallback.copy(bodyRight);
    fallback.normalize();
    // Store in avatar-local space so whole-object grabs/rotations do not
    // double-transform the pole direction.
    fallback.applyQuaternion(rootWorldQ.clone().invert());
    return {...d,upperBone:parent,lowerBone:mid,end,
      offset:V(),fallback,baseLocal:V()};
  });
  const targets=new Map(targetList.map(t=>[t.name,t]));
  for(const t of targets){
    const j=jointMap.get(t.name);
    if(j)j.isIK=true;
  }
  let selected=jointMap.get('LeftHand')||joints[0];
  let enabled=true,dragging=null,dragCallback=()=>{};
  const xrControllers=[renderer.xr.getController(0),renderer.xr.getController(1)];
  const activeXR=new Map();
  function notify(){
    onSelection?.({name:selected.name,hinge:selected.hinge,limits:selected.limits,
      values:[...selected.offsets],ik:targets.has(selected.name)});
  }
  function choose(j){if(j){selected=j;notify();}}
  function setAngles(j,values){
    for(let i=0;i<3;i++)if(Number.isFinite(values[i]))
      j.offsets[i]=values[i]; // No angle limits.
    j.manual=true;
    if(j===selected)notify();
  }
  const worldToRoot=v=>root.worldToLocal(v.clone());
  function setTarget(t,worldPoint){
    if(!t)return;
    // The mixer has already evaluated the original unmodified animation.
    const desired=worldToRoot(worldPoint);
    // FBX source units may be centimetres (or arbitrary scale).
    // The old 2-local-unit cap made controller motion nearly invisible.
    // Target translation is now unrestricted. Physical bone length is
    // naturally handled by solveTwoBone in world coordinates.
    t.offset.copy(desired).sub(t.baseLocal);
  }
  function applyTargets(){
    // All animated base joint positions were captured before solving.
    for(const t of targetList){
      if(t.offset.lengthSq()<1e-10)continue;
      const desired=root.localToWorld(t.baseLocal.clone().add(t.offset));
      if(t.kind==='one'){
        solveOneBone({upper:t.upperBone,end:t.end},desired);
      } else {
        const upper=t.upperBone,lower=t.lowerBone;
        // Legacy solver style: follow target with natural quaternion rotation.
        // Earlier hinge-axis projection here could block shoulder-to-wrist
        // repositioning for FBX skeletons with unconventional local axes.
        solveTwoBone({
          upper,lower,end:t.end,
          fallbackPole:t.fallback.clone().applyQuaternion(root.getWorldQuaternion(Q()))
        },desired);
      }
    }
  }
  function applyAngleEdits(){
    for(const j of joints){
      if(!j.manual)continue;
      const o=j.offsets,b=j.bone;
      const additive=Q().setFromEuler(
        new THREE.Euler(o[0]*D,o[1]*D,o[2]*D,'XYZ'));
      const desired=b.quaternion.clone().multiply(additive);
      b.quaternion.copy(boundedLocal(b,desired));
    }
    root.updateWorldMatrix(true,true);
  }
  // Surface picking: invisible skeletal landmarks and real skinned mesh only.
  // No sphere geometry, material or rendered marker is present anywhere.
  const raycaster=new THREE.Raycaster();
  function nearestSkinTarget(point){
    let best=null,closest=Infinity;
    const ikJoints=joints.filter(j=>targets.has(j.name));
    for(const j of ikJoints){
      const d=at(j.bone).distanceToSquared(point);
      if(d<closest){best=j;closest=d;}
    }
    return best;
  }
  function rayHit(origin,direction){
    root.updateWorldMatrix(true,true);
    raycaster.ray.origin.copy(origin);
    raycaster.ray.direction.copy(direction).normalize();
    raycaster.near=0.01;
    raycaster.far=100;
    // Raycast only upon trigger/click; never every animation frame.
    return raycaster.intersectObjects(meshes,false)[0]?.point||null;
  }
  function nearestPixel(x,y){
    const pick=new THREE.Raycaster();
    pick.setFromCamera(new THREE.Vector2(2*x/innerWidth-1,1-2*y/innerHeight),camera);
    const hit=rayHit(pick.ray.origin,pick.ray.direction);
    if(hit)return nearestSkinTarget(hit);
    // Allow clicking thin fingers and extremities even if the skin ray misses.
    let best=null,dist=Infinity;
    for(const j of joints){
      const p=at(j.bone).project(camera);
      if(p.z< -1||p.z>1)continue;
      const px=(p.x+1)*innerWidth*.5,py=(1-p.y)*innerHeight*.5;
      const d=Math.hypot(px-x,py-y);
      if(d<dist&&d<32){dist=d;best=j;}
    }
    return best;
  }
  function nearestXR(controller){
    root.updateWorldMatrix(true,true);
    const {position,direction}=worldAim(controller);
    let nearest=null,close=Infinity;
    // Near-hand gesture takes precedence over remote pointing.
    for(const j of joints){
      const distance=at(j.bone).distanceTo(position);
      if(distance<close&&distance<0.27){nearest=j;close=distance;}
    }
    if(nearest)return nearest;
    const hit=rayHit(position,direction);
    if(hit)return nearestSkinTarget(hit);
    // Ray may narrowly miss a hand or foot; bone landmark fallback.
    let best=null,bestError=Infinity;
    for(const j of joints){
      const v=at(j.bone).sub(position);
      const depth=v.dot(direction);
      if(depth<=0)continue;
      const miss=v.addScaledVector(direction,-depth).length();
      if(miss<Math.max(.06,depth*.028)&&miss<bestError){
        bestError=miss;best=j;
      }
    }
    return best;
  }
  function startXR(controller,index){
    if(!enabled)return;
    const j=nearestXR(controller);
    if(!j)return;
    choose(j);
    const a=worldAim(controller),t=targets.get(j.name);
    const s={j,t,startPos:a.position,startDir:a.direction,
      startQuat:a.quat,startBoneWorld:j.bone.getWorldQuaternion(Q()),
      startValues:[...j.offsets],
      startGoal:at(j.bone),
      reach:Math.max(.7,at(j.bone).distanceTo(a.position))};
    activeXR.set(index,s);
    onStatus?.(t
      ?j.name+': move your controller UP/DOWN/LEFT/RIGHT, nearer or farther, or aim remotely. Release TRIGGER to keep the position. Animation continues.'
      :j.name+': twist your wrist to adjust bounded rotation. Animation continues.');
  }
  function updateXR(){
    if(!enabled||!renderer.xr.isPresenting)return;
    for(const [index,s] of activeXR){
      const a=worldAim(xrControllers[index]);
      const diff=a.position.sub(s.startPos);
      const rayDiff=a.direction.sub(s.startDir);
      if(s.t){
        // XR hand translation + remote pointing update the end effector
        // directly; no local-coordinate travel limit.
        const goal=s.startGoal.clone().add(diff).addScaledVector(rayDiff,s.reach*.75);
        setTarget(s.t,goal);
      }
      // Simultaneously allow arbitrary wrist/foot/head orientation.
      const delta=a.quat.multiply(s.startQuat.clone().invert());
      const local=s.startBoneWorld.clone().invert().multiply(delta).multiply(s.startBoneWorld);
      if(delta.angleTo(Q())>1e-6){
        const e=new THREE.Euler().setFromQuaternion(local,'XYZ');
        setAngles(s.j,[s.startValues[0]+e.x/D,
          s.startValues[1]+e.y/D,s.startValues[2]+e.z/D]);
      }
    }
  }
  const callbacks=xrControllers.map((c,i)=>{
    const start=()=>startXR(c,i),end=()=>activeXR.delete(i);
    c.addEventListener('selectstart',start);
    c.addEventListener('selectend',end);
    return {c,start,end};
  });
  function cursorWorld(x,y,plane) {
    const raycaster=new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(2*x/innerWidth-1,1-2*y/innerHeight),camera);
    return raycaster.ray.intersectPlane(plane,V());
  }
  const down=e=>{
    if(!enabled||renderer.xr.isPresenting||e.button!==0)return;
    const j=nearestPixel(e.clientX,e.clientY);if(!j)return;
    e.preventDefault();e.stopImmediatePropagation();choose(j);
    const t=targets.get(j.name);
    if(t){
      const goal=at(j.bone);
      const normal=camera.getWorldDirection(V()).normalize();
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,goal);
      const pointer=cursorWorld(e.clientX,e.clientY,plane);
      dragging={j,t,startGoal:goal,startPointer:pointer,plane,
        startY:e.clientY,startX:e.clientX};
    } else {
      dragging={j,t:null,startX:e.clientX,startY:e.clientY,angles:[...j.offsets]};
    }
    dragCallback(true);
  };
  const move=e=>{
    if(!dragging||renderer.xr.isPresenting)return;
    const s=dragging,dx=e.clientX-s.startX,dy=e.clientY-s.startY;
    if(s.t){
      const desired=s.startGoal.clone();
      if(e.shiftKey){
        const forward=camera.getWorldDirection(V()).normalize();
        const side=V().set(1,0,0).applyQuaternion(camera.getWorldQuaternion(Q()));
        desired.addScaledVector(side,dx*.008).addScaledVector(forward,dy*.012);
      }else{
        const position=cursorWorld(e.clientX,e.clientY,s.plane);
        if(position&&s.startPointer)desired.add(position.sub(s.startPointer));
      }
      setTarget(s.t,desired);
    }else{
      const j=s.j,a=s.angles;
      setAngles(j,[a[0]-dy*.65,a[1]+dx*.65,a[2]]);
    }
    e.preventDefault();
  };
  const end=()=>{if(dragging){dragging=null;dragCallback(false);}};
  renderer.domElement.addEventListener('pointerdown',down,true);
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',end);
  notify();
  return {
    boneCount:allBones.length,skinnedMeshCount:meshes.length,
    jointCount:joints.length,jointNames:joints.map(j=>j.name),
    ikTargetNames:targetList.map(t=>t.name),
    setDesktopDragging(fn){dragCallback=fn;},
    setEnabled(value){enabled=!!value;if(!enabled){activeXR.clear();end();}},
    selectName(name){choose(jointMap.get(name));},
    getSelected(){return {name:selected.name,hinge:selected.hinge,
      limits:selected.limits,values:[...selected.offsets],ik:targets.has(selected.name)};},
    changeSelected(axis,value){
      const a=[...selected.offsets];a[axis]=value;setAngles(selected,a);
    },
    prepareFrame(){
      // Prevent repeated IK rotation from accumulating on top of the next
      // animation frame, including clips with incomplete bone channels.
      for(const b of allBones)b.quaternion.copy(rest.get(b));
    },
    update(){
      if(!root.parent)return;
      root.updateWorldMatrix(true,true);
      // Capture original live animated end positions *before* IK.
      for(const t of targetList)t.baseLocal.copy(worldToRoot(at(t.end)));
      updateXR();
      applyTargets();
      applyAngleEdits();
      // No rendered joint balls. Skinned FBX geometry is shown unmodified.
    },
    resetPose(){
      activeXR.clear();end();
      for(const t of targetList)t.offset.set(0,0,0);
      for(const j of joints){j.offsets=[0,0,0];j.manual=false;}
      notify();onStatus?.('IK targets and joint edits cleared; the original animation keeps playing.');
    },
    dispose(){
      activeXR.clear();end();
      for(const {c,start,end:release} of callbacks){
        c.removeEventListener('selectstart',start);
        c.removeEventListener('selectend',release);
      }
      renderer.domElement.removeEventListener('pointerdown',down,true);
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',end);

    }
  };
}
