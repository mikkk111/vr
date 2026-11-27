import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';
import {createTissue} from './tissue.js?v=1.0-contact2';
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
function makeWorld(bones,parents){
  const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/120;world.numSolverIterations=12;
  const floorBody=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(40,.05,40).setFriction(.95).setRestitution(0),floorBody);
  const bodies=[],jointData=[];
  for(let i=0;i<bones.length;i++){
    const b=bones[i],name=restNames[i],rb=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(b.x,b.y,b.z).setLinearDamping(.65).setAngularDamping(1.4).setCcdEnabled(true).setCanSleep(false));
    let next=parents.findIndex((parent,k)=>parent===i&&!(restNames[k].includes('Shoulder')||restNames[k].includes('UpperLeg')||restNames[k]==='Neck'));
    if(name==='Chest')next=4;
    let dir=next>=0?bones[next].clone().sub(b):name==='Head'?V(0,.12,0):name.includes('Hand')?V(0,-.10,0):name.includes('Toes')?V(0,0,.06):V(0,-.04,0);
    const len=dir.length(),rad=radius[i];let collider;
    if(['Hips','Spine','Spine1','Chest'].includes(name)){collider=RAPIER.ColliderDesc.cuboid(name==='Chest'?.12:.087,.06,.055).setTranslation(0,.055,0);}
    else if(name==='Head')collider=RAPIER.ColliderDesc.ball(rad).setTranslation(0,.075,0);
    else{const q=Q().setFromUnitVectors(UP,dir.clone().normalize());collider=RAPIER.ColliderDesc.capsule(Math.max(.005,len/2-rad),rad).setTranslation(dir.x/2,dir.y/2,dir.z/2).setRotation(q);}
    world.createCollider(collider.setMass(mass[i]).setFriction(.8).setRestitution(0),rb);bodies.push(rb);
    if(i===0)continue;
    const par=parents[i],a=b.clone().sub(bones[par]),zero=V(),hinge=name.includes('LowerArm')||name.includes('LowerLeg');
    let jd=hinge?RAPIER.JointData.revolute(a,zero,V(1,0,0)):RAPIER.JointData.spherical(a,zero);
    const joint=world.createImpulseJoint(jd,bodies[par],rb,true);joint.setContactsEnabled(false);
    if(hinge){const lim=name.includes('LowerArm')?[-145,3]:[-3,140];joint.setLimits(R(lim[0]),R(lim[1]));}
    jointData.push({i,par,hinge,lim:limits(name),restAnchor:a});
  }
  return {world,bodies,jointData,floorBody};
}
function enforceLimits(m){
  // Native impulse-joint hinge limits; parent-frame quaternion rotation-vector
  // projection for ball joints. No Euler gimbal singularity or 180-degree flip.
  for(const j of m.jointData){if(j.hinge)continue;
    const a=m.bodies[j.par],b=m.bodies[j.i],qa=qOf(a),qb=qOf(b),rel=qa.clone().invert().multiply(qb).normalize();
    if(rel.w<0)rel.set(-rel.x,-rel.y,-rel.z,-rel.w);
    const axis=V(rel.x,rel.y,rel.z),sin=axis.length();if(sin<1e-7)continue;
    const angle=2*Math.atan2(sin,Math.max(0,rel.w)),rv=axis.multiplyScalar(angle/sin),before=rv.clone();
    for(const [k,i] of [['x',0],['y',1],['z',2]])rv[k]=THREE.MathUtils.clamp(rv[k],R(j.lim[i][0]),R(j.lim[i][1]));
    const cap=restNames[j.i].includes('UpperArm')?145:restNames[j.i].includes('UpperLeg')?125:95;
    rv.clampLength(0,R(cap));
    if(rv.distanceToSquared(before)<1e-8)continue;
    const len=rv.length(),desired=qa.clone().multiply(len<1e-7?Q():Q().setFromAxisAngle(rv.clone().divideScalar(len),len)).normalize();
    b.setRotation(desired,true);
    const av=a.angvel(),bv=b.angvel(),local=V(bv.x-av.x,bv.y-av.y,bv.z-av.z).applyQuaternion(qa.clone().invert());
    for(const k of ['x','y','z'])if((before[k]-rv[k])*local[k]>0)local[k]=0;
    b.setAngvel(local.applyQuaternion(qa).add(V(av.x,av.y,av.z)),true);
  }
}
function updateTargets(m){
  const matrices=m.bodies.map((b,i)=>({q:qOf(b),p:pOf(b),rest:m.bones[i]})),a=m.arrays,t=m.tissue.target,tmp=V(),out=V();
  for(let i=0;i<a.points.length/3;i++){const k=i*3;out.set(0,0,0);for(let j=0;j<4;j++){const w=a.weights[i*4+j];if(w===0)continue;const z=matrices[a.joints[i*4+j]];tmp.set(a.points[k],a.points[k+1],a.points[k+2]).sub(z.rest).applyQuaternion(z.q).add(z.p);out.addScaledVector(tmp,w);}t[k]=out.x;t[k+1]=out.y;t[k+2]=out.z;}
}
function updateFloor(m){
  anchor.updateWorldMatrix(true,false);inverse.copy(anchor.matrixWorld).invert();floorLocal.copy(floorWorld).applyMatrix4(inverse);anchor.getWorldQuaternion(anchorQ).invert();anchor.getWorldScale(scale);
  const normal=floorLocal.normal,center=normal.clone().multiplyScalar(-floorLocal.constant-.05);
  m.floorBody.setTranslation(center,true);m.floorBody.setRotation(Q().setFromUnitVectors(UP,normal),true);
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
    const impulse=err.multiplyScalar(95*h).addScaledVector(velocity,-11*h).clampLength(0,2.2);b.applyImpulseAtPoint(impulse,point,true);
  }
  m.world.step();enforceLimits(m);updateTargets(m);
  // External tissue contact contributes a bounded reaction impulse to the
  // corresponding rigid segment on the next step. Not a monolithic solver.
  reactors.clear();
  const react=(vertex,x,y,z,dx,dy,dz)=>{const bone=m.dominant[vertex];let v=reactors.get(bone);if(!v)reactors.set(bone,v={sum:V(),point:V(),n:0});v.sum.add(V(dx,dy,dz));v.point.add(V(x,y,z));v.n++;};
  m.tissue.step([gLocal.x,gLocal.y,gLocal.z],{x:floorLocal.normal.x,y:floorLocal.normal.y,z:floorLocal.normal.z,c:floorLocal.constant},presses,react);
  for(const [bone,v] of reactors){const b=m.bodies[bone],imp=v.sum.multiplyScalar(.8/Math.sqrt(v.n)).clampLength(0,.32);b.applyImpulseAtPoint(imp,v.point.divideScalar(v.n),true);}
}
function reset(){if(!sim)return;releaseAll();grip.reset();sim.bodies.forEach((b,i)=>{b.setTranslation(sim.bones[i],true);b.setRotation(Q(),true);b.setLinvel(V(),true);b.setAngvel(V(),true);});updateTargets(sim);sim.tissue.reset();draw(sim);paused=true;acc=0;$('run').textContent='Start / drop';status('Reset to original rest pose');}
controllers.forEach((c,i)=>{c.addEventListener('selectstart',()=>start(i,ray(c)));for(const e of ['selectend','disconnected'])c.addEventListener(e,()=>held.delete(i));});
$('file').onchange=async e=>{try{const f=e.target.files?.[0];if(f)await install(await f.arrayBuffer());}catch(e){status('Model load failed: '+e.message);}};
$('run').onclick=()=>{if(!sim)return;paused=!paused;if(paused)releaseAll();$('run').textContent=paused?'Resume / drop':'Pause';};
$('reset').onclick=reset;$('gravity').onchange=e=>gravity=e.target.checked;
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
try{const r=await fetch('./assets/character-softbody-v1.glb');if(!r.ok)throw Error('not hosted');await install(await r.arrayBuffer());}catch(e){status('Automatic model load unavailable: '+e.message+'. Choose the prepared character-softbody-v1.glb from your device.');}
let last=0,startTime=0,frames=0;
await renderer.setAnimationLoop((time,frame)=>{try{let dt=last?Math.min(.035,(time-last)/1000):0;last=time;if(!startTime)startTime=time;frames++;
  if(renderer.xr.isPresenting){grip.pollGrips();xrUpdate(dt,frame);for(let i=0;i<2;i++)if(held.has(i))move(i,ray(controllers[i]),dt);}else{orbit.update();if(held.has('mouse'))move('mouse',held.get('mouse').ray,dt);}
  grip.update(dt);if(sim&&!paused){acc=Math.min(acc+dt,sim.tissue.h*3);let count=0;while(acc>=sim.tissue.h&&count<3){step(sim);acc-=sim.tissue.h;count++;}if(count)draw(sim);}else acc=0;
  if(time-startTime>1000){const s=sim?.tissue.measure();$('stats').textContent=(frames*1000/(time-startTime)).toFixed(1)+' callback fps'+(s?' | cage volume '+(s.volumeRatio*100).toFixed(1)+'% | inverted '+s.inverted+' | sampled contacts '+s.contacts+' | max sampled overlap '+(s.penetration*1000).toFixed(1)+' mm':'');frames=0;startTime=time;}
  renderer.render(scene,camera);
}catch(e){paused=true;releaseAll();status('Simulation paused: '+e.message);console.error(e);}});
