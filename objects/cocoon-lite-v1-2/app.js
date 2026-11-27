import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createGrabPhysics} from '../../shared/zelda-v13/physics-grab.js?v=template-1';
import {BUDGET,radial,uv,rng,fetchGeometry} from './geometry.js?v=1.2';
const $=id=>document.getElementById(id),status=s=>{$('status').textContent=s;console.log('[Cocoon Lite]',s);try{localStorage.setItem('cocoon-lite-v1.2-stage',s)}catch{}};
const BASE='https://raw.githubusercontent.com/akella/codevember-2026/902fcb1f492dac4138d72aad16dd85af71ceeda4/20-cocoon/public/hero/';
let renderer,physics,lost=false,entering=false,lastFailure='',activeMode=null;
window.addEventListener('error',e=>status('Error: '+e.message));window.addEventListener('unhandledrejection',e=>status('Error: '+(e.reason?.message||e.reason)));
const W=1024,H=512,TAU=Math.PI*2;
function makeMaps(data){
 const rand=rng(120),canvas=document.createElement('canvas'),bump=document.createElement('canvas');
 canvas.width=bump.width=W;canvas.height=bump.height=H;
 const c=canvas.getContext('2d'),b=bump.getContext('2d'),im=c.createImageData(W,H),hm=b.createImageData(W,H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;const broad=3*Math.sin(x*.029+2*Math.sin(y*.019))+2*Math.sin(y*.071+x*.014),fine=(rand()-.5)*12,shade=broad+fine;im.data.set([Math.max(0,Math.min(255,207+shade)),195+shade,173+shade,255],i);const n=128+broad*2+fine*2;hm.data.set([n,n,n,255],i)}
 c.putImageData(im,0,0);b.putImageData(hm,0,0);c.lineCap=b.lineCap='round';
 function draw(ctx,p,stroke,width){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.beginPath();let last=null;
  for(let j=0;j<p.length;j+=3){const [u,v]=uv(p[j],p[j+1],p[j+2]);const x=u*W,y=v*H;if(last&&Math.abs(last[0]-x)<W/2)ctx.lineTo(x,y);else ctx.moveTo(x,y);last=[x,y]}
  ctx.stroke();
 }
 const n=data.head.kinds.wound.n;
 for(let j=0;j<9000;j++){const p=data.path('wound',Math.floor(j*n/9000));draw(c,p,j%3===0?'rgba(143,115,83,.12)':'rgba(255,246,225,.24)',j%4===0?.95:.55);draw(b,p,'rgba(220,220,220,.19)',.7)}
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=2;
 const bumpMap=new THREE.CanvasTexture(bump);bumpMap.anisotropy=2;return {map,bumpMap};
}
// Recover low-frequency shell relief from original down-fibre roots.
function makeShell(data){
 const U=96,V=48,grid=new Float32Array(U*(V+1)),weights=new Float32Array(grid.length),n=data.head.kinds.down.n;
 for(let j=0;j<18000;j++){
  const p=data.path('down',Math.floor(j*n/18000)),[u,v,len]=uv(...p.subarray(0,3));
  const x=p[0]/len,y=p[1]/len,z=p[2]/len;
  const d=Math.max(-.04,Math.min(.035,len-radial(data.shape,x,y,z)-.0008));
  const gx=u*U,gy=v*V,ix=Math.floor(gx),iy=Math.floor(gy);
  for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
   const row=Math.min(V,iy+dy),col=(ix+dx)%U,w=(dx?gx-ix:1-(gx-ix))*(dy?gy-iy:1-(gy-iy));
   const at=row*U+col;grid[at]+=w*d;weights[at]+=w;
  }
 }
 for(let i=0;i<grid.length;i++)grid[i]=weights[i]>.01?grid[i]/weights[i]:0;
 for(let pass=0;pass<2;pass++){const copy=grid.slice();for(let y=0;y<=V;y++)for(let x=0;x<U;x++){let v=0,w=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const iy=Math.min(V,Math.max(0,y+dy)),ix=(x+dx+U)%U,k=(dx===0&&dy===0)?4:1;v+=copy[iy*U+ix]*k;w+=k}grid[y*U+x]=v/w}}
 const pos=[],tex=[],idx=[];
 for(let v=0;v<=V;v++)for(let u=0;u<=U;u++){const theta=Math.PI*v/V,phi=TAU*u/U,x=Math.cos(theta),y=Math.sin(theta)*Math.cos(phi),z=Math.sin(theta)*Math.sin(phi),d=grid[v*U+(u%U)]-.0015,r=radial(data.shape,x,y,z)+d;pos.push(x*r,y*r,z*r);tex.push(u/U,1-v/V)}
 for(let v=0;v<V;v++)for(let u=0;u<U;u++){const a=v*(U+1)+u,b=a+1,c=a+U+1,d=c+1;if(v!==0)idx.push(a,c,b);if(v!==V-1)idx.push(b,c,d)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(tex,2));g.setIndex(idx);g.computeVertexNormals();g.computeBoundingSphere();return g;
}
function makeFibres(data){
 const positions=[],colors=[],rand=rng(741);
 const shades={wound:[.66,.55,.39],fuzz:[.87,.77,.59],down:[.80,.70,.52],floss:[.92,.82,.65]};
 let fibres=0;
 for(const [kind,[count,stride]] of Object.entries(BUDGET)){
  const n=data.head.kinds[kind].n;
  for(let i=0;i<count;i++){const p=data.path(kind,Math.floor(i*n/count));const s=shades[kind],varn=.78+.35*rand();fibres++;
   for(let j=0;j<p.length/3-1;){const k=Math.min(p.length/3-1,j+stride),a=j*3,b=k*3;
    positions.push(p[a],p[a+1],p[a+2],p[b],p[b+1],p[b+2]);
    const r=Math.hypot(p[a],p[a+1],p[a+2])||1,back=.78+.22*Math.abs(p[a+2]/r);
    for(let t=0;t<2;t++)colors.push(s[0]*varn*back,s[1]*varn*back,s[2]*varn*back);j=k;
   }
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeBoundingSphere();
 return {g,fibres,segments:positions.length/6};
}
function makeThread(){
 const random=rng(119),p=[];
 for(let i=0;i<34;i++){const a=random()*TAU,r=.012+.019*random(),x=.20*Math.cos(a),z=.20*Math.sin(a),y=.78+.13*random(),phase=random()*TAU;let prev=null;
  for(let j=0;j<=22;j++){const t=j/22,off=Math.sin(t*Math.PI)*.025;const v=[x*(1-t)**2+r*Math.cos(phase+t*9)*t+off*Math.sin(t*24+phase),y+t*1.45,z*(1-t)**2+r*Math.sin(phase+t*9)*t+off*Math.cos(t*17+phase)];if(prev)p.push(...prev,...v);prev=v}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));return g;
}
const scene=new THREE.Scene(),rig=new THREE.Group(),anchor=new THREE.Group(),object=new THREE.Group();
scene.add(rig,anchor);anchor.add(object);anchor.position.set(0,1.45,-1.45);object.scale.setScalar(.38);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.025,80);rig.add(camera);camera.position.set(0,1.55,1.4);
const shapeGroup=new THREE.Group();shapeGroup.rotation.z=Math.PI/2-.08;object.add(shapeGroup);
scene.add(new THREE.HemisphereLight(0xfff4e5,0x655744,1.35));
function light(color,power,x,y,z){const l=new THREE.DirectionalLight(color,power);l.position.set(x,y,z);scene.add(l)}
light(0xfff2e1,2.0,-3,4,2);light(0xffb765,1.65,2,1,-4);light(0xe4edff,1.2,-3,1,-3);
let shell,fur,threads,orbit;const near=new THREE.Vector3(),right=new THREE.Vector3(),orientation=new THREE.Quaternion();
function axes(g){const a=g?.axes||[],x=a.length>=4?a[2]:a[0],y=a.length>=4?a[3]:a[1];return [Math.abs(x||0)>.16?x:0,Math.abs(y||0)>.16?y:0]}
let glow=0,previous=0;
function updateXR(dt,frame){
 const space=renderer.xr.getReferenceSpace(),pose=frame&&space?frame.getViewerPose(space):null;if(!pose)return;
 const p=pose.transform.position,q=pose.transform.orientation;near.set(p.x,p.y,p.z);rig.localToWorld(near);orientation.set(q.x,q.y,q.z,q.w);right.set(1,0,0).applyQuaternion(orientation);right.y=0;right.normalize();
 let l=[0,0],r=[0,0],trigger=0;
 for(const s of renderer.xr.getSession().inputSources){if(!s.gamepad)continue;if(s.handedness==='left')l=axes(s.gamepad);if(s.handedness==='right')r=axes(s.gamepad);trigger=Math.max(trigger,s.gamepad.buttons?.[0]?.value||0)}
 physics.pollGrips();if(l[0])physics.adjustModelSide(l[0],dt,right);const y=Math.abs(l[1])>=Math.abs(r[1])?l[1]:r[1];if(y)physics.adjustModelDepth(y,dt,near);
 glow+=(trigger-glow)*Math.min(1,dt*9);shell.emissiveIntensity=.18+glow*.75;fur.color.setRGB(1,.94-glow*.14,.83-glow*.29);
}
function environment(ar){scene.background=ar?null:new THREE.Color(0x070605);renderer.setClearColor(ar?0x000000:0x070605,ar?0:1)}
async function buttons(){for(const [id,m] of [['ar','immersive-ar'],['vr','immersive-vr']])$(id).disabled=lost||!(navigator.xr&&await navigator.xr.isSessionSupported(m).catch(()=>false))}
async function enter(mode){
 if(entering||lost||renderer.xr.isPresenting)return;entering=true;$('ar').disabled=$('vr').disabled=true;let s;lastFailure='';
 try{status('Starting '+mode+' · WebGL 2…');s=await navigator.xr.requestSession(mode,{requiredFeatures:['local-floor']});if(mode==='immersive-ar'&&s.environmentBlendMode!=='alpha-blend')throw Error('Passthrough alpha blend unavailable');
 environment(mode==='immersive-ar');await renderer.xr.setSession(s);activeMode=mode;orbit.enabled=false;rig.position.set(0,0,0);camera.position.set(0,0,0);anchor.position.set(0,1.45,-1.45);anchor.quaternion.identity();physics.attachModel(new THREE.Vector3(.65,.88,.65));status('Cocoon ready · grab with either side grip');}
 catch(e){lastFailure='XR failed: '+e.message;status(lastFailure);if(s)await s.end().catch(()=>{});environment(false)}
 finally{entering=false;if(!renderer.xr.isPresenting)await buttons()}
}
async function main(){
 status('Initialising lightweight WebGL 2 renderer…');
 renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,depth:true,stencil:false,powerPreference:'high-performance'});
 renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.xr.setFramebufferScaleFactor(.72);
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 $('scene').appendChild(renderer.domElement);environment(false);
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;lastFailure='WebGL context lost — close this tab and reload';status(lastFailure);$('ar').disabled=$('vr').disabled=true;renderer.setAnimationLoop(null);renderer.xr.getSession()?.end().catch(()=>{})});
 orbit=new OrbitControls(camera,renderer.domElement);orbit.target.copy(anchor.position);orbit.enableDamping=true;orbit.update();
 const data=await fetchGeometry(BASE,status);status('Building original silk fibres and baked surface…');
 const maps=makeMaps(data),mesh=makeShell(data),hair=makeFibres(data);
 shell=new THREE.MeshStandardMaterial({...maps,bumpScale:.013,roughness:.91,metalness:0,emissive:0xffa54f,emissiveIntensity:.18});
 shapeGroup.add(new THREE.Mesh(mesh,shell));
 fur=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.48,depthTest:true,depthWrite:false,color:0xffefda});
 const lines=new THREE.LineSegments(hair.g,fur);lines.renderOrder=2;shapeGroup.add(lines);
 threads=new THREE.LineBasicMaterial({color:0xf5e6ce,transparent:true,opacity:.46,depthWrite:false});const threadMesh=new THREE.LineSegments(makeThread(),threads);threadMesh.renderOrder=3;object.add(threadMesh);
 $('detail').textContent=hair.fibres.toLocaleString()+' original fibres · '+hair.segments.toLocaleString()+' line segments · '+(mesh.index.count/3).toLocaleString()+' shell triangles';
 physics=await createGrabPhysics({renderer,rig,modelAnchor:anchor,onStatus:status});physics.attachModel(new THREE.Vector3(.65,.88,.65));
 renderer.compile(scene,camera);
 $('ar').onclick=()=>enter('immersive-ar');$('vr').onclick=()=>enter('immersive-vr');
 renderer.xr.addEventListener('sessionend',()=>{activeMode=null;physics.releaseAll();environment(false);rig.position.set(0,0,0);camera.position.set(0,1.55,1.4);orbit.target.copy(anchor.position);orbit.enabled=true;orbit.update();buttons();status(lastFailure||'Desktop preview · choose VR or passthrough')});
 window.addEventListener('resize',()=>{if(renderer.xr.isPresenting)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
 let count=0,report=0;renderer.setAnimationLoop((t,frame)=>{if(lost)return;const dt=previous?Math.min(.05,(t-previous)/1000):0;previous=t;try{if(renderer.xr.isPresenting)updateXR(dt,frame);else orbit.update();physics.update(dt);renderer.render(scene,camera);count++;if(!report)report=t;if(t-report>=1000){$('fps').textContent=Math.round(count*1000/(t-report))+' render callbacks/s';count=0;report=t}}catch(e){lastFailure='Render failed: '+e.message;status(lastFailure);renderer.setAnimationLoop(null);renderer.xr.getSession()?.end().catch(()=>{})}});
 await buttons();status('Ready · one cocoon, no neural compute or postprocessing');
}
main().catch(e=>status('Error: '+e.message));
