import * as THREE from 'three/webgpu';
import {color,mix,float,smoothstep,positionLocal} from 'three/tsl';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {ReactionDiffusionSimulation2D} from '../discobolus-gpu-v1-0/ReactionDiffusionSimulation2D.js';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),fine=params.get('quality')==='fine',passthrough=params.get('mode')==='ar',sessionMode=passthrough?'immersive-ar':'immersive-vr';
$('mode').value=passthrough?'ar':'vr';
$('mode').addEventListener('change',()=>{params.set('mode',$('mode').value);params.set('v','1.1');location.search=params.toString();});
$('modeHint').textContent=passthrough?'See your real room with the same lit sculpture. Sticks move the sculpture, not the room.':'Original immersive blue studio. Walk or use the left stick to move.';
$('quality').value=fine?'fine':'balanced';
$('quality').addEventListener('change',()=>{params.set('quality',$('quality').value);params.set('v','1.1');location.search=params.toString();});
const status=msg=>{$('status').textContent=msg;console.log(msg);try{localStorage.setItem('discobolus-v1.1-stage',msg);}catch{}};
window.addEventListener('error',e=>status('Error: '+e.message));window.addEventListener('unhandledrejection',e=>status('Error: '+(e.reason?.message||e.reason)));
const renderer=new THREE.WebGPURenderer({alpha:passthrough,antialias:false,depth:true,stencil:false,multiview:false,outputBufferType:THREE.UnsignedByteType,powerPreference:'high-performance'});
renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.xr.setFramebufferScaleFactor(fine?.65:.8);
status('Initialising XR-compatible native WebGPU…');
await renderer.init();if(!renderer.backend?.isWebGPUBackend)throw Error('Native WebGPU required. No silent WebGL fallback.');
let gpuLost=false;
renderer.backend.device?.addEventListener('uncapturederror',e=>status('GPU validation: '+e.error.message));
renderer.backend.device?.lost.then(info=>{gpuLost=true;status('GPU lost: '+info.reason+' '+info.message);$('enter').disabled=true;renderer.setAnimationLoop(null);});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1));renderer.setSize(innerWidth,innerHeight);renderer.setClearColor(0xa9bdc5,1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;
$('scene').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#a9bdc5');
const rig=new THREE.Group();scene.add(rig);const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.015,80);rig.add(camera);camera.position.set(2.3,1.55,3.2);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,.95,0);orbit.enableDamping=true;orbit.mouseButtons.LEFT=null;orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;orbit.update();

