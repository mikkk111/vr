import * as THREE from 'three';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';
const $=id=>document.getElementById(id);
const status=msg=>{$('status').textContent=msg;console.log('[Cocoon]',msg);try{localStorage.setItem('cocoon-v1.1-stage',msg)}catch{}};
const error=e=>status('Error: '+(e?.message||e));
window.addEventListener('error',e=>error(e.error||e.message));window.addEventListener('unhandledrejection',e=>error(e.reason));
const BASE='https://raw.githubusercontent.com/akella/codevember-2026/902fcb1f492dac4138d72aad16dd85af71ceeda4/20-cocoon/';
const canvas=$('view'),wrap={};
const profiles={safe:{scale:.45,density:.12,relief:[512,256],detail:512,mesh:256,field:[128,64],glaze:128,split:1,renderCap:640,crisp:.15},balanced:{scale:.55,density:.28,relief:[768,384],detail:1024,mesh:256,field:[256,128],glaze:256,split:2,renderCap:900,crisp:.3},high:{scale:.65,density:.55,relief:[1536,768],detail:1024,mesh:512,field:[256,128],glaze:512,split:3,renderCap:1200,crisp:.5}};
const params=new URLSearchParams(location.search),selected=Object.hasOwn(profiles,params.get('quality'))?params.get('quality'):'safe',q=profiles[selected];
$('quality').value=selected;$('quality').onchange=()=>{params.set('quality',$('quality').value);location.search=params.toString()};
let gpuLost=false,gpuBusy=false,device=null,lastDesktop=0,entering=false,lastFailure='';
const runtime=globalThis.cocoonRuntime={assetBase:BASE+'public/hero/',current:null,start,profile:q,stage:status,watch,assertAlive:()=>{if(gpuLost)throw Error(lastFailure||'GPU device lost')}};
function watch(d){device=d;d.addEventListener('uncapturederror',e=>{lastFailure='GPU validation: '+e.error.message;status(lastFailure)});d.lost.then(i=>{gpuLost=true;lastFailure='GPU device lost: '+i.reason+' '+i.message;status(lastFailure+' — reload page; use Safe quality.');$('ar').disabled=$('vr').disabled=true;wrap.render=null;session?.end().catch(console.error)})}
function fence(){gpuBusy=true;device.queue.onSubmittedWorkDone().then(()=>{gpuBusy=false},e=>{gpuBusy=false;error(e)})}
function stabilityHero(s){
 const r=(a,b)=>{if(!s.includes(a))throw Error("Stability hero patch mismatch: "+a.slice(0,100));s=s.replace(a,b)};
 r('const SAMPLES = 4;','const SAMPLES = 1;');
 r('const GLOWS = 6;','const GLOWS = 2;');
 r('const [FIELD_W, FIELD_H] = [512, 256];','const [FIELD_W, FIELD_H] = globalThis.cocoonRuntime.profile.field;');
 r('const FINE = 1024;','const FINE = globalThis.cocoonRuntime.profile.glaze;');
 r('const device = await adapter.requestDevice({ requiredFeatures: (["timestamp-query", "shader-f16"] as const).filter((f) => adapter.features.has(f)) });','const device = await adapter.requestDevice({ requiredFeatures: (["shader-f16"] as const).filter((f) => adapter.features.has(f)) });\n  globalThis.cocoonRuntime.watch(device);');
 r('const timed = adapter.features.has("timestamp-query");','const timed = false;');
 r('  const { head } = cocoon;','  const { head } = cocoon;\n  head.detail.u = globalThis.cocoonRuntime.profile.detail;\n  head.detail.v = head.detail.u / 2;\n  head.relief.u = globalThis.cocoonRuntime.profile.mesh;\n  head.relief.v = head.relief.u / 2;');
 r('const { relief, view: detail } = makeRelief(device, head as unknown as Head, undefined, finer);','globalThis.cocoonRuntime.stage("Generating silk relief in bounded GPU passes…");\n  const { relief, view: detail } = await makeRelief(device, head as unknown as Head, undefined, finer);\n  globalThis.cocoonRuntime.stage("Compiling original neural light shaders…");');
 r('  const finalPipe = screenPipe("final_", format);','  let finalPipe = screenPipe("final_", format);\n  let outputFormat = format;');
 r('const views = [globalThis.cocoonRuntime.current ? sharp : flat, ...glows].map((t) => t.createView());','const views = [sharp, ...glows].map((t) => t.createView());');
 r('const color = device.createTexture({ size: [w, h], format: HDR, sampleCount: SAMPLES, usage: transient });','const color = device.createTexture({ size: [w, h], format: HDR, usage: RENDER_ATTACHMENT });');
 r('const deep = device.createTexture({ size: [w, h], format: "depth24plus", sampleCount: SAMPLES, usage: transient });','const deep = device.createTexture({ size: [w, h], format: "depth24plus", usage: RENDER_ATTACHMENT });');
 r('const soft = device.createTexture({ size: [w, h], format: SOFT, sampleCount: SAMPLES, usage: transient });','const soft = device.createTexture({ size: [w, h], format: SOFT, usage: RENDER_ATTACHMENT });');
 r('    if (!targets || targets.w !== w || targets.h !== h || targetXR !== !!xr) {','    const desiredFormat = xr?.format ?? format;\n    const formatChanged = desiredFormat !== outputFormat;\n    if (formatChanged) { outputFormat = desiredFormat; finalPipe = screenPipe("final_", outputFormat); }\n    if (!targets || targets.w !== w || targets.h !== h || targetXR !== !!xr || formatChanged) {');
 r('const [w, h] = xr ? [xr.width, xr.height] : [canvas.width, canvas.height];','const [w, h] = xr ? [xr.renderW, xr.renderH] : [canvas.width, canvas.height];');
 r('const aperture = xr ? 0 : look.lens;','const aperture = 0;');
 r('const density = xr && k.name !== "thread" && k.name !== "floss" ? xr.density : 1;','const density = k.name !== "thread" ? globalThis.cocoonRuntime.profile.density : 1;');
 r('const effectivePart = Math.min(1, part * density);','const effectivePart = Math.min(1, part * density);');
 r('Math.max(1, Math.min(6, Math.round((k.step * pixels)','Math.max(1, Math.min(globalThis.cocoonRuntime.profile.split, Math.round((k.step * pixels)');
 r('view: targets.color, resolveTarget: targets.sharp, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, xr ? 0 : 1]','view: targets.sharp, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, xr ? 0 : 1]');
 r('view: targets.soft, resolveTarget: targets.blurs, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0]','view: targets.blurs, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0]');
 r('if (!xr) for (const l of targets.lens) quad(l.view, l.pipe, l.group, false, l.pipe === gatherPipe ? stamp(2) : undefined);','// No synthetic lens blur or gather pass in the stability build.');
 r('loadOp: keep ? "load" : "clear"','loadOp: keep || (xr && pipe === finalPipe) ? "load" : "clear"');
 r('look.crisp, look.exposure','globalThis.cocoonRuntime.profile.crisp, look.exposure');
 r('look.bloom, look.spread, 0, 0, 1, 1, 1, xr?.ar ? 1 : 0]','look.bloom, look.spread, 0, 0, 1, 1, 1, xr?.ar ? 1 : 0]');
 return s;
}
function stabilityRelief(s){
 const r=(a,b)=>{if(!s.includes(a))throw Error("Relief patch mismatch: "+a);s=s.replace(a,b)};
 r('export const makeRelief = (','export const makeRelief = async (');
 r('const [NU, NV] = finer ? [3072, 1536] : [1536, 768];','const [NU, NV] = globalThis.cocoonRuntime.profile.relief;');
 r('const module = device.createShaderModule({ code: finer ? finer(code) : code });','const sigma = 22 * NU / 3072;\n  const taps = Math.max(2,Math.round(sigma * 3));\n  const text = (finer ? finer(code) : code).replace(/const NU = \\d+u;/, `const NU = ${NU}u;`).replace(/const NV = \\d+u;/, `const NV = ${NV}u;`).replace(/const SIGMA = [\\d.]+;/, `const SIGMA = ${sigma.toFixed(4)};`).replace(/var k = -\\d+; k <= \\d+;/g, `var k = -${taps}; k <= ${taps};`);\n  const module = device.createShaderModule({ code: text });\n  const info = await module.getCompilationInfo();\n  const errors = info.messages.filter(m=>m.type==="error");\n  if(errors.length)throw new Error(errors.map(m=>m.message).join("; "));');
 r('const encoder = device.createCommandEncoder();\n  const run = (','const run = async (');
 r('    const pass = encoder.beginComputePass();','    const encoder = device.createCommandEncoder();\n    const pass = encoder.beginComputePass();');
 r('    pass.end();\n  };','    pass.end();\n    device.queue.submit([encoder.finish()]);\n    await device.queue.onSubmittedWorkDone();\n    globalThis.cocoonRuntime.assertAlive();\n  };');
 r('head.made!.forEach((m, n) => {','for (const [n,m] of head.made!.entries()) {');
 r('    run(crinkle,','    await run(crinkle,');
 r('    run(blurRound,','    await run(blurRound,');
 r('    run(blurAlong,','    await run(blurAlong,');
 r('    run(detail,','    await run(detail,');
 r('    run(mesh,','    await run(mesh,');
 r('  });\n  for (let l = 1; l < LEVELS; l++) run(half,','  }\n  for (let l = 1; l < LEVELS; l++) await run(half,');
 r('  device.queue.submit([encoder.finish()]);\n  device.queue.onSubmittedWorkDone().then(() => field.destroy());','  field.destroy();');
 return s;
}
function patchHero(s){
  function replace(a,b){if(!s.includes(a))throw Error("Upstream patch mismatch: "+a.slice(0,95));s=s.replace(a,b);}
  replace('import { ssam } from "ssam";','');
  replace('const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });','const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance", xrCompatible: typeof globalThis.XRGPUBinding !== "undefined" });');
  replace('    return;\n  }\n  const timed','    throw new Error("No WebGPU adapter available");\n  }\n  const timed');
  replace('const cocoon = await load(`./${new URLSearchParams(location.search).get("data") ?? "hero"}/`);','const cocoon = await load(globalThis.cocoonRuntime.assetBase);');
  replace('  let targets: Targets | undefined;','  let targets: Targets | undefined;\n  let targetXR = false;');
  replace('const views = [flat, ...glows].map((t) => t.createView());','const views = [globalThis.cocoonRuntime.current ? sharp : flat, ...glows].map((t) => t.createView());');
  replace('    if (state.hold === undefined && !due()) return;','    const xr = globalThis.cocoonRuntime.current;\n    if (!xr && state.hold === undefined && !due()) return;');
  replace('    controls.update();\n    stats.update();\n    const [w, h] = [canvas.width, canvas.height];','    if (!xr) controls.update();\n    stats.update();\n    const [w, h] = xr ? [xr.width, xr.height] : [canvas.width, canvas.height];');
  replace('if (!targets || targets.w !== w || targets.h !== h) {','if (!targets || targets.w !== w || targets.h !== h || targetXR !== !!xr) {\n      targetXR = !!xr;');
  replace('    camera.updateMatrixWorld();\n    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);\n    const far = camera.position.distanceTo(controls.target);\n    const pixels = h / 2 / Math.tan((head.fov * Math.PI) / 360);','    camera.updateMatrixWorld();\n    if (xr) viewProj.fromArray(xr.matrix); else viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);\n    const eye = xr ? xr.eye : camera.position.toArray();\n    const far = xr ? Math.max(0.2, Math.hypot(...eye)) : camera.position.distanceTo(controls.target);\n    const pixels = xr ? h * 0.5 * xr.projY : h / 2 / Math.tan((head.fov * Math.PI) / 360);\n    const aperture = xr ? 0 : look.lens;');
  replace('frameData.set([...camera.position.toArray(), 1], 16);','frameData.set([...eye, 1], 16);');
  replace('const within = look.lens *','const within = aperture *');
  replace('frameData.set([t * Math.PI * 2, look.lens *','frameData.set([t * Math.PI * 2, aperture *');
  replace('    const eye = camera.position.toArray() as [number, number, number];','');
  replace('      k.now.n = Math.ceil(k.n * part);','      const density = xr && k.name !== "thread" && k.name !== "floss" ? xr.density : 1;\n      const effectivePart = Math.min(1, part * density);\n      k.now.n = Math.max(1, Math.ceil(k.n * effectivePart));');
  replace('k.name === "thread" ? look.web : 1 / part','k.name === "thread" ? look.web : 1 / effectivePart');
  replace('look.bloom, look.spread, 0, 0, 1, 1, 1, 1]','look.bloom, look.spread, 0, 0, 1, 1, 1, xr?.ar ? 1 : 0]');
  replace('const turns = !look.turns || exact || state.frame < 2 ? [0, 1] : [state.frame & 1];','const turns = xr || !look.turns || exact || state.frame < 2 ? [0, 1] : [state.frame & 1];');
  replace('view: targets.color, resolveTarget: targets.sharp, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 1]','view: targets.color, resolveTarget: targets.sharp, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, xr ? 0 : 1]');
  replace('const screen = context.getCurrentTexture().createView();','const screen = xr ? xr.screen : context.getCurrentTexture().createView();');
  replace('for (const l of targets.lens) quad','if (!xr) for (const l of targets.lens) quad');
  replace('      p.setPipeline(pipe);\n      p.setBindGroup(0, g);','      p.setPipeline(pipe);\n      if (xr && pipe === finalPipe) { p.setViewport(xr.x, xr.y, xr.width, xr.height, 0, 1); p.setScissorRect(xr.x, xr.y, xr.width, xr.height); }\n      p.setBindGroup(0, g);');
  replace('ssam(sketch, settings);','await globalThis.cocoonRuntime.start(sketch);');
  return s;
}
function patchPost(s){
  const a='  var c = textureSampleLevel(src, smp, o.uv, 0.0).rgb;';
  const b='  return vec4f(c, 1.0);\n}';
  if(!s.includes(a)||!s.includes(b))throw Error("Post shader patch mismatch");
  return s.replace(a,'  let srcColor = textureSampleLevel(src, smp, o.uv, 0.0);\n  let ar = post.tint.w > 0.5;\n  let coverage = select(1.0, clamp(srcColor.a, 0.0, 1.0), ar);\n  var c = srcColor.rgb / max(coverage, 0.001);').replace(b,'  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)) * coverage, coverage);\n}');
}
const cache=new Map();
async function fetchText(url){const r=await fetch(url);if(!r.ok)throw Error(r.status+' '+url);return r.text()}
function resolve(parent,spec){const u=new URL(spec,parent);if(u.search==='?raw')return u.href;if(!/\.[a-z]+$/i.test(u.pathname))u.pathname+='.ts';return u.href}
function load(url){if(cache.has(url))return cache.get(url);const promise=(async()=>{
 let src=await fetchText(url.replace(/\?raw$/,''));
 if(url.endsWith('?raw')){if(url.endsWith('/post.wgsl?raw'))src=patchPost(src);return URL.createObjectURL(new Blob(['export default '+JSON.stringify(src)+';'],{type:'text/javascript'}));}
 if(url.endsWith('/hero/index.ts'))src=stabilityHero(patchHero(src));
 if(url.endsWith('/relief.ts'))src=stabilityRelief(src);
 const out=globalThis.ts.transpileModule(src,{compilerOptions:{target:globalThis.ts.ScriptTarget.ES2022,module:globalThis.ts.ModuleKind.ESNext,removeComments:false},reportDiagnostics:true,fileName:url.split('/').at(-1)});
 const issues=out.diagnostics?.filter(d=>d.category===globalThis.ts.DiagnosticCategory.Error)||[];
 if(issues.length)throw Error('TypeScript '+url+': '+globalThis.ts.flattenDiagnosticMessageText(issues[0].messageText,' '));
 let js=out.outputText;
 const re=/\b(?:from\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g;
 const specs=[...new Set([...js.matchAll(re)].map(m=>m[1]))];
 const mapped=new Map(await Promise.all(specs.map(async s=>[s,await load(resolve(url,s))])));
 js=js.replace(re,(full,s)=>full.replace(s,mapped.get(s)));
 return URL.createObjectURL(new Blob([js,'\n//# sourceURL='+url],{type:'text/javascript'}));
 })();cache.set(url,promise);return promise}
const rig=new THREE.Group(),anchor=new THREE.Group();anchor.position.set(0,1.4,-1.45);
const controllers=[new THREE.Group(),new THREE.Group()],grips=[new THREE.Group(),new THREE.Group()],sources=[null,null];
const xrEvents=new THREE.EventDispatcher();
const bridge={xr:Object.assign(xrEvents,{isPresenting:false,getController:i=>controllers[i],getControllerGrip:i=>grips[i]})};
let physics,session=null,reference=null,mode=null,previous=0,snapReady=true,clockStart=performance.now(),paused=false,hold=0,frameCount=0,frameTime=0;
const MODEL_SCALE=.42,baseScale=new THREE.Matrix4().makeScale(MODEL_SCALE,MODEL_SCALE,MODEL_SCALE);
function animation(now){return paused?hold:((now-clockStart)/1000/(window.__cocoon?.DURATION||32))%1}
function resize(){if(session)return;const ratio=Math.min(1,q.renderCap/Math.max(innerWidth,innerHeight));canvas.width=Math.max(32,Math.round(innerWidth*ratio));canvas.height=Math.max(32,Math.round(innerHeight*ratio));wrap.resize?.({width:canvas.width,height:canvas.height});}
function desktop(now){requestAnimationFrame(desktop);if(session||entering||gpuBusy||gpuLost||!wrap.render||now-lastDesktop<80)return;lastDesktop=now;try{runtime.current=null;wrap.render({playhead:animation(now)});fence();}catch(e){error(e);wrap.render=null}}
function syncSources(frame){
 const current=Array.from(session.inputSources).filter(s=>s.gripSpace&&s.gamepad);
 for(let i=0;i<2;i++){if(sources[i]&&!current.includes(sources[i])){controllers[i].dispatchEvent({type:'disconnected',data:sources[i]});sources[i]=null}}
 for(const s of current){if(sources.includes(s))continue;const i=sources.indexOf(null);if(i<0)continue;sources[i]=s;controllers[i].dispatchEvent({type:'connected',data:s})}
 for(let i=0;i<2;i++){const s=sources[i];if(!s)continue;for(const [group,space] of [[controllers[i],s.targetRaySpace],[grips[i],s.gripSpace]]){const p=frame.getPose(space,reference);if(p){group.matrix.fromArray(p.transform.matrix);group.matrix.decompose(group.position,group.quaternion,group.scale);group.updateMatrixWorld(true)}}}
}
function stick(g){const a=g?.axes||[];const x=a.length>=4?a[2]:a[0],y=a.length>=4?a[3]:a[1];return [Math.abs(x||0)>.15?x:0,Math.abs(y||0)>.15?y:0]}
function updateControls(pose,dt){
 rig.updateMatrixWorld(true);
 const head=new THREE.Matrix4().multiplyMatrices(rig.matrixWorld,new THREE.Matrix4().fromArray(pose.transform.matrix));
 const viewer=new THREE.Vector3().setFromMatrixPosition(head);
 const viewRight=new THREE.Vector3(1,0,0).transformDirection(head);viewRight.y=0;viewRight.normalize();
 const left=sources.find(s=>s?.handedness==='left'),right=sources.find(s=>s?.handedness==='right');
 const l=stick(left?.gamepad),r=stick(right?.gamepad);
 physics.pollGrips();
 if(l[0])physics.adjustModelSide(l[0],dt,viewRight);
 const y=Math.abs(l[1])>Math.abs(r[1])?l[1]:r[1];
 if(y)physics.adjustModelDepth(y,dt,viewer);
 if(Math.abs(r[0])<.3)snapReady=true;
 if(snapReady&&Math.abs(r[0])>.7&&!physics.isHolding('right')){snapReady=false;const before=viewer.clone();rig.rotation.y-=Math.sign(r[0])*Math.PI/6;rig.updateMatrixWorld(true);const after=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(rig.matrixWorld,new THREE.Matrix4().fromArray(pose.transform.matrix)));rig.position.add(before.sub(after));rig.updateMatrixWorld(true);}
 physics.update(dt);
 const trigger=Math.max(0,...sources.map(s=>s?.gamepad?.buttons?.[0]?.value||0));
 window.__cocoon.look.inside=.62+trigger*2.5;
}
async function enter(which){
 if(session||entering||gpuLost)return;
 entering=true;
 const api=window.__cocoon;let pending=null;
 try{
  $('ar').disabled=$('vr').disabled=true;status('Requesting '+which+' with native WebGPU…');
  pending=await navigator.xr.requestSession(which,{requiredFeatures:['local-floor','webgpu']});
  if(which==='immersive-ar'&&pending.environmentBlendMode!=='alpha-blend')throw Error('Passthrough alpha blend not granted');
  reference=await pending.requestReferenceSpace('local-floor');
  const binding=new XRGPUBinding(pending,api.device);
  const format=binding.getPreferredColorFormat?.()||navigator.gpu.getPreferredCanvasFormat();
  const layer=binding.createProjectionLayer({colorFormat:format,scaleFactor:q.scale});
  pending.updateRenderState({layers:[layer],depthNear:.025,depthFar:80});
  session=pending;entering=false;mode=which;bridge.xr.isPresenting=true;previous=0;frameCount=0;frameTime=0;rig.position.set(0,0,0);rig.rotation.set(0,0,0);physics.releaseAll();
  let first=true;
  session.addEventListener('end',()=>{bridge.xr.isPresenting=false;for(let i=0;i<2;i++){if(sources[i])controllers[i].dispatchEvent({type:'disconnected',data:sources[i]});sources[i]=null;}bridge.xr.dispatchEvent({type:'sessionend'});session=null;runtime.current=null;resize();enableButtons();status(lastFailure||'Session ended · desktop preview');},{once:true});
  const loop=(now,frame)=>{
   if(!session||gpuLost)return;session.requestAnimationFrame(loop);
   if(gpuBusy)return;
   try{
    const pose=frame.getViewerPose(reference);if(!pose)return;
    const dt=previous?Math.min(.04,(now-previous)/1000):0;previous=now;
    if(first){const m=new THREE.Matrix4().fromArray(pose.transform.matrix);const p=new THREE.Vector3().setFromMatrixPosition(m);const f=new THREE.Vector3(0,0,-1).transformDirection(m);anchor.position.copy(p).addScaledVector(f,1.35);anchor.quaternion.identity();anchor.scale.setScalar(1);physics.attachModel(new THREE.Vector3(.65,1.0,.65));first=false;}
    syncSources(frame);updateControls(pose,dt);rig.updateMatrixWorld(true);anchor.updateMatrixWorld(true);
    const model=new THREE.Matrix4().multiplyMatrices(anchor.matrixWorld,baseScale),invModel=model.clone().invert(),scale=MODEL_SCALE*anchor.scale.x,t=animation(now);
    for(const view of pose.views){
      const sub=binding.getViewSubImage(layer,view),vp=sub.viewport;
      const eyeWorld=new THREE.Matrix4().multiplyMatrices(rig.matrixWorld,new THREE.Matrix4().fromArray(view.transform.matrix));
      const eye=new THREE.Vector3().setFromMatrixPosition(eyeWorld).applyMatrix4(invModel);
      const projection=new THREE.Matrix4().fromArray(view.projectionMatrix);
      const matrix=projection.clone().multiply(eyeWorld.clone().invert()).multiply(model).multiplyScalar(1/scale);
      if(typeof sub.getViewDescriptor!=='function')throw Error('XR subimage view descriptor unavailable');
      const desc=sub.getViewDescriptor();
      const ratio=Math.min(1,q.renderCap/Math.max(vp.width,vp.height));
      runtime.current={matrix:matrix.elements,eye:eye.toArray(),projY:Math.abs(view.projectionMatrix[5]),screen:sub.colorTexture.createView(desc),format:sub.colorTexture.format||format,x:vp.x,y:vp.y,width:vp.width,height:vp.height,renderW:Math.max(32,Math.round(vp.width*ratio)),renderH:Math.max(32,Math.round(vp.height*ratio)),ar:which==='immersive-ar'};
      wrap.render({playhead:t});
    }
    runtime.current=null;fence();
    frameCount++;if(now-frameTime>1000){status((which==='immersive-ar'?'Passthrough':'Dark VR')+' · '+$('quality').value+' · '+Math.round(frameCount*1000/Math.max(1,now-frameTime))+' XR callback fps');frameCount=0;frameTime=now;}
   }catch(e){runtime.current=null;lastFailure=e?.message||String(e);error(e);session?.end().catch(console.error);}
  };
  session.requestAnimationFrame(loop);status('Native WebGPU stereo session started');
 }catch(e){lastFailure=e?.message||String(e);error(e);if(pending)await pending.end().catch(()=>{});session=null;runtime.current=null;enableButtons()}finally{entering=false}
}
async function enableButtons(){for(const [id,m] of [['ar','immersive-ar'],['vr','immersive-vr']]){$(id).disabled=gpuLost||!(navigator.xr&&typeof XRGPUBinding!=='undefined'&&await navigator.xr.isSessionSupported(m).catch(()=>false))}}
async function start(sketch){
 resize();status('Decoding original 87,260 silk fibres and training weights; compiling GPU shaders…');
 await sketch({wrap,canvas,width:canvas.width,height:canvas.height});
 if(!window.__cocoon||!wrap.render)throw Error('Original renderer did not initialise');
 const api=window.__cocoon;
 runtime.assertAlive();
 physics=await createGrabPhysics({renderer:bridge,rig,modelAnchor:anchor,onStatus:status});physics.attachModel(new THREE.Vector3(.65,1,.65));
 $('ar').onclick=()=>enter('immersive-ar');$('vr').onclick=()=>enter('immersive-vr');
 $('freeze').disabled=$('reset').disabled=false;
 $('freeze').onclick=()=>{if(!paused){hold=animation(performance.now());paused=true;$('freeze').textContent='Resume animation'}else{clockStart=performance.now()-hold*api.DURATION*1000;paused=false;$('freeze').textContent='Freeze animation'}};
 $('reset').onclick=()=>{physics.reset();api.home()};
 window.addEventListener('resize',resize);requestAnimationFrame(desktop);await enableButtons();
 status('Original neural renderer loaded · choose VR or passthrough');
}
try{if(!globalThis.ts)throw Error('TypeScript compiler failed to load');if(!navigator.gpu)throw Error('WebGPU unavailable');status('Loading pinned upstream renderer…');await import(await load(BASE+'src/hero/index.ts'));}catch(e){error(e)}
