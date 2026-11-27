import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {readFileSync,writeFileSync} from 'node:fs';
import {createTissue} from './tissue.js';
await RAPIER.init();
const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const extract=(from,to)=>{const i=app.indexOf(from),j=app.indexOf(to,i);if(i<0||j<0)throw Error('Missing source segment '+from);return app.slice(i,j);};
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),Q=()=>new THREE.Quaternion(),R=THREE.MathUtils.degToRad,UP=V(0,1,0);
const qOf=b=>{const r=b.rotation();return Q().set(r.x,r.y,r.z,r.w);},pOf=b=>{const p=b.translation();return V(p.x,p.y,p.z);};
const {decode,makeWorld,enforceLimits,capRigidVelocities,updateTargets,restNames}=new Function('THREE','RAPIER','V','Q','R','UP','qOf','pOf',extract('const restNames=','function draw(m)')+'\nreturn {decode,makeWorld,enforceLimits,capRigidVelocities,updateTargets,restNames};')(THREE,RAPIER,V,Q,R,UP,qOf,pOf);
const file=readFileSync(new URL('../human-softbody-v1-0/assets/character-softbody-v1.glb',import.meta.url)),buffer=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),{arrays:a,json:j}=decode(buffer);
const ids=j.skins[0].joints,parents=ids.map(id=>ids.findIndex(parent=>j.nodes[parent].children?.includes(id))),bones=[];
for(let i=0;i<ids.length;i++){const node=j.nodes[ids[i]];if(node.name!==restNames[i]||node.rotation||node.matrix||node.scale)throw Error('Unexpected skeleton transform '+node.name);bones.push(V(...(node.translation||[0,0,0])).add(parents[i]<0?V():bones[parents[i]]));}
const n=j.meshes[0].primitives[0].attributes.POSITION,ac=j.accessors[n],bv=j.bufferViews[ac.bufferView],binOffset=28+new DataView(buffer).getUint32(12,true);
const skin=new Float32Array(buffer,binOffset+(bv.byteOffset||0)+(ac.byteOffset||0),ac.count*3);
function testDrop(deg,steps){
  const m={...makeWorld(bones,parents),arrays:a,bones,parents,tissue:createTissue(a,skin)},q=Q().setFromAxisAngle(V(0,0,1),R(deg)),h=m.tissue.h;
  const baseY=-1.22;m.floorBody.setTranslation(V(0,baseY-.05,0),true);
  for(let i=0;i<bones.length;i++){const b=m.bodies[i];b.setRotation(q,true);b.setTranslation(bones[i].clone().applyQuaternion(q),true);}
  updateTargets(m);m.tissue.reset();
  let maxSpeed=0,maxSpin=0,maxJointGap=0,maxHeight=-Infinity,minVolume=1,maxInverted=0,maxResidual=0,contactCount=0,peakPostImpactSpeed=0;const rootPath=[];
  for(let i=0;i<steps;i++){
    enforceLimits(m,h);capRigidVelocities(m);m.world.step();capRigidVelocities(m);updateTargets(m);
    m.tissue.step([0,-9.81,0],{x:0,y:1,z:0,c:-baseY},[]);
    const root=pOf(m.bodies[0]);maxHeight=Math.max(maxHeight,root.y);
    if(i%12===0)rootPath.push([i,Number(root.y.toFixed(4))]);
    for(const b of m.bodies){const v=b.linvel(),w=b.angvel();const sp=Math.hypot(v.x,v.y,v.z),spin=Math.hypot(w.x,w.y,w.z);if(!Number.isFinite(sp+spin+pOf(b).lengthSq()))throw Error('Nonfinite rigid state');maxSpeed=Math.max(maxSpeed,sp);maxSpin=Math.max(maxSpin,spin);if(i>steps-60)peakPostImpactSpeed=Math.max(peakPostImpactSpeed,sp);}
    for(const s of m.jointData){const parent=m.bodies[s.par],child=m.bodies[s.i],expected=s.restAnchor.clone().applyQuaternion(qOf(parent)).add(pOf(parent));maxJointGap=Math.max(maxJointGap,expected.distanceTo(pOf(child)));}
    if(i%12===0||i===steps-1){const st=m.tissue.measure();minVolume=Math.min(minVolume,st.volumeRatio);maxInverted=Math.max(maxInverted,st.inverted);contactCount=Math.max(contactCount,st.contacts);for(let k=0;k<m.tissue.p.length;k+=3){const p=m.tissue.p,t=m.tissue.target;const d=Math.hypot(p[k]-t[k],p[k+1]-t[k+1],p[k+2]-t[k+2]);if(!Number.isFinite(d))throw Error('Nonfinite tissue');maxResidual=Math.max(maxResidual,d);}}
  }
  const finalRoot=pOf(m.bodies[0]),finalTissue={...m.tissue.measure()};m.world.free();
  const pass=maxJointGap<.10&&maxHeight<.5&&maxSpeed<=5.001&&maxSpin<=8.001&&finalRoot.y<-.35&&peakPostImpactSpeed<2.5&&minVolume>.65;
  return {deg,steps,pass,maxSpeed,maxSpin,maxJointGap,maxHeight,peakPostImpactSpeed,finalRootY:finalRoot.y,minVolume,maxInverted,maxResidual,contactCount,finalTissue,rootPath};
}
const results=[testDrop(0,300),testDrop(30,300)];
const report={engine:'Rapier + actual GLB cage, Node.js headless, not browser/Quest',results,passed:results.every(x=>x.pass)};
writeFileSync(new URL('./drop-test-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
