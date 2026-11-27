import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import initJolt from './node_modules/jolt-physics/dist/jolt-physics.wasm-compat.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRagdoll} from './ragdoll.js';
import {fitTableScene} from './table.js';
const V=(...a)=>new THREE.Vector3(...a),Q=()=>new THREE.Quaternion(),UP=V(0,1,0);
globalThis.ProgressEvent??=class{constructor(type,init){Object.assign(this,{type},init)}};
const report={status:'failed',tests:[],source:'native Jolt WASM 1.1.2 and original compact table geometry',error:null};
function record(name,details){report.tests.push({name,...details});console.log(name,JSON.stringify(details));}
function readGeometry(path){
  const b=fs.readFileSync(path),jl=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+jl)),off=20+jl,bl=b.readUInt32LE(off),bin=b.subarray(off+8,off+8+bl);
  // Remove texture references only; preserve every node, mesh, transform,
  // position, index and accessor in the real deployed asset.
  delete j.images;delete j.textures;delete j.samplers;delete j.materials;
  for(const mesh of j.meshes)for(const p of mesh.primitives)delete p.material;
  let json=Buffer.from(JSON.stringify(j));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const out=Buffer.alloc(12+8+json.length+8+bin.length);out.write('glTF',0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.write('JSON',16);json.copy(out,20);out.writeUInt32LE(bin.length,20+json.length);out.write('BIN\0',24+json.length);bin.copy(out,28+json.length);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
}
try{
 const J=await initJolt(),fit=JSON.parse(fs.readFileSync('./fit.json','utf8'));
 const gl=await new GLTFLoader().parseAsync(readGeometry('./table-lite.glb'),'');
 const asset=fitTableScene(gl.scene),top=Math.max(...asset.parts.map(p=>p.center[1]+p.half[1]));
 assert.equal(asset.triangles,600);assert(asset.parts.length>=5);assert(top>.35&&top<1.3);
 record('actual mesh fit',{dimensions:asset.size.toArray(),parts:asset.parts.length,top,triangles:asset.triangles});
 const a=new THREE.Group(),model=createRagdoll(J,fit);
 function floor(){a.updateMatrixWorld(true);const plane=new THREE.Plane(UP,0).applyMatrix4(a.matrixWorld.clone().invert()),n=plane.normal;model.setFloor(n.clone().multiplyScalar(-plane.constant-.05),Q().setFromUnitVectors(UP,n),V(0,-9.81,0).applyQuaternion(a.quaternion.clone().invert()).divideScalar(a.scale.x));}
 function step(n){for(let i=0;i<n;i++){model.step(1/120);model.captureTable(a);model.ensureTableFloor(a);}}
 function bounds(){return model.poseBounds();}
 function tableBottom(){let y=Infinity;for(const p of model.table.parts)for(const x of [-1,1])for(const yy of [-1,1])for(const z of [-1,1])y=Math.min(y,V(p.center[0]+x*p.half[0],p.center[1]+yy*p.half[1],p.center[2]+z*p.half[2]).multiplyScalar(model.table.sizeScale).applyQuaternion(model.table.rotation).add(model.table.position).y);return y;}
 a.position.set(-3,1.5,0);floor();model.installTable(asset.parts,a,V(0,.35,0));model.setCharacterHeld(true);const before=model.positions[0].clone();step(360);
 assert(model.positions[0].distanceTo(before)<.002,'held character moved');assert(Math.abs(tableBottom())<.02,'table failed to settle on floor');record('table falls while character held',{tableBottom:tableBottom(),characterDrift:model.positions[0].distanceTo(before)});
 model.setCharacterHeld(false);step(120);assert(model.positions[0].distanceTo(before)>.1,'character gravity did not resume');record('character release gravity',{movement:model.positions[0].distanceTo(before)});
 model.setCharacterHeld(true);model.setTableHeld(true);model.setTablePose(a,V(0,.40,0),Q(),.75,true);step(30);assert(Math.abs(model.table.position.y-.40)<.01,'held table drifted');model.setTableHeld(false);step(300);assert(Math.abs(tableBottom())<.02,'resized table failed to land');record('table resize and release',{scale:model.table.sizeScale,bottom:tableBottom()});
 // Move character to horizontal above upright tabletop. Both native shapes
 // interact in one physics world; no application support clamp in this test.
 model.setCharacterHeld(true);model.reset();a.position.set(0,top+.55,0);a.quaternion.setFromAxisAngle(V(0,0,1),Math.PI/2);a.scale.setScalar(1);floor();
 model.setTablePose(a,V(0,.005,0),Q(),1,true);model.setCharacterHeld(false);model.wake();
 let minPelvis=Infinity,supportedFrames=0,maxPelvis=-Infinity;
 for(let i=0;i<240;i++){step(1);const hip=a.localToWorld(model.positions[0].clone());if(i>55){minPelvis=Math.min(minPelvis,hip.y);maxPelvis=Math.max(maxPelvis,hip.y);if(hip.y>=top-.05)supportedFrames++;}}
 assert(supportedFrames>=90,'character did not remain supported by tabletop');assert(minPelvis>top-.18,'pelvis passed through table');record('character dropped onto table',{top,minPelvis,maxPelvis,supportedFrames,tableBottom:tableBottom()});
 model.dispose();report.status='passed';
}catch(e){report.error=e?.stack||String(e);console.error(report.error);process.exitCode=1;}
finally{fs.writeFileSync('native-test-result.json',JSON.stringify(report,null,2)+'\n');}
