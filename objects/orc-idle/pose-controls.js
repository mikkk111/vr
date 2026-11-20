import * as THREE from 'three';
// Trigger-based joint posing. Original shared Zelda v13 grip engine remains untouched.
// Angular guards are conservative and rig-relative, not medical-grade IK.
const D = Math.PI / 180;
const LIMITS = {
  Hips:[[-25,25],[-30,30],[-20,20]],
  Spine:[[-15,15],[-18,18],[-15,15]],Spine1:[[-18,18],[-20,20],[-18,18]],
  Spine2:[[-22,22],[-25,25],[-20,20]],Neck:[[-25,25],[-35,35],[-22,22]],
  Head:[[-28,28],[-40,40],[-22,22]],
  LeftShoulder:[[-25,25],[-25,25],[-25,25]],RightShoulder:[[-25,25],[-25,25],[-25,25]],
  LeftArm:[[-80,90],[-65,65],[-75,75]],RightArm:[[-80,90],[-65,65],[-75,75]],
  LeftForeArm:[[-5,135],null,null],RightForeArm:[[-5,135],null,null],
  LeftHand:[[-45,45],[-30,30],[-40,40]],RightHand:[[-45,45],[-30,30],[-40,40]],
  LeftHandIndex1:[[-5,80],null,null],LeftHandIndex2:[[-5,85],null,null],LeftHandIndex3:[[-5,75],null,null],
  RightHandIndex1:[[-5,80],null,null],RightHandIndex2:[[-5,85],null,null],RightHandIndex3:[[-5,75],null,null],
  LeftUpLeg:[[-70,80],[-30,30],[-40,40]],RightUpLeg:[[-70,80],[-30,30],[-40,40]],
  LeftLeg:[[-5,135],null,null],RightLeg:[[-5,135],null,null],
  LeftFoot:[[-35,35],[-18,18],[-25,25]],RightFoot:[[-35,35],[-18,18],[-25,25]],
  LeftToeBase:[[-20,40],null,null],RightToeBase:[[-20,40],null,null]
};
const Q=()=>new THREE.Quaternion(), V=()=>new THREE.Vector3();
const point=b=>b.getWorldPosition(V());
const clamp=(v,r)=>THREE.MathUtils.clamp(v,r[0],r[1]);
const keyOf=b=>b.name.replace(/^mixamorig[:_]?/i,'').replace(/[^A-Za-z0-9]/g,'');