// Opaque, stereo-correct blue studio. Gradient is in 3D, not a DOM overlay.
const skyMat=new THREE.MeshBasicNodeMaterial({side:THREE.BackSide,depthWrite:false,toneMapped:false});
skyMat.colorNode=mix(color('#bad5e2'),color('#98abb4'),smoothstep(float(-.12),float(.9),positionLocal.y.div(40)));
const sky=new THREE.Mesh(new THREE.SphereGeometry(40,48,24),skyMat);sky.renderOrder=-10;scene.add(sky);
const floorMat=new THREE.MeshBasicNodeMaterial({color:'#bad5e2',toneMapped:false});const floor=new THREE.Mesh(new THREE.PlaneGeometry(75,75),floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-.004;scene.add(floor);
// A procedural soft-box reflection map keeps the gold metallic, without a visible studio rig.
const EW=256,EH=128,pixels=new Uint8Array(EW*EH*4);
for(let y=0;y<EH;y++)for(let x=0;x<EW;x++){
  const a=x/EW*Math.PI*2,b=y/EH*Math.PI;let value=.24+.15*Math.sin(b);
  for(const [az,el,wa,wb,strength] of [[.7,1.05,.46,.32,.72],[3.6,1.25,.19,.60,.62],[5.0,.9,.52,.27,.50]]){
    const da=Math.atan2(Math.sin(a-az),Math.cos(a-az));value+=strength*Math.exp(-Math.pow(da/wa,4)-Math.pow((b-el)/wb,4));
  }
  const k=(y*EW+x)*4;pixels[k]=Math.min(255,Math.round(value*255));pixels[k+1]=Math.min(255,Math.round(value*252));pixels[k+2]=Math.min(255,Math.round(value*248));pixels[k+3]=255;
}
const env=new THREE.DataTexture(pixels,EW,EH,THREE.RGBAFormat);env.colorSpace=THREE.SRGBColorSpace;env.mapping=THREE.EquirectangularReflectionMapping;env.needsUpdate=true;scene.environment=env;scene.environmentIntensity=1.1;
scene.add(new THREE.HemisphereLight(0xe2f4ff,0x88949d,1.25));
for(const [c,intensity,x,y,z] of [[0xe2f4ff,2.8,3,4,2],[0xffffff,2.0,-3,2,-2],[0xfff0dc,.7,0,3,4]]){const l=new THREE.DirectionalLight(c,intensity);l.position.set(x,y,z);scene.add(l);}
const cv=document.createElement('canvas');cv.width=cv.height=128;const ctx=cv.getContext('2d');const grad=ctx.createRadialGradient(64,64,8,64,64,64);grad.addColorStop(0,'rgba(35,53,63,.38)');grad.addColorStop(.45,'rgba(35,53,63,.16)');grad.addColorStop(1,'rgba(35,53,63,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);const shadowTex=new THREE.CanvasTexture(cv);shadowTex.colorSpace=THREE.SRGBColorSpace;
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.8),new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,toneMapped:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.002;scene.add(shadow);
const studioBackground=scene.background;
function setPassthrough(active){
  scene.background=active?null:studioBackground;
  sky.visible=floor.visible=shadow.visible=!active;
  renderer.setClearColor(active?0x000000:0xa9bdc5,active?0:1);
  // Keep the original lights and environment map: gold reflections and marble remain identical.
}

// The original source's two GLBs are pinned to the reviewed upstream commit.
const assetRoot='https://raw.githubusercontent.com/marcofugaro/three-advanced-techniques/97c1e27f0c34927128a40b2dfe75315e0ac6e7a7/examples/models/';
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
status('Downloading original Discobolus sculpture…');
const gltf=await loader.loadAsync(assetRoot+'discobulus.glb');
const original=gltf.scene.getObjectsByProperty('isMesh',true)[0];if(!original)throw Error('Original sculpture contains no mesh');
const source=original.geometry;
function regularStatueGeometry(gltf, source) {
  const mesh = gltf.scene.getObjectsByProperty('isMesh', true)[0]
  const sourceIndex = source.index.array
  const sourcePosition = source.getAttribute('position')
  // The hash the remesh stored: FNV-1a over the source's index, then its positions' float32 bits
  const xyz = new Float32Array(3 * sourcePosition.count)
  for (let i = 0; i < sourcePosition.count; i++) {
    xyz[3 * i] = sourcePosition.getX(i)
    xyz[3 * i + 1] = sourcePosition.getY(i)
    xyz[3 * i + 2] = sourcePosition.getZ(i)
  }
  let hash = 0x811c9dc5
  for (const words of [sourceIndex, new Uint32Array(xyz.buffer)]) {
    for (let i = 0; i < words.length; i++) hash = Math.imul(hash ^ words[i], 16777619)
  }
  if (hash >>> 0 !== mesh.userData.sourceHash) {
    mesh.geometry.dispose()
    return null
  }
  mesh.updateWorldMatrix(true, false)
  const quantized = mesh.geometry.getAttribute('position')
  const sourceFace = mesh.geometry.getAttribute('_sourceface').array
  const sourceNormal = source.getAttribute('normal')
  const count = quantized.count
  const position = new Float32Array(3 * count)
  const normal = new Float32Array(3 * count)
  const refineSource = new Uint32Array(3 * count)
  const refineWeight = new Float32Array(3 * count)
  const p = new THREE.Vector3()
  const triangle = new THREE.Triangle()
  const barycoord = new THREE.Vector3()
  const closest = new THREE.Vector3()
  for (let v = 0; v < count; v++) {
    p.fromBufferAttribute(quantized, v).applyMatrix4(mesh.matrixWorld)
    const f = sourceFace[2 * v] | (sourceFace[2 * v + 1] << 16)
    const a = sourceIndex[3 * f]
    const b = sourceIndex[3 * f + 1]
    const c = sourceIndex[3 * f + 2]
    triangle.setFromAttributeAndIndices(sourcePosition, a, b, c)
    // The quantised point back onto its triangle, as barycentrics
    triangle.closestPointToPoint(p, closest)
    triangle.getBarycoord(closest, barycoord)
    const w = [Math.max(barycoord.x, 0), Math.max(barycoord.y, 0), Math.max(barycoord.z, 0)]
    const sum = w[0] + w[1] + w[2]
    const corners = [a, b, c]
    let nx = 0
    let ny = 0
    let nz = 0
    for (let k = 0; k < 3; k++) {
      const weight = w[k] / sum
      const s = corners[k]
      refineSource[3 * v + k] = s
      refineWeight[3 * v + k] = weight
      position[3 * v] += weight * sourcePosition.getX(s)
      position[3 * v + 1] += weight * sourcePosition.getY(s)
      position[3 * v + 2] += weight * sourcePosition.getZ(s)
      nx += weight * sourceNormal.getX(s)
      ny += weight * sourceNormal.getY(s)
      nz += weight * sourceNormal.getZ(s)
    }
    const length = Math.hypot(nx, ny, nz) || 1
    normal[3 * v] = nx / length
    normal[3 * v + 1] = ny / length
    normal[3 * v + 2] = nz / length
  }
  const geometry = new THREE.BufferGeometry()
  geometry.name = 'discobulus isotropic'
  geometry.setIndex(mesh.geometry.index)
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geometry.setAttribute('refineSource', new THREE.BufferAttribute(refineSource, 3))
  geometry.setAttribute('refineWeight', new THREE.BufferAttribute(refineWeight, 3))
  mesh.geometry.dispose()
  return geometry
}

let geom;
if(fine){status('Restoring original 608k-vertex isotropic remesh…');const remesh=await loader.loadAsync(assetRoot+'discobulus-isotropic.glb');geom=regularStatueGeometry(remesh,source);if(!geom)throw Error('Original remesh hash does not match sculpture');geom.deleteAttribute('refineSource');geom.deleteAttribute('refineWeight');}
else {geom=new THREE.BufferGeometry();geom.setIndex(source.index.clone());geom.setAttribute('position',source.getAttribute('position').clone());geom.setAttribute('normal',source.getAttribute('normal').clone());}
geom.computeBoundingBox();const box=geom.boundingBox.clone(),size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());const scale=1.7/size.y;
const anchor=new THREE.Group();anchor.position.set(0,.85,0);scene.add(anchor);
const material=new THREE.MeshPhysicalNodeMaterial({name:'Marble and gold',roughness:.22,metalness:0,clearcoat:.5,clearcoatRoughness:.15,ior:1.5});
status('Building original Gray–Scott GPU solver…');
const rd=new ReactionDiffusionSimulation2D(geom,material,{feedRate:.042,killRate:.06,diffusionA:.9375,diffusionB:.46875,timeStep:1.2,stepsPerSecond:fine?720:480,maxStepsPerFrame:fine?12:10,sleepThreshold:1e-6,patternLow:0,patternHigh:.5,blurIterations:1,displacementAmplitude:.0025,normalScale:1.5,brushMode:'seed',brushRadius:.025});
rd.scale.setScalar(scale);rd.position.copy(centre).multiplyScalar(-scale);anchor.add(rd);
const gold=smoothstep(float(.46),float(.54),rd.smoothPatternNode);
rd.material.colorNode=mix(color('#e7e7e7'),color('#ffe39d'),gold);
rd.material.metalnessNode=gold;rd.material.roughnessNode=mix(float(.22),float(.20),gold);rd.material.clearcoatNode=mix(float(.5),float(0),gold);
rd.clear();
const pickGeometry=source.clone();pickGeometry.boundsTree=new MeshBVH(pickGeometry);
const proxy=new THREE.Mesh(pickGeometry,new THREE.MeshBasicMaterial());proxy.raycast=acceleratedRaycast;proxy.visible=false;proxy.scale.copy(rd.scale);proxy.position.copy(rd.position);anchor.add(proxy);
const physics=await createGrabPhysics({renderer,rig,modelAnchor:anchor,onStatus:status});physics.attachModel(size.clone().multiplyScalar(scale));
const raycaster=new THREE.Raycaster();raycaster.firstHitOnly=true;
function pick(ray){proxy.updateWorldMatrix(true,false);raycaster.ray.copy(ray);return raycaster.intersectObject(proxy,false)[0]?.point?.clone()??null;}
function seedPoint(){proxy.updateWorldMatrix(true,false);const origin=new THREE.Vector3(box.min.x+size.x*.2,box.min.y+.025,box.max.z+1).applyMatrix4(proxy.matrixWorld);const dir=new THREE.Vector3(0,0,-1).transformDirection(proxy.matrixWorld);const hit=pick(new THREE.Ray(origin,dir));if(hit)return hit;const p=source.getAttribute('position');let best=0,min=Infinity;for(let i=0;i<p.count;i++){const dx=p.getX(i)-(box.min.x+size.x*.2),dy=p.getY(i)-(box.min.y+.025),dz=p.getZ(i)-box.max.z;const d=dx*dx+dy*dy+dz*dz;if(d<min){min=d;best=i;}}return new THREE.Vector3().fromBufferAttribute(p,best).applyMatrix4(proxy.matrixWorld);}
let resetPending=true,clearPending=false,paused=false;
$('reset').addEventListener('click',()=>{resetPending=true;clearPending=false;});$('clear').addEventListener('click',()=>{clearPending=true;resetPending=false;});$('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';});
const hands=[0,1].map(i=>({controller:renderer.xr.getController(i),active:false,mode:i?'erase':'seed',last:null}));
for(const hand of hands){hand.controller.addEventListener('connected',e=>{hand.mode=e.data.handedness==='left'?'erase':'seed';});hand.controller.addEventListener('selectstart',()=>{hand.active=true;hand.last=null;});for(const ev of ['selectend','disconnected'])hand.controller.addEventListener(ev,()=>{hand.active=false;hand.last=null;});}
const mouse={active:false,mode:'seed',last:null,point:new THREE.Vector2()};
const pointerRay=new THREE.Ray(),origin=new THREE.Vector3(),direction=new THREE.Vector3(),quat=new THREE.Quaternion();
function controllerRay(c){c.updateWorldMatrix(true,false);c.getWorldPosition(origin);c.getWorldQuaternion(quat);direction.set(0,0,-1).applyQuaternion(quat);return pointerRay.set(origin,direction);}
function mousePoint(e){const r=renderer.domElement.getBoundingClientRect();mouse.point.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);mouse.mode=e.shiftKey?'erase':'seed';}
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button!==0||renderer.xr.isPresenting)return;mousePoint(e);mouse.active=true;mouse.last=null;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(mouse.active)mousePoint(e);});for(const ev of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(ev,()=>{mouse.active=false;mouse.last=null;});
let brushTurn=0;
function paint(){rd.brush=null;if(clearPending){rd.clear();clearPending=false;return;}if(resetPending){rd.clear();rd.brush=seedPoint();rd.brushMode='seed';rd.brushRadius=fine?.012:.035;rd.brushStrength=1;resetPending=false;return;}
 const active=renderer.xr.isPresenting?hands.filter(h=>h.active):mouse.active?[mouse]:[];
 if(!active.length)return;
 // One brush dispatch per frame, alternate hands if both held; each retains its own stroke.
 const h=active[brushTurn++%active.length];let hit;
 if(h===mouse){raycaster.setFromCamera(mouse.point,camera);hit=pick(raycaster.ray.clone());}else hit=pick(controllerRay(h.controller));
 if(!hit){h.last=null;return;}rd.brushMode=h.mode;rd.brushRadius=h.mode==='erase'?.05:(fine?.025:.035);rd.brushStrength=1;rd.brush=h.last&&h.last.distanceTo(hit)<.10?new THREE.Line3(h.last,hit):hit;h.last=hit.clone();
}
const viewer=new THREE.Vector3(),forward=new THREE.Vector3(),right=new THREE.Vector3(),rot=new THREE.Quaternion(),rigQ=new THREE.Quaternion(),pivot=new THREE.Vector3(),after=new THREE.Vector3();let snapReady=true;
function stick(g){const a=g.axes||[];return a.length>=4&&Math.hypot(a[2],a[3])>.12?[a[2],a[3]]:[a[0]||0,a[1]||0];}
function updateXR(dt,frame){const space=renderer.xr.getReferenceSpace(),pose=frame&&space?frame.getViewerPose(space):null;if(!pose)return;let l=[0,0],r=[0,0];for(const s of renderer.xr.getSession().inputSources){if(!s.gamepad)continue;if(s.handedness==='left')l=stick(s.gamepad);if(s.handedness==='right')r=stick(s.gamepad);}
const t=pose.transform.position,o=pose.transform.orientation;rig.updateMatrixWorld(true);viewer.set(t.x,t.y,t.z);rig.localToWorld(viewer);const holding=physics.isHolding('left')||physics.isHolding('right');
if(!passthrough&&!physics.isHolding('right')){if(Math.abs(r[0])<.3)snapReady=true;if(snapReady&&Math.abs(r[0])>.7){pivot.copy(viewer);rig.rotation.y-=Math.sign(r[0])*Math.PI/6;rig.updateMatrixWorld(true);after.set(t.x,t.y,t.z);rig.localToWorld(after);rig.position.add(pivot.sub(after));snapReady=false;}}else snapReady=true;
rot.set(o.x,o.y,o.z,o.w);rig.getWorldQuaternion(rigQ);rot.premultiply(rigQ);right.set(1,0,0).applyQuaternion(rot);right.y=0;right.normalize();forward.set(0,0,-1).applyQuaternion(rot);forward.y=0;forward.normalize();
if(holding||passthrough){const depth=Math.abs(r[1])>=Math.abs(l[1])?r[1]:l[1];if(Math.abs(depth)>.16)physics.adjustModelDepth(depth,dt,viewer);if(Math.abs(l[0])>.16)physics.adjustModelSide(l[0],dt,right);}
else{if(Math.abs(l[0])>.16)rig.position.addScaledVector(right,l[0]*dt*1.1);if(Math.abs(l[1])>.16)rig.position.addScaledVector(forward,-l[1]*dt*1.1);}}
status('Compiling GPU reaction-diffusion pipelines…');await rd.compileAsync(renderer);
rd.update(renderer,0);await renderer.compileAsync(scene,camera);
$('reset').disabled=$('clear').disabled=$('pause').disabled=false;
let supported=!!navigator.xr&&typeof globalThis.XRGPUBinding!=='undefined'&&await navigator.xr.isSessionSupported(sessionMode),entering=false,lastFailure='';
$('enter').textContent=supported?(passthrough?'ENTER PASSTHROUGH':'ENTER IMMERSIVE VR'):(passthrough?'Passthrough unavailable':'Immersive VR unavailable')+' · desktop preview';$('enter').disabled=!supported;
status('Ready · '+(fine?'original fine remesh':'balanced original scan')+' · '+rd.info.vertices.toLocaleString()+' simulation vertices');
$('enter').addEventListener('click',async()=>{if(entering||!supported||gpuLost)return;entering=true;$('enter').disabled=true;let session;lastFailure='';try{status('Requesting '+sessionMode+' + native WebGPU…');session=await navigator.xr.requestSession(sessionMode,{requiredFeatures:['local-floor','webgpu']});if(passthrough?session.environmentBlendMode!=='alpha-blend':session.environmentBlendMode!=='opaque')throw Error('Unexpected environment blend mode: '+session.environmentBlendMode);setPassthrough(passthrough);await renderer.xr.setSession(session);if(!renderer.xr.getWebGPUBinding?.())throw Error('Native XR GPU binding unavailable');orbit.enabled=false;rig.position.set(0,0,2.2);rig.rotation.set(0,0,0);camera.position.set(0,0,0);physics.releaseAll();status((passthrough?'Mixed-reality passthrough':'Immersive blue studio')+' active · native WebGPU');}catch(e){lastFailure='VR start failed: '+e.name+': '+e.message;if(session)try{await session.end();}catch{}setPassthrough(false);status(lastFailure);}finally{entering=false;$('enter').disabled=gpuLost;}});
renderer.xr.addEventListener('sessionend',()=>{setPassthrough(false);for(const h of hands){h.active=false;h.last=null;}rig.position.set(0,0,0);rig.rotation.set(0,0,0);orbit.enabled=true;camera.position.set(2.3,1.55,3.2);orbit.target.set(0,.95,0);orbit.update();status(lastFailure||'VR ended · desktop preview');});
window.addEventListener('resize',()=>{if(renderer.xr.isPresenting)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let last=0,frames=0,begin=0;
await renderer.setAnimationLoop((time,frame)=>{const dt=last?Math.min(.033,(time-last)/1000):0;last=time;if(!begin)begin=time;frames++;if(time-begin>=1000){$('fps').textContent=(frames*1000/(time-begin)).toFixed(1)+' callback fps · '+rd.info.steps+' simulation steps';frames=0;begin=time;}try{if(renderer.xr.isPresenting){physics.pollGrips();updateXR(dt,frame);}else orbit.update();physics.update(dt);shadow.position.x=anchor.position.x;shadow.position.z=anchor.position.z;shadow.scale.setScalar(Math.max(.1,anchor.scale.x));shadow.material.opacity=Math.max(0,1-Math.abs(anchor.position.y-.85*anchor.scale.x));paint();rd.update(renderer,paused?0:dt);renderer.render(scene,camera);}catch(e){lastFailure='Frame failed: '+e.name+': '+e.message;status(lastFailure);renderer.setAnimationLoop(null);renderer.xr.getSession()?.end().catch(console.error);}});
