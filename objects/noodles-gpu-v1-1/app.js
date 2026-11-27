import * as THREE from 'three/webgpu';
import {color,hash,instanceIndex,mix,vec3} from 'three/tsl';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {NoodleSimulation} from '../noodles-gpu-v1-0/NoodleSimulation.js';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';

const $=id=>document.getElementById(id);
const status=msg=>{$('status').textContent=msg;console.log(msg);try{localStorage.setItem('noodles-v1.1-stage',msg)}catch{}};
window.addEventListener('error',e=>status('Error: '+e.message));
window.addEventListener('unhandledrejection',e=>status('Error: '+(e.reason?.message||e.reason)));
const renderer=new THREE.WebGPURenderer({alpha:true,antialias:false,depth:true,stencil:false,multiview:false,outputBufferType:THREE.UnsignedByteType,powerPreference:'high-performance'});
// The known working Zelda V14.3 XR ordering is essential.
renderer.xr.enabled=true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(.65);
status('Requesting XR-compatible native GPU…');
await renderer.init();
if(!renderer.backend?.isWebGPUBackend)throw Error('Native WebGPU required; no WebGL fallback.');
renderer.backend.device?.addEventListener('uncapturederror',e=>status('GPU validation: '+e.error.message));
renderer.backend.device?.lost.then(info=>{status('GPU device lost: '+info.reason+' '+info.message);$('enter').disabled=true;renderer.setAnimationLoop(null);});
renderer.setClearColor(0,0);renderer.setPixelRatio(Math.min(devicePixelRatio,.8));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
$('scene').appendChild(renderer.domElement);
const scene=new THREE.Scene(),rig=new THREE.Group();scene.add(rig);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.01,100);rig.add(camera);camera.position.set(0,1.6,2.3);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,.95,-1.5);orbit.enableDamping=true;orbit.mouseButtons.LEFT=null;orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;orbit.update();
scene.add(new THREE.HemisphereLight(0xffffff,0x877050,1.5));const key=new THREE.DirectionalLight(0xffefd8,2.0);key.position.set(-2,4,3);scene.add(key);const fill=new THREE.DirectionalLight(0xc9e5ff,.7);fill.position.set(2,1,0);scene.add(fill);
// Table geometry and solver colliders use the same local frame.
const modelAnchor=new THREE.Group();modelAnchor.position.set(0,.45,-1.5);scene.add(modelAnchor);
const TABLE_TOP=.45,TABLE_W=1.6,TABLE_D=1.1,TABLE_THICK=.065;
const tabletopMaterial=new THREE.MeshStandardMaterial({color:0x866446,roughness:.65});
const legMaterial=new THREE.MeshStandardMaterial({color:0x34383b,roughness:.55,metalness:.18});
const table=new THREE.Group();table.name='Physical noodle table';modelAnchor.add(table);
const tableColliders=[];
function box(w,h,d,x,y,z,material){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
  mesh.position.set(x,y,z);table.add(mesh);
  tableColliders.push(new THREE.Box3(new THREE.Vector3(x-w/2,y-h/2,z-d/2),new THREE.Vector3(x+w/2,y+h/2,z+d/2)));
}
box(TABLE_W,TABLE_THICK,TABLE_D,0,TABLE_TOP-TABLE_THICK/2,0,tabletopMaterial);
const legHeight=TABLE_TOP-TABLE_THICK+.45;
for(const x of [-.69,.69])for(const z of [-.44,.44])box(.07,legHeight,.07,x,-.45+legHeight/2,z,legMaterial);
const gravityWorld=new THREE.Vector3(0,-9.81,0);
const inverseAnchor=new THREE.Matrix4(),gravityLocal=new THREE.Vector3(),gravityRotation=new THREE.Quaternion(),gravityScale=new THREE.Vector3();
const floorWorld=new THREE.Plane(new THREE.Vector3(0,1,0),0),floorLocal=new THREE.Plane();
function updateGravity(sim){
  if(!sim)return;
  modelAnchor.updateWorldMatrix(true,false);
  inverseAnchor.copy(modelAnchor.matrixWorld).invert();
  modelAnchor.getWorldQuaternion(gravityRotation).invert();
  modelAnchor.getWorldScale(gravityScale);
  gravityLocal.copy(gravityWorld).applyQuaternion(gravityRotation).divideScalar(Math.max(.001,gravityScale.x));
  sim.gravity.copy(gravityLocal);
  // Finite table collision, plus invisible floor at room level for fallen strands.
  floorLocal.copy(floorWorld).applyMatrix4(inverseAnchor);
  if(sim.ground)sim.ground.copy(floorLocal);else sim.ground=floorLocal.clone();
}
const physics=await createGrabPhysics({renderer,rig,modelAnchor,onStatus:status});
const mat=new THREE.MeshStandardNodeMaterial({roughness:.45});mat.colorNode=color('#ffcf57').mul(mix(vec3(1),vec3(.78,.65,.4),hash(instanceIndex)));
let noodles=null,building=false,paused=false,held=null,desktopHeld=false;
const raycaster=new THREE.Raycaster(),tempRay=new THREE.Ray(),q=new THREE.Quaternion(),v=new THREE.Vector3(),p=new THREE.Vector3();
const controllers=[0,1].map(i=>renderer.xr.getController(i));
function rayFrom(c){c.updateWorldMatrix(true,false);c.getWorldPosition(p);c.getWorldQuaternion(q);v.set(0,0,-1).applyQuaternion(q);tempRay.set(p,v);return tempRay;}
function start(ray,owner){if(!noodles||building||held!==null)return;held=owner;raycaster.ray.copy(ray);raycaster.near=0;raycaster.far=Infinity;noodles.pick(raycaster,{radius:.055}).grabPicked().moveGrabAlongRay(ray);}
function release(owner){if(held!==owner)return;noodles?.endGrab();held=null;}
controllers.forEach((c,i)=>{c.addEventListener('selectstart',()=>start(rayFrom(c),i));c.addEventListener('selectend',()=>release(i));c.addEventListener('disconnected',()=>release(i));});
// Closely stacked pre-coiled strands settle into a pile under gravity.
function makeCurves(count){
  const piles=count>16?3:count>8?2:1;
  return Array.from({length:count},(_,n)=>{
    const pile=n%piles,layer=Math.floor(n/piles),x=(pile-(piles-1)/2)*.47;
    const phase=n*2.39996323,y=TABLE_TOP+.032+layer*.052;
    const pts=[];
    for(let i=0;i<=64;i++){const t=i/64,angle=phase+t*Math.PI*2*1.18,rad=.065+.16*t;
      pts.push(new THREE.Vector3(x+rad*Math.cos(angle)+.012*Math.sin(n),y+.003*Math.sin(angle*2),rad*Math.sin(angle)+.012*Math.cos(n)));
    }
    return new THREE.CatmullRomCurve3(pts);
  });
}
async function build(){if(building)return;building=true;$('enter').disabled=true;$('reset').disabled=true;$('count').disabled=true;status('Compiling original GPU noodle solver…');
let next;try{const count=Number($('count').value);next=new NoodleSimulation(makeCurves(count),mat,{radius:.022,particlesPerNoodle:24,radialSegments:8,lengthSegments:3,contactLanes:true,colliders:tableColliders});updateGravity(next);next.numSubsteps=8;next.colliderFriction=.9;next.groundFriction=.9;next.groundRestitution=0;next.bendingCompliance=2;next.bendingDamping=20;next.bendingPlasticity=2;next.contactFriction=.6;next.maxSpeed=8;await next.compileAsync(renderer);if(noodles){noodles.endGrab();noodles.removeFromParent();noodles.dispose();}held=null;noodles=next;modelAnchor.add(noodles);physics.attachModel(new THREE.Vector3(TABLE_W,1.8,TABLE_D));updateGravity(noodles);status('Ready · native WebGPU · '+count+' strands');$('reset').disabled=false;$('pause').disabled=false;}catch(e){next?.dispose();status('Compilation failed: '+e.message);throw e;}finally{building=false;$('count').disabled=false;$('enter').disabled=!arSupported||!noodles;}}
let arSupported=false;
$('count').addEventListener('change',()=>build().catch(console.error));$('reset').addEventListener('click',()=>{noodles?.endGrab();held=null;physics.reset();updateGravity(noodles);noodles?.reset();});$('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';});
const pointer=new THREE.Vector2();function mouseRay(e){const b=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button!==0||renderer.xr.isPresenting)return;desktopHeld=true;renderer.domElement.setPointerCapture(e.pointerId);start(mouseRay(e),'mouse');});
renderer.domElement.addEventListener('pointermove',e=>{if(desktopHeld&&held==='mouse')noodles?.moveGrabAlongRay(mouseRay(e));});
for(const event of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,()=>{desktopHeld=false;release('mouse');});
let entering=false,last=0,frames=0,begin=0,snapReady=true;
$('enter').addEventListener('click',async()=>{if(entering||!arSupported||building)return;entering=true;$('enter').disabled=true;let session;try{status('Requesting immersive AR with webgpu…');session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local-floor','webgpu']});await renderer.xr.setSession(session);if(!renderer.xr.getWebGPUBinding?.())throw Error('Native XR GPU binding unavailable');orbit.enabled=false;camera.position.set(0,0,0);physics.releaseAll();status('Native WebGPU passthrough active');}catch(e){if(session)try{await session.end()}catch{}status('XR start failed: '+e.name+': '+e.message);}finally{entering=false;$('enter').disabled=false;}});
renderer.xr.addEventListener('sessionend',()=>{noodles?.endGrab();held=null;orbit.enabled=true;camera.position.set(0,1.6,2.3);orbit.target.set(0,.95,-1.5);orbit.update();status('XR ended · desktop preview');});
function stick(g){const a=g.axes||[];return a.length>=4&&Math.hypot(a[2],a[3])>.12?[a[2],a[3]]:[a[0]||0,a[1]||0];}
const viewer=new THREE.Vector3(),right=new THREE.Vector3(),rot=new THREE.Quaternion(),rigQ=new THREE.Quaternion(),pivot=new THREE.Vector3(),after=new THREE.Vector3();
function updateXR(dt,frame){const space=renderer.xr.getReferenceSpace(),pose=frame&&space?frame.getViewerPose(space):null;if(!pose)return;let l=[0,0],r=[0,0];for(const source of renderer.xr.getSession().inputSources){if(!source.gamepad)continue;if(source.handedness==='left')l=stick(source.gamepad);if(source.handedness==='right')r=stick(source.gamepad);}
const t=pose.transform.position;viewer.set(t.x,t.y,t.z);rig.updateMatrixWorld(true);rig.localToWorld(viewer);if(!physics.isHolding('right')){if(Math.abs(r[0])<.3)snapReady=true;if(snapReady&&Math.abs(r[0])>.7){pivot.copy(viewer);rig.rotation.y-=Math.sign(r[0])*Math.PI/6;rig.updateMatrixWorld(true);after.set(t.x,t.y,t.z);rig.localToWorld(after);rig.position.add(pivot.sub(after));snapReady=false;}}else snapReady=true;
const depth=Math.abs(r[1])>=Math.abs(l[1])?r[1]:l[1];if(Math.abs(depth)>.16)physics.adjustModelDepth(depth,dt,viewer);if(Math.abs(l[0])>.16){const o=pose.transform.orientation;rot.set(o.x,o.y,o.z,o.w);rig.getWorldQuaternion(rigQ);right.set(1,0,0).applyQuaternion(rot.premultiply(rigQ));right.y=0;if(right.lengthSq()>1e-6)physics.adjustModelSide(l[0],dt,right.normalize());}}
window.addEventListener('resize',()=>{if(renderer.xr.isPresenting)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
await build();
if(navigator.xr&&typeof globalThis.XRGPUBinding!=='undefined')arSupported=await navigator.xr.isSessionSupported('immersive-ar');$('enter').textContent=arSupported?'ENTER PASSTHROUGH':'Native XR unavailable — desktop preview';$('enter').disabled=!arSupported;
await renderer.setAnimationLoop((time,frame)=>{const dt=last?Math.min(.033,(time-last)/1000):0;last=time;if(!begin)begin=time;frames++;if(time-begin>=1000){$('fps').textContent=(frames*1000/(time-begin)).toFixed(1)+' callback fps';frames=0;begin=time;}try{if(renderer.xr.isPresenting){physics.pollGrips();updateXR(dt,frame);if(typeof held==='number')noodles?.moveGrabAlongRay(rayFrom(controllers[held]));}else orbit.update();physics.update(dt);if(!building&&noodles){updateGravity(noodles);noodles.update(renderer,paused?0:dt);}renderer.render(scene,camera);}catch(e){status('Frame failed: '+e.message);renderer.setAnimationLoop(null);renderer.xr.getSession()?.end().catch(console.error);}});