export function createOrcPose({renderer,scene,root,camera,onStatus,onPoseStart,onSelection}) {
  const bones=new Map(),skinned=[];
  root.traverse(n=>{
    if(n.isBone && !bones.has(keyOf(n)))bones.set(keyOf(n),n);
    if(n.isSkinnedMesh && n.skeleton?.bones.length)skinned.push(n);
  });
  if(!skinned.length)throw Error('No skin-bound skeleton exists in this file.');
  root.updateWorldMatrix(true,true);
  const hips=bones.get('Hips'),neck=bones.get('Neck'),left=bones.get('LeftUpLeg'),rightLeg=bones.get('RightUpLeg');
  const bodyUp=hips&&neck?point(neck).sub(point(hips)).normalize():new THREE.Vector3(0,1,0);
  const bodyRight=left&&rightLeg?point(rightLeg).sub(point(left)).normalize():new THREE.Vector3(1,0,0);
  if(bodyUp.lengthSq()<.5)bodyUp.set(0,1,0);
  if(bodyRight.lengthSq()<.5)bodyRight.set(1,0,0);
  const sphere=new THREE.SphereGeometry(.018,10,8);
  const joints=[...bones].filter(([n])=>Object.hasOwn(LIMITS,n)).map(([name,bone])=>{
    const limits=LIMITS[name],hinge=!limits[1],leg=/Leg|Toe/.test(name);
    const axis=hinge?(leg?bodyRight.clone():bodyUp.clone().multiplyScalar(name.startsWith('Right')?-1:1))
      .applyQuaternion(bone.getWorldQuaternion(Q()).invert()).normalize():null;
    const mat=new THREE.MeshBasicMaterial({color:hinge?0xffac65:/Arm|Hand/.test(name)?0x50dcef:0xb6a3ff,transparent:true,opacity:.7,depthTest:false});
    const handle=new THREE.Mesh(sphere,mat);handle.renderOrder=90;scene.add(handle);
    return {name,bone,limits,hinge,axis,handle,bind:bone.quaternion.clone(),values:[0,0,0],changed:false};
  });
  if(!joints.length)throw Error('This rig has no recognised joints.');
  const names=new Map(joints.map(j=>[j.name,j]));
  let chosen=names.get('Head')||joints[0],enabled=true,handlesVisible=true,mouse=null,dragEnabled=()=>{};
  const controllers=[renderer.xr.getController(0),renderer.xr.getController(1)],active=new Map();
  const display=()=>onSelection?.({name:chosen.name,hinge:chosen.hinge,limits:chosen.limits,values:[...chosen.values]});
  const choose=j=>{if(j){chosen=j;display();}};
  function modify(j,values) {
    if(!j)return;
    onPoseStart?.();
    for(let i=0;i<3;i++)if(j.limits[i]&&Number.isFinite(values[i]))j.values[i]=clamp(values[i],j.limits[i]);
    j.changed=true;
    if(j===chosen)display();
  }
  function apply() {
    // AnimationMixer.update(0) runs BEFORE this on paused frames, restoring clip
    // transforms. Thus manually applied offsets never compound each frame.
    for(const j of joints){
      if(!j.changed)continue;
      const base=j.bind.clone().invert().multiply(j.bone.quaternion);
      if(j.hinge){
        const a=j.axis;
        const x=base.x*a.x+base.y*a.y+base.z*a.z;
        let angle=2*Math.atan2(x,base.w)/D;
        angle=((angle+180)%360+360)%360-180;
        const rot=new THREE.Quaternion().setFromAxisAngle(a,clamp(angle+j.values[0],j.limits[0])*D);
        j.bone.quaternion.copy(j.bind).multiply(rot);
      }else{
        const rot=new THREE.Euler().setFromQuaternion(base,'XYZ');
        const degrees=[rot.x/D,rot.y/D,rot.z/D];
        for(let i=0;i<3;i++)degrees[i]=clamp(degrees[i]+j.values[i],j.limits[i]);
        j.bone.quaternion.copy(j.bind).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...degrees.map(x=>x*D),'XYZ')));
      }
    }
    root.updateWorldMatrix(true,true);
  }
  const aiming=c=>{
    const o=c.getWorldPosition(V()),q=c.getWorldQuaternion(Q());
    return {o,q,dir:new THREE.Vector3(0,0,-1).applyQuaternion(q).normalize()};
  };
  function findXR(c){
    root.updateWorldMatrix(true,true);
    const {o,dir}=aiming(c);let best=null,score=Infinity;
    for(const j of joints){
      const p=point(j.bone).sub(o),distance=p.length(),depth=p.dot(dir);
      const miss=p.addScaledVector(dir,-depth).length();
      if(!(distance<.24 || depth>0 && miss<Math.max(.075,depth*.045)))continue;
      const s=distance<.24?distance:1+miss+depth*.005;
      if(s<score){best=j;score=s;}
    }
    return best;
  }
  const controllerEvents=controllers.map((c,i)=>{
    const start=()=>{
      if(!enabled)return;
      const j=findXR(c);if(!j)return;
      choose(j);onPoseStart?.();
      active.set(i,{j,start:aiming(c).q,values:[...j.values],frame:j.bone.getWorldQuaternion(Q())});
      onStatus?.(j.name+': hold TRIGGER and twist wrist; release to hold pose. Side GRIPS move the entire character.');
    };
    const end=()=>active.delete(i);
    c.addEventListener('selectstart',start);c.addEventListener('selectend',end);
    return {c,start,end};
  });
  function updateXR(){
    if(!enabled || !renderer.xr.isPresenting)return;
    for(const [i,s] of active){
      const cur=aiming(controllers[i]).q;
      const delta=cur.multiply(s.start.clone().invert());
      const local=s.frame.clone().invert().multiply(delta).multiply(s.frame);
      if(s.j.hinge){
        const a=s.j.axis;
        const twist=local.x*a.x+local.y*a.y+local.z*a.z;
        let angle=2*Math.atan2(twist,local.w)/D;
        angle=((angle+180)%360+360)%360-180;
        modify(s.j,[s.values[0]+angle,0,0]);
      }else{
        const angles=new THREE.Euler().setFromQuaternion(local,'XYZ');
        modify(s.j,[s.values[0]+angles.x/D,s.values[1]+angles.y/D,s.values[2]+angles.z/D]);
      }
    }
  }
  function pixel(j){
    const v=point(j.bone).project(camera);
    return v.z<-1||v.z>1?null:[(v.x+1)*innerWidth/2,(1-v.y)*innerHeight/2];
  }
  function nearest(x,y){
    let hit=null,best=26;
    for(const j of joints){
      const p=pixel(j);if(!p)continue;
      const d=Math.hypot(p[0]-x,p[1]-y);
      if(d<best){best=d;hit=j;}
    }
    return hit;
  }
  const pointerDown=e=>{
    if(!enabled || renderer.xr.isPresenting || e.button!==0)return;
    const j=nearest(e.clientX,e.clientY);if(!j)return;
    e.preventDefault();e.stopPropagation();choose(j);onPoseStart?.();
    mouse={j,x:e.clientX,y:e.clientY,initial:[...j.values]};dragEnabled(true);
  };
  const pointerMove=e=>{
    if(!mouse || renderer.xr.isPresenting)return;
    const {j,x,y,initial}=mouse;
    const dx=e.clientX-x,dy=e.clientY-y;
    modify(j,j.hinge?[initial[0]-dy*.55,0,0]:[initial[0]-dy*.32,initial[1]+dx*.32,initial[2]]);
    e.preventDefault();
  };
  const pointerUp=()=>{if(mouse){mouse=null;dragEnabled(false);}};
  renderer.domElement.addEventListener('pointerdown',pointerDown,true);
  renderer.domElement.addEventListener('pointermove',pointerMove);
  window.addEventListener('pointerup',pointerUp);
  display();
  return {
    boneCount:bones.size,skinnedMeshCount:skinned.length,jointCount:joints.length,jointNames:joints.map(j=>j.name),
    setDesktopDragging(fn){dragEnabled=fn;},
    setEnabled(v){enabled=!!v;if(!enabled){active.clear();pointerUp();}},
    setShowMarkers(v){handlesVisible=!!v;},
    selectName(name){choose(names.get(name));},
    changeSelected(axis,v){const next=[...chosen.values];next[axis]=v;modify(chosen,next);},
    resetPose(){
      active.clear();pointerUp();
      for(const j of joints){j.values=[0,0,0];j.changed=false;}
      display();onStatus?.('Joint offsets reset; original FBX animation is retained.');
    },
    update(){
      updateXR();apply();
      for(const j of joints){
        j.handle.visible=enabled && handlesVisible;
        if(!j.handle.visible)continue;
        j.handle.position.copy(point(j.bone));
        j.handle.material.opacity=j===chosen?1:.66;
        j.handle.scale.setScalar(j===chosen?1.35:.85);
      }
    },
    dispose(){
      active.clear();pointerUp();
      for(const {c,start,end} of controllerEvents){
        c.removeEventListener('selectstart',start);c.removeEventListener('selectend',end);
      }
      renderer.domElement.removeEventListener('pointerdown',pointerDown,true);
      renderer.domElement.removeEventListener('pointermove',pointerMove);
      window.removeEventListener('pointerup',pointerUp);
      for(const j of joints){scene.remove(j.handle);j.handle.material.dispose();}
      sphere.dispose();
    }
  };
}
