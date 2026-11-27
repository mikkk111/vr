import * as THREE from 'three/webgpu';
import {Fn,instancedArray,instanceIndex,uniform,vec3,vec4,float,hash,positionGeometry,normalLocal,varying,mix,dot,length,sin,cos,pow,abs,normalize,clamp,select,cameraPosition,modelWorldMatrix,normalGeometry} from 'three/tsl';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';

import {DebrisAudio,ContactTracker} from '../light-debris-v1-1/audio.js?v=1.1';
import {OPTICS,shapeGeometry,glassFunction} from './glass.js?v=1.2';

const $=id=>document.getElementById(id);
const status=s=>$('status').textContent=s;
const sound=new DebrisAudio(s=>{$('audioStatus').textContent=s;$('audioToggle').textContent=sound.enabled?'Mute audio':'Enable audio';});
function audioLevels(){sound.setLevels(+$('masterVolume').value/100,+$('ambientVolume').value/100,+$('effectVolume').value/100);}
for(const id of ['masterVolume','ambientVolume','effectVolume'])$(id).addEventListener('input',audioLevels);
audioLevels();
$('audioToggle').onclick=()=>{if(sound.enabled)sound.disable();else{sound.setAudible(true);void sound.enable();}};
document.addEventListener('visibilitychange',()=>sound.setAudible(!document.hidden));
window.addEventListener('pagehide',()=>sound.disable());
const params=new URLSearchParams(location.search);
const profiles={
  quest:{count:8000,xr:.65,dpr:.8},
  balanced:{count:24000,xr:.75,dpr:1},
  high:{count:60000,xr:.85,dpr:1},
  ultra:{count:150000,xr:1,dpr:1.15}
};
const quality=Object.hasOwn(profiles,params.get('quality'))?params.get('quality'):'quest';
const mode=params.get('mode')==='vr'?'vr':'ar';
const profile=profiles[quality],N=profile.count;
const optics=Object.hasOwn(OPTICS,params.get('optics'))?params.get('optics'):'solid';
const flaws=uniform(1),arGlass=uniform(0);
$('imperfections').addEventListener('input',()=>{flaws.value=+$('imperfections').value/100;});
const palettes={warm:[0xffaf64,0x83baff],red:[0xff5445,0xffe7cf],white:[0xfff4dc,0x659fff]};
const palette=Object.hasOwn(palettes,params.get('palette'))?params.get('palette'):'warm';
for(const [id,value] of Object.entries({quality,mode,palette,optics})){
  $(id).value=value;
  $(id).addEventListener('change',()=>{const next=new URLSearchParams(location.search);next.set(id,$(id).value);location.search=next.toString();});
}
const sessionMode=mode==='ar'?'immersive-ar':'immersive-vr';
window.addEventListener('error',e=>status('Error: '+e.message));
window.addEventListener('unhandledrejection',e=>status('Error: '+(e.reason?.message||e.reason)));

const renderer=new THREE.WebGPURenderer({alpha:mode==='ar',antialias:false,depth:true,stencil:false,multiview:false,outputBufferType:THREE.UnsignedByteType,powerPreference:'high-performance'});
// Same XR-compatible adapter initialization order as Zelda GPU V14.3.
renderer.xr.enabled=true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(profile.xr);
status('Initialising native XR-compatible WebGPU…');
await renderer.init();
if(!renderer.backend?.isWebGPUBackend)throw Error('Native WebGPU required. No silent WebGL fallback.');
let lost=false;
renderer.backend.device?.addEventListener('uncapturederror',e=>status('GPU validation: '+e.error.message));
renderer.backend.device?.lost.then(info=>{lost=true;sound.disable();resetContactAudio();status('GPU device lost: '+info.reason+' '+info.message+' — reload at lower quality.');$('enter').disabled=true;renderer.setAnimationLoop(null);renderer.xr.getSession()?.end().catch(console.error);});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,profile.dpr));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NeutralToneMapping;
$('scene').appendChild(renderer.domElement);
const scene=new THREE.Scene(),rig=new THREE.Group();scene.add(rig);
const dark=new THREE.Color(0x050609);
scene.background=dark;
renderer.setClearColor(dark,1);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.025,80);rig.add(camera);
const anchor=new THREE.Group();anchor.position.set(0,1.4,-2.2);scene.add(anchor);
const desktopPosition=new THREE.Vector3(0,1.65,1.2);
camera.position.copy(desktopPosition);
const orbit=new OrbitControls(camera,renderer.domElement);
orbit.target.copy(anchor.position);orbit.enableDamping=true;orbit.mouseButtons.LEFT=null;orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;orbit.update();
const physics=await createGrabPhysics({renderer,rig,modelAnchor:anchor,onStatus:status});
physics.attachModel(new THREE.Vector3(3.2,1.8,1.8));

