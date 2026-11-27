import * as THREE from 'three';
import {SparkRenderer,SplatMesh,SparkControls} from '@sparkjsdev/spark';
const $=id=>document.getElementById(id);
const status=s=>{$('status').textContent=s;console.log('[Splat V1.1]',s);try{localStorage.setItem('splat-v1.1-status',s)}catch{}};
const URL='https://storage.googleapis.com/forge-dev-public/marble-scenes/greyscale-room.spz';
const PRESETS={
 safe:{count:80000,fb:.42,lodScale:3.2,minRadius:1.2,minAlpha:2/255,sortMs:65,sh:0,foveation:1},
 balanced:{count:150000,fb:.52,lodScale:2.2,minRadius:.8,minAlpha:1/255,sortMs:45,sh:0,foveation:1},
 detail:{count:250000,fb:.62,lodScale:1.5,minRadius:.5,minAlpha:.5/255,sortMs:30,sh:1,foveation:.7}
};
const requested=new URLSearchParams(location.search).get('quality');
$('quality').value=Object.hasOwn(PRESETS,requested)?requested:'safe';
const scene=new THREE.Scene(),rig=new THREE.Group(),anchor=new THREE.Group(),content=new THREE.Group();
scene.add(rig,anchor);anchor.add(content);
const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.025,120);rig.add(camera);
const renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,depth:true,stencil:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1));renderer.setSize(innerWidth,innerHeight);document.body.prepend(renderer.domElement);
renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');
renderer.setClearColor(0xaaffff,1);
const spark=new SparkRenderer({renderer,enableLod:true,enableDriveLod:true,preUpdate:false,sortRadial:true,maxStdDev:2,clipXY:1.1,coneFov0:90,coneFov:115,coneFoveate:.25,behindFoveate:.08,lodRaycast:0,lodSplatCount:80000,lodRenderScale:3.2,minPixelRadius:1.2,minSortIntervalMs:65});
scene.add(spark);
const controls=new SparkControls({canvas:renderer.domElement});
let room,physics=null,roomSize,roomCenter,loaded=false,lost=false,entering=false,mode=null,previous=0,lastError='';
const viewer=new THREE.Vector3(),right=new THREE.Vector3(),q=new THREE.Quaternion();
let snapReady=true;
function applyQuality(){
 const p=PRESETS[$('quality').value];spark.lodSplatCount=p.count;spark.lodRenderScale=p.lodScale;spark.minPixelRadius=p.minRadius;spark.minAlpha=p.minAlpha;spark.minSortIntervalMs=p.sortMs;spark.maxStdDev=$('quality').value==='detail'?Math.sqrt(5):2;
 if(room){room.maxSh=p.sh;room.updateGenerator();}
 renderer.xr.setFramebufferScaleFactor(p.fb);renderer.xr.setFoveation(p.foveation);
}
$('quality').onchange=()=>{if(!renderer.xr.isPresenting&&!entering)applyQuality()};
applyQuality();
function reset(){anchor.position.set(0,0,0);anchor.quaternion.identity();anchor.scale.setScalar(1);content.position.set(0,0,0);content.scale.setScalar(1);rig.position.set(0,0,0);rig.quaternion.identity();camera.position.set(0,0,0);camera.quaternion.identity();snapReady=true;}
function miniature(){const scale=1.5/Math.max(roomSize.x,roomSize.y,roomSize.z);content.scale.setScalar(scale);content.position.copy(roomCenter).multiplyScalar(-scale);anchor.position.set(0,-.15,-2.2);physics.attachModel(roomSize.clone().multiplyScalar(scale));}
function env(ar){scene.background=null;renderer.setClearColor(ar?0x000000:0xaaffff,ar?0:1);}
async function buttons(){for(const [id,type] of [['vr','immersive-vr'],['ar','immersive-ar']])$(id).disabled=!loaded||lost||entering||(id==='ar'&&!physics)||!(navigator.xr&&await navigator.xr.isSessionSupported(type).catch(()=>false));}
async function enter(type){
 if(entering||lost||!loaded||renderer.xr.isPresenting)return;entering=true;$('vr').disabled=$('ar').disabled=$('quality').disabled=true;let session;lastError='';
 try{session=await navigator.xr.requestSession(type,{requiredFeatures:['local']});if(type==='immersive-ar'&&session.environmentBlendMode!=='alpha-blend')throw Error('Passthrough unavailable');
 reset();controls.enabled=false;if(type==='immersive-ar')miniature();env(type==='immersive-ar');mode=type;await renderer.xr.setSession(session);renderer.xr.setFoveation(PRESETS[$('quality').value].foveation);status('XR started · '+$('quality').value+' quality');}
 catch(e){lastError='XR failed: '+e.message;status(lastError);if(session)await session.end().catch(()=>{});mode=null;reset();env(false);controls.enabled=true;}
 finally{entering=false;if(!renderer.xr.isPresenting){$('quality').disabled=false;await buttons()}}
}
$('vr').onclick=()=>enter('immersive-vr');$('ar').onclick=()=>enter('immersive-ar');
renderer.xr.addEventListener('sessionend',()=>{mode=null;physics?.releaseAll();reset();env(false);controls.enabled=true;$('quality').disabled=false;buttons();status(lastError||'Ready · choose quality and viewing mode');});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;status('Graphics context lost. Close tab and reload.');$('vr').disabled=$('ar').disabled=true;renderer.setAnimationLoop(null);renderer.xr.getSession()?.end().catch(()=>{});});
window.addEventListener('resize',()=>{if(renderer.xr.isPresenting)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function axes(g){const a=g?.axes||[],x=a.length>=4?a[2]:a[0],y=a.length>=4?a[3]:a[1];return [Math.abs(x||0)>.16?x:0,Math.abs(y||0)>.16?y:0];}
function input(dt,frame){
 if(mode!=='immersive-ar'||!physics)return;
 const space=renderer.xr.getReferenceSpace(),pose=space&&frame?.getViewerPose(space);if(!pose)return;
 const p=pose.transform.position,o=pose.transform.orientation;viewer.set(p.x,p.y,p.z);rig.localToWorld(viewer);q.set(o.x,o.y,o.z,o.w).premultiply(rig.quaternion);right.set(1,0,0).applyQuaternion(q);right.y=0;right.normalize();
 let l=[0,0],r=[0,0];for(const s of renderer.xr.getSession().inputSources){if(s.handedness==='left')l=axes(s.gamepad);if(s.handedness==='right')r=axes(s.gamepad);}
 physics.pollGrips();if(l[0])physics.adjustModelSide(l[0],dt,right);const y=Math.abs(l[1])>=Math.abs(r[1])?l[1]:r[1];if(y)physics.adjustModelDepth(y,dt,viewer);
 if(Math.abs(r[0])<.3)snapReady=true;if(snapReady&&Math.abs(r[0])>.7){snapReady=false;if(!physics.isHolding('right')){const rot=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.sign(r[0])*Math.PI/6);rig.position.sub(viewer).applyQuaternion(rot).add(viewer);rig.quaternion.premultiply(rot);}}
 physics.update(dt);
}
async function main(){
 status('Downloading original SPZ and building hierarchical level of detail…');
 room=new SplatMesh({url:URL,lod:true,nonLod:false,enableLod:true,editable:false,onProgress:e=>{if(e.total&&e.loaded<e.total)status('Downloading room: '+Math.round(100*e.loaded/e.total)+'%');else status('Preparing level of detail…')}});
 room.quaternion.set(1,0,0,0);
 await room.initialized;
 const hierarchy=room.packedSplats?.lodSplats;if(!hierarchy||!hierarchy.numSplats)throw Error('LOD hierarchy unavailable; refusing unrestricted full-resolution rendering.');
 // The loader drops the original base representation when nonLod is false.
 // Compute bounds directly from the retained hierarchy, not the empty base.
 const bounds=new THREE.Box3();hierarchy.forEachSplat((_i,center)=>bounds.expandByPoint(center));room.updateMatrix();bounds.applyMatrix4(room.matrix);
 roomSize=bounds.getSize(new THREE.Vector3());roomCenter=bounds.getCenter(new THREE.Vector3());if(bounds.isEmpty()||!Number.isFinite(roomSize.length())||roomSize.length()<=0)throw Error('Invalid room bounds');
 applyQuality();content.add(room);
 try{const {createGrabPhysics}=await import('../../shared/zelda-v13/physics-grab.js?v=template-1');physics=await createGrabPhysics({renderer,rig,modelAnchor:anchor,onStatus:status});}catch(e){console.warn('Passthrough grabs unavailable',e)}
 let frames=0,mark=0;renderer.setAnimationLoop((t,frame)=>{
  if(lost)return;const dt=previous?Math.min(.05,(t-previous)/1000):0;previous=t;
  try{if(renderer.xr.isPresenting)input(dt,frame);else controls.update(camera);
   renderer.render(scene,camera);frames++;if(!mark)mark=t;if(t-mark>=1000){const hz=Math.round(frames*1000/(t-mark));$('stats').textContent=hz+' render callbacks/s · '+spark.activeSplats.toLocaleString()+' active splats · '+PRESETS[$('quality').value].count.toLocaleString()+' target';try{localStorage.setItem('splat-v1.1-last-metrics',JSON.stringify({hz,active:spark.activeSplats,target:PRESETS[$('quality').value].count}))}catch{}frames=0;mark=t;}
  }catch(e){lastError='Render failed: '+e.message;status(lastError);renderer.setAnimationLoop(null);renderer.xr.getSession()?.end().catch(()=>{});}
 });
 loaded=true;await buttons();status('Ready · '+hierarchy.numSplats.toLocaleString()+' hierarchy splats · '+(physics?'VR and passthrough':'VR only; grip engine unavailable'));
}
main().catch(e=>status('Loading failed: '+e.message));
