import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const asset='painted_wooden_table',source='https://polyhaven.com/a/'+asset;
const WIDTH=2.0;
const RAW='https://raw.githubusercontent.com/mikkk111/vr/main/objects/human-ragdoll-v1-7/assets/table.glb';
async function loadGLB(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-cache'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const buffer=await response.arrayBuffer();
  if(new DataView(buffer).getUint32(0,true)!==0x46546c67)throw Error('Not a GLB');
  return await new GLTFLoader().parseAsync(buffer,new URL('.',new URL(url,location.href)).href);
}
function shrinkTextures(root){
  const done=new Set();root.traverse(o=>{if(!o.isMesh)return;for(const m of (Array.isArray(o.material)?o.material:[o.material]))for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']){
    const t=m?.[k];if(!t||done.has(t))continue;done.add(t);const im=t.image;if(!im||!im.width||!im.height||Math.max(im.width,im.height)<=1024)continue;
    const c=document.createElement('canvas'),ratio=1024/Math.max(im.width,im.height);c.width=Math.round(im.width*ratio);c.height=Math.round(im.height*ratio);c.getContext('2d').drawImage(im,0,0,c.width,c.height);t.image=c;t.needsUpdate=true;
  }});
}
function fallbackTable(){
  // Only used if both copies of the official GLB cannot be read.
  // Distinct solid planks and legs; procedural wood grain, not the CC0 scan.
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d');
  let seed=1729;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  ctx.fillStyle='#785034';ctx.fillRect(0,0,1024,512);
  for(let i=0;i<1800;i++){const y=rnd()*512,shade=30+Math.floor(rnd()*95);ctx.strokeStyle='rgba('+shade+','+Math.floor(shade*.70)+','+Math.floor(shade*.42)+','+(.07+rnd()*.18)+')';ctx.lineWidth=.4+rnd()*2;ctx.beginPath();ctx.moveTo(0,y);for(let x=32;x<=1024;x+=32)ctx.lineTo(x,y+Math.sin(x*.012+i)*(.6+rnd()*1.7));ctx.stroke();}
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.MeshStandardMaterial({map:tex,roughness:.82});
  const root=new THREE.Group(),parts=[];function add(center,half){const m=new THREE.Mesh(new THREE.BoxGeometry(...half.map(v=>v*2)),mat);m.position.set(...center);root.add(m);parts.push({center,half});}
  for(let i=0;i<5;i++)add([0,.735,-.32+i*.16],[1,.025,.0795]);
  for(const x of [-.84,.84])for(const z of [-.29,.29])add([x,.355,z],[.045,.355,.045]);
  for(const z of [-.29,.29])add([0,.65,z],[.84,.065,.025]);
  for(const x of [-.84,.84])add([x,.65,0],[.025,.065,.29]);
  // One uninterrupted contact surface, rather than five separate slabs.
  parts.splice(0,5,{center:[0,.735,0],half:[1,.025,.4]});
  return {root,parts,size:V(2,.76,.8),source:'procedural fallback',triangles:root.children.length*12,fallback:true};
}
export async function loadTable(){
  let gl,errors=[];
  for(const url of ['./assets/table.glb?v=171',RAW]){try{gl=await loadGLB(url);break;}catch(e){errors.push(e.message);}}
  if(!gl){const result=fallbackTable();result.warning=errors.join('; ');return result;}
  shrinkTextures(gl.scene);
  const root=new THREE.Group();root.add(gl.scene);root.updateMatrixWorld(true);
  let box=new THREE.Box3().setFromObject(root,true),size=box.getSize(V());
  if(!Number.isFinite(size.length())||size.y<.2||Math.max(size.x,size.z)<.5)throw Error('Invalid table dimensions');
  // Long dimension is X; preserve original aspect ratio and normalize source
  // units to the published 2.4 m width.
  if(size.z>size.x)gl.scene.rotation.y+=Math.PI/2;
  root.updateMatrixWorld(true);box.setFromObject(root,true);size=box.getSize(V());
  gl.scene.scale.multiplyScalar(WIDTH/size.x);root.updateMatrixWorld(true);box.setFromObject(root,true);const center=box.getCenter(V());
  gl.scene.position.sub(V(center.x,box.min.y,center.z));root.updateMatrixWorld(true);box.setFromObject(root,true);size=box.getSize(V());
  const points=[],triangles=[];const tmp=V(),weld=new Map();
  function vertex(p){const key=[p.x,p.y,p.z].map(x=>Math.round(x*1e5)).join(':');if(weld.has(key))return weld.get(key);const i=points.length;points.push(p.clone());weld.set(key,i);return i;}
  root.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position,idx=o.geometry.index;let ids=[];
    for(let i=0;i<a.count;i++)ids.push(vertex(tmp.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld)));
    const n=idx?idx.count:a.count;for(let i=0;i<n;i+=3)triangles.push([ids[idx?idx.getX(i):i],ids[idx?idx.getX(i+1):i+1],ids[idx?idx.getX(i+2):i+2]]);
  });
  if(points.length<20||triangles.length>100000)throw Error('Unexpected table geometry');
  const parent=points.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(const [a,b,c] of triangles){parent[find(a)]=find(b);parent[find(b)]=find(c);}
  const groups=new Map();points.forEach((v,i)=>{const k=find(i);if(!groups.has(k))groups.set(k,new THREE.Box3());groups.get(k).expandByPoint(v);});
  const parts=[];function add(b){const sz=b.getSize(V()),c=b.getCenter(V());if(sz.x<.006||sz.y<.006||sz.z<.006)return;parts.push({center:c.toArray(),half:sz.multiplyScalar(.5).toArray()});}
  const components=[...groups.values()],top=components.find(b=>b.max.y>box.max.y-.005&&b.getSize(V()).x>size.x*.75&&b.getSize(V()).z>size.z*.75&&b.getSize(V()).y<size.y*.24);
  // Separate mesh components where possible; otherwise fit a tabletop and
  // four leg columns from the actual vertices, never a solid table-sized box.
  if(top&&components.length>=5&&components.length<=40){components.forEach(add);}
  else{
    const levels=[...new Set(points.map(v=>Math.round(v.y*1000)/1000))].filter(y=>y<box.max.y-.008&&y>box.max.y-.16).sort((a,b)=>b-a);
    let underside=box.max.y-.06;
    for(const y of levels){const ring=points.filter(v=>Math.abs(v.y-y)<.003);if(ring.length<4)continue;const b=new THREE.Box3().setFromPoints(ring),s=b.getSize(V());if(s.x>size.x*.75&&s.z>size.z*.75){underside=y;break;}}
    add(new THREE.Box3(V(box.min.x,underside,box.min.z),V(box.max.x,box.max.y,box.max.z)));
    for(const sx of [-1,1])for(const sz of [-1,1]){
      const bottom=points.filter(v=>v.y<size.y*.28&&v.x*sx>0&&v.z*sz>0);
      if(bottom.length<3){const x=sx*size.x*.40,z=sz*size.z*.36;bottom.push(V(x-.045,0,z-.045),V(x+.045,0,z+.045));}
      const b=new THREE.Box3().setFromPoints(bottom);
      b.min.y=0;b.max.y=underside;
      // Include nearby upper leg vertices; omit horizontal stretchers/aprons.
      const c=b.getCenter(V()),s=b.getSize(V());
      for(const v of points)if(v.y<underside&&Math.abs(v.x-c.x)<Math.max(.045,s.x*.8)&&Math.abs(v.z-c.z)<Math.max(.045,s.z*.8)){b.min.x=Math.min(b.min.x,v.x);b.max.x=Math.max(b.max.x,v.x);b.min.z=Math.min(b.min.z,v.z);b.max.z=Math.max(b.max.z,v.z);}
      add(b);
    }
  }
  if(parts.length<5||parts.length>40)parts.length=0;
  const feet=parts.filter(b=>b.center[1]-b.half[1]<.015),topPart=parts.find(b=>b.center[1]+b.half[1]>=size.y-.005&&b.half[0]*2>=size.x*.75&&b.half[2]*2>=size.z*.75);
  if(feet.length<4||!topPart){
    // Keep the original visual asset even if welded components are unusual.
    // Fit a conservative top and four supports to measured dimensions.
    parts.length=0;const t=Math.min(.075,size.y*.12);
    parts.push({center:[0,size.y-t*.5,0],half:[size.x*.5,t*.5,size.z*.5]});
    for(const sx of [-1,1])for(const sz of [-1,1]){
      const candidates=points.filter(v=>v.y<size.y*.32&&v.x*sx>0&&v.z*sz>0);
      const b=candidates.length?new THREE.Box3().setFromPoints(candidates):null;
      const c=b?b.getCenter(V()):V(sx*size.x*.40,0,sz*size.z*.36),s=b?b.getSize(V()):V(.09,0,.09);
      parts.push({center:[c.x,(size.y-t)*.5,c.z],half:[Math.max(.025,s.x*.5),(size.y-t)*.5,Math.max(.025,s.z*.5)]});
    }
  }
  return {root,parts,size,source,triangles:triangles.length,fallback:false};
}
