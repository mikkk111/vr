import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGrabPhysics } from '../../shared/zelda-v13/physics-grab.js?v=template-1';
import { createOrcIKPose } from './pose-ik.js?v=orc-ik-3';
import { OBJECT_CONFIG } from './config.js?v=orc-autoload-1';

const $ = (id) => document.getElementById(id);
const setStatus = (message) => { $('status').textContent = message; };
const stage = $('scene');
const scene = new THREE.Scene(); // Transparency is required for passthrough.
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x000000,0);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1,1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const rig = new THREE.Group();scene.add(rig);
const camera = new THREE.PerspectiveCamera(65,innerWidth/innerHeight,0.01,50000);
camera.position.set(0,1.65,2.65);rig.add(camera);
const controls = new OrbitControls(camera,renderer.domElement);
controls.target.set(0,0.75,-1.85);
controls.enableDamping = true;
controls.minDistance=.65;controls.maxDistance=50000;
controls.maxPolarAngle=Math.PI*.55;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff,0x859ba3,2));
const key=new THREE.DirectionalLight(0xfff5e6,2.1);
key.position.set(-2,4.7,2.5);
key.castShadow=true;
key.shadow.mapSize.set(1024,1024);
key.shadow.camera.left=-5;key.shadow.camera.right=5;
key.shadow.camera.top=5;key.shadow.camera.bottom=-5;
key.shadow.normalBias=.02;
scene.add(key);

// Model-independent anchor: no Zelda, mesh or other 3D object is bundled.
const modelAnchor=new THREE.Group();
modelAnchor.position.set(0,1,-2);
scene.add(modelAnchor);
let avatar=null,physics=null,modelSize=null,poseLayer=null,mixer=null,action=null,clips=[],playing=false;
let poseEnabled=true;
function setPlaying(v){
  playing=Boolean(v)&&Boolean(action);
  $('toggleAnimation').disabled=!action;
  $('toggleAnimation').textContent=playing?'Pause animation':'Play animation';
}
function selectedJoint({name,hinge,limits,values}){
  $('jointSelect').value=name;
  for(let i=0;i<3;i++){
    const row=$('jointRow'+i),input=$('angle'+i),label=$('angleLabel'+i);
    row.hidden=!limits[i];if(!limits[i])continue;
    input.min=limits[i][0];input.max=limits[i][1];input.value=values[i];
    $('angleValue'+i).textContent=Math.round(values[i])+'°';
    label.textContent=hinge?'Bend (hinge)':(['Pitch','Yaw','Roll'][i]);
  }
}
function showJointEditor(){
  const sel=$('jointSelect');sel.replaceChildren();
  $('jointEditor').hidden=!poseLayer;
  if(!poseLayer)return;
  for(const name of poseLayer.jointNames){
    const opt=document.createElement('option');opt.value=name;opt.textContent=name;sel.appendChild(opt);
  }
  const p=poseLayer.getSelected();selectedJoint(p);
}
const physicsReady=createGrabPhysics({renderer,rig,modelAnchor,onStatus:setStatus})
  .then(instance=>{
    physics=instance;
    if(modelSize)physics.attachModel(modelSize);
  })
  .catch(error=>{
    console.error('Physics initialisation failed',error);
    setStatus('Physics initialisation failed: '+error.message);
  });