// All particle state stays on GPU. One compute dispatch per frame; no readback.
const centres=instancedArray(N,'vec3'),rest=instancedArray(N,'vec3'),speed=instancedArray(N,'vec3'),angles=instancedArray(N,'vec3'),sizes=instancedArray(N,'float');
const dtNode=uniform(0),clock=uniform(0);
// Bounded audio-only GPU sampling, separate from the known-working visual solver.
const SAMPLE=Math.min(1536,N),sampleStride=Math.floor(N/SAMPLE);
const audioSample=instancedArray(SAMPLE,'vec4');
const gatherAudio=Fn(()=>{
  const i=instanceIndex.mul(sampleStride);
  audioSample.element(instanceIndex).assign(vec4(centres.element(i),sizes.element(i)));
})().compute(SAMPLE);
const contactTracker=new ContactTracker();
let audioReadBusy=false,audioReadFailed=false,nextAudioRead=0,audioEpoch=0;
function resetContactAudio(){audioEpoch++;contactTracker.reset();nextAudioRead=0;}
const lamps=[0,1].map(i=>({
  origin:uniform(new THREE.Vector3()),dir:uniform(new THREE.Vector3(0,0,-1)),
  reach:uniform(3),active:uniform(0),point:uniform(new THREE.Vector3()),
  tint:uniform(new THREE.Color(palettes[palette][i]))
}));
const density=Math.pow(24000/N,.24);
const init=Fn(()=>{
  const i=instanceIndex;
  // A broad ellipsoidal distribution with a dense centre and irregular edges.
  const a=hash(i.add(31)).mul(6.2831853);
  const z=hash(i.add(57)).mul(2).sub(1);
  const r=pow(hash(i.add(93)),.48);
  const xy=float(1).sub(z.mul(z)).max(0).sqrt();
  const p=vec3(cos(a).mul(xy).mul(1.6),z.mul(.88),sin(a).mul(xy).mul(.88)).mul(r);
  centres.element(i).assign(p);rest.element(i).assign(p);speed.element(i).assign(vec3(0));
  angles.element(i).assign(vec3(hash(i.add(101)),hash(i.add(211)),hash(i.add(307))).mul(6.2831853));
  sizes.element(i).assign(pow(hash(i.add(401)),3.5).mul(.041).add(.007).mul(density));
})().compute(N);
const update=Fn(()=>{
  const i=instanceIndex;
  const p=centres.element(i).toVar(),v=speed.element(i).toVar();
  const accel=rest.element(i).sub(p).mul(1.65).toVar();
  // Two finite 3-D beams: each repels a capsule of nearby debris.
  for(const lamp of lamps){
    const delta=p.sub(lamp.origin);
    const nearest=lamp.origin.add(lamp.dir.mul(clamp(dot(delta,lamp.dir),0,lamp.reach)));
    const away=p.sub(nearest);
    const d=length(away);
    const fall=float(1).sub(d.div(.48)).max(0);
    accel.addAssign(away.div(d.max(.018)).mul(fall.mul(fall)).mul(lamp.active).mul(13).div(sizes.element(i).mul(18).add(.65)));
  }
  const t=clock.mul(.38);
  accel.addAssign(vec3(sin(p.y.mul(3).add(t)),cos(p.z.mul(4).sub(t)),sin(p.x.mul(3).add(t.mul(.8)))).mul(.10));
  v.addAssign(accel.mul(dtNode));
  v.mulAssign(dtNode.mul(-1.8).exp());
  v.mulAssign(float(2.8).div(length(v).max(2.8)));
  p.addAssign(v.mul(dtNode));
  centres.element(i).assign(p);speed.element(i).assign(v);
  const spin=length(v).mul(2.8).add(.09).mul(dtNode);
  angles.element(i).assign(angles.element(i).add(vec3(spin,spin.mul(.71),spin.mul(.43))));
})().compute(N);

