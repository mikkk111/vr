import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';
import {createTissue} from './tissue.js?v=1.1-stability';
const $=id=>document.getElementById(id),status=s=>{$('status').textContent=s;console.log(s)};
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),Q=()=>new THREE.Quaternion(),R=THREE.MathUtils.degToRad,UP=V(0,1,0);
const qOf=b=>{const r=b.rotation();return Q().set(r.x,r.y,r.z,r.w);},pOf=b=>{const p=b.translation();return V(p.x,p.y,p.z);};
const renderer=new THREE.WebGPURenderer({alpha:true,antialias:false,depth:true,stencil:false,multiview:false,outputBufferType:THREE.UnsignedByteType,powerPreference:'high-performance'});
renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.xr.setFramebufferScaleFactor(.65);
await renderer.init();if(!renderer.backend?.isWebGPUBackend)throw Error('Native WebGPU required');
renderer.setClearColor(0,0);renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,.85));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
$('scene').appendChild(renderer.domElement);
const scene=new THREE.Scene(),rig=new THREE.Group(),anchor=new THREE.Group();scene.add(rig,anchor);anchor.position.set(0,1.22,-2);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.01,100);rig.add(camera);camera.position.set(0,1.6,2.4);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,1,-2);orbit.enableDamping=true;orbit.mouseButtons.LEFT=null;orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;orbit.update();
scene.add(new THREE.HemisphereLight(0xffffff,0x847e75,1.5));const light=new THREE.DirectionalLight(0xffefd9,2);light.position.set(-2,4,3);scene.add(light);
const fill=new THREE.DirectionalLight(0xdce7ff,.7);fill.position.set(2,1,1);scene.add(fill);
await RAPIER.init();const grip=await createGrabPhysics({renderer,rig,modelAnchor:anchor,onStatus:status});
const loader=new GLTFLoader(),controllers=[0,1].map(i=>renderer.xr.getController(i));
let sim=null,paused=true,gravity=true,mode='grab',acc=0,ar=false,loadVersion=0;
const held=new Map(),reactors=new Map();
const floorWorld=new THREE.Plane(UP,0),floorLocal=new THREE.Plane(),inverse=new THREE.Matrix4(),gLocal=V(),anchorQ=Q(),scale=V();
const restNames=['Hips','Spine','Spine1','Chest','Neck','Head','LeftShoulder','LeftUpperArm','LeftLowerArm','LeftHand','RightShoulder','RightUpperArm','RightLowerArm','RightHand','LeftUpperLeg','LeftLowerLeg','LeftFoot','LeftToes','RightUpperLeg','RightLowerLeg','RightFoot','RightToes'];
const mass=[10,6,6,12,1,5,.45,2,1.3,.5,.45,2,1.3,.5,7,3.5,.9,.15,7,3.5,.9,.15];
const radius=[.092,.064,.064,.075,.036,.085,.025,.038,.027,.026,.025,.038,.027,.026,.055,.042,.032,.022,.055,.042,.032,.022];
const limits=name=>{
  if(name.includes('Shoulder'))return [[-18,22],[-20,20],[-18,18]];
  if(name.includes('UpperArm'))return [[-125,45],[-65,65],name.startsWith('Left')?[-120,22]:[-22,120]];
  if(name.includes('Hand'))return [[-65,65],[-45,45],[-25,25]];
  if(name.includes('UpperLeg'))return [[-115,25],[-35,35],name.startsWith('Left')?[-45,22]:[-22,45]];
  if(name.includes('Foot'))return [[-35,45],[-18,18],[-20,20]];
  if(name.includes('Toes'))return [[-35,45],[-8,8],[-8,8]];
  if(name==='Neck'||name==='Head')return [[-30,35],[-45,45],[-22,22]];
  return [[-20,20],[-18,18],[-15,15]];
};
function decode(buffer){
  const dv=new DataView(buffer);if(dv.getUint32(0,true)!==0x46546c67)throw Error('Not a GLB');
  const len=dv.getUint32(12,true),j=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,len))),info=j.extras?.humanTissueV1;
  if(!info||info.version!==1)throw Error('Use the prepared character-softbody-v1.glb with the embedded tissue cage.');
  const base=28+len,binLen=dv.getUint32(20+len,true),arrays={};
  for(const [key,d] of Object.entries(info.arrays)){const C=d.type==='<f4'?Float32Array:d.type==='<u4'?Uint32Array:d.type==='<u2'?Uint16Array:null;if(!C||d.byteOffset<0||d.byteOffset+d.count*C.BYTES_PER_ELEMENT>binLen)throw Error('Invalid tissue array '+key);arrays[key]=new C(buffer,base+d.byteOffset,d.count);}
  if(!arrays.exclusionOffsets||!arrays.sampleNormals)throw Error('Prepared GLB is older than the topology-aware contact build');
  return {arrays,info,json:j};
}
// Collision groups fit within Rapier's 16-bit membership/filter masks.
// Adjacent segments, shared torso sections and rest-pose overlaps do not
// generate competing rigid contact impulses. Skin contact stays separate.
const groups=[1,1,1,1,1,2,1,3,4,5,1,6,7,8,9,10,11,11,12,13,14,14];
function segmentDistance(a,b,c,d){
  const u=b.clone().sub(a),v=d.clone().sub(c),w=a.clone().sub(c),A=u.dot(u),B=u.dot(v),C=v.dot(v),D=u.dot(w),E=v.dot(w);
  let s=0,t=0,den=A*C-B*B;
  if(A>1e-10&&C>1e-10){s=den>1e-10?THREE.MathUtils.clamp((B*E-C*D)/den,0,1):0;t=(B*s+E)/C;if(t<0){t=0;s=THREE.MathUtils.clamp(-D/A,0,1);}else if(t>1){t=1;s=THREE.MathUtils.clamp((B-D)/A,0,1);}}
  else if(A>1e-10)s=THREE.MathUtils.clamp(-D/A,0,1);else if(C>1e-10)t=THREE.MathUtils.clamp(E/C,0,1);
  return w.addScaledVector(u,s).addScaledVector(v,-t).length();
}
function buildProxy(bones,parents,i){
  const name=restNames[i],b=bones[i];
  let next=parents.findIndex((parent,k)=>parent===i&&!(restNames[k].includes('Shoulder')||restNames[k].includes('UpperLeg')||restNames[k]==='Neck'));
  if(name==='Chest')next=4;
  const dir=next>=0?bones[next].clone().sub(b):name==='Head'?V(0,.12,0):name.includes('Hand')?V(0,-.10,0):name.includes('Toes')?V(0,0,.06):V(0,-.04,0);
  const len=dir.length();
  if(['Hips','Spine','Spine1','Chest'].includes(name)){
    const half=V(name==='Chest'?.105:.075,.055,.045),center=V(0,.055,0);
    return {desc:RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(center.x,center.y,center.z),a:b.clone().add(V(0,.005,0)),b:b.clone().add(V(0,.105,0)),r:Math.hypot(half.x,half.z)};
  }
  if(name==='Head'){const center=b.clone().add(V(0,.075,0));return {desc:RAPIER.ColliderDesc.ball(.079).setTranslation(0,.075,0),a:center,b:center,r:.079};}
  const rad=radius[i]*.87,half=Math.max(.003,len*.5-rad-.008),axis=dir.clone().normalize(),center=dir.clone().multiplyScalar(.5),q=Q().setFromUnitVectors(UP,axis);
  return {desc:RAPIER.ColliderDesc.capsule(half,rad).setTranslation(center.x,center.y,center.z).setRotation(q),a:b.clone().add(center).addScaledVector(axis,-half),b:b.clone().add(center).addScaledVector(axis,half),r:rad};
}
function makeWorld(bones,parents){
  const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/120;world.numSolverIterations=16;
  // Reduce floor correction impulses and use a single authority for impacts.
  if('maxCcdSubsteps' in world)world.maxCcdSubsteps=2;
  const floorBody=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const allMask=(1<<15)-1,filter=Array(15).fill(allMask);
  for(let i=1;i<15;i++)filter[i]&=~(1<<i);
  function exclude(i,j){filter[groups[i]]&=~(1<<groups[j]);filter[groups[j]]&=~(1<<groups[i]);}
  const proxy=bones.map((_,i)=>buildProxy(bones,parents,i));
  for(let i=0;i<bones.length;i++)for(let j=i+1;j<bones.length;j++){
    const adjacent=parents[i]===j||parents[j]===i||(parents[i]>=0&&parents[i]===parents[j])||(parents[i]>=0&&parents[parents[i]]===j)||(parents[j]>=0&&parents[parents[j]]===i);
    const a=proxy[i],b=proxy[j],initialOverlap=segmentDistance(a.a,a.b,b.a,b.b)<a.r+b.r+.006;
    if(adjacent||initialOverlap)exclude(i,j);
  }
  const mask=i=>((1<<i)<<16)|filter[i];
  world.createCollider(RAPIER.ColliderDesc.cuboid(40,.05,40).setCollisionGroups(mask(0)).setFriction(.85).setRestitution(0),floorBody);
  const bodies=[],jointData=[];
  for(let i=0;i<bones.length;i++){
    const b=bones[i],name=restNames[i],rb=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(b.x,b.y,b.z).setLinearDamping(1.0).setAngularDamping(2.8).setCcdEnabled(true).setCanSleep(true));
    world.createCollider(proxy[i].desc.setMass(mass[i]).setCollisionGroups(mask(groups[i])).setFriction(.65).setRestitution(0),rb);bodies.push(rb);
    if(i===0)continue;
    const par=parents[i],a=b.clone().sub(bones[par]),zero=V(),hinge=name.includes('LowerArm')||name.includes('LowerLeg');
    // Model is Y-up, front +Z; use axis normal to the actual limb and sagittal plane.
    const child=parents.findIndex(k=>k===i),limb=child>=0?bones[child].clone().sub(b):V(0,-1,0);
    const axis=V(0,0,1).cross(limb).normalize();
    if(axis.lengthSq()<.5)axis.set(1,0,0);if(axis.x<0)axis.negate();
    const fixed=name.includes('Toes')||name.includes('Shoulder');
    const jd=fixed?RAPIER.JointData.fixed(a,Q(),zero,Q()):hinge?RAPIER.JointData.revolute(a,zero,axis):RAPIER.JointData.spherical(a,zero);
    const joint=world.createImpulseJoint(jd,bodies[par],rb,true);joint.setContactsEnabled(false);
    if(hinge){const lim=name.includes('LowerArm')?[-145,3]:[-3,140];joint.setLimits(R(lim[0]),R(lim[1]));}
    jointData.push({i,par,hinge,fixed,lim:limits(name),restAnchor:a});
  }
  return {world,bodies,jointData,floorBody,floorCenter:null,floorNormal:null,filter};
}
function enforceLimits(m,h){
  // A bounded velocity servo acts BEFORE the impulse solve. Never teleport
  // rotations or positions after Rapier has satisfied its joint anchors.
  // Soft ball-joint stops oppose outward motion and gradually restore limits.
  for(const j of m.jointData){if(j.hinge||j.fixed)continue;
    const a=m.bodies[j.par],b=m.bodies[j.i],qa=qOf(a),qb=qOf(b),rel=qa.clone().invert().multiply(qb).normalize();
    if(rel.w<0)rel.set(-rel.x,-rel.y,-rel.z,-rel.w);
    const axis=V(rel.x,rel.y,rel.z),sin=axis.length();
    const rv=sin<1e-8?V():axis.multiplyScalar(2*Math.atan2(sin,Math.max(0,rel.w))/sin);
    const clamped=rv.clone();
    for(const [k,i] of [['x',0],['y',1],['z',2]])clamped[k]=THREE.MathUtils.clamp(rv[k],R(j.lim[i][0]),R(j.lim[i][1]));
    clamped.clampLength(0,R(restNames[j.i].includes('UpperArm')?140:restNames[j.i].includes('UpperLeg')?120:80));
    const excess=rv.clone().sub(clamped),av=a.angvel(),bv=b.angvel(),local=V(bv.x-av.x,bv.y-av.y,bv.z-av.z).applyQuaternion(qa.clone().invert());
    // Restrict only the components at/beyond the stop; allow motion back in range.
    const correction=V();
    for(const [k,i] of [['x',0],['y',1],['z',2]]){
      const lo=R(j.lim[i][0])+R(4),hi=R(j.lim[i][1])-R(4);
      if(Math.abs(excess[k])>1e-5){const desired=THREE.MathUtils.clamp(-excess[k]*9,-2.5,2.5);correction[k]=(desired-local[k])*.22;}
      else if((rv[k]>hi&&local[k]>0)||(rv[k]<lo&&local[k]<0))correction[k]=-local[k]*.20;
    }
    correction.clampLength(0,.7).applyQuaternion(qa);
    if(correction.lengthSq()<1e-12)continue;
    // Split angular-velocity correction across the two linked bodies according
    // to a conservative mass/length inertia estimate, not two opposing poses.
    const ia=mass[j.par]*Math.max(.055,radius[j.par])**2,ib=mass[j.i]*Math.max(.045,radius[j.i])**2;
    const share=ia/(ia+ib);
    b.setAngvel(V(bv.x,bv.y,bv.z).addScaledVector(correction,share),false);
    a.setAngvel(V(av.x,av.y,av.z).addScaledVector(correction,-(1-share)),false);
  }
}
function capRigidVelocities(m){
  for(const b of m.bodies){const v=b.linvel(),w=b.angvel(),lv=V(v.x,v.y,v.z),av=V(w.x,w.y,w.z);if(!Number.isFinite(lv.lengthSq()+av.lengthSq()))throw Error('Non-finite rigid-body velocity; reset required');
    if(lv.length()>5)b.setLinvel(lv.clampLength(0,5),false);if(av.length()>8)b.setAngvel(av.clampLength(0,8),false);
  }
}
function updateTargets(m){
  const matrices=m.bodies.map((b,i)=>({q:qOf(b),p:pOf(b),rest:m.bones[i]})),a=m.arrays,t=m.tissue.target,tmp=V(),out=V();
  for(let i=0;i<a.points.length/3;i++){const k=i*3;out.set(0,0,0);for(let j=0;j<4;j++){const w=a.weights[i*4+j];if(w===0)continue;const z=matrices[a.joints[i*4+j]];tmp.set(a.points[k],a.points[k+1],a.points[k+2]).sub(z.rest).applyQuaternion(z.q).add(z.p);out.addScaledVector(tmp,w);}t[k]=out.x;t[k+1]=out.y;t[k+2]=out.z;}
}
function updateFloor(m){
  anchor.updateWorldMatrix(true,false);inverse.copy(anchor.matrixWorld).invert();floorLocal.copy(floorWorld).applyMatrix4(inverse);anchor.getWorldQuaternion(anchorQ).invert();anchor.getWorldScale(scale);
  const normal=floorLocal.normal,center=normal.clone().multiplyScalar(-floorLocal.constant-.05);
  if(!m.floorCenter||m.floorCenter.distanceToSquared(center)>1e-10||m.floorNormal.distanceToSquared(normal)>1e-10){m.floorBody.setTranslation(center,true);m.floorBody.setRotation(Q().setFromUnitVectors(UP,normal),true);m.floorCenter=center.clone();m.floorNormal=normal.clone();m.bodies.forEach(b=>b.wakeUp());}
  gLocal.set(0,gravity?-9.81:0,0).applyQuaternion(anchorQ).divideScalar(Math.max(.001,scale.x));m.world.gravity={x:gLocal.x,y:gLocal.y,z:gLocal.z};
}
function draw(m){
  const attr=m.visible.geometry.attributes.position;m.tissue.embed(attr.array);attr.needsUpdate=true;m.visible.geometry.computeVertexNormals();
}
function releaseAll(){held.clear();reactors.clear();}
async function install(buffer){
  const v=++loadVersion,decoded=decode(buffer),gl=await loader.parseAsync(buffer,'');if(v!==loadVersion)return;
  gl.scene.updateMatrixWorld(true);let mesh;gl.scene.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});if(!mesh)throw Error('Missing skinned character');
  const skeleton=mesh.skeleton,bones=skeleton.bones.map(b=>b.getWorldPosition(V())),names=skeleton.bones.map(b=>b.name);
  if(names.join('|')!==restNames.join('|'))throw Error('Unexpected skeleton: this build expects the original 22-bone rig');
  const parents=skeleton.bones.map(b=>skeleton.bones.indexOf(b.parent)),a=decoded.arrays,geo=mesh.geometry.clone(),rest=new Float32Array(geo.attributes.position.array),skinIndex=geo.attributes.skinIndex,skinWeight=geo.attributes.skinWeight,dominant=new Uint16Array(skinIndex.count);
  for(let i=0;i<dominant.length;i++){let k=0;for(let j=1;j<4;j++)if(skinWeight.array[4*i+j]>skinWeight.array[4*i+k])k=j;dominant[i]=skinIndex.array[4*i+k];}
  if(a.cellCorners.length!==rest.length/3*8||a.blend.length!==a.cellCorners.length)throw Error('Tissue embedding does not match mesh');
  geo.deleteAttribute('skinIndex');geo.deleteAttribute('skinWeight');geo.attributes.position.setUsage(THREE.DynamicDrawUsage);geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const visible=new THREE.Mesh(geo,mesh.material);visible.frustumCulled=false;
  const m={...makeWorld(bones,parents),arrays:a,bones,parents,dominant,visible,tissue:createTissue(a,rest),info:decoded.info};
  releaseAll();if(sim){anchor.remove(sim.visible);sim.visible.geometry.dispose();sim.world.free();}sim=m;anchor.add(visible);
  anchor.position.set(0,1.22,-2);anchor.rotation.set(0,0,0);anchor.scale.setScalar(1);grip.attachModel(V(.8,2,.37));
  updateTargets(m);m.tissue.reset();updateFloor(m);draw(m);paused=true;acc=0;$('run').textContent='Start / drop';$('run').disabled=false;$('reset').disabled=false;
  status('Prepared model loaded — 22 bones, '+m.info.nodes+' tissue nodes, '+m.info.tetCount+' tetrahedra. Start or grab to release.');
}
function ray(c){c.updateWorldMatrix(true,false);return new THREE.Ray(c.getWorldPosition(V()),V(0,0,-1).applyQuaternion(c.getWorldQuaternion(Q())));}
function pick(r){
  if(!sim)return null;const pts=sim.tissue.samplePositions(),o=anchor.worldToLocal(r.origin.clone()),dir=r.direction.clone().applyQuaternion(anchor.getWorldQuaternion(Q()).invert()).normalize(),tol=.037;
  let best=null;
  for(let i=0;i<pts.length;i+=3){let x=pts[i]-o.x,y=pts[i+1]-o.y,z=pts[i+2]-o.z,d=x*dir.x+y*dir.y+z*dir.z;if(d<=0)continue;let gap=x*x+y*y+z*z-d*d;if(gap>tol*tol)continue;if(!best||d<best.d)best={d,point:V(pts[i],pts[i+1],pts[i+2]),vertex:sim.arrays.samples[i/3]};}
  return best;
}
function start(owner,r){
  if(!sim||held.has(owner))return;const hit=pick(r);if(!hit)return;const worldPoint=anchor.localToWorld(hit.point.clone()),bone=sim.dominant[hit.vertex],body=sim.bodies[bone],depth=Math.max(.05,worldPoint.clone().sub(r.origin).dot(r.direction)),localOffset=hit.point.clone().sub(pOf(body)).applyQuaternion(qOf(body).invert());
  const currentMode=mode,worldTarget=currentMode==='press'?r.at(Math.max(.02,depth-.055),V()):worldPoint.clone();
  held.set(owner,{mode:currentMode,bone,depth:currentMode==='press'?Math.max(.02,depth-.055):depth,offset:localOffset,worldTarget,ray:r.clone()});
  paused=false;$('run').textContent='Pause';
}
function move(owner,r,dt){let h=held.get(owner);if(!h)return;h.ray.copy(r);const goal=r.at(h.depth,V()),delta=goal.sub(h.worldTarget);delta.clampLength(0,2*Math.max(0,dt));h.worldTarget.add(delta);}
function step(m){
  updateFloor(m);const h=m.tissue.h,presses=[];
  for(const [id,hand] of held){const target=anchor.worldToLocal(hand.worldTarget.clone());
    if(hand.mode==='press'){presses.push({x:target.x,y:target.y,z:target.z,r:.065/Math.max(.5,scale.x)});continue;}
    const b=m.bodies[hand.bone],point=hand.offset.clone().applyQuaternion(qOf(b)).add(pOf(b)),err=target.sub(point),lv=b.linvel(),av=b.angvel(),velocity=V(av.x,av.y,av.z).cross(point.clone().sub(pOf(b))).add(V(lv.x,lv.y,lv.z));
    const impulse=err.multiplyScalar(70*h).addScaledVector(velocity,-15*h).clampLength(0,Math.min(1.4,mass[hand.bone]*.25));b.applyImpulseAtPoint(impulse,point,true);
  }
  enforceLimits(m,h);capRigidVelocities(m);m.world.step();capRigidVelocities(m);updateTargets(m);
  // The skeleton owns all impact momentum. Tissue contacts only deform the
  // surface, with no ad-hoc per-sample reaction impulses injected into Rapier.
  m.tissue.step([gLocal.x,gLocal.y,gLocal.z],{x:floorLocal.normal.x,y:floorLocal.normal.y,z:floorLocal.normal.z,c:floorLocal.constant},presses);

}
function reset(){if(!sim)return;releaseAll();grip.reset();sim.bodies.forEach((b,i)=>{b.setTranslation(sim.bones[i],true);b.setRotation(Q(),true);b.setLinvel(V(),true);b.setAngvel(V(),true);b.resetForces(true);b.resetTorques(true);});updateTargets(sim);sim.tissue.reset();draw(sim);paused=true;acc=0;$('run').textContent='Start / drop';status('Reset to original rest pose');}
controllers.forEach((c,i)=>{c.addEventListener('selectstart',()=>start(i,ray(c)));for(const e of ['selectend','disconnected'])c.addEventListener(e,()=>held.delete(i));});
$('file').onchange=async e=>{try{const f=e.target.files?.[0];if(f)await install(await f.arrayBuffer());}catch(e){status('Model load failed: '+e.message);}};
$('run').onclick=()=>{if(!sim)return;paused=!paused;if(paused)releaseAll();$('run').textContent=paused?'Resume / drop':'Pause';};
$('reset').onclick=reset;$('gravity').onchange=e=>{gravity=e.target.checked;sim?.bodies.forEach(b=>b.wakeUp());};
$('mode').onchange=e=>{mode=e.target.value;status(mode==='press'?'Pressure mode — trigger places a virtual spherical contact tool':'Grab mode — trigger applies a spring force to the selected limb');};
const mouseRay=new THREE.Raycaster(),pointer=new THREE.Vector2();
function desktopRay(e){const b=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);mouseRay.setFromCamera(pointer,camera);return mouseRay.ray;}
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button!==0||renderer.xr.isPresenting)return;start('mouse',desktopRay(e));if(held.has('mouse'))renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(held.has('mouse'))held.get('mouse').ray.copy(desktopRay(e));});
for(const e of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(e,()=>held.delete('mouse'));
renderer.domElement.addEventListener('wheel',e=>{const h=held.get('mouse');if(h){h.depth=Math.max(.03,h.depth+e.deltaY*.001);e.preventDefault();}},{passive:false});
let snap=true,buttons=new Map();
function xrUpdate(dt,frame){
  const session=renderer.xr.getSession(),space=renderer.xr.getReferenceSpace(),pose=frame&&space?frame.getViewerPose(space):null;if(!session||!pose)return;
  let l=[0,0],r=[0,0];
  for(const input of session.inputSources){const gamepad=input.gamepad;if(!gamepad)continue;const a=gamepad.axes||[],stick=a.length>=4&&Math.hypot(a[2],a[3])>.12?[a[2],a[3]]:[a[0]||0,a[1]||0];if(input.handedness==='left')l=stick;if(input.handedness==='right')r=stick;
    const press=!!gamepad.buttons?.[4]?.pressed,key=input.handedness;if(press&&!buttons.get(key)){mode=mode==='grab'?'press':'grab';$('mode').value=mode;status('Trigger mode: '+mode);}buttons.set(key,press);}
  const eye=V(pose.transform.position.x,pose.transform.position.y,pose.transform.position.z),viewer=rig.localToWorld(eye.clone());
  if(!grip.isHolding('right')){if(Math.abs(r[0])<.3)snap=true;if(snap&&Math.abs(r[0])>.7){rig.rotation.y-=Math.sign(r[0])*Math.PI/6;rig.updateMatrixWorld(true);rig.position.add(viewer.clone().sub(rig.localToWorld(eye.clone())));snap=false;}}else snap=true;
  const depth=Math.abs(r[1])>=Math.abs(l[1])?r[1]:l[1];if(Math.abs(depth)>.16)grip.adjustModelDepth(depth,dt,viewer);
  if(Math.abs(l[0])>.16){const h=pose.transform.orientation,q=Q().set(h.x,h.y,h.z,h.w).premultiply(rig.getWorldQuaternion(Q())),right=V(1,0,0).applyQuaternion(q);right.y=0;if(right.lengthSq()>1e-6)grip.adjustModelSide(l[0],dt,right.normalize());}
}
$('enter').onclick=async()=>{let session;try{session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local-floor','webgpu']});await renderer.xr.setSession(session);if(!renderer.xr.getWebGPUBinding?.())throw Error('Native XR GPU binding unavailable');orbit.enabled=false;camera.position.set(0,0,0);grip.releaseAll();}catch(e){if(session)await session.end().catch(()=>{});status('XR start failed: '+e.message);}};
renderer.xr.addEventListener('sessionend',()=>{releaseAll();buttons.clear();orbit.enabled=true;camera.position.set(0,1.6,2.4);orbit.update();});
window.addEventListener('resize',()=>{if(!renderer.xr.isPresenting){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}});
window.addEventListener('error',e=>status('Error: '+e.message));window.addEventListener('unhandledrejection',e=>status('Error: '+e.reason?.message));
renderer.backend.device?.lost.then(info=>status('GPU lost: '+info.message));
if(navigator.xr&&typeof globalThis.XRGPUBinding!=='undefined')ar=await navigator.xr.isSessionSupported('immersive-ar');$('enter').disabled=!ar;$('enter').textContent=ar?'ENTER PASSTHROUGH':'Native XR unavailable — desktop preview';
try{const r=await fetch('../human-softbody-v1-0/assets/character-softbody-v1.glb');if(!r.ok)throw Error('not hosted');await install(await r.arrayBuffer());}catch(e){status('Automatic model load unavailable: '+e.message+'. Choose the prepared character-softbody-v1.glb from your device.');}
let last=0,startTime=0,frames=0;
await renderer.setAnimationLoop((time,frame)=>{try{let dt=last?Math.min(.035,(time-last)/1000):0;last=time;if(!startTime)startTime=time;frames++;
  if(renderer.xr.isPresenting){grip.pollGrips();xrUpdate(dt,frame);for(let i=0;i<2;i++)if(held.has(i))move(i,ray(controllers[i]),dt);}else{orbit.update();if(held.has('mouse'))move('mouse',held.get('mouse').ray,dt);}
  grip.update(dt);if(sim&&!paused){acc=Math.min(acc+dt,sim.tissue.h*3);let count=0;while(acc>=sim.tissue.h&&count<3){step(sim);acc-=sim.tissue.h;count++;}if(count)draw(sim);}else acc=0;
  if(time-startTime>1000){const s=sim?.tissue.measure();$('stats').textContent=(frames*1000/(time-startTime)).toFixed(1)+' callback fps'+(s?' | cage volume '+(s.volumeRatio*100).toFixed(1)+'% | inverted '+s.inverted+' | sampled contacts '+s.contacts+' | max sampled overlap '+(s.penetration*1000).toFixed(1)+' mm':'');frames=0;startTime=time;}
  renderer.render(scene,camera);
}catch(e){paused=true;releaseAll();$('run').textContent='Resume / drop';status('Simulation paused: '+e.message);console.error(e);}});