const glbLoader=new GLTFLoader();
const objLoader=new OBJLoader();
const fbxLoader=new FBXLoader();
function installObject(root,label='Object') {
  if(!root || !root.isObject3D)throw new Error('The imported file has no Three.js scene.');
  // Compute from a detached root; do not inherit any previous anchor rotation.
  root.updateMatrixWorld(true);
  const raw=new THREE.Box3().setFromObject(root);
  if(raw.isEmpty())throw new Error('The imported object has no renderable geometry.');
  const rawSize=raw.getSize(new THREE.Vector3());
  const longest=Math.max(rawSize.x,rawSize.y,rawSize.z);
  if(!Number.isFinite(longest)||longest<1e-7)throw new Error('Invalid object bounds.');
  if(OBJECT_CONFIG.fitToView) {
    // Uniform scaling only; never stretch the object or change proportions.
    const target=Number(OBJECT_CONFIG.targetLongestSideMetres)||1.67;
    root.scale.multiplyScalar(target/longest);
    root.updateMatrixWorld(true);
  }
  const bounds=new THREE.Box3().setFromObject(root);
  const centre=bounds.getCenter(new THREE.Vector3());
  const dimensions=bounds.getSize(new THREE.Vector3());
  physics?.releaseAll();
  poseLayer?.dispose();poseLayer=null;
  if(mixer){mixer.stopAllAction();mixer.uncacheRoot(avatar);mixer=null;}
  action=null;clips=[];setPlaying(false);
  if(avatar)modelAnchor.remove(avatar);
  avatar=root;
  root.position.sub(centre);
  root.traverse(part=>{
    if(part.isMesh){part.castShadow=false;part.receiveShadow=false;}
  });
  modelAnchor.add(root);
  // Source bones are captured before the FBX animation mixer starts.
  try{
    poseLayer=createOrcIKPose({renderer,scene,root,camera,onStatus:setStatus,
      onSelection:selectedJoint});
    poseLayer.setDesktopDragging(d=>{controls.enabled=!d&&!renderer.xr.isPresenting;});
    poseLayer.setEnabled(poseEnabled);
    $('poseMode').disabled=false;$('resetPose').disabled=false;
  }catch(error){
    console.warn('FBX pose support unavailable',error);
    $('poseMode').disabled=true;$('resetPose').disabled=true;
  }
  showJointEditor();
  clips=Array.isArray(root.animations)?root.animations:[];
  if(clips.length){
    mixer=new THREE.AnimationMixer(root);
    const sel=$('animationClip');sel.replaceChildren();
    clips.forEach((clip,i)=>{
      const opt=document.createElement('option');opt.value=i;
      opt.textContent=clip.name||('Clip '+(i+1));sel.appendChild(opt);
    });
    action=mixer.clipAction(clips[0]);
    action.setLoop(THREE.LoopRepeat,Infinity).play();
    mixer.update(0);setPlaying(true);
    $('clipRow').hidden=clips.length<2;
  }else{
    $('clipRow').hidden=true;setPlaying(false);
  }
  modelAnchor.scale.setScalar(1);
  modelAnchor.rotation.set(0,Number(OBJECT_CONFIG.initialYawRadians)||0,0);
  modelAnchor.position.set(0,Math.max(0.4,Math.min(1.6,dimensions.y/2)),-2);
  modelSize=dimensions;
  if(physics)physics.attachModel(modelSize);
  setStatus(label+' loaded. '+(poseLayer?.boneCount||0)+' bones, '+(poseLayer?.ikTargetNames?.length||0)+' moveable IK targets, '+clips.length+' animation clip(s). Pull hand/foot/head joint markers to reposition the limbs while the idle animation CONTINUES.');
}
// Local and hosted FBX loading share the same loader. The published model is
// fetched straight from the repository, so the Pages asset deployment delay
// (or an unsupported HEAD response) cannot block the model.
const RAW_ORC_URL='https://raw.githubusercontent.com/mikkk111/vr/main/objects/orc-idle/assets/Orc%20Idle.fbx';
let loadSequence=0;
function loadObject(url,filename,{fallback=null,source='device'}={}) {
  const sequence=++loadSequence;
  const extension=(filename.split(/[?#]/)[0].split('.').pop()||'').toLowerCase();
  const revoke=url.startsWith('blob:');
  const release=()=>{if(revoke)URL.revokeObjectURL(url);};
  const done=loaded=>{
    if(sequence!==loadSequence){release();return;}
    try{
      installObject(loaded.scene||loaded,filename);
      setStatus(filename+' loaded from '+source+'. '+
        (poseLayer?.boneCount||0)+' bones; idle animation and joint controls ready.');
    }catch(error){
      console.error('FBX scene installation failed:',error);
      setStatus('FBX parsed, but scene setup failed: '+error.message);
    }finally{release();}
  };
  const failed=error=>{
    release();
    if(sequence!==loadSequence)return;
    const reason=error?.message||String(error);
    console.error('Model load failed ('+source+'):',url,error);
    if(fallback){
      setStatus('Could not load from '+source+' ('+reason+'). Trying the GitHub Pages copy…');
      loadObject(fallback,filename,{source:'GitHub Pages'});
    }else{
      setStatus('Could not load '+filename+' from '+source+': '+reason+
        '. Use the Upload FBX button above, or check the browser developer console.');
    }
  };
  const progress=event=>{
    if(sequence!==loadSequence)return;
    if(event.lengthComputable && event.total>0){
      const pct=Math.min(100,Math.round(100*event.loaded/event.total));
      setStatus('Downloading '+filename+' from '+source+': '+pct+'% ('+
        (event.loaded/1048576).toFixed(1)+' MB / '+(event.total/1048576).toFixed(1)+' MB).');
    }else if(event.loaded){
      setStatus('Downloading '+filename+' from '+source+': '+
        (event.loaded/1048576).toFixed(1)+' MB received…');
    }
  };
  setStatus('Connecting to '+source+' for '+filename+'…');
  if(extension==='glb'||extension==='gltf')glbLoader.load(url,done,progress,failed);
  else if(extension==='obj')objLoader.load(url,done,progress,failed);
  else if(extension==='fbx')fbxLoader.load(url,done,progress,failed);
  else failed(new Error('Unsupported model extension '+extension));
}
function loadHostedOrc() {
  // GitHub's raw-file host supports CORS and avoids any dependency on Pages
  // publishing the 31.8 MB FBX before the website can use it.
  loadObject(RAW_ORC_URL,'Orc Idle.fbx',{
    source:'GitHub repository',fallback:OBJECT_CONFIG.modelUrl
  });
}
if(typeof OBJECT_CONFIG.modelUrl==='string' && OBJECT_CONFIG.modelUrl.trim()){
  loadHostedOrc();
}else{
  setStatus('Orc editor ready. Use the Upload button to select Orc Idle.fbx.');
}
$('loadHosted').addEventListener('click',loadHostedOrc);
$('assetFile').addEventListener('change',event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['glb','obj','fbx'].includes(ext)){
    setStatus('Please choose a .glb, .obj or .fbx file.');
    return;
  }
  loadObject(URL.createObjectURL(file),file.name,{source:'your device'});
  event.target.value='';
});

$('toggleAnimation').addEventListener('click',()=>setPlaying(!playing));
$('animationClip').addEventListener('change',e=>{
  if(!mixer||!clips.length)return;
  action?.stop();action=mixer.clipAction(clips[Number(e.target.value)]);
  action.reset().setLoop(THREE.LoopRepeat,Infinity).play();setPlaying(true);
});
$('poseMode').addEventListener('click',()=>{
  poseEnabled=!poseEnabled;poseLayer?.setEnabled(poseEnabled);
  $('poseMode').textContent=poseEnabled?'Joint editing: ON':'Joint editing: OFF';
});
$('resetPose').addEventListener('click',()=>poseLayer?.resetPose());
$('jointSelect').addEventListener('change',e=>poseLayer?.selectName(e.target.value));
for(let i=0;i<3;i++)$('angle'+i).addEventListener('input',e=>poseLayer?.changeSelected(i,Number(e.target.value)));
$('showHandles').addEventListener('change',e=>poseLayer?.setShowMarkers(e.target.checked));

// No virtual floor, gravity, collision geometry, grid or stage.

// Controllers and their side-grip events are registered in physics-grab.js.
const keys = new Set();
window.addEventListener('keydown', e => {keys.add(e.code); if(e.code.startsWith('Arrow'))e.preventDefault();});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
const xrForward=new THREE.Vector3(),xrRight=new THREE.Vector3();
const xrHeadOrientation=new THREE.Quaternion(),xrRigOrientation=new THREE.Quaternion();
const xrLocalHead=new THREE.Vector3(),xrPivotBefore=new THREE.Vector3(),xrPivotAfter=new THREE.Vector3();
const xrViewerWorld=new THREE.Vector3();
const UP=new THREE.Vector3(0,1,0);
let snapTurnReady=true;
const HOME={x:0,z:0};
function activeStick(gamepad) {
  const axes=gamepad.axes||[];
  const pair=(x,y)=>Number.isFinite(axes[x])&&Number.isFinite(axes[y])?{x:axes[x],y:axes[y]}:null;
  const main=pair(2,3),fallback=pair(0,1);
  if(main&&(Math.abs(main.x)>.12||Math.abs(main.y)>.12)) return main;
  if(fallback&&(Math.abs(fallback.x)>.12||Math.abs(fallback.y)>.12))return fallback;
  return main||fallback||{x:0,y:0};
}
function snapTurn(direction, viewerPose){
  // Preserve physical head position when rotating the locomotion rig.
  const pos=viewerPose.transform.position;
  xrLocalHead.set(pos.x,pos.y,pos.z);
  rig.updateMatrixWorld(true);
  xrPivotBefore.copy(xrLocalHead);rig.localToWorld(xrPivotBefore);
  rig.rotation.y-=direction*THREE.MathUtils.degToRad(30);
  rig.updateMatrixWorld(true);
  xrPivotAfter.copy(xrLocalHead);rig.localToWorld(xrPivotAfter);
  rig.position.x+=xrPivotBefore.x-xrPivotAfter.x;
  rig.position.z+=xrPivotBefore.z-xrPivotAfter.z;
}
function updateXR(dt, frame){
  const session=renderer.xr.getSession();
  const space=renderer.xr.getReferenceSpace();
  const pose=frame&&space?frame.getViewerPose(space):null;
  if(!session||!pose)return;
  let left=null,right=null;
  for(const source of session.inputSources){
    if(!source.gamepad)continue;
    const stick=activeStick(source.gamepad);
    if(source.handedness==='left') left=stick;
    if(source.handedness==='right') right=stick;
  }
  // A held controller's stick rotates object, not the player.
  // When that grip is released, the usual locomotion/snap-turn controls resume.
  if(right && !physics?.isHolding('right')){
    if(Math.abs(right.x)<.30) snapTurnReady=true;
    if(snapTurnReady&&Math.abs(right.x)>.70){snapTurn(right.x>0?1:-1,pose);snapTurnReady=false;}
  } else if(right) {
    snapTurnReady=true; // Re-arm the view control while object is being held.
  }
  // Version 10: both vertical sticks still pull/push the CHARACTER, never
  // move the player. Left-stick X now translates the CHARACTER sideways too,
  // even during a left grip. The right-stick X logic above stays unchanged:
  // free = view snap-turn, right grip = object 30° yaw.
  const side=left && Math.abs(left.x)>.16?left.x:0;
  const leftDepth=left && Math.abs(left.y)>.16?left.y:0;
  const rightDepth=right && Math.abs(right.y)>.16?right.y:0;
  const modelDepth=Math.abs(rightDepth)>=Math.abs(leftDepth)?rightDepth:leftDepth;
  if(!physics || (!modelDepth&&!side))return;
  const eye=pose.transform.position;
  xrViewerWorld.set(eye.x,eye.y,eye.z);
  rig.updateMatrixWorld(true);
  rig.localToWorld(xrViewerWorld);
  if(modelDepth)physics.adjustModelDepth(modelDepth,dt,xrViewerWorld);
  if(side) {
    const o=pose.transform.orientation;
    xrHeadOrientation.set(o.x,o.y,o.z,o.w);
    rig.getWorldQuaternion(xrRigOrientation);
    xrHeadOrientation.premultiply(xrRigOrientation);
    xrRight.set(1,0,0).applyQuaternion(xrHeadOrientation);
    xrRight.y=0;
    if(xrRight.lengthSq()>1e-6) {
      xrRight.normalize();
      physics.adjustModelSide(side,dt,xrRight);
    }
  }
}
function updateDesktop(dt){
  const forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0);
  const strafe=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  const len=Math.hypot(forward,strafe);
  if(!len)return;
  const cameraForward=new THREE.Vector3();camera.getWorldDirection(cameraForward);cameraForward.y=0;cameraForward.normalize();
  const cameraRight=new THREE.Vector3().crossVectors(cameraForward,UP).normalize();
  const speed=(keys.has('ShiftLeft')?3:1.5)*dt/len;
  rig.position.addScaledVector(cameraForward,forward*speed);
  rig.position.addScaledVector(cameraRight,strafe*speed);
  controls.target.addScaledVector(cameraForward,forward*speed);
  controls.target.addScaledVector(cameraRight,strafe*speed);
}
function resetView(){
  rig.position.set(HOME.x,0,HOME.z);rig.rotation.y=0;snapTurnReady=true;
  if(!renderer.xr.isPresenting){camera.position.set(0,1.65,2.65);controls.target.set(0,.75,-1.85);controls.update();}
  physics?.reset();poseLayer?.resetPose();
  if(action){action.reset().play();mixer?.update(0);setPlaying(true);}
  setStatus('Orc reset. Animations continue normally; IK targets and joint offsets cleared.');
}
$('reset').addEventListener('click',resetView);

