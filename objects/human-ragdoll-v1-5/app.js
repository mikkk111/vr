import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import initJolt from 'https://cdn.jsdelivr.net/npm/jolt-physics@1.1.2/dist/jolt-physics.wasm-compat.js';
import {createRagdoll} from './ragdoll.js?v=1.5';
import {createSecondary,defaults} from './secondary.js?v=1.5';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';
const $=id=>document.getElementById(id),status=s=>{$('status').textContent=s;console.log(s)},V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),Q=()=>new THREE.Quaternion(),UP=V(0,1,0);
const renderer=new THREE.WebGPURenderer({alpha:true,antialias:false,depth:true,stencil:false,multiview:false,outputBufferType:THREE.UnsignedByteType,powerPreference:'high-performance'});
renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.xr.setFramebufferScaleFactor(.65);await renderer.init();
if(!renderer.backend?.isWebGPUBackend)throw Error('Native WebGPU required');
renderer.setClearColor(0,0);renderer.setPixelRatio(Math.min(devicePixelRatio,.85));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;$('scene').appendChild(renderer.domElement);
const scene=new THREE.Scene(),rig=new THREE.Group(),anchor=new THREE.Group();scene.add(rig,anchor);anchor.position.set(0,1.22,-2);const handleAnchor=new THREE.Group();handleAnchor.position.copy(anchor.position);scene.add(handleAnchor);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.01,100);rig.add(camera);camera.position.set(0,1.6,2.4);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,1,-2);orbit.enableDamping=true;orbit.mouseButtons.LEFT=null;orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;orbit.update();
scene.add(new THREE.HemisphereLight(0xffffff,0x847e75,1.5));const light=new THREE.DirectionalLight(0xffefd9,2);light.position.set(-2,4,3);scene.add(light);
const fill=new THREE.DirectionalLight(0xdce7ff,.7);fill.position.set(2,1,1);scene.add(fill);
const [J,fit,gl,grip]=await Promise.all([initJolt(),fetch('./fit.json?v=1.5').then(r=>{if(!r.ok)throw Error('Missing fit');return r.json()}),new GLTFLoader().loadAsync('../human-softbody-v1-0/assets/character-softbody-v1.glb'),createGrabPhysics({renderer,rig,modelAnchor:handleAnchor,onStatus:status})]);
let mesh;gl.scene.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});if(!mesh)throw Error('Original SkinnedMesh missing');
gl.scene.updateMatrixWorld(true);
const bones=mesh.skeleton.bones;if(bones.map(b=>b.name).join('|')!==fit.names.join('|'))throw Error('Fit does not match skeleton');
for(let i=0;i<bones.length;i++)if(bones[i].getWorldPosition(V()).distanceTo(V(...fit.rest[i]))>1e-4)throw Error('Bind position mismatch '+bones[i].name);
const bindPos=bones.map(b=>b.position.clone()),bindQ=bones.map(b=>b.quaternion.clone());mesh.frustumCulled=false;anchor.add(gl.scene);
let model=createRagdoll(J,fit);const secondary=createSecondary(THREE,mesh,fit),motion={...defaults};
const keys=['chest','hips','chestFirm','hipFirm','chestDamp','hipDamp','sag','contact','heft','bounce'];
const profiles={subtle:{...defaults,chest:.65,hips:.6,chestFirm:.9,hipFirm:.95,chestDamp:.65,hipDamp:.68,sag:.45,contact:.6},natural:{...defaults},responsive:{...defaults,chest:2,hips:1.8,chestFirm:.40,hipFirm:.45,chestDamp:.22,hipDamp:.25,sag:1.65,contact:2.2},off:{...defaults,chest:0,hips:0,contact:0,sag:0}};
function refreshSettings(){for(const k of keys){$(k).value=motion[k];$(k+'Value').textContent=motion[k].toFixed(2);}model.setBounce(motion.bounce);}
for(const k of keys)$(k).oninput=e=>{motion[k]=Number(e.target.value);$('profile').value='custom';refreshSettings();};
$('profile').onchange=e=>{if(profiles[e.target.value]){Object.assign(motion,profiles[e.target.value]);refreshSettings();}};
const anchorVelocity=V();
function syncWholePose(dt,immediate=false){
  if(immediate){anchor.position.copy(handleAnchor.position);anchor.quaternion.copy(handleAnchor.quaternion);anchor.scale.copy(handleAnchor.scale);anchorVelocity.set(0,0,0);return;}
  if(!(dt>0))return;
  const w=12/Math.sqrt(Math.max(.25,motion.heft)),steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;
  for(let i=0;i<steps;i++){const a=handleAnchor.position.clone().sub(anchor.position).multiplyScalar(w*w).addScaledVector(anchorVelocity,-2*w).clampLength(0,14/Math.max(.25,motion.heft));anchorVelocity.addScaledVector(a,h).clampLength(0,3.2/Math.sqrt(Math.max(.25,motion.heft)));anchor.position.addScaledVector(anchorVelocity,h);}
  if(anchor.position.distanceToSquared(handleAnchor.position)<1e-8&&anchorVelocity.lengthSq()<1e-6){anchor.position.copy(handleAnchor.position);anchorVelocity.set(0,0,0);}
  anchor.quaternion.slerp(handleAnchor.quaternion,1-Math.exp(-dt*w));anchor.scale.copy(handleAnchor.scale);
}
function closeControllers(frame){
  const session=renderer.xr.getSession(),ref=renderer.xr.getReferenceSpace(),out=[];
  if(!session||!ref||!frame)return out;
  for(const source of session.inputSources){if(!source.gripSpace||!source.gamepad||source.handedness==='none')continue;
    if(source.gamepad.buttons[0]?.pressed||source.gamepad.buttons[1]?.pressed)continue;
    const pose=frame.getPose(source.gripSpace,ref);if(!pose)continue;const t=pose.transform;
    const q=Q().set(t.orientation.x,t.orientation.y,t.orientation.z,t.orientation.w),point=V(t.position.x,t.position.y,t.position.z).add(V(0,0,-.045).applyQuaternion(q));
    out.push({key:source.handedness,point:rig.localToWorld(point)});
  }return out;
}
refreshSettings();const debugGroup=new THREE.Group();anchor.add(debugGroup);
const debug=fit.shapes.map((s,i)=>{const geo=new ConvexGeometry(s.vertices.map(a=>V(...a))),m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:i%2?0x46d6bb:0xefd580,wireframe:true,transparent:true,opacity:.75,depthTest:false}));debugGroup.add(m);return m;});debugGroup.visible=false;
grip.attachModel(V(.80,2,.37));
const held=new Map(),states=new Map(),nextPick=new Map();let paused=true,gravityOn=true,acc=0,firstDrop=true,wasWholeHold=false;
const h=1/120,worldFloor=new THREE.Plane(UP,0),localFloor=new THREE.Plane(),inverse=new THREE.Matrix4(),gravity=V(),scale=V(),lastFloor=V(Infinity,0,0),lastNormal=V(),lastGravity=V(Infinity,0,0);
function updateFloor(){
  anchor.updateWorldMatrix(true,false);inverse.copy(anchor.matrixWorld).invert();localFloor.copy(worldFloor).applyMatrix4(inverse);anchor.getWorldScale(scale);
  const n=localFloor.normal,center=n.clone().multiplyScalar(-localFloor.constant-.05);gravity.set(0,gravityOn?-9.81:0,0).applyQuaternion(anchor.getWorldQuaternion(Q()).invert()).divideScalar(Math.max(.1,scale.x));
  if(center.distanceToSquared(lastFloor)>1e-10||n.distanceToSquared(lastNormal)>1e-10||gravity.distanceToSquared(lastGravity)>1e-10){model.setFloor(center,Q().setFromUnitVectors(UP,n),gravity);model.wake();lastFloor.copy(center);lastNormal.copy(n);lastGravity.copy(gravity);}
}
function draw(){
  // Preserve bind translations on all non-root bones. The low-resolution
  // collision skeleton supplies rotations, never stretches the skin's bones.
  for(let i=0;i<bones.length;i++){const par=fit.parents[i],owner=model.owner[i],q=model.rotations[owner];
    if(par<0){bones[i].position.copy(model.positions[owner]);bones[i].quaternion.copy(q).multiply(bindQ[i]);}
    else{bones[i].position.copy(bindPos[i]);bones[i].quaternion.copy(model.rotations[model.owner[par]]).invert().multiply(q).multiply(bindQ[i]);}
  }
  gl.scene.updateMatrixWorld(true);
  if(debugGroup.visible)for(let i=0;i<debug.length;i++){debug[i].position.copy(model.positions[i]);debug[i].quaternion.copy(model.rotations[i]);}
}
function release(key){const heldHand=held.get(key);if(!heldHand)return;heldHand.marker.removeFromParent();heldHand.marker.geometry.dispose();heldHand.marker.material.dispose();held.delete(key);}
function releaseAll(){for(const k of [...held.keys()])release(k);states.clear();nextPick.clear();}
function reset(){releaseAll();grip.reset();syncWholePose(0,true);secondary.reset();model.dispose();model=createRagdoll(J,fit);model.setBounce(motion.bounce);lastFloor.set(Infinity,0,0);updateFloor();draw();paused=true;firstDrop=true;acc=0;$('run').textContent='Drop / start';status('Rest pose reset');}
function start(key,r,quiet=false){
  if(held.has(key))return true;
  anchor.updateWorldMatrix(true,false);
  const local=new THREE.Ray(anchor.worldToLocal(r.origin.clone()),r.direction.clone().applyQuaternion(anchor.getWorldQuaternion(Q()).invert()).normalize());
  const hit=model.pick(local);
  if(!hit){if(!quiet)status('No body part hit — aim at hand, forearm or shin');return false;}
  const p=hit.offset.clone().applyQuaternion(model.rotations[hit.index]).add(model.positions[hit.index]),world=anchor.localToWorld(p);
  const depth=Math.max(.025,world.clone().sub(r.origin).dot(r.direction)),delta=world.clone().sub(r.at(depth,V())),marker=new THREE.Mesh(new THREE.SphereGeometry(.009,8,6),new THREE.MeshBasicMaterial({color:0x8ce8d2,depthTest:false}));
  marker.position.copy(world);marker.renderOrder=10;scene.add(marker);
  held.set(key,{index:hit.index,offset:hit.offset,depth,delta,target:world,ray:r.clone(),marker});model.wake();paused=false;firstDrop=false;$('run').textContent='Pause';status('Holding '+fit.shapes[hit.index].name);return true;
}
function move(key,r,dt){const s=held.get(key);if(!s)return;s.ray.copy(r);const d=r.at(s.depth,V()).add(s.delta).sub(s.target).clampLength(0,2.8*dt);s.target.add(d);s.marker.position.copy(s.target);}
function sourceRay(source,frame){const ref=renderer.xr.getReferenceSpace(),p=ref&&frame?.getPose(source.targetRaySpace,ref);if(!p)return null;const t=p.transform,o=rig.localToWorld(V(t.position.x,t.position.y,t.position.z)),q=Q().set(t.orientation.x,t.orientation.y,t.orientation.z,t.orientation.w).premultiply(rig.getWorldQuaternion(Q()));return new THREE.Ray(o,V(0,0,-1).applyQuaternion(q).normalize());}
function pollTriggers(dt,frame){const session=renderer.xr.getSession();if(!session||!frame)return;
  const seen=new Set();for(const s of session.inputSources){if(!s.gamepad||s.handedness==='none')continue;const k=s.handedness;seen.add(k);const down=!!s.gamepad.buttons[0]?.pressed,prev=states.get(k);states.set(k,down);
    if(!down){release(k);nextPick.delete(k);continue;}const r=sourceRay(s,frame);if(!r)continue;
    if(held.has(k))move(k,r,dt);else if(!prev||performance.now()>=(nextPick.get(k)||0)){nextPick.set(k,performance.now()+180);start(k,r,!!prev);}
  }for(const k of states.keys())if(!seen.has(k)){release(k);states.delete(k);nextPick.delete(k);}
}
const caster=new THREE.Raycaster(),pointer=new THREE.Vector2();function mouseRay(e){const b=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);caster.setFromCamera(pointer,camera);return caster.ray;}
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===0&&!renderer.xr.isPresenting&&start('mouse',mouseRay(e)))renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(held.has('mouse'))held.get('mouse').ray.copy(mouseRay(e));});for(const e of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(e,()=>release('mouse'));
renderer.domElement.addEventListener('wheel',e=>{const s=held.get('mouse');if(s){s.depth=Math.max(.03,s.depth+e.deltaY*.001);e.preventDefault();}},{passive:false});
$('run').onclick=()=>{paused=!paused;if(paused)releaseAll();else{model.wake();if(firstDrop){firstDrop=false;const d=new J.Vec3(.12,0,1.8);model.bi.AddImpulse(model.bodies[1].GetID(),d);J.destroy(d);}}$('run').textContent=paused?'Resume / drop':'Pause';};
$('reset').onclick=reset;$('gravity').onchange=e=>{gravityOn=e.target.checked;model.wake();};$('debug').onchange=e=>{debugGroup.visible=e.target.checked;draw();};
let snap=true;
function xrUpdate(dt,frame){const space=renderer.xr.getReferenceSpace(),pose=frame&&space?frame.getViewerPose(space):null;if(!pose)return;let l=[0,0],r=[0,0];
  for(const s of renderer.xr.getSession().inputSources){if(!s.gamepad)continue;const a=s.gamepad.axes||[],v=a.length>=4&&Math.hypot(a[2],a[3])>.12?[a[2],a[3]]:[a[0]||0,a[1]||0];if(s.handedness==='left')l=v;if(s.handedness==='right')r=v;}
  const eye=V(pose.transform.position.x,pose.transform.position.y,pose.transform.position.z),viewer=rig.localToWorld(eye.clone());
  if(!grip.isHolding('right')){if(Math.abs(r[0])<.3)snap=true;if(snap&&Math.abs(r[0])>.7){rig.rotation.y-=Math.sign(r[0])*Math.PI/6;rig.updateMatrixWorld(true);rig.position.add(viewer.clone().sub(rig.localToWorld(eye.clone())));snap=false;}}else snap=true;
  const depth=Math.abs(r[1])>=Math.abs(l[1])?r[1]:l[1];if(Math.abs(depth)>.16)grip.adjustModelDepth(depth,dt,viewer);
  if(Math.abs(l[0])>.16){const o=pose.transform.orientation,q=Q().set(o.x,o.y,o.z,o.w).premultiply(rig.getWorldQuaternion(Q())),right=V(1,0,0).applyQuaternion(q);right.y=0;if(right.lengthSq()>1e-6)grip.adjustModelSide(l[0],dt,right.normalize());}
}
$('enter').onclick=async()=>{let session;try{session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local-floor','webgpu']});await renderer.xr.setSession(session);if(!renderer.xr.getWebGPUBinding?.())throw Error('Native XR binding unavailable');orbit.enabled=false;camera.position.set(0,0,0);grip.releaseAll();
  session.addEventListener('selectstart',e=>{const k=e.inputSource.handedness,r=sourceRay(e.inputSource,e.frame);if(r&&k!=='none')start(k,r);});session.addEventListener('selectend',e=>release(e.inputSource.handedness));
  status('Passthrough active — trigger grabs limbs; side grips move whole body');
}catch(e){if(session)await session.end().catch(()=>{});status('XR error: '+e.message);}};
renderer.xr.addEventListener('sessionend',()=>{releaseAll();secondary.reset();orbit.enabled=true;camera.position.set(0,1.6,2.4);orbit.update();});
window.addEventListener('resize',()=>{if(!renderer.xr.isPresenting){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}});
renderer.backend.device?.lost.then(e=>status('GPU lost: '+e.message));
renderer.backend.device?.addEventListener('uncapturederror',e=>status('GPU validation: '+e.error.message));
window.addEventListener('error',e=>status('Error: '+e.message));window.addEventListener('unhandledrejection',e=>status('Error: '+e.reason?.message));
const supported=navigator.xr&&typeof globalThis.XRGPUBinding!=='undefined'&&await navigator.xr.isSessionSupported('immersive-ar');
$('enter').disabled=!supported;$('enter').textContent=supported?'ENTER PASSTHROUGH':'Desktop preview — native XR unavailable';$('run').disabled=false;$('reset').disabled=false;
updateFloor();draw();await renderer.compileAsync(scene,camera);status('Ready: 15 rigid skin-fitted hulls, 14 native joints, 60 kg rigid body; local gravity and contact response. Adjust settings before entering VR.');
let last=0,begin=0,frames=0,physicsMs=0;
await renderer.setAnimationLoop((time,frame)=>{try{const realDt=last?Math.max(0,(time-last)/1000):0,dt=Math.min(.05,realDt);last=time;if(!begin)begin=time;frames++;
  if(renderer.xr.isPresenting){grip.pollGrips();xrUpdate(dt,frame);pollTriggers(dt,frame);}else{orbit.update();if(held.has('mouse'))move('mouse',held.get('mouse').ray,dt);}
  grip.update(dt);syncWholePose(dt);const whole=grip.isHolding('left')||grip.isHolding('right');if(whole&&!wasWholeHold)releaseAll();wasWholeHold=whole;
  if(!paused&&!whole){const t=performance.now();updateFloor();acc=Math.min(acc+dt,h*6);let count=0;
    while(acc>=h&&count<6){for(const s of held.values())model.grab(s.index,s.offset,anchor.worldToLocal(s.target.clone()),gravity,h,motion.heft);model.step(h);acc-=h;count++;}if(count)draw();physicsMs=performance.now()-t;
  }else{acc=0;physicsMs=0;}
  const secondaryStart=performance.now();secondary.update(model,anchor,realDt,motion,gravityOn,closeControllers(frame));const secondaryMs=performance.now()-secondaryStart;
  if(time-begin>1000){$('stats').textContent=(frames*1000/(time-begin)).toFixed(1)+' callback FPS | '+physicsMs.toFixed(2)+' ms physics | '+secondaryMs.toFixed(2)+' ms local tissue | 15 bodies | '+([...held.values()].map(s=>fit.shapes[s.index].name).join(', ')||'no grab');begin=time;frames=0;}
  renderer.render(scene,camera);
}catch(e){paused=true;releaseAll();status('Paused: '+e.message);console.error(e);}});