// Simple rigid rotation of each fragment in the vertex shader.
function rotate(v,a){
  const x=vec3(v.x,v.y.mul(cos(a.x)).sub(v.z.mul(sin(a.x))),v.y.mul(sin(a.x)).add(v.z.mul(cos(a.x))));
  const y=vec3(x.x.mul(cos(a.y)).add(x.z.mul(sin(a.y))),x.y,x.z.mul(cos(a.y)).sub(x.x.mul(sin(a.y))));
  return vec3(y.x.mul(cos(a.z)).sub(y.y.mul(sin(a.z))),y.x.mul(sin(a.z)).add(y.y.mul(cos(a.z))),y.z);
}
const shapes=[
  new THREE.TetrahedronGeometry(1,0),
  new THREE.BoxGeometry(1.6,.38,.78),
  new THREE.OctahedronGeometry(.85,0),
  new THREE.BoxGeometry(.55,.62,1.8)
].map(shapeGeometry);
let offset=0;
for(let k=0;k<shapes.length;k++){
  const count=k===3?N-offset:Math.floor(N*[.50,.24,.16,.10][k]);
  const id=instanceIndex.add(offset),a=angles.element(id),centre=centres.element(id),s=sizes.element(id);
  const point=rotate(positionGeometry.mul(s),a).add(centre);
  const material=new THREE.MeshBasicNodeMaterial({transparent:mode==='ar',depthWrite:true,side:THREE.FrontSide});
  material.positionNode=point;
  // Pass original fragment-space coordinates and world axes across rasterization.
  // The camera position node is updated per XR camera/eye by Three r187.
  const surface=varying(positionGeometry),normal=varying(normalGeometry),seed=varying(hash(id.add(723))),size=varying(s);
  const worldPoint=varying(modelWorldMatrix.mul(vec4(point,1)).xyz);
  const bx=varying(normalize(modelWorldMatrix.mul(vec4(rotate(vec3(1,0,0),a),0)).xyz));
  const by=varying(normalize(modelWorldMatrix.mul(vec4(rotate(vec3(0,1,0),a),0)).xyz));
  const bz=varying(normalize(modelWorldMatrix.mul(vec4(rotate(vec3(0,0,1),a),0)).xyz));
  const lampWorld=lamp=>vec4(modelWorldMatrix.mul(vec4(lamp.point,1)).xyz.sub(worldPoint),lamp.active);
  const glass=glassFunction(shapes[k].planes,k,optics);
  material.colorNode=glass({p:surface,normal,worldEye:cameraPosition.sub(worldPoint),bx,by,bz,seed,size,la:lampWorld(lamps[0]),lb:lampWorld(lamps[1]),ca:lamps[0].tint,cb:lamps[1].tint,ar:arGlass,flaws});
  const mesh=new THREE.InstancedMesh(shapes[k].geometry,material,count);
  mesh.frustumCulled=false;mesh.raycast=()=>{};anchor.add(mesh);offset+=count;
}