const enter=$('enterAR');
let arSupported=false;
if(!window.isSecureContext){enter.textContent='HTTPS REQUIRED';setStatus('Open the secure GitHub Pages URL, not a local file.');}
else if(!navigator.xr){enter.textContent='OPEN ON QUEST 3';setStatus('Desktop preview is available. Passthrough requires Meta Quest Browser with WebXR AR support.');}
else{
  navigator.xr.isSessionSupported('immersive-ar').then(supported=>{
    arSupported=supported;enter.disabled=!supported;
    enter.textContent=supported?'ENTER PASSTHROUGH':'PASSTHROUGH UNAVAILABLE';
    if(!supported)setStatus('This browser does not offer immersive-ar. Open the site in Meta Quest Browser and allow the required permissions.');
  }).catch(error=>{enter.textContent='PASSTHROUGH CHECK FAILED';setStatus(error.message);});
}
enter.addEventListener('click',async()=>{
  if(!arSupported)return;
  enter.disabled=true;
  try{
    const session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local-floor']});
    await renderer.xr.setSession(session);
    controls.enabled=false;
    camera.position.set(0,0,0); // Never reuse the desktop orbit offset in XR.
    enter.textContent='PASSTHROUGH ACTIVE';
    physics?.releaseAll();
    setStatus('Orc VR: squeeze SIDE GRIPS to move whole model, use TRIGGER to select green IK handles and move wrists/ankles/head in space. Idle animation continues.');
  }catch(error){console.error(error);enter.textContent='RETRY PASSTHROUGH';setStatus(`Could not start AR: ${error.name}: ${error.message}`);}
  finally{enter.disabled=false;}
});
renderer.xr.addEventListener('sessionend',()=>{
  controls.enabled=true;
  camera.position.set(0,1.65,2.65);
  controls.target.set(0,.75,-1.85); controls.update();
  enter.textContent='ENTER PASSTHROUGH';
  setStatus('Passthrough session ended. Desktop preview active.');
});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let previous=0;
renderer.setAnimationLoop((time,frame)=>{
  const dt=previous?Math.min(.05,(time-previous)/1000):0;
  previous=time;
  if(renderer.xr.isPresenting) {
    physics?.pollGrips(); // Resolve grip before routing thumbstick actions.
    updateXR(dt,frame);
  } else {updateDesktop(dt);controls.update();}
  physics?.update(dt);
  // Reestablish authored base rig (including unkeyed bones), sample the
  // running clip, then overlay bounded IK targets. Never pause for posing.
  poseLayer?.prepareFrame();
  if(mixer)mixer.update(playing?dt*Number($('animationSpeed').value):0);
  poseLayer?.update();
  renderer.render(scene,camera);
});