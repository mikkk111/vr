import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const asset='painted_wooden_table',source='https://polyhaven.com/a/'+asset;
export async function loadTable(){
  let gl;
  try{gl=await new GLTFLoader().loadAsync('./assets/table.glb');}
  catch(localError){
    // Official source metadata supplies every dependency, including textures.
    const response=await fetch('https://api.polyhaven.com/files/'+asset);
    if(!response.ok)throw Error('Table asset unavailable: '+response.status);
    const data=await response.json(),entry=data.gltf?.['2k']?.gltf;
    if(!entry?.url)throw Error('2K table glTF unavailable');
    const manager=new THREE.LoadingManager(),base=new URL('.',entry.url),urls=new Map();
    for(const [key,value] of Object.entries(entry.include||{}))urls.set(new URL(key,base).href,value.url);
    manager.setURLModifier(url=>urls.get(url)||url);
    gl=await new GLTFLoader(manager).loadAsync(entry.url);
  }
  const root=new THREE.Group();root.add(gl.scene);root.updateMatrixWorld(true);
  let box=new THREE.Box3().setFromObject(root,true),size=box.getSize(V());
  if(!Number.isFinite(size.length())||size.y<.2||Math.max(size.x,size.z)<.5)throw Error('Invalid table dimensions');
  // Long dimension is X; preserve original aspect ratio and normalize source
  // units to the published 2.4 m width.
  if(size.z>size.x)gl.scene.rotation.y+=Math.PI/2;
  root.updateMatrixWorld(true);box.setFromObject(root,true);size=box.getSize(V());
  gl.scene.scale.multiplyScalar(2.4/size.x);root.updateMatrixWorld(true);box.setFromObject(root,true);const center=box.getCenter(V());
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
      if(bottom.length<3)throw Error('Cannot fit table legs');
      const b=new THREE.Box3().setFromPoints(bottom);
      b.min.y=0;b.max.y=underside;
      // Include nearby upper leg vertices; omit horizontal stretchers/aprons.
      const c=b.getCenter(V()),s=b.getSize(V());
      for(const v of points)if(v.y<underside&&Math.abs(v.x-c.x)<Math.max(.045,s.x*.8)&&Math.abs(v.z-c.z)<Math.max(.045,s.z*.8)){b.min.x=Math.min(b.min.x,v.x);b.max.x=Math.max(b.max.x,v.x);b.min.z=Math.min(b.min.z,v.z);b.max.z=Math.max(b.max.z,v.z);}
      add(b);
    }
  }
  if(parts.length<5||parts.length>40)throw Error('Invalid compound table fit');
  const feet=parts.filter(b=>b.center[1]-b.half[1]<.015),topPart=parts.find(b=>b.center[1]+b.half[1]>=size.y-.005&&b.half[0]*2>=size.x*.75&&b.half[2]*2>=size.z*.75);
  if(feet.length<4||!topPart)throw Error('Table fit has no supported tabletop');
  return {root,parts,size,source,triangles:triangles.length};
}