// Soft light marker: stereo-safe geometry instead of monoscopic screen-space bloom.
const glowCanvas=document.createElement('canvas');glowCanvas.width=128;glowCanvas.height=128;
const ctx=glowCanvas.getContext('2d'),grad=ctx.createRadialGradient(64,64,0,64,64,64);
grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.13,'rgba(255,255,255,.9)');grad.addColorStop(.35,'rgba(255,255,255,.22)');grad.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);
const glowTexture=new THREE.CanvasTexture(glowCanvas);
const hands=lamps.map((lamp,i)=>{
  const controller=renderer.xr.getController(i);
  const marker=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:palettes[palette][i],transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
  marker.scale.set(.34,.34,.34);marker.visible=false;anchor.add(marker);
  const state={controller,active:false,marker};
  controller.addEventListener('selectstart',()=>state.active=true);
  for(const event of ['selectend','disconnected'])controller.addEventListener(event,()=>state.active=false);
  return state;
});
const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster(),mouse={active:false};
renderer.domElement.addEventListener('pointermove',e=>{
  if(renderer.xr.isPresenting||e.buttons===2){mouse.active=false;return;}
  const b=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2);mouse.active=true;
});
renderer.domElement.addEventListener('pointerleave',()=>mouse.active=false);
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
const inv=new THREE.Matrix4(),origin=new THREE.Vector3(),direction=new THREE.Vector3(),rot=new THREE.Quaternion(),localOrigin=new THREE.Vector3(),localDirection=new THREE.Vector3();
function setBeam(i,enabled,worldOrigin,worldDirection){
  const lamp=lamps[i],marker=hands[i].marker;
  lamp.active.value=enabled?1:0;marker.visible=false;
  if(!enabled)return;
  anchor.updateWorldMatrix(true,false);inv.copy(anchor.matrixWorld).invert();
  localOrigin.copy(worldOrigin).applyMatrix4(inv);localDirection.copy(worldDirection).transformDirection(inv);
  // Centre the light at the nearest forward point along the ray; cap the
  // force segment just beyond the cloud, not at infinity.
  const along=Math.max(0,-localOrigin.dot(localDirection));
  const closest=localOrigin.clone().addScaledVector(localDirection,along);
  if(closest.length()>2.3){lamp.active.value=0;return;}
  lamp.origin.value.copy(localOrigin);lamp.dir.value.copy(localDirection);
  lamp.reach.value=along+1.3;lamp.point.value.copy(closest);
  marker.position.copy(closest);marker.visible=true;
}
function updateBeams(){
  if(renderer.xr.isPresenting){
    for(let i=0;i<2;i++){
      const h=hands[i];h.controller.updateWorldMatrix(true,false);h.controller.getWorldPosition(origin);h.controller.getWorldQuaternion(rot);direction.set(0,0,-1).applyQuaternion(rot);
      setBeam(i,h.active&&h.controller.visible,origin,direction);
    }
  }else{
    raycaster.setFromCamera(pointer,camera);setBeam(0,mouse.active,raycaster.ray.origin,raycaster.ray.direction);setBeam(1,false,origin,direction);
  }
}
function clearBeams(){mouse.active=false;for(let i=0;i<2;i++){hands[i].active=false;lamps[i].active.value=0;hands[i].marker.visible=false;}sound.silenceBeams();resetContactAudio();}
const audioPos=new THREE.Vector3(),audioForward=new THREE.Vector3(),audioUp=new THREE.Vector3(),audioQ=new THREE.Quaternion(),audioSource=new THREE.Vector3(),audioHit=new THREE.Vector3(),audioScratch=new THREE.Vector3();
const previousSource=[new THREE.Vector3(),new THREE.Vector3()],beamWasActive=[false,false];
function updateSound(dt,frame){
  if(!sound.running)return;
  const space=renderer.xr.getReferenceSpace(),pose=renderer.xr.isPresenting&&frame&&space?frame.getViewerPose(space):null;
  if(pose){
    const p=pose.transform.position,q=pose.transform.orientation;
    audioPos.set(p.x,p.y,p.z);rig.localToWorld(audioPos);
    audioQ.set(q.x,q.y,q.z,q.w);rig.getWorldQuaternion(rigQ);audioQ.premultiply(rigQ);
  }else{camera.getWorldPosition(audioPos);camera.getWorldQuaternion(audioQ);}
  audioForward.set(0,0,-1).applyQuaternion(audioQ);audioUp.set(0,1,0).applyQuaternion(audioQ);sound.listener(audioPos,audioForward,audioUp);
  for(let i=0;i<2;i++){
    const active=renderer.xr.isPresenting?hands[i].active&&hands[i].controller.visible:i===0&&mouse.active;
    const hit=lamps[i].active.value>0;
    if(renderer.xr.isPresenting)hands[i].controller.getWorldPosition(audioSource);else audioSource.copy(audioPos);
    if(hit){audioHit.copy(lamps[i].point.value);anchor.localToWorld(audioHit);audioSource.lerp(audioHit,.45);}
    const motion=active&&beamWasActive[i]?Math.min(5,previousSource[i].distanceTo(audioSource)/Math.max(dt,.01)):0;
    previousSource[i].copy(audioSource);beamWasActive[i]=active;
    sound.beam(i,active,audioSource,hit?1:0,motion);
  }
}
function sampleContacts(time){
  if(!sound.running||sound.effects<=0||sound.volume<=0||paused||audioReadBusy||audioReadFailed||time<nextAudioRead)return;
  nextAudioRead=time+125;audioReadBusy=true;const epoch=audioEpoch;
  // Snapshot transform at dispatch so delayed audio stays tied to the actual cloud.
  anchor.updateWorldMatrix(true,false);const transform=anchor.matrixWorld.clone();
  Promise.resolve().then(()=>{
    if(epoch!==audioEpoch||!sound.running||lost)return null;
    renderer.compute(gatherAudio);
    return renderer.getArrayBufferAsync(audioSample.value);
  }).then(buffer=>{
    if(!buffer||epoch!==audioEpoch||!sound.running||paused||lost)return;
    const samples=new Float32Array(buffer);
    if(samples.length!==SAMPLE*4)throw Error('Unexpected sample byte count: '+buffer.byteLength);
    for(const hit of contactTracker.scan(samples,time/1000)){
      audioScratch.set(hit.x,hit.y,hit.z).applyMatrix4(transform);
      if(sound.bell(audioScratch,hit.strength,hit.size))break;
    }
  }).catch(e=>{audioReadFailed=true;$('audioStatus').textContent='Crystal sampling unavailable; laser and ambient remain active: '+e.message;console.warn(e);}).finally(()=>{audioReadBusy=false;});
}
let paused=false,resetPending=false;
$('reset').onclick=()=>{resetPending=true;physics.reset();clearBeams();};
$('pause').onclick=()=>{paused=!paused;resetContactAudio();$('pause').textContent=paused?'Resume':'Pause';};
const viewer=new THREE.Vector3(),right=new THREE.Vector3(),rigQ=new THREE.Quaternion(),pivot=new THREE.Vector3(),after=new THREE.Vector3();
let snapReady=true;
function stick(g){const a=g.axes||[];return a.length>=4?[a[2]||0,a[3]||0]:[a[0]||0,a[1]||0];}
function updateXR(dt,frame){
  const space=renderer.xr.getReferenceSpace(),pose=frame&&space?frame.getViewerPose(space):null;if(!pose)return;
  let l=[0,0],r=[0,0];for(const source of renderer.xr.getSession().inputSources){if(!source.gamepad)continue;if(source.handedness==='left')l=stick(source.gamepad);if(source.handedness==='right')r=stick(source.gamepad);}
  const t=pose.transform.position,o=pose.transform.orientation;
  rig.updateMatrixWorld(true);viewer.set(t.x,t.y,t.z);rig.localToWorld(viewer);
  if(!physics.isHolding('right')){
    if(Math.abs(r[0])<.3)snapReady=true;
    if(snapReady&&Math.abs(r[0])>.7){pivot.copy(viewer);rig.rotation.y-=Math.sign(r[0])*Math.PI/6;rig.updateMatrixWorld(true);after.set(t.x,t.y,t.z);rig.localToWorld(after);rig.position.add(pivot.sub(after));snapReady=false;}
  }else snapReady=true;
  const depth=Math.abs(r[1])>=Math.abs(l[1])?r[1]:l[1];if(Math.abs(depth)>.16)physics.adjustModelDepth(depth,dt,viewer);
  if(Math.abs(l[0])>.16){rot.set(o.x,o.y,o.z,o.w);rig.getWorldQuaternion(rigQ);right.set(1,0,0).applyQuaternion(rot.premultiply(rigQ));right.y=0;if(right.lengthSq()>1e-6)physics.adjustModelSide(l[0],dt,right.normalize());}
}
function setEnvironment(inXR){
  const ar=inXR&&mode==='ar';arGlass.value=ar?1:0;scene.background=ar?null:dark;renderer.setClearColor(ar?0:dark,ar?0:1);
}
let supported=false,entering=false,lastFailure='';
status('Compiling '+N.toLocaleString()+' glass fragments · '+OPTICS[optics].label+'…');
await renderer.computeAsync(init);
dtNode.value=0;await renderer.computeAsync(update);
await renderer.compileAsync(scene,camera);
try{supported=!!navigator.xr&&typeof globalThis.XRGPUBinding!=='undefined'&&await navigator.xr.isSessionSupported(sessionMode);}catch(e){status('XR support check failed: '+e.message);}
$('enter').textContent=supported?(mode==='ar'?'ENTER PASSTHROUGH':'ENTER DARK VR'):'Native XR unavailable — desktop preview';
$('enter').disabled=!supported;$('reset').disabled=$('pause').disabled=false;
status('Ready · '+N.toLocaleString()+' fragments · '+OPTICS[optics].label+' · native WebGPU');
$('enter').onclick=async()=>{
  if(entering||lost||!supported)return;entering=true;$('enter').disabled=true;let session;lastFailure='';
  sound.setAudible(true);if($('autoAudio').checked)void sound.enable();
  try{
    status('Requesting '+sessionMode+' + native WebGPU…');
    session=await navigator.xr.requestSession(sessionMode,{requiredFeatures:['local-floor','webgpu']});
    const expected=mode==='ar'?'alpha-blend':'opaque';
    if(session.environmentBlendMode!==expected)throw Error('Unexpected blend mode: '+session.environmentBlendMode);
    setEnvironment(true);await renderer.xr.setSession(session);
    session.addEventListener('visibilitychange',()=>{sound.setAudible(session.visibilityState==='visible');resetContactAudio();});
    if(!renderer.xr.getWebGPUBinding?.())throw Error('Native XR GPU binding unavailable');
    orbit.enabled=false;rig.position.set(0,0,0);rig.rotation.set(0,0,0);camera.position.set(0,0,0);physics.releaseAll();clearBeams();snapReady=true;
    status('XR active · '+N.toLocaleString()+' fragments');
  }catch(e){lastFailure='XR failed: '+e.name+': '+e.message;if(session)try{await session.end();}catch{}setEnvironment(false);sound.disable();resetContactAudio();status(lastFailure);}
  finally{entering=false;$('enter').disabled=lost||renderer.xr.isPresenting;}
};
renderer.xr.addEventListener('sessionend',()=>{
  physics.releaseAll();clearBeams();sound.disable();setEnvironment(false);rig.position.set(0,0,0);rig.rotation.set(0,0,0);camera.position.copy(desktopPosition);orbit.target.copy(anchor.position);orbit.enabled=true;orbit.update();$('enter').disabled=lost||!supported;status(lastFailure||'XR ended · desktop preview');
});
window.addEventListener('resize',()=>{if(renderer.xr.isPresenting)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let last=0,begin=0,frames=0;
await renderer.setAnimationLoop((time,frame)=>{
  if(lost)return;
  const dt=last?Math.min(.033,Math.max(0,(time-last)/1000)):0;last=time;if(!begin)begin=time;frames++;
  if(time-begin>=1000){$('fps').textContent=(frames*1000/(time-begin)).toFixed(1)+' callback FPS · '+N.toLocaleString()+' fragments';frames=0;begin=time;}
  try{
    if(renderer.xr.isPresenting){physics.pollGrips();updateXR(dt,frame);}else orbit.update();
    physics.update(dt);updateBeams();
    if(resetPending){renderer.compute(init);resetPending=false;clock.value=0;}
    if(!paused){dtNode.value=dt;clock.value+=dt;renderer.compute(update);}
    renderer.render(scene,camera);
    // Isolate audio failures from the render loop.
    try{updateSound(dt,frame);sampleContacts(time);}catch(e){sound.disable();$('audioStatus').textContent='Audio disabled: '+e.message;}
  }catch(e){lastFailure='Frame failed: '+e.name+': '+e.message;status(lastFailure);sound.disable();renderer.setAnimationLoop(null);$('enter').disabled=true;renderer.xr.getSession()?.end().catch(console.error);}
});
